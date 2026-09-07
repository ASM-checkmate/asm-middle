// ─── 웹 검색 (docs/adr/0009-trip-search.md) ──────────────────────────────────
// Ollama Web Search 하나만 쓴다 — ollama.com 무료 계정의 API 키(OLLAMA_API_KEY)로 부른다. 한도는 공개돼
// 있지 않다("개인용으로 넉넉한 무료 티어"). 도시당 한 번 검색하고 캐시하므로(trip.ts) 하루 수십 회 수준이다.
// web_fetch는 쓰지 않는다 — 시간 예산을 가장 쉽게 깨는 부분이다.

export interface SearchHit { title: string; url: string; content: string }

/** 스니펫 하나의 최대 길이 — 프롬프트에 세 검색 × 여덟 결과가 들어간다. */
export const SNIPPET_MAX = 500;
const SEARCH_URL = 'https://ollama.com/api/web_search';

/** 검색 키가 없다 — 서버는 503으로 돌려준다 (프론트는 "잘 안 됐어"). */
export class NoApiKeyError extends Error {
  constructor() { super('OLLAMA_API_KEY not set — web search unavailable'); this.name = 'NoApiKeyError'; }
}

/** `OLLAMA_API_KEY`. 없으면 NoApiKeyError. */
export function requireApiKey(): string {
  const k = process.env.OLLAMA_API_KEY?.trim();
  if (!k) throw new NoApiKeyError();
  return k;
}

/**
 * 도시 하나에 대해 던질 검색어들. 한국어 둘(명소, 먹고 자는 곳)과 영어 하나(교통 포함) — 영문 이름이 지오코딩에 필요하다.
 *
 * @param cityKo 사용자가 말한 도시 이름
 */
export const buildTripQueries = (cityKo: string): string[] => [
  `${cityKo} 여행 가볼 만한 곳 명소`,
  `${cityKo} 맛집 카페 호텔 추천`,
  `${cityKo} travel guide things to do airport station`,
];

/**
 * 검색 응답 본문을 다듬는다. 순수 함수 — 모양이 어긋난 항목은 버리고, 스니펫은 자른다.
 *
 * @param json 응답 JSON (`{ results: [{ title, url, content }] }`)
 */
export function parseSearchBody(json: unknown): SearchHit[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: SearchHit[] = [];
  for (const r of results as Partial<SearchHit>[]) {
    if (!r || typeof r.url !== 'string' || !r.url) continue;
    const content = typeof r.content === 'string' ? r.content.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX) : '';
    out.push({ title: typeof r.title === 'string' ? r.title.trim().slice(0, 120) : '', url: r.url, content });
  }
  return out;
}

/**
 * 한 번 검색한다.
 *
 * @param query 검색어
 * @param maxResults 결과 수 (Ollama 상한 10)
 * @param timeoutMs 제한 시간
 * @throws NoApiKeyError(키 없음) · 서버 오류 · 제한 시간
 */
export async function webSearch(query: string, maxResults = 8, timeoutMs = 12_000): Promise<SearchHit[]> {
  const key = requireApiKey();
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ query, max_results: Math.max(1, Math.min(10, maxResults)) }),
  });
  if (!res.ok) throw new Error(`web_search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseSearchBody(await res.json());
}
