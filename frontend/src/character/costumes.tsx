// ─── Six Rider costumes (MOVEMENT_SPEC §3–4) ────────────────────────────────
// Side-view sprites facing screen-right; the map flips them with a squash.
// Uniform scale: 4-unit stroke = 2 px on screen. Every animated part is an inline
// element with a class; heads are <use> symbols (they move as one unit).
// Node budget (§3.2/§8): same-colour shapes are merged into one <path>, wheels are
// two nodes, no clipPaths — heads poke above the window band like the car's sunroof.
import { C, INK, INK3, Wheel, rr, sine } from './shapes';

export interface CostumeProps {
  friend: boolean;
  night: boolean;
  sleeping: boolean;
  waving: boolean;
  /** Unique prefix for ids (several riders may share a page). Unused today — kept for future clipPaths. */
  uid: string;
}

const SHADOW = { fill: C.ink, opacity: 0.14 } as const;

/** Repeated dashes as one path: horizontal (`h len`) or vertical (`v len`). */
function dashes(y: number, from: number, step: number, n: number, len: number, vertical = false): string {
  let d = '';
  for (let i = 0; i < n; i++) d += `M${from + i * step} ${y} ${vertical ? 'v' : 'h'}${len} `;
  return d;
}
function circles(r: number, ...pts: number[]): string {
  let d = '';
  for (let i = 0; i < pts.length; i += 2) d += `M${pts[i]! - r} ${pts[i + 1]} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 z `;
  return d;
}

// ── walk ─────────────────────────────────────────────────────────────────────
export function Walk({ friend }: CostumeProps) {
  return (
    <>
      <ellipse className="mv-shadow" cx="100" cy="186" rx="26" ry="5" {...SHADOW} />
      <g className="mv-fx">
        <circle className="puff" cx="72" cy="184" r="5" fill={C.paper2} />
        <circle className="puff" cx="72" cy="184" r="5" fill={C.paper2} />
      </g>
      {friend && (
        <g className="mv-chara2" transform="translate(-42 18) scale(.84)">
          <use href="#chara-body" x="50" y="126" width="100" height="60" />
          <use href="#chara-face-friend-3q" x="30" y="6" width="140" height="140" />
        </g>
      )}
      <g className="mv-veh">
        <ellipse className="foot foot-l" cx="88" cy="179" rx="12" ry="7" fill={C.skin} {...INK} />
        <ellipse className="foot foot-r" cx="112" cy="179" rx="12" ry="7" fill={C.skin} {...INK} />
      </g>
      <g className="mv-chara">
        <rect className="pack" x="46" y="128" width="30" height="40" rx="11" fill={C.coral} {...INK} />
        <g className="arm arm-l"><circle className="pivot" cx="74" cy="138" r="32" fill="none" /><path d="M74 138 q-14 8 -12 26" fill="none" {...INK} /></g>
        <path d="M70 124 h60 v40 a14 14 0 0 1 -14 14 H84 a14 14 0 0 1 -14 -14z" fill={C.skin} {...INK} />
        <rect x="80" y="134" width="40" height="13" rx="4" fill={C.coral} {...INK3} />
        <g className="arm arm-r"><circle className="pivot" cx="126" cy="138" r="32" fill="none" /><path d="M126 138 q14 8 12 26" fill="none" {...INK} /></g>
        <use href="#chara-face-3q" x="30" y="6" width="140" height="140" />
      </g>
    </>
  );
}

// ── car ──────────────────────────────────────────────────────────────────────
export function Car({ friend, night }: CostumeProps) {
  return (
    <>
      <ellipse className="mv-shadow" cx="120" cy="192" rx="56" ry="5" {...SHADOW} />
      <g className="mv-fx">
        <circle className="puff" cx="8" cy="168" r="6" fill={C.paper2} />
        <circle className="puff" cx="8" cy="168" r="6" fill={C.paper2} />
      </g>
      <g className="mv-veh">
        <g className="mv-chara">
          {friend && <use href="#chara-face-friend" x="34" y="16" width="80" height="80" />}
          <use href="#chara-face-3q" x="88" y="4" width="96" height="96" />
        </g>
        <path d="M26 178 Q10 178 10 162 L10 142 Q10 126 30 124 L58 124 L80 96 Q86 88 100 88 L164 88 Q178 88 186 98 L206 124 L214 124 Q230 126 230 142 L230 162 Q230 178 214 178 Z" fill={C.coral} {...INK} />
        <path d="M84 122 L98 96 Q100 92 106 92 L160 92 Q166 92 170 98 L188 122 Z" fill={C.paper} {...INK3} />
        <rect x="118" y="102" width="36" height="24" rx="9" fill={C.coral} />
        <path d="M126 122 L142 92 L154 92 L138 122 Z" fill={C.sky} opacity=".75" />
        <path d="M150 124 V174 M140 142 h8" fill="none" {...INK3} />
        <ellipse cx="170" cy="90" rx="9" ry="6" fill={C.skin} {...INK3} />
        <circle cx="226" cy="140" r="7" fill={C.sun} fillOpacity={night ? 1 : 0.55} {...INK3} />
        <Wheel cx={68} cy={172} r={20} />
        <Wheel cx={176} cy={172} r={20} />
      </g>
    </>
  );
}

// ── plane ────────────────────────────────────────────────────────────────────
const FUSELAGE = 'M60 36 H196 A45 45 0 0 1 196 126 H60 A45 45 0 0 1 60 36 Z';
// belly stripe inset 2 units so the fuselage's ink stays visible
const BELLY = 'M21.6 100 A43 43 0 0 0 60 124 H196 A43 43 0 0 0 234.4 100 Z';
export function Plane({ friend, sleeping }: CostumeProps) {
  return (
    <>
      <g className="mv-fx">
        <line className="trail" x1="8" y1="70" x2="34" y2="70" stroke={C.paper} strokeWidth="3" strokeLinecap="round" opacity=".7" />
        <line className="trail" x1="4" y1="92" x2="30" y2="92" stroke={C.paper} strokeWidth="3" strokeLinecap="round" opacity=".7" />
      </g>
      <g className="mv-veh">
        {/* tail fin + rear stabiliser, one coral path */}
        <path d="M58 68 L36 24 Q33 16 42 18 L92 62 Z M46 104 L18 118 Q10 120 14 112 L34 90 Z" fill={C.coral} {...INK} />
        {/* far wing: short stub peeking above the fuselage (drawn behind it) */}
        <rect x="-40" y="-9" width="46" height="18" rx="9" fill={C.sky} {...INK} transform="translate(130 42) rotate(22)" />
        <path d={FUSELAGE} fill={C.paper} {...INK} />
        <path d={BELLY} fill={C.sky} />
        {/* near wing: stubby rounded swept wing with a coral tip, its root tucked under the porthole */}
        <rect x="-40" y="-9" width="50" height="18" rx="9" fill={C.sky} {...INK} transform="translate(116 118) rotate(-20)" />
        <rect x="-40" y="-9" width="18" height="18" rx="9" fill={C.coral} {...INK3} transform="translate(116 118) rotate(-20)" />
        <ellipse cx="216" cy="64" rx="14" ry="9" fill={C.sky} {...INK3} />
        <circle cx="240" cy="90" r="6" fill={C.sun} {...INK3} />
        {friend ? (
          <>
            <circle cx="84" cy="82" r="30" fill={C.sky} {...INK} />
            <use href="#chara-face-friend" x="53" y="51" width="62" height="62" />
          </>
        ) : (
          <circle cx="88" cy="80" r="11" fill={C.sky} {...INK3} />
        )}
        <circle cx="152" cy="80" r="38" fill={C.sky} {...INK} />
        <g className="mv-chara">
          <use href={sleeping ? '#chara-face-sleep' : '#chara-face'} x="110" y="38" width="84" height="84" />
          {sleeping && (
            <g className="unflip">
              <text className="mv-z" x="184" y="58" fontSize="12" fill={C.sun} stroke={C.ink} strokeWidth="1.5" paintOrder="stroke" style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>z</text>
            </g>
          )}
        </g>
        <circle cx="152" cy="80" r="38" fill="none" {...INK} />
      </g>
    </>
  );
}

// ── boat ─────────────────────────────────────────────────────────────────────
export function Boat({ friend }: CostumeProps) {
  return (
    <>
      <g className="mv-ground">
        <path className="wave wave-1" d={sine(172, -40, 280)} fill="none" stroke={C.wave} strokeWidth="4" strokeLinecap="round" />
        <path className="wave wave-2" d={sine(184, -40, 280)} fill="none" stroke={C.wave} strokeWidth="4" strokeLinecap="round" opacity=".6" />
      </g>
      <g className="mv-veh">
        <line x1="48" y1="58" x2="48" y2="126" {...INK} />
        <g className="flag"><circle className="pivot" cx="48" cy="76" r="40" fill="none" /><path d="M46 60 L12 76 L46 92 Z" fill={C.coral} {...INK} /></g>
        {friend && (
          <>
            <use href="#chara-body" x="128" y="84" width="100" height="60" />
            <use href="#chara-face-friend" x="140" y="20" width="76" height="76" />
          </>
        )}
        <use href="#chara-body" x="66" y="76" width="100" height="60" />
        <g className="mv-chara"><use href="#chara-face-3q" x="66" y="16" width="100" height="100" /></g>
        <path d="M22 124 H218 C216 158 196 176 160 176 H80 C44 176 24 158 22 124 Z" fill={C.mint} {...INK} />
        <rect x="16" y="118" width="208" height="14" rx="7" fill={C.paper} {...INK} />
        <path d="M150 104 L204 172" fill="none" {...INK} />
        <ellipse cx="207" cy="175" rx="7" ry="12" transform="rotate(-38 207 175)" fill={C.sun} {...INK3} />
      </g>
    </>
  );
}

// ── train ────────────────────────────────────────────────────────────────────
// Head: 90-unit <use> → 80-unit ellipse = 40 px at the 144 px box (§3.3). It fills the
// rear car's big window and pokes above the roof; the chin stops at the sill (no clip).
const SLEEPERS = dashes(186, 4, 24, 13, 11, true); // 13 sleeper ticks, one node; scrolls by one tick (24 units)
export function Train({ friend, waving }: CostumeProps) {
  return (
    <>
      <ellipse className="mv-shadow" cx="144" cy="193" rx="110" ry="4" {...SHADOW} />
      <g className="mv-ground" opacity=".35">
        <path d="M0 188 H288 M0 195 H288" fill="none" stroke={C.ink} strokeWidth="2" />
        <path className="rail-ticks" d={SLEEPERS} fill="none" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
      </g>
      <g className="mv-veh">
        <g className="car-rear">
          <rect x="8" y="90" width="134" height="78" rx="12" fill={C.sun} {...INK} />
          <rect x="16" y="100" width="118" height="38" rx="6" fill={C.night} />
          <rect className="light" x="122" y="100" width="12" height="38" fill={C.paper} opacity=".55" />
          <path d={rr(22, 102, 28, 32, 6) + rr(58, 90, 80, 50, 9)} fill={C.paper} {...INK3} />
          <rect x="12" y="150" width="126" height="8" rx="3" fill={C.coral} />
          <g className="mv-chara">
            <use href="#chara-face" x="53" y="56" width="90" height="90" />
            <ellipse className={waving ? 'hand waving' : 'hand'} cx="141" cy="121" rx="7" ry="9" fill={C.skin} {...INK3} />
          </g>
          <Wheel cx={44} cy={176} r={12} />
          <Wheel cx={104} cy={176} r={12} />
        </g>
        <rect x="140" y="150" width="12" height="8" fill={C.ink} />
        <g className="car-front">
          <path d="M150 100 a10 10 0 0 1 10 -10 h84 q36 0 36 40 v28 a10 10 0 0 1 -10 10 h-110 a10 10 0 0 1 -10 -10 z" fill={C.sun} {...INK} />
          <rect x="158" y="100" width="98" height="38" rx="6" fill={C.night} />
          <rect className="light" x="244" y="100" width="12" height="38" fill={C.paper} opacity=".55" />
          <path d={friend ? rr(162, 90, 70, 50, 9) : rr(166, 106, 26, 26, 5) + rr(200, 106, 26, 26, 5)} fill={C.paper} {...INK3} />
          <path d="M236 104 h12 q14 2 18 22 v6 h-30 z" fill={C.sky} {...INK3} />
          <rect x="154" y="150" width="122" height="8" rx="3" fill={C.coral} />
          <circle cx="272" cy="146" r="6" fill={C.sun} {...INK3} />
          {friend && <use href="#chara-face-friend" x="157" y="63" width="80" height="80" />}
          <Wheel cx={176} cy={176} r={12} />
          <Wheel cx={236} cy={176} r={12} />
        </g>
      </g>
    </>
  );
}

// ── subway ───────────────────────────────────────────────────────────────────
// Head: 90-unit <use> → 40 px at the 140 px box. Fills the big second window, hair above the roof.
const TUNNEL = dashes(67, -27, 60, 6, 6);
export function Subway({ friend }: CostumeProps) {
  return (
    <>
      <ellipse className="mv-shadow" cx="140" cy="194" rx="110" ry="4" {...SHADOW} />
      <g className="mv-fx">
        <path className="tunnel" d={TUNNEL} fill="none" stroke={C.sun} strokeWidth="6" strokeLinecap="round" opacity=".9" />
      </g>
      <g className="mv-veh">
        <rect x="12" y="82" width="256" height="90" rx="18" fill={C.sky} {...INK} />
        <rect x="16" y="134" width="248" height="10" style={{ fill: 'var(--line-color, #FF6A48)' }} />
        <path
          className="windows"
          d={rr(22, 98, 28, 32, 6) + rr(56, 90, 84, 48, 9) + (friend ? rr(186, 90, 70, 48, 9) : rr(188, 96, 48, 40, 8) + rr(244, 98, 18, 32, 5))}
          fill={C.paper} {...INK3}
        />
        <rect className="door door-l" x="146" y="88" width="16" height="78" rx="4" fill={C.sky} {...INK3} />
        <rect className="door door-r" x="164" y="88" width="16" height="78" rx="4" fill={C.sky} {...INK3} />
        <path d="M18 158 H262 V166 Q262 172 254 172 H26 Q18 172 18 166 Z" fill={C.night} />
        <circle cx="262" cy="150" r="6" fill={C.sun} {...INK3} />
        <path d={circles(8, 60, 178, 92, 178, 188, 178, 220, 178)} fill={C.ink} />
        <g className="mv-chara">
          <use href="#chara-face" x="53" y="56" width="90" height="90" />
          {/* hand-strap: roof line + ring + the arm, one path swinging about the roof anchor */}
          <g className="strap">
            <circle className="pivot" cx="48" cy="82" r="54" fill="none" />
            <path d="M48 82 v16 M43 103 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M70 134 Q55 126 51 109" fill="none" {...INK} />
          </g>
          {friend && <use href="#chara-face-friend" x="181" y="64" width="80" height="80" />}
        </g>
      </g>
    </>
  );
}
