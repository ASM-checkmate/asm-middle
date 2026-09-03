// ─── Marker DOM (MOVEMENT_SPEC §3): the actor root `.mv` (MapLibre owns its transform), the glowing
// ground ring, the Rider host (React portal), the reusable station pill; plus the destination pin.
import { Marker } from 'maplibre-gl';
import type { TransportMode } from '../sim/types';
import { riderBox } from '../character';

export interface ActorDom { root: HTMLDivElement; ring: HTMLDivElement; rider: HTMLDivElement; pill: HTMLDivElement; bubble: SVGSVGElement }

/** What the marker says on board (TIMEZONE_SPEC): 🍱 in a meal block; 💤 in the sleep block for costumes without a sleeping face. */
export type BubbleKind = 'meal' | 'sleep' | null;
const BUBBLE_EMOJI: Record<NonNullable<BubbleKind>, string> = { meal: '🍱', sleep: '💤' };

export function createActorDom(): ActorDom {
  const root = document.createElement('div');
  root.className = 'mv mv--walk';
  root.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('div');
  ring.className = 'mv-ring';
  ring.innerHTML = '<i class="mv-ring-glow"></i>';   // one soft paper glow that breathes — never a reticle
  const rider = document.createElement('div');
  rider.className = 'mv-rider';
  const pill = document.createElement('div');
  pill.className = 'mv-pill';
  // Speech bubble (3 nodes): one paper path with its tail at the bottom-left (2 px ink), one emoji text. Pops when on.
  const bubble = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  bubble.setAttribute('class', 'mv-bubble');
  bubble.setAttribute('viewBox', '0 0 48 46');
  bubble.setAttribute('width', '48'); bubble.setAttribute('height', '46');
  bubble.setAttribute('aria-hidden', 'true');
  bubble.innerHTML = '<path d="M11 3h26a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H21l-9 8 1-8a8 8 0 0 1-10-8V11a8 8 0 0 1 8-8z" fill="var(--card)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>'
    + '<text x="24" y="21" text-anchor="middle" dominant-baseline="central" font-size="19"></text>';
  root.append(ring, rider, pill, bubble);
  return { root, ring, rider, pill, bubble };
}

/** Show / hide the bubble; a change of emoji re-pops it. */
export function setActorBubble(dom: ActorDom, kind: BubbleKind) {
  const el = dom.bubble;
  const cur = (el.dataset.kind || null) as BubbleKind;
  if (cur === kind) return;
  if (!kind) { delete el.dataset.kind; el.classList.remove('is-on'); return; }
  el.dataset.kind = kind;
  el.querySelector('text')!.textContent = BUBBLE_EMOJI[kind];
  el.classList.remove('is-on'); void el.getBoundingClientRect(); el.classList.add('is-on');
}

/** Marker offset per mode (px, +y = down): the ground contact (feet / wheels / waterline) sits on the route line.
 *  Vehicles draw their wheels a few viewBox units higher than the walk feet, so they get a little more drop. */
export const ACTOR_OFFSET: Record<TransportMode, [number, number]> = { walk: [0, 6], car: [0, 10], subway: [0, 11], train: [0, 11], boat: [0, 12], plane: [0, 6] };

/** Exactly the options from MOVEMENT_SPEC §3.1 (offset is re-applied per mode via ACTOR_OFFSET). Never call setRotation; never animate `root`. */
export function createActorMarker(root: HTMLElement): Marker {
  return new Marker({
    element: root,
    anchor: 'bottom',
    offset: ACTOR_OFFSET.walk,
    rotationAlignment: 'viewport',
    pitchAlignment: 'viewport',
    subpixelPositioning: true,
  });
}

export function setActorMode(dom: ActorDom, mode: TransportMode) {
  dom.root.className = dom.root.className.replace(/\bmv--\w+/g, '').trim() + ` mv--${mode}`;
  // Roof height for the station pill / bubble (the anchor box is 0×0, so `bottom:100%` would be the feet)
  const box = riderBox(mode);
  dom.root.style.setProperty('--rider-h', `${box.height}px`);
  dom.root.style.setProperty('--rider-w', `${box.width}px`);
}

/** Destination pin: coral teardrop, ink outline, paper inner dot, Jua label; confetti group reused at arrival. */
export function createPinDom(label: string, emoji: string, plane = false): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'pin' + (plane ? ' pin--plane' : '');
  el.innerHTML = `
    <svg class="pin-confetti" viewBox="-40 -40 80 80" aria-hidden="true">
      <circle r="4" fill="#FF6A48"/><circle r="4" fill="#FFC64D"/><circle r="4" fill="#5FC9A6"/>
      <circle r="4" fill="#FF6A48"/><circle r="4" fill="#FFC64D"/><circle r="4" fill="#5FC9A6"/>
    </svg>
    <div class="pin-body">
      ${plane
        ? `<svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="#FFF6E6" stroke="#2A2118" stroke-width="3"/><path d="M11 22l7-2 5-8h3l-2 8 6 2v2l-6 1-1 5h-2l-2-5-8 1z" fill="#FF6A48" stroke="#2A2118" stroke-width="1.6" stroke-linejoin="round"/></svg>`
        : `<svg viewBox="0 0 40 48" width="34" height="41" aria-hidden="true"><path d="M20 45C12 34 5 27 5 18a15 15 0 0 1 30 0c0 9-7 16-15 27z" fill="#FF6A48" stroke="#2A2118" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="18" r="6" fill="#FFF6E6" stroke="#2A2118" stroke-width="2"/></svg>`}
    </div>
    <div class="pin-label"><span class="pin-emoji">${emoji}</span>${escapeHtml(label)}</div>`;
  return el;
}

export function createPinMarker(el: HTMLElement): Marker {
  return new Marker({ element: el, anchor: 'bottom', offset: [0, 2], rotationAlignment: 'viewport', pitchAlignment: 'viewport', subpixelPositioning: true });
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }
