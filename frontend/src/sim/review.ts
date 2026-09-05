import type { ActivityOption, BlockId, Category, DayKey, Memory, Place, ScheduledActivity } from './types';
import { narrate } from './narrate';
import { affinityOf, costOf, type Status, type StatusDelta } from './status';
import { estimateJourney } from './journey';
import { placeById } from './places';

// ─── 판단 (docs/adr/0001-agentness.md, SPEC 계획 수립과 확정) ─────────────────
// 사용자의 선택은 확정이 아니라 제안이다. 에이전트가 자기 상태와 메모리에 근거해
// 받아들이거나(null), 반대하거나(pushback — 밀어붙일 수 있다), 거절한다(refuse — 못 밀어붙인다).
//
// 이 문은 **하나**다. 사용자의 확정과 에이전트의 자동 선택이 똑같이 여기를 지난다.
// 그래서 에이전트가 스스로 고를 때도 돈·체력·기분에 맞게 고른다.

export type RefusalReason =
  | 'no-money'          // 지갑이 모자라다
  | 'too-tired'         // 피로가 높다
  | 'not-in-the-mood'   // 기분이 가라앉았다
  | 'not-close-enough'  // 아직 그 친구 집에 갈 만큼 친하지 않다
  | 'too-far'           // 블록 안에 왕복이 안 들어간다
  | 'clashes'           // 협상으로 확정된 약속이 그 시간을 덮는다 (협상 PR에서 켜진다)
  | 'dislike';          // 명시적으로 싫어하는 것

/** 근거로 화면에 붙는 숫자. "남은 돈 5,400원" 처럼 판단 옆에만 나타난다. */
export interface Evidence { label: string; value: string }

/** 에이전트의 판정. `null`이면 받아들인 것이다. */
export interface Verdict {
  /** `pushback`은 밀어붙일 수 있고, `refuse`는 못 한다 */
  kind: 'pushback' | 'refuse';
  reason: RefusalReason;
  /** 판단의 대상이 된 옵션 — 밀어붙이기가 이 id로 되돌아온다 */
  optionId: string;
  /** 에이전트의 1인칭 한 줄 (narrate가 만든다) */
  line: string;
  evidence?: Evidence;
  /** 역제안: 같은 블록의 다른 옵션 중 통과한 것 */
  counterOptionId?: string;
  /** 밀어붙였을 때 치를 대가 — 버튼에 미리 쓴다 */
  cost?: StatusDelta;
  at: number;
}

/** 문턱값. 데브패널과 테스트가 읽고, 굴려 보고 조정하는 값들이다. */
export const LIMITS = {
  /** 이 이상이면 몸 쓰는 일에 반대한다 */
  tiredSoft: 78,
  /** 이 이상이면 쉬기·식사·집 말고는 전부 거절한다 (하한) */
  tiredHard: 92,
  /** 이 아래면 시끄러운 곳과 동행에 반대한다 */
  moodLow: 26,
  /** 이 아래면 친구 집 방문에 반대한다 */
  affinityLow: 24,
  /** 편도가 이 분을 넘으면서 블록에 안 들어가면 반대한다 */
  farMin: 60,
} as const;

/** 밀어붙였을 때의 대가 — 기분이 떨어지고 몸이 더 힘들다 (오너 결정: 중간에 포기하지는 않는다). */
export const PUSH_COST: StatusDelta = { fatigue: 12, mood: -14 };

/** 기분이 가라앉았을 때 가기 싫은 곳. */
const LOUD = new Set<Place['type']>(['bar', 'market', 'arcade', 'mall', 'stadium', 'cinema']);
/** 지쳤을 때도 갈 수 있는 곳 (하한 판정의 예외). */
const RESTFUL = new Set<Category>(['rest', 'meal', 'sleep']);

export interface ReviewCtx {
  /** 판단의 시드 — 같은 블록의 같은 옵션이면 언제나 같은 문장이 나온다 */
  dayKey: DayKey;
  status: Status;
  memory: Memory;
  /** 그 블록을 시작할 때 캐릭터가 있는 곳 */
  from: Place;
  blockId: BlockId;
  blockStart: number;
  blockEnd: number;
  /** 이미 확정된 활동들 — 그 시간을 덮는 약속이 있으면 거절한다 */
  timeline?: ScheduledActivity[];
}

const mentions = (list: string[], text: string) => list.some(k => k && text.includes(k));

/** 이 옵션이 그 블록에서 얼마를 쓰는지 — 이동 요금 + 체류 비용. 근거 칩과 거절 판단이 읽는다. */
export function optionCost(o: ActivityOption, ctx: ReviewCtx): { cost: number; place: Place; oneWayMin: number; stayMin: number } {
  const place = placeById(o.placeId);
  const journey = estimateJourney(ctx.from, place);
  const oneWayMin = journey.totalMin;
  const stayMin = Math.max(20, (ctx.blockEnd - ctx.blockStart) / 60_000 - oneWayMin);
  return { cost: costOf(o.category, place, journey.legs, stayMin), place, oneWayMin, stayMin };
}

/**
 * 에이전트가 이 계획을 받아들일지 판단한다. 순수 함수 — 같은 상태·같은 옵션이면 언제나 같은 답이다.
 *
 * 하한 네 가지(돈 0 · 체력 0 · 확정된 약속 · 명시된 dislikes)에서만 `refuse`가 나오고,
 * 나머지는 전부 `pushback`이라 사용자가 밀어붙일 수 있다 (SPEC 계획 수립과 확정).
 *
 * @param o 확정하려는 활동 옵션
 * @param ctx 그 블록 시작 시점의 상태·메모리·위치
 * @param alternatives 역제안 후보 — 보통 같은 블록의 나머지 두 옵션
 * @returns 받아들이면 null, 아니면 판정
 */
export function review(o: ActivityOption, ctx: ReviewCtx, alternatives: ActivityOption[] = []): Verdict | null {
  const { status, memory } = ctx;
  const { cost, place, oneWayMin } = optionCost(o, ctx);
  const short = cost - status.money;
  const text = `${o.title} ${o.reason} ${place.name}`;
  const at = ctx.blockStart;

  const nctx = { name: memory.name, seed: `review:${ctx.dayKey}:${ctx.blockId}:${o.id}` };
  const verdict = (kind: Verdict['kind'], reason: RefusalReason, evidence?: Evidence): Verdict => {
    const base: Verdict = { kind, reason, optionId: o.id, line: narrate({ t: kind, reason, option: o, place, short, money: status.money }, nctx), evidence, at };
    if (kind === 'refuse') return base;
    // 반대일 때만 역제안을 찾는다 — 거절은 대안이 아니라 벽이다
    const alt = alternatives.find(a => a.id !== o.id && !review(a, ctx));
    return alt
      ? { ...base, counterOptionId: alt.id, line: narrate({ t: 'counter', reason, from: o, to: alt, toPlace: placeById(alt.placeId) }, nctx), cost: PUSH_COST }
      : { ...base, cost: PUSH_COST };
  };

  // ── 하한: 밀어붙일 수 없는 거절 ────────────────────────────────────────────
  if (mentions(memory.dislikes, text)) return verdict('refuse', 'dislike');
  if (cost > 0 && status.money <= 0) return verdict('refuse', 'no-money', { label: '남은 돈', value: `${status.money.toLocaleString('ko-KR')}원` });
  if (status.fatigue >= LIMITS.tiredHard && !RESTFUL.has(o.category) && place.type !== 'home') {
    return verdict('refuse', 'too-tired', { label: '체력', value: `${Math.round(100 - status.fatigue)}%` });
  }
  // 'clashes'는 **협상으로 확정된 약속**에만 쓴다. 친구 제안(FRIENDS_SPEC §2)은 주인이 언제든 바꿀 수 있으므로
  // 여기서 막지 않는다. 협상이 들어오면 그 약속을 표시하는 필드를 보고 이 자리에서 거절하게 된다.

  // ── 반대: 밀어붙일 수 있다 ────────────────────────────────────────────────
  if (cost > status.money) return verdict('pushback', 'no-money', { label: '남은 돈', value: `${status.money.toLocaleString('ko-KR')}원` });
  if (status.fatigue >= LIMITS.tiredSoft && (o.category === 'exercise' || o.category === 'travel' || oneWayMin > LIMITS.farMin)) {
    return verdict('pushback', 'too-tired', { label: '체력', value: `${Math.round(100 - status.fatigue)}%` });
  }
  if (status.mood < LIMITS.moodLow && (LOUD.has(place.type) || !!o.friendId)) {
    return verdict('pushback', 'not-in-the-mood', { label: '기분', value: `${Math.round(status.mood)}%` });
  }
  if (place.type === 'friend_home' && place.ownerFriendId && affinityOf(status, memory.friends.find(f => f.id === place.ownerFriendId)) < LIMITS.affinityLow) {
    return verdict('pushback', 'not-close-enough');
  }
  if (oneWayMin * 2 > (ctx.blockEnd - ctx.blockStart) / 60_000 && o.category !== 'travel') {
    return verdict('pushback', 'too-far', { label: '편도', value: `${oneWayMin}분` });
  }
  return null;
}

/**
 * 세 제안이 전부 막혔을 때 에이전트가 스스로 내려앉는 자리 — 집에서 쉬기. 공짜고 피로가 줄어든다.
 *
 * @param blockId 그 블록
 * @param memory 집 위치를 읽는다
 * @returns 언제나 통과하는 옵션 하나
 */
export function fallbackOption(blockId: BlockId, memory: Memory): ActivityOption {
  return {
    id: `fallback:${blockId}`,
    title: '집에서 쉬기',
    reason: '오늘은 더 못 움직이겠음',
    emoji: '🛋️',
    placeId: memory.homePlaceId,
    category: 'rest',
  };
}
