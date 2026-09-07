import type { ActivityOption, Place } from './types';
import type { FrictionKind } from './friction';
import type { RefusalReason } from './review';
import { rng } from './rng';
import { wonKo, type StatusDelta } from './status';

// ─── 서술 경계 (docs/adr/0001-agentness.md) ──────────────────────────────────
// 에이전트가 판단한 것을 사람의 말로 옮기는 **유일한 자리**. 지금은 시드 기반 템플릿이고,
// 나중에 이 함수 하나만 LLM으로 갈아끼우면 앱의 모든 판단 문구가 한 번에 바뀐다.
// (suggest.ts / comic.ts의 "LLM later; keep the signature"와 같은 계약)
//
// 규칙 하나: **상대 에이전트의 속내는 이 타입에 존재하지 않는다.** 친구는 이름과 자기 하루로만 존재한다
// (FRIENDS_SPEC §2 사전 채움). 조율 전언 갈래는 ADR-0004에서 조율과 함께 제거됐다.

/** 말풍선 한 줄의 최대 길이 (판정 카드 폭 기준). */
const MAX = 34;
const len = (s: string) => [...s].length;

export type NarratableEvent =
  /** 밀어붙일 수 있는 반대. `short` = 모자란 돈(원), `money` = 지금 지갑 */
  | { t: 'pushback'; reason: RefusalReason; option: ActivityOption; place: Place; short: number; money: number }
  /** 밀어붙일 수 없는 거절 */
  | { t: 'refuse'; reason: RefusalReason; option: ActivityOption; place: Place; money: number }
  /** 대신 이걸 하자는 역제안 */
  | { t: 'counter'; reason: RefusalReason; from: ActivityOption; to: ActivityOption; toPlace: Place }
  /** 주인이 밀어붙였다 */
  | { t: 'forced'; reason: RefusalReason; cost: StatusDelta }
  /** 도착했더니 계획대로가 아니었다. `actual`이 없으면 제자리에서 벌어진 일 */
  | { t: 'friction'; kind: FrictionKind; planned: Place; actual?: Place }
  /** 혼자 도착했다 — 기분 한 줄 (ADR-0004 오너 결정 6: 도착 알림 대신, 보고 있을 때 한 번). 부탁은 하지 않는다 */
  | { t: 'arrive-say' }
  /** 그림으로 넘긴 계획을 블록 시작 때 자기 기준으로 골랐다 — 활동 로그 첫 줄 (ADR-0004 오너 결정 8: 규칙 기반이라 그림을 못 알아본다) */
  | { t: 'sketch-pick' }
  /** 그림을 알아보고 그대로 골랐다 — 활동 로그 첫 줄 (ADR-0007). `seen`은 무엇으로 봤는지 ("컵") */
  | { t: 'sketch-seen'; seen: string }
  /** 범주는 맞는데 딱 그 카드가 없어 비슷한 걸로 (ADR-0008) */
  | { t: 'sketch-near'; seen: string }
  /** 골라 둔 범주와 그림이 어긋나서 내 맘대로 했다 (ADR-0008, 오너 결정) */
  | { t: 'sketch-clash'; seen: string; asked: string }
  /** 알아봤지만 돈·피로에 막혀 딴 데로 갔다 (ADR-0008) */
  | { t: 'sketch-blocked'; seen: string }
  /** 돈이 빠듯해 알아서 아꼈다(cheap) / 벌러 갔다(earn) — 묻지 않고 하고, 출발 줄에 이유만 남긴다 (오너 결정 2026-09-08) */
  | { t: 'frugal'; mode: 'cheap' | 'earn' };

export interface NarrateCtx {
  /** 캐릭터 이름 (문구에 쓰이진 않지만 시드에 섞인다) */
  name: string;
  /** 사건의 안정적인 키 — 같은 사건이면 언제 다시 그려도 같은 문장이 나온다 */
  seed: string;
}

// ─── 사전 ────────────────────────────────────────────────────────────────────
// {place} 장소 이름 · {short} 모자란 돈 · {alt} 역제안 활동

const PUSHBACK: Record<RefusalReason, string[]> = {
  'no-money': [
    '지금 {money} 남았는데 거기 가면 저녁 못 먹어.',
    '{short} 모자라. 그래도 갈까?',
    '{place} 가면 이번 주 끝인데… 갈까?',
  ],
  'too-tired': [
    '오늘 너무 걸었어. {place}는 좀 무리 같은데.',
    '다리가 안 움직여. 그래도 갈까?',
    '지금 나가면 내일까지 뻗을 것 같아.',
  ],
  'not-in-the-mood': [
    '오늘은 사람 많은 데 가기 싫은데.',
    '기분이 좀 그래. {place} 말고 조용한 데 어때?',
    '지금은 좀 가라앉았어. 그래도 갈까?',
  ],
  'not-close-enough': [
    '아직 그 정도로 친하진 않은데… 가도 돼?',
    '갑자기 찾아가기엔 좀 어색해.',
  ],
  'too-far': [
    '{place}까지 갔다 오면 블록이 다 지나가.',
    '거긴 너무 멀어. 갔다가 바로 와야 해.',
  ],
  dislike: [
    '{place}… 별로 안 내키는데.',
    '거기 그렇게 좋아하진 않아.',
  ],
};

const REFUSE: Record<RefusalReason, string[]> = {
  'no-money': [
    '미안, 진짜 돈이 없어. {money}야.',
    '지갑이 비었어. 이건 못 가.',
  ],
  'too-tired': [
    '미안, 오늘은 진짜 못 가. 다리가 안 움직여.',
    '더는 못 걷겠어. 오늘은 여기까지.',
  ],
  'not-in-the-mood': ['오늘은 진짜 아무것도 못 하겠어.'],
  'not-close-enough': ['그 집은 아직 못 가겠어.'],
  'too-far': ['그 시간엔 절대 못 갔다 와.'],
  dislike: [
    '거긴 진짜 싫어. 다른 데 시켜줘.',
    '{place}만은 안 돼. 미안.',
  ],
};

// 역제안은 활동이 아니라 **장소**를 부른다: 같은 범주의 두 옵션은 활동 이름이 겹치기 쉬워
// ("브런치 하면 안 돼?") 무슨 말인지 알 수 없게 된다.
const COUNTER: string[] = [
  '대신 {altPlace} 어때?',
  '{altPlace} 가면 안 돼?',
  '이거 말고 {altPlace} 가자.',
];

/** 발길을 돌린 경우 — {planned} 원래 가려던 곳, {actual} 실제로 간 곳 */
const FRICTION_DIVERT: Record<FrictionKind, string[]> = {
  closed: ['{planned} 문 닫았더라. 그냥 {actual} 갔어.', '셔터 내려가 있었어. {actual}로 돌렸어.'],
  full: ['{planned} 자리가 없더라. {actual}로 갔어.', '웨이팅이 너무 길어서 {actual} 갔어.'],
  weather: ['비 와서 {actual}로 들어갔어.', '갑자기 쏟아지길래 {actual}로 피했어.'],
  detour: ['가는 길에 {actual} 보여서 그냥 거기 갔어.', '{actual}가 더 끌려서 바꿨어. 잘한 듯?'],
  'sold-out': ['{planned} 갔는데 그건 다 팔렸더라.'],
};
/** 제자리에서 벌어진 경우 */
const FRICTION_STAY: Record<FrictionKind, string[]> = {
  'sold-out': ['그거 다 팔렸대. 다른 거 시켰어.', '노리던 건 품절. 아쉬운 대로 먹었어.'],
  closed: ['닫혀 있어서 밖에서 서성였어.'],
  full: ['자리 날 때까지 기다렸어.'],
  weather: ['비 맞으면서 그냥 했어.'],
  detour: ['오는 길에 딴 데를 좀 봤어.'],
};

/** 혼자 도착한 순간의 혼잣말 — 찍어 달라는 부탁. 카메라 오버레이(ADR-0004)로 이어진다. */
const ARRIVE_SAY: string[] = [
  '도착! 여기 분위기 좋다',
  '왔다. 오늘 여기 잘 고른 것 같아',
  '자리 잡았어. 여긴 좀 마음에 들어',
];

/** 그림을 못 알아보고 내 맘대로 골랐다는 고백 — 활동 로그의 첫 줄(departAt)에 찍힌다. */
const SKETCH_PICK: string[] = [
  '그림은 못 알아봐서 내 맘대로 골랐어',
  '그림 보고 감으로 정했어. 이거다!',
  '뭘 그린 건지 모르겠어서 그냥 내 취향대로',
];

/** 그림을 알아봤을 때의 출발 줄 — {seen}에 본 것이 들어간다 */
const SKETCH_SEEN: string[] = [
  '{seen} 그린 거지? 알아봤어. 이걸로 간다',
  '그림 봤어. {seen} 맞지? 오케이',
  '{seen}! 딱 봐도 알겠더라. 갔다 올게',
];

/** 범주는 맞는데 그 카드가 없을 때 */
const SKETCH_NEAR: string[] = [
  '{seen} 그린 거 봤어. 딱 그건 없어서 비슷한 데로 갔어',
  '{seen}이지? 카드엔 없길래 그 근처로 골랐어',
  '{seen} 알아봤는데 그건 못 찾아서, 비슷한 걸로',
];
/** 골라 둔 범주와 그림이 어긋날 때 — 그냥 내 맘대로 (오너 결정 2026-09-07) */
const SKETCH_CLASH: string[] = [
  '{asked}라더니 {seen}을 그려? 헷갈려서 그냥 내가 하고 싶은 거 했어',
  '{asked}랑 {seen}이랑 뭐야 ㅋㅋ 몰라, 오늘은 내 맘대로',
  '{asked}인지 {seen}인지 모르겠어서 그냥 하고 싶은 거 하러 감',
];
/** 알아봤지만 검문에 막혔을 때 */
const SKETCH_BLOCKED: string[] = [
  '{seen} 맞지? 근데 오늘은 무리라 딴 데 갔어. 미안',
  '{seen}인 건 알겠는데 지금은 좀 그래서 다른 데로',
  '{seen} 그린 거 알아. 근데 오늘은 안 되겠더라',
];

/** 지갑이 얇은 날의 출발 줄 — 아끼는 쪽 / 벌러 가는 쪽 */
const FRUGAL_CHEAP: string[] = [
  '지갑이 얇아서 오늘은 싼 데로',
  '돈 아끼는 날. 가까운 데로 간다',
  '남은 돈 보고 조용한 데 골랐어',
];
const FRUGAL_EARN: string[] = [
  '돈이 없어서 오늘은 일하러 간다',
  '지갑 좀 채워야겠다. 일하러!',
  '놀 돈이 없네. 벌러 간다',
];

const FORCED: string[] = [
  '알겠어. 갔다 올게.',
  '…그래, 가자.',
  '무리해서 가는 거야, 나중에 몰라.',
];

/** "카페 레이어드 연남에서 그림 그리기" → "그림 그리기" (comic.ts의 activityStem과 같은 취지의 가벼운 판). */
const stem = (o: ActivityOption) => {
  const s = o.title.replace(/^.*?(에서|까지|에)\s/, '').replace(/하기$/, '').trim();
  return s && len(s) <= 14 ? s : o.title;
};

/** 길면 자른다 (말풍선 폭 기준). */
const fit = (s: string, max = MAX) => (len(s) <= max ? s : [...s].slice(0, max - 1).join('') + '…');

/**
 * 사건 하나를 에이전트의 1인칭 한 줄로 옮긴다.
 * 시드가 안정적이므로 같은 판단은 언제 다시 그려도 같은 문장이 나온다.
 *
 * @param ev 무슨 일이 있었나
 * @param ctx 캐릭터 이름과 사건의 안정적인 시드
 * @returns 34자 이내의 한국어 한 줄.
 */
export function narrate(ev: NarratableEvent, ctx: NarrateCtx): string {
  const r = rng(`${ctx.seed}:${ev.t}`);
  switch (ev.t) {
    case 'pushback':
      return fit(r.pick(PUSHBACK[ev.reason])
        .replace('{place}', ev.place.name)
        .replace('{money}', wonKo(ev.money))
        .replace('{short}', wonKo(Math.max(0, ev.short))));
    case 'refuse':
      return fit(r.pick(REFUSE[ev.reason])
        .replace('{place}', ev.place.name)
        .replace('{money}', wonKo(ev.money)));
    case 'counter':
      return fit(r.pick(COUNTER).replace('{altPlace}', ev.toPlace.name).replace('{alt}', stem(ev.to)));
    case 'forced':
      return fit(r.pick(FORCED));
    case 'friction':
      return fit((ev.actual ? r.pick(FRICTION_DIVERT[ev.kind]) : r.pick(FRICTION_STAY[ev.kind]))
        .replace('{planned}', ev.planned.name)
        .replace('{actual}', ev.actual?.name ?? ev.planned.name));
    case 'arrive-say':
      return fit(r.pick(ARRIVE_SAY));
    case 'sketch-pick':
      return fit(r.pick(SKETCH_PICK));
    case 'sketch-seen':
      return fit(r.pick(SKETCH_SEEN).replace('{seen}', ev.seen));
    case 'sketch-near':
      return fit(r.pick(SKETCH_NEAR).replace('{seen}', ev.seen));
    case 'sketch-clash':
      return fit(r.pick(SKETCH_CLASH).replaceAll('{seen}', ev.seen).replaceAll('{asked}', ev.asked));
    case 'sketch-blocked':
      return fit(r.pick(SKETCH_BLOCKED).replace('{seen}', ev.seen));
    case 'frugal':
      return fit(r.pick(ev.mode === 'earn' ? FRUGAL_EARN : FRUGAL_CHEAP));
  }
}
