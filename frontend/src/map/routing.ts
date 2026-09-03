// ─── Real-street refinement of journey legs (OSRM public router) ────────────
// Estimates from sim/journey.ts are straight lines; here we swap in street geometry without touching durations.
// Cache: in-memory + localStorage keyed by fromId>toId>mode, 7-day TTL. 6 s timeout → keep the estimate.
import type { Journey, Leg, ScheduledActivity, TransportMode } from '../sim/types';
import { useWorld } from '../sim/store';
import { journeyKey } from '../sim/journey';

const OSRM = 'https://router.project-osrm.org/route/v1';
const TIMEOUT_MS = 6000;
const TTL_MS = 7 * 24 * 3600_000;
const LS_PREFIX = 'theworld.route.v1:';
const MAX_POINTS = 700;

const mem = new Map<string, [number, number][]>();
const inflight = new Map<string, Promise<Journey>>();
const failedAt = new Map<string, number>();       // soft backoff per leg key (2 min)

export const legKey = (l: Pick<Leg, 'fromId' | 'toId' | 'mode'>) => `${l.fromId}>${l.toId}>${l.mode}`;
const reverseKey = (l: Pick<Leg, 'fromId' | 'toId' | 'mode'>) => `${l.toId}>${l.fromId}>${l.mode}`;

function profileOf(mode: TransportMode): 'foot' | 'driving' | null {
  switch (mode) {
    case 'walk': return 'foot';
    case 'car': return 'driving';
    default: return null;                              // plane / boat geodesic; train / subway straight between stations (spec §4.5 §4.6 §8: never OSRM)
  }
}
const TOLERANCE_M: Record<TransportMode, number> = { walk: 3, car: 6, subway: 10, train: 40, plane: 0, boat: 0 };

// ─── Douglas–Peucker on a local equirectangular plane ───────────────────────
export function douglasPeucker(path: [number, number][], toleranceM: number): [number, number][] {
  if (path.length < 3 || toleranceM <= 0) return path;
  const lat0 = (path[0][1] * Math.PI) / 180;
  const kx = 111_320 * Math.cos(lat0), ky = 111_320;
  const px = path.map(([lng, lat]) => [lng * kx, lat * ky] as [number, number]);
  const keep = new Uint8Array(path.length); keep[0] = 1; keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const [ax, ay] = px[a], [bx, by] = px[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = px[i];
      let d2: number;
      if (len2 === 0) { d2 = (x - ax) ** 2 + (y - ay) ** 2; }
      else {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        d2 = (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2;
      }
      if (d2 > maxD) { maxD = d2; idx = i; }
    }
    if (maxD > tol2 && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < path.length; i++) if (keep[i]) out.push(path[i]);
  return out;
}

// ─── Cache ──────────────────────────────────────────────────────────────────
function readCache(key: string): [number, number][] | null {
  const m = mem.get(key); if (m) return m;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const j = JSON.parse(raw) as { t: number; path: [number, number][] };
    if (!j || !Array.isArray(j.path) || Date.now() - j.t > TTL_MS) { localStorage.removeItem(LS_PREFIX + key); return null; }
    mem.set(key, j.path); return j.path;
  } catch { return null; }
}
function writeCache(key: string, path: [number, number][]) {
  mem.set(key, path);
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify({ t: Date.now(), path })); } catch { /* quota — memory cache still works */ }
}

// ─── OSRM ───────────────────────────────────────────────────────────────────
async function fetchOsrmOnce(profile: 'foot' | 'driving', leg: Leg): Promise<[number, number][] | null> {
  const a = leg.path[0], b = leg.path[leg.path.length - 1];
  if (!a || !b) return null;
  const url = `${OSRM}/${profile}/${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}?overview=full&geometries=geojson&steps=false`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { code?: string; routes?: { geometry?: { coordinates?: [number, number][] } }[] };
    const coords = j.routes?.[0]?.geometry?.coordinates;
    if (j.code !== 'Ok' || !coords || coords.length < 2) return null;
    return coords;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** One retry after 800 ms (spec §8); the public `foot` profile often 404s, so a walk falls back to `driving`
 *  (still hugs real streets — far better than a straight line through the blocks). */
async function fetchOsrm(profile: 'foot' | 'driving', leg: Leg): Promise<[number, number][] | null> {
  let r = await fetchOsrmOnce(profile, leg);
  if (!r) { await sleep(800); r = await fetchOsrmOnce(profile, leg); }
  if (!r && profile === 'foot') r = await fetchOsrmOnce('driving', leg);
  return r;
}

/** Refine one leg: cached street geometry, or the same leg back if nothing better is available. */
export async function refineLeg(leg: Leg): Promise<Leg> {
  const profile = profileOf(leg.mode);
  if (!profile || leg.refined || leg.path.length < 2) return leg;
  const key = legKey(leg);
  const cached = readCache(key);
  if (cached) return { ...leg, path: cached, refined: true };
  // Direction-agnostic: the way back is the way there, reversed
  const back = readCache(reverseKey(leg));
  if (back) { const path = back.slice().reverse(); mem.set(key, path); return { ...leg, path, refined: true }; }
  const last = failedAt.get(key);
  if (last && Date.now() - last < 120_000) return leg;
  const raw = await fetchOsrm(profile, leg);
  if (!raw) { failedAt.set(key, Date.now()); return leg; }
  // Snap the ends to the real place so the marker starts/ends exactly on the pins
  const withEnds: [number, number][] = [leg.path[0], ...raw.slice(1, -1), leg.path[leg.path.length - 1]];
  let tol = TOLERANCE_M[leg.mode];
  let path = douglasPeucker(withEnds, tol);
  while (path.length > MAX_POINTS) { tol *= 1.6; path = douglasPeucker(withEnds, tol); }
  path = path.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
  writeCache(key, path);
  return { ...leg, path, refined: true };
}

/** Refine every leg (sequentially — the public router is rate-limited). Durations are never changed. */
export function refineJourney(fromId: string, toId: string, journey: Journey): Promise<Journey> {
  const key = journeyKey(fromId, toId);
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const legs: Leg[] = [];
    let changed = false;
    for (const leg of journey.legs) {
      const r = await refineLeg(leg);
      if (r !== leg) changed = true;
      legs.push(r);
    }
    return changed ? { legs, totalMin: journey.totalMin } : journey;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Refine and write back to the world store (durations unchanged, only paths + refined flags). */
export async function refineAndStore(fromId: string, toId: string, journey: Journey): Promise<Journey> {
  if (!journey.legs.length || journey.legs.every(l => l.refined || !profileOf(l.mode))) return journey;
  const refined = await refineJourney(fromId, toId, journey);
  if (refined !== journey) {
    const current = useWorld.getState().journeys[journeyKey(fromId, toId)] ?? journey;
    // Only write if the shape still matches what the store has (the day may have rolled over meanwhile)
    if (sameShape(current, refined)) useWorld.getState().setJourney(fromId, toId, refined);
  }
  return refined;
}

/** Fire-and-forget: call when an option is chosen so the street geometry is ready before departure. */
export function prefetchJourney(act: ScheduledActivity): void {
  void refineAndStore(act.fromPlace.id, act.place.id, act.journey).catch(() => { /* estimate stays */ });
}

/** Same legs (mode/from/to/duration) — the only thing allowed to differ is the path. */
export function sameShape(a: Journey, b: Journey): boolean {
  if (a.legs.length !== b.legs.length || a.totalMin !== b.totalMin) return false;
  return a.legs.every((l, i) => { const m = b.legs[i]; return m.mode === l.mode && m.fromId === l.fromId && m.toId === l.toId && m.durationMin === l.durationMin; });
}
