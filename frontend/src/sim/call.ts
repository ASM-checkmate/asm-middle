import type { Phase, PlaceType, WorryKey } from './types';
import { rng } from './rng';

// ─── 전화 (docs/adr/0001-agentness.md §1 — 3단계) ────────────────────────────
// 에이전트가 말을 거는 가장 센 단계. 통화 UI만 만든다 (음성 없음, 오너 결정).
//
// 두 가지가 핵심이다:
//  · **내가 걸면 못 받을 수 있다.** 지금 phase만 보고 정한다 — 새 상태가 없다.
//    "지금 도서관이라 못 받아 ㅠㅠ"가 늦게 도착하는 문자로 오는 게 "진짜 돌아간다"를 판다.
//  · **부재중은 기록만 남고 내용은 잃는다** (오너 결정). 안 받았으면 못 듣는 것이다.
//    그래야 받는 것에 값이 생긴다.

export type CallResult =
  | 'answered'   // 받았다
  | 'missed'     // (수신) 안 받아서 지나갔다 — 무슨 얘기였는지는 영영 모른다
  | 'declined'   // (수신) 내가 거절했다
  | 'refused';   // (발신) 에이전트가 못 받았다

/** 발신을 못 받은 이유. */
export type CallBlock = 'sleeping' | 'onboard' | 'quiet' | 'meal' | null;

export interface CallEvent {
  id: string;
  at: number;
  dir: 'in' | 'out';
  result: CallResult;
  /** 발신을 못 받은 이유 */
  block?: CallBlock;
  /** 늦게 도착하는 문자 한 줄 (발신·못 받음) */
  text?: string;
  /** 받았을 때 오간 말. **부재중에는 없다** — 안 받았으면 내용도 없다. */
  lines?: string[];
  /** 왜 걸려온 전화인가. 없으면 내가 건 것이거나 마찰 통보다. */
  why?: DueCall['why'];
  /** 통화가 실제로 붙은 시각 (sim ms) — 통화 시간을 여기서 잰다 */
  startedAt?: number;
  /** 통화 시간 (sim 초). 끊고 나야 생긴다. 대화 실의 기록 줄이 이걸 쓴다. */
  durSec?: number;
}

/**
 * 예약된 수신 전화 (docs/adr/0002-chat.md). "이따가 전화할게"가 말로만 끝나지 않게,
 * 약속한 순간이 스토어에 남는다. `at`이 지나면 `pumpCalls`가 벨을 울린다.
 */
export interface DueCall {
  id: string;
  at: number;
  /** `worry` = 지쳤다는 말을 듣고 거는 전화, `ask` = 걸어 달라고 해서 거는 전화 */
  why: 'worry' | 'ask';
  /** 무엇 때문에 지쳤다고 했는가 — 통화 내용이 이걸 짚는다 (`worry`일 때만) */
  worry?: WorryKey;
}

/** 약속한 전화만 남긴다 (지난 것은 `pumpCalls`가 소비하며 지운다). */
export const trimDueCalls = (ds: DueCall[], before: number) => ds.filter(d => d.at >= before).slice(-8);

/** 조용해서 전화를 못 받는 곳. */
const QUIET: ReadonlySet<PlaceType> = new Set<PlaceType>(['library', 'office', 'cinema', 'museum', 'temple', 'school']);

/** 못 받았을 때 늦게 도착하는 문자. */
const LATE_TEXT: Record<Exclude<CallBlock, null>, string[]> = {
  sleeping: ['쿨쿨…', '자는 중이었어. 아침에 봤어.'],
  onboard: ['비행기 안이라 못 받았어', '이동 중이라 손이 안 나. 도착하면 걸게'],
  quiet: ['지금 도서관이라 못 받아 ㅠㅠ', '조용히 해야 하는 데야. 나중에!', '여기선 통화 못 해. 미안!'],
  meal: ['밥 먹는 중이야! 30분만', '입에 뭐 물고 있었어 ㅋㅋ 이따 걸게'],
};

/**
 * 지금 전화를 받을 수 있는가. 순수 함수 — 현재 `Phase`만 본다.
 *
 * @param phase 지금 캐릭터의 상태
 * @returns 받으면 `{ ok: true }`, 아니면 못 받는 이유
 */
export function pickupRule(phase: Phase): { ok: boolean; block: CallBlock } {
  if (phase.kind === 'sleeping') return { ok: false, block: 'sleeping' };
  if (phase.kind === 'moving') {
    const plane = phase.act.journey.legs.some(l => l.mode === 'plane');
    return phase.onboard !== null || plane ? { ok: false, block: 'onboard' } : { ok: true, block: null };
  }
  if (phase.kind === 'active') {
    if (QUIET.has(phase.act.place.type)) return { ok: false, block: 'quiet' };
    if (phase.act.option.category === 'meal') return { ok: false, block: 'meal' };
  }
  return { ok: true, block: null };
}

/**
 * 못 받았을 때 늦게 도착하는 문자 한 줄. 시드가 안정적이라 같은 통화면 같은 문장이 온다.
 *
 * @param block 못 받은 이유
 * @param seed 그 통화의 키
 */
export const lateText = (block: Exclude<CallBlock, null>, seed: string) => rng(`late:${seed}`).pick(LATE_TEXT[block]);

/** 받았을 때 에이전트가 먼저 하는 말 — 지금 뭘 하고 있는지 자랑한다. */
const BRAG: Partial<Record<PlaceType, string[]>> = {
  cafe: ['야 나 지금 여기 있다?', '여기 사람 진짜 없어. 완전 내 자리야.'],
  park: ['날씨 미쳤어. 나와야 하는데.', '나 지금 벤치에 누워 있어.'],
  river: ['바람 소리 들려? 여기 좋아.'],
  gym: ['하 나 지금 뛰는 중이야… 힘들어'],
  home: ['그냥 뒹굴고 있었어', '심심해서 걸었어'],
  restaurant: ['이거 진짜 맛있는데 너 없어서 아쉽다'],
};
const BRAG_DEFAULT = ['야 나 지금 이거 하고 있다?', '그냥 목소리 듣고 싶어서 걸었어', '나 지금 여기 있어. 좋다.'];

/**
 * 받은 통화에서 에이전트가 하는 말들.
 *
 * @param placeType 지금 있는 곳
 * @param seed 그 통화의 키
 * @param extra 덧붙일 한 줄 (마찰 통보 등)
 * @returns 2~3줄
 */
export function callLines(placeType: PlaceType, seed: string, extra?: string): string[] {
  const r = rng(`call:${seed}`);
  const out = [r.pick(BRAG[placeType] ?? BRAG_DEFAULT)];
  if (extra) out.push(extra);
  out.push(r.pick(['너는 뭐 해?', '심심하면 또 걸게', '끊는다? 이따 봐']));
  return out;
}

/** 지쳤다는 말을 듣고 거는 전화. 무엇 때문이라 했는지를 첫 줄이 짚는다 (docs/adr/0002-chat.md). */
const WORRY_ASK: Record<WorryKey, string> = {
  work: '일 안 풀린다며. 많이 꼬였어?',
  people: '사람한테 지쳤다고 했잖아. 누가 그랬어?',
  body: '몸이 무겁다며. 어디가 안 좋아?',
  money: '돈 걱정된다고 했잖아. 많이 빠듯해?',
  sleep: '잠을 못 잔다며. 며칠째야?',
  stuck: '결정 못 하겠다고 했잖아. 뭐 때문에?',
  bored: '심심하다며. 하루 종일 뭐 했어?',
  none: '아까 그거, 진짜 아무것도 아니야?',
};
/** 듣고 나서 하는 말 — 해결책이 아니라 **자기가 뭘 하겠다**는 말이다. */
const WORRY_PLAN: Record<WorryKey, string[]> = {
  work: ['오늘은 아무것도 하지 말고 있자. 내가 조용한 데로 잡아 놨어.', '내가 오늘 일정 다 비워 뒀어. 진짜로.'],
  people: ['오늘은 나랑만 있자. 아무도 안 부를게.', '내가 오늘 약속 다 뺐어. 혼자 있는 시간 만들어 놨어.'],
  body: ['오늘은 눕는 거로 하자. 내가 다 쉬는 걸로 바꿔 놨어.', '멀리 안 갈게. 집 근처로만 돌게.'],
  money: ['오늘은 돈 안 쓰는 데로만 갈게. 공원 좋더라.', '내가 싼 데로 다 바꿔 놨어. 걱정 마.'],
  sleep: ['오늘은 일찍 눕자. 내가 저녁 일정 없앴어.', '낮에 좀 걷고 일찍 자자. 그렇게 잡아 놨어.'],
  stuck: ['그럼 오늘은 아무것도 정하지 마. 내가 정할게.', '고르는 건 내가 할게. 너는 따라오기만 해.'],
  bored: ['그럼 내가 재밌는 거 하나 찾아 놓을게.', '내일 어디 좀 나가자. 내가 골라 둘게.'],
  none: ['그래도 오늘은 좀 쉬엄쉬엄 가자.', '알겠어. 그래도 무리하진 마.'],
};

/**
 * 지쳤다는 말을 듣고 건 전화에서 오가는 말.
 *
 * @param key 무엇 때문인지
 * @param seed 그 통화의 키
 * @returns 3줄 (짚기 → 듣기 → 내가 뭘 하겠다)
 */
export function worryLines(key: WorryKey, seed: string): string[] {
  const r = rng(`worry-call:${seed}:${key}`);
  return [
    WORRY_ASK[key],
    r.pick(['어… 그랬구나.', '음. 듣고 있어.', '그래서 조용했구나.']),
    r.pick(WORRY_PLAN[key]),
  ];
}

/** 통화 시간 한 줄 ("3분 12초"). 기록 줄이 쓴다. */
export const fmtDur = (sec: number) => {
  const s = Math.max(1, Math.round(sec));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
};

/** 부재중 기록 한 줄 — 시각만 남는다. 무슨 얘기였는지는 주지 않는다. */
export const missedLine = () => '전화했었는데 안 받더라';

/** 최근 N개만 남긴다. */
export const trimCalls = (cs: CallEvent[], before: number) => cs.filter(c => c.at >= before).slice(-40);
