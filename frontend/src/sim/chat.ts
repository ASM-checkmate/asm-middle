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
//  · **읽는 것과 답하는 것은 다른 사건이다** (docs/adr/0005-read-receipts.md). 내 말에는 에이전트가
//    읽는 시각이 따로 달리고, 읽기 전까지 "1"이 붙는다(안읽씹). 읽고도 답하지 않는 갈래가 있다(읽씹).
//    연달아 보낸 말은 한 번에 읽고 한 번에 답한다 — 줄마다 봇처럼 받아치지 않는다.

/** 한 번에 보낼 수 있는 길이. 길어지면 대화가 아니라 편지가 된다. */
export const MAX_LEN = 60;
/** 받을 수 있을 때 읽기까지 (sim ms). 폰을 손에 쥐고 있는 것도 아니다. */
const READ_MS: [number, number] = [4_000, 30_000];
/** 읽고 나서 답을 치기까지 (sim ms). 즉답이면 봇처럼 읽힌다. */
const THINK_MS: [number, number] = [4_000, 14_000];
/** 못 받는 상황인데 언제 끝나는지 모를 때 읽기까지 (sim ms). 나중에 "아까 못 봤어"로 온다. */
const LATE_READ_MS = 26 * 60_000;
/** 막힌 상황이 끝난 뒤 폰을 다시 보기까지 (sim ms). */
const AFTER_BLOCK_MS: [number, number] = [60_000, 5 * 60_000];
/** 지쳤다는 말은 자다가도 이 안에 본다 — 이 한 갈래만 상황을 안 탄다. */
const URGENT_READ_MS = 4 * 60_000;
/** 놀거나 운동하는 중이면 힐끗 읽고 답은 이만큼 뒤에 (sim ms). 읽씹처럼 보이다가 답이 온다. */
const BUSY_REPLY_MS: [number, number] = [3 * 60_000, 9 * 60_000];
/** 기분이 이보다 낮으면 인사·애정 표현은 읽고 답하지 않는다. */
const SULK_MOOD = 35;
/** "이따가 전화할게"의 이따가 (sim ms). */
export const WORRY_CALL_MS = 38 * 60_000;
/** 채팅에서 전화를 부르면 이만큼 뒤에 벨이 울린다 (sim ms). */
export const ASK_CALL_MS = 20_000;

export interface ChatMsg {
  id: string;
  at: number;
  from: 'me' | 'agent';
  text: string;
  /** 에이전트가 읽는 시각 (내 말에만). 없으면 이미 읽은 것으로 본다 (읽음 표시가 생기기 전의 줄). */
  readAt?: number;
  /** 같이 읽히고 같이 답을 받는 묶음 — 묶음의 첫 말 id (내 말에만). 답장 id는 `${batch}:r`. */
  batch?: string;
}

/** 아직 에이전트가 안 읽은 내 말인가 — 말풍선 옆의 "1". */
export const isUnread = (m: ChatMsg, now: number) => m.from === 'me' && m.readAt !== undefined && m.readAt > now;

/**
 * 새 말이 들어갈 묶음. 아직 답이 도착하지 않은 묶음이 있으면 거기 붙고, 없으면 새 묶음이다.
 * "도착하지 않은 답"에는 아직 안 읽은 말도, 읽었지만 답이 오는 중인 것도 포함된다.
 *
 * @param msgs 저장된 실 (답장은 미래 시각을 달고 있다)
 * @param now 지금
 * @returns 열린 묶음의 id, 없으면 null
 */
export function openBatch(msgs: ChatMsg[], now: number): string | null {
  const last = [...msgs].reverse().find(m => m.from === 'me');
  if (!last?.batch) return null;
  const reply = msgs.find(m => m.id === `${last.batch}:r`);
  const unread = msgs.some(m => m.batch === last.batch && isUnread(m, now));
  return unread || (reply !== undefined && reply.at > now) ? last.batch : null;
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

export type Intent = 'tired' | 'where' | 'what' | 'howru' | 'call' | 'come' | 'love' | 'sorry' | 'greet' | 'ack' | 'unknown';

/** 답을 바라지 않는 추임새 — "ㅋㅋ", "ㅇㅇ", "응". 이것만 오면 읽고 만다 (사람도 그런다). */
const ACK_RE = /^[\s~!?.,ㅋㅎㅠㅜ♥\p{Extended_Pictographic}]*(?:(?:ㅇㅇ|ㅇㅋ|응|웅|엉|어|넹|넵|네|옹|오|아|음|흠|그래|그럼|굿|ok|okay|오케이?|알겠어|알았어|ㄱㄱ|ㅂㅂ|잘\s*자|굿밤|굿나잇)[\s~!?.,ㅋㅎㅠㅜ♥\p{Extended_Pictographic}]*)*$/iu;

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
  return ACK_RE.test(text) ? 'ack' : 'unknown';
}

/** 지쳤다는 말 안에서 무엇 때문인지 짚어 본다. 못 짚으면 몸으로 본다 (제일 안전한 오독). */
const WORRY_RE: [WorryKey, RegExp][] = [
  ['people', /사람|관계|친구|눈치|인간|팀|상사|가족/],
  ['work', /일|회사|업무|과제|시험|공부|프로젝트|숙제|취업/],
  ['money', /돈|월세|카드|생활비|가난|비싸/],
  ['focus', /집중|산만|딴생각|멍하/],
  ['blue', /우울|가라앉|안 좋|기분이|울적/],   // '그냥'은 넣지 않는다 — "그냥 지쳤어"는 몸으로 본다
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
  /** 그 묶음의 키 (묶음에 말이 더 붙으면 키도 바뀐다) */
  seed: string;
  /** 지금 (sim ms). 막힌 상황이 끝나는 시각까지 얼마나 남았는지 셈한다. 없으면 막힌 게 지금 끝나는 걸로 본다. */
  now?: number;
}

export interface ChatReply {
  /** 지금부터 읽기까지 (sim ms). 이 전까지 내 말 옆에 "1"이 붙어 있다. */
  readMs: number;
  /** 답장 한 줄. 없으면 읽고 답하지 않는다 (읽씹). */
  text?: string;
  /** 지금부터 답장이 도착하기까지 (sim ms). 읽씹이면 `readMs`와 같다. */
  delayMs: number;
  /** 고민으로 들었다면 그 갈래 — 스토어가 메모리에 적고 전화를 예약한다 */
  worry?: WorryKey;
  /** 전화를 걸어 달라는 말로 들었다 */
  callMe?: boolean;
}

/** 제목에서 장소를 뺀 활동 부분 ("펀시티에서 오락실 한 판" → "오락실 한 판"). sim/comic.ts의 activityStem과 같은 규칙. */
const doingOf = (title: string, placeName: string) =>
  title.replace(placeName, '').replace(/^[\s,·]*(에서|에|까지|로|의)?\s*/, '').trim() || title;

/** 지금 어디서 뭘 하는지 한 조각. 답장 대부분이 이걸 쓰고, LLM 프롬프트(sim/llm.ts)도 이걸 받는다. */
export function whereOf(phase: Phase): { where: string; doing: string } {
  switch (phase.kind) {
    case 'sleeping': return { where: '집', doing: '자는 중' };
    case 'waiting': return { where: phase.at.name, doing: '쉬는 중' };
    case 'moving': return { where: `${phase.act.place.name} 가는 길`, doing: '이동 중' };
    case 'active':
    case 'comic': return { where: phase.act.place.name, doing: doingOf(phase.act.option.title, phase.act.place.name) };
  }
}

/** "집이야" / "카페야" — 받침이 있으면 '이야'. */
const iya = (w: string) => {
  const c = w.charCodeAt(w.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? `${w}이야` : `${w}야`;
};

/** 못 받는 상황이 언제 끝나는지. 모르면 null — 그때는 그냥 한참 뒤에 본다. */
function blockEndsAt(phase: Phase): number | null {
  switch (phase.kind) {
    case 'sleeping': return phase.until;
    case 'moving': return phase.act.arriveAt;
    case 'active': return phase.act.endAt;
    default: return null;
  }
}

/**
 * 컨텍스트의 "지금". phase의 미래 시각(잠 깨는 시각 등)에서 읽기까지를 셈하는 데 쓴다.
 * 스토어가 `now`를 실어 주면 그걸 쓰고, 없으면(단위 검사) 막힌 것이 지금 끝나는 걸로 본다.
 */
const ctxNow = (ctx: ChatCtx) => ctx.now ?? blockEndsAt(ctx.phase) ?? 0;

/** 놀거나 운동하는 중 — 폰은 보지만 답은 미룬다. */
const absorbed = (phase: Phase) =>
  phase.kind === 'active' && (phase.act.option.category === 'play' || phase.act.option.category === 'exercise');

/** 못 받은 이유 한 조각 — LLM에게 "아까는 ~ 못 봤다"로 넘긴다 (sim/llm.ts). */
export const LATE_WHY: Record<string, string> = { sleeping: '자느라', onboard: '이동 중이라', quiet: '조용히 해야 하는 데라', meal: '밥 먹느라' };

/** 못 받는 상황이면 늦게 답하면서 먼저 사과한다. */
const LATE_PREFIX: Record<string, string> = {
  sleeping: '아 미안 자고 있었어.',
  onboard: '미안 이동 중이라 이제 봤어.',
  quiet: '미안 조용히 해야 하는 데라 이제 봤어.',
  meal: '밥 먹느라 늦게 봤다 ㅋㅋ',
};

/** 여러 줄을 한 번에 봤을 때 앞에 붙는 한마디. */
const MANY_PREFIX = ['ㅋㅋ 뭐야 한꺼번에', '어 이제 봤다', '오 많이 보냈네 ㅋㅋ', '헐 폭탄'];

/** 답이 있는 물음 중 두 번째로 답해 줄 수 있는 것 — 첫 답에 짧게 덧붙인다. */
const SECONDARY: ReadonlySet<Intent> = new Set(['where', 'what', 'howru']);

/** 물음 하나에 대한 답. 상황이 같으면 같은 시드로 같은 문장. */
function answer(intent: Intent, ctx: ChatCtx, r: ReturnType<typeof rng>, short: boolean): string {
  const { where, doing } = whereOf(ctx.phase);
  switch (intent) {
    case 'where': return `나 지금 ${iya(where)}`;
    case 'what': return ctx.phase.kind === 'sleeping' ? '자고 있었지 ㅋㅋ' : short ? (/중$/.test(doing) ? doing : `${doing} 중`) : `${doing}. ${where}에서.`;
    case 'howru':
      if (ctx.status.fatigue > 65) return short ? '좀 피곤하고' : '솔직히 좀 피곤해. 그래도 할 만해.';
      if (ctx.status.mood < 40) return short ? '그냥 그래' : '음… 그냥 그래. 너는?';
      return short ? '나야 좋지' : r.pick(['나야 좋지! 너는?', '괜찮아. 오늘 나쁘지 않았어.', '좋아 좋아. 너는 어때?']);
    case 'come': return ctx.phase.kind === 'sleeping' ? '나 집이야. 자고 있었어 ㅋㅋ' : `지금 ${where}인데, 끝나면 갈게`;
    case 'love': return r.pick(['ㅋㅋㅋ 갑자기 왜 그래', '나도 나도', '이런 말 자주 해줘']);
    case 'sorry': return r.pick(['괜찮아 진짜로', '뭐가 미안해 ㅋㅋ', '됐어 그런 거로']);
    case 'greet': return r.pick([`어 왔어? 나 ${iya(where)}`, '안녕! 뭐 해?', '오 안녕']);
    case 'call': return r.pick(['오케이 지금 걸게!', '어 걸어. 받아.', '기다려 봐 지금 건다']);
    case 'tired': case 'ack': return '';   // 위에서 따로 다룬다
    case 'unknown':
      // 모르면 모른다고 한다. 아는 척하는 답이 제일 빨리 들킨다.
      return r.pick([
        `무슨 말인지 잘 모르겠다 ㅋㅋ 나는 지금 ${where}에 있어`,
        `음… 그게 무슨 말이야? 나 지금 ${doing}이야`,
        '어… 잘 모르겠어. 이따 전화로 말해줘',
      ]);
  }
}

/**
 * 연달아 보낸 말들에 에이전트가 뭐라고 답하는가. **여기가 규칙 기반의 유일한 자리다** —
 * LLM이 들어오면 이 함수만 갈아끼운다.
 *
 * 읽는 시각과 답하는 시각이 따로 나온다. 못 받는 상황이면 그게 끝난 뒤에 읽고, 읽고도 답이
 * 없는 갈래(추임새만 왔을 때 · 기분이 바닥일 때의 인사)가 있다. 여러 줄이면 제일 급한 것에
 * 답하고, 물음이 하나 더 있으면 짧게 덧붙인다. 못 알아들은 줄은 알아들은 줄이 있으면 넘긴다.
 *
 * @param texts 한 묶음으로 온 내 말들 (보낸 순서)
 * @param ctx 지금 상태
 * @returns 읽기까지·답하기까지의 시간과 답장. `text`가 없으면 읽씹이다. 고민으로 들었으면 `worry`가 실린다.
 */
export function replyToAll(texts: string[], ctx: ChatCtx): ChatReply {
  const r = rng(`chat:${ctx.seed}`);
  const { ok, block } = pickupRule(ctx.phase);
  const late = !ok;

  // 읽기: 받을 수 있으면 금방, 아니면 막힌 게 끝난 뒤 (끝을 모르면 한참 뒤)
  const end = blockEndsAt(ctx.phase);
  const readMs = ok ? r.int(...READ_MS)
    : end !== null ? Math.max(end - ctxNow(ctx), 0) + r.int(...AFTER_BLOCK_MS)
    : LATE_READ_MS;
  const thinkMs = r.int(...THINK_MS);
  const prefix = late ? `${LATE_PREFIX[block ?? 'quiet']} ` : '';
  const many = texts.length >= 3 && r.next() < 0.6 ? `${r.pick(MANY_PREFIX)} ` : '';

  // 줄마다 뜻을 보고 급한 순서(INTENTS 순)로 세운다
  const order = (i: Intent) => { const k = INTENTS.findIndex(([id]) => id === i); return k < 0 ? INTENTS.length + (i === 'ack' ? 1 : 0) : k; };
  const intents = [...new Set(texts.map(intentOf))].sort((a, b) => order(a) - order(b));
  const primary = intents[0];

  // 읽씹 ① 추임새만 왔다
  if (primary === 'ack') return { readMs, delayMs: readMs };
  // 읽씹 ② 기분이 바닥인데 인사·애정 표현·모를 말 — 읽고 만다
  if (ctx.status.mood < SULK_MOOD && (primary === 'greet' || primary === 'love' || primary === 'unknown')) return { readMs, delayMs: readMs };

  const say = (text: string, delayMs = readMs + thinkMs): ChatReply => ({ readMs, text, delayMs });

  if (primary === 'tired') {
    // 지쳤다는 말에는 자다가도 반드시 전화를 약속한다 — 이 한 갈래만 상황을 안 탄다
    const tiredText = texts.find(t => intentOf(t) === 'tired') ?? texts[0];
    const worry = worryOf(tiredText);
    const readUrgent = Math.min(readMs, URGENT_READ_MS);
    return { readMs: readUrgent, text: reactToWorry(worry, ctx.seed), delayMs: readUrgent + thinkMs, worry };
  }
  if (primary === 'call') {
    return ok
      ? { ...say(answer('call', ctx, r, false)), callMe: true }
      : { readMs, text: `${LATE_PREFIX[block ?? 'quiet']} 나중에 내가 걸게.`, delayMs: Math.min(readMs, 8 * 60_000) + thinkMs };
  }

  // 알아들은 줄이 있으면 못 알아들은 줄은 넘긴다
  const known = intents.filter(i => i !== 'unknown' && i !== 'ack');
  const main = known[0] ?? primary;
  const second = known.find(i => i !== main && SECONDARY.has(i));
  let text = answer(main, ctx, r, false);
  if (second) text = `${text.replace(/[.!?]*$/, '')}. ${answer(second, ctx, r, true)}`;
  // 놀거나 운동 중이면 힐끗 보고 답은 나중에 — 한동안 읽씹처럼 보인다
  const delayMs = ok && absorbed(ctx.phase) ? readMs + r.int(...BUSY_REPLY_MS) : readMs + thinkMs;
  return say(`${prefix}${many}${text}`, delayMs);
}

/** 한 줄짜리 묶음. `replyToAll`과 같다. */
export const replyTo = (text: string, ctx: ChatCtx): ChatReply => replyToAll([text], ctx);

// ─── 여행지 찾은 뒤 (ADR-0009) ────────────────────────────────────────────────

/** 찾은 뒤에 말을 꺼내기까지 (sim ms). 답장 규칙과 같은 리듬 — 즉답이면 봇처럼 읽힌다. */
const TRIP_SAY_MS: [number, number] = [20_000, 90_000];

/**
 * "교토 가자" 뒤에 에이전트가 덧붙이는 한 줄. 찾았으면 장소 이름 둘을 대고, 못 찾았으면 그렇다고 하고,
 * 이미 아는 도시면 바로 좋다고 한다. 순수 함수 — 시각은 `replyToAll`과 같은 규칙(받을 수 있으면 금방,
 * 아니면 막힌 게 끝난 뒤).
 *
 * @param kind found(찾았다) · failed(못 찾았다) · known(이미 아는 도시)
 * @param ctx 지금 상태 (`seed`는 그 묶음의 키)
 * @param city 도시 이름 (한국어)
 * @param names 찾은 장소 이름들 (found일 때 둘까지 쓴다)
 * @returns 한 줄과 지금부터 도착까지의 시간
 */
export function tripFollowUp(kind: 'found' | 'failed' | 'known', ctx: ChatCtx, city: string, names: string[] = []): { text: string; delayMs: number } {
  const r = rng(`trip:${ctx.seed}:${kind}`);
  const { ok } = pickupRule(ctx.phase);
  const end = blockEndsAt(ctx.phase);
  const delayMs = ok ? r.int(...TRIP_SAY_MS) : end !== null ? Math.max(end - ctxNow(ctx), 0) + r.int(...AFTER_BLOCK_MS) : LATE_READ_MS;
  const [a, b] = names;
  const pair = a && b ? `${a}랑 ${b}` : a ?? '';
  const text = kind === 'found'
    ? (pair ? r.pick([`${city} 찾아봤어. ${pair} 가고 싶다. 다음 여행 칸에 넣어 둘게`, `${city} 좀 봤는데 ${pair} 괜찮아 보여. 여행 칸 열리면 거기로`]) : `${city} 찾아봤어. 다음 여행 칸에 넣어 둘게`)
    : kind === 'failed'
      ? r.pick([`${city} 찾아보려 했는데 잘 안 됐어. 나중에 다시 말해줘`, `${city}는 아직 잘 모르겠다. 다음에 다시 얘기하자`])
      : r.pick([`${city}? 나도 가고 싶었어. 다음 여행은 거기로 하자`, `오 ${city} 좋지. 여행 칸 열리면 거기 넣어 둘게`]);
  return { text: text.slice(0, MAX_LEN + 20), delayMs };
}
