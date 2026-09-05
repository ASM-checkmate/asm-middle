import { create } from 'zustand';
import type { ActivityOption, Anchor, BlockId, BlockPlan, Category, Friend, Comic, DayKey, DaySummaryItem, Journey, Memory, Phase, ScheduledActivity } from './types';
import { splitDayKey } from './types';
import type { WorryKey } from './types';
import { BLOCK_ORDER, CATEGORIES, blockDef, blockEndAt, blockSlotIn, blockStartAt } from './blocks';
import { DAY_MS, HOUR_MS, compareDayKeys, dayEndOfKey, dayKeyIn, dayStartIn, dayStartOfKey, isValidTz, ownerTz } from './tz';
import { loadClock, saveClock, simNow, withScale, jumpedTo, resetClock, type ClockState } from './clock';
import { PLACES, placeById, tzOf } from './places';
import { suggestOptions, withStayDays } from './suggest';
import { AGENTS, agentActivityAt, agentById, agentOfFriend, applyDeals, companionCtx, friendOf, type Agent } from './agents';
import { makeComic } from './comic';
import { buildTimeline, currentDayKey, currentPlaceAt, emptyPlans, isBlockEditable, isBlockFree, phaseAt, returnDueAt, tzAt, type Days, type Encounters, type JourneyCache, type Plans } from './timeline';
import { estimateJourney, journeyKey } from './journey';
import { rng } from './rng';
import { INITIAL_STATUS, applyDelta, foldStatus, validStatus, type Status } from './status';
import { PUSH_COST, fallbackOption, review, type ReviewCtx } from './review';
import { expire, nextRequest, trimRequests, type AgentRequest } from './requests';
import { callLines, lateText, pickupRule, trimCalls, trimDueCalls, worryLines, type CallEvent, type DueCall } from './call';
import { advance, dealOption, outcomeLines, trimNegotiations, wishFor, type Negotiation } from './negotiate';
import { MAX_LEN, WORRY_CALL_MS, ASK_CALL_MS, reactToWorry, replyTo, trimMessages, type ChatMsg } from './chat';

/** Seed memory: the first launch starts from 모모; onboarding (`updateMemory`) overwrites name/likes/traits. */
export const DEFAULT_MEMORY: Memory = {
  name: '모모',
  likes: ['그림 그리기', '카페', '바다', '스케이트보드'],
  dislikes: ['줄 서기', '너무 매운 것'],
  traits: ['느긋한', '호기심 많은'],
  homePlaceId: 'home',
  friends: [
    { id: 'minsu', name: '민수', homePlaceId: 'minsu-home', color: '#5FC9A6', emoji: '🐥' },
    { id: 'hana', name: '하나', homePlaceId: 'hana-home', color: '#A9DCF5', emoji: '🐰' },
  ],
  visited: [],
};

/** The parts of memory the user writes (SPEC: 사용자가 기입한 취향과 성향). */
export type MemoryPatch = Partial<Pick<Memory, 'name' | 'likes' | 'dislikes' | 'traits'>>;

/** "다른 제안 보기" counter per day and block. */
export type Regen = Record<DayKey, Partial<Record<BlockId, number>>>;
/** The pure inputs of the timeline — the bundle the helpers below pass around. */
export interface World { days: Days; anchor: Anchor; memory: Memory; journeys: JourneyCache; regen: Regen; encounters: Encounters; requests: AgentRequest[]; calls: CallEvent[]; negotiations: Record<string, Negotiation>; messages: ChatMsg[]; dueCalls: DueCall[] }
interface Persisted { v: 5; days: Days; anchor: Anchor; journeys: JourneyCache; regen: Regen; encounters: Encounters; requests: AgentRequest[]; calls: CallEvent[]; negotiations: Record<string, Negotiation>; messages: ChatMsg[]; dueCalls: DueCall[] }

const WORLD_KEY = 'theworld.world.v5';   // + 대화 실 (ADR-0002). 옛 판은 한 번만 읽어 올린다
const WORLD_KEY_V4 = 'theworld.world.v4';  // legacy: days + anchor(+status), 대화 실 없음 (ADR-0001)
const DAYS_KEY_V3 = 'theworld.days.v3';  // legacy: days + anchor without status
const SEEN_KEY = 'theworld.seen.v3';
const BOOK_KEY = 'theworld.book.v1';
const MEMORY_KEY = 'theworld.memory.v2';   // v2: friends carry metAt/metPlaceId (FRIENDS_SPEC §4)
const ONBOARD_KEY = 'theworld.onboarded.v1';
const CHAT_SEEN_KEY = 'theworld.chatseen.v1';  // 대화 실을 마지막으로 본 시각 (안 읽은 줄 배지)
const VISITED_CAP = 30;            // memory.visited keeps the last N places
/**
 * 들은 고민에 에이전트가 무엇으로 답하는가 (ADR-0001 고민 듣기).
 * 답이 다음 하루를 실제로 바꾸지 않으면 그건 그냥 폼이다.
 */
const WORRY_CATEGORY: Record<WorryKey, Category | null> = {
  work: 'rest',      // 일이 안 풀리면 쉰다
  people: 'rest',    // 사람한테 지쳤으면 혼자 있는다
  body: 'rest',
  money: 'rest',     // 돈 걱정이면 공짜인 걸 한다 (쉬기는 집·공원 위주)
  sleep: 'rest',
  stuck: 'play',     // 결정을 못 하겠으면 딴짓을 한다
  bored: 'play',
  none: null,
};
const CATCHUP_GAP_MS = 10 * 60_000; // away at least this long (sim time) → the "자는 동안 이런 일이" sheet
const KEEP_DAYS = 5;               // days older than this are folded into the anchor
const HORIZON_MS = 36 * HOUR_MS;   // how far past "now" the timeline is resolved (tomorrow's plan, the next departure)
const SUMMARY_CAP = 12;            // most recent stories shown on the sheet

// localStorage may be missing (node harness, sandboxed webviews): every access is guarded
const load = <T,>(k: string, fb: T): T => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const remove = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

const loadMemory = (): Memory => {
  const m = load<Partial<Memory> | null>(MEMORY_KEY, null);
  if (!m) return DEFAULT_MEMORY;
  const arr = (v: unknown, fb: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fb);
  return {
    ...DEFAULT_MEMORY,
    name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : DEFAULT_MEMORY.name,
    likes: arr(m.likes, DEFAULT_MEMORY.likes),
    dislikes: arr(m.dislikes, DEFAULT_MEMORY.dislikes),
    traits: arr(m.traits, DEFAULT_MEMORY.traits),
    homePlaceId: typeof m.homePlaceId === 'string' ? m.homePlaceId : DEFAULT_MEMORY.homePlaceId,
    friends: Array.isArray(m.friends) && m.friends.length
      ? m.friends.filter((f): f is Memory['friends'][number] => !!f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.homePlaceId === 'string')
      : DEFAULT_MEMORY.friends,
    visited: Array.isArray(m.visited) ? m.visited.filter(v => v && typeof v.placeId === 'string' && Number.isFinite(v.at)).slice(-VISITED_CAP) : [],
    worry: m.worry && typeof m.worry.key === 'string' && Number.isFinite(m.worry.at) ? m.worry : undefined,
  };
};

// ─── anchor & days ──────────────────────────────────────────────────────────
/** First launch: at home, at the local midnight of the install day, in the home zone. */
const freshAnchor = (now: number, memory: Memory): Anchor => {
  const tz = tzOf(placeById(memory.homePlaceId));
  return { placeId: memory.homePlaceId, t: dayStartIn(now, tz), tz, status: INITIAL_STATUS };
};
const validAnchor = (raw: unknown, now: number, memory: Memory): Anchor => {
  const a = raw as Partial<Anchor> | null;
  if (a && typeof a.placeId === 'string' && typeof a.t === 'number' && Number.isFinite(a.t) && isValidTz(a.tz)) {
    try { placeById(a.placeId); return { placeId: a.placeId, t: a.t, tz: a.tz, status: validStatus(a.status) }; } catch { /* unknown place → fresh */ }
  }
  return freshAnchor(now, memory);
};
const validDays = (raw: unknown): Days => {
  const out: Days = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k.includes('@') || !v || typeof v !== 'object' || !isValidTz(splitDayKey(k).tz) || !Number.isFinite(dayStartOfKey(k))) continue;
    const plans = { ...emptyPlans(), ...(v as Partial<Plans>) };
    // v3 이전 계획에는 PlanStatus가 없다: 고른 게 있으면 확정, 아니면 제안/빈 칸으로 본다
    for (const p of Object.values(plans)) {
      if (p.status) continue;
      p.status = p.chosenId ? 'confirmed' : p.options.length ? 'proposed' : 'empty';
    }
    // legacy data: the '만남' category was folded into the others (FRIENDS_SPEC §3) — keep old days readable
    for (const p of Object.values(plans)) {
      const legacy = p as unknown as { category: string | null; options: { category: string }[] };
      if (legacy.category === 'social') legacy.category = 'play';
      for (const o of legacy.options ?? []) if (o.category === 'social') o.category = 'play';
    }
    out[k] = plans;
  }
  return out;
};
const persistedOf = (w: World): Persisted => ({ v: 5, days: w.days, anchor: w.anchor, journeys: w.journeys, regen: w.regen, encounters: w.encounters, requests: w.requests, calls: w.calls, negotiations: w.negotiations, messages: w.messages, dueCalls: w.dueCalls });
const horizonFor = (t: number) => t + HORIZON_MS;
const build = (w: World, t: number) => buildTimeline(w.anchor, w.days, w.memory, w.journeys, horizonFor(t), w.encounters);

/** Places already chosen (or proposed) in the other blocks today, so suggestions vary across the day. */
const usedPlaceIds = (plans: Plans, except: BlockId) => {
  const ids = new Set<string>();
  for (const id of BLOCK_ORDER) {
    if (id === except) continue;
    const p = plans[id];
    if (!p) continue;
    const chosen = p.options.find(o => o.id === p.chosenId);
    if (chosen) ids.add(chosen.placeId);
    else for (const o of p.options) ids.add(o.placeId);
  }
  return [...ids];
};
const sameOptions = (a: ActivityOption[], b: ActivityOption[]) => a.length === b.length && a.every((o, i) => o.id === b[i].id);

/** The hotel of a city (the trip's home base), if the catalogue has one. */
const hotelIn = (city: string) => PLACES.find(p => p.city === city && p.type === 'hotel') ?? null;
/** Blocks the agent treats as meal time when the owner left them blank. */
const MEAL_BLOCKS = new Set<BlockId>(['morning', 'lunch', 'evening']);
/** Meal time means going out to eat: a café/brunch first when the owner likes cafés or bread, otherwise a restaurant;
 *  markets and bars next, friends' and home cooking last. Stable within a tier. */
function rankMealOptions(options: ActivityOption[], memory: Memory): ActivityOption[] {
  const likes = memory.likes.join(' ');
  const cafeLover = /카페|브런치|빵|커피|디저트/.test(likes);
  const tier: Record<string, number> = cafeLover
    ? { cafe: 0, restaurant: 1, market: 2, bar: 3, friend_home: 4, home: 5 }
    : { restaurant: 0, cafe: 1, market: 2, bar: 3, friend_home: 4, home: 5 };
  const rank = (o: ActivityOption) => tier[placeById(o.placeId).type] ?? 3;
  return options.map((o, i) => ({ o, i })).sort((x, y) => rank(x.o) - rank(y.o) || x.i - y.i).map(x => x.o);
}

/** Friend / agent names never appear in a title — companionship is data (`friendId`), not copy (FRIENDS_SPEC). */
const AGENT_NAMES = AGENTS.map(a => a.name);
const stripNames = (title: string, keepPlaceName: boolean): string => {
  if (keepPlaceName) return title.replace(/\{friend\}(이랑|랑|와|과|네)?\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  let out = title.replace(/\{friend\}(이랑|랑|와|과|네)?\s*/g, '');
  for (const n of AGENT_NAMES) out = out.replace(new RegExp(`${n}(이랑|랑|와|과|네)?\\s*`, 'g'), '');
  return out.replace(/\s{2,}/g, ' ').trim();
};

/**
 * 친구가 먼저 계획하면 일단 채워 둔다 (FRIENDS_SPEC §2): a friend whose own day puts them somewhere in my city in
 * this block turns my empty block into a companion plan — their activity, my two normal suggestions beside it,
 * theirs chosen with `chosenBy: 'friend'`. Titles carry no name; the friend is `friendId` / `proposedBy`.
 */
const MAX_PROPOSALS_PER_DAY = 2;   // 하루가 친구 제안으로 다 차 버리면 "미리 채우지 않는다"가 무의미해진다
/**
 * One block per friend, at most two a day: each friend's own day is scanned for a block they spend somewhere that
 * is not their home, and a seeded pick decides which of those they ask me along to. Stable per day + friend.
 */
function proposalBlocks(dayKey: DayKey, memory: Memory): Map<BlockId, Friend> {
  const out = new Map<BlockId, Friend>();
  for (const f of memory.friends) {
    if (out.size >= MAX_PROPOSALS_PER_DAY) break;
    const agent = agentOfFriend(f);
    const blocks = BLOCK_ORDER.filter(id => {
      const act = agentActivityAt(agent, id, dayKey);
      return !!act && act.placeId !== agent.homePlaceId && !out.has(id);
    });
    if (!blocks.length) continue;
    out.set(rng(`propose:${dayKey}:${f.id}`).pick(blocks), f);
  }
  return out;
}

function friendProposal(id: BlockId, dayKey: DayKey, myCity: string, friend: Friend | undefined, options: (c: Category) => ActivityOption[]): BlockPlan | null {
  for (const f of friend ? [friend] : []) {
    const agent = agentOfFriend(f);
    const act = agentActivityAt(agent, id, dayKey);
    if (!act || act.placeId === agent.homePlaceId) continue;   // 친구가 자기 집에 있는 블록은 제안이 아니라 '친구 집' 후보
    let place;
    try { place = placeById(act.placeId); } catch { continue; }
    if (place.city !== myCity) continue;
    const category = act.option.category;
    const companion: ActivityOption = {
      id: `${id}-friend-${f.id}`,
      title: stripNames(act.option.title, place.type === 'friend_home'),
      reason: `${f.name}가 같이 가자고 함`,
      emoji: act.option.emoji,
      placeId: place.id,
      category,
      friendId: f.id,
      proposedBy: f.id,
    };
    const rest = options(category).filter(o => o.placeId !== place.id).slice(0, 2);
    return { blockId: id, category, options: [companion, ...rest], chosenId: companion.id, chosenBy: 'friend', status: 'confirmed' };
  }
  return null;
}

/**
 * The agent decides a block **when it starts** — nothing is pre-filled any more (FRIENDS_SPEC §1). A free block
 * that has not started stays empty (category null, options []) unless (a) it is the day the trip is due home, or
 * (b) a friend already planned something here, which pre-fills it as a companion plan. A started free block gets a
 * category, three suggestions and the first one picked with `chosenBy: 'agent'` — meal times eat, a trip's night
 * goes to the hotel. Blocks the user decided are never touched. Deterministic per day + block.
 */
export function decide(dayKey: DayKey, w: World, horizon: number, now: number): { days: Days; timeline: ScheduledActivity[]; changed: boolean } {
  const dayStart = dayStartOfKey(dayKey);
  const homeCity = placeById(w.memory.homePlaceId).city;
  const regen = w.regen[dayKey] ?? {};
  let days = w.days, changed = false;
  let plans = days[dayKey];
  if (!plans) { plans = emptyPlans(); days = { ...days, [dayKey]: plans }; changed = true; }
  let timeline = buildTimeline(w.anchor, days, w.memory, w.journeys, horizon, w.encounters);
  const proposals = proposalBlocks(dayKey, w.memory);
  for (const id of BLOCK_ORDER) {
    if (!isBlockFree(id, dayKey, timeline, w.anchor)) continue;
    const p0 = plans[id];
    if (p0.chosenBy === 'user') continue;                                        // 사용자가 정한 블록은 건드리지 않는다
    const start = blockStartAt(dayStart, id);
    const started = start <= now;
    const from = currentPlaceAt(start - 1, timeline, w.anchor);
    const ctx = (category: Category) => ({ dateKey: dayKey, blockId: id, category, memory: w.memory, from, regenSalt: regen[id], usedPlaceIds: usedPlaceIds(plans, id), companions: companionCtx(w.memory, id, dayKey, dayStart) });
    let p = { ...p0 };
    if (returnDueAt(start, timeline, w.anchor, w.memory)) {
      // 마지막 날: 그 날의 첫 빈 블록엔 집으로 돌아가는 이동 (사용자가 미리 정한 블록은 건드리지 않음)
      if (p.category !== 'travel' || !p.options.length) { p.category = 'travel'; p.options = suggestOptions(ctx('travel')); }
      p.chosenId = (p.options.find(o => o.placeId === w.memory.homePlaceId) ?? p.options[0])?.id ?? null;
      p.chosenBy = p.chosenId ? 'agent' : null;
      p.status = p.chosenId ? 'confirmed' : 'empty';
    } else if (!started) {
      // 사용자가 미리 정한 블록(범주만 골라둔 것 포함)과 이미 들어온 친구 제안에는 끼어들지 않는다
      if (p0.category !== null || p0.options.length) continue;
      const proposal = friendProposal(id, dayKey, from.city, proposals.get(id), c => suggestOptions(ctx(c)));
      if (!proposal) continue;                                                   // 아직 시작 안 한 블록은 비어 있는 채로 둔다
      p = proposal;
    } else {
      const r = rng(`auto:${dayKey}:${id}`);
      // 여행지의 밤은 숙소에서 (the city's hotel, when it has one) — so the character sleeps in a bed, not next to a café
      const hotel = id === 'night' && from.city !== homeCity ? hotelIn(from.city) : null;
      // 사용자가 말해 준 고민이 신선하면(하루 안) 에이전트가 그에 맞는 범주로 튼다 (ADR-0001 고민 듣기)
      const worry = w.memory.worry && start - w.memory.worry.at < DAY_MS ? WORRY_CATEGORY[w.memory.worry.key] : null;
      if (!p.category) p.category = MEAL_BLOCKS.has(id)
        ? 'meal'                                                           // 아침·점심·저녁은 밥 시간 (식당/브런치/카페는 취향대로 제안됨)
        : hotel ? 'rest'
          : worry ?? r.pick(CATEGORIES.filter(c => c.id !== 'travel' && c.id !== 'meal')).id;
      if (!p.options.length) p.options = suggestOptions(ctx(p.category));
      if (p.category === 'meal') p.options = rankMealOptions(p.options, w.memory);
      if (hotel && p.category === 'rest') p.options = [...p.options.filter(o => o.placeId === hotel.id), ...p.options.filter(o => o.placeId !== hotel.id)];
      // 에이전트의 자기 선택도 사용자의 확정과 **같은 문**을 지난다 (sim/review.ts):
      // 돈이 없으면 비싼 걸 안 고르고, 지쳤으면 운동을 안 고른다. 셋 다 막히면 집에서 쉰다.
      const rctx: ReviewCtx = {
        dayKey, status: foldStatus(w.anchor, timeline, start, w.memory), memory: w.memory,
        from, blockId: id, blockStart: start, blockEnd: blockEndAt(dayStart, id), timeline,
      };
      const ok = p.options.find(o => !review(o, rctx));
      if (ok) p.chosenId = ok.id;
      else {
        const fb = fallbackOption(id, w.memory);
        p.options = [...p.options, fb];
        p.chosenId = fb.id;
      }
      p.chosenBy = 'agent';
      p.status = 'confirmed';
    }
    if (p.chosenId === p0.chosenId && p.category === p0.category && p.chosenBy === p0.chosenBy && p.status === p0.status && sameOptions(p.options, p0.options)) continue;
    plans = { ...plans, [id]: p }; days = { ...days, [dayKey]: plans }; changed = true;
    timeline = buildTimeline(w.anchor, days, w.memory, w.journeys, horizon, w.encounters);
  }
  return { days, timeline, changed };
}

/** Day keys the character passes through from the anchor to `now`, in order — time spent inside a journey or an
 *  activity is skipped (a night on a plane belongs to no day). */
function daysLived(anchor: Anchor, timeline: ScheduledActivity[], now: number): DayKey[] {
  const out: DayKey[] = [];
  let t = anchor.t;
  for (let n = 0; n < 200 && t <= now; n++) {
    const inside = timeline.find(a => a.departAt <= t && t < a.comicUntil);
    if (inside) { t = inside.comicUntil; continue; }
    const tz = tzAt(t, timeline, anchor.tz);
    const dk = dayKeyIn(t, tz);
    if (!out.includes(dk)) out.push(dk);
    t = blockSlotIn(t, tz).end;
  }
  return out;
}

/** Every day lived between the anchor and `now` is decided in order (the agent's own picks for what the owner
 *  missed). Restarts whenever a decision changed the timeline — a trip home moves the zone and the days after it. */
function liveOut(w: World, now: number): Days {
  let days = w.days;
  for (let guard = 0; guard < 60; guard++) {
    const cur = { ...w, days };
    const timeline = build(cur, now);
    let restarted = false;
    for (const dk of daysLived(cur.anchor, timeline, now)) {
      const r = decide(dk, cur, horizonFor(now), now);
      if (r.changed) { days = r.days; restarted = true; break; }
    }
    if (!restarted) break;
  }
  return days;
}

/** Days older than KEEP_DAYS are folded into the anchor, which moves to the character's state at the end of each
 *  (last place, its zone, the block after its last comic). Their activities are handed to `onAct` (comics, memory). */
function prune(w: World, now: number, onAct: (a: ScheduledActivity) => void): World {
  const cutoff = now - KEEP_DAYS * DAY_MS;
  const old = Object.keys(w.days).filter(k => dayStartOfKey(k) < cutoff).sort(compareDayKeys);
  if (!old.length && w.anchor.t >= cutoff) return w;
  let { anchor } = w;
  const days = { ...w.days }, regen = { ...w.regen };
  for (const k of old) {
    const dayEnd = dayEndOfKey(k);
    const acts = buildTimeline(anchor, days, w.memory, w.journeys, dayEnd, w.encounters);
    acts.forEach(onAct);
    const last = acts[acts.length - 1];
    // 상태는 anchor에 굽는다: 5일 창이 굴러가도 지갑이 리셋되지 않게 (sim/status.ts)
    const status = foldStatus(anchor, acts, dayEnd, w.memory);
    anchor = last
      ? { placeId: last.place.id, tz: last.tz, t: Math.max(dayEnd, blockSlotIn(last.comicUntil - 1, last.tz).end), status }
      : { ...anchor, t: Math.max(anchor.t, dayEnd), status };
    delete days[k]; delete regen[k];
  }
  if (anchor.t < cutoff) anchor = { ...anchor, t: cutoff };   // nothing is planned in between (those days are gone)
  return { ...w, anchor, days, regen };
}

/**
 * The comic of a finished activity: reuse the book's copy, else write it, remember the visit and — when the talk
 * roll succeeded — the new friend (FRIENDS_SPEC §4: 활동이 끝나면 friends에 추가). The encounter log counts every
 * 마주침, talked or not, so running into the same agent again is likelier to end in a hello. Pure.
 */
function settle(a: ScheduledActivity, book: Comic[], memory: Memory, encounters: Encounters): { comic: Comic; book: Comic[]; memory: Memory; encounters: Encounters } {
  const existing = book.find(b => b.id === `c:${a.key}`);
  if (existing) return { comic: existing, book, memory, encounters };
  const comic = makeComic(a, memory);
  let nextMemory = a.place.type === 'home'
    ? memory
    : { ...memory, visited: [...memory.visited.filter(v => !(v.placeId === a.place.id && v.at === a.endAt)), { placeId: a.place.id, at: a.endAt }].slice(-VISITED_CAP) };
  let nextEncounters = encounters;
  const e = a.encounter;
  if (e) {
    nextEncounters = { ...encounters, [e.agentId]: (encounters[e.agentId] ?? 0) + 1 };
    const agent = agentById(e.agentId);
    if (e.talked && !e.again && agent && !nextMemory.friends.some(f => f.id === e.agentId)) {
      nextMemory = { ...nextMemory, friends: [...nextMemory.friends, friendOf(agent, { at: a.endAt, placeId: a.place.id })] };
    }
  }
  return { comic, book: [...book, comic], memory: nextMemory, encounters: nextEncounters };
}

export interface WorldState {
  clock: ClockState;
  now: number;
  /** where the remembered timeline starts: the character's place, the moment and the zone (moves as old days are pruned) */
  anchor: Anchor;
  /** plans per lived day (`2026-09-04@America/New_York`) — the last KEEP_DAYS days */
  days: Days;
  /** the character's current day and zone: `dayKeyIn(now, tzAt(now))` — changes at local midnight and on arrival abroad */
  today: DayKey;
  tz: string;
  memory: Memory;
  /** the agent pool: every friend plus the NPC agents standing in for other users (FRIENDS_SPEC §4) */
  agents: Agent[];
  /** how many times we have run into each agent — feeds the "또 봤네" bonus of the talk roll */
  encounters: Encounters;
  /** 지금 이 순간의 누적 상태 (anchor에 구워진 값 + 그 뒤 끝난 활동의 접기) */
  status: Status;
  /** 에이전트가 나에게 건 말들 (sim/requests.ts). 답이 없으면 혼자 정하고 나중에 통보한다. */
  requests: AgentRequest[];
  /** 통화 기록 (sim/call.ts). 부재중은 시각만 남고 내용은 없다. */
  calls: CallEvent[];
  /** 지금 화면에 떠 있는 통화 (수신 벨 / 발신). 없으면 null. */
  activeCall: CallEvent | null;
  /** 자유 대화 (sim/chat.ts). 에이전트의 답장은 **도착할 시각**을 달고 미리 들어와 있다. */
  messages: ChatMsg[];
  /** 약속한 수신 전화 ("이따가 전화할게"). `at`이 지나면 벨이 울린다. */
  dueCalls: DueCall[];
  /** 대화창이 열려 있나 */
  chatOpen: boolean;
  /** 대화 실을 마지막으로 본 시각 — 안 읽은 줄 배지가 이걸 쓴다 */
  chatSeen: number;
  /** 혼잣말 한 줄 (ADR-0001 §1의 1단계). 대가 없이 지나가고, 잠깐 떴다 사라진다. */
  say: { text: string; at: number } | null;
  /** 친구와의 조율 (sim/negotiate.ts). 상대는 이름으로만 존재한다. */
  negotiations: Record<string, Negotiation>;
  /** false until the user has written their memory once (onboarding); the seed memory is in use meanwhile */
  onboarded: boolean;
  /** = days[today] */
  plans: Plans;
  journeys: JourneyCache;
  regen: Regen;
  book: Comic[];
  /** activities resolved from the anchor to ~36 h past now, in departure order */
  timeline: ScheduledActivity[];
  phase: Phase;
  summary: DaySummaryItem[] | null;   // catch-up sheet content (null = nothing to show)
  /** the stretch the owner was away for, in sim time — the catch-up sheet stamps it as evidence the world kept running */
  gap: { from: number; to: number } | null;
  selectedBlock: BlockId | null;
  bookOpen: boolean;
  ttOpen: boolean;
  friendsOpen: boolean;

  /** 임의의 순간의 상태. 블록 시작 시점으로 판단할 때(거절) 읽는다. */
  statusAt: (t: number) => Status;
  /** 쪽지에 답한다. `choiceId`는 request.choices의 id. */
  answerRequest: (id: string, choiceId: string) => void;
  /** 에이전트가 혼자 정한 것을 통보로 한 번 보여준 뒤 표시를 끈다. */
  markRequestTold: (id: string) => void;
  /** 내가 전화를 건다. 받을지 말지는 지금 phase가 정한다 (sim/call.ts). */
  callAgent: () => void;
  /** 걸려온 전화를 받는다 / 안 받는다. */
  answerCall: (accept: boolean) => void;
  /** 통화 화면을 닫는다 (기록은 남는다 — 받았던 통화라면 통화 시간까지). */
  endCall: () => void;
  /** 대화창에서 한 마디 보낸다. 답장은 상황에 따라 바로 오거나 한참 뒤에 온다 (sim/chat.ts). */
  sendMessage: (text: string) => void;
  /** 대화창을 연다 / 닫는다. 열거나 닫을 때 "여기까지 봤다"를 찍는다. */
  setChatOpen: (open: boolean) => void;
  /** 혼잣말을 지운다 (뜬 지 몇 초 뒤 화면이 부른다). */
  dismissSay: () => void;
  /** 조율 릴레이를 연다 / 닫는다. */

  tick: () => void;
  setCategory: (id: BlockId, c: Category) => void;
  /** Confirm an option. `stayDays` overrides a trip's nights (the "(n박)" in its title is rewritten to match).
   *  Picking a friend's proposal back keeps it a companion plan (`chosenBy: 'friend'`); anything else cancels it. */
  chooseOption: (id: BlockId, optionId: string, by?: 'user' | 'agent' | 'friend', stayDays?: number) => void;
  /** 에이전트가 반대했지만 그래도 간다. 대가(피로·기분)를 즉시 anchor에 굽는다. 거절(`refuse`)에는 통하지 않는다. */
  pushAnyway: (id: BlockId) => void;
  /** 반대를 받아들이고 물러선다 — 판정을 지우고 블록을 다시 제안 상태로 되돌린다. */
  clearVerdict: (id: BlockId) => void;
  regenerateOptions: (id: BlockId) => void;
  selectBlock: (id: BlockId | null) => void;
  dismissSummary: () => void;
  setBookOpen: (open: boolean) => void;
  setTtOpen: (open: boolean) => void;
  setFriendsOpen: (open: boolean) => void;
  setJourney: (fromId: string, toId: string, j: Journey) => void;
  /** Write the user's part of the memory (name/likes/dislikes/traits); agent-picked future blocks get re-suggested. */
  updateMemory: (patch: MemoryPatch) => void;
  // dev / QA
  setScale: (s: number) => void;
  /** Jump to `h:m` of the character's current local day (its zone). */
  jumpToHour: (h: number, m?: number) => void;
  jumpTo: (t: number) => void;
  jumpBy: (ms: number) => void;
  resetDay: () => void;
}

const comicCache = new Map<string, Comic>();
const summaryOf = (acts: ScheduledActivity[], comicOf: (a: ScheduledActivity) => Comic): DaySummaryItem[] =>
  [...acts].sort((a, b) => a.endAt - b.endAt).slice(-SUMMARY_CAP).map(a => ({ blockId: a.blockIds[0], act: a, comic: comicOf(a) }));
const worldOf = (s: WorldState): World => ({ days: s.days, anchor: s.anchor, memory: s.memory, journeys: s.journeys, regen: s.regen, encounters: s.encounters, requests: s.requests, calls: s.calls, negotiations: s.negotiations, messages: s.messages, dueCalls: s.dueCalls });
/** Where the character is right before block `id` of today (the previous activity's place, else the anchor's). */
const placeBefore = (s: WorldState, id: BlockId) => currentPlaceAt(blockStartAt(dayStartOfKey(s.today), id) - 1, s.timeline, s.anchor);

export const useWorld = create<WorldState>((set, get) => {
  const clock = loadClock();
  const now = simNow(clock);
  const lastSeen = load<number>(SEEN_KEY, now);
  const onboarded = load<boolean>(ONBOARD_KEY, false);
  let book = load<Comic[]>(BOOK_KEY, []);
  let memory = loadMemory();
  // v4가 없으면 v3를 한 번 읽어 올린다 (계획은 그대로 살고, 상태만 초기값에서 시작한다)
  const persisted0 = load<Partial<Persisted> | null>(WORLD_KEY, null) ?? load<Partial<Persisted> | null>(WORLD_KEY_V4, null) ?? load<Partial<Persisted> | null>(DAYS_KEY_V3, null);
  let encounters: Encounters = persisted0?.encounters ?? {};
  const book0 = book, memory0 = memory;
  const settleLocal = (a: ScheduledActivity): Comic => {
    const r = settle(a, book, memory, encounters);
    book = r.book; memory = r.memory; encounters = r.encounters; comicCache.set(a.key, r.comic);
    return r.comic;
  };

  // ── catch-up: the gap since the last visit is computed once, here. Days too old are folded into the anchor,
  //    the days lived since are decided by the agent (in the zones it passed through), their comics land in the
  //    book, and everything that ended after `lastSeen` becomes the "자는 동안 이런 일이" sheet. ──
  const persisted = persisted0;
  let w: World = { days: validDays(persisted?.days), anchor: validAnchor(persisted?.anchor, now, memory), memory, journeys: persisted?.journeys ?? {}, regen: persisted?.regen ?? {}, encounters, requests: Array.isArray(persisted?.requests) ? persisted.requests : [], calls: Array.isArray(persisted?.calls) ? persisted.calls : [], negotiations: (persisted?.negotiations && typeof persisted.negotiations === 'object' ? persisted.negotiations : {}), messages: Array.isArray(persisted?.messages) ? persisted.messages : [], dueCalls: Array.isArray(persisted?.dueCalls) ? persisted.dueCalls : [] };
  const gapActs: ScheduledActivity[] = [];
  const remember = (a: ScheduledActivity) => { settleLocal(a); if (a.endAt > lastSeen && a.endAt <= now) gapActs.push(a); };
  w = prune(w, now, remember);
  w = { ...w, memory, encounters, days: liveOut({ ...w, memory, encounters }, now) };
  const today = currentDayKey(now, build(w, now), w.anchor.tz);
  const first = decide(today, w, horizonFor(now), now);
  w = { ...w, days: first.days };
  for (const a of first.timeline) if (a.endAt <= now) remember(a);
  w = { ...w, memory, encounters };
  const initialPhase = phaseAt(now, first.timeline, w.anchor, memory, settleLocal);
  const initialStatus = foldStatus(w.anchor, first.timeline, now, memory);
  save(WORLD_KEY, persistedOf(w));
  if (book !== book0) save(BOOK_KEY, book);
  if (memory !== memory0) save(MEMORY_KEY, memory);
  const away = now - lastSeen >= CATCHUP_GAP_MS;
  const summary = away && gapActs.length ? summaryOf(gapActs, a => comicCache.get(a.key)!) : null;
  const gap = summary ? { from: lastSeen, to: now } : null;

  /** sim time of the previous tick — the start of the gap a tick has to account for */
  let lastTick = now;

  const comicFor = (a: ScheduledActivity): Comic => {
    let c = comicCache.get(a.key);
    if (!c) {
      const s = get();
      const r = settle(a, s.book, s.memory, s.encounters);
      c = r.comic; comicCache.set(a.key, c);
      if (r.book !== s.book) {
        set({ book: r.book, memory: r.memory, encounters: r.encounters });
        save(BOOK_KEY, r.book);
        if (r.memory !== s.memory) save(MEMORY_KEY, r.memory);
        if (r.encounters !== s.encounters) persist();
      }
    }
    return c;
  };

  const persist = () => save(WORLD_KEY, persistedOf(worldOf(get())));

  /** Re-decide today's free blocks, refresh the timeline and the phase at `t`. */
  const recompute = (t: number) => {
    const s = get();
    const { days, timeline, changed } = decide(s.today, worldOf(s), horizonFor(t), t);
    // Make sure journeys used by the timeline are cached (so routing can refine them)
    let journeys = s.journeys, jchanged = false;
    for (const a of timeline) {
      const k = journeyKey(a.fromPlace.id, a.place.id);
      if (!journeys[k] && a.journey.legs.length) { if (!jchanged) { journeys = { ...journeys }; jchanged = true; } journeys[k] = a.journey; }
    }
    const phase = phaseAt(t, timeline, s.anchor, s.memory, comicFor);
    const status = foldStatus(s.anchor, timeline, t, s.memory);
    set({ now: t, days, plans: days[s.today], timeline, phase, tz: phase.tz, journeys, status });
    if (changed || jchanged) persist();
  };

  /** Move the world to sim time `t`. When the character's local date changed (a night passed, a flight landed in
   *  another zone, a dev jump) the days in between are lived out by the agent, days too old are folded into the
   *  anchor and `today` moves on — the character stays where its last activity left it. Then today is re-decided. */
  const sync = (t: number) => {
    const s = get();
    let w = worldOf(s);
    if (currentDayKey(t, build(w, t), w.anchor.tz) !== s.today) {
      let { book, memory, encounters } = s;
      w = prune(w, t, a => { const r = settle(a, book, memory, encounters); book = r.book; memory = r.memory; encounters = r.encounters; comicCache.set(a.key, r.comic); });
      w = { ...w, memory, encounters, days: liveOut({ ...w, memory, encounters }, t) };
      const today = currentDayKey(t, build(w, t), w.anchor.tz);
      if (book !== s.book) save(BOOK_KEY, book);
      if (memory !== s.memory) save(MEMORY_KEY, memory);
      set({ days: w.days, anchor: w.anchor, regen: w.regen, book, memory, encounters, today, selectedBlock: null });
      persist();
    }
    recompute(t);
  };

  /**
   * 마감이 지난 쪽지를 "에이전트가 혼자 정했다"로 넘기고, 물어볼 게 있으면 하나 띄운다.
   * 하루에 두 번까지, 한 번에 하나만 — 큐가 쌓이면 알림함이 되고 그러면 에이전트가 아니라 폼이 된다.
   */
  const pumpRequests = (t: number) => {
    const s = get();
    const dayStart = dayStartOfKey(s.today);
    const emptyBlocks = BLOCK_ORDER
      .filter(id => id !== 'sleep' && !s.plans[id].chosenId && isBlockEditable(t, id, s.today, s.timeline, s.anchor))
      .map(id => ({ id, startAt: blockStartAt(dayStart, id) }));
    let requests = expire(s.requests, t);
    // 허락에 답이 없으면 에이전트가 그냥 물어보러 간다 (무시된 부탁은 독단이 되어 돌아온다)
    for (const r of requests) {
      if (r.kind !== 'permission' || !r.decidedAlone || !r.refId) continue;
      const n = get().negotiations[r.refId];
      if (n?.state === 'asking-owner') set({ negotiations: { ...get().negotiations, [r.refId]: { ...n, state: 'open', nextAt: t } } });
    }
    const made = nextRequest(requests, { now: t, today: s.today, tz: s.tz, memory: s.memory, status: s.status, emptyBlocks, timeline: s.timeline });
    if (made) requests = [...requests, made];
    if (requests !== s.requests) { set({ requests: trimRequests(requests, s.anchor.t) }); persist(); }
  };

  /**
   * 조율을 굴린다. 하루 한 건 "누구랑 뭐 하고 싶다"는 생각이 나고(허락 요청),
   * 허락을 받으면 왕복이 `nextAt`마다 한 라운드씩 진행된다. 타결되면 **양쪽 하루에 반영**한다.
   */
  const pumpNegotiations = (t: number) => {
    const s = get();
    let ns = s.negotiations;
    let changed = false;

    // ① 오늘 아직 생각이 안 났으면 하나 떠올린다
    if (!Object.values(ns).some(n => n.dayKey === s.today)) {
      const wish = wishFor(s.today, s.memory, s.status, t);
      if (wish) {
        ns = { ...ns, [wish.id]: wish };
        changed = true;
        // 허락을 구하는 쪽지 (ADR-0001 §1) — 답이 없으면 마감에 혼자 정한다
        const friend = s.memory.friends.find(f => f.id === wish.agentId);
        const req: AgentRequest = {
          id: `${s.today}:permission:${wish.agentId}`, kind: 'permission', at: t, dueAt: wish.nextAt, refId: wish.id,
          line: `나 ${friend?.name ?? '친구'}랑 ${blockDef(wish.blockId).label}에 놀고 싶은데, 물어봐도 돼?`,
          choices: [{ id: 'yes', label: '물어봐' }, { id: 'no', label: '안 돼' }, { id: 'up2u', label: '니가 알아서 해', isDefault: true }],
        };
        set({ requests: trimRequests([...s.requests, req], s.anchor.t) });
      }
    }

    // ② 허락이 난 것들을 한 라운드씩 굴린다. 왕복은 화면에 나오지 않으므로,
    //    결말이 난 그 순간에만 대화 실로 한두 줄이 온다 (ADR-0003).
    let msgs = s.messages;
    for (const n of Object.values(ns)) {
      const next = advance(n, s.memory, s.status, t);
      if (next === n) continue;
      ns = { ...ns, [n.id]: next };
      changed = true;
      if (n.state === 'open' && (next.state === 'agreed' || next.state === 'broken')) msgs = [...msgs, ...outcomeLines(next, s.memory)];
    }
    if (!changed) return;
    if (msgs !== s.messages) set({ messages: trimMessages(msgs, s.anchor.t) });

    // ③ 타결된 약속을 내 블록에 얹고, 상대의 하루에도 반영한다 (오너 결정)
    const agreed = Object.values(ns).filter(n => n.state === 'agreed' && n.deal);
    applyDeals(agreed.map(n => ({ agentId: n.agentId, dayKey: n.dayKey, blockId: n.deal!.blockId, placeId: n.deal!.placeId, title: n.deal!.title, category: n.deal!.category })));
    let days = s.days;
    for (const n of agreed) {
      const plans = days[n.dayKey];
      const p = plans?.[n.deal!.blockId];
      const opt = dealOption(n);
      if (!plans || !p || !opt || p.chosenId === opt.id || p.chosenBy === 'user') continue;
      days = { ...days, [n.dayKey]: { ...plans, [n.deal!.blockId]: { ...p, category: opt.category, options: [opt, ...p.options.filter(o => o.id !== opt.id).slice(0, 2)], chosenId: opt.id, chosenBy: 'friend', status: 'confirmed', verdict: undefined } } };
    }
    set({ negotiations: trimNegotiations(ns, s.anchor.t), days, plans: days[s.today] ?? s.plans });
    persist();
    recompute(t);
  };

  /**
   * 에이전트가 거는 전화를 굴린다 (ADR-0001 §1). 두 갈래다: 계획이 어긋난 순간의 통보와,
   * **약속한 전화**("이따가 전화할게", ADR-0002). 접속 중이면 벨이 울리고, 그 시점이 이미
   * 지나갔으면 **부재중**이 된다 — 그때는 기록만 남고 무슨 얘기였는지는 잃는다.
   * @param from 지난 tick의 시각
   * @param t 지금
   */
  const pumpCalls = (from: number, t: number) => {
    const s = get();
    if (s.activeCall) return;
    const live = t - from < CATCHUP_GAP_MS;   // 그 순간에 앱을 보고 있었나
    const ring = (call: CallEvent, dueCalls = s.dueCalls) => {
      set({ calls: trimCalls([...s.calls, call], s.anchor.t), dueCalls, activeCall: live ? call : null });
      persist();
    };

    // ① 약속한 전화가 먼저다. 약속을 지키는 것이 이 기능의 전부다.
    const promised = s.dueCalls.find(d => d.at <= t);
    if (promised) {
      const rest = s.dueCalls.filter(d => d !== promised);
      const place = s.phase.kind === 'moving' || s.phase.kind === 'active' || s.phase.kind === 'comic' ? s.phase.act.place : null;
      const lines = promised.why === 'worry'
        ? worryLines(promised.worry ?? 'none', promised.id)
        : callLines(place?.type ?? 'home', promised.id);
      const base = { id: `in:${promised.id}`, at: promised.at, dir: 'in' as const, result: 'missed' as const, why: promised.why };
      ring(live ? { ...base, lines } : base, rest);   // 안 받았으면 내용도 없다
      return;
    }

    // ② 계획이 어긋난 순간의 통보
    const due = s.timeline.find(a =>
      a.outcome && a.outcome.plannedPlaceId !== a.place.id
      && a.arriveAt > from && a.arriveAt <= t
      && !s.calls.some(c => c.id === `in:${a.key}`));
    if (!due) return;
    const base = { id: `in:${due.key}`, at: due.arriveAt, dir: 'in' as const, result: 'missed' as const };
    ring(live ? { ...base, lines: callLines(due.place.type, due.key, due.outcome!.line) } : base);
  };

  /** 오늘 이 블록을 판단할 때 쓰는 맥락 — 블록 시작 시점의 상태로 본다 (sim/review.ts). */
  const reviewCtxOf = (s: WorldState, id: BlockId): ReviewCtx => {
    const dayStart = dayStartOfKey(s.today);
    const blockStart = blockStartAt(dayStart, id);
    return {
      dayKey: s.today, status: s.statusAt(blockStart), memory: s.memory, from: placeBefore(s, id),
      blockId: id, blockStart, blockEnd: blockEndAt(dayStart, id), timeline: s.timeline,
    };
  };

  /** Today's plans changed by hand → store, persist, re-resolve. */
  const setPlans = (plans: Plans) => {
    const s = get();
    set({ plans, days: { ...s.days, [s.today]: plans } });
    persist(); recompute(simNow(get().clock));
  };

  /** A block the user has not confirmed goes back to the agent (fresh suggestions on the next recompute). */
  const releaseAgentPicks = (s: WorldState, t: number): Plans => {
    const out = { ...s.plans };
    for (const id of BLOCK_ORDER) {
      const p = out[id];
      if (id === 'sleep' || p.chosenBy === 'user' || !isBlockEditable(t, id, s.today, s.timeline, s.anchor)) continue;
      out[id] = { ...p, category: null, options: [], chosenId: null, chosenBy: null, status: 'empty', verdict: undefined };
    }
    return out;
  };

  const st: WorldState = {
    clock, now, anchor: w.anchor, days: w.days, today, tz: initialPhase.tz, memory, agents: AGENTS, encounters, status: initialStatus, requests: w.requests, calls: w.calls, activeCall: null, negotiations: w.negotiations, onboarded,
    messages: w.messages, dueCalls: w.dueCalls, chatOpen: false, chatSeen: load<number>(CHAT_SEEN_KEY, now), say: null,
    plans: w.days[today], journeys: w.journeys, regen: w.regen, book,
    timeline: first.timeline,
    phase: initialPhase,
    summary,
    gap,
    selectedBlock: null,
    bookOpen: false,
    ttOpen: false,
    friendsOpen: false,

    tick: () => {
      const s = get();
      const t = simNow(s.clock);
      const from = lastTick;
      sync(t);
      // activities that ended since the previous tick — any day (a skipped comic window, a throttled tab, a long absence)
      const gap: ScheduledActivity[] = [];
      for (const a of get().timeline) if (a.endAt > from && a.endAt <= t) { comicFor(a); gap.push(a); }
      lastTick = t;
      save(SEEN_KEY, t);
      // 쪽지: 마감이 지난 건 "혼자 정했다"로 넘기고, 물어볼 게 있으면 하나 띄운다 (sim/requests.ts)
      pumpRequests(t);
      // 전화: 계획이 어긋난 순간 에이전트가 건다. 접속 중이면 울리고, 지나갔으면 부재중(내용 없음).
      pumpCalls(from, t);
      // 조율: 하루 한 건 생각이 나고, 허락을 받으면 왕복이 시간에 따라 진행된다 (sim/negotiate.ts)
      pumpNegotiations(t);
      save(SEEN_KEY, t);
      if (t - from >= CATCHUP_GAP_MS && gap.length) set({ summary: summaryOf(gap, comicFor), gap: { from, to: t } });
    },
    setCategory: (id, c) => {
      const s = get();
      const options = suggestOptions({ dateKey: s.today, blockId: id, category: c, memory: s.memory, from: placeBefore(s, id), regenSalt: s.regen[s.today]?.[id], usedPlaceIds: usedPlaceIds(s.plans, id), companions: companionCtx(s.memory, id, s.today, dayStartOfKey(s.today)) });
      // 주인이 다른 걸로 바꾸면 동행은 취소된다 (친구는 혼자 간다) — the block becomes the owner's again
      setPlans({ ...s.plans, [id]: { ...s.plans[id], category: c, options, chosenId: null, chosenBy: null, status: 'proposed', verdict: undefined } });
    },
    chooseOption: (id, optionId, by = 'user', stayDays) => {
      const s = get();
      const p = s.plans[id];
      const chosen = p.options.find(o => o.id === optionId);
      // 체류 칩: the nights live on the plan's copy of the option, so the title's "(n박)" is regenerated
      const options = chosen && stayDays !== undefined && chosen.stayDays !== stayDays
        ? p.options.map(o => (o.id === optionId ? withStayDays(o, stayDays) : o))
        : p.options;
      // 사용자의 선택은 확정이 아니라 제안이다 (SPEC 계획 수립과 확정) — 에이전트가 먼저 본다
      const picked = options.find(o => o.id === optionId);
      if (by === 'user' && picked) {
        const verdict = review(picked, reviewCtxOf(s, id), options);
        if (verdict) {
          setPlans({ ...s.plans, [id]: { ...p, options, verdict, status: verdict.kind === 'refuse' ? 'refused' : 'pushback' } });
          return;
        }
      }
      // 친구 제안 카드를 다시 고르면 동행이 되살아난다 (블록 시작 전까지)
      const chosenBy = by === 'user' && chosen?.proposedBy ? 'friend' : by;
      setPlans({ ...s.plans, [id]: { ...p, options, chosenId: optionId, chosenBy, status: 'confirmed', verdict: undefined } });
    },
    pushAnyway: (id) => {
      const s = get();
      const p = s.plans[id];
      const v = p.verdict;
      if (!v || v.kind !== 'pushback' || !isBlockEditable(s.now, id, s.today, s.timeline, s.anchor)) return;
      // 대가는 활동이 아니라 그 순간의 결정이므로 anchor에 바로 굽는다 (접기가 그 뒤를 이어 간다)
      const anchor: Anchor = { ...s.anchor, status: applyDelta(s.anchor.status ?? INITIAL_STATUS, PUSH_COST) };
      set({ anchor });
      setPlans({ ...s.plans, [id]: { ...p, chosenId: v.optionId, chosenBy: 'user', status: 'forced' } });
    },
    clearVerdict: (id) => {
      const s = get();
      const p = s.plans[id];
      if (!p.verdict) return;
      setPlans({ ...s.plans, [id]: { ...p, verdict: undefined, status: p.chosenId ? 'confirmed' : 'proposed' } });
    },
    regenerateOptions: (id) => {
      const s = get();
      const p = s.plans[id];
      if (!p.category) return;
      const salt = (s.regen[s.today]?.[id] ?? 0) + 1;
      const options = suggestOptions({ dateKey: s.today, blockId: id, category: p.category, memory: s.memory, from: placeBefore(s, id), regenSalt: salt, usedPlaceIds: usedPlaceIds(s.plans, id), companions: companionCtx(s.memory, id, s.today, dayStartOfKey(s.today)) });
      set({ regen: { ...s.regen, [s.today]: { ...s.regen[s.today], [id]: salt } } });
      setPlans({ ...s.plans, [id]: { ...p, options, chosenId: null, chosenBy: null, status: 'proposed', verdict: undefined } });
    },
    statusAt: (t) => { const s = get(); return foldStatus(s.anchor, s.timeline, t, s.memory); },
    answerRequest: (id, choiceId) => {
      const s = get();
      const requests = s.requests.map(r => (r.id === id ? { ...r, answered: choiceId, answeredAt: s.now } : r));
      set({ requests }); persist();
      // "내가 정할게" → 그 블록을 시간표에서 열어 준다 (요청이 곧 행동으로 이어진다)
      const r = requests.find(x => x.id === id);
      if (r?.kind === 'decide' && choiceId === 'mine' && r.refId) set({ selectedBlock: r.refId as BlockId, ttOpen: true });
      // 고민: 들은 걸 메모리에 적어 두면 다음 빈 블록의 범주가 그쪽으로 튼다 (decide 참고)
      if (r?.kind === 'worry') {
        const key = choiceId as WorryKey;
        const memory: Memory = { ...s.memory, worry: key === 'none' ? undefined : { key, at: s.now } };
        set({ memory }); save(MEMORY_KEY, memory);
        // 듣고 끝내지 않는다: 바로 한마디 하고, **전화를 약속한다** (ADR-0002).
        // 약속한 전화가 진짜로 오는 것이 "들었다"의 유일한 증거다.
        if (key !== 'none') {
          const line = reactToWorry(key, r.id);
          const msg: ChatMsg = { id: `w:${r.id}`, at: s.now, from: 'agent', text: line };
          set({
            messages: trimMessages([...get().messages, msg], s.anchor.t),
            dueCalls: trimDueCalls([...get().dueCalls, { id: `worry:${r.id}`, at: s.now + WORRY_CALL_MS, why: 'worry', worry: key }], s.anchor.t),
            say: { text: line, at: s.now },
          });
        }
        persist();
        recompute(simNow(get().clock));
      }
      // 허락: "물어봐"·"니가 알아서 해" → 조율이 열린다. "안 돼" → 거기서 끝.
      if (r?.kind === 'permission' && r.refId) {
        const n = get().negotiations[r.refId];
        if (n && n.state === 'asking-owner') {
          const state = choiceId === 'no' ? 'denied' : 'open';
          set({ negotiations: { ...get().negotiations, [r.refId]: { ...n, state, nextAt: get().now } } });
          persist();
        }
      }
    },
    callAgent: () => {
      const s = get();
      if (s.activeCall) return;
      const { ok, block } = pickupRule(s.phase);
      const id = `out:${Math.round(s.now)}`;
      const place = s.phase.kind === 'moving' || s.phase.kind === 'active' || s.phase.kind === 'comic' ? s.phase.act.place : null;
      const call: CallEvent = ok
        ? { id, at: s.now, dir: 'out', result: 'answered', startedAt: s.now, lines: callLines(place?.type ?? 'home', id) }
        : { id, at: s.now, dir: 'out', result: 'refused', block, text: lateText(block!, id) };
      set({ activeCall: call, calls: trimCalls([...s.calls, call], s.anchor.t) });
      persist();
    },
    answerCall: (accept) => {
      const s = get();
      const c = s.activeCall;
      if (!c || c.dir !== 'in') return;
      // 안 받으면 내용은 사라진다 (오너 결정): 기록만 남기고 lines를 버린다
      const done: CallEvent = accept ? { ...c, result: 'answered', startedAt: s.now } : { ...c, result: 'declined', lines: undefined };
      set({ activeCall: accept ? done : null, calls: s.calls.map(x => (x.id === c.id ? done : x)) });
      persist();
    },
    endCall: () => {
      const s = get();
      const c = s.activeCall;
      // 통화 시간은 붙은 순간부터 잰다 (sim 시간) — 부재중 통화의 `at`은 한참 전일 수 있다
      if (c?.result === 'answered' && c.startedAt !== undefined) {
        const done: CallEvent = { ...c, durSec: Math.max(1, Math.round((s.now - c.startedAt) / 1000)) };
        set({ activeCall: null, calls: s.calls.map(x => (x.id === c.id ? done : x)) });
        persist();
        return;
      }
      set({ activeCall: null });
    },
    sendMessage: (raw) => {
      const s = get();
      const text = raw.trim().slice(0, MAX_LEN);
      if (!text) return;
      const id = `m:${Math.round(s.now)}`;
      const reply = replyTo(text, { phase: s.phase, status: s.status, name: s.memory.name, seed: id });
      // 답장은 **도착할 시각을 달고** 지금 저장된다. 실은 `at <= now`만 그리므로 늦은 답장이 저절로 늦게 뜬다.
      const msgs: ChatMsg[] = [
        { id, at: s.now, from: 'me', text },
        { id: `${id}:r`, at: s.now + reply.delayMs, from: 'agent', text: reply.text },
      ];
      let dueCalls = s.dueCalls;
      let memory = s.memory;
      if (reply.worry) {
        memory = { ...s.memory, worry: { key: reply.worry, at: s.now } };
        save(MEMORY_KEY, memory);
        dueCalls = [...dueCalls, { id: `worry:${id}`, at: s.now + reply.delayMs + WORRY_CALL_MS, why: 'worry', worry: reply.worry }];
      }
      if (reply.callMe) dueCalls = [...dueCalls, { id: `ask:${id}`, at: s.now + reply.delayMs + ASK_CALL_MS, why: 'ask' }];
      set({ messages: trimMessages([...s.messages, ...msgs], s.anchor.t), dueCalls: trimDueCalls(dueCalls, s.anchor.t), memory, chatSeen: s.now });
      persist();
      if (reply.worry) recompute(simNow(get().clock));
    },
    setChatOpen: (open) => {
      const s = get();
      save(CHAT_SEEN_KEY, s.now);
      set({ chatOpen: open, chatSeen: s.now, say: open ? null : s.say });
    },
    dismissSay: () => set({ say: null }),
    markRequestTold: (id) => {
      const s = get();
      set({ requests: s.requests.map(r => (r.id === id ? { ...r, told: true } : r)) }); persist();
    },
    selectBlock: (id) => set({ selectedBlock: id }),
    dismissSummary: () => set({ summary: null, gap: null }),
    setBookOpen: (open) => set({ bookOpen: open }),
    setTtOpen: (open) => set({ ttOpen: open }),
    setFriendsOpen: (open) => set({ friendsOpen: open }),
    setJourney: (fromId, toId, j) => {
      const s = get();
      const journeys = { ...s.journeys, [journeyKey(fromId, toId)]: j };
      set({ journeys }); persist(); recompute(simNow(get().clock));
    },
    updateMemory: (patch) => {
      const s = get();
      const clean = (v: string[] | undefined, fb: string[]) => (v ? v.map(x => x.trim()).filter(Boolean) : fb);
      const memory: Memory = {
        ...s.memory,
        name: patch.name?.trim() || s.memory.name,
        likes: clean(patch.likes, s.memory.likes),
        dislikes: clean(patch.dislikes, s.memory.dislikes),
        traits: clean(patch.traits, s.memory.traits),
      };
      const t = simNow(s.clock);
      const plans = releaseAgentPicks(s, t);
      set({ memory, onboarded: true, plans, days: { ...s.days, [s.today]: plans } });
      save(MEMORY_KEY, memory); save(ONBOARD_KEY, true);
      persist(); recompute(t);
    },
    setScale: (scale) => { const c = withScale(get().clock, scale); saveClock(c); set({ clock: c }); const t = simNow(c); lastTick = t; sync(t); },
    jumpTo: (t) => { const c = jumpedTo(get().clock, t); saveClock(c); set({ clock: c }); lastTick = t; sync(t); },
    jumpBy: (ms) => get().jumpTo(simNow(get().clock) + ms),
    jumpToHour: (h, m = 0) => {
      const s = get();
      get().jumpTo(dayStartIn(simNow(s.clock), s.tz) + h * HOUR_MS + m * 60_000);
    },
    resetDay: () => {
      const s = get();
      const c = resetClock(); saveClock(c);
      remove(WORLD_KEY); remove(DAYS_KEY_V3); remove(SEEN_KEY);
      comicCache.clear();
      const t = simNow(c);
      const anchor = freshAnchor(t, s.memory);
      lastTick = t;
      set({ clock: c, anchor, days: {}, regen: {}, today: dayKeyIn(t, anchor.tz), tz: anchor.tz, plans: emptyPlans(), timeline: [], summary: null, gap: null, requests: [], calls: [], activeCall: null, negotiations: {}, selectedBlock: null, messages: [], dueCalls: [], chatOpen: false, say: null });
      recompute(t);
    },
  };
  return st;
});

/** Read the sim clock without subscribing (for rAF loops). */
export const getSimNow = () => simNow(useWorld.getState().clock);
/** Start of block `id` on the day containing `t` — in `tz` (default: the owner's zone, as before). */
export const blockStartsAt = (t: number, id: BlockId, tz: string = ownerTz) => blockStartAt(dayStartIn(t, tz), id);
export { estimateJourney };
