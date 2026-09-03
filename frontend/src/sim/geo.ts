import type { LngLat } from './types';

const R = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Initial bearing in degrees (0 = north, clockwise). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle intermediate point at fraction f. */
export function slerp(a: LngLat, b: LngLat, f: number): LngLat {
  const φ1 = toRad(a.lat), λ1 = toRad(a.lng), φ2 = toRad(b.lat), λ2 = toRad(b.lng);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d < 1e-9) return { ...a };
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lng: toDeg(Math.atan2(y, x)) };
}

/** Great-circle arc as [lng,lat][] with n segments. */
export function geodesicPath(a: LngLat, b: LngLat, n = 64): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const p = slerp(a, b, i / n); out.push([p.lng, p.lat]); }
  return out;
}

/** Cumulative distances along a path (km). */
export function cumulativeKm(path: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineKm({ lng: path[i - 1][0], lat: path[i - 1][1] }, { lng: path[i][0], lat: path[i][1] }));
  }
  return cum;
}

/** Point + heading at fraction f (0..1) of a path, by distance. */
export function alongPath(path: [number, number][], f: number, cum?: number[]): { position: LngLat; heading: number } {
  if (path.length === 0) return { position: { lng: 0, lat: 0 }, heading: 0 };
  if (path.length === 1) return { position: { lng: path[0][0], lat: path[0][1] }, heading: 0 };
  const c = cum ?? cumulativeKm(path);
  const total = c[c.length - 1];
  const target = Math.min(Math.max(f, 0), 1) * total;
  let i = 1;
  while (i < c.length - 1 && c[i] < target) i++;
  const a = { lng: path[i - 1][0], lat: path[i - 1][1] }, b = { lng: path[i][0], lat: path[i][1] };
  const segLen = c[i] - c[i - 1];
  const t = segLen > 0 ? (target - c[i - 1]) / segLen : 0;
  return { position: { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t }, heading: bearing(a, b) };
}

export const lngLatOf = (p: { lng: number; lat: number }): LngLat => ({ lng: p.lng, lat: p.lat });
