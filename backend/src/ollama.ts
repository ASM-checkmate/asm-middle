// ─── Ollama 호출 ──────────────────────────────────────────────────────────────
// /api/chat 하나만 쓴다. 생각 모드는 끈다 (답장 한 줄에 몇 초씩 더 걸릴 뿐이다).
// JSON 스키마를 `format`으로 넘겨 모델이 형식을 지키게 한다.

export interface OllamaConfig { url: string; timeoutMs: number }

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
 * @returns 모델이 낸 JSON 문자열 (파싱은 호출자가)
 * @throws 서버 오류·제한 시간 초과. 모델이 없으면 Ollama의 메시지가 그대로 실린다.
 */
export async function chatJson(cfg: OllamaConfig, model: string, system: string, user: string, schema: object, images?: string[]): Promise<string> {
  const res = await fetch(`${cfg.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(cfg.timeoutMs),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: schema,
      keep_alive: '30m',     // 답장마다 17GB를 다시 올리지 않게
      options: { temperature: 0.9, num_predict: 160 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user, ...(images?.length ? { images } : {}) }],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { message?: { content?: string }; error?: string };
  if (j.error) throw new Error(`ollama: ${j.error}`);
  return j.message?.content ?? '';
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
