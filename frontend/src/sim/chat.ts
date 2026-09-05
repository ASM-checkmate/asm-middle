import type { Phase, WorryKey } from './types';
import type { Status } from './status';
import type { AgentRequest } from './requests';
import type { CallEvent } from './call';
import { pickupRule } from './call';
import { rng } from './rng';

// ─── 대화 (docs/adr/0002-chat.md) ────────────────────────────────────────────
// 쪽지·통화·혼잣말이 각각 다른 자리에 흩어져 있으면 "에이전트가 말을 거는 통로는 하나"가
// 말로만 남는다. 여기서 그 하나를 **실물로** 만든다: 에이전트가 건 말, 내가 한 답, 오간 전화가
// 시각 순서 하나에 같이 쌓이는 실. 카카오톡의 보이스톡 기록이 대화에 같이 남는 것과 같다.
//
// 두 가지를 지킨다.
//  · **실은 만들지 않고 굴린다.** 쪽지와 통화는 이미 스토어에 있다. 여기서는 그 둘과 자유 대화를
//    시각으로 합칠 뿐이라, 같은 사건이 두 군데에 저장되지 않는다.
//  · **에이전트는 항상 답하지 않는다.** 자고 있거나 도서관이면 답이 늦게 온다 (`pickupRule`).
//    답이 늦는 것이 "진짜 자기 하루를 산다"를 파는 가장 싼 방법이다.

/** 한 번에 보낼 수 있는 길이. 길어지면 대화가 아니라 편지가 된다. */
export const MAX_LEN = 60;
/** 답할 수 있을 때의 답장 지연 (sim ms) — 즉답이면 봇처럼 읽힌다. */
const REPLY_MS = 1_400;
/** 못 받는 상황일 때의 답장 지연 (sim ms). 나중에 "아까 못 봤어"로 온다. */
const LATE_REPLY_MS = 26 * 60_000;
/** "이따가 전화할게"의 이따가 (sim ms). */
export const WORRY_CALL_MS = 38 * 60_000;
/** 채팅에서 전화를 부르면 이만큼 뒤에 벨이 울린다 (sim ms). */
export const ASK_CALL_MS = 20_000;

export interface ChatMsg {
  id: string;
  at: number;
  from: 'me' | 'agent';
  text: string;
}

/**
 * 대화 실의 한 줄. 자유 대화(`msg`) · 쪽지(`ask`) · 통화 기록(`call`)이 시각 하나로 섞인다.
 * 쪽지는 질문과 내 대답을 한 항목이 같이 들고 있다 (대답은 `req.answered`에 있다).
 */
export type ThreadItem =
  | { kind: 'msg'; id: string; at: number; msg: ChatMsg }
  | { kind: 'ask'; id: string; at: number; req: AgentRequest }
  | { kind: 'call'; id: string; at: number; call: CallEvent };

/**
 * 대화 실을 만든다. 순수 함수 — 저장된 세 배열을 시각 순으로 합칠 뿐이다.
 *
 * @param msgs 자유 대화 (에이전트의 답장은 미래 시각을 달고 저장된다)
 * @param reqs 쪽지들
 * @param calls 통화 기록
 * @param now 지금 (이보다 뒤의 줄은 아직 도착하지 않은 것이다)
 * @returns 시각 오름차순
 */
export function buildThread(msgs: ChatMsg[], reqs: AgentRequest[], calls: CallEvent[], now: number): ThreadItem[] {
  const out: ThreadItem[] = [];
  for (const m of msgs) if (m.at <= now) out.push({ kind: 'msg', id: m.id, at: m.at, msg: m });
  for (const r of reqs) if (r.at <= now) out.push({ kind: 'ask', id: r.id, at: r.at, req: r });
  for (const c of calls) if (c.at <= now) out.push({ kind: 'call', id: c.id, at: c.at, call: c });
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** 아직 안 읽은 줄 (내가 보낸 것과 지나간 미래는 빼고). 종 배지가 이걸 센다. */
export const unreadCount = (items: ThreadItem[], seenAt: number) =>
  items.filter(i => i.at > seenAt && (i.kind !== 'msg' || i.msg.from === 'agent')).length;

/** 최근 N개만 남긴다 (오래된 건 anchor 뒤로 사라진다). */
export const trimMessages = (ms: ChatMsg[], before: number) => ms.filter(m => m.at >= before).slice(-80);

// ─── 알아듣기 ────────────────────────────────────────────────────────────────
// 규칙 기반이다. 자유 텍스트를 진짜로 이해하는 자리는 여기 하나뿐이라, LLM이 들어오면
// `replyTo()` 하나만 갈아끼우면 된다 (narrate/suggest/comic과 같은 계약).

export type Intent = 'tired' | 'where' | 'what' | 'howru' | 'call' | 'come' | 'love' | 'sorry' | 'greet' | 'unknown';

/** 순서가 규칙이다 — 앞의 것이 이긴다. 지친다는 말이 제일 먼저다. */
const INTENTS: [Intent, RegExp][] = [
  ['tired', /지쳤|지친|지쳐|힘들|힘드|피곤|번아웃|우울|짜증|외로|속상|스트레스|죽겠|못하겠|하기\s*싫/],
  ['come', /집에\s*(와|가|오)|들어와|돌아와|보러\s*와/],
  ['call', /전화|통화|보이스|목소리/],
  ['where', /어디|위치|어딨|어디야/],
  ['what', /뭐\s*해|뭐하|뭐\s*하고|무슨\s*일|뭐\s*했/],
  ['howru', /잘\s*지내|괜찮|어때|어땠|기분/],
  ['love', /보고\s*싶|사랑|좋아해|고마워|고맙|잘했|최고/],
  ['sorry', /미안|쏘리|잘못/],
  ['greet', /^\s*(안녕|하이|헤이|야+$|어이|여보세요)/],
];

/** 그 말이 무슨 말인지. 못 알아들으면 `unknown` — 모르는 걸 아는 척하지 않는다. */
export function intentOf(text: string): Intent {
  for (const [id, re] of INTENTS) if (re.test(text)) return id;
  return 'unknown';
}

/** 지쳤다는 말 안에서 무엇 때문인지 짚어 본다. 못 짚으면 몸으로 본다 (제일 안전한 오독). */
const WORRY_RE: [WorryKey, RegExp][] = [
  ['people', /사람|관계|친구|눈치|인간|팀|상사|가족/],
  ['work', /일|회사|업무|과제|시험|공부|프로젝트|숙제|취업/],
  ['money', /돈|월세|카드|생활비|가난|비싸/],
  ['sleep', /잠|불면|못\s*자|밤새|새벽/],
  ['stuck', /결정|모르겠|고민|선택|막막/],
  ['bored', /심심|지루|재미없|노잼/],
  ['body', /몸|아프|허리|어깨|졸리|피곤|체력/],
];
export const worryOf = (text: string): WorryKey => WORRY_RE.find(([, re]) => re.test(text))?.[0] ?? 'body';

// ─── 답하기 ──────────────────────────────────────────────────────────────────

const REACT = ['헉 왜, 무슨 일이야?', '헉… 왜 그래, 무슨 일 있었어?', '어 왜?? 무슨 일이야', '야 왜 그래. 무슨 일인데?'];
const PROMISE = ['이따가 전화할게!', '조금 있다 전화한다? 꼭 받아.', '있다 전화할게. 목소리로 듣고 싶어.', '이따 걸게. 그때 다 말해.'];

/**
 * 지쳤다는 말에 에이전트가 바로 하는 한 줄. 여기서 끝내지 않고 **전화를 약속한다** —
 * 약속한 전화가 실제로 오는 것이 이 기능의 전부다 (docs/adr/0002-chat.md).
 *
 * @param key 무엇 때문인지
 * @param seed 그 대답의 키 (같은 대답이면 같은 문장)
 */
export function reactToWorry(key: WorryKey, seed: string): string {
  const r = rng(`worry-react:${seed}:${key}`);
  return `${r.pick(REACT)} ${r.pick(PROMISE)}`;
}

export interface ChatCtx {
  phase: Phase;
  status: Status;
  /** 캐릭터 이름 — 시드에만 섞인다 */
  name: string;
  /** 그 메시지의 키 */
  seed: string;
}

export interface ChatReply {
  text: string;
  /** 지금부터 몇 ms 뒤에 도착하는가 (sim ms) */
  delayMs: number;
  /** 고민으로 들었다면 그 갈래 — 스토어가 메모리에 적고 전화를 예약한다 */
  worry?: WorryKey;
  /** 전화를 걸어 달라는 말로 들었다 */
  callMe?: boolean;
}

/** 제목에서 장소를 뺀 활동 부분 ("펀시티에서 오락실 한 판" → "오락실 한 판"). sim/comic.ts의 activityStem과 같은 규칙. */
const doingOf = (title: string, placeName: string) =>
  title.replace(placeName, '').replace(/^[\s,·]*(에서|에|까지|로|의)?\s*/, '').trim() || title;

/** 지금 어디서 뭘 하는지 한 조각. 답장 대부분이 이걸 쓴다. */
function whereOf(phase: Phase): { where: string; doing: string } {
  switch (phase.kind) {
    case 'sleeping': return { where: '집', doing: '자는 중' };
    case 'waiting': return { where: phase.at.name, doing: '쉬는 중' };
    case 'moving': return { where: `${phase.act.place.name} 가는 길`, doing: '이동 중' };
    case 'active':
    case 'comic': return { where: phase.act.place.name, doing: doingOf(phase.act.option.title, phase.act.place.name) };
  }
}

/** 못 받는 상황이면 늦게 답하면서 먼저 사과한다. */
const LATE_PREFIX: Record<string, string> = {
  sleeping: '아 미안 자고 있었어.',
  onboard: '미안 이동 중이라 이제 봤어.',
  quiet: '미안 조용히 해야 하는 데라 이제 봤어.',
  meal: '밥 먹느라 늦게 봤다 ㅋㅋ',
};

/**
 * 내가 보낸 말에 에이전트가 뭐라고 답하는가. **여기가 규칙 기반의 유일한 자리다** —
 * LLM이 들어오면 이 함수만 갈아끼운다.
 *
 * @param text 내가 친 말
 * @param ctx 지금 상태
 * @returns 답장 한 줄과 그게 도착하는 데 걸리는 시간. 고민으로 들었으면 `worry`가 실린다.
 */
export function replyTo(text: string, ctx: ChatCtx): ChatReply {
  const r = rng(`chat:${ctx.seed}`);
  const { ok, block } = pickupRule(ctx.phase);
  const { where, doing } = whereOf(ctx.phase);
  const intent = intentOf(text);
  const late = !ok;
  const delayMs = late ? LATE_REPLY_MS : REPLY_MS;
  const say = (s: string) => ({ text: late ? `${LATE_PREFIX[block ?? 'quiet']} ${s}` : s, delayMs });

  switch (intent) {
    case 'tired': {
      const worry = worryOf(text);
      // 지쳤다는 말에는 늦게라도 반드시 전화를 약속한다 — 이 한 갈래만 상황을 안 탄다
      return { text: reactToWorry(worry, ctx.seed), delayMs: late ? Math.min(delayMs, 4 * 60_000) : delayMs, worry };
    }
    case 'call':
      return ok
        ? { ...say(r.pick(['오케이 지금 걸게!', '어 걸어. 받아.', '기다려 봐 지금 건다'])), callMe: true }
        : { text: `${LATE_PREFIX[block ?? 'quiet']} 나중에 내가 걸게.`, delayMs: Math.min(delayMs, 8 * 60_000) };
    case 'where':
      return say(`나 지금 ${where}야`);
    case 'what':
      return say(ctx.phase.kind === 'sleeping' ? '자고 있었지 ㅋㅋ' : `${doing}. ${where}에서.`);
    case 'howru': {
      if (ctx.status.fatigue > 65) return say('솔직히 좀 피곤해. 그래도 할 만해.');
      if (ctx.status.mood < 40) return say('음… 그냥 그래. 너는?');
      return say(r.pick(['나야 좋지! 너는?', '괜찮아. 오늘 나쁘지 않았어.', '좋아 좋아. 너는 어때?']));
    }
    case 'come':
      return say(ctx.phase.kind === 'sleeping' ? '나 집이야. 자고 있었어 ㅋㅋ' : `지금 ${where}인데, 끝나면 갈게`);
    case 'love':
      return say(r.pick(['ㅋㅋㅋ 갑자기 왜 그래', '나도 나도', '이런 말 자주 해줘']));
    case 'sorry':
      return say(r.pick(['괜찮아 진짜로', '뭐가 미안해 ㅋㅋ', '됐어 그런 거로']));
    case 'greet':
      return say(r.pick([`어 왔어? 나 ${where}야`, '안녕! 뭐 해?', '오 안녕']));
    case 'unknown':
      // 모르면 모른다고 한다. 아는 척하는 답이 제일 빨리 들킨다.
      return say(r.pick([
        `무슨 말인지 잘 모르겠다 ㅋㅋ 나는 지금 ${where}에 있어`,
        `음… 그게 무슨 말이야? 나 지금 ${doing}이야`,
        '어… 잘 모르겠어. 이따 전화로 말해줘',
      ]));
  }
}
