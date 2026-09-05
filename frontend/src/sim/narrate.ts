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
// 규칙 하나: **상대 에이전트의 속내는 이 타입에 존재하지 않는다.** 조율 전언 갈래(`nego-relay`)는
// 상대가 입 밖에 낸 이유와 내 에이전트의 추측만 받는다. 진짜 이유는 저장되지만 화면으로 나가는
// 길이 타입 차원에서 막힌다 — "상대는 이름으로만 존재한다"를 컴파일러가 강제한다.

/** 말풍선 한 줄의 최대 길이. 판정 카드는 좁고(34), 대화 실은 화면 폭을 다 쓴다(46). */
const MAX = 34;
const MAX_WIDE = 46;
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
  /**
   * 조율이 깨졌다고 내가 전한다 — 상대가 입 밖에 낸 이유까지만.
   * **`trueReason`이 이 타입에 없다**는 것이 핵심이다: 상대의 진짜 속내는 저장은 되지만
   * 화면으로 나가는 길이 타입 차원에서 막힌다 ("상대는 이름으로만 존재한다").
   */
  | { t: 'nego-relay'; name: string; said: RefusalReason }
  /** 내 에이전트의 추측 (틀릴 수 있다) */
  | { t: 'nego-guess'; name: string; guess: RefusalReason }
  /** 타결 */
  | { t: 'nego-deal'; name: string; block: string; place: Place; conceded: { me: number; them: number } };

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
  clashes: [
    '그 시간엔 이미 잡힌 게 있는데.',
    '앞 일정이랑 겹쳐. 그래도 갈까?',
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
  clashes: ['그 시간엔 약속 잡아놨어. 그건 못 미뤄.'],
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

// ── 조율 결말 (ADR-0003) ────────────────────────────────────────────────────
// 왕복 자체는 화면에 나오지 않는다. 나오는 것은 **끝났다는 말** 뿐이고, 그것도 전부
// **내 에이전트의 1인칭**이다.
/** 상대가 댄 이유를 내가 전한다 — 사실 확인이 아니라 전언이다. */
const SAID: Record<RefusalReason, string> = {
  'no-money': '돈이 없대',
  'too-tired': '피곤하대',
  'not-in-the-mood': '그냥 별로래',
  'not-close-enough': '좀 부담스럽대',
  'too-far': '너무 멀대',
  clashes: '그날 일이 있대',
  dislike: '거긴 싫대',
};
const NEGO_REFUSE = ['결국 안 되겠대. {said}.', '{name}가 {said}. 이번엔 못 하겠다.'];
const NEGO_GUESS = [
  '근데 내 생각엔… {guess} 것 같아.',
  '내 느낌엔 {guess} 거 아닐까?',
  '말은 그렇게 했는데, {guess} 것 같기도 하고.',
];
/** 추측은 "…인 것" 꼴로 이어 붙는다. */
const GUESS_WHY: Record<RefusalReason, string> = {
  'no-money': '이번 달 빠듯한',
  'too-tired': '요즘 많이 지친',
  'not-in-the-mood': '나랑 노는 게 좀 시들해진',
  'not-close-enough': '아직 나를 어려워하는',
  'too-far': '멀리 나가는 걸 싫어하는',
  clashes: '진짜 바쁜',
  dislike: '그 동네를 싫어하는',
};
const NEGO_DEAL = ['{block}에 {place}, 약속 잡았다!', '됐어! {block}에 {place}에서 보기로 했어.'];
const CONCEDED_ME = ['이번엔 내가 접었어.'];
const CONCEDED_THEM = ['{name}가 맞춰줬어.'];

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
 * @returns 34자 이내의 한국어 한 줄. 상대 에이전트의 속내는 절대 담기지 않는다.
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
    case 'nego-relay':
      return fit(r.pick(NEGO_REFUSE).replace('{name}', ev.name).replace('{said}', SAID[ev.said]), MAX_WIDE);
    case 'nego-guess':
      return fit(r.pick(NEGO_GUESS).replace('{guess}', GUESS_WHY[ev.guess]), MAX_WIDE);
    case 'nego-deal': {
      const who = ev.conceded.me > ev.conceded.them ? r.pick(CONCEDED_ME) : ev.conceded.them > ev.conceded.me ? r.pick(CONCEDED_THEM) : '';
      const head = r.pick(NEGO_DEAL).replace('{block}', ev.block).replace('{place}', ev.place.name);
      return fit(who ? `${head} ${who.replace('{name}', ev.name)}` : head, MAX_WIDE);
    }
  }
}
