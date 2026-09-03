// ─── theworld map style ─────────────────────────────────────────────────────
// A hand-authored MapLibre style over the OpenFreeMap "liberty" sources (OpenMapTiles schema).
// Look: Pokémon-GO-style pastel real streets in the deck palette — mint-teal ground, white roads with a
// faint tan casing, leaf parks, sky water, apricot buildings (only the tall ones extrude at z≥15.5), sparse Korean labels.
// Nothing is fetched at runtime except tiles, glyphs and the low-zoom natural-earth raster.
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

// Token hex literals (see src/theme/tokens.css). Map styles cannot read CSS variables.
const PAPER = '#FFF6E6';
const PAPER2 = '#FFEBCB';
const INK2 = '#6B5B4B';
const INK3 = '#A08C76';
const SKIN = '#FFD9B8';
const SKY = '#A9DCF5';
const SUN2 = '#FFE9B3';
const NIGHT2 = '#3A4270';
// Map-only tints named in the brief
const GROUND = '#B3E1CE';          // --mint-2 blended toward #9FD8C4
const GROUND_LOW = '#BFE6D5';      // slightly lighter under the globe raster
const ROAD = '#FFFBF2';            // warm white roads (deck: cream on pale green), readable against apricot blocks + mint ground
const ROAD_CASE = '#E0CDA8';       // faint tan casing (a touch darker than --line so a road edge shows at street zoom)
const PARK = '#B9E4A3';
const WOOD = '#A9DB98';
const RIVER = '#8FCDEF';
const SHORE = '#93CFF0';
const BUILDING = '#FFE1B3';           // deck apricot footprints AND extrusions (flat, near-opaque, warm — Pokémon-GO pale blocks)
const BUILDING_LINE = 'rgba(42,33,24,0.18)';

export const TILE_SOURCE = 'https://tiles.openfreemap.org/planet';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const NE_RASTER = 'https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png';

/** Korean name when the tile carries one, else the local name. */
export const NAME_KO: ExpressionSpecification = ['coalesce', ['get', 'name:ko'], ['get', 'name']];
const FONT = ['Noto Sans Regular'];
/** Label priority; park/POI features often carry no rank, and a null sort key is a console warning. */
const RANK: ExpressionSpecification = ['coalesce', ['get', 'rank'], 99];

const isLine: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
const isTunnel: ExpressionSpecification = ['==', ['get', 'brunnel'], 'tunnel'];
const cls = (...c: string[]): ExpressionSpecification => ['match', ['get', 'class'], c, true, false];
const rampFactor = (w: number): ExpressionSpecification => ['*', w, ['case', ['==', ['get', 'ramp'], 1], 0.6, 1]];

/** Exponential-by-zoom width; every stop can be scaled for ramps (link roads) so links stay thinner. */
function width(stops: [number, number][], ramps = false): ExpressionSpecification {
  const e: unknown[] = ['interpolate', ['exponential', 1.25], ['zoom']];
  for (const [z, w] of stops) { e.push(z, ramps ? rampFactor(w) : w); }
  return e as ExpressionSpecification;
}
/** Casing is the core width plus a hairline on each side (3 px total from z16 so street-zoom roads get a visible tan edge). */
function casing(stops: [number, number][], extra = 2, ramps = false): ExpressionSpecification {
  return width(stops.map(([z, w]) => [z, w > 0 ? w + (z >= 16 ? Math.max(extra, 3) : extra) : 0]), ramps);
}

interface RoadDef { id: string; classes: string[]; core: [number, number][]; minzoom?: number; ramps?: boolean }
const ROADS: RoadDef[] = [
  // Below z11 only motorway/trunk/primary are drawn (≤ 1.2 px, 70 %); the train view at z9 must stay pastel-calm
  { id: 'service', classes: ['service', 'track'], core: [[15, 0], [16, 1.6], [18, 4], [20, 8]], minzoom: 15 },
  { id: 'minor', classes: ['minor'], core: [[13, 0], [14, 2], [16, 4.5], [17.2, 8], [20, 20]], minzoom: 13, ramps: true },
  { id: 'secondary', classes: ['secondary', 'tertiary'], core: [[11, 0.8], [12, 1.4], [14, 3.4], [17.2, 10], [20, 18]], minzoom: 11, ramps: true },
  { id: 'primary', classes: ['primary', 'trunk'], core: [[6, 0.4], [8, 0.6], [11, 1], [12, 2.2], [14, 4.4], [17.2, 12], [20, 22]], minzoom: 8, ramps: true },
  { id: 'motorway', classes: ['motorway'], core: [[5, 0.5], [7, 0.8], [11, 1.2], [12, 2.8], [14, 5], [17.2, 13], [20, 24]], minzoom: 5, ramps: true },
];
/** Low-zoom roads are faint hairlines (≤ 55 % below z10) so the rail route stays the only saturated line; casings only
 *  appear from z11 so the hairlines never get a tan halo. */
const ROAD_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 10, 0.55, 12, 1];
const CASE_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11.5, 1];

function roadLayers(): LayerSpecification[] {
  const out: LayerSpecification[] = [];
  // Tunnels: ghosted dashes so the map keeps its street logic without clutter
  out.push({
    id: 'road-tunnel', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 13,
    filter: ['all', isLine, isTunnel, cls('minor', 'secondary', 'tertiary', 'primary', 'trunk', 'motorway')],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ROAD, 'line-opacity': 0.45, 'line-dasharray': [2, 1.6], 'line-width': width([[13, 0.8], [17.2, 5], [20, 10]]) },
  });
  // Casings first (all classes), then cores, so bigger roads sit cleanly on top of smaller ones
  for (const r of ROADS) {
    out.push({
      id: `road-${r.id}-case`, type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: r.minzoom,
      filter: ['all', isLine, notTunnel, cls(...r.classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROAD_CASE, 'line-opacity': CASE_OPACITY, 'line-width': casing(r.core, 2.2, r.ramps) },
    });
  }
  for (const r of ROADS) {
    out.push({
      id: `road-${r.id}`, type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: r.minzoom,
      filter: ['all', isLine, notTunnel, cls(...r.classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROAD, 'line-opacity': ROAD_OPACITY, 'line-width': width(r.core, r.ramps) },
    });
  }
  // Footways / paths: thin dashed cream on a whisper of casing
  out.push({
    id: 'road-path-case', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 16.5,
    filter: ['all', isLine, notTunnel, cls('path', 'pedestrian')],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ROAD_CASE, 'line-opacity': 0.55, 'line-width': width([[15, 1.6], [17.2, 3.6], [20, 7]]) },
  });
  out.push({
    id: 'road-path', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 16.5,
    filter: ['all', isLine, notTunnel, cls('path', 'pedestrian')],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ROAD, 'line-dasharray': [1.4, 1.2], 'line-width': width([[16.5, 1.6], [17.2, 2.2], [20, 5]]) },
  });
  // Railways: dashed night-2 hairlines (surface rail + surface transit only)
  out.push({
    id: 'rail', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 12,
    filter: ['all', isLine, notTunnel, cls('rail', 'transit')],
    paint: { 'line-color': NIGHT2, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.25, 15, 0.45], 'line-dasharray': [3, 2.4], 'line-width': width([[12, 0.6], [15, 1], [20, 2.4]]) },
  });
  return out;
}

function labelLayers(): LayerSpecification[] {
  const text = (color = INK2, halo = 1.6) => ({ 'text-color': color, 'text-halo-color': PAPER, 'text-halo-width': halo, 'text-halo-blur': 0.4 });
  return [
    {
      id: 'label-park', type: 'symbol', source: 'openmaptiles', 'source-layer': 'park', minzoom: 14.5,
      filter: ['has', 'name'],
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': 11, 'text-max-width': 7, 'text-padding': 12, 'symbol-sort-key': RANK },
      paint: text('#5B8F5E', 1.4),
    },
    {
      id: 'label-water', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name', minzoom: 2, maxzoom: 9,
      filter: ['all', ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false], cls('ocean', 'sea')],
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 13], 'text-letter-spacing': 0.15, 'text-max-width': 8 },
      paint: { 'text-color': '#5F8FB0', 'text-opacity': 0.75, 'text-halo-color': SKY, 'text-halo-width': 1 },
    },
    {
      id: 'label-station', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 14.5,
      filter: ['all', ['==', ['get', 'class'], 'railway'], ['match', ['get', 'subclass'], ['station', 'subway', 'halt'], true, false]],
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.5], 'text-max-width': 7, 'text-padding': 8, 'symbol-sort-key': RANK },
      paint: text(),
    },
    {
      id: 'label-airport', type: 'symbol', source: 'openmaptiles', 'source-layer': 'aerodrome_label', minzoom: 9, maxzoom: 15,
      filter: ['has', 'iata'],
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 12], 'text-max-width': 7, 'text-padding': 8 },
      paint: text(),
    },
    {
      id: 'label-neighbourhood', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 12, maxzoom: 17.5,
      filter: cls('suburb', 'neighbourhood', 'quarter'),
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 13], 'text-letter-spacing': 0.05, 'text-max-width': 7, 'text-padding': 16 },
      paint: text(INK3, 1.4),
    },
    {
      // Towns only, from z10.5 (Korean 면·읍 are class `town` rank 11–18 and litter the z9 train view — Pokémon-GO
      // maps show only cities at that scale); rank-sorted with generous padding so a handful show
      id: 'label-town', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 10.5, maxzoom: 14,
      filter: cls('town'),
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 10, 12, 13], 'text-max-width': 7, 'text-padding': 20, 'symbol-sort-key': RANK },
      paint: text(),
    },
    {
      // Globe view (plane cruise): capitals and rank ≤ 3 cities only, so a Seoul–Jeju flight is not ringed by Chinese towns
      id: 'label-city-low', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 3.5, maxzoom: 7,
      filter: ['all', ['==', ['get', 'class'], 'city'], ['any', ['==', ['get', 'capital'], 2], ['<=', RANK, 3]]],
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 13], 'text-max-width': 7, 'text-padding': 24, 'symbol-sort-key': RANK },
      paint: text('#4D4034', 1.8),
    },
    {
      id: 'label-city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 7, maxzoom: 13,
      filter: ['==', ['get', 'class'], 'city'],
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 13, 8, 14, 12, 16], 'text-max-width': 7, 'text-padding': 12, 'symbol-sort-key': RANK },
      paint: text('#4D4034', 1.8),
    },
    {
      // Hidden at the domestic-flight zoom (PLANE_MAX_ZOOM 4.0) where the airport pins already name the country
      id: 'label-country', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 1, maxzoom: 4,
      filter: ['all', ['==', ['get', 'class'], 'country'], ['<=', RANK, 3]],
      layout: { 'text-field': NAME_KO, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 3, 14], 'text-letter-spacing': 0.12, 'text-max-width': 6, 'text-padding': 24 },
      paint: text('#4D4034', 2),
    },
  ];
}

/** Build the full style. Pure; call once per map. */
export function buildStyle(): StyleSpecification {
  const base: LayerSpecification[] = [
    // Full-world land base: mint at every zoom, so tiles still loading never show as a cut-out on the globe
    // Street zoom (z ≥ 15) is a touch lighter/warmer than the regional view so white roads never read as a pool edge
    { id: 'background', type: 'background', paint: { 'background-color': ['interpolate', ['linear'], ['zoom'], 4, GROUND_LOW, 8, GROUND, 14, GROUND, 15, GROUND_LOW] } },
    // Low-zoom relief: a faint desaturated whisper of natural earth (≤ 15 %) that only adds hills; gone by z4.5.
    // Layer maxzoom < source maxzoom so no overzoomed seam ever shows.
    {
      id: 'natural-earth', type: 'raster', source: 'ne2_shaded', maxzoom: 5,
      paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.15, 3, 0.13, 4.5, 0], 'raster-saturation': -0.25, 'raster-contrast': -0.1, 'raster-brightness-min': 0.15, 'raster-fade-duration': 0 },
    },
    { id: 'landcover-wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: cls('wood'), paint: { 'fill-color': WOOD, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 12, 0.6], 'fill-antialias': false } },
    { id: 'landcover-grass', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: cls('grass', 'farmland'), paint: { 'fill-color': PARK, 'fill-opacity': 0.55, 'fill-antialias': false } },
    { id: 'landcover-ice', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: cls('ice'), paint: { 'fill-color': PAPER, 'fill-opacity': 0.8, 'fill-antialias': false } },
    { id: 'landcover-sand', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: cls('sand'), paint: { 'fill-color': SUN2, 'fill-antialias': false } },
    { id: 'landuse-pitch', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', minzoom: 13, filter: cls('pitch', 'playground', 'stadium'), paint: { 'fill-color': PARK, 'fill-opacity': 0.55 } },
    { id: 'landuse-campus', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', minzoom: 12, filter: cls('school', 'university', 'college', 'hospital'), paint: { 'fill-color': PAPER2, 'fill-opacity': 0.5 } },
    { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': PARK, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 13, 0.85] } },
    { id: 'park-outline', type: 'line', source: 'openmaptiles', 'source-layer': 'park', minzoom: 14, paint: { 'line-color': '#93CC7F', 'line-opacity': 0.6, 'line-width': 1 } },
    { id: 'landcover-wetland', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', minzoom: 11, filter: cls('wetland'), paint: { 'fill-color': SKY, 'fill-opacity': 0.35 } },
    { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', minzoom: 9, filter: ['all', notTunnel, cls('river', 'canal', 'stream')], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': RIVER, 'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 9, 0.6, 14, 2, 20, 8] } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', filter: notTunnel, paint: { 'fill-color': SKY, 'fill-outline-color': SHORE } },
    { id: 'water-shore', type: 'line', source: 'openmaptiles', 'source-layer': 'water', minzoom: 12, filter: notTunnel, paint: { 'line-color': '#C6E8F8', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.5], 'line-offset': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1.6] } },
    { id: 'aeroway-fill', type: 'fill', source: 'openmaptiles', 'source-layer': 'aeroway', minzoom: 11, filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], paint: { 'fill-color': PAPER2, 'fill-opacity': 0.55 } },
    { id: 'aeroway-runway', type: 'line', source: 'openmaptiles', 'source-layer': 'aeroway', minzoom: 11, filter: ['all', isLine, cls('runway', 'taxiway')], paint: { 'line-color': PAPER, 'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 11, ['match', ['get', 'class'], 'runway', 3, 1], 20, ['match', ['get', 'class'], 'runway', 18, 6]] } },
    // Flat buildings before extrusion takes over
    // Flat apricot footprints at every street zoom; only mid/large buildings get the extrusion on top (Pokémon GO: a few pale blocks)
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': BUILDING, 'fill-outline-color': ['interpolate', ['linear'], ['zoom'], 13.5, 'rgba(42,33,24,0)', 14, BUILDING_LINE], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 14, 1] } },
    { id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', minzoom: 1, maxzoom: 10, filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK3, 'line-opacity': 0.45, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 8, 1.4] } },
  ];
  const extrusion: LayerSpecification = {
    id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 15.5,
    filter: ['all', ['!=', ['get', 'hide_3d'], true], ['>=', ['coalesce', ['get', 'render_height'], 0], 16]],
    paint: {
      'fill-extrusion-color': BUILDING,
      'fill-extrusion-height': ['*', ['coalesce', ['get', 'render_height'], 16], 0.6],   // ×0.6: blocks never cover the actor's feet
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.96,
      'fill-extrusion-vertical-gradient': true,
    },
  };
  // Subway ride: a paper wash over the whole city (opacity is animated from the scene)
  const dim: LayerSpecification = { id: 'dim', type: 'fill', source: 'world', paint: { 'fill-color': PAPER, 'fill-opacity': 0, 'fill-opacity-transition': { duration: 1200, delay: 0 } } };

  return {
    version: 8,
    name: 'theworld-pastel',
    glyphs: GLYPHS,
    projection: { type: 'globe' },
    // Soft sky/atmosphere rim at cruise (plane legs sit at z ≤ 4, so the halo is always on for them)
    sky: {
      'sky-color': SKY,
      'horizon-color': '#C6E8F8',
      'fog-color': SKIN,
      // Fog only hugs the horizon at the domestic-flight zooms (z ≥ 5.5) so the peninsula stays a readable mint, not a haze
      'fog-ground-blend': ['interpolate', ['linear'], ['zoom'], 3.5, 0.6, 5.5, 0.12],
      'horizon-fog-blend': 0.9,
      'sky-horizon-blend': 0.9,
      // Off from z5.5: short domestic flights (z ≥ 5.5) show a crisp mint peninsula instead of a cream haze; the limb is out of frame there anyway
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4.5, 1, 5.5, 0],
    },
    // Near-flat warm light: extrusion faces stay apricot (no grey shading) — the vertical gradient alone gives the block its base
    light: { anchor: 'map', color: PAPER, intensity: 0.05, position: [1.15, 180, 80] },
    sources: {
      openmaptiles: { type: 'vector', url: TILE_SOURCE },
      ne2_shaded: { type: 'raster', tiles: [NE_RASTER], tileSize: 256, maxzoom: 6 },   // layer maxzoom 5 < 6: never overzoomed
      world: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } } },
    },
    layers: [...base, ...roadLayers(), extrusion, dim, ...labelLayers()],
  };
}
