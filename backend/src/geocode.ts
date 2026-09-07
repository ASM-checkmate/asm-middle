// ─── 지오코딩 (docs/adr/0009-trip-search.md) ─────────────────────────────────
// Nominatim(OpenStreetMap) 공개 서버. 이용 정책: 초당 1회, 식별 가능한 User-Agent, 대량 조회 금지.
// 도시당 장소 열댓 개를 **순차로** 1.1초 간격으로 묻고 결과는 trip.ts가 파일에 캐시하므로 한 도시에 한 번이다.
// 자체 서버가 있으면 NOMINATIM_URL로 바꾼다.

export interface GeoHit { lat: number; lng: number; displayName: string; countryCode: string }

const MIN_GAP_MS = 1_100;
let lastCallAt = 0;

const baseUrl = () => (process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const userAgent = () => `theworld/0.1 (${process.env.NOMINATIM_CONTACT?.trim() || 'dev@localhost'})`;

/** 검색 URL. 순수 함수. */
export const nominatimUrl = (q: string, base = baseUrl()) =>
  `${base}/search?${new URLSearchParams({ q, format: 'jsonv2', limit: '1', addressdetails: '1', 'accept-language': 'ko,en' })}`;

/**
 * Nominatim 응답을 다듬는다. 순수 함수. 첫 결과만 본다.
 *
 * @param json 응답 JSON (배열)
 * @returns 좌표, 없으면 null
 */
export function parseNominatim(json: unknown): GeoHit | null {
  if (!Array.isArray(json) || !json.length) return null;
  const r = json[0] as { lat?: unknown; lon?: unknown; display_name?: unknown; address?: { country_code?: unknown } };
  const lat = Number(r.lat), lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: typeof r.display_name === 'string' ? r.display_name : '', countryCode: typeof r.address?.country_code === 'string' ? r.address.country_code.toUpperCase() : '' };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * 장소 이름 하나의 좌표. 정책대로 앞 호출과 1.1초를 띄운다.
 *
 * @param q "Kiyomizu-dera, Kyoto, JP"
 * @param timeoutMs 제한 시간
 * @returns 좌표, 못 찾거나 오류면 null (한 장소가 실패해도 팩은 살린다)
 */
export async function geocode(q: string, timeoutMs = 8_000): Promise<GeoHit | null> {
  // 서버 오류·제한 시간은 한 번 더 — 공개 서버는 가끔 429/5xx를 낸다. "결과 없음"(200에 빈 배열)은 다시 묻지 않는다
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    try {
      const res = await fetch(nominatimUrl(q), { headers: { 'user-agent': userAgent(), accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return parseNominatim(await res.json());
      console.warn(`[geocode] ${res.status} for ${JSON.stringify(q)}${res.status === 403 ? ' — Nominatim이 User-Agent를 거부했다. NOMINATIM_CONTACT에 진짜 연락처를 넣거나 비워 둔다 (example.com 같은 자리표시는 막힌다)' : ''}`);
      if (res.status === 403 || res.status === 400) return null;   // 다시 물어도 같다
    } catch (e) {
      console.warn(`[geocode] ${(e as Error).name} for ${JSON.stringify(q)}`);
    }
    await sleep(2_000);
  }
  return null;
}
