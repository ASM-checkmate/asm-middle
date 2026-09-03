import type { Journey, Leg, Place, TransportMode } from './types';
import { CITY_HUBS, placeById } from './places';
import { geodesicPath, haversineKm } from './geo';

// ─── Mode selection + synchronous estimate ────────────────────────────────
// Durations are fixed at estimate time so the timeline never shifts after the fact;
// real street geometry is swapped in later by refineJourney() (see map/routing.ts).

const SPEED_KMH: Record<TransportMode, number> = { walk: 4.5, car: 30, subway: 28, train: 150, plane: 760, boat: 30 };
const OVERHEAD_MIN: Record<TransportMode, number> = { walk: 0, car: 4, subway: 10, train: 20, plane: 95, boat: 45 };
const ROAD_FACTOR: Record<TransportMode, number> = { walk: 1.25, car: 1.3, subway: 1.35, train: 1.15, plane: 1, boat: 1.05 };
const WALK_MAX_KM = 1.7;
const TRAIN_MAX_KM = 700;

export const MODE_LABEL: Record<TransportMode, string> = { walk: '걸어서', car: '차 타고', subway: '지하철로', train: '기차로', plane: '비행기로', boat: '배 타고' };
export const MODE_EMOJI: Record<TransportMode, string> = { walk: '🚶', car: '🚗', subway: '🚇', train: '🚄', plane: '✈️', boat: '⛴️' };

function makeLeg(mode: TransportMode, from: Place, to: Place, label?: string): Leg {
  const straight = haversineKm(from, to);
  const distanceKm = straight * ROAD_FACTOR[mode];
  const durationMin = Math.max(1, Math.round((distanceKm / SPEED_KMH[mode]) * 60 + OVERHEAD_MIN[mode]));
  const path = mode === 'plane' || mode === 'boat' ? geodesicPath(from, to, 96) : [[from.lng, from.lat], [to.lng, to.lat]] as [number, number][];
  return { mode, fromId: from.id, toId: to.id, path, distanceKm: Math.round(distanceKm * 10) / 10, durationMin, label: label ?? MODE_LABEL[mode], refined: false };
}

/** Access/egress leg inside a city: walk if close, otherwise car (or subway in subway cities). */
function localLeg(from: Place, to: Place): Leg | null {
  if (from.id === to.id) return null;
  const d = haversineKm(from, to);
  if (d < WALK_MAX_KM) return makeLeg('walk', from, to);
  const hubs = CITY_HUBS[from.city] ?? CITY_HUBS[to.city];
  if (hubs?.hasSubway && d > 2.2 && d < 40) return makeLeg('subway', from, to, '지하철로');
  return makeLeg('car', from, to);
}

export function estimateJourney(from: Place, to: Place): Journey {
  if (from.id === to.id) return { legs: [], totalMin: 0 };
  const legs: Leg[] = [];
  const push = (l: Leg | null) => { if (l) legs.push(l); };

  if (from.city === to.city) {
    push(localLeg(from, to));
  } else {
    const fh = CITY_HUBS[from.city] ?? {}, th = CITY_HUBS[to.city] ?? {};
    const d = haversineKm(from, to);
    const wantBoat = (to.reachBy === 'boat' || from.reachBy === 'boat') && th.port;
    const wantTrain = from.country === to.country && d < TRAIN_MAX_KM && fh.station && th.station && to.reachBy !== 'plane';
    if (wantBoat) {
      // Leave from this city's port, or travel (train/car) to the nearest city that has one first.
      const portId = fh.port ?? nearestPortId(from);
      const a = placeById(portId), b = placeById(th.port!);
      if (fh.port) push(localLeg(from, a)); else estimateJourney(from, a).legs.forEach(l => legs.push(l));
      push(makeLeg('boat', a, b, `${a.area} → ${b.area} 여객선`)); push(localLeg(b, to));
    } else if (wantTrain) {
      const a = placeById(fh.station!), b = placeById(th.station!);
      push(localLeg(from, a)); push(makeLeg('train', a, b, `KTX ${a.name.replace('역', '')} → ${b.name.replace('역', '')}`)); push(localLeg(b, to));
    } else {
      const intl = from.country !== to.country;
      const aId = (intl && fh.intlAirport) || fh.airport || fh.intlAirport;
      const bId = (intl && th.intlAirport) || th.airport || th.intlAirport;
      if (aId && bId) {
        const a = placeById(aId), b = placeById(bId);
        push(localLeg(from, a)); push(makeLeg('plane', a, b, `${airportShort(a)} → ${airportShort(b)} 항공편`)); push(localLeg(b, to));
      } else {
        push(makeLeg('car', from, to));
      }
    }
  }
  return { legs, totalMin: legs.reduce((s, l) => s + l.durationMin, 0) };
}

/** "인천국제공항" → "인천", "JFK 국제공항" → "JFK". */
const airportShort = (p: Place) => p.name.replace('국제공항', '').replace('공항', '').trim();

function nearestPortId(from: Place): string {
  let best: string | null = null, bestD = Infinity;
  for (const [city, h] of Object.entries(CITY_HUBS)) {
    if (!h.port || city === from.city) continue;
    const p = placeById(h.port);
    if (p.country !== from.country) continue;
    const d = haversineKm(from, p);
    if (d < bestD) { bestD = d; best = h.port; }
  }
  return best ?? from.id;
}

export const journeyKey = (fromId: string, toId: string) => `${fromId}>${toId}`;
export const primaryMode = (j: Journey): TransportMode => {
  const order: TransportMode[] = ['plane', 'boat', 'train', 'subway', 'car', 'walk'];
  for (const m of order) if (j.legs.some(l => l.mode === m)) return m;
  return 'walk';
};
