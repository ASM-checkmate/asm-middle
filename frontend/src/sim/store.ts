import { create } from 'zustand';
import type { ActivityOption, Anchor, BlockId, BlockPlan, Category, Friend, Comic, DayKey, DaySummaryItem, Gender, Journey, LlmDayPlan, LlmPlans, Look, Memory, Phase, Place, RemoteCache, ScheduledActivity, ShotWin, UserShot, Visibility } from './types';
import { isLook, splitDayKey } from './types';
import type { WorryKey } from './types';
import { BLOCK_ORDER, CATEGORIES, blockEndAt, blockSlotIn, blockStartAt, categoryDef } from './blocks';
import { DAY_MS, HOUR_MS, addDaysKey, compareDayKeys, dayEndOfKey, dayKeyIn, dayStartIn, dayStartOfKey, isValidTz, ownerTz } from './tz';
import { isRealClock, loadClock, saveClock, simNow, withScale, jumpedTo, resetClock, type ClockState } from './clock';
import { PLACES, cityKeyOfName, cityNameKo, hasPlace, placeById, registerCity, tzOf } from './places';
import { optionsFromCards, suggestOptions, withStayDays } from './suggest';
import { AGENTS, agentActivityAt, agentById, agentNames, agentOfFriend, appendLearned, companionCtx, friendOf, isRemoteId, learnedLine, remoteAgents, setRemoteCache, type Agent } from './agents';
import { appearanceOf, arrivedKeys, emptyRemote, friendOfRemote, mergeRemote, pendingSlots, pruneRemote, publishWindow, remoteFriendIds, remoteHomeId, timelineSig, validRemote } from './remote';
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
import { MAX_LEN, WORRY_CALL_MS, ASK_CALL_MS, askCallInMs, openBatch, reactToWorry, replyToAll, tripFollowUp, trimMessages, type ChatMsg } from './chat';
import { fetchPlan, fetchSketchRead, fetchTripPlan, getTier, planRequestOf, requestOf, scheduleReply, setTier, sketchRequestOf, type LlmTier, type PlanBlockRequest, type PlanCategory, type ReplyResponse, type SketchReadResponse } from './llm';
import { addFriendRemote, checkHealth, onLocalSave, publishAgent, publishSchedule, refreshRemote, subscribeSync, syncArmed, syncSnapshot, type BackendStatus, type DocName, type SyncInfo } from './sync';
import { flushUploads, isUploaded, mediaReady, putLocal, startMediaQueue, subscribeUploaded } from './media';
import { currentUser } from './api';
import { isShotId } from '../photo/geometry';
import { onFeedLoaded, onLike, useSns } from './sns';
import type { FeedItem, Post, PostDraft, PostIn } from './posts';
import { crushAfterActivity, crushTarget, decayAll, emptyAgentLikes, pickAutoLikes, topCrush, validAgentLikes, type AgentLikes } from './affection';
import { BEDTIME_GRACE_MS, POST_RETRY_BASE_MS, POST_RETRY_MAX_MS, askRequest, buildDraft, decidePost, emptyAgentPost, makeNpcPost, noteLikeIn, npcPostsDue, postInOf, relaxedWindow, validAgentPost, weekKeyOf, type AgentPostState, type NpcBaker, type PostCtx } from './agentPosts';

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
/** The pure inputs of the timeline — the bundle the helpers below pass around. `remote`는 진짜 사람 에이전트 캐시 (§3.4, 없으면 null). */
export interface World { days: Days; anchor: Anchor; memory: Memory; journeys: JourneyCache; regen: Regen; encounters: Encounters; requests: AgentRequest[]; calls: CallEvent[]; messages: ChatMsg[]; dueCalls: DueCall[]; shots: UserShot[]; llmPlans: LlmPlans; remote?: RemoteCache | null; agentPost?: AgentPostState; agentLikes?: AgentLikes }
/** v5 그대로 — `shots`(ADR-0004)·`llmPlans`(ADR-0010)·`remote`(BACKEND-CONTRACT §3.4)·`agentPost`(ADR-0021)는 optional 필드라 옛 저장본은 빈 값으로 읽는다 (버전을 올리지 않는다). */
interface Persisted { v: 5; days: Days; anchor: Anchor; journeys: JourneyCache; regen: Regen; encounters: Encounters; requests: AgentRequest[]; calls: CallEvent[]; messages: ChatMsg[]; dueCalls: DueCall[]; shots: UserShot[]; llmPlans?: LlmPlans; remote?: RemoteCache; agentPost?: AgentPostState; agentLikes?: AgentLikes }

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
const HEALTH_EVERY_MS = 30_000;    // tick이 서버 생사를 묻는 간격 (실제 ms, BACKEND-CONTRACT §3.3)
const REMOTE_EVERY_MS = 5 * 60_000; // 친구 목록·친구의 하루를 다시 받는 간격 (실제 ms, BACKEND-CONTRACT §3.4 c)
const REMOTE_DEBOUNCE_MS = 800;    // recompute 뒤 발행·조회까지 기다리는 시간 — 한 tick이 recompute를 여러 번 부른다
const REMOTE_RETRY_BASE_MS = 2_000; // 발행·조회가 실패한 뒤 다시 시도하기까지: 2s → 4s → … ≤ 60s (sync.ts의 문서 재시도와 같은 곡선)
const REMOTE_RETRY_MAX_MS = 60_000;

/** 서버에 올리는 문서 (BACKEND-CONTRACT §3.3) — SEEN/CHAT_SEEN/ONBOARD/clock/llm/route는 기기 로컬이라 뺀다. places는 places.ts가 올린다 */
const DOC_OF_KEY: Partial<Record<string, DocName>> = { [WORLD_KEY]: 'world', [MEMORY_KEY]: 'memory', [BOOK_KEY]: 'book' };

// localStorage may be missing (node harness, sandboxed webviews): every access is guarded
const load = <T,>(k: string, fb: T): T => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; } };
// 저장의 단일 관문 — 부팅 중 쓰기·comicFor·persist가 전부 여기를 지나므로 서버 동기화 훅도 여기 한 곳에 붙는다
const save = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
  const doc = DOC_OF_KEY[k];
  if (doc) onLocalSave(doc, v);
};
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
    // `friends: []`도 유효하다 (BACKEND-CONTRACT §3.4 e): 서버 사용자는 NPC 씨앗 친구를 받지 않는다. 저장본에 배열이 아예 없을 때만 씨앗
    friends: Array.isArray(m.friends)
      ? m.friends.filter((f): f is Memory['friends'][number] => !!f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.homePlaceId === 'string')
      : DEFAULT_MEMORY.friends,
    visited: Array.isArray(m.visited) ? m.visited.filter(v => v && typeof v.placeId === 'string' && Number.isFinite(v.at)).slice(-VISITED_CAP) : [],
    worry: m.worry && isWorryKey(m.worry.key) && Number.isFinite(m.worry.at) ? m.worry : undefined,
    wish: m.wish && typeof m.wish.city === 'string' && Number.isFinite(m.wish.at) ? m.wish : undefined,
    look: isLook(m.look) ? m.look : undefined,
    // SNS 세 칸 (CONTRACT §2.5 PUT /api/me/agent 개정) — 모양이 틀리면 없는 것으로 (없으면 서버에 키를 빼서 이전 값을 지킨다)
    gender: m.gender === 'female' || m.gender === 'male' ? m.gender : undefined,
    visibility: m.visibility === 'public' || m.visibility === 'private' ? m.visibility : undefined,
    repShotId: isShotId(m.repShotId) ? m.repShotId : undefined,
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
/** 저장된 샷 검증 — 모양이 어긋난 항목은 버린다 (사용자 컷은 만화에 그대로 들어가므로 숫자여야 한다). shotId는 32자 hex일 때만 남긴다 (ADR-0020) */
const validShots = (raw: unknown): UserShot[] => {
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<UserShot>[]).filter((x): x is UserShot => {
    const c = x?.crop;
    return !!x && typeof x.actKey === 'string' && isWin(x.win) && Number.isFinite(x.at)
      && !!c && Number.isFinite(c.scale) && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.rot)
      && (c.pitch === undefined || Number.isFinite(c.pitch)) && (c.light === undefined || Number.isFinite(c.light)) && (c.dof === undefined || Number.isFinite(c.dof)) && (c.focus === undefined || c.focus === 'near' || c.focus === 'far');
  }).map(x => (x.shotId === undefined || isShotId(x.shotId) ? x : (({ shotId: _drop, ...rest }) => rest)(x)));
};
const persistedOf = (w: World): Persisted => ({ v: 5, days: w.days, anchor: w.anchor, journeys: w.journeys, regen: w.regen, encounters: w.encounters, requests: w.requests, calls: w.calls, messages: w.messages, dueCalls: w.dueCalls, shots: w.shots, llmPlans: w.llmPlans, ...(w.remote ? { remote: w.remote } : {}), ...(w.agentPost ? { agentPost: w.agentPost } : {}), ...(w.agentLikes ? { agentLikes: w.agentLikes } : {}) });
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

/** Friend / agent names never appear in a title — companionship is data (`friendId`), not copy (FRIENDS_SPEC).
 *  진짜 사람의 이름도 지운다 (BACKEND-CONTRACT §3.4) — 사용자 이름은 흔한 낱말일 수 있어("카페") 조사가 붙은 꼴만 지우고,
 *  정규식 문자는 이스케이프한다. NPC 이름은 예전 규칙 그대로. */
const AGENT_NAMES = AGENTS.map(a => a.name);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripNames = (title: string, keepPlaceName: boolean): string => {
  if (keepPlaceName) return title.replace(/\{friend\}(이랑|랑|와|과|네)?\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  let out = title.replace(/\{friend\}(이랑|랑|와|과|네)?\s*/g, '');
  for (const n of AGENT_NAMES) out = out.replace(new RegExp(`${n}(이랑|랑|와|과|네)?\\s*`, 'g'), '');
  for (const n of agentNames().slice(AGENT_NAMES.length)) if (n.length >= 2) out = out.replace(new RegExp(`${escapeRe(n)}(이랑|랑|와|과|네)\\s*`, 'g'), '');
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
 * 설렘이 좋아함 이상이면 그 사람이 그 블록에 가는 곳이 카드 후보에 오른다 (AFFECTION_SPEC §4 "계획 후보에 그 사람이 자주 가는 곳", ADR-0023 영향).
 * 동행이 아니다 — friendId·proposedBy 없이 장소·활동만, 이유는 얼버무린 "왠지 {동네} 가고 싶어" (이름·단계는 절대 안 나온다). 그 사람의 하루(NPC는 시드,
 * 진짜 사람은 발행된 일정)에서 내 도시 안·집이 아닌 활동일 때만. 없으면 null. 결정적 — 난수 없음
 */
function crushCard(memory: Memory, blockId: BlockId, dayKey: DayKey, myCity: string): ActivityOption | null {
  const top = crushTarget(memory, 'like');
  if (!top) return null;
  const agent = agentOfFriend(top.friend);
  const act = agentActivityAt(agent, blockId, dayKey);
  if (!act || act.placeId === agent.homePlaceId) return null;
  let place: Place;
  try { place = placeById(act.placeId); } catch { return null; }
  if (place.city !== myCity || place.type === 'friend_home' || place.type === 'home') return null;
  return { id: `${blockId}-crush-${place.id}`, title: stripNames(act.option.title, false), reason: `왠지 ${place.area} 가고 싶어`, emoji: act.option.emoji, placeId: place.id, category: act.option.category };
}
/** 카드 3장 중 셋째를 설렘 카드로 — 그 장소가 이미 카드에 있거나 다른 블록이 쓰는 곳(`used`, suggestOptions의 usedPlaceIds와 같은 문)이면 그대로. 계획 전체가 아니라 후보 하나다 */
const withCrushCard = (options: ActivityOption[], card: ActivityOption | null, used: readonly string[]): ActivityOption[] =>
  !card || options.some(o => o.placeId === card.placeId) || used.includes(card.placeId) ? options : [...options.slice(0, 2), card];

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
      // 정말 빈 블록(범주도 사용자가 안 고른)의 카드 3장 중 하나는 설렘 대상이 가는 곳 (AFFECTION_SPEC §4) — 숙소 밤은 빼고. 카드의 범주는 그 사람 활동의 것이라
      // 사용자가 '운동'이라 골라 둔 블록엔 끼우지 않는다 (고르면 블록 이름이 바뀐다). 설렘이 없으면 카드는 그대로다
      if (p0.category === null && !p0.options.length && !hotel) p.options = withCrushCard(p.options, crushCard(w.memory, id, dayKey, from.city), usedPlaceIds(plans, id));
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
 *
 * 같이 놀았으면 SNS 친구 (FRIENDS_SPEC §6, ADR-0022 결정 3): 동행(`companions`)과 말을 튼 상대(`encounter.talked` — 대화 롤 성공 이후는 동행이다,
 * §6 표) 마다 친구가 아니면 그 자리에서 친구가 되고, 우정(`bond`)이 1 오르고, 상대에 대해 알게 된 한 줄이 `learned`에 쌓인다 (규칙·결정적, 중복 없이
 * 12개). 같은 공간에 있기만 한 사람(`presentNearby`)은 마주침 카운트만 오른다 (§6 표 "관계 효과: 없음. 마주침 카운트만" — SNS '최근 마주친',
 * 다음 굴림의 '또 봤네' +20 %). 동행은 세지 않는다. 만화 id로 멱등이라 한 활동이 두 번 세지지 않는다.
 */
function settle(a: ScheduledActivity, book: Comic[], memory: Memory, encounters: Encounters, shots: UserShot[] = []): { comic: Comic; book: Comic[]; memory: Memory; encounters: Encounters } {
  const existing = book.find(b => b.id === `c:${a.key}`);
  if (existing) return { comic: existing, book, memory, encounters };
  // 사용자가 찍은 창은 그대로, 나머지는 에이전트가 채운다 (ADR-0004) — 만화는 여기서 한 번 만들어져 앨범에 고정된다
  const comic = makeComic(a, memory, shotsFor(shots, a.key));
  let nextMemory = a.place.type === 'home'
    ? memory
    : { ...memory, visited: [...memory.visited.filter(v => !(v.placeId === a.place.id && v.at === a.endAt)), { placeId: a.place.id, at: a.endAt }].slice(-VISITED_CAP) };
  let nextEncounters = { ...encounters };
  const e = a.encounter;
  // 마주침 카운트: 굴림 상대와 같은 공간의 사람 전부 (동행은 presentNearby에 없다)
  for (const id of new Set([...(e ? [e.agentId] : []), ...(a.presentNearby ?? [])])) nextEncounters[id] = (nextEncounters[id] ?? 0) + 1;
  // 같이 논 사람: 말을 튼 상대(새 친구든 `again`이든) + 동행
  const played = [...(e?.talked ? [e.agentId] : []), ...a.companions.filter(id => id !== e?.agentId)];
  for (const id of played) {
    const agent = agentById(id);
    let friends = nextMemory.friends;
    if (!friends.some(f => f.id === id)) {
      if (!agent) continue;
      friends = [...friends, friendOf(agent, { at: a.endAt, placeId: a.place.id })];
      // 진짜 사람이면 서버에도 적는다 (BACKEND-CONTRACT §3.4 d — 대칭·멱등, 불 붙이고 잊는다)
      if (isRemoteId(id)) addFriendRemote(id, a.endAt, a.place.id);
    }
    const label = categoryDef(a.option.category).label;
    friends = friends.map(f => f.id === id ? { ...f, bond: (f.bond ?? 0) + 1, learned: appendLearned(f.learned, learnedLine(a, id, label, f.learned ?? [])) } : f);
    nextMemory = { ...nextMemory, friends };
  }
  // 설렘 (AFFECTION_SPEC §3, ADR-0023): 사다리 뒤에 — 동행은 소폭, 마주침은 크게, 같은 공간의 친구는 "서로 봤다". 이성이고 내 성별을 알 때만.
  // 상대의 성별·취향은 풀·서버 프로필에서 (옛 저장본의 친구 칸엔 성별이 없다)
  nextMemory = crushAfterActivity(nextMemory, a, id => { const ag = agentById(id); return ag ? { gender: ag.gender, likes: ag.likes } : null; });
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
  /** 서버 생사 (sim/sync.ts). unknown = 아직 안 물어봄. down이어도 앱은 돈다 — 화면엔 회색 점 하나뿐 */
  backend: BackendStatus;
  /** 문서 동기화 상태 (sim/sync.ts): 사용자 id·문서 버전·마지막 push·오류·건너뛴 이유 */
  sync: SyncInfo;
  /** 진짜 사람 에이전트 캐시 (BACKEND-CONTRACT §3.4). world 저장본에 실린다. 오프라인이면 null — NPC 풀 그대로 */
  remote: RemoteCache | null;
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
  /** 에이전트 발행 엔진의 상태 (sim/agentPosts, ADR-0021 결정 5): 마지막 글·쥔 초안·주간 물음 수·버린 날·좋아요 기록. world 저장본에 실린다 */
  agentPost: AgentPostState;
  /** 주인이 그 사람 글에 좋아요를 켰다 (sns.onLike → 여기) — "관심 있는 사람" 고민의 재료 */
  noteLike: (authorId: string) => void;
  /** 에이전트가 먼저 누른 좋아요의 기록 (sim/affection, AFFECTION_SPEC §4): 누른 글 id·오늘 누른 수. world 저장본에 실린다 */
  agentLikes: AgentLikes;
  /** 피드 한 장이 오면(sns.onFeedLoaded → 여기) 설렘이 좋아함 이상인 사람의 글에 에이전트가 먼저 좋아요 — 글마다 한 번, 하루 3개. 주인의 좋아요 기록엔 안 적힌다 */
  agentAutoLike: (items: readonly FeedItem[]) => void;
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
  /**
   * 서버에서 받은 진짜 사람 캐시를 world에 넣는다 (BACKEND-CONTRACT §3.4 c): 모듈 캐시(agents.ts)에 옮기고 저장하고 오늘을
   * 다시 결정한다. 이미 정산된 활동은 만화 id로 굳어 있어 안 바뀐다 (settle 멱등). null이면 NPC 풀로 돌아간다.
   */
  applyRemote: (cache: RemoteCache | null) => void;

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
  /** 내 캐릭터의 겉모습을 바꾼다 (ADR-0019). undefined면 기본 모모로 */
  setLook: (look: Look | undefined) => void;
  /** SNS 프로필 칸 — 성별(AFFECTION_SPEC §2, 주인이 직접 고른다)·계정 공개(SNS_SPEC §10)·대표컷 핀(§5). null이면 지운다. 서버엔 다음 tick이 보낸다 */
  setSnsProfile: (patch: { gender?: Gender | null; visibility?: Visibility; repShotId?: string | null }) => void;
  /** 에이전트가 지금 글을 올린다 (DEV·QA용). 여유 창을 기다리지 않는다. 채워지는 곳: sim/agentPosts */
  postNow: () => void;
  /** 에이전트가 지금 초안을 만들어 채팅으로 묻는다 (DEV·QA용). 고민 조건·주 2회 상한을 건너뛴다 */
  askPostNow: () => void;
  /**
   * 초안의 결말 — 글쓰기 화면이 초안을 올렸거나(`posted`, postId 있음) 버렸을 때(`discarded`) 부른다.
   * 채팅의 물음(AgentRequest)을 답한 것으로 적고, 오늘의 대기 초안을 비우고, 올렸으면 "올렸어 · 보러 가기" 한 줄을 남긴다. 채우는 곳: sim/agentPosts
   */
  resolvePostDraft: (draftId: string, outcome: 'posted' | 'discarded', postId?: string) => void;
  setSketchOpen: (id: BlockId | null) => void;
  setCameraOpen: (open: boolean) => void;
  /** 한 장 찍는다. 같은 actKey+win은 교체(뒤가 이김). 활동 종료 전(now < endAt)에만 — 만화는 endAt에 한 번 만들어진다. */
  addShot: (shot: UserShot) => void;
  /**
   * 굽기가 실패한 샷의 shotId를 뗀다 (ADR-0020: 픽셀이 없으면 옛 경로로 그린다). 그 사이 다시 찍었으면(다른 id) 건드리지 않는다.
   * 활동이 끝난 뒤에 실패했으면 만화가 이미 그 id를 컷에 옮겼다 — 책의 컷에서도 뗀다 (화면이 다음 열람 때 다시 굽는다)
   */
  dropShotId: (shotId: string) => void;
  /**
   * 책의 컷에 구운 픽셀의 id를 적는다 (ADR-0020 결정 2: 옛 컷·에이전트 컷은 다음 열람 때 화면이 한 번 굽는다). 책 항목을 불변으로
   * 바꾸고 저장한다(book 문서). 이미 id가 있거나 만화·컷을 못 찾으면 아무것도 안 한다
   */
  patchPanelShot: (comicId: string, panelIndex: number, shotId: string) => void;
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
const worldOf = (s: WorldState): World => ({ days: s.days, anchor: s.anchor, memory: s.memory, journeys: s.journeys, regen: s.regen, encounters: s.encounters, requests: s.requests, calls: s.calls, messages: s.messages, dueCalls: s.dueCalls, shots: s.shots, llmPlans: s.llmPlans, remote: s.remote, agentPost: s.agentPost, agentLikes: s.agentLikes });

// ─── 가상 친구 글의 굽기 (ADR-0021 결정 6) ──────────────────────────────────────────────
// bakeShot(photo/bake.tsx)·sceneTypeFor(scenes/index.tsx)는 .tsx라 node 하네스가 못 읽는다 — 브라우저에서만 동적으로 올리고, 하네스는
// setNpcBaker로 가짜를 꽂는다. 굽기가 없으면 NPC 글은 안 만든다 (다음 날 다시).
let npcBaker: NpcBaker | null = null;
/** 하네스·QA용: 가상 친구 컷을 굽는 함수를 갈아 끼운다 (null이면 안 만든다) */
export const setNpcBaker = (b: NpcBaker | null) => { npcBaker = b; };
if (typeof document !== 'undefined') {
  void Promise.all([import('../photo/bake'), import('../scenes')]).then(([bake, scenes]) => {
    if (npcBaker) return;
    npcBaker = async i => { const r = await bake.bakeShot({ type: scenes.sceneTypeFor(i.placeType), pose: i.pose, crop: i.crop, look: i.look }); return { blob: r.blob, mime: r.mime }; };
  }).catch(() => { /* 굽기 모듈을 못 올렸다 — 가상 친구 글 없이 간다 */ });
}
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
  // 진짜 사람 캐시 (BACKEND-CONTRACT §3.4): 모양이 틀리면 버린다. settle(agentById)·decide(제안)보다 먼저 모듈 캐시에 올린다
  const sync0 = syncSnapshot();
  const homeCityOf = (m: Memory) => { try { return placeById(m.homePlaceId).city; } catch { return undefined; } };
  let remote: RemoteCache | null = validRemote(persisted0?.remote);
  setRemoteCache(remote, { meId: sync0.sync.userId, homeCity: homeCityOf(memory) });
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
  const agentPost0 = validAgentPost(persisted?.agentPost);
  const agentLikes0 = validAgentLikes(persisted?.agentLikes);
  let w: World = { days: validDays(persisted?.days), anchor: validAnchor(persisted?.anchor, now, memory), memory, journeys: persisted?.journeys ?? {}, regen: persisted?.regen ?? {}, encounters, requests: requests0, calls: Array.isArray(persisted?.calls) ? persisted.calls : [], messages: messages0, dueCalls: dueCalls0, shots, llmPlans: validLlmPlans(persisted?.llmPlans), remote, agentPost: agentPost0, agentLikes: agentLikes0 };
  const gapActs: ScheduledActivity[] = [];
  const remember = (a: ScheduledActivity) => { settleLocal(a); if (a.endAt > lastSeen && a.endAt <= now) gapActs.push(a); };
  w = prune(w, now, remember);
  shots = trimShots(shots, w.anchor.t);   // anchor 뒤로 접힌 활동의 샷은 만화가 이미 앨범에 있다
  if (remote) {
    // anchor 이전 날의 슬롯은 그 날과 함께 접혔다 — 내 친구의 프로필은 남긴다
    const pruned = pruneRemote(remote, w.anchor.t, new Set(memory.friends.map(f => f.id)));
    if (pruned !== remote) { remote = pruned; w = { ...w, remote }; setRemoteCache(remote, { meId: sync0.sync.userId, homeCity: homeCityOf(memory) }); }
  }
  w = { ...w, memory, encounters, shots, days: liveOut({ ...w, memory, encounters, shots }, now) };
  const today = currentDayKey(now, build(w, now), w.anchor.tz);
  const first = decide(today, w, horizonFor(now), now);
  w = { ...w, days: first.days };
  for (const a of first.timeline) if (a.endAt <= now) remember(a);
  memory = decayAll(memory, now);   // 2주 넘게 안 본 마음은 식는다 (AFFECTION_SPEC §3) — 켜 둔 동안은 날이 바뀔 때(sync), 껐다 켜면 여기서
  w = { ...w, memory, encounters };
  const initialPhase = phaseAt(now, first.timeline, w.anchor, memory, settleLocal);
  const initialStatus = foldStatus(w.anchor, first.timeline, now, memory);
  save(WORLD_KEY, persistedOf(w));
  if (book !== book0) save(BOOK_KEY, book);
  if (memory !== memory0) save(MEMORY_KEY, memory);
  const away = now - lastSeen >= CATCHUP_GAP_MS;
  const summary = away && gapActs.length ? summaryOf(gapActs, a => comicCache.get(a.key)!) : null;
  const gap = summary ? { from: lastSeen, to: now } : null;
  // 자리를 비운 사이 시각이 지난 약속 전화는 **부재중**이다 — 켜자마자 벨이 울리는 게 아니라 (ADR-0013). 내용은 없다.
  // 잠깐 껐다 켠 것(10분 안)이면 첫 tick이 그대로 울린다. "비웠다"는 이 기기의 마지막 tick 기준인데, 다른 기기에서 받아 온
  // 저장본(로그인·새 기기)엔 그 시각이 없으니 약속 자체가 10분 넘게 지났으면 똑같이 접는다.
  {
    const expired = w.dueCalls.filter(d => d.at <= now && (away || now - d.at >= CATCHUP_GAP_MS));
    // 받은 채로 앱이 꺼진 통화는 끊은 것으로 친다 — 안 그러면 대화 실에 "통화 중"이 영영 남는다. 마지막으로 본 시각까지(최대 1시간)
    const speed = clock.scale > 0 ? clock.scale : 1;
    const calls = w.calls.map(c => (c.result === 'answered' && c.startedAt !== undefined && c.durSec === undefined
      ? { ...c, durSec: Math.max(1, Math.min(3600, Math.round((Math.max(lastSeen, c.startedAt) - c.startedAt) / 1000 / speed))) }
      : c));
    if (expired.length || calls.some((c, i) => c !== w.calls[i])) {
      const missed: CallEvent[] = expired.map(d => ({ id: `in:${d.id}`, at: d.at, dir: 'in', result: 'missed', why: d.why }));
      w = { ...w, calls: trimCalls([...calls, ...missed], w.anchor.t), dueCalls: w.dueCalls.filter(d => !expired.includes(d)) };
      save(WORLD_KEY, persistedOf(w));
    }
  }

  /** sim time of the previous tick — the start of the gap a tick has to account for */
  let lastTick = now;
  /** 지금 붙어 있는 통화가 시작된 실제 시각 (ms) — 통화 시간은 실제로 통화한 초다 */
  let callStartedReal: number | null = null;
  /** 마지막으로 서버 생사를 물은 실제 시각 (tick이 30초마다) */
  let lastHealthAt = 0;
  // 동기화 모듈은 스토어를 모른다 — 상태가 바뀌면 여기로 복사해 화면(DevPanel·TopChrome)이 구독한다
  subscribeSync(s => set({ backend: s.backend, sync: s.sync }));
  // 사진 업로드 줄 (ADR-0020): 밀린 사진을 올리고, 서버가 살아날 때마다 다시. dev 시계에도 올린다 (media.ts 머리 주석)
  startMediaQueue();

  // ── 진짜 사람 에이전트 (BACKEND-CONTRACT §3.4) ──
  // 발행(내 확정 일정)·조회(같은 곳의 사람들, 친구, 친구의 하루)는 서버가 있고 시계가 실시간일 때만 — dev가 돌린 하루를
  // 다른 사람의 세계에 흘리지 않는다 (§3.3의 world/book 규칙과 같다). 실시간은 scale 1만이 아니라 점프 없음까지다
  // (clock.isRealClock: jumpTo·x10→x1 뒤의 어긋난 시계도 dev 시계). 서버가 죽어 있으면(backend down) 30초 health가 살릴 때까지
  // 두드리지 않는다. 하네스(fetch 없음)에서는 전부 꺼져 NPC 풀 그대로다.
  const remoteOn = () => syncArmed() && isRealClock(get().clock) && !!get().sync.userId && get().backend !== 'down';
  const unref = (t: ReturnType<typeof setTimeout>) => { (t as { unref?: () => void }).unref?.(); };
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** 마지막으로 서버가 받아 준 시간표의 서명 — 같으면 다시 올리지 않는다 */
  let publishedSig: string | null = null;
  /** 마지막으로 친구 목록·하루를 받은 실제 시각 (5분마다) */
  let lastRemoteAt = 0;
  let refreshing = false;
  let publishing = false;
  let profileSent = false;
  let profileSending = false;
  // 대표 사진은 서버가 받은 뒤에야 프로필에 실린다(아래 publishProfile) — 올라가는 순간 다시 보낸다 (tick이 집어 간다)
  subscribeUploaded(id => { if (id === get().memory.repShotId) profileSent = false; });
  // 주인의 좋아요 → "관심 있는 사람" 기록 (SNS_SPEC §9). **물은** 초안이 있으면 글쓰기 화면이 미리 채울 수 있게 useSns에도 둔다 —
  // 묻지 않고 올리는 중인 초안(asked=false)은 엔진의 것이라 화면에 안 보인다 (보이면 주인이 올리기/고치기를 눌러 두 번 올라간다)
  onLike(id => get().noteLike(id));
  // 에이전트의 먼저 좋아요 (AFFECTION_SPEC §4) — 피드 한 장이 올 때마다
  onFeedLoaded(items => get().agentAutoLike(items));
  if (agentPost0.pending?.asked) useSns.getState().setDraft(agentPost0.pending.draft);
  // 실패 뒤 백오프 — recompute가 tick마다(1초) 돌고 디바운스(800 ms)가 그보다 짧아, 이게 없으면 죽은 서버를 초마다 두드린다
  let remoteFailures = 0;
  let nextRemoteAt = 0;
  /** 지금 서버에 물어도 되나 — 켜져 있고 백오프가 지났다 */
  const remoteReady = () => remoteOn() && Date.now() >= nextRemoteAt;
  const remoteFailedNow = () => { nextRemoteAt = Date.now() + Math.min(REMOTE_RETRY_MAX_MS, REMOTE_RETRY_BASE_MS * 2 ** Math.min(remoteFailures, 5)); remoteFailures++; };
  const remoteOkNow = () => { remoteFailures = 0; nextRemoteAt = 0; };

  /** (a) 내 확정 일정 `[anchor.t, now+36h)`를 발행한다 (한 번에 하나만 — 느린 서버에 PUT이 쌓이지 않게) */
  const publishNow = async () => {
    if (!remoteReady() || publishing) return;
    const s = get();
    const me = s.sync.userId!;
    const sig = timelineSig(s.timeline);
    if (sig === publishedSig) return;
    const from = s.anchor.t;
    const acts = publishWindow(s.timeline, from, Number.POSITIVE_INFINITY, me, s.memory.name, stripNames);
    const to = Math.max(s.now + HORIZON_MS, ...acts.map(a => a.arriveAt + 1));
    publishing = true;
    try {
      if (await publishSchedule(from, to, acts.filter(a => a.arriveAt < to))) { publishedSig = sig; remoteOkNow(); } else remoteFailedNow();
    } finally { publishing = false; }
  };
  const schedulePublish = () => {
    if (!remoteReady() || timelineSig(get().timeline) === publishedSig) return;
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = setTimeout(() => { publishTimer = null; void publishNow(); }, REMOTE_DEBOUNCE_MS);
    unref(publishTimer);
  };
  /** (b) 내 프로필 — 부팅·updateMemory 뒤. 색·이모지는 userId로 정해 어느 기기에서 봐도 같다 (sim/remote.ts appearanceOf). 서버가 받았으면 true */
  const publishProfile = async (): Promise<boolean> => {
    if (!remoteOn()) return false;
    const s = get();
    const me = s.sync.userId!;
    let home; try { home = placeById(s.memory.homePlaceId); } catch { return false; }
    const look = appearanceOf(me);
    const clip = (v: string[]) => v.slice(0, 12).map(x => x.slice(0, 30));
    const m = s.memory;
    const r = await publishAgent({
      name: m.name.slice(0, 40), color: look.color, emoji: look.emoji, hairStyle: look.hairStyle, likes: clip(m.likes), traits: clip(m.traits),
      home: { ...home, id: remoteHomeId(me), name: `${m.name}네 집`, type: 'friend_home', ownerFriendId: me },
      // SNS 세 칸(CONTRACT §2.5): 메모리에 있을 때만 싣는다 — 키를 빼면 서버가 이전 값을 지킨다 (되돌아가지 않게).
      // repShotId는 서버가 받은 사진만 — 아직 줄에 선 id를 보내면 400 'repShotId not yours'로 프로필 전체가 막힌다 (올라가면 subscribeUploaded가 다시 보낸다)
      ...(m.gender ? { gender: m.gender } : {}), ...(m.visibility ? { visibility: m.visibility } : {}), ...(m.repShotId && isUploaded(m.repShotId) ? { repShotId: m.repShotId } : {}),
    });
    return r !== null;
  };
  /**
   * (c) 오늘·내일 활동 중 아직 도착 전이고 슬롯에 없는 key로 같은 곳의 사람들을 묻고, 5분마다(또는 `full`) 친구 목록과
   * 친구의 하루를 받는다. 결과는 applyRemote로 world에 들어간다. 슬롯은 key마다 한 번만 (mergeRemote가 지킨다).
   */
  const refreshNow = async (full: boolean) => {
    if (!remoteReady() || refreshing) return;
    const s = get();
    const today = s.today, tomorrow = addDaysKey(today, 1);
    const slots = pendingSlots(s.timeline, s.remote, s.now, [today, tomorrow]);
    const real = Date.now();
    const friendsDue = full || real - lastRemoteAt >= REMOTE_EVERY_MS;
    if (!slots.length && !friendsDue) return;
    refreshing = true;
    try {
      if (friendsDue) lastRemoteAt = real;
      const got = await refreshRemote({
        slots,
        friendsAt: friendsDue ? s.now : null,
        days: friendsDue ? { ids: remoteFriendIds(s.memory, s.remote), from: dayStartOfKey(today), to: dayEndOfKey(tomorrow) } : null,
      });
      if (!got) { remoteFailedNow(); return; }   // 물을 게 있었는데 전부 실패했다 — 백오프
      remoteOkNow();
      const cur = get();
      const next = mergeRemote(cur.remote ?? emptyRemote(), got, { now: cur.now, arrivedKeys: arrivedKeys(cur.timeline, cur.now), friendsAt: friendsDue ? real : undefined });
      // 서버가 아는 친구 중 내 메모리에 없는 사람은 추가 (상대가 먼저 말을 걸었다) — 프로필은 캐시에서 온다
      const added = (got.friends ?? []).filter(f => !cur.memory.friends.some(x => x.id === f.agent.id)).map(f => friendOfRemote(f.agent, f.metAt, f.metPlaceId));
      if (added.length) {
        const memory: Memory = { ...cur.memory, friends: [...cur.memory.friends, ...added] };
        set({ memory }); save(MEMORY_KEY, memory);
      }
      get().applyRemote(next);
    } finally { refreshing = false; }
  };
  const scheduleRefresh = () => {
    if (!remoteReady()) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; void refreshNow(false); }, REMOTE_DEBOUNCE_MS);
    unref(refreshTimer);
  };

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
    // 시간표가 바뀌었으면 발행하고, 새로 정해진 활동의 슬롯을 묻는다 (둘 다 800 ms 디바운스, BACKEND-CONTRACT §3.4)
    schedulePublish(); scheduleRefresh();
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
      memory = decayAll(memory, t);   // 날이 바뀌면 설렘의 시간 감쇠 (AFFECTION_SPEC §3)
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

  // ─── 에이전트 발행 엔진 (sim/agentPosts, ADR-0021 결정 5·6 · SNS_SPEC §8·§9) ───────────────────────────
  /** 글 올리기가 진행 중 — 겹쳐 보내지 않는다 */
  let postInFlight = false;
  /** 실패 뒤 다음 시도 시각 (sim ms)·연속 실패 수 — 60s → 2m → … ≤ 15m */
  let postNextTryAt = 0;
  let postFailures = 0;
  const postCtxOf = (s: WorldState): PostCtx => ({ today: s.today, now: s.now, timeline: s.timeline, book: s.book, shots: s.shots, memory: s.memory, encounters: s.encounters, isUploaded, agentPost: s.agentPost });
  const setAgentPost = (patch: Partial<AgentPostState>) => { set({ agentPost: { ...get().agentPost, ...patch } }); persist(); };
  /** "올렸어 · 보러 가기" — SNS_SPEC §8이 허락한 한 줄. 같은 글로 두 번 남기지 않는다 */
  const postedLine = (t: number, postId: string | null, fallbackId: string): ChatMsg => ({
    id: `post:${postId ?? fallbackId}`, at: t, from: 'agent', text: '올렸어', ...(postId ? { link: { kind: 'post' as const, id: postId, label: '보러 가기' } } : {}),
  });
  /** 오늘 글을 포기한다 — 자기 전까지 컷이 하나도 안 올라갔을 때 (§8 자기 전 규칙의 뒤) */
  const skipToday = () => { setAgentPost({ pending: undefined, skippedDay: get().today }); useSns.getState().setDraft(null); };
  /** 초안을 놓는다 (올리지 않고). 마감을 넘겨 "그냥 올릴게" 한 쪽지가 있으면 통보까지 끝난 것으로 — 요약 시트에 다시 뜨지 않게 */
  const dropPending = (draftId: string) => {
    const s = get();
    const requests = s.requests.map(r => (r.kind === 'post' && r.refId === draftId && r.decidedAlone && !r.told ? { ...r, told: true } : r));
    set({ requests, agentPost: { ...s.agentPost, pending: undefined } });
    useSns.getState().setDraft(null);
    persist();
  };
  /** 서버가 받아 줬다: 그 날은 끝(자정을 넘겨 올린 어제 초안이면 오늘은 아직), 초안 비우고, 채팅에 한 줄 */
  const posted = (post: Post, t: number, draftId: string) => {
    const s = get();
    // 물었던 쪽지가 아직 열려 있으면(마감 전에 다른 길로 올라감) 답한 것으로 접는다 — 카드가 계속 떠 있지 않게
    const requests = s.requests.map(r => (r.kind === 'post' && r.refId === draftId && !r.answered && !r.decidedAlone ? { ...r, answered: 'post', answeredAt: t } : r));
    const msg = postedLine(t, post.id, draftId);
    const lastPostDay = post.dateKey === splitDayKey(s.today).dateKey ? s.today : s.agentPost.lastPostDay;
    set({ requests, messages: trimMessages([...s.messages.filter(m => m.id !== msg.id), msg], s.anchor.t), agentPost: { ...s.agentPost, lastPostDay, lastPostAt: t, pending: undefined } });
    useSns.getState().setDraft(null);
    persist();
  };
  /**
   * 쥔 초안을 올려 본다. 컷이 전부 서버에 올라가 있어야 한다(`cut not yours`) — 아니면 올리기를 재촉하고 다음 tick에 다시. 자기 전 창에서
   * 하루 끝이 5분 안이면 올라간 컷만으로 올리고, 하나도 없으면 오늘은 건너뛴다. 자정을 넘긴 어제 초안(pumpAgentPost가 남긴 것)도 그렇게 —
   * 다만 하나도 없으면 오늘을 접지 않고 초안만 놓는다. 실패(null)면 백오프 뒤 다시.
   * 부팅 직후 IDB 색인이 아직 안 올라왔으면(mediaReady) 기다린다 — 올라간 컷을 모른다고 마지막 5분에 오늘을 접어 버리지 않게.
   */
  const tryPost = (t: number) => {
    const s = get();
    const p = s.agentPost.pending;
    if (!p || postInFlight || t < postNextTryAt || !mediaReady()) return;
    const uploaded = p.draft.cuts.filter(c => isUploaded(c.shotId));
    let body: PostIn;
    if (uploaded.length < p.draft.cuts.length) {
      const overnight = p.draft.dateKey !== splitDayKey(s.today).dateKey;
      const lastCall = overnight || (relaxedWindow(s.phase) === 'bedtime' && dayEndOfKey(s.today) - t <= BEDTIME_GRACE_MS);
      if (!lastCall) { void flushUploads(); return; }
      if (!uploaded.length) { if (overnight) dropPending(p.draftId); else skipToday(); return; }
      body = postInOf(p.draft, uploaded);
    } else body = postInOf(p.draft);
    postInFlight = true;
    const draftId = p.draftId;
    void useSns.getState().publishPost(body).then(post => {
      postInFlight = false;
      const now = simNow(get().clock);
      if (post) { postFailures = 0; postNextTryAt = 0; posted(post, now, draftId); return; }
      postNextTryAt = now + Math.min(POST_RETRY_MAX_MS, POST_RETRY_BASE_MS * 2 ** Math.min(postFailures, 4));
      postFailures++;
    }, () => { postInFlight = false; });
  };
  /** 채팅으로 묻는다: 쪽지 하나, 초안은 world와 useSns 양쪽에(글쓰기 화면이 미리 채운다). `count`면 이번 주 물음 수에 센다 */
  const askPost = (draft: PostDraft, request: AgentRequest, count: boolean) => {
    const s = get();
    const week = weekKeyOf(splitDayKey(s.today).dateKey);
    const asks = count ? { week, count: (s.agentPost.asks.week === week ? s.agentPost.asks.count : 0) + 1 } : s.agentPost.asks;
    const withDue: PostDraft = { ...draft, dueAt: request.dueAt };
    set({
      requests: trimRequests([...s.requests.filter(r => r.id !== request.id), request], s.anchor.t),
      agentPost: { ...s.agentPost, asks, pending: { draftId: draft.id, dueAt: request.dueAt, asked: true, draft: withDue } },
    });
    useSns.getState().setDraft(withDue);
    persist();
  };
  /**
   * tick마다: 쥔 초안이 있으면 그 결말을 굴리고(답을 기다리는 중이면 가만히, 마감을 넘겼거나 '그대로 올려'면 올린다, '컷 고치기'면 글쓰기
   * 화면이 resolvePostDraft로 끝낸다), 없으면 여유 있는 창에서 초안을 만들어 묻거나 올린다.
   * 날이 바뀌면 어제 초안은 버린다 (하루 1글은 그날 것) — 단, **물어 놓고 답이 없는**(마감 전이든 넘겼든, '그대로 올려'든) 초안은 하루까지
   * 더 쥐고 그대로 올린다: 자정 15분 전에 물으면 마감이 자정 뒤라, 버리면 "답이 없어서 그냥 올릴게"가 거짓말이 된다. 저장본에서 살아난 초안도 같은 길.
   * 글쓰기 화면이 열려 있는 동안은 올리지 않는다 — 주인이 고치는 초안을 등 뒤에서 올리면 두 번 올라간다.
   * '컷 고치기'라 답해 놓고 화면을 닫은 채 하루가 저물면 자기 전 창에서 그대로 올린다 (SNS_SPEC §8 "그날 안 올렸으면 자기 전에").
   * 사용자가 없으면(오프라인으로 시작) 초안도 물음도 없다 — 올릴 길이 없는데 묻고 "올릴게" 하지 않는다.
   */
  /**
   * 시계를 돌려(jumpTo) 건너뛴 활동은 만화가 없다 (tick의 gap 처리는 점프 뒤엔 안 돈다) — 초안은 책의 컷으로 만들어지므로 오늘 끝난
   * 활동은 초안을 짓기 전에 여기서 정산한다 (settle은 멱등: 이미 책에 있으면 그대로). 실시간에는 tick이 먼저 해 둬서 아무 일도 없다
   */
  const settleToday = (t: number) => {
    const s = get();
    for (const a of s.timeline) if (a.dayKey === s.today && a.endAt <= t && a.option.category !== 'sleep' && !s.book.some(c => c.id === `c:${a.key}`)) comicFor(a);
  };
  const pumpAgentPost = (t: number) => {
    const s = get();
    const ap = s.agentPost;
    if (ap.pending) {
      const req = s.requests.find(r => r.kind === 'post' && r.refId === ap.pending?.draftId);
      const todayDate = splitDayKey(s.today).dateKey;
      if (ap.pending.draft.dateKey !== todayDate) {
        const askedOpen = ap.pending.asked && !!req && (!req.answered || req.answered === 'post');
        const yesterday = Date.parse(`${todayDate}T00:00:00Z`) - Date.parse(`${ap.pending.draft.dateKey}T00:00:00Z`) <= DAY_MS;
        if (!askedOpen || !yesterday) { dropPending(ap.pending.draftId); return; }
      }
      if (useSns.getState().composeOpen) return;
      if (ap.pending.asked && req && !req.decidedAlone && req.answered !== 'post') {
        if (!(req.answered === 'edit' && relaxedWindow(s.phase) === 'bedtime')) return;
      }
      tryPost(t);
      return;
    }
    if (ap.lastPostDay === s.today || ap.skippedDay === s.today || !relaxedWindow(s.phase) || !currentUser()) return;
    settleToday(t);
    const cur = get();
    const d = decidePost(postCtxOf(cur), cur.phase);
    if (d.kind === 'none') return;
    if (d.kind === 'ask') { askPost(d.draft, d.request, true); return; }
    setAgentPost({ pending: { draftId: d.draft.id, dueAt: t, asked: false, draft: d.draft } });
    tryPost(t);
  };
  /** 오늘 굽는 중이거나 실패한 가상 친구 글 id — 실패하면 오늘은 다시 안 굽는다 (id에 날짜가 들어 있어 다음 날은 새 키) */
  const npcTried = new Set<string>();
  /** 가상 친구의 글 (ADR-0021 결정 6): 걔들의 하루 중 한 활동이 끝난 시각이 지나면 컷을 굽고 로컬 문서에 넣는다. 굽기가 없으면(하네스) 아무것도 안 한다 */
  const pumpNpcPosts = (t: number) => {
    const bake = npcBaker;
    if (!bake) return;
    const s = get();
    const sns = useSns.getState();
    const have = (id: string) => npcTried.has(id) || sns.localPosts.some(i => i.post.id === id);
    for (const due of npcPostsDue(s.memory, s.today, t, have)) {
      npcTried.add(due.postId);
      void makeNpcPost(due, { bake, putLocal }).then(
        // 새 가상 친구 글은 피드를 다시 받지 않아도 먼저 좋아요의 후보다 (AFFECTION_SPEC §4) — 설렘 대상은 대개 NPC라 여기서 안 보면 다음 SNS 열기까지 안 눌린다
        item => { const cur = useSns.getState(); cur.setLocalPosts([item, ...cur.localPosts]); get().agentAutoLike([]); },
        () => { /* 굽기·저장 실패 — 오늘은 건너뛴다 */ },
      );
    }
  };

  /**
   * 에이전트가 거는 전화를 굴린다 (ADR-0001 §1): **약속한 전화**뿐이다 — "이따가 전화할게"(고민을 듣고),
   * "지금 걸게"(걸어 달라고 해서) (ADR-0002·ADR-0013). 계획이 어긋난 순간의 통보 전화는 없앴다 — 그 사연은
   * 시간표와 활동 로그에 남는다. 접속 중이면 벨이 울리고, 그 시점이 이미 지나갔으면 **부재중**이 된다 —
   * 그때는 기록만 남고 무슨 얘기였는지는 잃는다. 시각이 지난 약속이 여럿이면 이른 것부터 tick마다 하나씩.
   * @param from 지난 tick의 시각
   * @param t 지금
   */
  const pumpCalls = (from: number, t: number) => {
    const s = get();
    if (s.activeCall) return;
    const promised = [...s.dueCalls].sort((a, b) => a.at - b.at).find(d => d.at <= t);
    if (!promised) return;
    // 그 순간에 앱을 보고 있었나 — 지난 tick도, 약속 시각도 10분 안이어야 한다 (다른 기기에서 받아 온 지난 약속은 부재중)
    const live = t - from < CATCHUP_GAP_MS && t - promised.at < CATCHUP_GAP_MS;
    const rest = s.dueCalls.filter(d => d !== promised);
    const place = s.phase.kind === 'moving' || s.phase.kind === 'active' || s.phase.kind === 'comic' ? s.phase.act.place : null;
    const lines = promised.why === 'worry'
      ? worryLines(promised.worry ?? 'none', promised.id)
      : callLines(place?.type ?? 'home', promised.id);
    const base: CallEvent = { id: `in:${promised.id}`, at: promised.at, dir: 'in', result: 'missed', why: promised.why };
    // 기록엔 내용을 넣지 않는다 — 받아야 붙는다 (answerCall). 벨이 울리는 중에 앱이 꺼져도 저장본에 내용이 남지 않는다
    set({ calls: trimCalls([...s.calls, base], s.anchor.t), dueCalls: rest, activeCall: live ? { ...base, lines } : null });
    persist();
  };

  /**
   * 도착 혼잣말 (ADR-0004 오너 결정 6: 도착 알림은 만들지 않고, 앱을 보고 있을 때 도착 순간 한마디).
   * 이동 중이던 활동이 그대로 활동 중으로 넘어간 순간, 혼자이고(동행·말 튼 마주침 없음) 계획대로 도착했으면
   * 감정 한 줄만 띄운다 — 사진을 찍어 달라는 부탁은 하지 않고, 문자로도 남기지 않는다 (오너 결정 2026-09-07:
   * 문자는 마음이 오갈 때만, 일을 시킬 때가 아니다). 혼잣말이라 몇 초 뒤 사라진다.
   * 마찰이 있던 도착(딴 데 갔든 그 자리에서 버텼든)에는 말하지 않는다 — 그 사연은 활동 로그의 판단 줄과 시간표에 남는다
   * (통보 전화는 ADR-0013에서 없앴다). "오늘 여기 잘 고른 것 같아"가 안 간 곳에서 나오면 이상하다.
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
    clock, now, anchor: w.anchor, days: w.days, today, tz: initialPhase.tz, memory, agents: [...remoteAgents(), ...AGENTS], encounters, status: initialStatus, requests: w.requests, calls: w.calls, activeCall: null, onboarded,
    messages: w.messages, dueCalls: w.dueCalls, chatOpen: false, chatSeen: load<number>(CHAT_SEEN_KEY, now), llmTier: getTier(), tripBusy: null, llmPlans: w.llmPlans, planBusy: false, say: null,
    backend: sync0.backend, sync: sync0.sync, remote: w.remote ?? null,
    shots: w.shots, sketchOpen: null, cameraOpen: false, agentPost: agentPost0, agentLikes: agentLikes0,
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
      // 글: 하루 하나, 여유 있는 창에서 (ADR-0021 결정 5). 가상 친구의 글도 여기서 (결정 6)
      pumpAgentPost(t);
      pumpNpcPosts(t);
      // 전화: 약속한 전화만 (ADR-0013). 접속 중이면 울리고, 지나갔으면 부재중(내용 없음).
      pumpCalls(from, t);
      save(SEEN_KEY, t);
      if (t - from >= CATCHUP_GAP_MS && gap.length) set({ summary: summaryOf(gap, comicFor), gap: { from, to: t } });
      // 서버 생사: 실제 30초마다 (sim 시계가 빨라도 요청이 늘지 않게). 결과는 subscribeSync로 들어온다
      const real = Date.now();
      if (real - lastHealthAt >= HEALTH_EVERY_MS) { lastHealthAt = real; void checkHealth(); }
      // 진짜 사람 (BACKEND-CONTRACT §3.4): 부팅 뒤 내 프로필(서버가 받을 때까지 — 프로필 없는 사용자는 남의 agents/at·친구 목록에서 빠진다 §2.3),
      // 5분마다 친구 목록·친구의 하루
      if (!profileSent && !profileSending && remoteReady()) {
        profileSending = true;
        void publishProfile().then(ok => { profileSending = false; if (ok) { profileSent = true; remoteOkNow(); } else remoteFailedNow(); });
      }
      if (real - lastRemoteAt >= REMOTE_EVERY_MS) void refreshNow(true);
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
    setLook: (look) => {
      const s = get();
      if (look !== undefined && !isLook(look)) return;
      const memory: Memory = { ...s.memory, look };
      if (look === undefined) delete memory.look;
      set({ memory }); save(MEMORY_KEY, memory);
    },
    setSnsProfile: (patch) => {
      const s = get();
      const memory: Memory = { ...s.memory };
      if (patch.gender !== undefined) { if (patch.gender === null) delete memory.gender; else if (patch.gender === 'female' || patch.gender === 'male') memory.gender = patch.gender; }
      if (patch.visibility === 'public' || patch.visibility === 'private') memory.visibility = patch.visibility;
      if (patch.repShotId !== undefined) { if (patch.repShotId === null) delete memory.repShotId; else if (isShotId(patch.repShotId)) memory.repShotId = patch.repShotId; }
      set({ memory }); save(MEMORY_KEY, memory);
      profileSent = false;   // 다음 tick이 PUT /api/me/agent로 보낸다 (없는 칸은 서버가 이전 값을 지킨다, CONTRACT §2.5)
    },
    postNow: () => {
      const s = get();
      // 이미 쥔 초안이 있으면 그걸 지금 (묻는 중이었어도 — DEV가 재촉한 것)
      if (s.agentPost.pending) { postNextTryAt = 0; tryPost(s.now); return; }
      settleToday(s.now);
      const draft = buildDraft(postCtxOf(get()));
      if (!draft) { set({ say: { text: '아직 올릴 컷이 없어', at: s.now } }); return; }
      delete draft.reason;
      setAgentPost({ pending: { draftId: draft.id, dueAt: s.now, asked: false, draft } });
      tryPost(s.now);
    },
    askPostNow: () => {
      const s = get();
      if (s.agentPost.pending) return;   // 이미 묻는 중이거나 올리는 중 — 두 초안을 쥐지 않는다
      settleToday(s.now);
      const base = buildDraft(postCtxOf(get()));
      if (!base) { set({ say: { text: '아직 올릴 컷이 없어', at: s.now } }); return; }
      const draft: PostDraft = { ...base, reason: '지금 이거 올리려는데 봐줄래?' };
      askPost(draft, askRequest(draft, s.now), false);   // 고민 조건·주 2회 상한을 건너뛴다 — 세지 않는다
    },
    resolvePostDraft: (draftId, outcome, postId) => {
      const s = get();
      const t = s.now;
      // 물었던 쪽지는 답한 것으로 (글쓰기 화면에서 끝냈으니 '컷 고치기' 갈래), 통보도 끝난 것으로
      const requests = s.requests.map(r => (r.kind === 'post' && r.refId === draftId ? { ...r, answered: r.answered ?? 'edit', answeredAt: r.answeredAt ?? t, told: true } : r));
      const pending = s.agentPost.pending?.draftId === draftId ? undefined : s.agentPost.pending;   // 다른 초안을 쥐고 있으면 그건 그대로
      if (outcome === 'posted') {
        // 글쓰기 화면이 이미 올렸다 — 여기서는 다시 올리지 않고 한 줄만 남긴다
        const msg = postedLine(t, postId ?? null, draftId);
        set({ requests, messages: trimMessages([...s.messages.filter(m => m.id !== msg.id), msg], s.anchor.t), agentPost: { ...s.agentPost, pending, lastPostDay: s.today, lastPostAt: t } });
      } else {
        // 버린 날은 건너뛴다 (SNS_SPEC §8)
        set({ requests, agentPost: { ...s.agentPost, pending, skippedDay: s.today } });
      }
      useSns.getState().setDraft(null);
      persist();
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
      // shotId는 모양이 맞을 때만 (validShots와 같은 규칙) — 나머지는 옛 경로
      const clean: UserShot = isShotId(shot.shotId) ? shot : (({ shotId: _drop, ...r }) => r)(shot);
      set({ shots: trimShots([...rest, clean], s.anchor.t) });
      persist();
    },
    dropShotId: (shotId) => {
      const s = get();
      const strip = <T extends { shotId?: string }>(x: T): T => (({ shotId: _drop, ...r }) => r as T)(x);
      if (s.shots.some(x => x.shotId === shotId)) {
        set({ shots: s.shots.map(x => (x.shotId === shotId ? strip(x) : x)) });
        persist();
      }
      // 책에 이미 옮겨졌으면(endAt 뒤의 실패) 거기서도 — 안 그러면 픽셀 없는 id가 남아 그 컷은 영영 옛 경로로 그리고 다시 굽지도 않는다
      if (!s.book.some(c => c.panels.some(p => p.shotId === shotId))) return;
      const book = s.book.map(c => (c.panels.some(p => p.shotId === shotId) ? { ...c, panels: c.panels.map(p => (p.shotId === shotId ? strip(p) : p)) } : c));
      for (const [key, cached] of comicCache) { const next = book.find(c => c.id === cached.id); if (next && next !== cached) comicCache.set(key, next); }
      set({ book });
      save(BOOK_KEY, book);
    },
    patchPanelShot: (comicId, panelIndex, shotId) => {
      const s = get();
      if (!isShotId(shotId)) return;
      const i = s.book.findIndex(c => c.id === comicId);
      const c = s.book[i];
      const p = c?.panels[panelIndex];
      if (!c || !p || p.shotId) return;
      const next: Comic = { ...c, panels: c.panels.map((q, k) => (k === panelIndex ? { ...q, shotId } : q)) };
      const book = s.book.map((q, k) => (k === i ? next : q));
      // phase.comic·catch-up 시트는 comicCache에서 나온다 — 같이 바꿔야 다음 tick에 사진이 보인다
      for (const [key, cached] of comicCache) if (cached.id === comicId) comicCache.set(key, next);
      set({ book });
      save(BOOK_KEY, book);
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
      // 글 초안 (SNS_SPEC §8): '그대로 올려'면 지금 올리고, '컷 고치기'면 글쓰기 화면(책의 고르기 모드)을 초안이 채워진 채 연다
      if (r?.kind === 'post') {
        if (choiceId === 'post') { tryPost(s.now); return; }
        if (choiceId === 'edit') {
          const p = get().agentPost.pending;
          const sns = useSns.getState();
          if (p && p.draftId === r.refId) sns.setDraft(p.draft);
          sns.setComposeOpen(true);
          sns.setSnsOpen(true);
          if (get().chatOpen) get().setChatOpen(false);
        }
      }
    },
    noteLike: (authorId) => { set({ agentPost: noteLikeIn(get().agentPost, authorId, get().now) }); persist(); },
    agentAutoLike: (items) => {
      const s = get();
      const sns = useSns.getState();
      // 받은 장(진짜 사람의 글) + 내 폰이 만든 가상 친구 글 — 설렘 대상은 대개 NPC라 걔들 글이 빠지면 이 행동이 안 보인다
      const local = new Set(sns.localPosts.map(i => i.post.id));
      const cands = [...items, ...sns.localPosts].map(i => ({ id: i.post.id, authorId: i.post.authorId, likedByMe: i.post.likedByMe }));
      const { state, picked } = pickAutoLikes(s.memory, cands, s.agentLikes, s.today);
      if (!picked.length) return;
      set({ agentLikes: state }); persist();
      // 주인이 아니라 에이전트가 누른 것 — 주인의 좋아요 기록(noteLike)에 안 적힌다. 서버가 거절하면 sns가 되돌린다 (기록은 남아 다시 안 누른다)
      for (const id of picked) { if (local.has(id)) sns.likeLocalToggle(id, 'agent'); else void sns.likeToggle(id, 'agent'); }
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
      callStartedReal = ok ? Date.now() : null;
      set({ activeCall: call, calls: trimCalls([...s.calls, call], s.anchor.t) });
      persist();
    },
    answerCall: (accept) => {
      const s = get();
      const c = s.activeCall;
      if (!c || c.dir !== 'in') return;
      // 안 받으면 내용은 사라진다 (오너 결정): 기록만 남기고 lines를 버린다. 안 받기를 눌렀든 12초가 지났든 똑같이 부재중이다 (ADR-0004 오너 결정 13)
      const done: CallEvent = accept ? { ...c, result: 'answered', startedAt: s.now } : { ...c, result: 'missed', lines: undefined };
      if (accept) callStartedReal = Date.now();
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
      // 통화 시간은 **실제로 통화한 초**다 — 화면이 붙어 있던 실제 시간을 잰다. 검사 스크립트처럼 sim 시계만 점프했으면
      // sim 경과(배속으로 나눈)가 실제보다 크니 그쪽을 쓴다. 부재중 통화의 `at`은 한참 전일 수 있어 startedAt부터 잰다
      if (c?.result === 'answered' && c.startedAt !== undefined) {
        const speed = s.clock.scale > 0 ? s.clock.scale : 1;
        const simSec = (s.now - c.startedAt) / 1000 / speed;
        const wallSec = callStartedReal !== null ? (Date.now() - callStartedReal) / 1000 : simSec;
        const done: CallEvent = { ...c, durSec: Math.max(1, Math.round(simSec > wallSec + 1 ? simSec : wallSec)) };
        callStartedReal = null;
        set({ activeCall: null, calls: s.calls.map(x => (x.id === c.id ? done : x)) });
        persist();
        if (c.voice) void get().planDay();   // 통화에 양보했던 하루 계획을 이어서
        return;
      }
      callStartedReal = null;
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
      const reply = replyToAll(texts, { phase: s.phase, status: s.status, name: s.memory.name, seed: `${batch}:${texts.length}`, now: s.now, crush: topCrush(s.memory) });
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
      // 약속한 전화 — 규칙이 시각을 실어 주면(못 받는 상황·지쳤다면서 걸어 달란 말) 그 시각, 아니면 답장 뒤 기본 간격
      if (reply.worry) {
        memory = { ...s.memory, worry: { key: reply.worry, at: s.now } };
        save(MEMORY_KEY, memory);
        dueCalls = [...dueCalls, { id: `worry:${batch}`, at: s.now + (reply.callInMs ?? reply.delayMs + WORRY_CALL_MS), why: 'worry', worry: reply.worry }];
      } else if (reply.callMe) {
        dueCalls = [...dueCalls, { id: `ask:${batch}`, at: s.now + (reply.callInMs ?? reply.delayMs + ASK_CALL_MS), why: 'ask' }];
      }
      set({ messages: trimMessages(msgs, s.anchor.t), dueCalls: trimDueCalls(dueCalls, s.anchor.t), memory, chatSeen: s.now });
      persist();
      if (reply.worry) recompute(simNow(get().clock));
      // LLM: 규칙이 정한 시각은 그대로 두고 **말만** 백엔드에 묻는다. 읽씹으로 정해진 묶음은 묻지 않는다.
      if (s.llmTier !== 'off' && reply.text !== undefined) {
        const seq = texts.length;
        const req = requestOf(texts, { phase: s.phase, status: s.status, memory, messages: msgs, now: s.now }, s.llmTier, batch);
        // 규칙 답장이 뜨기 전까지만 기다린다 (sim 시간이 실시간이면 delayMs가 그 여유다)
        const budget = Math.max(4_000, Math.min(30_000, reply.delayMs / Math.max(s.clock.scale, 1) - 1_000));
        // 설렘 대상이 실린 요청의 `text: null`은 침묵이 아니라 서버가 이름을 먼저 꺼낸 답을 버린 것일 수 있다 (ReplyService.leaksCrushName) —
        // 그땐 규칙 답장을 남긴다. 침묵(읽씹)은 잃지만, 아무 답도 안 하는 것보다 낫다 (CONTRACT §2.4)
        const ruleText = reply.text;
        scheduleReply(batch, req, budget, r => get().applyLlmReply(batch, seq, r.text === null && req.situation.crush ? { ...r, text: ruleText } : r));
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
      const askDue = s.dueCalls.find(d => d.id === `ask:${batch}`);
      const worryDue = s.dueCalls.find(d => d.id === `worry:${batch}`);
      const promised = !!askDue || !!worryDue;
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
      // 규칙이 못 알아들은 고민·전화 부탁을 모델이 알아들었으면 그 뒤처리를 여기서 한다 (sendMessage와 같은 규칙 —
      // 못 받는 상황이면 막힌 게 끝난 뒤로 예약하고, 고민과 전화 부탁이 같이 오면 곧 거는 고민 전화다, ADR-0013).
      // 규칙이 이미 약속한 전화는 시각을 지키되 종류는 모델이 올릴 수 있다: 걸어 달란 전화(ask)를 고민 전화로, 38분 뒤 고민 전화를 곧으로
      const replyInMs = Math.max(old.at - now, 0);
      const soon = now + askCallInMs(s.phase, now, replyInMs, batch);
      let heardWorry = false;
      if (r.worry && !worryDue) {
        heardWorry = true;
        memory = { ...s.memory, worry: { key: r.worry, at: now } };
        save(MEMORY_KEY, memory);
        dueCalls = askDue
          ? dueCalls.map(d => (d === askDue ? { id: `worry:${batch}`, at: askDue.at, why: 'worry' as const, worry: r.worry! } : d))
          : [...dueCalls, { id: `worry:${batch}`, at: r.callMe ? soon : old.at + WORRY_CALL_MS, why: 'worry', worry: r.worry }];
      }
      if (r.callMe) {
        const wd = dueCalls.find(d => d.id === `worry:${batch}`);
        if (wd) { if (wd.at > soon) dueCalls = dueCalls.map(d => (d === wd ? { ...d, at: soon } : d)); }
        else if (!askDue) dueCalls = [...dueCalls, { id: `ask:${batch}`, at: soon, why: 'ask' }];
      }
      set({ messages, dueCalls: trimDueCalls(dueCalls, s.anchor.t), memory });
      persist();
      if (heardWorry) recompute(now);
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
    applyRemote: (cache) => {
      const s = get();
      setRemoteCache(cache, { meId: s.sync.userId, homeCity: homeCityOf(s.memory) });
      set({ remote: cache, agents: [...remoteAgents(), ...AGENTS] });
      persist();
      recompute(simNow(get().clock));
    },
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
      void publishProfile().then(ok => { if (!ok) profileSent = false; });   // 이름·취향·성향이 바뀌었다 — 상대 화면의 나도 바뀐다 (§3.4 b). 못 보냈으면 tick이 다시
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
      // 새 하루: 슬롯은 옛 활동 key에 매여 있으니 비우고, 프로필·친구의 하루는 남긴다 (다음 조회가 채운다)
      const remote = s.remote ? { ...s.remote, slots: {} } : null;
      setRemoteCache(remote, { meId: s.sync.userId, homeCity: homeCityOf(s.memory) });
      publishedSig = null;
      set({ clock: c, anchor, days: {}, regen: {}, llmPlans: {}, today: dayKeyIn(t, anchor.tz), tz: anchor.tz, plans: emptyPlans(), timeline: [], summary: null, gap: null, requests: [], calls: [], activeCall: null, selectedBlock: null, messages: [], dueCalls: [], chatOpen: false, say: null, shots: [], sketchOpen: null, cameraOpen: false, remote, agentPost: emptyAgentPost(), agentLikes: emptyAgentLikes() });
      useSns.getState().setDraft(null);
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
