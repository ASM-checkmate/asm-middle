// ─── Shared geometry for the theworld character ─────────────────────────────
// Every part lives at a local origin (head centre = 0,0) so the exact same shapes
// feed both the <symbol> set (used by the vehicles) and the inline poses (which
// need animatable parts — CSS keyframes cannot reach inside a <use> shadow tree).
// Colours are the deck's token hex literals (SVG fills only).

export const C = {
  ink: '#2A2118',
  skin: '#FFD9B8',
  coral: '#FF6A48',
  sun: '#FFC64D',
  mint: '#5FC9A6',
  sky: '#A9DCF5',
  night: '#1E2440',
  paper: '#FFF6E6',
  paper2: '#FFEBCB',
  hair: '#3A2A22',
  wave: '#7CC4EA',
  white: '#FFFFFF',
} as const;

/** Friend accent colour, inherited from the nearest `--friend` (Character `color` / Rider `friendColor`). */
export const FRIEND = 'var(--friend, #5FC9A6)';

export type Face = 'default' | 'sleep' | 'happy' | 'down' | 'up';
export type Variant = 'me' | 'friend';

/** 4-unit ink outline at 200-viewBox scale = 2 px on screen at the marker size. */
export const INK = { stroke: C.ink, strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const INK3 = { ...INK, strokeWidth: 3 } as const;

export const HEAD_RX = 62;
export const HEAD_RY = 56;

// Bowl cut with three scalloped bangs and a curl on top.
const HAIR_ME =
  'M-61.7 -6 A62 56 0 0 1 61.7 -6 Q56 -22 46 -27 Q32 -6 18 -27 Q0 -6 -18 -27 Q-32 -6 -46 -27 Q-56 -22 -61.7 -6 Z';
// Friend: rounder bob that hugs the cheeks, two soft bangs, a side lock on the right.
const HAIR_FRIEND =
  'M-60 14 A62 56 0 1 1 60 14 C61 -4 58 -18 48 -24 Q34 -32 22 -20 Q8 -34 -8 -22 Q-22 -32 -38 -20 C-50 -14 -57 0 -60 14 Z';

export interface HeadProps {
  face?: Face;
  variant?: Variant;
  /** 3/4 view: features slide toward +x (the travel direction of side-view sprites). */
  quarter?: boolean;
  /** Render both a closed and an open mouth (eat pose toggles them). */
  chew?: boolean;
  eyesClass?: string;
  mouthClass?: string;
  cheeksClass?: string;
}

/** The head, drawn around (0,0). Hair, eyes, blush, mouth, and the friend's scarf. */
export function Head({ face = 'default', variant = 'me', quarter = false, chew = false, eyesClass, mouthClass, cheeksClass }: HeadProps) {
  const dx = quarter ? 8 : 0;
  const eyeShift = face === 'down' ? 'translate(0 4)' : face === 'up' ? 'translate(3 -3)' : undefined;
  return (
    <>
      <ellipse cx="0" cy="0" rx={HEAD_RX} ry={HEAD_RY} fill={C.skin} {...INK} />
      <path d={variant === 'friend' ? HAIR_FRIEND : HAIR_ME} fill={C.hair} {...INK} />
      <path d="M-32 -38 q8 -10 18 -13" fill="none" stroke={C.paper} strokeWidth="4" strokeLinecap="round" opacity=".35" />
      {variant === 'friend' ? (
        <rect x="14" y="-34" width="18" height="6" rx="3" fill={FRIEND} transform="rotate(-16 23 -31)" />
      ) : (
        <path d="M1 -55 q-6 -14 11 -12" fill="none" {...INK} />
      )}
      <g className={cheeksClass}>
        <ellipse cx={-38 + dx} cy="26" rx="10" ry="6" fill={C.coral} opacity=".38" />
        <ellipse cx={38 + dx} cy="26" rx="10" ry="6" fill={C.coral} opacity=".38" />
      </g>
      <g transform={eyeShift}>
        <g className={eyesClass}>
          {face === 'sleep' ? (
            <>
              <path d={`M${-28 + dx} 12 q8 7 16 0`} fill="none" {...INK} />
              <path d={`M${12 + dx} 12 q8 7 16 0`} fill="none" {...INK} />
            </>
          ) : face === 'happy' ? (
            <>
              <path d={`M${-28 + dx} 15 q8 -11 16 0`} fill="none" {...INK} />
              <path d={`M${12 + dx} 15 q8 -11 16 0`} fill="none" {...INK} />
            </>
          ) : (
            <>
              <circle cx={-20 + dx} cy="12" r="7.5" fill={C.ink} />
              <circle cx={20 + dx} cy="12" r="7.5" fill={C.ink} />
              <circle cx={-17.4 + dx} cy="9.4" r="2.6" fill={C.white} />
              <circle cx={22.6 + dx} cy="9.4" r="2.6" fill={C.white} />
              <circle cx={-23 + dx} cy="15.5" r="1.3" fill={C.white} />
              <circle cx={17 + dx} cy="15.5" r="1.3" fill={C.white} />
            </>
          )}
        </g>
      </g>
      <g className={mouthClass}>
        {face === 'happy' ? (
          <>
            <path d={`M${-9 + dx} 25 q9 16 18 0 z`} fill={C.ink} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
            <path d={`M${-4.5 + dx} 31 q4.5 5 9 0 z`} fill={C.coral} />
          </>
        ) : face === 'sleep' ? (
          <circle cx={dx} cy="31" r="3" fill={C.ink} />
        ) : face === 'up' ? (
          <path d={`M${-5 + dx} 29 q2.5 3.5 5 0 q2.5 3.5 5 0`} fill="none" {...INK3} />
        ) : chew ? (
          <>
            <path className="ch-mouth-a" d={`M${-6 + dx} 28 q6 6 12 0`} fill="none" {...INK} />
            <ellipse className="ch-mouth-b" cx={dx} cy="30" rx="5" ry="6" fill={C.ink} />
          </>
        ) : (
          <path d={`M${-6 + dx} 28 q6 6 12 0`} fill="none" {...INK} />
        )}
      </g>
      {variant === 'friend' && (
        <>
          <path d="M18 60 l4 22 q1 6 7 5 l12 -4 q-8 -8 -8 -24 z" fill={FRIEND} {...INK} />
          <path d="M-44 40 Q0 64 44 40 Q46 56 40 62 Q0 78 -40 62 Q-46 56 -44 40 Z" fill={FRIEND} {...INK} />
        </>
      )}
    </>
  );
}

/** Small body (coral shirt, two stubby arms, two feet) around (0,0) = shirt centre. Static — used by <use>. */
export function BodyStub() {
  return (
    <>
      <ellipse cx="-22" cy="26" rx="12" ry="7" fill={C.skin} {...INK} />
      <ellipse cx="22" cy="26" rx="12" ry="7" fill={C.skin} {...INK} />
      <ellipse cx="-36" cy="0" rx="8" ry="14" fill={C.skin} {...INK} transform="rotate(24 -36 0)" />
      <ellipse cx="36" cy="0" rx="8" ry="14" fill={C.skin} {...INK} transform="rotate(-24 36 0)" />
      <path d="M-32 -6 a14 14 0 0 1 14 -14 h36 a14 14 0 0 1 14 14 v10 a14 14 0 0 1 -14 14 H-18 a14 14 0 0 1 -14 -14z" fill={C.coral} {...INK} />
    </>
  );
}

/**
 * Wheel, two nodes: a static paper hub and ONE spinning path (ink tyre ring + one spoke,
 * even-odd fill). The path spins about its own centre (fill-box 50% 50%). Reduced motion
 * hides the spoke by dropping the path's stroke (`.wheel { stroke: none }`).
 */
export function Wheel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const hub = r * 0.42;
  const d = `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 z`
    + ` M${cx - hub} ${cy} a${hub} ${hub} 0 1 0 ${2 * hub} 0 a${hub} ${hub} 0 1 0 ${-2 * hub} 0 z`
    + ` M${cx - hub} ${cy} H${cx + hub}`;
  return (
    <>
      <circle cx={cx} cy={cy} r={hub} fill={C.paper} />
      <path className="wheel" d={d} fill={C.ink} fillRule="evenodd" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
    </>
  );
}

/** Rounded-rectangle path segment (lets several same-colour windows share one node). */
export function rr(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y} h${w - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${h - 2 * r} a${r} ${r} 0 0 1 ${-r} ${r} h${-(w - 2 * r)} a${r} ${r} 0 0 1 ${-r} ${-r} v${-(h - 2 * r)} a${r} ${r} 0 0 1 ${r} ${-r} z `;
}

/** A repeating sine (period 40) — scrolls seamlessly by translateX(-40px). */
export function sine(y: number, from: number, to: number, period = 40, amp = 7): string {
  const h = period / 2;
  let d = `M${from} ${y}`;
  for (let x = from; x < to; x += period) d += ` q${h / 2} ${-amp} ${h} 0 q${h / 2} ${amp} ${h} 0`;
  return d;
}
