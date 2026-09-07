// ─── Ollama 호출 ──────────────────────────────────────────────────────────────
// /api/chat 하나만 쓴다. 생각 모드는 끈다 (답장 한 줄에 몇 초씩 더 걸릴 뿐이다).
// JSON 스키마를 `format`으로 넘겨 모델이 형식을 지키게 한다.
// 항상 스트리밍으로 받아 모은다 — 호출자가 끊으면(통화가 모델을 가져감) Ollama가 다음 토큰에서 바로 멈춘다.
// stream:false면 연결이 끊겨도 끝까지 돌아서 통화 첫마디가 그 뒤에 줄을 선다.

export interface OllamaConfig { url: string; timeoutMs: number }
/** 한 호출의 생성 옵션. 없는 것은 답장용 기본값. */
export interface ChatOpts { temperature?: number; numPredict?: number; timeoutMs?: number; /** 호출자가 끊는 신호 — 프론트가 요청을 닫으면 Ollama 생성도 멈춘다 */ signal?: AbortSignal }

export const configFromEnv = (): OllamaConfig => ({
  url: (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, ''),
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 25_000),
});

/**
 * 시스템·사용자 프롬프트로 JSON 한 덩어리를 받는다.
 *
 * @param cfg 서버 주소와 제한 시간
 * @param model Ollama 모델 태그 ("qwen3.8:27b")
 * @param system 시스템 프롬프트
 * @param user 사용자 프롬프트
 * @param schema 응답 JSON 스키마 (Ollama structured output)
 * @param images 사용자 메시지에 붙일 이미지 (base64, 접두 없이). 비전 모델만 받는다
 * @param opts 생성 옵션. 기본은 답장용(온도 0.9, 160토큰, cfg.timeoutMs) — 긴 구조화 출력은 여기서 늘린다
 * @returns 모델이 낸 JSON 문자열 (파싱은 호출자가)
 * @throws 서버 오류·제한 시간 초과. 모델이 없으면 Ollama의 메시지가 그대로 실린다.
 */
export async function chatJson(cfg: OllamaConfig, model: string, system: string, user: string, schema: object, images?: string[], opts: ChatOpts = {}): Promise<string> {
  const res = await fetch(`${cfg.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? cfg.timeoutMs)]) : AbortSignal.timeout(opts.timeoutMs ?? cfg.timeoutMs),
    body: JSON.stringify({
      model,
      stream: true,
      think: false,
      format: schema,
      keep_alive: '30m',     // 답장마다 17GB를 다시 올리지 않게
      options: { temperature: opts.temperature ?? 0.9, num_predict: opts.numPredict ?? 160 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user, ...(images?.length ? { images } : {}) }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let pending = '';
  let out = '';
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
      out += j.message?.content ?? '';
    }
  }
  return out;
}

/**
 * 모델을 미리 올려 둔다 (생성 없이). 통화 벨이 울릴 때 부르면 첫마디가 모델 로드(3~15초)를 기다리지 않는다.
 *
 * @throws 서버 오류·제한 시간
 */
export async function warmModel(cfg: OllamaConfig, model: string): Promise<void> {
  const res = await fetch(`${cfg.url}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ model, prompt: '', keep_alive: '30m' }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  await res.text();
}

/** 설치된 모델 태그들. 서버가 없으면 null. */
export async function installedModels(cfg: OllamaConfig): Promise<Set<string> | null> {
  try {
    const res = await fetch(`${cfg.url}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    const j = (await res.json()) as { models?: { name: string }[] };
    return new Set((j.models ?? []).map(m => m.name));
  } catch {
    return null;
  }
}
