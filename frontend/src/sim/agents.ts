import type { ActivityOption, BlockId, CastFigure, Category, ComicCast, DayKey, Friend, Gender, Look, Memory, Place, PlaceType, PublishedActivity, RemoteAgent, RemoteCache, RemoteHit, ScheduledActivity } from './types';
import { LOOK_HAIR_STYLES, makeDayKey, splitDayKey } from './types';
import { crushStage } from './affection';
import { BLOCK_ORDER, blockAtIn, blockEndAt, blockStartAt } from './blocks';
import { dayKeyIn, dayStartOfKey } from './tz';
import { hasPlace, placeById, registerRemotePlaces, tzOf } from './places';
import { remoteNowOf } from './remote';
import { suggestOptions } from './suggest';
import { estimateJourney } from './journey';
import { rng, seedFrom } from './rng';

// ─── Agents ──────────────────────────────────────────────────────────────────
// Every friend is an agent, and until a server exists an NPC pool stands in for the other users' agents
// (design/FRIENDS_SPEC.md §4). Each agent lives its own day through the same suggestion engine, seeded by
// `${agent.id}:${dayKey}` — so "민수 is at 소이연남 at 19:00" is the same fact on every device and every reload.

export interface Agent {
  id: string;
  name: string;
  homePlaceId: string;
  color: string;          // token colour — the chip border and the character's accessory
  emoji: string;
  likes: string[];
  traits: string[];
  hairStyle?: string;
  /** 성별 (AFFECTION_SPEC §2) — 설렘은 이성에게만. NPC는 풀에 적혀 있고, 진짜 사람은 서버 프로필에서. 없으면 모름 (추정하지 않는다) */
  gender?: Gender;
}

/** 민수·하나 are the seed friends; the six below are other users' agents (the NPC pool) until a server exists. 성별은 넷씩 (ADR-0023 — 가상 친구도 성별을 가진다) */
export const AGENTS: Agent[] = [
  { id: 'minsu',  name: '민수', homePlaceId: 'minsu-home',  color: '#5FC9A6', emoji: '🐥', likes: ['게임', '떡볶이', '한강'],        traits: ['외향적', '수다스러운'], hairStyle: 'short', gender: 'male' },
  { id: 'hana',   name: '하나', homePlaceId: 'hana-home',   color: '#A9DCF5', emoji: '🐰', likes: ['카페', '그림 그리기', '전시'],   traits: ['조용한', '느긋한'],     hairStyle: 'bob',   gender: 'female' },
  { id: 'jiwoo',  name: '지우', homePlaceId: 'jiwoo-home',  color: '#F6C445', emoji: '🐤', likes: ['커피', '책', '산책'],            traits: ['호기심 많은', '외향적'], hairStyle: 'curly', gender: 'male' },
  { id: 'taerin', name: '태린', homePlaceId: 'taerin-home', color: '#5FC9A6', emoji: '🦊', likes: ['전시', '그림 그리기', '빵'],     traits: ['조용한', '섬세한'],     hairStyle: 'long',  gender: 'female' },
  { id: 'doyun',  name: '도윤', homePlaceId: 'doyun-home',  color: '#A9DCF5', emoji: '🐧', likes: ['러닝', '자전거', '한강'],        traits: ['느긋한', '낯가리는'],   hairStyle: 'short', gender: 'male' },
  { id: 'serin',  name: '세린', homePlaceId: 'serin-home',  color: '#FF9A8B', emoji: '🐱', likes: ['영화', '시장', '먹는 거'],       traits: ['수다스러운', '외향적'], hairStyle: 'bob',   gender: 'female' },
  { id: 'hyeon',  name: '현이', homePlaceId: 'hyeon-home',  color: '#8FD694', emoji: '🐢', likes: ['책', '공부', '카페'],            traits: ['조용한', '낯가리는'],   hairStyle: 'short', gender: 'male' },
  { id: 'bomi',   name: '보미', homePlaceId: 'bomi-home',   color: '#6B7BB5', emoji: '🐶', likes: ['음악', '바다', '사진'],          traits: ['호기심 많은', '느긋한'], hairStyle: 'curly', gender: 'female' },
];

const agentIndex = new Map(AGENTS.map(a => [a.id, a]));

// ─── 진짜 사람 에이전트 캐시 (BACKEND-CONTRACT §3.4) ─────────────────────────
// 서버가 붙으면 NPC 풀 자리에 실제 사용자의 발행 일정이 들어온다 (FRIENDS_SPEC §4). buildTimeline은 동기·순수라 fetch를
// 넣을 수 없으므로 스토어가 world.remote 캐시를 여기 모듈 캐시에 옮겨 두고, 아래 함수들은 NPC 인덱스 다음에 이것을 본다.
// 캐시가 비면(오프라인) 전부 NPC 풀 그대로다. NPC id('minsu')와 서버 userId(32자 hex)는 겹치지 않는다.
const remoteIndex = new Map<string, RemoteAgent>();
/** agentId → 발행된 하루들 (AgentActivity로 매핑, arriveAt 순) */
const remoteDays = new Map<string, AgentActivity[]>();
/** agentId → 발행된 활동 원본 (친구 목록의 '지금') */
const remotePublished = new Map<string, PublishedActivity[]>();
/** 내 활동 key → 같은 장소·시간에 있던 진짜 사람들 (agentId 오름차순, 서버가 정렬) */
const remoteSlots = new Map<string, RemoteHit[]>();
/** 내 서버 userId — 진짜 사람과의 굴림 시드에 들어간다 (없으면 캐릭터 이름, NPC와 같다) */
let meId: string | null = null;

/** 발행된 활동 → 에이전트의 하루 한 칸 (agentDayPlan 대체). option.id는 활동 key. */
export const toAgentActivity = (p: PublishedActivity): AgentActivity => ({
  agentId: p.agentId, blockId: p.blockId, placeId: p.placeId, startAt: p.arriveAt, endAt: p.endAt,
  option: { id: p.key, title: p.title, reason: '', emoji: p.emoji, placeId: p.placeId, category: p.category },
});

/**
 * 스토어가 world.remote를 넣는다 (부팅·applyRemote). 집과 활동 장소를 등록해 `placeById`가 throw하지 않게 한다 —
 * 집은 내 도시일 때만 제안 스캔(PLACES)에 보인다 (NPC 집과 같은 조건), 나머지는 id로만.
 *
 * @param cache world.remote (null이면 전부 비운다)
 * @param opts meId = sync.userId, homeCity = 내 집의 도시 키
 */
export function setRemoteCache(cache: RemoteCache | null, opts: { meId: string | null; homeCity?: string }) {
  remoteIndex.clear(); remoteDays.clear(); remotePublished.clear(); remoteSlots.clear();
  meId = opts.meId;
  if (!cache) return;
  const homes: Place[] = [];
  const places = new Map<string, Place>();
  for (const a of Object.values(cache.agents)) { remoteIndex.set(a.id, a); homes.push(a.home); }
  const notePlace = (p: PublishedActivity) => { if (p.place && !hasPlace(p.place.id) && !places.has(p.place.id)) places.set(p.place.id, p.place); };
  for (const [key, hits] of Object.entries(cache.slots)) {
    // agentId 오름차순 — 서버도 그렇게 주지만(§2.3) 결정성은 여기서 한 번 더 보장한다 (met[0]이 곧 상대다)
    const kept = hits.filter(h => remoteIndex.has(h.agentId)).sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
    remoteSlots.set(key, kept);
    for (const h of kept) notePlace(h.activity);
  }
  for (const [id, acts] of Object.entries(cache.days)) {
    if (!remoteIndex.has(id)) continue;
    const sorted = [...acts].sort((a, b) => a.arriveAt - b.arriveAt);
    remotePublished.set(id, sorted);
    remoteDays.set(id, sorted.map(toAgentActivity));
    for (const p of sorted) notePlace(p);
  }
  registerRemotePlaces(homes, p => !!opts.homeCity && p.city === opts.homeCity);
  registerRemotePlaces([...places.values()]);
}

/** 캐시의 진짜 사람들 — id 오름차순 (결정성) */
export const remoteAgents = (): RemoteAgent[] => [...remoteIndex.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
export const isRemoteId = (id: string): boolean => remoteIndex.has(id);
export const remoteMeId = (): string | null => meId;
/** NPC 이름 + 진짜 사람 이름 — 제목에서 지울 이름들 (store.stripNames) */
export const agentNames = (): string[] => [...AGENTS.map(a => a.name), ...remoteAgents().map(a => a.name)];

/**
 * 내 활동 key의 슬롯 (§3.4 timeline): 서버가 그 장소·시간에 있다고 한 사람들. 겹침은 캐시된 활동과 지금 창으로 다시 잰다
 * (경로가 다듬어져 도착이 몇 분 밀려도 같은 규칙). 장소가 그 뒤 바뀐 활동이면 맞는 hit만 남는다. 슬롯이 없으면 null.
 */
export function remoteSlotAt(key: string, placeId: string, from: number, to: number): { agent: Agent; overlapMs: number }[] | null {
  const hits = remoteSlots.get(key);
  if (!hits) return null;
  const out: { agent: Agent; overlapMs: number }[] = [];
  for (const h of hits) {
    const agent = remoteIndex.get(h.agentId);
    if (!agent || h.activity.placeId !== placeId) continue;
    const overlapMs = Math.min(to, h.activity.endAt) - Math.max(from, h.activity.arriveAt);
    if (overlapMs > 0) out.push({ agent, overlapMs });
  }
  return out;
}

/** 진짜 사람 친구의 '지금' — 발행된 활동 중 `arriveAt <= now < endAt` (§3.5) */
export const remoteNow = (agentId: string, now: number): PublishedActivity | null => remoteNowOf(remotePublished.get(agentId), now);

/** NPC 인덱스 → remote 캐시 순 */
export const agentById = (id: string): Agent | null => agentIndex.get(id) ?? remoteIndex.get(id) ?? null;
/** The memory entry a friendship writes — `metAt`/`metPlaceId` come from the encounter that made it. 성별은 알 때만 복사한다 (AFFECTION_SPEC §2) */
export const friendOf = (a: Agent, met?: { at: number; placeId: string }): Friend => ({
  id: a.id, name: a.name, homePlaceId: a.homePlaceId, color: a.color, emoji: a.emoji,
  ...(met ? { metAt: met.at, metPlaceId: met.placeId } : {}),
  ...(a.gender ? { gender: a.gender } : {}),
});
/** A friend resolved back to their agent (the pool is the source of likes/traits/colour). */
export const agentOfFriend = (f: Friend): Agent => agentById(f.id) ?? { ...f, likes: [], traits: [] };

// ─── 사진 속 인물 (FRIENDS_SPEC §6 표, ADR-0022) ─────────────────────────────
// 같은 공간(co-present)과 같이 놀기(companion)는 그림에서 갈린다: 동행은 같은 프레임에 정면, 배경 인물은 뒷모습·작게·얼굴 없이.
// 말을 건 상대는 `encounter.at` 전엔 배경의 한 사람이고 그 뒤부터 정면이다 — 화면(방·카메라·만화)은 전부 이 한 함수로 "그 순간의 인물"을 받는다.

/** 에이전트의 머리 모양 — 풀·서버 값이 여섯 칸의 허용값일 때만 (아니면 기본 단발) */
export const hairStyleOf = (a: Agent | null | undefined): Look['hairStyle'] | undefined =>
  a && (LOOK_HAIR_STYLES as readonly string[]).includes(a.hairStyle ?? '') ? (a.hairStyle as Look['hairStyle']) : undefined;

const figureOf = (a: Agent): CastFigure => { const h = hairStyleOf(a); return h ? { id: a.id, color: a.color, hairStyle: h } : { id: a.id, color: a.color }; };
/** 배경 인물이 설렘 대상(관심부터)이면 뒷모습 대신 슬쩍 돌아본 모습 (AFFECTION_SPEC §4) — 그 순간의 memory가 정하고, 만화는 그 결과를 cast에 기억한다 */
const glancing = (memory: Memory, fig: CastFigure): CastFigure => (crushStage(memory.friends.find(f => f.id === fig.id)?.crush?.v) ? { ...fig, glance: true } : fig);

/** 배경 인물은 최대 둘 (카메라 무대의 왼쪽·오른쪽 뒤) */
export const PRESENT_MAX = 2;
/** 굴림 상대를 배경의 맨 앞에 — presentNearby는 셋까지 남기지만 그림은 둘이라, id 순서에서 밀리면 대화 전에 아예 안 보이고 `at`에 불쑥 나타난다. 나머지는 id 오름차순 그대로 */
const keepFirst = <T>(xs: T[], isKeep: (x: T) => boolean): T[] => [...xs.filter(isKeep), ...xs.filter(x => !isKeep(x))];

/** `castAt`의 결과 — 동행(정면), 만난 사람(`at` 뒤, 정면·손 흔듦), 같은 공간의 사람들(뒷모습, ≤ 2) */
export interface Cast {
  companions: Friend[];
  met?: { agent: Agent; color: string; hairStyle?: Look['hairStyle'] };
  present: CastFigure[];
}

/**
 * 순수: 활동 `act`의 `t` 순간에 그림에 나올 사람들. 동행은 memory.friends(없으면 풀)에서, 만난 사람은 `encounter.talked && t ≥ encounter.at`일 때만,
 * 배경은 `presentNearby`에서 만난 사람을 뺀 둘 — 굴림 상대가 아직 배경이면 맨 앞(잘리지 않게). `at`이 없는 옛 마주침은 처음부터 만난 것으로 본다.
 */
export function castAt(act: ScheduledActivity, t: number, memory: Memory): Cast {
  const companions = act.companions
    .map(id => memory.friends.find(f => f.id === id) ?? (agentById(id) ? friendOf(agentById(id)!) : null))
    .filter((f): f is Friend => !!f);
  const e = act.encounter;
  const friendMet = e && memory.friends.find(f => f.id === e.agentId);
  const metAgent = e && e.talked && t >= (e.at ?? -Infinity) ? agentById(e.agentId) ?? (friendMet ? agentOfFriend(friendMet) : null) : null;
  const met = metAgent ? { agent: metAgent, color: metAgent.color, hairStyle: hairStyleOf(metAgent) } : undefined;
  const present = keepFirst((act.presentNearby ?? []).filter(id => id !== metAgent?.id && !act.companions.includes(id)), id => id === e?.agentId)
    .map(id => agentById(id)).filter((a): a is Agent => !!a)
    .slice(0, PRESENT_MAX).map(a => glancing(memory, figureOf(a)));
  return met ? { companions, met, present } : { companions, present };
}

/** 만화가 기억할 인물 구성 (Comic.cast) — makeComic이 활동에서 뽑는다. 난수 없음 */
export function comicCastOf(act: ScheduledActivity, memory: Memory): ComicCast {
  const companions = act.companions
    .map(id => { const a = agentById(id); const f = memory.friends.find(x => x.id === id); return a ? figureOf(a) : f ? { id: f.id, color: f.color } : null; })
    .filter((x): x is CastFigure => !!x);
  const e = act.encounter;
  // 굴림 상대(말을 텄든 아니든)가 맨 앞 — castOfComic이 둘로 자를 때 잘리지 않게. 나머지는 presentNearby 순서(id 오름차순)
  const present = keepFirst((act.presentNearby ?? []).filter(id => !act.companions.includes(id)), id => id === e?.agentId).map(id => agentById(id)).filter((a): a is Agent => !!a).map(a => glancing(memory, figureOf(a)));
  const metAgent = e?.talked ? agentById(e.agentId) : null;
  const met = metAgent ? { ...figureOf(metAgent), at: e!.at ?? act.arriveAt } : undefined;
  return met ? { companions, met, present } : { companions, present };
}

/** 저장된 인물 구성(Comic.cast)에서 컷 시각 `t`의 그림 — castAt과 같은 규칙, 옛 활동이 지워진 뒤에도 같은 컷. 배경 인물의 `glance`는 찍힐 때 기억한 그대로 */
export function castOfComic(cast: ComicCast, t: number): { companions: CastFigure[]; met?: CastFigure; present: CastFigure[] } {
  const met = cast.met && t >= cast.met.at ? { id: cast.met.id, color: cast.met.color, ...(cast.met.hairStyle ? { hairStyle: cast.met.hairStyle } : {}) } : undefined;
  const present = keepFirst(cast.present.filter(p => p.id !== met?.id), p => p.id === cast.met?.id).slice(0, PRESENT_MAX);
  return met ? { companions: cast.companions, met, present } : { companions: cast.companions, present };
}

// ─── "알게 된 것" (FRIENDS_SPEC §6, ADR-0022 결정 6) ──────────────────────────
/** 장소 유형별 한 줄 후보 — 같이 놀 때마다 하나씩 memory.friends[id].learned에 쌓인다 (친한 친구 프로필의 접기 토글) */
const LEARNED_BY_TYPE: Partial<Record<PlaceType, string[]>> = {
  cafe: ['커피 마시며 수다 떠는 걸 좋아함', '아메리카노만 마심', '창가 자리 좋아함'],
  restaurant: ['잘 먹음', '매운 거 잘 먹음', '반찬 리필 잘 함'],
  park: ['걷는 거 좋아함', '강아지 보면 멈춤'], river: ['강바람 쐬는 거 좋아함', '자전거 잘 탐'],
  gym: ['운동 열심히 함', '러닝머신파'], library: ['조용한 데 좋아함', '책 빨리 읽음'], museum: ['전시 보면 설명문 다 읽음'],
  bar: ['술 잘 마심', '안주 잘 고름'], cinema: ['영화 취향 비슷함', '쿠키 영상까지 봄'], arcade: ['게임 잘함', '인형뽑기 집착'],
  market: ['길거리 음식 좋아함', '흥정 잘함'], beach: ['바다 좋아함'], island: ['바다 좋아함'], mountain: ['산 잘 탐'],
  mall: ['구경 좋아함', '옷 고르는 데 오래 걸림'], home: ['집에서 노는 거 좋아함'], friend_home: ['집 깔끔함', '집에서 노는 거 좋아함'],
  temple: ['조용한 데 좋아함'], hotel: ['짐 많음'],
};
export const LEARNED_CAP = 12;
/** "카페 레이어드 연남에서 그림 그리기" → "그림 그리기" (screens/util.shortTitle과 같은 규칙 — sim은 screens를 못 본다) */
const stemOf = (title: string) => { const s = title.replace(/^.*?(에서|에|까지)\s?/, '').replace(/\(\d박\)$/, '').trim(); return s || title; };

/**
 * 같이 논 활동에서 상대에 대해 알게 된 한 줄 — 규칙·결정적 (시드 `learn:${act.key}:${id}`), 이미 적힌 줄은 피한다.
 * 후보: 장소 유형 줄 · "{장소} 자주 감" · "{범주} 좋아함" · "{활동} 같이 함". 후보가 다 적혀 있으면 null (더 알 게 없다)
 */
export function learnedLine(act: ScheduledActivity, id: string, categoryLabel: string, already: readonly string[]): string | null {
  const r = rng(`learn:${act.key}:${id}`);
  const pool = [
    ...(LEARNED_BY_TYPE[act.place.type] ?? []),
    `${act.place.name} 자주 감`, `${categoryLabel} 좋아함`, `${stemOf(act.option.title)} 같이 함`,
  ];
  return r.shuffle(pool).find(l => !already.includes(l)) ?? null;
}
/** learned에 한 줄 덧붙인다 — 중복 없이, 최근 12개만 */
export const appendLearned = (learned: readonly string[] | undefined, line: string | null): string[] => {
  const cur = learned ?? [];
  if (!line || cur.includes(line)) return [...cur];
  return [...cur, line].slice(-LEARNED_CAP);
};

// ─── an agent's own day ──────────────────────────────────────────────────────
/** One block of an agent's day, in absolute ms (its home zone). */
export interface AgentActivity {
  agentId: string;
  blockId: BlockId;
  option: ActivityOption;
  placeId: string;
  startAt: number;    // arrival (block start + the estimated journey)
  endAt: number;
}

const MEAL_BLOCKS: ReadonlySet<BlockId> = new Set<BlockId>(['morning', 'lunch', 'evening']);
const AGENT_CATEGORIES: Category[] = ['play', 'exercise', 'study', 'work', 'rest'];
const MIN_ACTIVITY_MS = 20 * 60_000;
const WRAP_MS = 25 * 60_000;

/** An agent's memory: its own likes and traits, no friends (agents don't propose companions to each other). */
const memoryOf = (a: Agent): Memory => ({ name: a.name, likes: a.likes, dislikes: [], traits: a.traits, homePlaceId: a.homePlaceId, friends: [], visited: [] });

const planCache = new Map<string, AgentActivity[]>();

/**
 * The agent's day, lived with the same engine the owner's agent uses: meal blocks eat, the rest is a random
 * non-travel category, the first suggestion wins, journeys are estimated. Deterministic per agent + day.
 */
export function agentDayPlan(agent: Agent, dayKey: DayKey, tz?: string): AgentActivity[] {
  // 진짜 사람의 하루는 이 엔진이 아니라 그 사람의 프런트가 만든 것 — 발행된 것 중 그 날(같은 dayKey, 없으면 같은 날짜)
  if (remoteIndex.has(agent.id)) {
    const all = remotePublished.get(agent.id) ?? [];
    const exact = all.filter(p => p.dayKey === dayKey);
    const date = splitDayKey(dayKey).dateKey;
    return (exact.length ? exact : all.filter(p => splitDayKey(p.dayKey).dateKey === date)).map(toAgentActivity);
  }
  // 프로필이 캐시에 없는 진짜 사람 친구(memory.friends엔 있는데 world.remote가 비었다 — 저장 실패·검증 탈락·dev 가드): 집이 표에 없으니
  // 이 엔진으로 하루를 만들 수 없다. 빈 하루(자유·집)로 — placeById가 throw해 부팅(decide)·친구 목록이 죽지 않게
  if (!hasPlace(agent.homePlaceId)) return [];
  tz ??= tzOf(placeById(agent.homePlaceId));
  const key = `${agent.id}:${dayKey}:${tz}`;
  const cached = planCache.get(key);
  if (cached) return cached;
  const localKey = makeDayKey(splitDayKey(dayKey).dateKey, tz);
  const dayStart = dayStartOfKey(localKey);
  const memory = memoryOf(agent);
  const out: AgentActivity[] = [];
  let from = placeById(agent.homePlaceId);
  const used: string[] = [];
  for (const blockId of BLOCK_ORDER) {
    if (blockId === 'sleep') continue;
    const r = rng(`${agent.id}:${localKey}:${blockId}`);
    const category = MEAL_BLOCKS.has(blockId) ? 'meal' : r.pick(AGENT_CATEGORIES);
    const options = suggestOptions({ dateKey: localKey, blockId, category, memory, from, usedPlaceIds: used, regenSalt: seedFrom(agent.id) % 997 });  // per-agent salt so two agents never share a day
    const option = options[0];
    if (!option) continue;
    const place = placeById(option.placeId);
    const start = blockStartAt(dayStart, blockId);
    const startAt = start + estimateJourney(from, place).totalMin * 60_000;
    const endAt = Math.max(startAt + MIN_ACTIVITY_MS, blockEndAt(dayStart, blockId) - WRAP_MS);
    out.push({ agentId: agent.id, blockId, option, placeId: place.id, startAt, endAt });
    used.push(place.id);
    from = place;
  }
  planCache.set(key, out);
  return out;
}

/** That agent's plan for one block of a day (null when it has none). */
export function agentActivityAt(agent: Agent, blockId: BlockId, dayKey: DayKey): AgentActivity | null {
  return agentDayPlan(agent, dayKey).find(a => a.blockId === blockId) ?? null;
}

/**
 * 그 블록에 비어 있는가 — no plan, at its own home, or resting. A free agent can be asked along; a busy one can
 * only be met where it already is.
 */
export function isAgentFreeAt(agent: Agent, blockId: BlockId, dayKey: DayKey): boolean {
  const act = agentActivityAt(agent, blockId, dayKey);
  if (!act) return true;
  if (act.placeId === agent.homePlaceId) return true;
  return act.option.category === 'rest';
}

/** Is the agent at home in that block? (친구 집 제안 규칙: only then is their home a candidate.) */
export function isAgentHomeAt(agent: Agent, blockId: BlockId, dayKey: DayKey): boolean {
  const act = agentActivityAt(agent, blockId, dayKey);
  return !act || act.placeId === agent.homePlaceId;
}

/**
 * Agents whose own activity overlaps [from, to) at `placeId`, with the overlap in ms. Deterministic order —
 * 진짜 사람 먼저(id 순), 그 다음 NPC 풀 (BACKEND-CONTRACT §3.4). 캐시가 비면 NPC 풀 그대로다.
 */
export function agentsAt(placeId: string, from: number, to: number, agents: Agent[] = [...remoteAgents(), ...AGENTS]): { agent: Agent; overlapMs: number }[] {
  const out: { agent: Agent; overlapMs: number }[] = [];
  for (const agent of agents) {
    if (remoteIndex.has(agent.id)) {
      // 발행된 하루는 날짜로 안 나눈다 — 시각으로 겹침만 잰다 (그 사람의 dayKey는 그 사람의 시간대)
      let overlapMs = 0;
      for (const act of remoteDays.get(agent.id) ?? []) {
        if (act.placeId !== placeId) continue;
        overlapMs += Math.max(0, Math.min(to, act.endAt) - Math.max(from, act.startAt));
      }
      if (overlapMs > 0) out.push({ agent, overlapMs });
      continue;
    }
    const tz = tzOf(placeById(agent.homePlaceId));
    const keys = [dayKeyIn(from, tz), dayKeyIn(to, tz)].filter((k, i, a) => a.indexOf(k) === i);
    let overlapMs = 0;
    for (const k of keys) for (const act of agentDayPlan(agent, k, tz)) {
      if (act.placeId !== placeId) continue;
      overlapMs += Math.max(0, Math.min(to, act.endAt) - Math.max(from, act.startAt));
    }
    if (overlapMs > 0) out.push({ agent, overlapMs });
  }
  return out;
}

// ─── 말 걸 확률 (FRIENDS_SPEC §4) ────────────────────────────────────────────
const OUTGOING = ['호기심 많은', '외향적', '수다스러운'];
const SHY = ['느긋한', '조용한', '낯가리는'];
const EASY_PLACES: ReadonlySet<PlaceType> = new Set<PlaceType>(['bar', 'market', 'park']);
const HARD_PLACES: ReadonlySet<PlaceType> = new Set<PlaceType>(['library', 'office']);
const HOUR_MS = 3600_000;

/** 성향이 사교성에 주는 보정 (+0.15 ~ −0.15). 말 걸기 확률이 쓴다. */
export const traitShift = (traits: string[]) =>
  (traits.some(t => OUTGOING.includes(t)) ? 0.15 : 0) - (traits.some(t => SHY.includes(t)) ? 0.15 : 0);

/** 0.1–0.9. Base 35 %, moved by both sides' traits, shared likes, how long we sat there, the place, and history. */
export function talkChance(input: {
  myTraits: string[]; myLikes: string[]; agent: Agent; placeType: PlaceType; overlapMs: number; metBefore: boolean;
}): number {
  const { myTraits, myLikes, agent, placeType, overlapMs, metBefore } = input;
  let p = 0.35;
  p += traitShift(myTraits);
  p += traitShift(agent.traits);
  const shared = myLikes.filter(l => agent.likes.includes(l)).length;
  p += Math.min(0.30, shared * 0.10);
  if (overlapMs >= HOUR_MS) p += 0.10;
  if (EASY_PLACES.has(placeType)) p += 0.10;
  if (HARD_PLACES.has(placeType)) p -= 0.15;
  if (metBefore) p += 0.20;
  return Math.min(0.9, Math.max(0.1, p));
}

/** The deterministic roll itself — seed = 날짜 + 장소 + 둘의 id (FRIENDS_SPEC §4). */
export const rollTalk = (dayKey: DayKey, placeId: string, meId: string, agentId: string, chance: number): boolean =>
  rng(`${dayKey}:${placeId}:${meId}:${agentId}`).next() < chance;

/**
 * 진짜 사람끼리의 굴림 (BACKEND-CONTRACT §3.4): 시드 `${dayKey}:${placeId}:${[meId, otherId].sort().join(':')}` — 두 id를
 * 정렬하므로 A의 기기와 B의 기기가 같은 결과를 본다 (A만 말 건 비대칭이 없다). NPC 상대는 `rollTalk` 그대로(기존 결과 보존).
 */
export const rollTalkRemote = (dayKey: DayKey, placeId: string, meId: string, otherId: string, chance: number): boolean => {
  const [x, y] = [meId, otherId].sort();
  return rollTalk(dayKey, placeId, x, y, chance);
};

// ─── 친구 목록의 '지금' (BACKEND-CONTRACT §3.5) ──────────────────────────────
export type FriendNow = { kind: 'sleep' } | { kind: 'home' } | { kind: 'act'; blockId: BlockId; title: string };

/**
 * 친구가 지금 뭘 하나. NPC는 내 블록·내 하루로 하루 계획을 읽고(전과 같다), 진짜 사람은 발행된 활동 중 `arriveAt <= now < endAt`인
 * 것으로 — 시차 있는 친구는 내 블록으로 자르면 어긋난다. 발행된 게 없으면 그 사람 집의 시간대로 자는 중/집인지 본다.
 */
export function friendNow(f: Friend, now: number, myTz: string, today: DayKey): FriendNow {
  // 캐시에 없는 진짜 사람 친구(집이 표에 없다)도 NPC 엔진이 아니라 이 길로 — 발행된 게 없으니 집/자는 중
  if (remoteIndex.has(f.id) || !hasPlace(f.homePlaceId)) {
    const p = remoteNow(f.id, now);
    if (p) return { kind: 'act', blockId: p.blockId, title: p.title };
    let tz = myTz;
    try { tz = tzOf(placeById(f.homePlaceId)); } catch { /* 집을 모르면 내 시간대로 */ }
    return blockAtIn(now, tz) === 'sleep' ? { kind: 'sleep' } : { kind: 'home' };
  }
  const blockId = blockAtIn(now, myTz);
  if (blockId === 'sleep') return { kind: 'sleep' };
  const a = agentActivityAt(agentOfFriend(f), blockId, today);
  return a ? { kind: 'act', blockId, title: a.option.title } : { kind: 'home' };
}

// ─── companion suggestions (FRIENDS_SPEC §3) ────────────────────────────────
/** What `suggestOptions` needs to know to offer at most one companion variant per category. */
export interface CompanionCtx {
  /** friends who may be asked along in this block (free, or already going to the place) */
  free: (friendId: string) => boolean;
  atPlace: (friendId: string, placeId: string) => boolean;
  /** a friend's home is a candidate only from the day after we met, and only while they are in it */
  homeOk: (friendId: string) => boolean;
}

/** Build the companion context for one block of `dayKey`; `dayStart` gates new friends' homes to the next day. */
export function companionCtx(memory: Memory, blockId: BlockId, dayKey: DayKey, dayStart: number): CompanionCtx {
  const agentFor = (id: string) => { const f = memory.friends.find(x => x.id === id); return f ? agentOfFriend(f) : null; };
  return {
    free: id => { const a = agentFor(id); return !!a && isAgentFreeAt(a, blockId, dayKey); },
    atPlace: (id, placeId) => { const a = agentFor(id); return !!a && agentActivityAt(a, blockId, dayKey)?.placeId === placeId; },
    homeOk: id => {
      const f = memory.friends.find(x => x.id === id);
      const a = f && agentFor(id);
      if (!f || !a) return false;
      if (f.metAt !== undefined && f.metAt >= dayStart) return false;   // 새 친구의 집은 다음 날부터
      return isAgentHomeAt(a, blockId, dayKey);
    },
  };
}
