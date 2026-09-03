// ─── Map contract: <MapScene act onArrive onReady/> — the MOVING state (MOVEMENT_SPEC) ──────────
// React owns the container, the bottom card and the Rider (portalled into the marker); an imperative
// Scene drives MapLibre from one rAF loop: position → marker, lerped camera → jumpTo, card via refs.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './worker';
import { AttributionControl, Map as MLMap, type Marker } from 'maplibre-gl';
import type { Journey, LngLat, Onboard, ScheduledActivity, TransportMode } from '../sim/types';
import { getSimNow, useWorld } from '../sim/store';
import { companionsOf, movingPhase } from '../sim/timeline';
import { localParts } from '../sim/tz';
import { journeyKey, MODE_LABEL, primaryMode } from '../sim/journey';
import { placeById } from '../sim/places';
import { haversineKm } from '../sim/geo';
import { Rider } from '../character';
import { buildStyle } from './style';
import { RouteLayers } from './route';
import { ACTOR_OFFSET, createActorDom, createActorMarker, createPinDom, createPinMarker, setActorBubble, setActorMode, type ActorDom, type BubbleKind } from './marker';
import { MoveCard, type CardHandle } from './card';
import { refineAndStore, sameShape } from './routing';
import {
  PLANE_MAX_ZOOM, PLANE_MIN_ZOOM, PLANE_SHORT_KM, bboxOf, departEase, easeInOutCubic, isRail, lerpK, lerpLngLat, lerpPose, makeSampler, modeCam,
  PLANE_FLOOR_ZOOM, angularDeg, norm360, planeMidPull, planePitchFor, planeZoomAtLat, toEquatorZoom, prefersReducedMotion, type CamPose, type LegSampler, type ModeCam,
} from './camera';
import './map.css';

export interface MapSceneProps {
  /** The activity being travelled to. The scene computes position each frame from getSimNow() (src/sim/store.ts). */
  act: ScheduledActivity;
  /** Fires once when the marker reaches the destination and the arrival camera beat has finished. */
  onArrive?: () => void;
  /** Fires once the map style has loaded and the departure sequence may start. */
  onReady?: () => void;
}

export { prefetchJourney, refineJourney } from './routing';
export { buildStyle } from './style';
/** The journey's headline transport mode (plane > boat > train > subway > car > walk). */
export const primaryModeOf = (act: ScheduledActivity): TransportMode => primaryMode(act.journey);

/** React-owned rider props (≤ 1 Hz). The plane tilt is NOT here: it is written per frame as `--tilt` on the rider host (§5.1/§8). */
interface RiderState { mode: TransportMode; facing: 'right' | 'left'; moving: boolean; boarding: boolean; sleeping: boolean; doors: 'open' | 'closed'; night: boolean }
const RIDER0: Omit<RiderState, 'mode'> = { facing: 'right', moving: true, boarding: false, sleeping: false, doors: 'closed', night: false };
/** Car headlight at 100 % from 18:00 to 06:00 — local to the zone the character left in (a journey keeps the origin's clock). */
const isNight = (t: number, tz: string) => { const h = localParts(t, tz).hour; return h >= 18 || h < 6; };
const RIDER_SIZE: Record<TransportMode, number> = { walk: 96, car: 120, boat: 120, subway: 140, train: 144, plane: 128 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const FIRST_LABEL_LAYER = 'label-park';
/** Airborne plane scale (128 px × 0.8 = 102 px): the porthole face stays readable, the actor never drops below 96 px. */
const PLANE_ALT_SCALE = 0.8;
/** Destination label lifts above the head when the actor projects within this many px of the pin (§ arrival approach);
 *  200 px because an edge-shifted label hangs up to ~110 px inward from its pin, straight over the actor. */
const NEAR_PX = 200;
/** Same lift for a plane leg whose destination pin is on the arc (the plane would otherwise cover the label). */
const PLANE_NEAR_PX = 70;
/** Walk/car final approach: the camera centre slides toward the destination (at most this many px ahead of the actor)
 *  so the pin enters the frame before the actor is on top of it. */
const APPROACH_PX = 120;
const APPROACH_M = 250;
/** Airport pin labels swing left when the pin projects within this many px of the destination pin. */
const SHIFT_PX = 60;
/** Stage width the pin labels must stay inside (the stage is 390 px; 8 px breathing on each side). */
const TOP_CHROME_PX = 150;
const STAGE_W = 390;

interface SceneHooks {
  rider(s: RiderState): void;
  leg(i: number, ticks: number[]): void;
  card(): CardHandle | null;
  vignette(): HTMLDivElement | null;
  ready(): void;
  arrive(): void;
}
interface Ease { t0: number; dur: number; from: CamPose; to: CamPose; fn: (t: number) => number }
interface Anim { t0: number; dur: number; from: number; to: number }

// ─── Scene ──────────────────────────────────────────────────────────────────
class Scene {
  readonly map: MLMap;
  readonly dom: ActorDom;
  private hooks: SceneHooks;
  private marker: Marker;
  private pins: Marker[] = [];
  private destPin: HTMLDivElement | null = null;
  private airportPins: { el: HTMLDivElement; at: LngLat }[] = [];
  private near = false;
  private act!: ScheduledActivity;
  private journey!: Journey;
  private actJ!: ScheduledActivity;
  private samplers: LegSampler[] = [];
  private legCams: ModeCam[] = [];
  private routes: RouteLayers | null = null;
  private ready = false;
  private started = false;
  private state: 'boot' | 'depart' | 'ride' | 'arrive' | 'done' = 'boot';
  private raf = 0;
  private timers = new Set<number>();
  private lastNow = 0;
  private legIndex = -1;
  private camPos: LngLat = { lng: 0, lat: 0 };
  private target: CamPose = { zoom: 16.5, pitch: 0, bearing: 0 };
  private cam: CamPose = { zoom: 16.5, pitch: 0, bearing: 0 };
  private tau = 140;
  private ease: Ease | null = null;
  private followPaused = true;
  private hold = false;
  private holdTimer = 0;
  private lastProj: { x: number; y: number } | null = null;
  private lastPose: CamPose = { zoom: 16.5, pitch: 0, bearing: 0 };
  private rider: RiderState = { mode: 'walk', ...RIDER0 };
  private tilt = 0;
  private tiltApplied = 0;
  private facing: 'right' | 'left' = 'right';
  private approach = false;
  private nextSplitAt = 0;
  private nextDetailAt = 0;
  private driftDone = false;
  private planeApproach = false;
  /** Cruise zoom of the current plane leg, expressed at the equator; converted to the centre latitude every frame. */
  private planeZEq = 0;
  private planeShort = false;
  private alt: Anim | null = null;
  private altScale = 1;
  private passedFraction = -1;
  private degraded = false;
  private frameAcc = 0;
  private frameN = 0;
  private blend: { dlng: number; dlat: number; t0: number } | null = null;
  private reduced = prefersReducedMotion();
  private mq: MediaQueryList | null = null;
  private onMq = (e: MediaQueryListEvent) => { this.reduced = e.matches; };
  private destroyed = false;
  private timeScale = 1;
  private attribObserver: MutationObserver | null = null;
  private onboard: Onboard = null;

  constructor(container: HTMLDivElement, dom: ActorDom, hooks: SceneHooks, center: LngLat) {
    this.dom = dom;
    this.hooks = hooks;
    const nav = navigator as Navigator & { hardwareConcurrency?: number };
    this.degraded = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 2;
    this.map = new MLMap({
      container,
      style: buildStyle(),
      center: [center.lng, center.lat],
      zoom: 16.5, pitch: 0, bearing: 0,
      maxPitch: 60,
      minZoom: PLANE_FLOOR_ZOOM,   // a polar cruise needs ~z-1.3 to keep the whole globe on the stage (camera.ts)
      attributionControl: false,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      dragRotate: false, touchPitch: false, keyboard: false, doubleClickZoom: false, boxZoom: false, pitchWithRotate: false,
      fadeDuration: 160,
      renderWorldCopies: false,
    });
    const attrib = new AttributionControl({ compact: true });
    this.map.addControl(attrib, 'bottom-left'); // above the card, clear of the top chrome (clock/book)
    // Start collapsed and STAY collapsed: MapLibre expands the box when the first source attribution arrives
    // (a 'data' event after construction) — a MutationObserver undoes that until the user taps the ⓘ button.
    const attribEl = container.querySelector<HTMLElement>('.maplibregl-ctrl-attrib');
    if (attribEl) {
      const collapse = () => { if (attribEl.classList.contains('maplibregl-compact-show')) { attribEl.classList.remove('maplibregl-compact-show'); attribEl.removeAttribute('open'); } };
      collapse();
      const mo = new MutationObserver(collapse);
      mo.observe(attribEl, { attributes: true, attributeFilter: ['class'] });
      attribEl.querySelector('.maplibregl-ctrl-attrib-button')?.addEventListener('click', () => mo.disconnect(), { once: true });
      this.attribObserver = mo;
    }
    if (import.meta.env.DEV) (window as unknown as { __map?: MLMap }).__map = this.map;
    this.marker = createActorMarker(dom.root);
    this.map.on('load', () => {
      if (this.destroyed) return;
      this.map.setProjection({ type: 'globe' });
      this.ready = true;
      this.hooks.ready();
      if (this.journey) this.start();
    });
    this.map.on('error', e => { if (import.meta.env.DEV) console.warn('[map]', e.error?.message ?? e); });
    // Look-around: the user may pan/pinch; the follow pauses and eases back 2.5 s after the last gesture.
    this.map.on('dragstart', this.onHold);
    this.map.on('zoomstart', e => { if (e.originalEvent) this.onHold(); });
    this.map.on('dragend', this.onRelease);
    this.map.on('zoomend', e => { if (e.originalEvent) this.onRelease(); });
    document.addEventListener('visibilitychange', this.onVis);
    // §7: the JS flag is re-read on change (the CSS block follows the media query by itself)
    if (typeof matchMedia === 'function') { this.mq = matchMedia('(prefers-reduced-motion: reduce)'); this.mq.addEventListener('change', this.onMq); }
  }

  // ── journey wiring ──
  setJourney(act: ScheduledActivity, journey: Journey) {
    const sameAct = this.act?.key === act.key;
    const sameJourney = sameAct && journey === this.journey;
    this.act = act; this.journey = journey; this.actJ = { ...act, journey };
    if (sameJourney) return;                       // the store re-creates `act` every tick; only the times matter
    this.samplers = journey.legs.map(makeSampler);
    this.legCams = this.samplers.map(s => modeCam(s.leg.mode, s.km, s.at(0), s.at(1)));
    if (!this.ready) return;
    if (!sameAct || !this.started) { this.reset(); this.start(); return; }
    // Refined street geometry arrived mid-ride: rebuild the route, keep p, blend the marker over 400 ms.
    if (this.state === 'ride' || this.state === 'depart') {
      const old = this.marker.getLngLat();
      this.mountRoutes();
      const ph = movingPhase(getSimNow(), this.actJ);
      const s = this.samplers[ph.legIndex];
      if (s && old) {
        const np = s.at(ph.legProgress);
        this.blend = { dlng: old.lng - np.lng, dlat: old.lat - np.lat, t0: performance.now() };
      }
      this.nextSplitAt = 0; this.nextDetailAt = 0;
    }
  }

  private reset() {
    this.clearTimers();
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.state = 'boot'; this.started = false; this.legIndex = -1; this.followPaused = true; this.ease = null; this.blend = null;
    this.driftDone = false; this.planeApproach = false; this.approach = false; this.passedFraction = -1; this.lastProj = null;
    this.dom.root.classList.remove('is-arriving', 'is-hidden');
    this.applyOnboard(null);
    this.routes?.destroy(); this.routes = null;
  }

  private mountRoutes() {
    if (!this.map.getStyle()) return;
    this.routes?.destroy();
    this.routes = new RouteLayers(this.map, this.samplers, (li, i, n) => {
      const leg = this.samplers[li].leg;
      const name = (id: string) => { try { return placeById(id).name; } catch { return null; } };
      if (i === 0) return name(leg.fromId) ?? '출발';
      if (i === n - 1) return name(leg.toId) ?? '도착';
      return `정거장 ${i}`;
    });
    this.routes.mount(FIRST_LABEL_LAYER);
    // Pins
    for (const p of this.pins) p.remove();
    this.pins = []; this.airportPins = []; this.near = false;
    const dest = this.act.place;
    this.destPin = createPinDom(dest.name, dest.emoji);
    this.destPin.classList.add('pin--dest');
    this.pins.push(createPinMarker(this.destPin).setLngLat([dest.lng, dest.lat]).addTo(this.map));
    for (const s of this.samplers) {
      if (s.leg.mode !== 'plane') continue;
      for (const id of [s.leg.fromId, s.leg.toId]) {
        if (id === dest.id) continue;
        try {
          const pl = placeById(id);
          const short = pl.name.replace(/국제공항|공항/g, '').trim() || pl.area;
          const el = createPinDom(short, '✈️', true);
          this.pins.push(createPinMarker(el).setLngLat([pl.lng, pl.lat]).addTo(this.map));
          this.airportPins.push({ el, at: { lng: pl.lng, lat: pl.lat } });
        } catch { /* unknown id */ }
      }
    }
    if (this.legIndex >= 0) this.hooks.leg(this.legIndex, this.ticksOf(this.legIndex));
    this.updatePinOverlap();
  }
  private ticksOf(li: number) { return this.routes?.stationsOf(li).map(s => s.fraction) ?? []; }

  /** Airport pins that would stack on the destination pin at the current zoom (< 40 px apart) fade out; they come back
   *  once the approach zooms in. Called at leg changes, the plane approach and the 4 Hz split update. */
  private updatePinOverlap() {
    if (!this.map.getStyle()) return;
    const d = this.act.place;
    const dp = this.map.project([d.lng, d.lat]);
    if (this.destPin) this.updatePinEdge(this.destPin, dp.x, dp.y);
    for (const a of this.airportPins) {
      const ap = this.map.project([a.at.lng, a.at.lat]);
      const dist = Math.hypot(ap.x - dp.x, ap.y - dp.y);
      a.el.classList.toggle('is-hidden', dist < 40);
      const shift = dist >= 40 && dist < SHIFT_PX;
      a.el.classList.toggle('is-shift', shift);
      if (!shift) this.updatePinEdge(a.el, ap.x, ap.y); else { a.el.classList.remove('is-far'); a.el.style.setProperty('--pin-dx', '0px'); }
    }
  }
  /** Labels slide inward so their box stays inside the 390 px stage (8 px breathing) even when the pin itself is past the
   *  edge; 40 px beyond the stage the label hides and only the pin remains. No feedback: uses the projected pin x and the
   *  label's own width, never the shifted rect. */
  private updatePinEdge(pin: HTMLDivElement, x: number, y = Infinity) {
    const label = pin.querySelector<HTMLElement>('.pin-label');
    if (!label) return;
    // Near the top the label would sit under the clock: flip it below the pin instead.
    pin.classList.toggle('is-top', y < TOP_CHROME_PX);
    const far = x > STAGE_W + 40 || x < -40;
    pin.classList.toggle('is-far', far);
    if (far) return;
    const w = label.offsetWidth;
    const left = clamp(x - w / 2, 8, Math.max(8, STAGE_W - 8 - w));
    pin.style.setProperty('--pin-dx', `${Math.round(left - (x - w / 2))}px`);
  }
  /** Lift the destination label above the actor's head during the final approach (not only at p = 1), and on a plane leg
   *  whenever the plane would cover it. */
  private updateNear(pos: LngLat) {
    if (!this.destPin) return;
    const last = this.legIndex === this.samplers.length - 1;
    const plane = this.samplers[this.legIndex]?.leg.mode === 'plane';
    if (!last && !plane) return;
    const d = this.act.place;
    const a = this.map.project([pos.lng, pos.lat]), b = this.map.project([d.lng, d.lat]);
    const near = Math.hypot(a.x - b.x, a.y - b.y) < (last ? NEAR_PX : PLANE_NEAR_PX);
    if (near !== this.near) { this.near = near; this.destPin.classList.toggle('is-near', near); }
  }
  /** Final approach centre (walk/car, last leg): between the actor and the destination, at most APPROACH_PX ahead. */
  private approachCenter(pos: LngLat, s: LegSampler): LngLat {
    const d = s.at(1);
    const a = this.map.project([pos.lng, pos.lat]), b = this.map.project([d.lng, d.lat]);
    const px = Math.hypot(a.x - b.x, a.y - b.y);
    return px < 1 ? pos : lerpLngLat(pos, d, Math.min(0.5, APPROACH_PX / px));
  }

  // ── departure ──
  private start() {
    if (this.started || !this.ready) return;
    this.started = true;
    this.mountRoutes();
    if (!this.samplers.length) { this.after(1200, () => { this.state = 'done'; this.hooks.arrive(); }); return; }
    const ph0 = movingPhase(getSimNow(), this.actJ);
    const p0 = this.samplers[ph0.legIndex].at(ph0.legProgress);
    this.marker.setLngLat([p0.lng, p0.lat]).addTo(this.map);   // a Marker must have a LngLat before the first map move
    this.setPadding();
    this.lastNow = performance.now();
    this.state = 'depart';
    this.depart();
    this.raf = requestAnimationFrame(this.tick);
  }

  private setPadding() {
    const h = this.map.getContainer().clientHeight || 844;
    this.map.setPadding({ top: 0, left: 0, right: 0, bottom: Math.round(h * 0.16) });   // actor at 42 % of height
  }

  private depart() {
    const t = getSimNow();
    const ph = movingPhase(t, this.actJ);
    const li = ph.legIndex, s = this.samplers[li], p = ph.legProgress;
    const mid = li > 0 || p > 0.02 || t - this.act.departAt > 20_000;
    this.onLegChange(li, performance.now());
    if (mid) this.passedFraction = p;            // joining mid-leg: stations already behind us get no pill
    const pos = s.at(p);
    this.camPos = pos;
    const mode = s.leg.mode;
    const at: [number, number] = [pos.lng, pos.lat];
    const tg = this.target;
    const camCenter = mode === 'plane' ? this.planeCenter(pos, s) : pos;
    const finish = () => {
      const c = this.map.getCenter(); this.camPos = { lng: c.lng, lat: c.lat };
      this.cam = { ...this.target }; this.followPaused = false; this.lastProj = null; this.state = 'ride';
    };
    if (this.reduced) {
      this.map.jumpTo({ center: [camCenter.lng, camCenter.lat], ...tg });
      this.setRider({ mode, boarding: false }); this.setAlt(mode === 'plane' ? PLANE_ALT_SCALE : 1);
      this.routes?.update(li, p); this.hooks.card()?.show();
      this.after(200, finish); return;
    }
    if (mid) {
      this.map.jumpTo({ center: at, zoom: mode === 'plane' ? Math.min(tg.zoom + 1.4, 8) : tg.zoom - 1.2, pitch: 0, bearing: tg.bearing });
      this.setRider({ mode }); this.setAlt(mode === 'plane' ? PLANE_ALT_SCALE : 1);
      this.routes?.update(li, p);
      this.after(100, () => this.map.easeTo({ center: [camCenter.lng, camCenter.lat], zoom: tg.zoom, pitch: tg.pitch, bearing: tg.bearing, duration: 900, easing: departEase, essential: true }));
      this.after(300, () => this.hooks.card()?.show());
      this.after(1000, finish);
      return;
    }
    // Full departure from the origin (§6.1)
    this.map.jumpTo({ center: at, zoom: mode === 'plane' ? 15 : 16.5, pitch: 0, bearing: 0 });
    this.setRider({ mode: 'walk' });
    this.routes?.unroll(0);
    const flyMs = mode === 'plane' ? 2600 : 1200;
    this.after(200, () => mode === 'plane'
      ? this.map.flyTo({ center: [camCenter.lng, camCenter.lat], zoom: tg.zoom, pitch: tg.pitch, bearing: tg.bearing, curve: 1.4, speed: 0.8, duration: 2600, essential: true })
      : this.map.easeTo({ center: at, zoom: tg.zoom, pitch: tg.pitch, bearing: tg.bearing, duration: 1200, easing: departEase, essential: true }));
    for (let k = 1; k <= 5; k++) this.after(600 + k * 120, () => this.routes?.unroll(k / 5));
    this.after(1250, () => { const q = movingPhase(getSimNow(), this.actJ); this.routes?.update(q.legIndex, q.legProgress); });
    if (mode !== 'walk') this.after(mode === 'plane' ? 200 + 0.4 * 2600 : 1000, () => this.board(mode));
    this.after(1200, () => this.hooks.card()?.show());
    this.after(200 + flyMs, finish);
  }

  /** Station pill reused for any short notice above the roof (station names, the leg label at boarding). */
  private showPill(text: string) {
    const pill = this.dom.pill;
    pill.textContent = text;
    pill.classList.remove('is-on'); void pill.offsetWidth; pill.classList.add('is-on');
  }
  /** Costume swap with the 200 ms squash. */
  private board(mode: TransportMode) {
    this.setRider({ mode, boarding: true });
    const leg = this.samplers[this.legIndex]?.leg;
    if (leg && leg.mode === mode && mode !== 'walk' && leg.label !== MODE_LABEL[mode]) this.after(260, () => this.showPill(leg.label));
    this.dom.rider.classList.remove('is-board'); void this.dom.rider.offsetWidth; this.dom.rider.classList.add('is-board');
    this.after(220, () => { this.setRider({ boarding: false }); this.dom.rider.classList.remove('is-board'); });
    if (mode === 'plane') this.alt = { t0: performance.now(), dur: 1400, from: this.altScale, to: PLANE_ALT_SCALE };
  }
  private setAlt(v: number) { this.alt = null; this.altScale = v; this.dom.root.style.setProperty('--alt-scale', v.toFixed(3)); }

  // ── leg boundaries ──
  private onLegChange(i: number, now: number) {
    const prev = this.legIndex;
    this.legIndex = i;
    const s = this.samplers[i];
    let mc = this.legCams[i];
    if (s.leg.mode === 'plane') { const zoom = this.planeZoom(s); mc = { ...mc, zoom, pitch: planePitchFor(zoom) }; }
    this.tau = mc.tau; this.driftDone = false; this.planeApproach = false; this.approach = false; this.passedFraction = -1;
    this.facing = 'right'; this.tilt = 0; this.tiltApplied = 0; this.dom.rider.style.setProperty('--tilt', '0deg');
    this.setRider({ sleeping: false, doors: 'closed' });
    const pose: CamPose = { zoom: mc.zoom, pitch: this.degraded ? Math.min(mc.pitch, 30) : mc.pitch, bearing: mc.bearing };
    this.applyEnvironment(s.leg.mode, { ...mc, pitch: pose.pitch });
    this.hooks.leg(i, this.ticksOf(i));
    if (prev < 0) { this.target = pose; this.cam = { ...pose }; return; }
    // Mid-trip boundary: unboard → walk → (board) with a manual camera ease inside the loop
    this.startEase(pose, this.reduced ? 0 : 1200, easeInOutCubic, now);
    this.lastProj = null;
    const prevMode = this.samplers[prev]?.leg.mode ?? 'walk';
    const nextMode = s.leg.mode;
    if (prevMode !== 'walk') {
      this.board('walk');
      if (nextMode !== 'walk') this.after(620, () => this.board(nextMode));
    } else if (nextMode !== 'walk') {
      this.board(nextMode);
    }
    if (nextMode !== 'plane') this.alt = { t0: now, dur: 800, from: this.altScale, to: 1 };
  }

  private applyEnvironment(mode: TransportMode, mc: ModeCam) {
    const m = this.map;
    this.setExtrusion(mc.extrude);
    if (m.getLayer('dim')) { m.setPaintProperty('dim', 'fill-opacity-transition', { duration: 1200, delay: 0 }); m.setPaintProperty('dim', 'fill-opacity', mc.dim ? 0.55 : 0); }
    this.hooks.vignette()?.classList.toggle('is-on', mc.dim);
    this.dom.root.style.setProperty('--squash', Math.cos((mc.pitch * Math.PI) / 180).toFixed(3));
    setActorMode(this.dom, mode);
    this.marker.setOffset(ACTOR_OFFSET[mode]);   // wheels / waterline on the line (§3.1)
  }

  /** 3D blocks for walk/car (unless degraded). The flat apricot footprint layer always stays on underneath so the
   *  ink-tinted outline still shows at the base of every block. */
  private setExtrusion(on: boolean) {
    const m = this.map;
    const extrude = on && !this.degraded;
    if (m.getLayer('building-3d')) m.setLayoutProperty('building-3d', 'visibility', extrude ? 'visible' : 'none');
  }

  /** Cruise zoom for a plane leg: fitBounds of the whole arc (§2.2), kept as an equatorial zoom on `planeZEq` so the follow
   *  loop can hold the framing constant as the camera climbs to polar latitudes. Returns the zoom for the leg's start. */
  private planeZoom(s: LegSampler): number {
    const bb = bboxOf(s.path);
    const c = this.map.cameraForBounds(bb, { padding: 70, bearing: 0, pitch: 0 });   // north-up globe (§2.2)
    const fitLat = (bb[0][1] + bb[1][1]) / 2;
    const z = clamp(c?.zoom ?? 3.2, PLANE_MIN_ZOOM, PLANE_MAX_ZOOM);
    this.planeShort = s.km < PLANE_SHORT_KM;
    this.planeZEq = toEquatorZoom(z, fitLat);
    return planeZoomAtLat(this.planeZEq, s.at(0).lat, this.planeShort);
  }
  private planeCenter(pos: LngLat, s: LegSampler): LngLat {
    if (this.planeApproach) return pos;
    const mid = s.at(0.5);
    return lerpLngLat(pos, mid, planeMidPull(angularDeg(s.at(0), s.at(1))));
  }

  /** Angular distance from the map centre — past ~85° a point is over the globe's horizon. */
  private limbDeg(pos: LngLat): number {
    const c = this.map.getCenter();
    return (haversineKm(pos, { lng: c.lng, lat: c.lat }) / 6371) * (180 / Math.PI);
  }

  /** Hard guarantee for the cruise camera: the actor's projected point stays inside the middle 60 % of the stage (and in
   *  front of the limb). The arc-scaled mid-pull already keeps the offset small; this catches whatever it doesn't — polar
   *  arcs, the fitBounds floor, an unprojectable point behind the globe. Each pass halves the centre's offset toward the
   *  plane, so four passes bring it within 6 % — it converges instead of fighting the follow lerp, and the next frame's
   *  lerp eases back out from the corrected centre. */
  private clampActorOnStage(pos: LngLat) {
    const canvas = this.map.getCanvas();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const x0 = w * 0.2, x1 = w * 0.8, y0 = h * 0.15, y1 = h * 0.66;
    for (let i = 0; i < 4; i++) {
      const q = this.map.project([pos.lng, pos.lat]);
      const outside = !Number.isFinite(q.x) || !Number.isFinite(q.y) || q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1;
      if (!outside && this.limbDeg(pos) <= 80) return;
      this.camPos = lerpLngLat(this.camPos, pos, 0.5);
      this.map.jumpTo({ center: [this.camPos.lng, this.camPos.lat], zoom: this.cam.zoom, pitch: this.cam.pitch, bearing: this.cam.bearing });
    }
  }

  private startEase(to: CamPose, dur: number, fn: (t: number) => number, now = performance.now()) {
    this.target = to;
    if (dur <= 0 || this.reduced) { this.ease = null; this.cam = { ...to }; return; }
    this.ease = { t0: now, dur, from: { ...this.cam }, to, fn };
  }

  // ── the loop ──
  private tick = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = clamp(now - this.lastNow, 0, 100);
    this.lastNow = now;
    if (this.state !== 'ride' && this.state !== 'depart') return;
    const t = getSimNow();
    const ph = movingPhase(t, this.actJ);
    if (ph.legIndex !== this.legIndex) this.onLegChange(ph.legIndex, now);
    const s = this.samplers[this.legIndex];
    if (!s) return;
    const p = ph.legProgress;
    let pos = s.at(p);
    if (this.blend) {
      const u = clamp((now - this.blend.t0) / 400, 0, 1), w = 1 - easeInOutCubic(u);
      pos = { lng: pos.lng + this.blend.dlng * w, lat: pos.lat + this.blend.dlat * w };
      if (u >= 1) this.blend = null;
    }
    this.updateHeading(s, p, pos, dt);
    this.marker.setLngLat([pos.lng, pos.lat]);
    this.updateOcclusion(pos);
    if (this.alt) {
      const u = clamp((now - this.alt.t0) / this.alt.dur, 0, 1);
      this.altScale = this.alt.from + (this.alt.to - this.alt.from) * easeInOutCubic(u);
      this.dom.root.style.setProperty('--alt-scale', this.altScale.toFixed(3));
      if (u >= 1) this.alt = null;
    }
    if (t >= this.actJ.arriveAt || ph.totalProgress >= 1) { this.arrive(); return; }
    const card = this.hooks.card();
    if (now >= this.nextSplitAt) {
      this.nextSplitAt = now + 250;
      this.routes?.update(this.legIndex, p);
      card?.setProgress(ph.totalProgress);
      this.checkStations(p);
      this.updateNear(pos);
      this.updatePinOverlap();
    }
    // On board (TIMEZONE_SPEC): the origin zone's sleep block → sleeping face, meal blocks → 🍱 bubble; only once boarded
    this.applyOnboard(this.rider.mode !== 'walk' && this.rider.mode === s.leg.mode ? ph.onboard : null);
    const remainMs = this.actJ.arriveAt - t;
    card?.setRemaining(ph.remainingMin, remainMs < 60_000, false);
    if (now >= this.nextDetailAt) {
      this.nextDetailAt = now + 1000;
      this.timeScale = useWorld.getState().clock.scale || 1;
      this.dom.root.style.setProperty('--time-scale', Math.min(this.timeScale, 3).toFixed(2));
      card?.setDetail(...this.detailText(s, p));
      this.setRider({ night: isNight(t, this.act.originTz) });
    }
    if (this.state === 'ride') this.maybeDrift(s, p, remainMs, now);
    if (!this.approach && this.state === 'ride' && this.legIndex === this.samplers.length - 1 && (s.leg.mode === 'walk' || s.leg.mode === 'car')
      && (p > 0.85 || s.km * (1 - p) * 1000 < APPROACH_M)) this.approach = true;
    if (this.followPaused || this.hold) return;
    this.stepCamera(now, dt, pos, s);
    this.sampleFrame(dt);
  };

  private stepCamera(now: number, dt: number, pos: LngLat, s: LegSampler) {
    let easing = false;
    if (this.ease) {
      const u = clamp((now - this.ease.t0) / this.ease.dur, 0, 1);
      this.cam = lerpPose(this.ease.from, this.ease.to, this.ease.fn(u));
      easing = true;
      if (u >= 1) { this.ease = null; this.cam = { ...this.target }; }
    } else {
      this.cam = this.target;
    }
    const tgt = s.leg.mode === 'plane' ? this.planeCenter(pos, s) : this.approach ? this.approachCenter(pos, s) : pos;
    this.camPos = lerpLngLat(this.camPos, tgt, lerpK(dt, this.tau));
    if (s.leg.mode === 'plane' && !this.planeApproach && !easing) {
      // Hold the *framing* constant, not the zoom number: 2^zoom / cos(lat) is the globe's apparent scale (camera.ts).
      const z = planeZoomAtLat(this.planeZEq, this.camPos.lat, this.planeShort);
      this.cam = { ...this.cam, zoom: z, pitch: planePitchFor(z) };
    }
    // Frame skip (§2.1) — but only when the *pose* is unchanged too: on a plane leg the zoom tracks the centre latitude,
    // and at cruise the marker moves well under 0.25 px per frame, so a position-only test would freeze the zoom forever.
    if (!easing && this.lastProj && Math.abs(this.cam.zoom - this.lastPose.zoom) < 0.002
      && Math.abs(this.cam.pitch - this.lastPose.pitch) < 0.05 && Math.abs(this.cam.bearing - this.lastPose.bearing) < 0.05) {
      const pr = this.map.project([pos.lng, pos.lat]);
      if (Math.hypot(pr.x - this.lastProj.x, pr.y - this.lastProj.y) < 0.25) return;
    }
    this.map.jumpTo({ center: [this.camPos.lng, this.camPos.lat], zoom: this.cam.zoom, pitch: this.cam.pitch, bearing: this.cam.bearing });
    if (s.leg.mode === 'plane' && !this.planeApproach) this.clampActorOnStage(pos);
    const after = this.map.project([pos.lng, pos.lat]);
    this.lastProj = { x: after.x, y: after.y };
    this.lastPose = { ...this.cam };
  }

  /** Facing (12° hysteresis) and plane tilt from projected screen deltas 2 s ahead. */
  private updateHeading(s: LegSampler, p: number, pos: LngLat, dt: number) {
    if (p > 0.94) return;                                             // freeze in the last 6 %
    const legMs = Math.max(1, s.leg.durationMin) * 60_000;
    const p1 = Math.min(1, p + Math.max(0.002, (2000 * this.timeScale) / legMs));
    if (s.metresBetween(p, p1) < 8) return;
    const a = this.map.project([pos.lng, pos.lat]);
    const q = s.at(p1);
    const b = this.map.project([q.lng, q.lat]);
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 0.5) return;
    const sh = norm360((Math.atan2(dx, -dy) * 180) / Math.PI);       // 0 = up, 90 = right
    if (this.facing === 'right' && sh > 192 && sh < 348) this.facing = 'left';
    else if (this.facing === 'left' && sh > 12 && sh < 168) this.facing = 'right';
    let tilt = this.tilt;
    if (s.leg.mode === 'plane') {
      let want = -35 * Math.cos((sh * Math.PI) / 180);
      if (p < 0.08) want -= 8; else if (p > 0.92) want += 8;
      want = clamp(want, -35, 35);
      const step = this.reduced ? 90 : (20 * dt) / 1000;
      tilt = this.tilt + clamp(want - this.tilt, -step, step);
    } else tilt = 0;
    this.tilt = tilt;
    // Tilt goes straight to the rider host as `--tilt` (the Rider's .mv-tilt reads it) — no React state per frame
    if (Math.abs(tilt - this.tiltApplied) >= 0.5) { this.tiltApplied = tilt; this.dom.rider.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`); }
    if (this.facing !== this.rider.facing) this.setRider({ facing: this.facing });
  }

  private updateOcclusion(pos: LngLat) {
    const hidden = this.cam.zoom < 6 && this.limbDeg(pos) > 85;
    this.dom.root.classList.toggle('is-hidden', hidden);
  }

  private checkStations(p: number) {
    if (!this.routes || !isRail(this.samplers[this.legIndex].leg.mode)) return;
    const st = this.routes.stationsOf(this.legIndex);
    let newest: { fraction: number; name: string } | null = null;
    for (const x of st) if (x.fraction > 0 && x.fraction <= p && x.fraction > this.passedFraction) newest = x;
    if (!newest) return;
    this.passedFraction = newest.fraction;
    this.showPill(newest.name);
    if (this.samplers[this.legIndex].leg.mode === 'subway') {
      // Doors open for 900 ms at each station (information: survives reduced motion)
      this.setRider({ doors: 'open' });
      this.after(900, () => this.setRider({ doors: 'closed' }));
    }
    const v = this.hooks.vignette();
    if (v?.classList.contains('is-on')) { v.classList.add('is-lit'); this.after(600, () => v.classList.remove('is-lit')); }
  }

  private detailText(s: LegSampler, p: number): [string, boolean] {
    const leg = s.leg;
    const approx = !leg.refined && (leg.mode === 'walk' || leg.mode === 'car');   // rail never refines (§4.5/§4.6)
    if (isRail(leg.mode) && this.routes) {
      const st = this.routes.stationsOf(this.legIndex);
      const k = st.filter(x => x.fraction <= p + 1e-6).length;
      return [`${Math.min(k, st.length)} / ${st.length} 정거장`, approx];
    }
    let km = s.km * (1 - p);
    for (let i = this.legIndex + 1; i < this.samplers.length; i++) km += this.samplers[i].km;
    return [km < 1 ? `${Math.max(0, Math.round(km * 1000))} m 남음` : km >= 10 ? `${Math.round(km)} km 남음` : `${km.toFixed(1)} km 남음`, approx];
  }

  private maybeDrift(s: LegSampler, p: number, remainMs: number, now: number) {
    if (this.driftDone || this.legIndex !== this.samplers.length - 1 || this.reduced) return;
    const mode = s.leg.mode;
    if (mode === 'plane') {
      if (p < 0.88) return;
      this.driftDone = true; this.followPaused = true;
      const d = s.at(1);
      this.alt = { t0: now, dur: 4000, from: this.altScale, to: 1 };
      const bearing = 0;   // plane legs stay north-up through the approach
      this.map.flyTo({ center: [d.lng, d.lat], zoom: 9.5, pitch: 30, bearing, curve: 1.2, duration: 4000, essential: true });
      this.after(4050, () => {
        if (this.state !== 'ride') return;
        this.planeApproach = true;
        this.target = { zoom: 9.5, pitch: 30, bearing }; this.cam = { ...this.target }; this.ease = null;
        this.updatePinOverlap();
        const c = this.map.getCenter(); this.camPos = { lng: c.lng, lat: c.lat };
        this.dom.root.style.setProperty('--squash', Math.cos(Math.PI / 6).toFixed(3));
        this.dom.root.classList.add('is-arriving');
        this.followPaused = false; this.lastProj = null;
      });
      return;
    }
    if (mode === 'boat') {
      if (p < 0.95) return;
      this.driftDone = true;
      this.startEase({ ...this.target, zoom: this.target.zoom + 0.8 }, 2500, easeInOutCubic, now);
      return;
    }
    if (p < 0.92 && remainMs > 25_000) return;
    this.driftDone = true;
    const pitch = mode === 'walk' || mode === 'car' ? Math.min(60, this.target.pitch + 5) : this.target.pitch;
    this.startEase({ ...this.target, zoom: this.target.zoom + 0.6, pitch }, 3000, easeInOutCubic, now);
  }

  // ── arrival (§6.2) ──
  private arrive() {
    if (this.state === 'arrive' || this.state === 'done') return;
    this.state = 'arrive'; this.followPaused = true;
    cancelAnimationFrame(this.raf); this.raf = 0;
    const s = this.samplers[this.samplers.length - 1];
    const d = s.at(1);
    this.marker.setLngLat([d.lng, d.lat]);
    this.routes?.finish();
    const card = this.hooks.card();
    card?.setProgress(1); card?.setRemaining(0, false, true); card?.setDetail('', false);
    this.applyOnboard(null);
    this.destPin?.classList.add('is-bounce', 'is-arrived');
    // §2.2: the paper dim layer fades out over 600 ms from p 1.0 (departure used 1200 ms)
    if (this.map.getLayer('dim')) { this.map.setPaintProperty('dim', 'fill-opacity-transition', { duration: 600, delay: 0 }); this.map.setPaintProperty('dim', 'fill-opacity', 0); }
    this.hooks.vignette()?.classList.remove('is-on');
    this.dom.root.classList.add('is-arriving');
    this.dom.root.style.setProperty('--squash', Math.cos((this.cam.pitch * Math.PI) / 180).toFixed(3));
    this.setAlt(1);
    // §6.2: subway doors open first (300 ms), then the unboarding squash; other vehicles unboard at once
    const fromSubway = this.rider.mode === 'subway' && !this.reduced;
    if (fromSubway) { this.setRider({ doors: 'open' }); this.after(300, () => this.board('walk')); }
    else if (this.rider.mode !== 'walk') this.board('walk'); else this.setRider({ boarding: false });
    const hopAt = fromSubway ? 540 : 240;
    if (this.reduced) {
      this.setRider({ mode: 'walk', moving: false });
      this.map.jumpTo({ center: [d.lng, d.lat], zoom: this.cam.zoom + 0.6, pitch: 0, bearing: this.cam.bearing });
      this.after(800, () => { this.state = 'done'; this.hooks.arrive(); });
      return;
    }
    this.after(hopAt, () => { this.dom.rider.classList.add('is-hop'); this.after(460, () => { this.dom.rider.classList.remove('is-hop'); this.setRider({ moving: false }); }); });
    this.after(600, () => this.destPin?.classList.add('is-confetti'));
    this.after(700, () => this.map.easeTo({ center: [d.lng, d.lat], zoom: this.cam.zoom + 0.6, pitch: 0, bearing: this.cam.bearing, duration: 700, easing: easeInOutCubic, essential: true }));
    this.after(1800, () => { this.state = 'done'; this.hooks.arrive(); });
  }

  // ── perf: rolling 2 s mean frame time > 20 ms → pitch 30 + extrusion off for the rest of the leg ──
  private sampleFrame(dt: number) {
    if (this.degraded || dt <= 0) return;
    this.frameAcc += dt; this.frameN++;
    if (this.frameAcc < 2000) return;
    const mean = this.frameAcc / this.frameN;
    this.frameAcc = 0; this.frameN = 0;
    if (mean <= 20) return;
    this.degraded = true;
    this.setExtrusion(false);
    this.startEase({ ...this.target, pitch: Math.min(this.target.pitch, 30) }, 600, easeInOutCubic);
  }

  // ── look-around hold ──
  private onHold = () => { this.hold = true; clearTimeout(this.holdTimer); };
  private onRelease = () => {
    clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      this.hold = false;
      if (this.state !== 'ride') return;
      const c = this.map.getCenter(); this.camPos = { lng: c.lng, lat: c.lat };
      this.cam = { zoom: this.map.getZoom(), pitch: this.map.getPitch(), bearing: this.map.getBearing() };
      this.tau = Math.max(this.tau, 600);
      this.startEase({ ...this.target }, 1000, easeInOutCubic);
      this.after(1000, () => { this.tau = this.legCams[this.legIndex]?.tau ?? 140; });
    }, 2500);
  };

  // ── visibility ──
  private onVis = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf); this.raf = 0;
      this.dom.root.classList.add('paused'); this.setRider({ moving: false });
      return;
    }
    this.dom.root.classList.remove('paused');
    if (this.state === 'ride' || this.state === 'depart') this.setRider({ moving: true });
    this.lastNow = performance.now(); this.lastProj = null;
    if (this.state === 'ride') {
      const ph = movingPhase(getSimNow(), this.actJ);
      if (ph.legIndex !== this.legIndex) this.onLegChange(ph.legIndex, this.lastNow);
      const s = this.samplers[this.legIndex];
      if (s) {
        const pos = s.at(ph.legProgress);
        this.camPos = s.leg.mode === 'plane' ? this.planeCenter(pos, s) : pos;
        this.ease = null; this.cam = { ...this.target };
        this.map.jumpTo({ center: [this.camPos.lng, this.camPos.lat], ...this.cam });
      }
    }
    if (!this.raf && (this.state === 'ride' || this.state === 'depart')) this.raf = requestAnimationFrame(this.tick);
  };

  // ── helpers ──
  /** Rider face + marker bubble + card sub-line for the onboard state (cheap: every setter no-ops on an unchanged value).
   *  The plane costume has its own sleeping face and "z", so its 💤 bubble is skipped; train/boat costumes can't sleep yet
   *  (character module), so the bubble carries the state there. */
  private applyOnboard(onboard: Onboard) {
    const mode = this.rider.mode;
    this.setRider({ sleeping: onboard === 'sleep' });
    const kind: BubbleKind = onboard === 'meal' ? 'meal' : onboard === 'sleep' && mode !== 'plane' ? 'sleep' : null;
    setActorBubble(this.dom, kind);
    if (onboard !== this.onboard) { this.onboard = onboard; this.hooks.card()?.setOnboard(onboard); }
  }
  private setRider(patch: Partial<RiderState>) {
    const next = { ...this.rider, ...patch };
    const r = this.rider;
    if (next.mode === r.mode && next.facing === r.facing && next.moving === r.moving && next.boarding === r.boarding && next.sleeping === r.sleeping && next.doors === r.doors && next.night === r.night) return;
    this.rider = next;
    this.hooks.rider(next);
  }
  private after(ms: number, fn: () => void) {
    const id = window.setTimeout(() => { this.timers.delete(id); if (!this.destroyed) fn(); }, ms);
    this.timers.add(id);
  }
  private clearTimers() { for (const id of this.timers) clearTimeout(id); this.timers.clear(); }

  destroy() {
    this.destroyed = true;
    this.clearTimers(); clearTimeout(this.holdTimer);
    this.attribObserver?.disconnect();
    this.mq?.removeEventListener('change', this.onMq);
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVis);
    for (const p of this.pins) p.remove();
    this.marker.remove();
    this.map.remove();
  }
}

// ─── React wrapper ───────────────────────────────────────────────────────────
export function MapScene({ act, onArrive, onReady }: MapSceneProps) {
  const container = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const card = useRef<CardHandle>(null);
  const scene = useRef<Scene | null>(null);
  const cb = useRef({ onArrive, onReady });
  cb.current = { onArrive, onReady };
  const loading = useRef<HTMLDivElement>(null);
  const [dom] = useState(createActorDom);
  // Initial rider / leg from the sim so the loading state already shows the current leg (a mid-trip mount is common)
  const [rider, setRider] = useState<RiderState>(() => { const li = movingPhase(getSimNow(), act).legIndex; return { mode: act.journey.legs[li]?.mode ?? 'walk', ...RIDER0, night: isNight(getSimNow(), act.originTz) }; });
  const [leg, setLeg] = useState<{ index: number; ticks: number[] }>(() => ({ index: movingPhase(getSimNow(), act).legIndex, ticks: [] }));
  const [ready, setReady] = useState(false);

  // Loading state (slow tiles / hidden tab): park the actor at the screen anchor on the mint ground and raise the card
  // with the real remaining time — everything but the tiles depends on sim data only. MapLibre adopts the same node later.
  useLayoutEffect(() => {
    if (!loading.current || dom.root.parentElement) return;
    setActorMode(dom, rider.mode);           // ring / roof height for the parked actor
    loading.current.appendChild(dom.root);   // .map-loading-anchor: 0×0 box at (195, 361)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dom]);
  useEffect(() => {
    const c = card.current; if (!c) return;
    const ph = movingPhase(getSimNow(), act);
    c.show(); c.setProgress(ph.totalProgress); c.setRemaining(ph.remainingMin, false, false);
    // Runs once per mount: the scene keeps the card current from its own loop afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefer the refined journey from the store when it is the same trip (durations identical, only paths differ)
  const stored = useWorld(s => s.journeys[journeyKey(act.fromPlace.id, act.place.id)]);
  // Friends going along: the rider gets a second head in the costume, the card a head + name (FRIENDS_SPEC 동행 표시 규칙).
  const memory = useWorld(s => s.memory);
  const companions = useMemo(() => (act.companions?.length ? companionsOf(act, memory) : []), [act, memory]);
  const journey = stored && stored !== act.journey && sameShape(act.journey, stored) ? stored : act.journey;

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const start = movingPhase(getSimNow(), act).position;
    const sc = new Scene(el, dom, {
      rider: setRider,
      leg: (index, ticks) => setLeg({ index, ticks }),
      card: () => card.current,
      vignette: () => vignette.current,
      ready: () => { setReady(true); cb.current.onReady?.(); },
      arrive: () => cb.current.onArrive?.(),
    }, start);
    scene.current = sc;
    return () => { sc.destroy(); scene.current = null; };
    // The scene is created once per mount; act/journey changes flow through setJourney below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dom]);

  useEffect(() => { scene.current?.setJourney(act, journey); }, [act, journey]);

  // Street geometry: kick off refinement as soon as the scene mounts (screens may also prefetch earlier)
  const fromId = act.fromPlace.id, toId = act.place.id;
  useEffect(() => { void refineAndStore(fromId, toId, journey).catch(() => { /* estimate stays */ }); }, [fromId, toId, journey]);

  return (
    <div className={'map-scene' + (ready ? '' : ' is-loading')} data-to={act.place.id}>
      <div className="map-canvas" ref={container} />
      <div className="map-loading" aria-hidden="true">
        <div className="map-loading-park p1" /><div className="map-loading-park p2" /><div className="map-loading-park p3" />
        <div className="map-loading-route" />
        <div className="map-loading-anchor" ref={loading} />
        <div className="map-loading-note"><span>지도 펼치는 중</span><i /><i /><i /></div>
      </div>
      <div className="map-vignette" ref={vignette} aria-hidden="true" />
      {createPortal(
        <Rider
          mode={rider.mode} size={RIDER_SIZE[rider.mode]} facing={rider.facing} moving={rider.moving} boarding={rider.boarding}
          friend={companions.length > 0} friendColor={companions[0]?.color} sleeping={rider.sleeping} doors={rider.doors} night={rider.night}
        />,
        dom.rider,
      )}
      <MoveCard act={act} journey={journey} legIndex={leg.index} ticks={leg.ticks} companions={companions} ref={card} />
    </div>
  );
}
