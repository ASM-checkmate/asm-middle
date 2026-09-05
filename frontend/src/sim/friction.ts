import type { DayKey, Place, PlaceType } from './types';
import { PLACES } from './places';
import { haversineKm } from './geo';
import { rng } from './rng';

// ─── 마찰 (docs/adr/0001-agentness.md, SPEC 자율 생활과 개입) ─────────────────
// 계획대로 100% 되는 세계에는 판단이 없다. 도착하는 순간 문이 닫혀 있고, 자리가 없고, 비가 온다.
// 에이전트는 그 자리에서 정하고 **묻지 않는다** (오너 결정) — 나중에 통보한다.
//
// 마찰은 저장하지 않는다. `(계획, 시드)`의 순수 함수이고 `act.key`가 안정적이라
// `rng('friction:' + act.key)`로 매번 같은 값이 나온다. 저장하면 사용자가 계획을 바꿀 때
// 고아 레코드가 남는다. (encounters와 같은 방식이지만 저장조차 필요 없다.)

export type FrictionKind =
  | 'closed'    // 문을 닫았다 → 다른 곳으로
  | 'full'      // 자리가 없다 → 다른 곳으로
  | 'weather'   // 비 → 야외면 실내로
  | 'sold-out'  // 그건 다 팔렸다 → 제자리
  | 'detour';   // 좋은 마찰 — 가는 길에 더 끌리는 걸 발견했다

/** 계획과 실제가 어긋난 기록. 어긋나지 않은 활동에는 없다. */
export interface Outcome {
  kind: FrictionKind;
  /** 원래 가려던 곳. 우회했을 때만 `act.place`와 다르다 */
  plannedPlaceId: string;
  plannedTitle: string;
  /** 발길을 돌린 순간 = 계획한 곳에 닿은 시각 (제자리 마찰이면 도착 시각) */
  divertedAt: number;
  /** 에이전트의 그 자리 판단 한 줄 (sim/narrate.ts) */
  line: string;
}

export type Weather = 'clear' | 'rain' | 'hot' | 'cold';

/** 마찰이 일어날 기본 확률. 너무 잦으면 세계가 망가진 것처럼 읽힌다. */
const BASE = 0.22;
/** 그중 좋은 마찰(detour)의 비중. 좋은 어긋남이 있어야 마찰이 벌칙으로 읽히지 않는다. */
const DETOUR_SHARE = 0.2;
/** 대체 장소를 찾는 반경 (km). 이 안에 없으면 제자리 마찰로 내려앉는다. */
const ALT_RADIUS_KM = 2.5;

/** 문을 닫을 수 있는 곳 (공원·강가·집은 닫지 않는다). */
const CLOSABLE: ReadonlySet<PlaceType> = new Set<PlaceType>([
  'cafe', 'restaurant', 'library', 'cinema', 'museum', 'mall', 'arcade', 'bar', 'gym', 'market', 'temple', 'stadium', 'office', 'school',
]);
/** 자리가 찰 수 있는 곳. */
const FILLABLE: ReadonlySet<PlaceType> = new Set<PlaceType>(['cafe', 'restaurant', 'bar', 'cinema']);
/** 비를 그대로 맞는 곳. */
const OUTDOOR: ReadonlySet<PlaceType> = new Set<PlaceType>(['park', 'river', 'beach', 'mountain', 'island', 'market', 'stadium']);
/** 품절이 있을 수 있는 곳. */
const SELLS: ReadonlySet<PlaceType> = new Set<PlaceType>(['cafe', 'restaurant', 'market', 'mall', 'bar']);
/** 마찰이 아예 일어나지 않는 곳 (집과 이동 허브). */
const IMMUNE: ReadonlySet<PlaceType> = new Set<PlaceType>(['home', 'friend_home', 'hotel', 'station', 'airport', 'port']);

/** 대체 장소를 찾을 때 서로 바꿔 갈 만한 유형. */
const NEIGHBOUR: Partial<Record<PlaceType, PlaceType[]>> = {
  cafe: ['cafe', 'restaurant', 'library', 'park'],
  restaurant: ['restaurant', 'cafe', 'market'],
  bar: ['bar', 'restaurant', 'cafe'],
  park: ['park', 'river', 'cafe'],
  river: ['river', 'park'],
  library: ['library', 'cafe', 'museum'],
  museum: ['museum', 'library', 'mall'],
  gym: ['gym', 'park', 'river'],
  mall: ['mall', 'market', 'cafe'],
  market: ['market', 'mall', 'restaurant'],
  cinema: ['cinema', 'arcade', 'mall'],
  arcade: ['arcade', 'cinema', 'mall'],
  beach: ['beach', 'park'],
  mountain: ['mountain', 'park'],
};

/**
 * 그 날의 날씨. 하루 안의 모든 활동이 같은 날씨를 본다.
 * @param dayKey 그 하루 (`2026-09-05@Asia/Seoul`)
 * @returns 결정론적 날씨
 */
export function weatherOf(dayKey: DayKey): Weather {
  const n = rng(`weather:${dayKey}`).next();
  return n < 0.62 ? 'clear' : n < 0.84 ? 'rain' : n < 0.92 ? 'hot' : 'cold';
}

/** 이 장소·날씨에서 일어날 수 있는 마찰들. 비어 있으면 아무 일도 없다. */
function candidates(place: Place, weather: Weather): FrictionKind[] {
  if (IMMUNE.has(place.type)) return [];
  const out: FrictionKind[] = [];
  if (CLOSABLE.has(place.type)) out.push('closed');
  if (FILLABLE.has(place.type)) out.push('full');
  if (weather === 'rain' && OUTDOOR.has(place.type)) out.push('weather', 'weather');   // 비 오는 날 야외는 더 자주
  if (SELLS.has(place.type)) out.push('sold-out');
  return out;
}

/** 그 마찰이 발길을 돌리게 하는가 (아니면 제자리에서 벌어지는가). */
export const diverts = (kind: FrictionKind) => kind === 'closed' || kind === 'full' || kind === 'weather' || kind === 'detour';

/**
 * 도착 순간의 마찰을 굴린다. 시드가 `act.key`라 언제 다시 빌드해도 같은 결과가 나온다.
 *
 * @param key 활동의 안정적인 키 (`${dayKey}:${blockId}`)
 * @param place 계획한 장소
 * @param dayKey 그 하루 (날씨를 읽는다)
 * @returns 아무 일도 없으면 null
 */
export function rollFriction(key: string, place: Place, dayKey: DayKey): FrictionKind | null {
  const weather = weatherOf(dayKey);
  const pool = candidates(place, weather);
  const r = rng(`friction:${key}`);
  if (r.next() >= BASE) return null;
  // 좋은 마찰은 어디서든 일어난다 — 이게 없으면 마찰이 벌칙으로만 읽힌다
  if (r.next() < DETOUR_SHARE) return 'detour';
  return pool.length ? r.pick(pool) : null;
}

/**
 * 발길을 돌릴 곳을 고른다. 가까운 같은/비슷한 유형 중에서 결정론적으로 하나.
 * 제안 엔진을 부르지 않는다 — 이건 취향이 아니라 그 자리의 임기응변이라 "가장 가까운 비슷한 곳"이 맞다.
 *
 * @param planned 원래 가려던 곳
 * @param key 활동의 안정적인 키 (같은 활동이면 언제나 같은 대안)
 * @param kind 어떤 마찰인가 (비면 실내로 간다)
 * @returns 대체 장소, 없으면 null (그러면 제자리 마찰로 내려앉는다)
 */
export function pickAlternative(planned: Place, key: string, kind: FrictionKind): Place | null {
  const wanted = kind === 'weather'
    ? (['cafe', 'library', 'mall', 'museum', 'restaurant'] as PlaceType[])   // 비 오면 지붕 밑으로
    : NEIGHBOUR[planned.type] ?? [planned.type];
  const near = PLACES
    .filter(p => p.id !== planned.id && p.city === planned.city && wanted.includes(p.type))
    .map(p => ({ p, d: haversineKm(planned, p) }))
    .filter(x => x.d <= ALT_RADIUS_KM)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  if (!near.length) return null;
  return rng(`alt:${key}`).pick(near).p;
}
