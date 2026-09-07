import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRIP_PLACE_TYPES, type CityInfo, type PlaceType, type TripPlace, type TripPlanRequest, type TripPlanResponse } from './contract.ts';
import { chatJson, type OllamaConfig } from './ollama.ts';
import { buildTripQueries, webSearch, type SearchHit } from './search.ts';
import { geocode, type GeoHit } from './geocode.ts';

// ─── 여행지 찾기 (docs/adr/0009-trip-search.md) ──────────────────────────────
// "교토 가자"에 대해 도시 팩(도시 정보 + 장소들)을 만든다. 고정 파이프라인이다:
//   검색 3회(병렬) → 모델 1회(JSON 스키마로 추출) → 지오코딩(순차) → 조립·검증 → 캐시.
// 모델은 검색 스니펫에 있는 장소만 적고 근거 번호(src)를 단다. 좌표는 Nominatim이 정하고, 도심에서
// 너무 먼 결과는 버린다. "언제 무엇을 하는가"는 여기서 정하지 않는다 — 프론트의 규칙 엔진이 한다.

/** 스니펫이 프롬프트에 들어가는 최대 길이 (문자). 9B 모델의 32K 컨텍스트 안에서 넉넉하다. */
const SNIPPETS_MAX_CHARS = 9_000;
/** 도심에서 이보다 먼 지오코딩 결과는 다른 도시의 동명 장소로 본다 (km). */
const GEO_MAX_KM = 80;
/** 지오코딩이 없을 때 모델의 근사 좌표를 믿는 반경 (km). */
const APPROX_MAX_KM = 60;
/** 허브(공항·역·항구)는 옆 도시일 수 있다 — 도심에서 이 반경 안이면 받는다 (km). */
const HUB_MAX_KM = 200;
/** 팩이 성립하려면 필요한 비허브 장소 수. */
const MIN_PLACES = 6;
/** 지오코딩 없이 모델 근사값만으로 들어갈 수 있는 장소 수. 지도에 없는 이름은 대개 지어낸 이름이다 ("교토 시내 카페"). */
const MAX_APPROX = 3;
const HUB_TYPES: readonly PlaceType[] = ['airport', 'station', 'port'];

/** 얇은 팩 — 서버는 422로 돌려준다. */
export class ThinPlanError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ThinPlanError'; }
}

// ─── 모델 출력 ──────────────────────────────────────────────────────────────

export interface DraftPlace { nameKo: string; nameEn: string; type: PlaceType; area: string; emoji: string; lat: number; lng: number; src: number }
export interface DraftHub { nameKo: string; nameEn: string; lat: number; lng: number }
export interface TripDraft {
  key: string; nameKo: string; nameEn: string; country: string; tz: string; stayNights: number; hasSubway: boolean;
  hubs: { airport: DraftHub | null; station: DraftHub | null; port: DraftHub | null };
  places: DraftPlace[];
}

const hubSchema = { type: ['object', 'null'], properties: { nameKo: { type: 'string' }, nameEn: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }, required: ['nameKo', 'nameEn', 'lat', 'lng'] } as const;

/** 모델에게 강제하는 응답 형식 (Ollama structured output). */
export const TRIP_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    nameKo: { type: 'string' },
    nameEn: { type: 'string' },
    country: { type: 'string' },
    tz: { type: 'string' },
    stayNights: { type: 'integer', minimum: 0, maximum: 5 },
    hasSubway: { type: 'boolean' },
    hubs: { type: 'object', properties: { airport: hubSchema, station: hubSchema, port: hubSchema }, required: ['airport', 'station', 'port'] },
    places: {
      type: 'array', minItems: 6, maxItems: 14,
      items: {
        type: 'object',
        properties: {
          nameKo: { type: 'string' }, nameEn: { type: 'string' },
          type: { type: 'string', enum: TRIP_PLACE_TYPES.filter(t => !HUB_TYPES.includes(t)) },
          area: { type: 'string' }, emoji: { type: 'string' },
          lat: { type: 'number' }, lng: { type: 'number' }, src: { type: 'integer' },
        },
        required: ['nameKo', 'nameEn', 'type', 'area', 'emoji', 'lat', 'lng', 'src'],
      },
    },
  },
  required: ['key', 'nameKo', 'nameEn', 'country', 'tz', 'stayNights', 'hasSubway', 'hubs', 'places'],
} as const;

/**
 * 프롬프트 두 장. 순수 함수 — 검사에서 그대로 본다.
 *
 * @param cityKo 사용자가 말한 도시 이름
 * @param hits 검색 결과 (번호는 배열 순서 + 1)
 */
export function buildTripPrompt(cityKo: string, hits: SearchHit[]): { system: string; user: string } {
  const types = TRIP_PLACE_TYPES.filter(t => !HUB_TYPES.includes(t)).join(', ');
  const system = [
    '너는 여행 가이드북 편집자다. 아래 검색 결과만 근거로, 한 도시의 "장소 목록"을 JSON으로 만든다.',
    '',
    '규칙:',
    '- 검색 결과에 실제로 나오는 장소만 적는다. 지어내지 않는다. 각 장소에 근거가 된 결과 번호를 src에 적는다.',
    '- 고유명사가 있는 장소만. "역 앞 카페", "시내 식당"처럼 이름 없는 자리 채우기는 적지 않는다 — 6개밖에 없으면 6개만 적는다.',
    '- 장소는 6~14개. 서로 다른 유형을 섞는다 (카페·식당·시장·공원·박물관/명소·절/신사·쇼핑몰·산·해변·술집 등).',
    `- type은 다음 중 하나: ${types}. 명소·유적·전망대는 museum, 절·신사·성당은 temple, 거리·골목·상점가는 market으로 적는다.`,
    '- hotel은 정확히 1개 — 실제 있는 호텔 이름으로. 없으면 검색 결과에 나온 숙소 지역의 대표 호텔.',
    '- nameKo는 한국에서 흔히 쓰는 한국어 표기 ("기요미즈데라", "니시키 시장"), nameEn은 지도 검색용 로마자/영문 이름 ("Kiyomizu-dera").',
    '- area는 동네·구 이름 한국어 한 단어 ("기온", "아라시야마"). emoji는 그 장소에 어울리는 이모지 하나.',
    '- lat/lng는 아는 만큼 대략 적는다 (나중에 지도로 다시 확인한다).',
    '- hubs: airport는 이 도시에서 가장 가까운 **국제공항** (옆 도시여도 된다 — 교토면 간사이). station은 고속철·주요 역. port는 실제 여객선 항구가 있을 때만, 없으면 null. 허브에도 nameEn(공항 코드 같은 괄호는 빼고)과 대략 lat/lng를 적는다.',
    '- key는 도시의 영문 소문자 슬러그 ("kyoto", "chiang-mai"). country는 ISO 3166-1 alpha-2 ("JP"). tz는 IANA 시간대 ("Asia/Tokyo").',
    '- stayNights는 서울에서 가는 여행의 적당한 박수 (국내 1, 가까운 해외 2, 먼 해외 3). hasSubway는 시내 지하철·전철망이 있으면 true.',
    '- JSON으로만 답한다.',
  ].join('\n');
  let used = 0;
  const lines: string[] = [];
  hits.forEach((h, i) => {
    const line = `[${i + 1}] ${h.title} — ${h.url}\n${h.content}`;
    if (used + line.length > SNIPPETS_MAX_CHARS) return;
    used += line.length;
    lines.push(line);
  });
  const user = [`도시: ${cityKo}`, '', '[검색 결과]', ...lines].join('\n\n');
  return { system, user };
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
/** "Kiyomizu-dera Temple" → "kiyomizu-dera-temple". 로마자가 아니면 빈 문자열. */
export const slugify = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const isTz = (tz: unknown): tz is string => { if (typeof tz !== 'string' || !tz) return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** 지오코딩용 이름 — "Kansai International Airport (KIX)"의 괄호는 Nominatim을 헷갈리게 한다. */
const nameForGeo = (v: unknown) => str(v).replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

/**
 * 모델 출력을 다듬는다. 순수 함수. 근거 번호가 범위 밖이거나 유형이 틀린 장소는 버리고, 이름이 겹치면 앞 것만,
 * 호텔은 첫 하나만 남긴다. 도시 자체가 틀렸으면(키·나라·시간대) null.
 *
 * @param raw 모델 출력
 * @param hitCount 검색 결과 수 (src의 상한)
 */
export function parseTripDraft(raw: string, hitCount: number): TripDraft | null {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  const nameEn = str(o.nameEn);
  let key = str(o.key).toLowerCase();
  if (!SLUG_RE.test(key)) key = slugify(nameEn);
  if (!SLUG_RE.test(key)) return null;
  const country = str(o.country).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !isTz(o.tz)) return null;
  const nameKo = str(o.nameKo);
  if (!nameKo) return null;
  const hub = (v: unknown): DraftHub | null => {
    if (!v || typeof v !== 'object') return null;
    const h = v as Record<string, unknown>;
    const nk = str(h.nameKo), ne = nameForGeo(h.nameEn);
    return nk && ne ? { nameKo: nk, nameEn: ne, lat: finite(h.lat) ? h.lat : NaN, lng: finite(h.lng) ? h.lng : NaN } : null;
  };
  const hubs0 = (o.hubs && typeof o.hubs === 'object' ? o.hubs : {}) as Record<string, unknown>;
  const places: DraftPlace[] = [];
  const seen = new Set<string>();
  let hotel = false;
  for (const v of Array.isArray(o.places) ? o.places : []) {
    if (!v || typeof v !== 'object') continue;
    const p = v as Record<string, unknown>;
    const nk = str(p.nameKo), ne = nameForGeo(p.nameEn);
    const type = str(p.type) as PlaceType;
    if (!nk || !ne || !TRIP_PLACE_TYPES.includes(type) || HUB_TYPES.includes(type)) continue;
    if (!Number.isInteger(p.src) || (p.src as number) < 1 || (p.src as number) > hitCount) continue;
    const dup = nk.toLowerCase();
    if (seen.has(dup)) continue;
    if (type === 'hotel') { if (hotel) continue; hotel = true; }
    seen.add(dup);
    places.push({ nameKo: nk, nameEn: ne, type, area: str(p.area), emoji: str(p.emoji).slice(0, 4), lat: finite(p.lat) ? p.lat : NaN, lng: finite(p.lng) ? p.lng : NaN, src: p.src as number });
    if (places.length >= 14) break;
  }
  return {
    key, nameKo, nameEn, country, tz: o.tz, hasSubway: o.hasSubway === true,
    stayNights: finite(o.stayNights) ? Math.max(0, Math.min(5, Math.round(o.stayNights))) : (country === 'KR' ? 1 : 2),
    hubs: { airport: hub(hubs0.airport), station: hub(hubs0.station), port: hub(hubs0.port) },
    places,
  };
}

/** 모델이 적은 장소 근사 좌표들의 중앙값. 셋 미만이면 null. */
export function approxCentre(d: TripDraft): { lat: number; lng: number } | null {
  const pts = d.places.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length < 3) return null;
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { lat: med(pts.map(p => p.lat)), lng: med(pts.map(p => p.lng)) };
}

// ─── 조립 ─────────────────────────────────────────────────────────────────────

const R = 6371;
/** 두 점 사이 거리 (km). 프론트 sim/geo.ts와 같은 식. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const TYPE_EMOJI: Partial<Record<PlaceType, string>> = {
  cafe: '☕', restaurant: '🍽️', park: '🌳', gym: '🏋️', library: '📚', cinema: '🎬', mall: '🛍️', river: '🌊', beach: '🏖️', museum: '🏛️',
  arcade: '🕹️', bar: '🍻', station: '🚄', airport: '✈️', port: '⛴️', temple: '⛩️', market: '🧺', hotel: '🏨', stadium: '🏟️', mountain: '⛰️', island: '🏝️',
};
const HUB_EMOJI: Record<'airport' | 'station' | 'port', string> = { airport: '✈️', station: '🚄', port: '⛴️' };

/** 지오코딩 결과: 조회한 이름 → 좌표(없으면 null). 순차 조회의 결과를 여기 모아 조립에 넘긴다. */
export type GeoMap = Map<string, GeoHit | null>;
/** 지오코딩할 이름. 영문 이름 + 도시 + 나라 — 동명이인을 줄인다. */
export const geoQuery = (nameEn: string, cityEn: string, country: string) => `${nameEn}, ${cityEn}, ${country}`;
/** 허브는 옆 도시일 수 있다 (간사이 공항은 오사카) — 도시를 붙이면 Nominatim이 못 찾으므로 나라만 붙인다. */
export const hubQuery = (nameEn: string, country: string) => `${nameEn}, ${country}`;

/**
 * 초안 + 좌표 → 도시 팩. 순수 함수.
 * 좌표 규칙: 도심 80km 안의 지오코딩 결과 > 60km 안의 모델 근사값 > 버림.
 * 허브(공항·역·항구)는 장소로도 만든다 — 프론트의 journey.ts가 그 id로 구간을 짠다.
 *
 * @param d 초안
 * @param geo 지오코딩 결과
 * @param centre 도심 좌표 (도시 이름을 지오코딩한 것)
 */
export function assembleCity(d: TripDraft, geo: GeoMap, centre: { lat: number; lng: number }): { city: CityInfo; places: TripPlace[] } {
  const ids = new Set<string>();
  const idOf = (nameEn: string, fb: string) => {
    const base = `${d.key}-${slugify(nameEn) || fb}`;
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  const coord = (nameEn: string, approx: { lat: number; lng: number }): { lat: number; lng: number; geocoded: boolean } | null => {
    // 도시를 붙인 조회가 먼저, 없으면 나라만 붙인 조회 — 어느 쪽이든 도심 반경 안이어야 한다
    const g = geo.get(geoQuery(nameEn, d.nameEn, d.country)) ?? geo.get(hubQuery(nameEn, d.country));
    if (g && haversineKm(g, centre) <= GEO_MAX_KM) return { lat: g.lat, lng: g.lng, geocoded: true };
    if (Number.isFinite(approx.lat) && Number.isFinite(approx.lng) && haversineKm(approx, centre) <= APPROX_MAX_KM) return { ...approx, geocoded: false };
    return null;
  };
  const places: TripPlace[] = [];
  const hubs: CityInfo['hubs'] = {};
  for (const kind of ['airport', 'station', 'port'] as const) {
    const h = d.hubs[kind];
    if (!h) continue;
    // 허브는 옆 도시일 수 있다 (교토 → 간사이): 200km 안의 지오코딩 결과, 없으면 200km 안의 모델 근사값, 그것도 없으면 허브 없음
    const g = geo.get(hubQuery(h.nameEn, d.country));
    const c = g && haversineKm(g, centre) <= HUB_MAX_KM ? { lat: g.lat, lng: g.lng }
      : Number.isFinite(h.lat) && Number.isFinite(h.lng) && haversineKm(h, centre) <= HUB_MAX_KM ? { lat: h.lat, lng: h.lng } : null;
    if (!c) continue;
    const id = idOf(h.nameEn, kind);
    places.push({ id, name: h.nameKo, type: kind, lng: c.lng, lat: c.lat, area: d.nameKo, city: d.key, country: d.country, emoji: HUB_EMOJI[kind] });
    hubs[kind] = id;
  }
  if (hubs.airport) hubs.intlAirport = hubs.airport;
  if (d.hasSubway) hubs.hasSubway = true;
  // 국내인데 역이 없으면 비행기로만 간다 — 프론트의 tripKind/journey가 같은 판단을 하도록 장소에 적는다
  const planeOnly = d.country === 'KR' && !hubs.station && !!hubs.airport;
  // 지도(Nominatim)에 있는 장소가 먼저다. 근사값만 있는 장소는 몇 개까지만 — 지도에 없는 이름은 대개 지어낸 이름이다
  const located = d.places.map(p => ({ p, c: coord(p.nameEn, { lat: p.lat, lng: p.lng }) })).filter((x): x is { p: DraftPlace; c: NonNullable<ReturnType<typeof coord>> } => !!x.c);
  let approx = 0;
  for (const { p, c } of located) {
    // 호텔은 상한에서 뺀다 — 팩에 꼭 하나 있어야 하고, 작은 숙소는 지도에 없는 일이 흔하다
    if (!c.geocoded && p.type !== 'hotel' && ++approx > MAX_APPROX) continue;
    const place: TripPlace = { id: idOf(p.nameEn, p.type), name: p.nameKo, type: p.type, lng: c.lng, lat: c.lat, area: p.area || d.nameKo, city: d.key, country: d.country, emoji: p.emoji || TYPE_EMOJI[p.type] || '📍' };
    if (planeOnly) place.reachBy = 'plane';
    places.push(place);
  }
  const city: CityInfo = { key: d.key, nameKo: d.nameKo, nameEn: d.nameEn, country: d.country, tz: d.tz, stayNights: d.stayNights, hubs };
  return { city, places };
}

/**
 * 팩이 하루를 굴릴 만큼 두꺼운지. 비허브 장소 6개 + 호텔 1개 + (해외: 공항 / 국내: 역이나 공항).
 *
 * @throws ThinPlanError 부족한 것을 한 줄로
 */
export function validatePlan(city: CityInfo, places: TripPlace[]): void {
  const body = places.filter(p => !HUB_TYPES.includes(p.type));
  if (body.length < MIN_PLACES) throw new ThinPlanError(`only ${body.length} places for ${city.key} (need ${MIN_PLACES})`);
  if (!body.some(p => p.type === 'hotel')) throw new ThinPlanError(`no hotel for ${city.key}`);
  if (city.country !== 'KR' ? !city.hubs.airport : !(city.hubs.station || city.hubs.airport)) throw new ThinPlanError(`no hub for ${city.key}`);
}

// ─── 캐시 ─────────────────────────────────────────────────────────────────────
// 같은 도시를 두 번 검색하지 않는다 — 검색 한도와 지오코딩 정책 둘 다를 위해. 메모리 + 파일(.cache/trip/<key>.json).

const cacheDir = () => process.env.TRIP_CACHE_DIR ?? join(process.cwd(), '.cache', 'trip');
const mem = new Map<string, TripPlanResponse>();
const inflight = new Map<string, Promise<TripPlanResponse>>();
/** 요청 도시명의 정규화 — "교토"/"Kyoto "/"kyoto"가 같은 칸을 본다. */
export const normCity = (s: string) => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
/** 캐시 파일 이름. 한글 키는 퍼센트 인코딩해 서로 다른 도시가 한 파일에 겹치지 않게 한다 ("교토" → _EA_B5_90_ED_86_A0). */
const fileOf = (key: string) => join(cacheDir(), `${encodeURIComponent(key).replace(/[%*'()!~]/g, '_')}.json`);

/** 검색 결과도 파일에 남긴다 — 뒤 단계(모델·지오코딩)가 실패해도 검색 한도를 다시 쓰지 않게. */
async function searchCached(norm: string, city: string): Promise<SearchHit[]> {
  const f = fileOf(`search-${norm}`);
  try { const j = JSON.parse(await readFile(f, 'utf8')) as SearchHit[]; if (Array.isArray(j) && j.length) return j; } catch { /* 없음 */ }
  const hits = (await Promise.all(buildTripQueries(city).map(q => webSearch(q)))).flat();
  if (hits.length) { try { await mkdir(cacheDir(), { recursive: true }); await writeFile(`${f}.tmp`, JSON.stringify(hits), 'utf8'); await rename(`${f}.tmp`, f); } catch { /* 캐시는 최선 노력 */ } }
  return hits;
}

async function readCache(key: string): Promise<TripPlanResponse | null> {
  const m = mem.get(key);
  if (m) return m;
  try {
    const j = JSON.parse(await readFile(fileOf(key), 'utf8')) as TripPlanResponse;
    if (j?.city?.key && Array.isArray(j.places)) { mem.set(key, j); return j; }
  } catch { /* 없음 */ }
  return null;
}

async function writeCache(keys: string[], plan: TripPlanResponse): Promise<void> {
  for (const k of keys) mem.set(k, plan);
  try {
    await mkdir(cacheDir(), { recursive: true });
    for (const k of keys) {
      const f = fileOf(k), tmp = `${f}.tmp`;
      await writeFile(tmp, JSON.stringify(plan), 'utf8');
      await rename(tmp, f);
    }
  } catch (e) { console.warn(`[trip] cache write failed: ${(e as Error).message}`); }
}

// ─── 파이프라인 ───────────────────────────────────────────────────────────────

export interface TripConfig { model: string; modelTimeoutMs: number }

/**
 * 도시 팩 하나를 만든다 (캐시되면 즉시).
 *
 * @param req 요청
 * @param cfg Ollama 설정
 * @param trip 추출 모델과 제한 시간
 * @param signal 끊기 — 통화가 모델을 가져가면 추출을 멈춘다 (검색 결과는 캐시돼 다음에 이어진다)
 * @throws NoApiKeyError · ThinPlanError · 검색/모델/지오코딩 오류
 */
export function planTrip(req: TripPlanRequest, cfg: OllamaConfig, trip: TripConfig, signal?: AbortSignal): Promise<TripPlanResponse> {
  const norm = normCity(req.city);
  const running = inflight.get(norm);
  if (running) return running;
  const p = (async () => {
    const cached = await readCache(norm);
    if (cached) return { ...cached, cached: true, ms: 0 };
    const t0 = Date.now();
    const hits = await searchCached(norm, req.city);
    if (!hits.length) throw new Error(`no search results for ${req.city}`);
    const { system, user } = buildTripPrompt(req.city, hits);
    const raw = await chatJson(cfg, trip.model, system, user, TRIP_SCHEMA, undefined, { temperature: 0.2, numPredict: 2500, timeoutMs: trip.modelTimeoutMs, signal });
    const draft = parseTripDraft(raw, hits.length);
    if (!draft) throw new Error(`model output unusable for ${req.city}`);
    console.log(`[trip] ${req.city} draft ${draft.key} ${draft.country} ${draft.places.length} places (hotel ${draft.places.some(p => p.type === 'hotel') ? 'yes' : 'no'}) hubs ${Object.entries(draft.hubs).filter(([, h]) => h).map(([k, h]) => `${k}=${h!.nameEn}`).join(', ') || 'none'}`);
    // 도심: 지오코딩이 먼저, 안 되면 모델이 적은 근사 좌표들의 중앙값 (한 번의 실패로 검색·추출을 버리지 않게)
    const centre = (await geocode(`${draft.nameEn}, ${draft.country}`)) ?? approxCentre(draft);
    if (!centre) throw new Error(`cannot geocode city ${draft.nameEn}`);
    const geo: GeoMap = new Map();
    const lookup = async (q: string) => { if (!geo.has(q)) geo.set(q, await geocode(q)); return geo.get(q) ?? null; };
    for (const h of Object.values(draft.hubs)) if (h) await lookup(hubQuery(h.nameEn, draft.country));
    for (const p of draft.places) {
      const g = await lookup(geoQuery(p.nameEn, draft.nameEn, draft.country));
      // 도시를 붙여서 못 찾으면 나라만 붙여 한 번 더 (반경 검사는 조립에서)
      if (!g || haversineKm(g, centre) > GEO_MAX_KM) await lookup(hubQuery(p.nameEn, draft.country));
    }
    const { city, places } = assembleCity(draft, geo, centre);
    const kept = new Set(places.map(p => p.name));
    const dropped = draft.places.filter(p => !kept.has(p.nameKo)).map(p => `${p.nameKo}(${p.nameEn})`);
    if (dropped.length) console.log(`[trip] ${req.city} dropped ${dropped.length}: ${dropped.join(', ')}`);
    validatePlan(city, places);
    const plan: TripPlanResponse = { city, places, sources: [...new Set(hits.map(h => h.url))].slice(0, 24), cached: false, model: trip.model, ms: Date.now() - t0 };
    await writeCache([norm, normCity(city.nameKo), city.key], plan);
    return plan;
  })();
  inflight.set(norm, p);
  return p.finally(() => inflight.delete(norm));
}
