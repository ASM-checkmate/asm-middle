import type { ActivityOption, BlockId, Category, DayKey, Friend, Memory, PlaceType } from './types';
import { makeDayKey, splitDayKey } from './types';
import { BLOCK_ORDER, blockEndAt, blockStartAt } from './blocks';
import { dayKeyIn, dayStartOfKey } from './tz';
import { placeById, tzOf } from './places';
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
}

/** 민수·하나 are the seed friends; the six below are other users' agents (the NPC pool) until a server exists. */
export const AGENTS: Agent[] = [
  { id: 'minsu',  name: '민수', homePlaceId: 'minsu-home',  color: '#5FC9A6', emoji: '🐥', likes: ['게임', '떡볶이', '한강'],        traits: ['외향적', '수다스러운'], hairStyle: 'short' },
  { id: 'hana',   name: '하나', homePlaceId: 'hana-home',   color: '#A9DCF5', emoji: '🐰', likes: ['카페', '그림 그리기', '전시'],   traits: ['조용한', '느긋한'],     hairStyle: 'bob' },
  { id: 'jiwoo',  name: '지우', homePlaceId: 'jiwoo-home',  color: '#F6C445', emoji: '🐤', likes: ['커피', '책', '산책'],            traits: ['호기심 많은', '외향적'], hairStyle: 'curly' },
  { id: 'taerin', name: '태린', homePlaceId: 'taerin-home', color: '#5FC9A6', emoji: '🦊', likes: ['전시', '그림 그리기', '빵'],     traits: ['조용한', '섬세한'],     hairStyle: 'long' },
  { id: 'doyun',  name: '도윤', homePlaceId: 'doyun-home',  color: '#A9DCF5', emoji: '🐧', likes: ['러닝', '자전거', '한강'],        traits: ['느긋한', '낯가리는'],   hairStyle: 'short' },
  { id: 'serin',  name: '세린', homePlaceId: 'serin-home',  color: '#FF9A8B', emoji: '🐱', likes: ['영화', '시장', '먹는 거'],       traits: ['수다스러운', '외향적'], hairStyle: 'bob' },
  { id: 'hyeon',  name: '현이', homePlaceId: 'hyeon-home',  color: '#8FD694', emoji: '🐢', likes: ['책', '공부', '카페'],            traits: ['조용한', '낯가리는'],   hairStyle: 'short' },
  { id: 'bomi',   name: '보미', homePlaceId: 'bomi-home',   color: '#6B7BB5', emoji: '🐶', likes: ['음악', '바다', '사진'],          traits: ['호기심 많은', '느긋한'], hairStyle: 'curly' },
];

const agentIndex = new Map(AGENTS.map(a => [a.id, a]));
export const agentById = (id: string): Agent | null => agentIndex.get(id) ?? null;
/** The memory entry a friendship writes — `metAt`/`metPlaceId` come from the encounter that made it. */
export const friendOf = (a: Agent, met?: { at: number; placeId: string }): Friend =>
  met ? { id: a.id, name: a.name, homePlaceId: a.homePlaceId, color: a.color, emoji: a.emoji, metAt: met.at, metPlaceId: met.placeId }
      : { id: a.id, name: a.name, homePlaceId: a.homePlaceId, color: a.color, emoji: a.emoji };
/** A friend resolved back to their agent (the pool is the source of likes/traits/colour). */
export const agentOfFriend = (f: Friend): Agent => agentById(f.id) ?? { ...f, likes: [], traits: [] };

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

// ─── 합의 오버라이드 (docs/adr/0001-agentness.md §6.5 — 오너 결정) ────────────
// 조율이 타결되면 **상대 에이전트의 하루도 그에 맞춰 바뀐다.** 그래야 친구 목록의
// "민수 지금 뭐 하는 중"도 약속과 맞고, 마주침도 어긋나지 않는다.
// `agentDayPlan`은 여전히 (agent, dayKey, overrides)에 대해 결정적이다 — overrides가 지속 상태이므로.
/** 키 = `${agentId}:${dayKey}:${blockId}` */
const agentOverrides = new Map<string, { placeId: string; title: string; category: Category }>();

/**
 * 타결된 약속들을 에이전트 시뮬레이터에 반영한다. 스토어가 부팅 때와 조율이 바뀔 때 부른다.
 * 영향받는 (agent, day)의 캐시만 지운다.
 *
 * @param deals 타결된 약속들 (`agentId` · `dayKey` · `blockId` · 장소)
 */
export function applyDeals(deals: { agentId: string; dayKey: DayKey; blockId: BlockId; placeId: string; title: string; category: Category }[]): void {
  agentOverrides.clear();
  for (const d of deals) {
    agentOverrides.set(`${d.agentId}:${d.dayKey}:${d.blockId}`, { placeId: d.placeId, title: d.title, category: d.category });
  }
  planCache.clear();   // 오버라이드가 바뀌면 그 날의 계획을 다시 만든다
}

/**
 * The agent's day, lived with the same engine the owner's agent uses: meal blocks eat, the rest is a random
 * non-travel category, the first suggestion wins, journeys are estimated. Deterministic per agent + day.
 */
export function agentDayPlan(agent: Agent, dayKey: DayKey, tz: string = tzOf(placeById(agent.homePlaceId))): AgentActivity[] {
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
    // 약속이 잡힌 블록은 그 약속이 이긴다 (오너 결정: 타결되면 상대 하루도 바뀐다)
    const ov = agentOverrides.get(`${agent.id}:${localKey}:${blockId}`);
    const option = ov
      ? { id: `deal-${blockId}`, title: ov.title, reason: '약속', emoji: '🤝', placeId: ov.placeId, category: ov.category }
      : options[0];
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

/** Agents whose own activity overlaps [from, to) at `placeId`, with the overlap in ms. Deterministic order. */
export function agentsAt(placeId: string, from: number, to: number, agents: Agent[] = AGENTS): { agent: Agent; overlapMs: number }[] {
  const out: { agent: Agent; overlapMs: number }[] = [];
  for (const agent of agents) {
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

/** 성향이 사교성에 주는 보정 (+0.15 ~ −0.15). 말 걸기와 조율 수락 확률이 같은 값을 쓴다. */
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
