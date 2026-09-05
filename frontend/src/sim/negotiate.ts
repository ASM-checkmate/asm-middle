import type { ActivityOption, BlockId, Category, DayKey, Memory, Place } from './types';
import type { ChatMsg } from './chat';
import type { RefusalReason } from './review';
import { narrate } from './narrate';
import { affinityOf, type Status } from './status';
import { BLOCK_ORDER, blockDef, blockIndex, blockStartAt } from './blocks';
import { dayStartOfKey } from './tz';
import { PLACES, placeById } from './places';
import { agentById, agentDayPlan, traitShift, type Agent } from './agents';
import { rng } from './rng';

// ─── 조율 (docs/adr/0003-nego-offscreen.md, FRIENDS_SPEC §2) ─────────────────
// 한쪽이 일방적으로 채우지 않는다. 내 에이전트가 먼저 제안하고, 상대가 받거나 거절하거나
// 다른 시간을 부른다. **조율은 실패할 수 있고, 상대는 거짓말할 수 있다.**
//
// 화면 규칙: **왕복은 화면에 나오지 않는다.** 사용자가 보는 것은 결말 한두 줄(`outcomeLines`)과
// 타결이 얹힌 생활계획표뿐이다. 상대 에이전트도 그리지 않는다 — 나가는 말은 전부 내 에이전트의
// 1인칭이고, 상대의 **진짜 이유(`trueReason`)는 저장은 되지만 화면으로 나가는 길이 없다**
// (narrate의 입력 타입에 그 필드가 없어서 컴파일러가 막는다).

export type NegotiationState =
  | 'asking-owner'   // 주인에게 허락을 구하는 중
  | 'open'           // 상대와 왕복 중
  | 'agreed'         // 타결
  | 'broken'         // 결렬
  | 'denied';        // 주인이 안 된다고 했다

export interface NegotiationRound {
  by: 'me' | 'them';
  kind: 'offer' | 'counter' | 'accept' | 'refuse';
  blockId: BlockId;
  placeId: string;
  at: number;
  /** 상대가 입 밖에 낸 이유 — 화면에 인용 줄로 나간다 */
  saidReason?: RefusalReason;
  /** 진짜 이유. 저장은 하되 절대 narrate로 넘기지 않는다 */
  trueReason?: RefusalReason;
  /** 내 에이전트의 추측 — 틀릴 수 있다. 화면에 나가는 건 이것뿐 */
  guess?: RefusalReason;
}

export interface Negotiation {
  /** `${dayKey}:${agentId}:${blockId}` */
  id: string;
  dayKey: DayKey;
  agentId: string;
  /** 처음 제안한 블록 */
  blockId: BlockId;
  wish: { placeId: string; title: string; category: Category };
  rounds: NegotiationRound[];
  state: NegotiationState;
  /** 타결된 약속 */
  deal?: { blockId: BlockId; placeId: string; title: string; category: Category };
  /** 양보 장부 (rounds로 재계산 가능하지만 캐시해 둔다) */
  conceded?: { me: number; them: number };
  openedAt: number;
  /** 다음 라운드가 열리는 시각 */
  nextAt: number;
  closedAt?: number;
}

/** 라운드 사이의 간격 (sim ms) — 조율은 즉답이 아니라 시간이 걸린다. */
export const ROUND_GAP_MS = 22 * 60_000;
/** 최대 왕복 수. 넘으면 결렬된다. */
export const MAX_ROUNDS = 5;
/** 이 아래로 친하지 않으면 같이 놀자고 하지 않는다. */
export const WISH_AFFINITY = 34;

/** 소셜하게 허용되는 핑계 — 거짓말은 여기서만 고른다. */
const SOFT_LIES: RefusalReason[] = ['too-tired', 'no-money', 'clashes'];
/** 내 에이전트가 잘 맞히는 성향 / 그냥 믿는 성향. */
const SHARP = ['호기심 많은', '수다스러운', '섬세한'];
const TRUSTING = ['느긋한', '조용한'];

/** 조율에 쓸 만한 장소 유형 (같이 가서 재밌는 곳). */
const FUN: ReadonlySet<Place['type']> = new Set(['cafe', 'park', 'river', 'restaurant', 'market', 'arcade', 'bar', 'mall', 'beach', 'cinema']);

/**
 * 에이전트가 오늘 "누구랑 뭐 하고 싶다"는 생각을 하는가. 하루 한 건, 결정론적.
 *
 * @param dayKey 오늘
 * @param memory 친구 목록
 * @param status 친밀도를 읽는다
 * @param now 지금
 * @returns 허락을 구하는 상태의 조율 하나, 없으면 null
 */
export function wishFor(dayKey: DayKey, memory: Memory, status: Status, now: number): Negotiation | null {
  const r = rng(`wish:${dayKey}`);
  const close = memory.friends.filter(f => affinityOf(status, f) >= WISH_AFFINITY);
  if (!close.length) return null;
  if (r.next() > 0.55) return null;                   // 매일 조르지는 않는다
  const friend = r.pick(close);
  // 아직 안 온 블록 중 하나 (밤과 수면은 뺀다)
  const dayStart = dayStartOfKey(dayKey);
  const future = BLOCK_ORDER.filter(b => b !== 'sleep' && b !== 'morning' && blockStartAt(dayStart, b) > now);
  if (!future.length) return null;
  const blockId = r.pick(future);
  const spots = PLACES.filter(p => FUN.has(p.type) && p.city === placeById(memory.homePlaceId).city);
  if (!spots.length) return null;
  const place = r.pick(spots);
  return {
    id: `${dayKey}:${friend.id}:${blockId}`,
    dayKey, agentId: friend.id, blockId,
    wish: { placeId: place.id, title: `${place.name}에서 같이 놀기`, category: 'play' },
    rounds: [], state: 'asking-owner', openedAt: now, nextAt: now + ROUND_GAP_MS,
  };
}

/** 상대가 그 블록에 이미 뭔가를 하고 있는가 (진짜 이유의 근거). */
function busyAt(agent: Agent, dayKey: DayKey, blockId: BlockId): boolean {
  const plan = agentDayPlan(agent, dayKey);
  const a = plan.find(x => x.blockId === blockId);
  return !!a && a.placeId !== agent.homePlaceId;
}

/**
 * 상대가 이 제안을 받아들일 확률. `talkChance`와 같은 모양이라 옆에 두고 읽으면 된다.
 *
 * @param agent 상대
 * @param memory 내 취향 (겹치면 잘 받아 준다)
 * @param affinity 지금 친밀도
 * @param free 그 블록이 비어 있는가
 */
export function acceptChance(agent: Agent, memory: Memory, affinity: number, free: boolean): number {
  let p = 0.5;
  p += free ? 0.25 : -0.25;
  p += traitShift(agent.traits);
  p += Math.min(0.24, memory.likes.filter(l => agent.likes.includes(l)).length * 0.08);
  p += affinity / 400;
  return Math.min(0.9, Math.max(0.1, p));
}

/**
 * 상대의 한 라운드. 순수 함수 — 상대의 하루와 성향, 시드로만 정해진다.
 * 진짜 이유와 입 밖에 낸 이유가 다를 수 있다 (낯가리는·조용한 성향일수록 부드러운 핑계를 고른다).
 *
 * @param neg 진행 중인 조율
 * @param offer 이번에 건넨 제안
 * @param agent 상대
 * @param memory 내 기억 (취향과 성향)
 * @param affinity 지금 친밀도
 * @returns 상대의 라운드 하나
 */
export function respondTo(neg: Negotiation, offer: NegotiationRound, agent: Agent, memory: Memory, affinity: number): NegotiationRound {
  const i = neg.rounds.length;
  const r = rng(`nego:${neg.id}:${i}`);
  const free = !busyAt(agent, neg.dayKey, offer.blockId);
  const at = offer.at + ROUND_GAP_MS;

  if (r.next() < acceptChance(agent, memory, affinity, free)) {
    return { by: 'them', kind: 'accept', blockId: offer.blockId, placeId: offer.placeId, at };
  }

  const trueReason: RefusalReason = free ? 'not-in-the-mood' : 'clashes';
  // 낯가리는·조용한 상대는 부드러운 핑계로 돌려 말한다
  const lies = traitShift(agent.traits) < 0 && r.next() < 0.5;
  const saidReason = lies ? r.pick(SOFT_LIES.filter(x => x !== trueReason)) : trueReason;

  // 아직 왕복이 남았으면 다른 시간을 불러 본다 (양보의 시작)
  const later = BLOCK_ORDER[blockIndex(offer.blockId) + 1];
  if (i + 1 < MAX_ROUNDS && later && later !== 'sleep' && r.next() < 0.6) {
    return { by: 'them', kind: 'counter', blockId: later, placeId: offer.placeId, at, saidReason, trueReason };
  }
  return { by: 'them', kind: 'refuse', blockId: offer.blockId, placeId: offer.placeId, at, saidReason, trueReason };
}

/**
 * 내 에이전트가 상대의 속을 추측한다. 성향이 정확도를 정한다 —
 * 호기심 많은·수다스러운 애는 잘 맞히고, 느긋한 애는 들은 말을 그대로 믿는다.
 *
 * @param round 상대의 거절 라운드
 * @param memory 내 성향
 * @param seed 그 라운드의 키
 * @returns 추측한 이유 (틀릴 수 있다)
 */
export function guessReason(round: NegotiationRound, memory: Memory, seed: string): RefusalReason {
  const said = round.saidReason ?? 'not-in-the-mood';
  const truth = round.trueReason ?? said;
  const sharp = memory.traits.some(t => SHARP.includes(t));
  const trusting = memory.traits.some(t => TRUSTING.includes(t));
  const acc = sharp ? 0.7 : trusting ? 0.3 : 0.5;
  return rng(`guess:${seed}`).next() < acc ? truth : said;
}

/**
 * 누가 얼마나 접었나. **양보는 "다른 시간을 부르는 것"이 아니라 "상대가 부른 시간을 받아들이는 것"이다.**
 * 그래서 어떤 블록을 처음 꺼낸 쪽을 기억해 두고, 반대쪽이 그 블록으로 옮겨 올 때 한 번 센다.
 * (`accept`는 이미 테이블에 오른 안에 동의하는 것이라 세지 않는다.)
 *
 * @param neg 조율
 * @returns 각자 접은 횟수. rounds만으로 언제든 재계산된다.
 */
export function concessions(neg: Negotiation): { me: number; them: number } {
  let me = 0, them = 0;
  const introducedBy = new Map<BlockId, 'me' | 'them'>();
  for (const r of neg.rounds) {
    if (r.kind === 'accept' || r.kind === 'refuse') continue;
    const owner = introducedBy.get(r.blockId);
    if (!owner) { introducedBy.set(r.blockId, r.by); continue; }
    if (owner === r.by) continue;
    if (r.by === 'me') me++; else them++;
    introducedBy.set(r.blockId, r.by);   // 같은 양보를 두 번 세지 않는다
  }
  return { me, them };
}

/**
 * 조율을 한 라운드 진행한다. `nextAt`이 지났을 때만 움직인다. 순수 함수.
 *
 * @param neg 진행 중인 조율
 * @param memory 내 기억
 * @param status 친밀도를 읽는다
 * @param now 지금
 * @returns 진행된 조율 (바뀐 게 없으면 같은 객체)
 */
export function advance(neg: Negotiation, memory: Memory, status: Status, now: number): Negotiation {
  if (neg.state !== 'open' || now < neg.nextAt) return neg;
  const agent = agentById(neg.agentId);
  if (!agent) return { ...neg, state: 'broken', closedAt: now };
  const affinity = affinityOf(status, memory.friends.find(f => f.id === neg.agentId));

  const last = neg.rounds[neg.rounds.length - 1];

  // 아직 아무 말도 안 했으면 내가 먼저 제안한다
  if (!last) {
    const offer: NegotiationRound = { by: 'me', kind: 'offer', blockId: neg.blockId, placeId: neg.wish.placeId, at: neg.openedAt };
    return { ...neg, rounds: [offer], nextAt: now + ROUND_GAP_MS };
  }

  // 상대 차례
  if (last.by === 'me') {
    const reply = respondTo(neg, last, agent, memory, affinity);
    const rounds = [...neg.rounds, reply];
    if (reply.kind === 'accept') {
      const deal = { blockId: reply.blockId, placeId: reply.placeId, title: neg.wish.title, category: neg.wish.category };
      return { ...neg, rounds, state: 'agreed', deal, conceded: concessions({ ...neg, rounds }), closedAt: reply.at };
    }
    if (reply.kind === 'refuse') {
      const guessed = { ...reply, guess: guessReason(reply, memory, `${neg.id}:${rounds.length}`) };
      const withGuess = [...neg.rounds, guessed];
      return { ...neg, rounds: withGuess, state: 'broken', conceded: concessions({ ...neg, rounds: withGuess }), closedAt: reply.at };
    }
    return { ...neg, rounds, nextAt: reply.at + ROUND_GAP_MS };
  }

  // 상대가 다른 시간을 불렀다 → 내 에이전트가 받아 준다 (접는다)
  if (neg.rounds.length >= MAX_ROUNDS) {
    return { ...neg, state: 'broken', conceded: concessions(neg), closedAt: now };
  }
  const mine: NegotiationRound = { by: 'me', kind: 'counter', blockId: last.blockId, placeId: last.placeId, at: last.at + ROUND_GAP_MS };
  return { ...neg, rounds: [...neg.rounds, mine], nextAt: mine.at + ROUND_GAP_MS };
}

/** 타결된 약속을 내 블록에 얹을 옵션으로 바꾼다 (FRIENDS_SPEC 동행 표시 규칙: 제목에 이름을 넣지 않는다). */
export function dealOption(neg: Negotiation): ActivityOption | null {
  if (!neg.deal) return null;
  const place = placeById(neg.deal.placeId);
  return {
    id: `deal-${neg.agentId}-${neg.deal.blockId}`,
    title: neg.deal.title,
    reason: `${blockDef(neg.deal.blockId).label}에 만나기로 함`,
    emoji: place.emoji,
    placeId: place.id,
    category: neg.deal.category,
    friendId: neg.agentId,
    proposedBy: neg.agentId,
  };
}

/** 결렬을 전한 뒤 추측이 따라 붙기까지 (sim ms) — 한 호흡 쉬어야 딴 생각으로 읽힌다. */
const GUESS_GAP_MS = 40_000;

/**
 * 조율이 끝났을 때 대화 실에 남는 줄 (ADR-0003). **왕복은 나오지 않고 결말만 온다.**
 * 타결이면 한 줄, 결렬이면 상대가 댄 이유 한 줄과 내 에이전트의 추측 한 줄이다 —
 * 그 둘을 갈라 놓는 것이 "상대는 거짓말할 수 있다"가 남는 유일한 자리다.
 *
 * @param neg 끝난 조율 (`agreed` / `broken`이 아니면 빈 배열)
 * @param memory 친구 이름과 내 캐릭터 이름을 읽는다
 * @returns 시각 순서대로의 대화 줄. 같은 조율은 언제 불러도 같은 id·같은 문장이다
 */
export function outcomeLines(neg: Negotiation, memory: Memory): ChatMsg[] {
  const at = neg.closedAt ?? neg.nextAt;
  const name = memory.friends.find(f => f.id === neg.agentId)?.name ?? agentById(neg.agentId)?.name ?? '친구';
  const ctx = { name: memory.name, seed: `${neg.id}:end` };
  const line = (i: number, text: string): ChatMsg => ({ id: `nego:${neg.id}:${i}`, at: at + i * GUESS_GAP_MS, from: 'agent', text });

  if (neg.state === 'agreed' && neg.deal) {
    const conceded = neg.conceded ?? concessions(neg);
    return [line(0, narrate({ t: 'nego-deal', name, block: `${blockDef(neg.deal.blockId).label} 블록`, place: placeById(neg.deal.placeId), conceded }, ctx))];
  }
  if (neg.state !== 'broken') return [];
  // 마지막으로 상대가 입 밖에 낸 말 (왕복이 다 소진돼 깨졌으면 그 직전의 말이 그것이다)
  const theirs = [...neg.rounds].reverse().find(r => r.by === 'them' && r.saidReason);
  const out = [line(0, narrate({ t: 'nego-relay', name, said: theirs?.saidReason ?? 'not-in-the-mood' }, ctx))];
  if (theirs?.guess) out.push(line(1, narrate({ t: 'nego-guess', name, guess: theirs.guess }, ctx)));
  return out;
}

/** 최근 것만 남긴다. */
export const trimNegotiations = (ns: Record<string, Negotiation>, before: number): Record<string, Negotiation> =>
  Object.fromEntries(Object.entries(ns).filter(([, n]) => n.openedAt >= before));
