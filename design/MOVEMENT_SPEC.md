# MOVEMENT_SPEC.md — theworld MOVING state (final)

Base: "CHARACTER ANIMATION FIRST" (winning proposal). Grafted: camera/engineering discipline from "INFORMATION DESIGN", plane/heading/fallback ideas from "CINEMATIC CAMERA". Everything listed in the judges' warnings has been removed or replaced. Screen is 390x844. All hex values are design tokens unless noted.

---

## 1. Principles

- **One continuous actor.** The big home character *becomes* the marker (FLIP morph) at departure and grows back into the scene character at arrival. Same DOM node lineage, same face, six costumes. The actor is never smaller than 96 px on screen and the head is always the largest single shape.
- **Motion is the mode.** Each mode owns exactly **one signature loop** (bob+feet / wheels+head bob / float+tilt / rock+scrolling waves / vertical rail jitter / horizontal shake+strap swing) and **at most one ambient effect** (puffs / exhaust / contrail / flag / window light strip / tunnel light strip). Nothing else on the map moves unless it carries information (position, progress, doors, flip).
- **The camera is boring on purpose.** Constant bearing, zoom and pitch per leg; a frame-rate-independent lerped centre; `jumpTo` only during the ride. MapLibre `easeTo/flyTo` exist only in the two scripted moments (departure, arrival) while follow is paused. Nothing ever fights the rAF loop.
- **Cute is line weight.** Every costume is drawn at a uniform viewBox scale so the ink outline is ~2 px on screen, exactly like the character and the card's 2 px border + 4 px hard shadow. Side-view sprites flip with a 160 ms squash; they never rotate (plane tilts ±35° max).
- **60 fps is a feature.** Transform/opacity only, ≤ 16 nodes in the marker, GL layers for anything full-screen, 4 Hz gradient updates, wall-clock UI durations, auto-degrade on slow frames, reduced-motion honoured by one CSS block plus one JS flag.

---

## 2. Camera choreography

### 2.1 Global rules

- `map.setProjection({type:'globe'})` at boot; the map is created hidden at app start (style loaded, extrusion layer present but `visibility:'none'`) so departure never waits on tiles.
- **Screen anchor:** the actor sits at **(195, 355)** = 42 % of height. Implemented with `map.setPadding({top:0, bottom:236, left:0, right:0})` once at ride start (card 132 + 22 margin + 82 breathing) and centring on the actor. Padding never changes mid-ride.
- **Follow loop** (single `requestAnimationFrame`):
  ```
  p        = progress(scaledClock)                 // 0..1 along path
  actorPos = pathAt(p)                              // LngLat
  k        = 1 - exp(-dt / tau)                     // tau per mode, ms
  camPos   = lerpLngLat(camPos, actorPos, k)
  marker.setLngLat(actorPos)
  map.jumpTo({center: camPos, zoom, pitch, bearing})   // one call, all four values
  ```
  `zoom/pitch` are constants except during a scripted in-ride ease (arrival drift-in), which is **interpolated manually** in this loop with easeInOutCubic and passed into the same `jumpTo`. Never call `map.easeTo` while the loop runs.
- **Frame skipping:** if `|project(actorPos) - lastProjected| < 0.25 px` and no ease is active, skip the `jumpTo` this frame (at 1x real time a walking actor moves ~1.5 px/s at z17, so most frames are skipped).
- **Bearing rule ("travel-right"):** bearing is computed **once per leg** and never changes during the ride: `bearing = normalize(bearing(origin, destination) - 90°)` so the leg's overall direction runs left→right across the screen. Side-view sprites therefore drive/ride *along* the road the way they are drawn; local wiggles are handled by the flip rule. Walk, car, train, subway, boat use this. Plane uses bearing 0 (north-up globe).
- **Heading pipeline (for flip/tilt only, never for the camera):** OSRM geometry is simplified with a 3 m Douglas-Peucker pass at load; heading = bearing from `pathAt(p)` to `pathAt(p + 2 s ahead)`; ignore heading changes while the look-ahead segment is < 8 m; freeze heading in the last 6 % of the path.
- **Clocks:** path progress reads the scaled dev clock. Every duration in this document is **wall-clock** and is never multiplied by the time-scale. Keyframe durations divide by `min(timeScale, 3)`; particle spawn rates cap at 4/s.
- **Idle:** on `document.hidden` cancel the rAF and add `.paused` to the marker (`animation-play-state:paused`); on resume recompute `p` from elapsed time and jump (no lerp catch-up).
- `maxPitch: 60`, extrusion `minzoom: 15`, `devicePixelRatio` capped at 2.

### 2.2 Per-mode table

| Mode | Zoom | Pitch | Bearing | Follow τ | 3D buildings | Departure sequence (wall-clock) | Arrival sequence |
|---|---|---|---|---|---|---|---|
| **walk** | 17.2 | 45 | travel-right | 140 ms | ON, height ×0.8, minzoom 15 | t0 `jumpTo` origin z16.5/p0/b0 → t200 `easeTo` {z17.2, pitch 45, bearing, 1200 ms, cubic-bezier(.22,.8,.3,1)} | p 0.92 (or < 25 s): manual ease z+0.6, pitch+5 over 3000 ms → p 1.0 beats → `easeTo` {z+0.6 more, pitch 0, 700 ms} |
| **car** | 15.6 | 45 | travel-right | 140 ms | ON, height ×0.8 | same as walk with z15.6 / pitch 45 | same as walk |
| **train** | clamp(14.5 − log2(routeKm/2), 9, 14) | 40 | travel-right | 200 ms | OFF | same, 1200 ms | same, but pitch stays; station hold rule §4.5 |
| **subway** | 14.2 | 30 | travel-right | 140 ms | OFF; paper dim layer ON (§4.6) | same, 1200 ms; dim layer fades in over the same 1200 ms via `fill-opacity` transition | dim layer fades out 600 ms starting at p 1.0 |
| **boat** | clamp(12.5 − log2(routeKm/10), 10, 13) | 35 | travel-right | 400 ms (slow, coast slides) | OFF | same, 1200 ms | p 0.95: manual ease z+0.8 over 2500 ms so the pier is visible |
| **plane** | `fitBounds(arc bbox, padding 70)` computed once (Seoul–Tokyo ≈ 3.2, Seoul–Paris ≈ 1.7) | 0 | 0 | 300 ms | OFF; sky/atmosphere ON | t0 `jumpTo` origin z15/p0 → t200 `flyTo` {arcZoom, pitch 0, curve 1.4, speed 0.8, duration 2600 ms}; costume swaps walk→plane at 40 % of the fly (boarding while leaving the ground) | p 0.88: `flyTo` {z9.5, pitch 30, curve 1.2, 4000 ms} centred on the destination (follow paused for this one) → p 1.0 beats |

Plane cruise centre is **not** the plane: `camTarget = lerpLngLat(planePos, arcMidpoint, 0.35)`, then lerped with τ 300 ms. Both cities and the Earth's limb stay in frame and the slow globe rotation is the visible motion. Atmosphere: `sky` layer with `atmosphere-blend: ["interpolate",["linear"],["zoom"],0,1,5,1,7,0]`, `sky-color #A9DCF5`, `horizon-color #FFF6E6`, `fog-color #FFD9B8`, set **before** the departure fly so nothing snaps at the globe/Mercator blend (~z12).

Marker occlusion on globe: MapLibre v6 hides markers behind the horizon; add a belt-and-braces `project()` check each frame and set marker opacity 0 when behind.

---

## 3. Character marker construction

### 3.1 Marker options

```js
new maplibregl.Marker({
  element: el,
  anchor: 'bottom',
  offset: [0, 6],                // shadow sits on the route line
  rotationAlignment: 'viewport', // always upright, always a billboard
  pitchAlignment: 'viewport',
  subpixelPositioning: true      // REQUIRED: otherwise 1px stepping under lerped follow
})
```
Never call `marker.setRotation`. The plane's tilt is CSS on a child node (§4.3).

### 3.2 DOM (max 16 nodes; created once; only inner SVG markup is swapped)

```html
<div class="mv mv--walk">                 <!-- MapLibre owns this node's transform. NEVER animate it. -->
  <div class="mv-flip">                   <!-- scaleX(1|-1) + squash-flip keyframe -->
    <div class="mv-tilt">                 <!-- plane only: rotate(var(--tilt)); others: identity -->
      <svg class="mv-svg" viewBox="0 0 240 200">
        <ellipse class="mv-shadow"/>      <!-- rgba(42,33,24,.14); squashes inversely to lift -->
        <g class="mv-ground"/>            <!-- wave lines / rail ticks: 0–2 nodes -->
        <g class="mv-veh"/>               <!-- costume body; wheels as <g class="wheel"> -->
        <g class="mv-chara"><use href="#chara-face"/></g>   <!-- full body only in walk -->
        <g class="mv-fx"/>                <!-- the one ambient effect: 2–4 nodes -->
      </svg>
    </div>
  </div>
</div>
```

CSS: `.mv { contain: layout paint; transform-origin: 50% 100%; }` `.mv-flip, .mv-tilt, .mv-veh, .mv-chara, .mv-shadow { will-change: transform; }` All SVG child transforms use `transform-box: fill-box` and an explicit `transform-origin` (iOS Safari needs both; animated `transform-origin` on `<g>` is forbidden).

**Engineering rule (write it in the README):** CSS keyframes cannot reach inside a `<use>` shadow tree. Feet, wheels, waves, flags, light strips, straps, doors are inline `<g>/<path>` in each costume template. Symbols are only used for parts that move as one unit: `#chara-face`, `#chara-body`, `#chara-face-sleep`, `#chara-face-happy`. These symbols do not exist yet (`src/character/` is empty) — building them is task #1.

### 3.3 Sizes (uniform scale → 4-unit stroke = 2 px on screen)

| Costume | viewBox | Box on screen | Head diameter |
|---|---|---|---|
| walk | 200×200 | 96×96 | 60 px |
| car | 240×200 | 120×100 | 44 px |
| boat | 240×200 | 120×100 | 44 px |
| subway | 280×200 | 140×100 | 40 px |
| train | 288×200 | 144×100 | 40 px |
| plane | 256×160 | 128×80 (× `--alt-scale`, 0.55–1) | 40 px |

Vehicle boxes are capped at 144 px wide so the 390 px map keeps route context.

### 3.4 Shadow

`<ellipse class="mv-shadow" rx="26" ry="5">` at the ground contact, fill `#2A2118` opacity .14. In every bouncing mode it animates inversely to the body lift: at the apex `scaleX(.85)` and opacity .10. Boat and plane have no shadow (waves / altitude); the plane's shadow returns at arrival on the ground.

### 3.5 Flip rule

- `facing = 'east'` if heading ∈ [0°,180°), else `'west'`, with **12° hysteresis** (do not flip until heading crosses 180±12 / 0±12). Default costumes face east (screen-right, which is also the travel-right direction).
- On change, `.mv-flip` plays `mv-turn` 160 ms ease-in-out: `0% scaleX(1) → 50% scaleX(.12) → 100% scaleX(-1)` (mirror for the other direction). Never tween-rotate, never snap.
- Applies to walk, car, boat, train, subway. Plane flips too, combined with tilt (§4.3).
- Reduced motion: flip is instant (it is information).

### 3.6 Z-order

HTML markers always paint above the canvas: actor `z-index:10`, destination pin marker `z-index:5`, origin dot `z-index:4`. Station labels are GL symbol layers (below all markers). The 14 %-alpha shadow lets the route line show through.

---

## 4. Per-mode specification

Shared route-source rules: one GeoJSON source per leg, `lineMetrics:true`, **a single LineString with unwrapped longitudes** (no MultiLineString — `line-progress` restarts per part; test Seoul→NYC on globe). Done/ahead split via `line-gradient`, updated with `setPaintProperty` at **4 Hz** (`['interpolate',['linear'],['line-progress'],0,DONE,p,DONE,p+0.002,AHEAD,1,AHEAD]`). OSRM merged to one LineString at load. Origin dot: 10 px paper `#FFF6E6` circle, 2 px ink. Destination pin: 34 px coral `#FF6A48` teardrop, ink outline, paper inner dot, idle bob 2400 ms / 4 px (off in reduced motion).

### 4.1 Walk

**Look.** The character alone at 96 px: apricot `#FFD9B8` blob, 4-unit ink `#2A2118` outline, dark hair cap, dot eyes with paper glints, blush `#FF6A48` at 40 % opacity, tiny smile, a coral `#FF6A48` backpack strap block on the chest. Two ink-outlined apricot oval feet (rx 12, ry 7 viewBox units) as separate `<ellipse class="foot-l|foot-r">`. Two stubby arm strokes. Silhouette: a bouncing pear with feet.

**Animation (signature loop).**
- `.mv-chara` `wk-bob` 560 ms linear infinite: `0%,100% translateY(0) rotate(-2deg) | 25% translateY(-7px) rotate(0) | 50% translateY(0) rotate(2deg) | 75% translateY(-7px) rotate(0)`.
- `.foot-l` `wk-step` 560 ms ease-in-out infinite: `0% translate(-10px,0) | 50% translate(10px,-6px) | 100% translate(-10px,0)`; `.foot-r` same with `animation-delay:-280ms`.
- Arms rotate ±18° about the shoulder at 560 ms, opposite phase to the feet. Backpack block translateY 0→-3 px with delay -60 ms.
- Shadow: `0%,50%,100% scaleX(1) opacity .14 | 25%,75% scaleX(.85) opacity .10`.

**Route.** Casing ink `#2A2118` width 10 opacity .9 round cap; core coral `#FF6A48` width 6, `line-dasharray [0,2.2]`, round cap (footprint dots). Done colour skin `#FFD9B8`.

**Ambient (the one extra).** Two `<circle r=5>` fill `#FFEBCB` behind the rear foot: `wk-puff` 560 ms: `0% scale(.3) opacity .6 | 100% scale(1.4) opacity 0 translate(-14px,-6px)`, second delay -280 ms.

### 4.2 Car

**Look.** Coral `#FF6A48` hatchback, side view, 120×100: one rounded body path (corner radius ~26 units), paper `#FFF6E6` window band with a sky `#A9DCF5` reflection stripe, ink outline, two ink wheels r 20 with paper hubs and one ink spoke line each, sun `#FFC64D` headlight dot (fill 100 % when the in-world clock is 18:00–06:00, else 55 %), small ink door line. The head (`#chara-face` 44 px) pokes up through an open sunroof cut-out, one apricot hand resting on the roof edge. Silhouette: a bean with two wheels and a big head.

**Animation.**
- `.wheel` rotate 360° 500 ms linear infinite, `transform-origin` at hub.
- `.mv-veh` `car-idle` 180 ms ease-in-out infinite alternate `translateY(0) → translateY(-1.5px)`.
- `.mv-chara` `car-head` 360 ms ease-in-out infinite alternate `translateY(0) rotate(-1.5deg) → translateY(-2px) rotate(1.5deg)`, delay -90 ms (suspension feel).
- On each flip the body plays `car-tilt` 300 ms `rotate(0) → rotate(-4deg) → 0`.
- Shadow static, rx 54.

**Route.** Casing ink width 11; core coral `#FF6A48` width 7; centre dash paper width 1.5, `[1.5,1.5]`. Done colour `#FFD2C4`. Geometry from OSRM **driving** profile (the only reliably served profile) so the car hugs real streets around 3D blocks.

**Ambient.** Exhaust: two `<circle r=6>` fill `#FFEBCB` behind the bumper, `car-puff` 700 ms infinite `0% scale(.4) opacity .5 | 100% scale(1.6) opacity 0 translate(-18px,-8px)`, second delay -350 ms.

### 4.3 Plane

**Look.** Round-nosed plane, 128×80, side view: paper `#FFF6E6` fuselage capsule with ink outline, sky `#A9DCF5` belly stripe, coral `#FF6A48` tail fin and wing tip, one sky-blue wing as a slanted rounded rect on the near side, one big porthole (r 22 units) framed in ink with `#chara-face` at 40 px filling it, eyes looking slightly down. Sun `#FFC64D` nose light. No shadow while airborne.

**Animation.**
- `.mv-veh` + `.mv-chara` group: `pl-float` 2400 ms ease-in-out infinite `0%,100% translateY(0) rotate(0) | 50% translateY(-4px) rotate(-1.5deg)`.
- **Tilt** on `.mv-tilt`: `--tilt = clamp(-35°, 35°, -35 · cos(screenHeading))`, where `screenHeading` is computed from **projected screen deltas** (`map.project(pos(t))` vs `map.project(pos(t+2s))`), never geodesic bearing, so the sprite matches the drawn arc. Lerped in JS at 20°/s. Combined with flip, so a west-bound north-heading plane still noses up. Climb (p 0–0.08) adds +8° nose-up, descent (p 0.92–1) adds -8°.
- **Altitude scale** on `.mv-tilt`: `--alt-scale` 1 → 0.55 during the departure fly (synced to zoom-out), back to 1 during the arrival fly. Prevents a 128 px plane covering half a globe at z1.7.
- **Sleep:** from p 0.40 to 0.75 the porthole symbol swaps to `#chara-face-sleep` (closed-eye arcs + a 12-unit DM Mono "z" in sun `#FFC64D` that floats up 6 px and fades, 2200 ms loop). Symbol swap only, no extra nodes.

**Route.** Great-circle arc (turf `greatCircle`, 128 points, longitudes unwrapped into a single LineString). Ahead: casing ink width 8, core paper `#FFFFFF` width 4, `[2,1.6]` round cap. Done: solid paper (contrail). Origin/destination: 30 px paper circle pins, ink outline, tiny coral plane glyph, Jua 12 px city label.

**Ambient.** Contrail inside the marker: two paper lines width 3 opacity .7 behind the tail, `pl-trail` 900 ms infinite `translateX(0) opacity .7 → translateX(-24px) opacity 0`, second delay -450 ms. No drifting clouds.

### 4.4 Boat

**Look.** Mint `#5FC9A6` rowboat, 120×100: smile-shaped hull path with ink outline and a paper `#FFF6E6` gunwale stripe, short ink mast with a coral `#FF6A48` triangular flag, the character (`#chara-face` 44 px on a small apricot body stub) sitting mid-boat holding a tiny ink oar. Under the hull two wave lines (`<path class="wave-1|wave-2">`, stroke `#7CC4EA`, width 4, round cap) drawn as a repeating sine 2× the marker width. Silhouette: a bowl on two squiggles with a flag.

**Animation.**
- `.mv-veh` `bt-rock` 2000 ms ease-in-out infinite `0%,100% rotate(-4deg) translateY(0) | 50% rotate(4deg) translateY(-3px)`, origin hull centre-bottom.
- Head counter-rocks `rotate(2deg) → rotate(-2deg)` on the same 2000 ms so it stays level.
- `.wave-1` `bt-wave` 1200 ms linear infinite `translateX(0) → translateX(-40px)` (exactly one sine period, seamless); `.wave-2` 1600 ms, 6 units lower, opacity .6 (parallax). The waves scroll against the travel direction; they are inside `.mv-flip` so they flip with the boat.
- No shadow.

**Route.** Geodesic arc: casing `#FFFFFF` width 9 opacity .8, core `#7CC4EA` width 5, `[1.2,1.2]` round. Done colour `#A9DCF5`. Water paint `#A9DCF5` with a lighter `#C6E8F8` 2 px shoreline for this mode.

**Ambient.** Flag `bt-flag` 700 ms ease-in-out infinite alternate `scaleX(1) → scaleX(.7)`, origin at the mast. No gull, no droplets, no wake lines (the scrolling waves already carry speed).

### 4.5 Train

**Look.** Two-car train, 144×100, side view, sun `#FFC64D`: front car with a rounded nose path, both cars rounded rects with ink outline, a night `#1E2440` window band per car holding three paper `#FFF6E6` windows, coral `#FF6A48` stripe along the bottom, ink couplers, four ink wheels r 12 with paper hub and one spoke line. `#chara-face` 40 px fills the second car's first window with one apricot hand up. Under the wheels a **subtle** rail stub: two ink lines width 2 at opacity .35 with 6 paper sleeper ticks (with travel-right bearing the GL route runs mostly horizontally, so the stub aligns with it).

**Animation.**
- `.wheel` rotate 360° 400 ms linear infinite.
- `.mv-veh` `tr-jitter` 120 ms linear infinite `translateY(0) → translateY(-1px) → translateY(.5px)` (**vertical** rumble); rear car `<g>` gets `animation-delay:-40ms` so the cars rattle out of sync.
- `.rail-ticks` `tr-rail` 300 ms linear infinite `translateX(0) → translateX(-24px)` (one tick spacing).
- Boarding one-shot `tr-wave` 1400 ms: hand `rotate(0) → rotate(-25deg) → 0` in the first 500 ms, then rest; repeats once per station pass.

**Route.** Rail look: casing ink width 11, core sun `#FFC64D` width 7, top layer paper width 3 `[0.6,1.2]` (sleepers). Done colour `#FFEBCB`. Geometry: **straight/geodesic between sampled stations** (OSRM driving follows highways and looks wrong for rail); OSRM is not requested for train.

**Stations (data reality: `Leg` has path + duration only).** Sample `n = clamp(round(routeKm / 40), 2, 5)` evenly spaced points along the path as station features (circle layer r 5, paper fill, ink stroke 2; passed stations opacity .4 via `feature-state`). Labels are generic (`정거장 {k}`) unless a future `Leg.stops[]` provides names. When the actor crosses a station point: the camera holds (no ease), a 22 px paper pill with 2 px ink border and 3 px hard shadow (Jua 12 px `통과`, or the name) slides up 8 px from the roof, holds 1200 ms, fades 200 ms. One pill element, reused.

**Ambient.** Passing-window light: a paper rect 12 units wide, opacity .55, inside the window-band `clipPath`, sweeps right→left over both cars in 900 ms linear infinite. No passing poles.

### 4.6 Subway

**Look.** Single car, 140×100: sky `#A9DCF5` body rounded rect, ink outline, a mid-height stripe in the line colour (fallback coral `#FF6A48`; use a real line colour only if `Leg.lineColor` exists), four paper `#FFF6E6` windows, two ink door seams, sun `#FFC64D` headlights at the front, ink wheels r 8 barely visible under a night `#1E2440` skirt. `#chara-face` 40 px in the second window, one arm (4-unit ink arc) up holding a **hand-strap** (3-unit ink line from the roof to a 10-unit ink ring). Silhouette: a blue brick with lit windows in a dark field.

**Animation.**
- `.mv-veh` `sb-shake` 90 ms linear infinite alternate `translateX(0) → translateX(1px)` (**horizontal** micro-shake, distinct from the train).
- `.strap` (strap + ring + arm group, origin at the roof) `sb-strap` 700 ms ease-in-out infinite alternate `rotate(-8deg) → rotate(8deg)`; the body's shake is in phase.
- Windows `sb-glow` 2200 ms ease-in-out infinite alternate opacity .85 → 1.
- **Doors (information, survives reduced motion):** at each sampled station the two door seams translateX ±6 px over 300 ms, hold 600 ms, close 300 ms; driven by a class toggle.

**Map dimming (zero DOM cost).** A GL `fill` layer over the whole world, paper `#FFF6E6`, `fill-opacity` 0.55, placed above every base layer and below the route/station layers; the city fades to a ghost and the line becomes the picture. Add one **static** 600×600 px div centred on the screen anchor (195,355) with `background: radial-gradient(circle, transparent 90px, rgba(30,36,64,.30) 280px)`, `pointer-events:none`, painted once and never updated (the actor stays within ~20 px of the anchor under the lerped follow). Fades in with the departure ease, out over 600 ms at arrival. No `mix-blend-mode`, no per-frame CSS variables.

**Route.** Casing `#FFFFFF` width 10 opacity .9, core line colour width 8 solid, round joins; station dots (circle layer r 5, paper, ink stroke 2) at sampled points (`n = clamp(round(routeKm / 1.5), 2, 6)`); destination station r 7 with a coral inner dot. Done colour: 50 % mix of the line colour with paper. Straight segments between stations.

**Ambient.** Tunnel light strip: 4 paper rects (10×6 units, opacity .8) above the roof sweep right→left in 450 ms linear infinite. When passing a station the static vignette div gets `.lit` (opacity .6, 600 ms out and back) — a class toggle, no repaint of the gradient.

---

## 5. Bottom card

### 5.1 Layout (one card, fixed heights, never resizes)

- `position:absolute; left:16px; right:16px; bottom: calc(22px + env(safe-area-inset-bottom))`; height **132 px**; background paper `#FFF6E6`; `border: 2px solid #2A2118`; `border-radius: 24px`; `box-shadow: 4px 4px 0 #2A2118`; padding `14px 18px 12px`.
- Grid: two columns (`1fr auto`), rows 30 / 20 / 28 px + 10 px progress.
- **Row 1 left:** 22 px mode glyph (inline SVG mini of the costume, ink outline, sun `#FFC64D` fill) + destination, Jua 22 px `#2A2118`, one line, ellipsis.
- **Row 1–2 right (hero):** remaining time, DM Mono **40 px**, line-height 1, `font-variant-numeric: tabular-nums`, right-aligned; unit in Jua 14 px `#6B5B4B` baseline-aligned.
- **Row 2 left:** Noto Sans KR 13 px `#6B5B4B`: `{mode phrase} · {arrival phrase}`.
- **Row 3 left:** DM Mono 11 px `#6B5B4B`: distance left (`{km} km 남음`, `{m} m 남음` under 1 km) or for rail modes `{k} / {n} 정거장`. **Row 3 right:** DM Mono 11 px `도착 14:05`.
- **Progress row:** 10 px track `#FFEBCB`, 2 px ink border, radius 99; fill in the mode colour (walk/car coral `#FF6A48`, plane sky `#A9DCF5` with a 1 px ink top edge, boat `#7CC4EA`, train sun `#FFC64D`, subway line colour). Fill is a full-width element animated with **`transform: scaleX(p)`** (`transform-origin:left`, `transition: transform 1000ms linear`) — never `width`. A 16 px paper knob with 2 px ink ring holding the 10 px mode glyph rides the fill end (translateX). Rail modes draw station ticks (2 px ink, 6 px tall) on the track at the sampled station fractions.
- No rotating status line, no thought bubble, no expand state. The card never changes height.
- All card writes from the rAF loop go through refs; zustand/React state updates ≤ 1 Hz.

### 5.2 Korean micro-copy

| Mode | Mode phrase | Arrival phrase | Row 3 left |
|---|---|---|---|
| walk | 걸어서 가는 중 | 도착하면 {activity} | {m} m 남음 |
| car | 차 타고 가는 중 | 도착하면 {activity} | {km} km 남음 |
| plane | 비행기 타고 가는 중 | 내리면 {activity} | {km} km 남음 |
| boat | 배 타고 가는 중 | 내리면 {activity} | {km} km 남음 |
| train | 기차 타고 가는 중 | 내리면 {activity} | {k} / {n} 정거장 |
| subway | 지하철 타고 가는 중 | 내리면 {activity} | {k} / {n} 정거장 |

Activity examples: `도착하면 아이스라떼 한 잔`, `도착하면 그림 그리기`, `내리면 바다 산책`. Fallback route label when riding the geodesic fallback: Row 3 left gets a `대략적인 경로` suffix in `#6B5B4B` until the OSRM geometry arrives. Mode glyph `aria-label`: 걷기 / 자동차 / 비행기 / 배 / 기차 / 지하철.

### 5.3 Remaining-time formatting

- ≥ 60 min: `1시간 12분` — hours in DM Mono 40 px, `시간` Jua 14 px, minutes DM Mono 24 px, `분` Jua 14 px.
- 1–59 min: `12분` (40 px + Jua 14 px).
- < 60 s: number replaced by Jua 28 px coral `곧 도착`.
- p = 1: Jua 28 px coral `도착!` for 1200 ms, Row 2 becomes `이제 {activity}`.
- The number changes **only on whole-minute boundaries**: old value `translateY(-6px)` + opacity 0 over 200 ms, new value in from `+6px`. On departure the number counts up from 0 to the real value over 500 ms (tabular, so width never shifts).
- Top chrome: current time DM Mono 15 px at top 58 px with a Jua 12 px day label; top-right 38 px round book button (paper, 2 px ink, 3 px hard shadow). Dev-only time-scale badge: DM Mono 11 px pill under the clock (`x8`).

---

## 6. Transitions

### 6.1 Timetable → map (departure), 1600 ms total (plane 2800 ms); transform/opacity only

| t (ms) | What |
|---|---|
| 0 | Timetable panel `translateY(0 → 480px)` 320 ms cubic-bezier(.4,0,.2,1) + fade. Map container (already live, below the home layer) opacity 0 → 1 over 400 ms; home backdrop fades out 400 ms. Map is at origin z16.5 / pitch 0 / bearing 0. |
| 0 → 600 | **FLIP morph.** Read the marker's projected screen point at the origin. The big home character (260 px) animates `translate(to that point) scale(260 → 96)` over 600 ms cubic-bezier(.34,1.56,.64,1) (small overshoot, lands with a bounce). At 600 ms crossfade to the real marker over 80 ms and start the walk loop. |
| 200 → 1400 | Camera `easeTo` to the mode framing (§2.2), 1200 ms, `essential:true`. Follow loop is **paused** during this ease. |
| 600 → 1200 | Route **unrolls**: `line-gradient` split animated 0 → 1 over 600 ms at 8 Hz so the ahead line draws itself toward the destination. |
| 1000 | **Boarding** (car/boat/train/subway): the actor has walked in place for 400 ms; costume swaps with a 200 ms squash `scaleY(.7) → scaleY(1.08) → scaleY(1)` on `.mv-flip`. Plane boards at 40 % of its 2600 ms fly. |
| 1200 → 1600 | Card slides up `translateY(140px → 0)` 400 ms cubic-bezier(.22,1,.36,1); hero number counts up 500 ms. |
| 1400 | Follow loop starts; position interpolation begins. |

Mid-trip leg boundary (walk → train → walk, which the sim produces): no full transition. Unboarding squash (200 ms) → walk loop → manual-interpolated camera ease to the new leg's zoom/pitch/bearing over 1200 ms inside the rAF → next leg's route source fades in over 400 ms (`line-opacity`) → boarding squash if the new leg is a vehicle.

### 6.2 Map → scene (arrival), 1800 ms after p = 1

| t (ms) | What |
|---|---|
| −3000 | Drift-in: manual ease zoom +0.6, pitch +5 (car/walk) over 3000 ms easeInOutCubic inside the rAF. |
| 0 | Follow stops. Route gradient snaps to done colour. Destination pin bounces `scale(1 → 1.25 → 1)` 500 ms cubic-bezier(.34,1.56,.64,1). Vehicle modes: **unboarding** squash 200 ms to the walk costume; subway doors open first (300 ms). Then the **two-hop**: `translateY(0 → -10 → 0 → -10 → 0)` over 440 ms with inverse shadow squash. Card hero → `도착!`. Subway dim layer + vignette fade out 600 ms. |
| 600 | Six confetti dots (2 coral, 2 sun, 2 mint, r 4) burst from the pin: translate outward 24–36 px and fade over 600 ms, staggered 40 ms. One reused `<g>` of six circles. |
| 700 | `map.easeTo({zoom: +0.6, pitch: 0, duration: 700, easing: easeInOutCubic})` centred on the pin. |
| 900 → 1600 | **Reverse FLIP + iris.** The marker grows into the scene character: `scale(96 → 240px)` + translate to the scene's character slot over 700 ms cubic-bezier(.34,1.56,.64,1). Simultaneously a paper `#FFF6E6` iris (`clip-path: circle(0 at marker point) → circle(140% at marker point)`, 600 ms easeInCubic) expands over map and card, revealing the place scene whose character occupies the same screen point. Card morphs into the scene card (title / sub-line / bar crossfade 300 ms; the bar becomes the activity timer). |
| 1800 | Map hidden (not destroyed), route source cleared, rAF cancelled. |

---

## 7. Reduced-motion behaviour (`prefers-reduced-motion: reduce`)

One CSS block + one JS flag (`matchMedia` read once, re-read on change):

- **CSS:** `.mv *, .card * { animation: none !important; }` Static poses: walk one foot forward; wheels still (spoke hidden); plane level; boat level with static waves; train/subway still. Pin bob off, knob bob off, confetti off.
- **Kept (information):** position interpolation and lerped follow; instant flip (no squash); door open/close (instant); costume swaps (instant, no squash); station pill (200 ms opacity only); hero minute change (opacity only, 200 ms); progress bar (`transition: none`, updates at 4 Hz); plane tilt (instant lerp).
- **Camera:** every `easeTo/flyTo` becomes `jumpTo` (duration 0, `essential:true` respected); arrival drift-in skipped.
- **Transitions:** departure = panel hides, map cuts to mode camera, marker appears (no FLIP), card appears; 200 ms opacity fades only. Arrival = pin appears, `도착!` shown 800 ms, 200 ms crossfade to the scene, no iris, no hops.
- Test with the iOS setting on: the screen must remain fully informative with only position, progress and time changing.

---

## 8. Performance budget and mitigations

**Budget (iPhone 11-class, dev time-scale ×60 as the stress test):** 60 fps sustained on ground modes; ≥ 50 fps during departure/arrival flies; ≤ 16 marker nodes, ≤ 14 card nodes, 3 top-bar nodes, 1 pill, 1 vignette div; ≤ 3 concurrent marker keyframes per mode plus the ambient; ≤ 8 GL layers added per leg.

| Risk | Mitigation |
|---|---|
| Globe + pitch + fill-extrusion is the heaviest frame | Extrusion only for walk/car, `minzoom 15`, height ×0.8, opacity .92; `maxPitch 60`; walk pitch 45 / car 45 (billboards float above the line beyond ~45). DPR capped at 2. **Auto-degrade:** rolling 2 s mean frame time > 20 ms → pitch 30 and extrusion off for the rest of the leg; `navigator.hardwareConcurrency ≤ 4` → start degraded. |
| Camera fighting itself | Bearing/zoom/pitch constant per leg; all in-ride eases interpolated manually in the rAF and passed with `center` in one `jumpTo`; MapLibre `easeTo/flyTo` only while follow is paused. |
| Marker pixel stepping / drift | `subpixelPositioning:true`; `rotationAlignment:'viewport'`; never touch the Marker root's transform, width or height; all keyframes on children. |
| Per-frame layout | Card bar is `transform: scaleX`; vignette is a static pre-painted div; `contain: layout paint` on `.mv`; `will-change: transform` on animated children only. |
| `line-gradient` re-uploads | Update at 4 Hz (8 Hz only during the 600 ms unroll); one LineString with unwrapped longitudes, `lineMetrics:true`. |
| Frame cost at 1x | Skip `jumpTo` when projected delta < 0.25 px; pause rAF + CSS animations on `document.hidden`; `IntersectionObserver` pauses marker animations when off-screen; plane/boat cruise ticks at 30 fps when zoom < 6. |
| OSRM public demo server | Driving profile only (foot/bike often 404), rate-limited, no SLA. Fetch at timetable-confirm time, cache per `(origin, dest, mode)` for 7 days in IndexedDB, retry once after 800 ms, always start on the geodesic/straight path (labelled `대략적인 경로`), crossfade the refined geometry in over 400 ms re-projecting `p` by length fraction (matches `Leg.refined`). Train/subway never call OSRM. |
| Antimeridian / globe seam | No MultiLineString; unwrap longitudes; test Seoul→NYC and Seoul→Paris on globe before shipping the plane mode. |
| Dev time-scale ×30 | Keyframe durations ÷ `min(timeScale,3)`; spawn cap 4/s; all UI/transition durations wall-clock; only `p` reads the scaled clock. |
| React 19 | rAF writes marker transforms and card text through refs; zustand updates ≤ 1 Hz; no `setState` per frame. |
| Fonts popping mid-departure | Preload Jua / Noto Sans KR / DM Mono with `font-display: swap` and `size-adjust`; gate the first departure on `document.fonts.ready`; fixed row heights and tabular figures so the card never reflows. |
| iOS Safari SVG transforms | `transform-box: fill-box` + explicit `transform-origin` on every animated `<g>`; never animate `transform-origin`; verify each costume template on a real iPhone before sign-off. |
| Missing data | No station names, line colours, transfers or maneuvers exist in `src/sim`; everything above degrades to sampled stations, generic labels and coral fallback. Build the symbol set (`#chara-face`, `#chara-body`, `#chara-face-sleep`, `#chara-face-happy`) and six costume templates first — `src/character/` is empty. |
---

## 9. Implementation notes (map module, QA round) — values that supersede the tables above

Recorded so the spec and `src/map/` stop disagreeing. Reasons are in the code comments.

- **§2.2 plane:** cruise zoom = `fitBounds(arc, padding 70)` clamped to **[1.6, 6.5]** (was capped at 4.0); flights under **700 km** never cruise below **z5.5** (Seoul–Jeju ≈ 5.6 so origin pill, plane, arc and destination pin stay apart). Cruise **pitch = 30° × clamp((zoom − 2.2) / 1, 0, 1)** (0° when the whole globe is in frame, a thin horizon rim at regional zooms — never a third of the screen). Bearing stays 0 (north-up).
- **§2.2 boat:** zoom floor **7.5** (was 10) — a 200 km crossing at z10 is an empty blue field; at ~z8 the coasts frame the route.
- **§4.3 plane altitude scale:** `--alt-scale` cruises at **0.8** (was 0.55): 128 px × 0.8 ≈ 102 px keeps the porthole face readable and the actor above the 96 px floor.
- **§4.1 walk route:** casing **paper `#FFFFFF` width 9 opacity .85** (was ink .9) so the way ahead stays lighter than the 2 px character outline; core coral 6 with `[0, 2.2]` round-cap dots (footprints), done colour skin.
- **§4.4 boat route:** white casing width 9 **opacity .6**, core `#7CC4EA` width 5 with **`[0, 2]` round-cap dots** (same footprint language as walk, no zipper across the water), done `#A9DCF5`.
- **§4.5 train:** the costume's rail stub (`.mv-ground`) is hidden while riding — the GL route already draws the sleepers.
- **§3.1 marker offset** is per mode: walk/plane `[0, 6]`, car `[0, 10]`, subway/train `[0, 11]`, boat `[0, 12]` (wheels / waterline on the line).
- **§5.1 card row 3:** multi-leg journeys show a small glyph strip — at most **three 12 px mode glyphs (previous › current › next)**, current in sun, others faded — before the distance text. Distance rounds to whole km from 10 km (`175 km 남음`). Still no status line, thought bubble or expand state; the card never resizes.
- **§2.1 boot-time map:** the hidden map is mounted **150 sim-seconds before departure** (`PREWARM_SIM_MS` in `src/screens/Home.tsx`), not at app start; when a ride starts without a pre-warmed map the departure morph plays for 620 ms before MapLibre is constructed (`MAP_HOLD_MS`).
- **§7 reduced motion:** the JS flag is updated from a `matchMedia('(prefers-reduced-motion: reduce)')` `change` listener for the life of the scene.
- **Buildings (owner priority 3):** extrusions are the deck apricot `#FFE1B3` at opacity .96, height ×0.6, under a near-flat warm light (`anchor map`, paper, intensity .05, position `[1.15, 180, 80]`); the flat footprint layer stays on underneath so the ink-tinted outline shows at every block's base. Roads are warm white `#FFFBF2` on a `#E0CDA8` casing that widens to 3 px from z16; the ground lightens to `#BFE6D5` from z15.
- **Ring:** one paper/white radial glow with a whisper of coral at the rim, breathing 3 s; no outlined core ring.
- **Sky at flight zooms:** `atmosphere-blend` is 1 up to z4.5 and 0 from z5.5, and `fog-ground-blend` eases 0.6 → 0.12 over z3.5–5.5, so a domestic flight shows a crisp mint peninsula while intercontinental cruises keep the limb + halo.
