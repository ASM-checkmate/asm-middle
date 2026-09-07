import { WORRY_KEYS, type ReplyRequest, type ReplyResponse, type WorryKey } from './contract.ts';
import { chatJson, type OllamaConfig } from './ollama.ts';

// ─── 답장 짓기 ────────────────────────────────────────────────────────────────
// 프론트의 sim/chat.ts `replyToAll`이 하던 "무슨 말을 할지"만 여기로 온다. "언제 읽고 언제 답할지"는
// 여전히 프론트의 규칙이다 — 모델은 시계를 모른다.

/** 답장의 최대 길이. 프론트 MAX_LEN(60)보다 조금 넉넉하게, 넘으면 자른다. */
export const MAX_REPLY = 80;

/** 모델에게 강제하는 응답 형식. */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: ['string', 'null'] },
    worry: { type: ['string', 'null'], enum: [...WORRY_KEYS, null] },
    callMe: { type: 'boolean' },
  },
  required: ['text', 'worry', 'callMe'],
} as const;

const WORRY_KO: Record<WorryKey, string> = { work: '일', people: '사람', body: '몸', money: '돈', focus: '집중', blue: '기분', bored: '심심함' };

/**
 * 프롬프트 두 장. 순수 함수 — 검사에서 그대로 본다.
 *
 * @param req 요청
 * @returns system(누구이고 어떤 상황인가 + 규칙)과 user(최근 대화 + 이번 묶음)
 */
export function buildPrompt(req: ReplyRequest): { system: string; user: string } {
  const { agent, situation: s } = req;
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : '딱히 없음');
  const system = [
    `너는 "${agent.name}"이다. 사용자의 오랜 친구이고, 자기 하루를 사는 사람이다. 사용자가 방금 카톡으로 말을 걸었고 너는 답장을 친다.`,
    `성격: ${list(agent.traits)}. 좋아하는 것: ${list(agent.likes)}. 싫어하는 것: ${list(agent.dislikes)}.`,
    `지금 상황: ${s.hhmm}, ${s.where}에서 ${s.doing}. 기분 ${s.mood}/100, 피로 ${s.fatigue}/100.`,
    s.lateWhy ? `아까는 ${s.lateWhy} 못 봤고 이제 봤다. 첫마디에 짧게 미안하다고 한다.` : '',
    s.worry ? `며칠 안에 사용자가 ${WORRY_KO[s.worry]} 때문에 힘들다고 했다. 기억하고 있다.` : '',
    '',
    '규칙:',
    '- 한국어 반말, 카톡 말투. 한두 문장, 60자 안. 줄바꿈 없이. 이모지는 거의 안 쓴다. 존댓말·영어 금지.',
    '- 사용자가 여러 줄을 보냈으면 한 번에 읽고 한 줄로 답한다. 급한 것부터: 힘들다는 말 > 전화해 달라는 말 > 물음 > 나머지.',
    '- 위치와 하는 일은 위의 "지금 상황"만 사실이다. 지어내지 않는다. 모르는 얘기면 모른다고 한다.',
    '- 사용자가 지쳤다·힘들다·우울하다고 하면: 무슨 일인지 놀라서 묻고 "이따가 전화할게"라고 약속한다. worry에 갈래를 적는다 (work=일·공부, people=사람·관계, body=몸·피곤, money=돈, focus=집중, blue=그냥 우울, bored=심심).',
    '- 사용자가 전화해 달라고 하면 callMe=true, "지금 걸게"라고 답한다.',
    '- 답하지 않는 게 자연스러우면 (추임새뿐이거나 이미 끝난 얘기) text를 null로 둔다.',
    '- JSON으로만 답한다: {"text": string|null, "worry": string|null, "callMe": boolean}',
  ].filter(l => l !== '').join('\n');

  const line = (m: { from: 'me' | 'agent'; text: string }) => `${m.from === 'me' ? '사용자' : agent.name}: ${m.text}`;
  const user = [
    ...(req.recent.length ? ['[최근 대화]', ...req.recent.map(line), ''] : []),
    '[방금 온 말]',
    ...req.texts.map(t => `사용자: ${t}`),
  ].join('\n');
  return { system, user };
}

/**
 * 모델이 낸 JSON을 계약대로 다듬는다. 형식이 어긋나면 **답장 없음**으로 본다 (틀린 말보다 침묵이 낫다).
 *
 * @param raw 모델 출력
 * @returns text·worry·callMe. 파싱 실패면 `{ text: null, worry: null, callMe: false }`
 */
export function parseReply(raw: string): Pick<ReplyResponse, 'text' | 'worry' | 'callMe'> {
  const none = { text: null, worry: null, callMe: false };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return none; }
  if (!j || typeof j !== 'object') return none;
  const o = j as Record<string, unknown>;
  let text: string | null = typeof o.text === 'string' ? o.text.replace(/\s*\n+\s*/g, ' ').trim() : null;
  if (text !== null) {
    if (text.length > MAX_REPLY) text = text.slice(0, MAX_REPLY).replace(/[,\s]+\S*$/, '') + '…';
    if (!text) text = null;
  }
  const worry = typeof o.worry === 'string' && (WORRY_KEYS as readonly string[]).includes(o.worry) ? (o.worry as WorryKey) : null;
  return { text, worry, callMe: o.callMe === true };
}

/**
 * 요청 하나에 답장 하나. 모델을 부르고 결과를 다듬는다.
 *
 * @param req 요청
 * @param model 쓸 모델 태그
 * @param cfg Ollama 설정
 * @throws Ollama 오류·제한 시간 (호출자가 502로 돌려준다 — 프론트는 규칙 기반 답장을 그대로 쓴다)
 */
export async function replyFor(req: ReplyRequest, model: string, cfg: OllamaConfig): Promise<ReplyResponse> {
  const t0 = Date.now();
  const { system, user } = buildPrompt(req);
  const raw = await chatJson(cfg, model, system, user, REPLY_SCHEMA);
  return { ...parseReply(raw), model, ms: Date.now() - t0 };
}
