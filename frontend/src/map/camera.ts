// ─── Camera choreography constants + pure math (MOVEMENT_SPEC §2) ───────────
import type { Leg, LngLat, TransportMode } from '../sim/types';
import { bearing as geoBearing, cumulativeKm } from '../sim/geo';

export interface CamPose { zoom: number; pitch: number; bearing: number }
export interface ModeCam extends CamPose { tau: number; extrude: boolean; dim: boolean }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const norm360 = (d: number) => ((d % 360) + 360) % 360;
export const log2 = (v: number) => Math.log(Math.max(v, 1e-6)) / Math.LN2;

/** Bearing so the leg's overall direction runs left → right across the screen. */
export function travelRightBearing(from: LngLat, to: LngLat): number {
  return norm360(geoBearing(from, to) - 90);
}

/** Per-mode constants. Plane zoom is decided by fitBounds at leg start (see index.tsx). */
export function modeCam(mode: TransportMode, routeKm: number, from: LngLat, to: LngLat): ModeCam {
  const bearing = travelRightBearing(from, to);
  switch (mode) {
    case 'walk': return { zoom: 17.2, pitch: 45, bearing, tau: 140, extrude: true, dim: false };
    case 'car': return { zoom: 15.6, pitch: 45, bearing, tau: 140, extrude: true, dim: false };
    case 'train': return { zoom: clamp(14.5 - log2(routeKm / 2), 9, 14), pitch: 40, bearing, tau: 200, extrude: false, dim: false };
    case 'subway': return { zoom: 14.2, pitch: 30, bearing, tau: 140, extrude: false, dim: true };
    // Floor 7.5 (spec: 10) — a 200 km crossing at z10 is an empty blue field; at ~z8 the coasts frame the route.
    case 'boat': return { zoom: clamp(12.5 - log2(routeKm / 10), 7.5, 13), pitch: 35, bearing, tau: 400, extrude: false, dim: false };
    // Plane: north-up globe (spec §2.2 bearing 0), pitched so the horizon sits in the top of the phone; zoom from fitBounds at leg start.
    case 'plane': return { zoom: 3.2, pitch: planePitchFor(3.2), bearing: 0, tau: 300, extrude: false, dim: false };
  }
}

/** Plane cruise zoom = fitBounds(arc, padding 70) clamped to [1.6, 6.5]: Seoul–Tokyo ≈ 3.2, Seoul–Paris ≈ 1.7, and a short
 *  domestic hop (Seoul–Jeju ≈ 5.6) keeps origin pill, plane, arc and destination pin apart instead of a sticker pile-up. */
export const PLANE_MAX_ZOOM = 6.5;
/** Floor for the cruise zoom. An intercontinental great circle (Seoul–New York spans ~111° of arc) fits at z ≈ 0.1, so the
 *  old 1.6 floor was ~2.8× too tight: neither city was on the 390 px stage and the globe filled it edge to edge with no
 *  limb. At z1.05 the globe is 512·2^1.05/π ≈ 338 px across — it fills the stage but keeps limb + atmosphere all round. */
export const PLANE_MIN_ZOOM = 1.05;
/** Flights under this length never cruise below PLANE_SHORT_MIN_ZOOM (the arc must be readable at ~450 km). */
export const PLANE_SHORT_KM = 700;
export const PLANE_SHORT_MIN_ZOOM = 5.5;
/** Lowest zoom the plane camera may reach (MapLibre allows down to -2). A polar cruise needs ~-1.3 to keep the whole globe
 *  on a 390 px stage — see planeZoomAtLat. */
export const PLANE_FLOOR_ZOOM = -2;

/** On the globe, apparent scale at the camera centre is 2^zoom / cos(lat): the same zoom over the pole draws an Earth 4.4×
 *  wider than over the equator, which is why a Seoul–New York cruise lost its limb between p 0.4 and 0.6 (centre at 77°N,
 *  the globe filling the stage edge to edge). So a plane leg stores an *equatorial* zoom and the follow loop converts it to
 *  the current centre latitude each frame — the framing, not the number, is what stays constant per leg (§2.1 "boring"). */
export const toEquatorZoom = (zoom: number, lat: number) => zoom - log2(Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
export const planeZoomAtLat = (zEq: number, lat: number, shortHop: boolean) => {
  const z = zEq + log2(Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  return clamp(shortHop ? Math.max(z, PLANE_SHORT_MIN_ZOOM) : z, PLANE_FLOOR_ZOOM, PLANE_MAX_ZOOM);
};
/** Cruise pitch by zoom: up to 30° for regional flights (z ≥ 3.2 — a thin horizon rim above the globe, not a third of the
 *  screen), easing to 0° by z2.2 where the whole globe is in frame and its limb already carries the curvature. */
export const planePitchFor = (zoom: number) => 30 * clamp((zoom - 2.2) / 1.0, 0, 1);

/** How far the cruise centre is pulled off the plane toward the arc midpoint (§2.2 "camTarget = lerp(planePos, mid, 0.35)").
 *  0.35 is right for a regional hop whose whole arc is a few degrees, but 0.35 of a 111° polar arc is a ~39° offset — at
 *  cruise zoom that parks the plane on the bezel (measured: x = 353 of 390 at p 0.8) and eventually behind the limb. So the
 *  pull is scaled by arc length: full 0.35 up to ~25° of arc, tapering to a fifth of it on an intercontinental leg. The hard
 *  guarantee is still the middle-60 % stage clamp in index.tsx — this only keeps the correction gentle and un-jerky. */
export const PLANE_MID_PULL = 0.35;
export const planeMidPull = (arcDeg: number) => PLANE_MID_PULL * clamp(25 / Math.max(arcDeg, 1e-3), 0.2, 1);

/** Great-circle separation between two points in degrees. */
export function angularDeg(a: LngLat, b: LngLat): number {
  const R = Math.PI / 180;
  const s = Math.sin(a.lat * R) * Math.sin(b.lat * R) + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lng - a.lng) * R);
  return (Math.acos(clamp(s, -1, 1)) * 180) / Math.PI;
}

// Easings (wall-clock)
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
/** cubic-bezier(.22,.8,.3,1) sampled by Newton iteration (x → t → y). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= (sx(t) - x) / d; }
    return sy(clamp(t, 0, 1));
  };
}
export const departEase = cubicBezier(0.22, 0.8, 0.3, 1);
export const cardEase = cubicBezier(0.22, 1, 0.36, 1);

/** Frame-rate-independent exponential lerp factor. */
export const lerpK = (dtMs: number, tauMs: number) => 1 - Math.exp(-dtMs / Math.max(1, tauMs));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export function lerpLngLat(a: LngLat, b: LngLat, k: number): LngLat {
  // Shortest way round the antimeridian
  let dl = b.lng - a.lng;
  if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
  return { lng: a.lng + dl * k, lat: lerp(a.lat, b.lat, k) };
}
export function lerpBearing(a: number, b: number, k: number): number {
  let d = norm360(b - a);
  if (d > 180) d -= 360;
  return norm360(a + d * k);
}
export const lerpPose = (a: CamPose, b: CamPose, k: number): CamPose => ({ zoom: lerp(a.zoom, b.zoom, k), pitch: lerp(a.pitch, b.pitch, k), bearing: lerpBearing(a.bearing, b.bearing, k) });

// ─── Path sampling (cached cumulative distance per leg) ─────────────────────
export interface LegSampler {
  leg: Leg;
  path: [number, number][];      // unwrapped longitudes, single line
  cum: number[];
  km: number;
  at: (f: number) => LngLat;
  /** Heading between two path fractions in degrees (0 = north). */
  headingBetween: (f0: number, f1: number) => number;
  /** Great-circle metres between two path fractions. */
  metresBetween: (f0: number, f1: number) => number;
}

/** Make longitudes continuous (no jump > 180°) so one LineString survives the globe seam. */
export function unwrap(path: [number, number][]): [number, number][] {
  if (path.length < 2) return path.slice();
  const out: [number, number][] = [[path[0][0], path[0][1]]];
  for (let i = 1; i < path.length; i++) {
    let lng = path[i][0];
    const prev = out[i - 1][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    out.push([lng, path[i][1]]);
  }
  return out;
}

export function makeSampler(leg: Leg): LegSampler {
  const path = unwrap(leg.path.length ? leg.path : [[0, 0]]);
  const cum = cumulativeKm(path);
  const km = cum[cum.length - 1];
  const at = (f: number): LngLat => {
    if (path.length === 1) return { lng: path[0][0], lat: path[0][1] };
    const target = clamp(f, 0, 1) * km;
    let lo = 1, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
    const i = lo;
    const seg = cum[i] - cum[i - 1];
    const t = seg > 0 ? (target - cum[i - 1]) / seg : 0;
    return { lng: path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, lat: path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t };
  };
  const headingBetween = (f0: number, f1: number) => geoBearing(at(f0), at(f1));
  const metresBetween = (f0: number, f1: number) => Math.abs(f1 - f0) * km * 1000;
  return { leg, path, cum, km, at, headingBetween, metresBetween };
}

/** Bounding box of a path as [[w,s],[e,n]] in unwrapped longitudes. */
export function bboxOf(path: [number, number][]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of path) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [[w, s], [e, n]];
}

/** Sampled "stations" along a rail leg (endpoints are the real stations). Fractions 0..1. */
export function stationFractions(mode: TransportMode, km: number): number[] {
  const n = mode === 'train' ? clamp(Math.round(km / 40), 2, 5) : clamp(Math.round(km / 1.5), 2, 6);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(n === 1 ? 1 : i / (n - 1));
  return out;
}

export const isRail = (m: TransportMode) => m === 'train' || m === 'subway';
export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
