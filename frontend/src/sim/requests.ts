import type { DayKey, Memory, ScheduledActivity } from './types';
import type { Status } from './status';
import { rng } from './rng';

// ─── 요청 (docs/adr/0001-agentness.md §1) ───────────────────────────────────
// 에이전트가 사용자에게 말을 거는 통로는 하나이고, 무시했을 때의 대가만 다르다.
// 쪽지(여기)는 마감이 있고, 답이 없으면 **에이전트가 혼자 정하고 나중에 통보한다.**
// 무시된 요청은 폼에 쌓이는 게 아니라 이야기가 된다 — 이게 "관계의 역전"의 핵심이다.

// 쪽지는 마음이 오가는 것만이다 — 지금은 고민을 묻는 것 하나. 일을 시키는 부탁(일정 골라 달라, 사진 찍어 달라)은 쪽지로도
// 문자로도 하지 않고(오너 결정 2026-09-07), 돈이 빠듯한 것도 묻지 않는다 — 알아서 아끼거나 벌러 간다 (store.decide, 2026-09-08).
export type RequestKind =
  | 'worry';      // "오늘 왜 그래? 하나만 골라줘" (고민 듣기 PR에서 켜진다)

export interface RequestChoice {
  id: string;
  label: string;
  /** 이걸 고르면 에이전트가 알아서 한다 — 마감을 넘겼을 때의 기본값이기도 하다 */
  isDefault?: boolean;
}

export interface AgentRequest {
  id: string;
  kind: RequestKind;
  /** 뜬 시각 */
  at: number;
  /** 마감. 지나면 에이전트가 혼자 정한다 */
  dueAt: number;
  /** 에이전트의 말 (한 줄) */
  line: string;
  choices: RequestChoice[];
  /** 무엇에 대한 요청인가 (blockId …) */
  refId?: string;
  /** 사용자가 고른 선택지 id */
  answered?: string;
  /** 답한 시각 — 대화 실이 대답을 그 자리에 꽂고, 고민이면 여기서 전화까지의 "이따가"를 잰다 */
  answeredAt?: number;
  /** 마감을 넘겨 에이전트가 혼자 정했다 — 그 사실을 나중에 통보한다 */
  decidedAlone?: boolean;
  /** 통보까지 끝났다 (요약 시트에서 한 번 보여준 뒤) */
  told?: boolean;
}

/** 고민을 묻는 말. 먼저 묻는 쪽은 언제나 에이전트고, 칩이 기본 대답이다 (자유 텍스트는 sim/chat.ts). */
const WORRY_LINES = [
  '오늘 너 좀 조용하네. 뭐 때문인지 하나만 골라줘.',
  '무슨 일 있어? 하나만 골라주면 내가 알아서 할게.',
];
/** 고를 수 있는 여덟 가지. 같은 말을 대화창에 쳐도 `sim/chat.ts`의 `worryOf()`가 같은 갈래로 받는다. */
export const WORRY_CHOICES: RequestChoice[] = [
  { id: 'work', label: '일이 안 풀림' },
  { id: 'people', label: '사람한테 지침' },
  { id: 'body', label: '몸이 무거움' },
  { id: 'money', label: '돈 걱정' },
  { id: 'focus', label: '집중 못 함' },
  { id: 'blue', label: '그냥 안 좋아' },
  { id: 'bored', label: '그냥 심심함' },
  { id: 'none', label: '아무것도 아냐', isDefault: true },
];


/** 아직 답을 안 한, 마감도 안 지난 요청들 — 오래된 것부터 (카드는 이 순서로 하나씩 뜬다, ADR-0004 오너 결정 10). */
export const pendingOf = (rs: AgentRequest[], now: number) =>
  rs.filter(r => !r.answered && !r.decidedAlone && r.dueAt > now).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
/** 마감을 넘겨 에이전트가 혼자 정했고, 아직 통보하지 않은 것들. */
export const untoldOf = (rs: AgentRequest[]) => rs.filter(r => r.decidedAlone && !r.told);

export interface RequestCtx {
  now: number;
  today: DayKey;
  tz: string;
  memory: Memory;
  status: Status;
  timeline: ScheduledActivity[];
}

/**
 * 지금 에이전트가 물어볼 게 있으면 하나 만든다. 없으면 null.
 * 결정론적이다 — 시드가 `req:${today}:${kind}`라 같은 하루엔 같은 문장이 나온다.
 * 상한은 없다 (ADR-0004 오너 결정 10) — 중복만 id로 막는다 (고민은 하루 한 번).
 *
 * @param rs 지금까지의 요청들 (중복을 여기서 본다)
 * @param ctx 지금 상태
 * @returns 새 요청 하나, 없으면 null
 */
export function nextRequest(rs: AgentRequest[], ctx: RequestCtx): AgentRequest | null {
  // 기분이 가라앉았다 — 에이전트가 먼저 묻는다 (하루 한 번)
  const worryId = `${ctx.today}:worry`;
  if (ctx.status.mood < 40 && !rs.some(r => r.id === worryId)) {
    const r = rng(`req:${ctx.today}:worry`);
    return {
      id: worryId, kind: 'worry', at: ctx.now, dueAt: ctx.now + 4 * 3600_000,
      line: r.pick(WORRY_LINES), choices: WORRY_CHOICES,
    };
  }

  return null;
}

/**
 * 마감이 지난 요청을 "에이전트가 혼자 정했다"로 넘긴다. 순수 함수 — 새 배열을 돌려준다.
 *
 * @param rs 지금까지의 요청들
 * @param now 지금
 * @returns 바뀐 게 없으면 같은 배열 그대로
 */
export function expire(rs: AgentRequest[], now: number): AgentRequest[] {
  let changed = false;
  const out = rs.map(r => {
    if (r.answered || r.decidedAlone || r.dueAt > now) return r;
    changed = true;
    return { ...r, decidedAlone: true };
  });
  return changed ? out : rs;
}

/** 혼자 정하고 나서 하는 말. 요약 시트와 통화가 이걸 쓴다. */
export function toldLine(r: AgentRequest): string {
  switch (r.kind) {
    case 'worry': return '말 안 해줘서 그냥 조용한 데 있었어.';
  }
}

/** 최근 N개만 남긴다 (오래된 건 anchor 뒤로 사라진다). */
export const trimRequests = (rs: AgentRequest[], before: number) => rs.filter(r => r.at >= before).slice(-40);
