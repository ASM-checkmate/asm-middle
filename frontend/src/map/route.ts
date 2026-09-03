// ─── Route GL layers: travelled trail + remaining line, stations, origin dot (MOVEMENT_SPEC §4) ──
// One GeoJSON source for the trail and one for the line ahead; each feature is a leg with `mode`, so
// colour/width/dash are data-driven and a whole multi-leg journey needs only five layers.
import type { GeoJSONSource, Map as MLMap, ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type { Feature as GJFeature, FeatureCollection, LineString } from 'geojson';
import type { LngLat, TransportMode } from '../sim/types';
import { isRail, stationFractions, type LegSampler } from './camera';

const INK = '#2A2118';
const PAPER = '#FFF6E6';
const CORAL = '#FF6A48';
const SUN = '#FFC64D';
const WAVE = '#7CC4EA';

const SRC_TRAIL = 'route-trail';
const SRC_AHEAD = 'route-ahead';
const SRC_STATIONS = 'route-stations';
const SRC_ORIGIN = 'route-origin';
export const ROUTE_LAYER_IDS = ['route-trail-case', 'route-trail', 'route-ahead-case', 'route-ahead', 'route-ahead-top', 'route-origin', 'route-stations', 'route-stations-dot', 'route-stations-last', 'route-stations-last-dot'];

type Feature = GJFeature<LineString, { mode: TransportMode; leg: number }>;
type FC = FeatureCollection;
const empty: FC = { type: 'FeatureCollection', features: [] };

const byMode = <T,>(m: Record<TransportMode, T>, fallback: T): ExpressionSpecification =>
  ['match', ['get', 'mode'], 'walk', m.walk, 'car', m.car, 'train', m.train, 'subway', m.subway, 'boat', m.boat, 'plane', m.plane, fallback] as ExpressionSpecification;
const dash = (a: number[]): ExpressionSpecification => ['literal', a];

// Walk + boat share the footprint language: round-cap dots ([0, x] dash) on a light paper casing, so the way ahead
// stays lighter than the 2 px character outline (walk) and never draws a zipper across the water (boat).
const CASE_COLOR = byMode({ walk: '#FFFFFF', car: INK, train: INK, subway: '#FFFFFF', boat: '#FFFFFF', plane: INK }, INK);
const CASE_WIDTH = byMode({ walk: 9, car: 11, train: 11, subway: 10, boat: 9, plane: 8 }, 10);
const CASE_OPACITY = byMode({ walk: 0.85, car: 1, train: 1, subway: 0.9, boat: 0.6, plane: 1 }, 1);
const CORE_COLOR = byMode({ walk: CORAL, car: CORAL, train: SUN, subway: CORAL, boat: WAVE, plane: '#FFFFFF' }, CORAL);
const CORE_WIDTH = byMode({ walk: 6, car: 7, train: 7, subway: 8, boat: 5, plane: 4 }, 6);
const CORE_DASH = byMode({ walk: dash([0, 2.2]), car: dash([1, 0]), train: dash([1, 0]), subway: dash([1, 0]), boat: dash([0, 2]), plane: dash([2, 1.6]) }, dash([1, 0]));
const TOP_WIDTH = byMode({ walk: 0, car: 1.5, train: 3, subway: 0, boat: 0, plane: 0 }, 0);
const TOP_DASH = byMode({ walk: dash([1, 0]), car: dash([1.5, 1.5]), train: dash([0.6, 1.2]), subway: dash([1, 0]), boat: dash([1, 0]), plane: dash([1, 0]) }, dash([1, 0]));
const DONE_COLOR = byMode({ walk: '#FFD9B8', car: '#FFD2C4', train: '#FFEBCB', subway: '#FFB097', boat: '#A9DCF5', plane: PAPER }, PAPER);
const PASSED_OPACITY: ExpressionSpecification = ['case', ['boolean', ['feature-state', 'passed'], false], 0.5, 1];
/** Non-active legs are shown at reduced opacity (feature-state `active`). */
const ACTIVE_OPACITY = (full: ExpressionSpecification | number): ExpressionSpecification =>
  ['*', full, ['case', ['boolean', ['feature-state', 'active'], true], 1, 0.4]] as ExpressionSpecification;

function layers(): LayerSpecification[] {
  return [
    { id: 'route-trail-case', type: 'line', source: SRC_TRAIL, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': CASE_COLOR, 'line-width': CASE_WIDTH, 'line-opacity': ['*', CASE_OPACITY, 0.55] as ExpressionSpecification } },
    { id: 'route-trail', type: 'line', source: SRC_TRAIL, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': DONE_COLOR, 'line-width': CORE_WIDTH } },
    { id: 'route-ahead-case', type: 'line', source: SRC_AHEAD, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': CASE_COLOR, 'line-width': CASE_WIDTH, 'line-opacity': ACTIVE_OPACITY(CASE_OPACITY) } },
    { id: 'route-ahead', type: 'line', source: SRC_AHEAD, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': CORE_COLOR, 'line-width': CORE_WIDTH, 'line-dasharray': CORE_DASH, 'line-opacity': ACTIVE_OPACITY(1) } },
    { id: 'route-ahead-top', type: 'line', source: SRC_AHEAD, layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': PAPER, 'line-width': TOP_WIDTH, 'line-dasharray': TOP_DASH, 'line-opacity': ACTIVE_OPACITY(1) } },
    { id: 'route-origin', type: 'circle', source: SRC_ORIGIN, paint: { 'circle-radius': 5, 'circle-color': PAPER, 'circle-stroke-color': INK, 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' } },
    // Stations (rail): r 6 paper + 2 px ink + a sun inner dot; passed ones fade to .5 via feature-state. Mounted above 'dim'.
    { id: 'route-stations', type: 'circle', source: SRC_STATIONS, filter: ['!', ['get', 'last']], paint: { 'circle-radius': 6, 'circle-color': PAPER, 'circle-stroke-color': INK, 'circle-stroke-width': 2, 'circle-opacity': PASSED_OPACITY, 'circle-stroke-opacity': PASSED_OPACITY } },
    { id: 'route-stations-dot', type: 'circle', source: SRC_STATIONS, filter: ['!', ['get', 'last']], paint: { 'circle-radius': 2.5, 'circle-color': SUN, 'circle-opacity': PASSED_OPACITY } },
    { id: 'route-stations-last', type: 'circle', source: SRC_STATIONS, filter: ['get', 'last'], paint: { 'circle-radius': 8, 'circle-color': PAPER, 'circle-stroke-color': INK, 'circle-stroke-width': 2 } },
    { id: 'route-stations-last-dot', type: 'circle', source: SRC_STATIONS, filter: ['get', 'last'], paint: { 'circle-radius': 3.5, 'circle-color': CORAL } },
  ];
}

/** Sub-path of a sampler between fractions [f0, f1] (inclusive of interpolated ends). */
export function slicePath(s: LegSampler, f0: number, f1: number): [number, number][] {
  if (f1 <= f0) return [];
  const a = s.at(f0), b = s.at(f1);
  const out: [number, number][] = [[a.lng, a.lat]];
  const k0 = f0 * s.km, k1 = f1 * s.km;
  for (let i = 0; i < s.path.length; i++) if (s.cum[i] > k0 && s.cum[i] < k1) out.push(s.path[i]);
  out.push([b.lng, b.lat]);
  return out;
}

export interface Station { legIndex: number; index: number; fraction: number; name: string; lngLat: LngLat; last: boolean }

export class RouteLayers {
  private map: MLMap;
  private samplers: LegSampler[];
  private mounted = false;
  stations: Station[] = [];
  private passedCount = -1;

  constructor(map: MLMap, samplers: LegSampler[], stationNames: (leg: number, index: number, count: number) => string) {
    this.map = map;
    this.samplers = samplers;
    samplers.forEach((s, li) => {
      if (!isRail(s.leg.mode)) return;
      const fr = stationFractions(s.leg.mode, s.km);
      fr.forEach((f, i) => this.stations.push({ legIndex: li, index: i, fraction: f, name: stationNames(li, i, fr.length), lngLat: s.at(f), last: i === fr.length - 1 }));
    });
  }

  mount(beforeId?: string) {
    if (this.mounted) return;
    const m = this.map;
    const add = (id: string, data: FC) => { if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data, lineMetrics: true }); };
    add(SRC_TRAIL, empty); add(SRC_AHEAD, empty); add(SRC_STATIONS, this.stationFC()); add(SRC_ORIGIN, this.originFC());
    for (const l of layers()) if (!m.getLayer(l.id)) m.addLayer(l, beforeId && m.getLayer(beforeId) ? beforeId : undefined);
    this.mounted = true;
  }

  private originFC(): FC {
    const s = this.samplers[0];
    if (!s) return empty;
    const p = s.at(0);
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }] };
  }
  private stationFC(): FC {
    return { type: 'FeatureCollection', features: this.stations.map((st, i) => ({ type: 'Feature', id: i, properties: { name: st.name, last: st.last, leg: st.legIndex }, geometry: { type: 'Point', coordinates: [st.lngLat.lng, st.lngLat.lat] } })) };
  }
  private feature(li: number, coords: [number, number][]): Feature {
    return { type: 'Feature', id: li, properties: { mode: this.samplers[li].leg.mode, leg: li }, geometry: { type: 'LineString', coordinates: coords } };
  }
  private set(id: string, fc: FC) { (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(fc); }

  /** Split every leg into travelled / remaining around (legIndex, p). Call at ≤ 4 Hz. */
  update(legIndex: number, p: number) {
    if (!this.mounted) return;
    const trail: Feature[] = [], ahead: Feature[] = [];
    this.samplers.forEach((s, li) => {
      if (s.path.length < 2) return;
      if (li < legIndex) trail.push(this.feature(li, s.path));
      else if (li > legIndex) ahead.push(this.feature(li, s.path));
      else {
        if (p > 0.001) trail.push(this.feature(li, slicePath(s, 0, p)));
        if (p < 0.999) ahead.push(this.feature(li, slicePath(s, p, 1)));
      }
    });
    this.set(SRC_TRAIL, { type: 'FeatureCollection', features: trail });
    this.set(SRC_AHEAD, { type: 'FeatureCollection', features: ahead });
    this.setActive(legIndex);
    this.markStations(legIndex, p);
  }

  /** Departure unroll: the line ahead draws itself from the origin, f 0→1 over the whole journey. */
  unroll(f: number) {
    if (!this.mounted) return;
    const total = this.samplers.reduce((a, s) => a + s.km, 0) || 1;
    let budget = f * total;
    const ahead: Feature[] = [];
    this.samplers.forEach((s, li) => {
      if (budget <= 0 || s.path.length < 2) return;
      const take = Math.min(1, budget / (s.km || 1e-9));
      ahead.push(this.feature(li, take >= 1 ? s.path : slicePath(s, 0, take)));
      budget -= s.km;
    });
    this.set(SRC_TRAIL, empty);
    this.set(SRC_AHEAD, { type: 'FeatureCollection', features: ahead });
    this.setActive(0);
  }

  /** Arrival: everything becomes trail. */
  finish() {
    if (!this.mounted) return;
    this.set(SRC_TRAIL, { type: 'FeatureCollection', features: this.samplers.filter(s => s.path.length > 1).map((s, li) => this.feature(li, s.path)) });
    this.set(SRC_AHEAD, empty);
    this.markStations(this.samplers.length, 1);
  }

  private activeLeg = -1;
  private setActive(li: number) {
    if (li === this.activeLeg) return;
    this.activeLeg = li;
    this.samplers.forEach((_, i) => this.map.setFeatureState({ source: SRC_AHEAD, id: i }, { active: i === li }));
  }
  private markStations(legIndex: number, p: number) {
    const passed = this.stations.filter(st => st.legIndex < legIndex || (st.legIndex === legIndex && st.fraction <= p + 1e-6)).length;
    if (passed === this.passedCount) return;
    this.passedCount = passed;
    this.stations.forEach((st, i) => this.map.setFeatureState({ source: SRC_STATIONS, id: i }, { passed: st.legIndex < legIndex || (st.legIndex === legIndex && st.fraction <= p + 1e-6) }));
  }
  /** Stations of one leg (for the card ticks / counter). */
  stationsOf(li: number) { return this.stations.filter(s => s.legIndex === li); }

  destroy() {
    const m = this.map;
    if (!m.getStyle()) return;
    for (const id of ROUTE_LAYER_IDS) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of [SRC_TRAIL, SRC_AHEAD, SRC_STATIONS, SRC_ORIGIN]) if (m.getSource(id)) m.removeSource(id);
    this.mounted = false;
  }
}
