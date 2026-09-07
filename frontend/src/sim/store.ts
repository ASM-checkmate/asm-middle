import { create } from 'zustand';
import type { ActivityOption, Anchor, BlockId, BlockPlan, Category, Friend, Comic, DayKey, DaySummaryItem, Journey, LlmDayPlan, LlmPlans, Memory, Phase, ScheduledActivity, ShotWin, UserShot } from './types';
import { splitDayKey } from './types';
import type { WorryKey } from './types';
import { BLOCK_ORDER, CATEGORIES, blockEndAt, blockSlotIn, blockStartAt } from './blocks';
import { DAY_MS, HOUR_MS, compareDayKeys, dayEndOfKey, dayKeyIn, dayStartIn, dayStartOfKey, isValidTz, ownerTz } from './tz';
import { loadClock, saveClock, simNow, withScale, jumpedTo, resetClock, type ClockState } from './clock';
import { PLACES, cityKeyOfName, cityNameKo, hasPlace, placeById, registerCity, tzOf } from './places';
import { optionsFromCards, suggestOptions, withStayDays } from './suggest';
import { AGENTS, agentActivityAt, agentById, agentOfFriend, companionCtx, friendOf, type Agent } from './agents';
import { makeComic } from './comic';
import { shotsFor, trimShots } from './shots';
import { buildTimeline, currentDayKey, currentPlaceAt, emptyPlans, isBlockEditable, isBlockFree, phaseAt, returnDueAt, tzAt, type Days, type Encounters, type JourneyCache, type Plans } from './timeline';
import { estimateJourney, journeyKey } from './journey';
import { rng } from './rng';
import { INITIAL_STATUS, TIGHT_MONEY, applyDelta, foldStatus, validStatus, type Status } from './status';
import { PUSH_COST, cheapestFirst, fallbackOption, review, type ReviewCtx } from './review';
import { WORRY_CHOICES, expire, nextRequest, trimRequests, type AgentRequest } from './requests';
import { callLines, lateText, pickupRule, trimCalls, trimDueCalls, worryLines, type CallEvent, type DueCall } from './call';
import { narrate } from './narrate';
import { MAX_LEN, WORRY_CALL_MS, ASK_CALL_MS, openBatch, reactToWorry, replyToAll, tripFollowUp, trimMessages, type ChatMsg } from './chat';
import { fetchPlan, fetchSketchRead, fetchTripPlan, getTier, planRequestOf, requestOf, scheduleReply, setTier, sketchRequestOf, type LlmTier, type PlanBlockRequest, type PlanCategory, type ReplyResponse, type SketchReadResponse } from './llm';

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
export interface World { days: Days; anchor: Anchor; memory: Memory; journeys: JourneyCache; regen: Regen; encounters: Encounters; requests: AgentRequest[]; calls: CallEvent[]; messages: ChatMsg[]; dueCalls: DueCall[]; shots: UserShot[]; llmPlans: LlmPlans }
/** v5 그대로 — `shots`(ADR-0004)는 optional 필드라 옛 저장본은 빈 배열로 읽는다 (버전을 올리지 않는다). */
interface Persisted { v: 5; days: Days; anchor: Anchor; journeys: JourneyCache; regen: Regen; encounters: Encounters; requests: AgentRequest[]; calls: CallEvent[]; messages: ChatMsg[]; dueCalls: DueCall[]; shots: UserShot[]; /** ADR-0010 — 옛 저장본엔 없다 */ llmPlans?: LlmPlans }

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
  focus: 'rest',     // 집중이 안 되면 머리를 비운다
  blue: 'rest',      // 그냥 안 좋은 날은 조용히 있는다
  bored: 'play',
  none: null,
};
/** 저장된 고민 키 검증 — 옛 키('sleep'/'stuck', ADR-0004 오너 결정 12)는 로드 때 걸러 낸다 */
const WORRY_KEYS: ReadonlySet<string> = new Set(Object.keys(WORRY_CATEGORY));
const isWorryKey = (k: unknown): k is WorryKey => typeof k === 'string' && WORRY_KEYS.has(k);
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
    worry: m.worry && isWorryKey(m.worry.key) && Number.isFinite(m.worry.at) ? m.worry : undefined,
    wish: m.wish && typeof m.wish.city === 'string' && Number.isFinite(m.wish.at) ? m.wish : undefined,
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
    // 그림(ADR-0004)은 PNG dataURL 문자열이어야 한다 — 아니면 지운다. 그림으로 정한 상태인데 그림이 없으면(잘못된 값이든 키 자체가
    // 없든) 카드 상태로 되돌린다: sketched ⇒ sketch 존재가 불변식이다 (CONTRACT — 시간표의 그림 카드가 그 src를 그린다)
    for (const p of Object.values(plans)) {
      if (p.sketch !== undefined && !isSketch(p.sketch)) delete p.sketch;
      if (p.status === 'sketched' && p.sketch === undefined) p.status = p.options.length ? 'proposed' : 'empty';
      // 그림 읽기 결과(ADR-0007)는 모양이 맞을 때만 — 그림이 없으면 같이 지운다
      const sr = p.sketchRead as unknown;
      if (sr !== undefined && (p.sketch === undefined || !sr || typeof sr !== 'object' || typeof (sr as { seen?: unknown }).seen !== 'string' || !((sr as { optionId?: unknown }).optionId === null || typeof (sr as { optionId?: unknown }).optionId === 'string'))) delete p.sketchRead;
      else if (p.sketchRead && p.sketchRead.category !== null && !CATEGORIES.some(c => c.id === p.sketchRead?.category)) p.sketchRead = { ...p.sketchRead, category: null };
    }
    out[k] = plans;
  }
  return out;
};
/** 캔버스가 만든 dataURL만 받는다 (SketchOverlay: `canvas.toDataURL('image/png')`). */
const isSketch = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image/');
const isWin = (v: unknown): v is ShotWin => v === 0 || v === 1 || v === 2 || v === 3;
/** 저장된 샷 검증 — 모양이 어긋난 항목은 버린다 (사용자 컷은 만화에 그대로 들어가므로 숫자여야 한다). */
const validShots = (raw: unknown): UserShot[] => {
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<UserShot>[]).filter((x): x is UserShot => {
    const c = x?.crop;
    return !!x && typeof x.actKey === 'string' && isWin(x.win) && Number.isFinite(x.at)
      && !!c && Number.isFinite(c.scale) && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.rot)
      && (c.pitch === undefined || Number.isFinite(c.pitch)) && (c.light === undefined || Number.isFinite(c.light)) && (c.dof === undefined || Number.isFinite(c.dof)) && (c.focus === undefined || c.focus === 'near' || c.focus === 'far');
  });
};
const persistedOf = (w: World): Persisted => ({ v: 5, days: w.days, anchor: w.anchor, journeys: w.journeys, regen: w.regen, encounters: w.encounters, requests: w.requests, calls: w.calls, messages: w.messages, dueCalls: w.dueCalls, shots: w.shots, llmPlans: w.llmPlans });
const horizonFor = (t: number) => t + HORIZON_MS;
const build = (w: World, t: number) => buildTimeline(w.anchor, w.days, w.memory, w.journeys, horizonFor(t), w.encounters);

/** Places already chosen (or proposed) in the other blocks today, so suggestions vary across the day. */
/** 저장된 하루 계획을 검증한다 — 장소가 사라졌으면(찾아 온 도시를 잊음) 그 블록은 버린다. */
const validLlmPlans = (v: unknown): LlmPlans => {
  const out: LlmPlans = {};
  if (!v || typeof v !== 'object') return out;
  for (const [dayKey, day] of Object.entries(v as Record<string, unknown>)) {
    if (!day || typeof day !== 'object') continue;
    const clean: LlmDayPlan = {};
    for (const [id, b] of Object.entries(day as Record<string, { category?: unknown; options?: unknown; at?: unknown }>)) {
      if (!BLOCK_ORDER.includes(id as BlockId) || !b || !CATEGORIES.some(c => c.id === b.category) || !Array.isArray(b.options)) continue;
      const options = (b.options as ActivityOption[]).filter(o => o && typeof o.id === 'string' && typeof o.placeId === 'string' && hasPlace(o.placeId));
      if (options.length) clean[id as BlockId] = { category: b.category as Category, options, at: typeof b.at === 'number' ? b.at : 0 };
    }
    if (Object.keys(clean).length) out[dayKey] = clean;
  }
  return out;
};

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
      // 블록 시작 시점의 상태 — 범주와 옵션을 고르는 근거 (sim/review.ts와 같은 문)
      const status = foldStatus(w.anchor, timeline, start, w.memory);
      // 돈이 빠듯하면 묻지 않는다 (오너 결정 2026-09-08): 밥 시간이 아니면 열에 일곱은 일하러 가고, 아니면 싼 데로 간다.
      // r.next()는 빠듯할 때만 소비한다 — 넉넉한 날의 시드 순서(범주 뽑기)는 그대로다
      const tight = status.money < TIGHT_MONEY;
      const earn = tight && !p.category && !MEAL_BLOCKS.has(id) && !hotel && r.next() < 0.7;
      // 모델이 미리 지어 둔 계획 (ADR-0010) — 빈 블록에서만, 그리고 밥·숙소·돈·고민 같은 규칙이 먼저다. 없으면 시드로
      const llm = !p.category && !p.options.length ? w.llmPlans[dayKey]?.[id] : undefined;
      if (!p.category) p.category = MEAL_BLOCKS.has(id)
        ? 'meal'                                                           // 아침·점심·저녁은 밥 시간 (식당/브런치/카페는 취향대로 제안됨)
        : hotel ? 'rest'
          : earn ? 'work'
            : worry ?? llm?.category ?? r.pick(CATEGORIES.filter(c => c.id !== 'travel' && c.id !== 'meal')).id;
      if (!p.options.length) p.options = llm && llm.category === p.category && llm.options.every(o => hasPlace(o.placeId)) ? llm.options : suggestOptions(ctx(p.category));
      if (p.category === 'meal') p.options = rankMealOptions(p.options, w.memory);
      if (hotel && p.category === 'rest') p.options = [...p.options.filter(o => o.placeId === hotel.id), ...p.options.filter(o => o.placeId !== hotel.id)];
      // 에이전트의 자기 선택도 사용자의 확정과 **같은 문**을 지난다 (sim/review.ts):
      // 돈이 없으면 비싼 걸 안 고르고, 지쳤으면 운동을 안 고른다. 셋 다 막히면 집에서 쉰다.
      const rctx: ReviewCtx = { dayKey, status, memory: w.memory, from, blockId: id, blockStart: start, blockEnd: blockEndAt(dayStart, id) };
      // 빠듯하면 통과하는 것 중 가장 싼(일이면 가장 많이 버는) 것부터 — 밥도 집밥이 먼저 온다
      let order = tight ? cheapestFirst(p.options, rctx) : p.options;
      // 그림(ADR-0007·0008): 알아봤으면 그 카드가 먼저다 — 단 같은 문(돈·피로)은 지나야 한다. 골라 둔 범주와 그림이
      // 많이 다르면 범주도 그림도 놓고 내가 하고 싶은 거로 간다 (오너 결정 2026-09-07). 판정은 출발 줄에만 남는다
      let seenPick: ActivityOption | undefined;
      if (p0.status === 'sketched' && p0.sketch) {
        const sr = p0.sketchRead;
        const seen = sr?.optionId ? p.options.find(o => o.id === sr.optionId) : undefined;
        if (!sr || (!sr.optionId && !sr.category)) p.sketchVerdict = { kind: 'unread', seen: sr?.seen ?? '' };
        else if (seen && !review(seen, rctx)) { seenPick = seen; p.sketchVerdict = { kind: 'seen', seen: sr.seen }; }
        else if (seen) p.sketchVerdict = { kind: 'blocked', seen: sr.seen };
        else if (sr.category && p.category && sr.category !== p.category && sr.category !== 'travel') {
          const mine = r.pick(CATEGORIES.filter(c => c.id !== 'travel' && c.id !== 'meal' && c.id !== p.category && c.id !== sr.category)).id;
          p.sketchVerdict = { kind: 'clash', seen: sr.seen, askedCategory: p.category };
          p.category = mine;
          p.options = suggestOptions(ctx(mine));
          order = tight ? cheapestFirst(p.options, rctx) : p.options;
        }
        else p.sketchVerdict = { kind: 'near', seen: sr.seen };
      }
      const ok = seenPick ?? order.find(o => !review(o, rctx));
      if (ok) p.chosenId = ok.id;
      else {
        const fb = fallbackOption(id, w.memory);
        p.options = [...p.options, fb];
        p.chosenId = fb.id;
      }
      p.chosenBy = 'agent';
      p.status = 'confirmed';
      p.frugal = tight ? (p.category === 'work' ? 'earn' : 'cheap') : undefined;
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
  const days = { ...w.days }, regen = { ...w.regen }, llmPlans = { ...w.llmPlans };
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
    delete days[k]; delete regen[k]; delete llmPlans[k];
  }
  if (anchor.t < cutoff) anchor = { ...anchor, t: cutoff };   // nothing is planned in between (those days are gone)
  return { ...w, anchor, days, regen, llmPlans };
}

/**
 * The comic of a finished activity: reuse the book's copy, else write it, remember the visit and — when the talk
 * roll succeeded — the new friend (FRIENDS_SPEC §4: 활동이 끝나면 friends에 추가). The encounter log counts every
 * 마주침, talked or not, so running into the same agent again is likelier to end in a hello. Pure.
 */
function settle(a: ScheduledActivity, book: Comic[], memory: Memory, encounters: Encounters, shots: UserShot[] = []): { comic: Comic; book: Comic[]; memory: Memory; encounters: Encounters } {
  const existing = book.find(b => b.id === `c:${a.key}`);
  if (existing) return { comic: existing, book, memory, encounters };
  // 사용자가 찍은 창은 그대로, 나머지는 에이전트가 채운다 (ADR-0004) — 만화는 여기서 한 번 만들어져 앨범에 고정된다
  const comic = makeComic(a, memory, shotsFor(shots, a.key));
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
  /** LLM 단계 (sim/llm.ts). off면 규칙 기반 답장만. */
  llmTier: LlmTier;
  /** 지금 웹에서 찾고 있는 여행지 (ADR-0009). 없으면 null. 한 번에 하나만. */
  tripBusy: string | null;
  /** 모델이 미리 지어 둔 하루 계획 (ADR-0010). `days`와 같은 키. */
  llmPlans: LlmPlans;
  /** 하루 계획을 백엔드에 묻는 중 */
  planBusy: boolean;
  /** 대화 실을 마지막으로 본 시각 — 안 읽은 줄 배지가 이걸 쓴다 */
  chatSeen: number;
  /** 혼잣말 한 줄 (ADR-0001 §1의 1단계). 대가 없이 지나가고, 잠깐 떴다 사라진다. */
  say: { text: string; at: number } | null;
  /** 사용자가 찍은 컷들 (ADR-0004 오너 결정 7). 추가전용, 같은 활동·창은 뒤가 이긴다. 활동이 끝나면 만화에 박힌다. */
  shots: UserShot[];
  /** 그림 캔버스 오버레이가 열린 블록 (없으면 null) */
  sketchOpen: BlockId | null;
  /** 카메라 오버레이가 열려 있나 */
  cameraOpen: boolean;
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
  /**
   * 말로 하는 통화가 붙었다 (ADR-0011): 규칙 대사를 비우고 `voice`를 켠다. 그 뒤 오간 말은 `appendCallLine`으로 쌓인다.
   * 세션이 못 붙으면 부르지 않는다 — 규칙 대사가 그대로 뜬다.
   */
  beginVoiceCall: () => void;
  /** 통화 중 오간 한 줄. 내 말은 "나: "를 앞에 붙여 같은 `lines`에 쌓는다 (대화 실이 그대로 펼친다). */
  appendCallLine: (from: 'me' | 'agent', text: string) => void;
  /** 통화 화면을 닫는다 (기록은 남는다 — 받았던 통화라면 통화 시간까지). */
  endCall: () => void;
  /** 대화창에서 한 마디 보낸다. 답장은 상황에 따라 바로 오거나 한참 뒤에 온다 (sim/chat.ts). */
  sendMessage: (text: string) => void;
  /** 대화창을 연다 / 닫는다. 열거나 닫을 때 "여기까지 봤다"를 찍는다. */
  setChatOpen: (open: boolean) => void;
  /** LLM 단계를 고른다 (개발 패널). */
  setLlmTier: (t: LlmTier) => void;
  /**
   * 백엔드가 지은 답장을 묶음에 끼운다. 묶음에 그 사이 말이 더 붙었거나(`seq`가 다름) 규칙 답장이 이미
   * 화면에 떴으면 버린다 — 본 적 없는 답장만 바꾼다 (ADR-0006).
   */
  applyLlmReply: (batch: string, seq: number, r: ReplyResponse) => void;
  /**
   * "교토 가자"에 답한다 (ADR-0009). 아는 도시면 소원만 적고, 모르는 도시면 백엔드에 웹에서 찾아 달라고 해서
   * 도시 팩을 등록한다. 어느 쪽이든 끝나면 에이전트가 한 줄 덧붙인다. tier가 off거나 이미 찾는 중이면 아무것도 안 한다.
   *
   * @param city 도시 이름 (한국어)
   * @param batch 그 말이 속한 묶음 id — 후속 줄 id(`${batch}:trip`)와 시드에 쓴다
   */
  planTrip: (city: string, batch: string) => Promise<void>;
  /**
   * 오늘의 빈 블록들을 백엔드 모델에게 미리 짓게 한다 (ADR-0010). 결과는 `llmPlans[today]`에 저장되고, 블록이 시작할 때
   * `decide()`가 규칙 카드 대신 쓴다. tier가 off거나 이미 묻는 중이거나 빈 블록이 없으면 아무것도 안 한다.
   */
  planDay: () => Promise<void>;
  /**
   * 물어본 카드가 도착했다. 그 블록이 아직 같은 범주로 비어 있으면(사용자가 안 바꿨고 시작 안 했으면) 채운다.
   * 모델 카드가 없으면(실패·늦음) 규칙 카드로 채운다.
   */
  applyPlanCards: (dayKey: DayKey, id: BlockId, category: Category, cards: ActivityOption[]) => void;
  /** 혼잣말을 지운다 (뜬 지 몇 초 뒤 화면이 부른다). */
  dismissSay: () => void;

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
  /**
   * 그림으로 정한다 (ADR-0004 오너 결정 5): 카드 대신 그림을 넘기면 예고도 판정도 없이 블록 시작 때 에이전트가
   * 범주 안에서 고른다. isBlockEditable 가드. chosenBy는 null이어야 decide()가 시작 때 골라 준다.
   */
  sketchBlock: (id: BlockId, dataUrl: string) => void;
  /** 백엔드가 읽은 그림의 뜻을 그 계획에 적는다 (ADR-0007). 그림이 그 사이 바뀌었으면 버린다. */
  applySketchRead: (dayKey: DayKey, id: BlockId, dataUrl: string, r: SketchReadResponse) => void;
  /** '카드로 고를래' — 그림을 지우고 카드 상태로 돌아온다 (옵션이 있으면 제안, 없으면 빈 칸). */
  unsketchBlock: (id: BlockId) => void;
  setSketchOpen: (id: BlockId | null) => void;
  setCameraOpen: (open: boolean) => void;
  /** 한 장 찍는다. 같은 actKey+win은 교체(뒤가 이김). 활동 종료 전(now < endAt)에만 — 만화는 endAt에 한 번 만들어진다. */
  addShot: (shot: UserShot) => void;
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
const worldOf = (s: WorldState): World => ({ days: s.days, anchor: s.anchor, memory: s.memory, journeys: s.journeys, regen: s.regen, encounters: s.encounters, requests: s.requests, calls: s.calls, messages: s.messages, dueCalls: s.dueCalls, shots: s.shots, llmPlans: s.llmPlans });
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
  let shots: UserShot[] = validShots(persisted0?.shots);   // 옛 저장본엔 없다 (ADR-0004) → 빈 배열
  const book0 = book, memory0 = memory;
  const settleLocal = (a: ScheduledActivity): Comic => {
    const r = settle(a, book, memory, encounters, shots);
    book = r.book; memory = r.memory; encounters = r.encounters; comicCache.set(a.key, r.comic);
    return r.comic;
  };

  // ── catch-up: the gap since the last visit is computed once, here. Days too old are folded into the anchor,
  //    the days lived since are decided by the agent (in the zones it passed through), their comics land in the
  //    book, and everything that ended after `lastSeen` becomes the "자는 동안 이런 일이" sheet. ──
  const persisted = persisted0;
  // 옛 저장본 정리 (ADR-0004): 조율 시절의 허락 쪽지와 결말 줄(`nego:`)은 버리고, 옛 고민 키('sleep'/'stuck')는
  // 메모리·약속한 전화·아직 답 안 한 고민 쪽지의 칩에서 걷어 낸다 (칩은 지금 여덟 가지로 갈아 끼운다)
  const requests0 = (Array.isArray(persisted?.requests) ? persisted.requests : [])
    .filter(r => !['permission', 'money', 'decide'].includes((r as { kind: string }).kind))   // 옛 저장본의 허락·돈·일정 쪽지는 버린다
    .map(r => (r.kind === 'worry' && !r.answered && !r.decidedAlone ? { ...r, choices: WORRY_CHOICES } : r));
  const messages0 = (Array.isArray(persisted?.messages) ? persisted.messages : []).filter(m => !m.id.startsWith('nego:'));
  const dueCalls0 = (Array.isArray(persisted?.dueCalls) ? persisted.dueCalls : []).map(d => (d.worry !== undefined && !isWorryKey(d.worry) ? { ...d, worry: undefined } : d));
  let w: World = { days: validDays(persisted?.days), anchor: validAnchor(persisted?.anchor, now, memory), memory, journeys: persisted?.journeys ?? {}, regen: persisted?.regen ?? {}, encounters, requests: requests0, calls: Array.isArray(persisted?.calls) ? persisted.calls : [], messages: messages0, dueCalls: dueCalls0, shots, llmPlans: validLlmPlans(persisted?.llmPlans) };
  const gapActs: ScheduledActivity[] = [];
  const remember = (a: ScheduledActivity) => { settleLocal(a); if (a.endAt > lastSeen && a.endAt <= now) gapActs.push(a); };
  w = prune(w, now, remember);
  shots = trimShots(shots, w.anchor.t);   // anchor 뒤로 접힌 활동의 샷은 만화가 이미 앨범에 있다
  w = { ...w, memory, encounters, shots, days: liveOut({ ...w, memory, encounters, shots }, now) };
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
      const r = settle(a, s.book, s.memory, s.encounters, s.shots);
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
      w = prune(w, t, a => { const r = settle(a, book, memory, encounters, s.shots); book = r.book; memory = r.memory; encounters = r.encounters; comicCache.set(a.key, r.comic); });
      const shots = trimShots(s.shots, w.anchor.t);
      w = { ...w, memory, encounters, shots, days: liveOut({ ...w, memory, encounters, shots }, t) };
      const today = currentDayKey(t, build(w, t), w.anchor.tz);
      if (book !== s.book) save(BOOK_KEY, book);
      if (memory !== s.memory) save(MEMORY_KEY, memory);
      set({ days: w.days, anchor: w.anchor, regen: w.regen, llmPlans: w.llmPlans, book, memory, encounters, shots, today, selectedBlock: null });
      persist();
      recompute(t);
      void get().planDay();   // 새 하루 — 모델이 빈 블록들을 미리 짓는다 (ADR-0010)
      return;
    }
    recompute(t);
  };

  /**
   * 마감이 지난 쪽지를 "에이전트가 혼자 정했다"로 넘기고, 물어볼 게 있으면 하나 만든다.
   * 상한은 없다 (ADR-0004 오너 결정 10) — 대기 중인 쪽지는 오래된 것부터 하나씩 카드로 뜨고, 같은 것은 id로 한 번만 만든다.
   */
  const pumpRequests = (t: number) => {
    const s = get();
    let requests = expire(s.requests, t);
    const made = nextRequest(requests, { now: t, today: s.today, tz: s.tz, memory: s.memory, status: s.status, timeline: s.timeline });
    if (made) requests = [...requests, made];
    if (requests !== s.requests) { set({ requests: trimRequests(requests, s.anchor.t) }); persist(); }
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

    // ② 계획이 어긋난 순간의 통보 — 같은 통보를 두 번 걸지 않는 id 중복 방지일 뿐, 활동당 1회 '제한'이 아니다
    //    (도착 창 조건 `from < arriveAt ≤ t`가 있어 실질 제한은 이미 없다 — ADR-0004 결정 10은 쪽지 상한을 지운 것)
    const due = s.timeline.find(a =>
      a.outcome && a.outcome.plannedPlaceId !== a.place.id
      && a.arriveAt > from && a.arriveAt <= t
      && !s.calls.some(c => c.id === `in:${a.key}`));
    if (!due) return;
    const base = { id: `in:${due.key}`, at: due.arriveAt, dir: 'in' as const, result: 'missed' as const };
    ring(live ? { ...base, lines: callLines(due.place.type, due.key, due.outcome!.line) } : base);
  };

  /**
   * 도착 혼잣말 (ADR-0004 오너 결정 6: 도착 알림은 만들지 않고, 앱을 보고 있을 때 도착 순간 한마디).
   * 이동 중이던 활동이 그대로 활동 중으로 넘어간 순간, 혼자이고(동행·말 튼 마주침 없음) 계획대로 도착했으면
   * 감정 한 줄만 띄운다 — 사진을 찍어 달라는 부탁은 하지 않고, 문자로도 남기지 않는다 (오너 결정 2026-09-07:
   * 문자는 마음이 오갈 때만, 일을 시킬 때가 아니다). 혼잣말이라 몇 초 뒤 사라진다.
   * 마찰로 딴 데 간 도착은 통보 전화(pumpCalls)가 대신하므로 건너뛴다.
   * @param before 지난 tick의 phase
   * @param after 지금 phase
   * @param from 지난 tick의 시각
   * @param t 지금
   */
  const arriveSay = (before: Phase, after: Phase, from: number, t: number) => {
    if (before.kind !== 'moving' || after.kind !== 'active' || before.act.key !== after.act.key) return;
    if (t - from >= CATCHUP_GAP_MS) return;                                                    // 안 보고 있었으면 말하지 않는다
    if (after.companions.length || after.encounter?.talked || after.act.outcome) return;   // 혼자가 아니거나 계획대로가 아니다
    const s = get();
    const text = narrate({ t: 'arrive-say' }, { name: s.memory.name, seed: `arrive:${after.act.key}` });
    set({ say: { text, at: t } });
  };

  /** 오늘 이 블록을 판단할 때 쓰는 맥락 — 블록 시작 시점의 상태로 본다 (sim/review.ts). */
  const reviewCtxOf = (s: WorldState, id: BlockId): ReviewCtx => {
    const dayStart = dayStartOfKey(s.today);
    const blockStart = blockStartAt(dayStart, id);
    return {
      dayKey: s.today, status: s.statusAt(blockStart), memory: s.memory, from: placeBefore(s, id),
      blockId: id, blockStart, blockEnd: blockEndAt(dayStart, id),
    };
  };

  /** Today's plans changed by hand → store, persist, re-resolve. */
  const setPlans = (plans: Plans) => {
    const s = get();
    set({ plans, days: { ...s.days, [s.today]: plans } });
    persist(); recompute(simNow(get().clock));
  };

  /** A block the user has not confirmed goes back to the agent (fresh suggestions on the next recompute).
   *  그림으로 정한 블록은 사용자의 결정이다 (ADR-0004) — 건드리지 않는다. */
  const releaseAgentPicks = (s: WorldState, t: number): Plans => {
    const out = { ...s.plans };
    for (const id of BLOCK_ORDER) {
      const p = out[id];
      if (id === 'sleep' || p.chosenBy === 'user' || p.status === 'sketched' || !isBlockEditable(t, id, s.today, s.timeline, s.anchor)) continue;
      out[id] = { ...p, category: null, options: [], chosenId: null, chosenBy: null, status: 'empty', verdict: undefined };
    }
    return out;
  };

  /** 진행 중인 하루 계획 요청 — 통화가 붙으면 끊는다 (Ollama는 한 번에 하나라, 20~60초짜리 계획이 통화 첫마디 앞을 막는다) */
  let planCtl: AbortController | null = null;
  /** 블록 하나·범주 하나의 카드를 백엔드에 묻는다 (ADR-0010). 늦거나 실패하면 규칙 카드로 채운다 — 같은 자리를 두 번 채우지 않는다. */
  const CARDS_WAIT_MS = 15_000;
  const askCards = (id: BlockId, category: PlanCategory, previous?: string[]) => {
    const s = get();
    if (s.llmTier === 'off') return;
    const dayKey = s.today;
    const from = placeBefore(s, id);
    const req = planRequestOf([{ id, category, from: from.name, avoid: usedPlaceIds(s.plans, id), ...(previous?.length ? { previous } : {}) }], { memory: s.memory, status: s.status, now: s.now, tz: s.tz, dateKey: splitDayKey(dayKey).dateKey }, s.llmTier, from.city);
    void fetchPlan(req, CARDS_WAIT_MS).then(r => {
      const b = r?.blocks.find(x => x.id === id);
      const cards = b && b.category === category ? optionsFromCards(b.options, category, splitDayKey(dayKey).dateKey, id) : [];
      get().applyPlanCards(dayKey, id, category, cards);
    });
  };

  const st: WorldState = {
    clock, now, anchor: w.anchor, days: w.days, today, tz: initialPhase.tz, memory, agents: AGENTS, encounters, status: initialStatus, requests: w.requests, calls: w.calls, activeCall: null, onboarded,
    messages: w.messages, dueCalls: w.dueCalls, chatOpen: false, chatSeen: load<number>(CHAT_SEEN_KEY, now), llmTier: getTier(), tripBusy: null, llmPlans: w.llmPlans, planBusy: false, say: null,
    shots: w.shots, sketchOpen: null, cameraOpen: false,
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
      // 도착 혼잣말: 보고 있을 때 이동→활동으로 넘어간 순간 한마디 (ADR-0004 오너 결정 6)
      arriveSay(s.phase, get().phase, from, t);
      // 쪽지: 마감이 지난 건 "혼자 정했다"로 넘기고, 물어볼 게 있으면 하나 만든다 — 상한 없이, 오래된 것부터 카드로 (sim/requests.ts)
      pumpRequests(t);
      // 전화: 계획이 어긋난 순간 에이전트가 건다. 접속 중이면 울리고, 지나갔으면 부재중(내용 없음).
      pumpCalls(from, t);
      save(SEEN_KEY, t);
      if (t - from >= CATCHUP_GAP_MS && gap.length) set({ summary: summaryOf(gap, comicFor), gap: { from, to: t } });
    },
    setCategory: (id, c) => {
      const s = get();
      // 모델이 켜져 있고 모델이 지을 수 있는 범주면 카드를 비워 두고 묻는다 ("제안을 준비하는 중…"). 아니면 지금처럼 규칙 카드
      const ask = s.llmTier !== 'off' && c !== 'travel' && c !== 'sleep';
      const options = ask ? [] : suggestOptions({ dateKey: s.today, blockId: id, category: c, memory: s.memory, from: placeBefore(s, id), regenSalt: s.regen[s.today]?.[id], usedPlaceIds: usedPlaceIds(s.plans, id), companions: companionCtx(s.memory, id, s.today, dayStartOfKey(s.today)) });
      // 주인이 다른 걸로 바꾸면 동행은 취소된다 (친구는 혼자 간다) — the block becomes the owner's again. 그림도 지운다 (카드 경로로 복귀)
      setPlans({ ...s.plans, [id]: { ...s.plans[id], category: c, options, chosenId: null, chosenBy: null, status: 'proposed', verdict: undefined, sketch: undefined, sketchRead: undefined, sketchVerdict: undefined } });
      if (ask) askCards(id, c as PlanCategory);
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
          setPlans({ ...s.plans, [id]: { ...p, options, verdict, status: verdict.kind === 'refuse' ? 'refused' : 'pushback', sketch: undefined, sketchRead: undefined, sketchVerdict: undefined } });
          return;
        }
      }
      // 친구 제안 카드를 다시 고르면 동행이 되살아난다 (블록 시작 전까지). 카드를 고르면 그림은 지운다 (ADR-0004)
      const chosenBy = by === 'user' && chosen?.proposedBy ? 'friend' : by;
      setPlans({ ...s.plans, [id]: { ...p, options, chosenId: optionId, chosenBy, status: 'confirmed', verdict: undefined, sketch: undefined, sketchRead: undefined, sketchVerdict: undefined } });
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
      const ask = s.llmTier !== 'off' && p.category !== 'travel' && p.category !== 'sleep';
      const options = ask ? [] : suggestOptions({ dateKey: s.today, blockId: id, category: p.category, memory: s.memory, from: placeBefore(s, id), regenSalt: salt, usedPlaceIds: usedPlaceIds(s.plans, id), companions: companionCtx(s.memory, id, s.today, dayStartOfKey(s.today)) });
      set({ regen: { ...s.regen, [s.today]: { ...s.regen[s.today], [id]: salt } } });
      setPlans({ ...s.plans, [id]: { ...p, options, chosenId: null, chosenBy: null, status: 'proposed', verdict: undefined, sketch: undefined, sketchRead: undefined, sketchVerdict: undefined } });
      // "다른 제안 보기": 방금 보여 준 제목들을 넘겨 다른 걸 받는다
      if (ask) askCards(id, p.category as PlanCategory, p.options.map(o => o.title));
    },
    sketchBlock: (id, dataUrl) => {
      const s = get();
      const p = s.plans[id];
      // 범주가 있어야 "범주 안에서 고른다"가 성립한다 (SketchOverlay는 카드 분기에서만 열린다). chosenBy는 null — 'user'면 decide()가 영원히 건너뛴다
      if (!p.category || !isSketch(dataUrl) || !isBlockEditable(s.now, id, s.today, s.timeline, s.anchor)) return;
      setPlans({ ...s.plans, [id]: { ...p, sketch: dataUrl, chosenId: null, chosenBy: null, status: 'sketched', verdict: undefined, sketchRead: undefined, sketchVerdict: undefined } });
      // 비전 모델이 켜져 있으면 지금 미리 읽어 둔다 (ADR-0007) — 블록 시작은 동기라 그때는 못 기다린다. 결과는 사용자에게 안 보인다
      if (s.llmTier !== 'off' && p.options.length) {
        const dayKey = s.today;
        void fetchSketchRead(sketchRequestOf(dataUrl, p.category, p.options, s.llmTier)).then(r => { if (r) get().applySketchRead(dayKey, id, dataUrl, r); });
      }
    },
    applySketchRead: (dayKey, id, dataUrl, r) => {
      const s = get();
      const plans = s.days[dayKey];
      const p = plans?.[id];
      // 그 사이 그림이 바뀌었거나 카드로 돌아갔거나 이미 시작해 골랐으면 버린다
      if (!p || p.status !== 'sketched' || p.sketch !== dataUrl) return;
      const optionId = r.optionId && p.options.some(o => o.id === r.optionId) ? r.optionId : null;
      const category = r.category && CATEGORIES.some(c => c.id === r.category) ? r.category : null;
      const next = { ...plans, [id]: { ...p, sketchRead: { optionId, seen: r.seen.slice(0, 12), category } } };
      const days = { ...s.days, [dayKey]: next };
      set(dayKey === s.today ? { days, plans: next } : { days });
      persist();
    },
    unsketchBlock: (id) => {
      const s = get();
      const p = s.plans[id];
      if (p.status !== 'sketched') return;
      setPlans({ ...s.plans, [id]: { ...p, sketch: undefined, status: p.options.length ? 'proposed' : 'empty' } });
    },
    setSketchOpen: (id) => set({ sketchOpen: id }),
    setCameraOpen: (open) => set({ cameraOpen: open }),
    addShot: (shot) => {
      const s = get();
      const act = s.timeline.find(a => a.key === shot.actKey);
      // 만화는 endAt에 한 번 만들어져 앨범에 고정된다 (settle) — 그 뒤의 샷은 반영될 곳이 없다
      if (!act || s.now >= act.endAt || !isWin(shot.win)) return;
      const rest = s.shots.filter(x => !(x.actKey === shot.actKey && x.win === shot.win));   // 재촬영: 뒤가 이긴다
      set({ shots: trimShots([...rest, shot], s.anchor.t) });
      persist();
    },
    statusAt: (t) => { const s = get(); return foldStatus(s.anchor, s.timeline, t, s.memory); },
    answerRequest: (id, choiceId) => {
      const s = get();
      const requests = s.requests.map(r => (r.id === id ? { ...r, answered: choiceId, answeredAt: s.now } : r));
      set({ requests }); persist();
      const r = requests.find(x => x.id === id);
      // 고민: 들은 걸 메모리에 적어 두면 다음 빈 블록의 범주가 그쪽으로 튼다
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
      // 안 받으면 내용은 사라진다 (오너 결정): 기록만 남기고 lines를 버린다. 안 받기를 눌렀든 12초가 지났든 똑같이 부재중이다 (ADR-0004 오너 결정 13)
      const done: CallEvent = accept ? { ...c, result: 'answered', startedAt: s.now } : { ...c, result: 'missed', lines: undefined };
      set({ activeCall: accept ? done : null, calls: s.calls.map(x => (x.id === c.id ? done : x)) });
      persist();
    },
    beginVoiceCall: () => {
      const s = get();
      const c = s.activeCall;
      if (!c || c.result !== 'answered') return;
      // 하루 계획이 돌고 있으면 끊는다 — 통화 첫마디가 먼저다. 끊고 나서(endCall) 다시 짓는다
      planCtl?.abort(); planCtl = null;
      const done: CallEvent = { ...c, voice: true, lines: [] };
      set({ activeCall: done, calls: s.calls.map(x => (x.id === c.id ? done : x)) });
    },
    appendCallLine: (from, text) => {
      const s = get();
      const c = s.activeCall;
      if (!c || c.result !== 'answered') return;
      const line = from === 'me' ? `나: ${text}` : text;
      const done: CallEvent = { ...c, lines: [...(c.lines ?? []), line].slice(-60) };
      set({ activeCall: done, calls: s.calls.map(x => (x.id === c.id ? done : x)) });
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
        if (c.voice) void get().planDay();   // 통화에 양보했던 하루 계획을 이어서
        return;
      }
      set({ activeCall: null });
    },
    sendMessage: (raw) => {
      const s = get();
      const text = raw.trim().slice(0, MAX_LEN);
      if (!text) return;
      const base = `m:${Math.round(s.now)}`;
      // 같은 밀리초에 두 번 보내면(검사 스크립트·붙여넣기) id가 겹친다 — 뒤에 번호를 단다
      const id = s.messages.some(m => m.id === base) ? `${base}:${s.messages.filter(m => m.id.startsWith(base)).length}` : base;
      // 연달아 보낸 말은 한 묶음이다 — 에이전트는 한 번에 읽고 한 번에 답한다 (docs/adr/0005-read-receipts.md).
      // 앞 말에 이미 예약돼 있던(아직 안 온) 답장은 버리고 묶음 전체에 대한 답장으로 갈아끼운다.
      const batch = openBatch(s.messages, s.now) ?? id;
      const mine = s.messages.filter(m => m.batch === batch && m.from === 'me');
      const texts = [...mine.map(m => m.text), text];
      const reply = replyToAll(texts, { phase: s.phase, status: s.status, name: s.memory.name, seed: `${batch}:${texts.length}`, now: s.now });
      const readAt = s.now + reply.readMs;
      const stale = new Set([`${batch}:r`, `worry:${batch}`, `ask:${batch}`]);
      // 답장은 **도착할 시각을 달고** 지금 저장된다. 실은 `at <= now`만 그리므로 늦은 답장이 저절로 늦게 뜬다.
      // 이미 읽은 말의 읽은 시각은 그대로 두고, 아직 안 읽은 말은 새 말과 같이 읽힌다.
      const kept = s.messages
        .filter(m => !(stale.has(m.id) && m.at > s.now))
        .map(m => (m.batch === batch && m.from === 'me' && m.readAt !== undefined && m.readAt > s.now ? { ...m, readAt } : m));
      const msgs: ChatMsg[] = [...kept, { id, at: s.now, from: 'me', text, readAt, batch }];
      if (reply.text !== undefined) msgs.push({ id: `${batch}:r`, at: s.now + reply.delayMs, from: 'agent', text: reply.text });
      let dueCalls = s.dueCalls.filter(d => !(stale.has(d.id) && d.at > s.now));
      let memory = s.memory;
      if (reply.worry) {
        memory = { ...s.memory, worry: { key: reply.worry, at: s.now } };
        save(MEMORY_KEY, memory);
        dueCalls = [...dueCalls, { id: `worry:${batch}`, at: s.now + reply.delayMs + WORRY_CALL_MS, why: 'worry', worry: reply.worry }];
      }
      if (reply.callMe) dueCalls = [...dueCalls, { id: `ask:${batch}`, at: s.now + reply.delayMs + ASK_CALL_MS, why: 'ask' }];
      set({ messages: trimMessages(msgs, s.anchor.t), dueCalls: trimDueCalls(dueCalls, s.anchor.t), memory, chatSeen: s.now });
      persist();
      if (reply.worry) recompute(simNow(get().clock));
      // LLM: 규칙이 정한 시각은 그대로 두고 **말만** 백엔드에 묻는다. 읽씹으로 정해진 묶음은 묻지 않는다.
      if (s.llmTier !== 'off' && reply.text !== undefined) {
        const seq = texts.length;
        const req = requestOf(texts, { phase: s.phase, status: s.status, memory, messages: msgs, now: s.now }, s.llmTier, batch);
        // 규칙 답장이 뜨기 전까지만 기다린다 (sim 시간이 실시간이면 delayMs가 그 여유다)
        const budget = Math.max(4_000, Math.min(30_000, reply.delayMs / Math.max(s.clock.scale, 1) - 1_000));
        scheduleReply(batch, req, budget, r => get().applyLlmReply(batch, seq, r));
      }
    },
    setLlmTier: (t) => { setTier(t); set({ llmTier: t }); if (t !== 'off') void get().planDay(); },
    applyPlanCards: (dayKey, id, category, cards) => {
      const s = get();
      const plans = s.days[dayKey];
      const p = plans?.[id];
      // 그 사이 범주를 바꿨거나, 카드가 이미 있거나(규칙이 채웠거나 시작했거나), 그림으로 넘겼으면 버린다
      if (!p || p.category !== category || p.options.length || p.status !== 'proposed') return;
      const options = cards.length
        ? cards
        : suggestOptions({ dateKey: splitDayKey(dayKey).dateKey, blockId: id, category, memory: s.memory, from: dayKey === s.today ? placeBefore(s, id) : placeById(s.anchor.placeId), regenSalt: s.regen[dayKey]?.[id], usedPlaceIds: usedPlaceIds(plans, id), companions: companionCtx(s.memory, id, dayKey, dayStartOfKey(dayKey)) });
      const next = { ...plans, [id]: { ...p, options } };
      const days = { ...s.days, [dayKey]: next };
      set(dayKey === s.today ? { days, plans: next } : { days });
      persist();
      if (dayKey === s.today) recompute(simNow(get().clock));
    },
    planDay: async () => {
      const s = get();
      if (s.llmTier === 'off' || s.planBusy) return;
      const dayKey = s.today;
      const dayStart = dayStartOfKey(dayKey);
      const homeCity = placeById(s.memory.homePlaceId).city;
      const have = s.llmPlans[dayKey] ?? {};
      // 아직 안 시작했고, 사용자·친구가 안 정했고, 모델도 아직 안 지은 블록만
      const todo = BLOCK_ORDER.filter(id => id !== 'sleep' && blockStartAt(dayStart, id) > s.now && !have[id])
        .filter(id => { const p = s.plans[id]; return p.category === null && !p.options.length && p.chosenBy === null && p.status === 'empty'; });
      if (!todo.length) return;
      // 블록이 시작하는 도시별로 한 번씩 묻는다 (카탈로그가 도시 것이라). 밥 시간은 식사, 여행지의 밤은 숙소 — decide()와 같은 규칙
      const groups = new Map<string, PlanBlockRequest[]>();
      for (const id of todo) {
        const from = placeBefore(s, id);
        const category: PlanCategory | null = MEAL_BLOCKS.has(id) ? 'meal' : id === 'night' && from.city !== homeCity ? 'rest' : null;
        const list = groups.get(from.city) ?? [];
        list.push({ id, category, from: from.name, avoid: usedPlaceIds(s.plans, id) });
        groups.set(from.city, list);
      }
      if (s.activeCall?.result === 'answered') return;   // 통화 중엔 모델을 통화에 양보한다
      const ctl = new AbortController();
      planCtl = ctl;
      set({ planBusy: true });
      try {
        for (const [city, blocks] of groups) {
          const r = await fetchPlan(planRequestOf(blocks, { memory: s.memory, status: s.status, now: s.now, tz: s.tz, dateKey: splitDayKey(dayKey).dateKey }, s.llmTier, city), 120_000, ctl.signal);
          if (!r) continue;
          const cur = get();
          const day: LlmDayPlan = { ...(cur.llmPlans[dayKey] ?? {}) };
          for (const b of r.blocks) {
            const options = optionsFromCards(b.options, b.category, splitDayKey(dayKey).dateKey, b.id);
            if (options.length) day[b.id] = { category: b.category, options, at: cur.now };
          }
          set({ llmPlans: { ...cur.llmPlans, [dayKey]: day } });
        }
      } finally {
        if (planCtl === ctl) planCtl = null;
        set({ planBusy: false });
      }
      persist();
      recompute(simNow(get().clock));
    },
    applyLlmReply: (batch, seq, r) => {
      const s = get();
      const now = simNow(s.clock);
      const mine = s.messages.filter(m => m.batch === batch && m.from === 'me');
      const old = s.messages.find(m => m.id === `${batch}:r`);
      if (mine.length !== seq) return;   // 묶음에 말이 더 붙었다 — 이 답은 낡았다
      // 여행 가자는 말은 답장이 이미 떴어도 유효하다 — 찾는 일은 답장과 별개로 시작한다 (ADR-0009)
      if (r.trip) void get().planTrip(r.trip, batch);
      if (!old || old.at <= now) return;   // 이미 뜬 답장 — 손대지 않는다
      const promised = s.dueCalls.some(d => d.id === `worry:${batch}` || d.id === `ask:${batch}`);
      let messages = s.messages;
      if (r.text === null) {
        // 모델이 침묵을 골랐다. 규칙이 전화를 약속해 둔 묶음이면 약속은 지켜야 하니 규칙 답장을 남긴다
        if (promised) return;
        messages = messages.filter(m => m.id !== old.id);
      } else {
        messages = messages.map(m => (m.id === old.id ? { ...m, text: r.text as string } : m));
      }
      let dueCalls = s.dueCalls;
      let memory = s.memory;
      const { ok } = pickupRule(s.phase);
      // 규칙이 못 알아들은 고민·전화 부탁을 모델이 알아들었으면 그 뒤처리를 여기서 한다 (sendMessage와 같은 규칙)
      if (r.worry && !promised) {
        memory = { ...s.memory, worry: { key: r.worry, at: now } };
        save(MEMORY_KEY, memory);
        dueCalls = [...dueCalls, { id: `worry:${batch}`, at: old.at + WORRY_CALL_MS, why: 'worry', worry: r.worry }];
      } else if (r.callMe && ok && !promised) {
        dueCalls = [...dueCalls, { id: `ask:${batch}`, at: old.at + ASK_CALL_MS, why: 'ask' }];
      }
      set({ messages, dueCalls: trimDueCalls(dueCalls, s.anchor.t), memory });
      persist();
      if (r.worry && !promised) recompute(now);
    },
    planTrip: async (cityName, batch) => {
      const s0 = get();
      const city = cityName.normalize('NFC').trim();
      if (!city) return;
      // 후속 줄: 답장 뒤에, 답장과 같은 리듬으로. 찾는 데 걸린 실제 시간은 sim 시각에 이미 흘러 있다.
      const follow = (kind: 'found' | 'failed' | 'known', nameKo: string, names: string[] = []) => {
        const s = get();
        const now = simNow(s.clock);
        const reply = s.messages.find(m => m.id === `${batch}:r`);
        const { text, delayMs } = tripFollowUp(kind, { phase: s.phase, status: s.status, name: s.memory.name, seed: `${batch}:${city}`, now }, nameKo, names);
        const msg: ChatMsg = { id: `${batch}:trip`, at: Math.max(now, reply?.at ?? 0) + delayMs, from: 'agent', text };
        set({ messages: trimMessages([...s.messages.filter(m => m.id !== msg.id), msg], s.anchor.t) });
      };
      const wish = (key: string) => {
        const memory: Memory = { ...get().memory, wish: { city: key, at: simNow(get().clock) } };
        set({ memory }); save(MEMORY_KEY, memory);
      };
      const known = cityKeyOfName(city);
      if (known) {
        if (known !== placeById(s0.memory.homePlaceId).city) { wish(known); follow('known', cityNameKo(known)); persist(); recompute(simNow(get().clock)); }
        return;
      }
      if (s0.llmTier === 'off' || s0.tripBusy) return;
      set({ tripBusy: city });
      const r = await fetchTripPlan({ tier: s0.llmTier, city });
      set({ tripBusy: null });
      if (!r || !registerCity(r.city, r.places)) { follow('failed', city); persist(); return; }
      wish(r.city.key);
      const names = rng(`trip-names:${batch}:${r.city.key}`).shuffle(r.places.filter(p => !['hotel', 'airport', 'station', 'port'].includes(p.type)).map(p => p.name)).slice(0, 2);
      follow('found', r.city.nameKo, names);
      persist();
      recompute(simNow(get().clock));
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
      // 취향이 바뀌었으니 모델이 지어 둔 계획도 버리고 다시 짓는다
      const { [s.today]: _old, ...rest } = s.llmPlans;
      set({ memory, onboarded: true, plans, days: { ...s.days, [s.today]: plans }, llmPlans: rest });
      save(MEMORY_KEY, memory); save(ONBOARD_KEY, true);
      persist(); recompute(t);
      void get().planDay();
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
      set({ clock: c, anchor, days: {}, regen: {}, llmPlans: {}, today: dayKeyIn(t, anchor.tz), tz: anchor.tz, plans: emptyPlans(), timeline: [], summary: null, gap: null, requests: [], calls: [], activeCall: null, selectedBlock: null, messages: [], dueCalls: [], chatOpen: false, say: null, shots: [], sketchOpen: null, cameraOpen: false });
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
