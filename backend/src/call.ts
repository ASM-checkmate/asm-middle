import type { CallTurnRequest, WorryKey } from './contract.ts';
import type { OllamaConfig } from './ollama.ts';

// ─── 통화 (docs/adr/0011-voice-call.md) ───────────────────────────────────────
// 통화 한 턴의 말을 짓는다. 답장(reply.ts)과 같은 페르소나지만 **말로 하는 한두 문장**이고, 문장이 완성될 때마다
// 바로 흘려보낸다 — 프론트가 그 문장을 TTS에 넣어 목소리로 낸다. 언제 걸리고 받을 수 있는지는 여전히 프론트 규칙(sim/call.ts).

/** 한 턴에 낼 최대 토큰. 두 문장이면 넉넉하다 — 길면 통화가 독백이 된다. */
const TURN_TOKENS = 90;
/** 한 문장의 최대 길이 (문자). 넘으면 자른다 — TTS 한 조각의 상한이기도 하다. */
export const MAX_SENTENCE = 60;

const WORRY_KO: Record<WorryKey, string> = { work: '일', people: '사람', body: '몸', money: '돈', focus: '집중', blue: '기분', bored: '심심함' };
const WHY_KO: Record<CallTurnRequest['why'], string> = {
  worry: '아까 사용자가 힘들다고 해서 "이따가 전화할게"라고 약속했고, 지금 그 전화를 걸었다.',
  ask: '사용자가 전화해 달라고 해서 걸었다.',
  friction: '계획이 어긋나서(문이 닫혔거나 자리가 없어서) 딴 데로 갔다고 알려 주려고 걸었다.',
  out: '사용자가 먼저 걸어 왔다. 받았다.',
};

/**
 * 통화 프롬프트 두 장. 순수 함수 — 검사에서 그대로 본다.
 *
 * @param req 요청
 * @returns system(누구이고 왜 통화 중인가 + 말하는 규칙)과 user(지금까지 오간 말 + 이번에 들은 말)
 */
export function buildCallPrompt(req: CallTurnRequest): { system: string; user: string } {
  const { agent, situation: s } = req;
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : '딱히 없음');
  const system = [
    `너는 "${agent.name}"이다. 사용자의 오랜 친구이고, 자기 하루를 사는 사람이다. 지금 사용자와 **전화 통화 중**이다.`,
    `성격: ${list(agent.traits)}. 좋아하는 것: ${list(agent.likes)}. 싫어하는 것: ${list(agent.dislikes)}.`,
    `지금 상황: ${s.hhmm}, ${s.where}에서 ${s.doing}. 기분 ${s.mood}/100, 피로 ${s.fatigue}/100.`,
    WHY_KO[req.why],
    req.why === 'worry' && req.worry ? `사용자는 ${WORRY_KO[req.worry]} 때문에 힘들다고 했다. 먼저 그게 어땠는지 묻고, 듣고 나면 해결책이 아니라 **네가 오늘 뭘 하겠다**를 말한다 ("오늘은 조용한 데로 잡아 놨어").` : '',
    '',
    '규칙:',
    '- 말로 하는 통화다. 한국어 반말, 한 턴에 한두 문장, 문장은 짧게 (20자 안팎). 이모지·괄호·지문 금지. 존댓말·영어 금지.',
    '- 사용자가 말을 끝내면 그 말에 답한다. 물음이면 답하고, 힘든 얘기면 먼저 듣는다 ("어… 그랬구나").',
    '- 위치와 하는 일은 위의 "지금 상황"만 사실이다. 지어내지 않는다. 모르는 얘기면 모른다고 한다.',
    '- 사용자가 끊자고 하면 짧게 인사하고 끝낸다.',
    '- 답만 쓴다. 이름표·따옴표·설명 없이 네가 할 말만.',
  ].filter(l => l !== '').join('\n');
  const line = (m: { from: 'me' | 'agent'; text: string }) => `${m.from === 'me' ? '사용자' : agent.name}: ${m.text}`;
  const user = req.user === null
    ? [...(req.transcript.length ? ['[지금까지]', ...req.transcript.map(line), ''] : []), '[통화가 막 붙었다. 네가 먼저 말한다 — 여보세요 같은 첫마디부터.]'].join('\n')
    : [...(req.transcript.length ? ['[지금까지]', ...req.transcript.map(line), ''] : []), '[방금 들은 말]', `사용자: ${req.user}`].join('\n');
  return { system, user };
}

/**
 * 스트리밍 텍스트에서 완성된 문장을 떼어 낸다. 순수 함수.
 * 마침표·물음표·느낌표·줄바꿈에서 자르고(말줄임표는 안 자른다), 아직 안 끝난 꼬리는 돌려준다.
 *
 * @param buf 지금까지 받은 텍스트
 * @returns 완성된 문장들(다듬은 것)과 남은 꼬리
 */
export function splitSentences(buf: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buf;
  // 말줄임표(…)는 문장 끝이 아니다 — "어… 그랬구나."를 한 호흡으로 읽어야 자연스럽다
  const re = /[^.!?\n]*[.!?]+["'」)]*|[^\n]*\n/;
  for (;;) {
    const m = re.exec(rest);
    if (!m || m.index !== 0) break;
    const s = tidy(m[0]);
    if (s) sentences.push(s);
    rest = rest.slice(m[0].length);
  }
  return { sentences, rest: rest.replace(/^\s+/, '') };
}

/** 문장 하나를 통화 말투로 다듬는다 — 이름표·따옴표·이모지·지문을 걷어 내고 길이를 자른다. */
export function tidy(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[A-Za-z가-힣]{1,10}\s*:\s*/, '');           // "모모: "
  t = t.replace(/^["'「]+|["'」]+$/g, '');
  t = t.replace(/\([^)]*\)|\[[^\]]*\]|\*[^*]*\*/g, '').trim();   // (웃음) [지문] *행동*
  t = t.replace(/\p{Extended_Pictographic}/gu, '');
  t = t.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '').replace(/\s+/g, ' ').trim();   // 한자·중국어가 새어 나온다 ("집沙发上에서") — TTS가 중국어로 읽는다
  if (t.length > MAX_SENTENCE) t = t.slice(0, MAX_SENTENCE).replace(/[,\s]+\S*$/, '') + '…';
  return t;
}

/**
 * 통화 한 턴을 짓는다. Ollama를 스트리밍으로 받아 문장이 완성될 때마다 `onSentence`를 부른다.
 *
 * @param req 요청
 * @param model 모델 태그
 * @param cfg Ollama 설정
 * @param onSentence 문장 하나가 완성될 때마다
 * @param signal 끊기 — 사용자가 말을 끊으면 프론트가 요청을 닫고, Ollama는 연결이 끊기면 생성을 멈춘다
 * @param timeoutMs 제한 시간
 * @returns 이 턴의 전체 문장들
 * @throws Ollama 오류·제한 시간
 */
export async function callTurn(req: CallTurnRequest, model: string, cfg: OllamaConfig, onSentence: (s: string) => void, signal?: AbortSignal, timeoutMs = 20_000): Promise<string[]> {
  const { system, user } = buildCallPrompt(req);
  const res = await fetch(`${cfg.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model, stream: true, think: false, keep_alive: '30m',
      options: { temperature: 0.8, num_predict: TURN_TOKENS },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out: string[] = [];
  let buf = '';
  let pending = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const emit = (s: string) => { out.push(s); onSentence(s); };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line) continue;
      let j: { message?: { content?: string }; done?: boolean; error?: string };
      try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new Error(`ollama: ${j.error}`);
      buf += j.message?.content ?? '';
      const { sentences, rest } = splitSentences(buf);
      sentences.forEach(emit);
      buf = rest;
      if (j.done) break;
    }
  }
  const tail = tidy(buf);
  if (tail) emit(tail);
  return out;
}
