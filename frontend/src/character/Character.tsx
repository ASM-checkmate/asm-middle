// ─── Big cute character: ten poses ──────────────────────────────────────────
// Everything that moves is an inline <g> with a class; character.css owns the loops.
// Arms hold a "pivot ring" (invisible circle around the shoulder) so the fill-box
// origin stays on the shoulder even when the hand holds a pencil or a sketchbook.
import type { CSSProperties, ReactNode } from 'react';
import { C, Head, INK, INK3 } from './shapes';
import type { Face, Variant } from './shapes';

export type Pose = 'idle' | 'walk' | 'sit' | 'sleep' | 'wave' | 'draw' | 'happy' | 'eat' | 'read' | 'think';

export interface CharacterProps {
  pose?: Pose;
  size?: number;                 // px, square
  variant?: Variant;
  color?: string;                // friend accent colour
  className?: string;
  style?: CSSProperties;
  /** Freeze every loop (animation-play-state). */
  paused?: boolean;
}

const FACE: Record<Pose, Face> = {
  idle: 'default', walk: 'default', sit: 'default', sleep: 'sleep', wave: 'happy',
  draw: 'down', happy: 'happy', eat: 'default', read: 'down', think: 'up',
};
/** Arm wrapper rotation (deg) for [left, right]. 0 = hanging straight down; negative on the right lifts it outward. */
const ARM: Record<Pose, [number, number]> = {
  idle: [22, -22], walk: [22, -22], sit: [-12, 12], sleep: [34, -34], wave: [22, -138],
  draw: [-44, 58], happy: [150, -150], eat: [-112, 112], read: [-36, 36], think: [22, 100],
};
const HEAD_TILT: Partial<Record<Pose, number>> = { sleep: -12, think: -5, sit: 3 };
const ROOT: Partial<Record<Pose, string>> = { sleep: 'rotate(6 100 190)' };
const LABEL: Record<Pose, string> = {
  idle: '가만히 있는 캐릭터', walk: '걷는 캐릭터', sit: '앉아 있는 캐릭터', sleep: '자는 캐릭터', wave: '손 흔드는 캐릭터',
  draw: '그림 그리는 캐릭터', happy: '기뻐하는 캐릭터', eat: '먹는 캐릭터', read: '책 읽는 캐릭터', think: '생각하는 캐릭터',
};

export function Character({ pose = 'idle', size = 240, variant = 'me', color, className, style, paused }: CharacterProps) {
  const face = FACE[pose];
  const [al, ar] = ARM[pose];
  const sit = pose === 'sit';
  const armsFront = pose === 'think' || pose === 'eat' || pose === 'wave' || pose === 'draw';
  const tilt = HEAD_TILT[pose];
  const st = { ...(color ? { '--friend': color } : null), ...style } as CSSProperties;
  const cls = ['ch', paused ? 'is-paused' : '', className ?? ''].filter(Boolean).join(' ');

  const arms = (
    <>
      <Arm side="l" angle={al}>{pose === 'draw' && <Sketchbook />}</Arm>
      <Arm side="r" angle={ar}>{pose === 'draw' && <Pencil />}</Arm>
    </>
  );

  return (
    <svg className={cls} data-pose={pose} data-face={face} data-variant={variant} viewBox="0 0 200 200" width={size} height={size} style={st} role="img" aria-label={LABEL[pose]}>
      <ellipse className="ch-shadow" cx="100" cy="190" rx="48" ry="7" fill={C.ink} opacity=".12" />
      <g className="ch-pose" transform={ROOT[pose]}>
        <g className="ch-root">
          {!armsFront && arms}
          <g className="ch-body">
            <path d="M68 156 a14 14 0 0 1 14 -14 h36 a14 14 0 0 1 14 14 v10 a14 14 0 0 1 -14 14 H82 a14 14 0 0 1 -14 -14z" fill={C.coral} {...INK} />
          </g>
          <g className="ch-foot ch-foot-l"><ellipse cx={sit ? 84 : 86} cy={sit ? 184 : 182} rx={sit ? 15 : 13} ry={sit ? 9 : 7} fill={C.skin} {...INK} /></g>
          <g className="ch-foot ch-foot-r"><ellipse cx={sit ? 116 : 114} cy={sit ? 184 : 182} rx={sit ? 15 : 13} ry={sit ? 9 : 7} fill={C.skin} {...INK} /></g>
          {pose === 'read' && <Book />}
          <g transform={`translate(100 96)${tilt ? ` rotate(${tilt})` : ''}`}>
            <g className="ch-head">
              <Head face={face} variant={variant} chew={pose === 'eat'} eyesClass="ch-eyes" mouthClass="ch-mouth" cheeksClass="ch-cheeks" />
            </g>
          </g>
          {armsFront && arms}
          {pose === 'eat' && <Onigiri />}
        </g>
      </g>
      <g className="ch-fx">
        {pose === 'sleep' && <Zzz />}
        {pose === 'happy' && <Sparkles />}
        {pose === 'think' && <Thought />}
      </g>
    </svg>
  );
}

function Arm({ side, angle, children }: { side: 'l' | 'r'; angle: number; children?: ReactNode }) {
  return (
    <g transform={`translate(${side === 'l' ? 66 : 134} 150) rotate(${angle})`}>
      <g className={`ch-arm ch-arm-${side}`}>
        <circle className="pivot" r="48" fill="none" />
        <ellipse cx="0" cy="15" rx="8" ry="15" fill={C.skin} {...INK} />
        {children}
      </g>
    </g>
  );
}

/** Held in the left hand (arm local coords: +y runs down the arm, hand at y≈28). */
function Sketchbook() {
  return (
    <g transform="translate(8 26) rotate(40)">
      <rect x="-21" y="-15" width="42" height="30" rx="4" fill={C.paper} {...INK3} />
      <circle cx="0" cy="1" r="7" fill="none" stroke={C.ink} strokeWidth="2.5" />
      <path d="M-6 -3 l-2 -7 l6 2 M6 -3 l2 -7 l-6 2" fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="-2.6" cy="0" r="1.1" fill={C.ink} /><circle cx="2.6" cy="0" r="1.1" fill={C.ink} />
    </g>
  );
}

/** Held in the right hand. */
function Pencil() {
  return (
    <g transform="translate(0 28) rotate(24)">
      <rect x="-3.5" y="-24" width="7" height="30" rx="2" fill={C.sun} {...INK3} />
      <rect x="-3.5" y="-24" width="7" height="6" rx="2" fill={C.coral} />
      <path d="M-3.5 6 l3.5 9 l3.5 -9 z" fill={C.skin} {...INK3} />
      <path d="M-1.2 12 l1.2 3 l1.2 -3 z" fill={C.ink} />
    </g>
  );
}

function Book() {
  return (
    <g transform="translate(100 166)">
      <path d="M-30 -16 L0 -10 L30 -16 L30 18 L0 24 L-30 18 Z" fill={C.sky} {...INK} />
      <path d="M-25 -11 L-2 -6 L-2 19 L-25 13 Z" fill={C.paper} {...INK3} />
      <path d="M2 -6 L25 -11 L25 13 L2 19 Z" fill={C.paper} {...INK3} />
      <path d="M-19 -1 l12 3 M-19 5 l12 3 M7 2 l12 -3 M7 8 l12 -3" fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" opacity=".45" />
    </g>
  );
}

function Onigiri() {
  return (
    <g className="ch-food">
      <path d="M100 118 C110 118 118 134 121 142 Q122 149 114 149 H86 Q78 149 79 142 C82 134 90 118 100 118 Z" fill={C.paper} {...INK} />
      <path d="M92 140 h16 v9 H92 z" fill={C.night} />
    </g>
  );
}

function Zzz() {
  const t = { fill: C.sun, stroke: C.ink, strokeWidth: 2, paintOrder: 'stroke' as const, style: { fontFamily: 'var(--mono)', fontWeight: 500 } };
  return (
    <g transform="translate(144 78)">
      <text className="ch-z" x="0" y="0" fontSize="15" {...t}>z</text>
      <text className="ch-z" x="8" y="-11" fontSize="19" {...t}>z</text>
      <text className="ch-z" x="18" y="-24" fontSize="24" {...t}>z</text>
    </g>
  );
}

const STAR = 'M0 -9 q1.5 7 9 9 q-7.5 2 -9 9 q-1.5 -7 -9 -9 q7.5 -2 9 -9z';
function Sparkles() {
  return (
    <>
      <g transform="translate(40 62)"><path className="ch-spark" d={STAR} fill={C.sun} stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" /></g>
      <g transform="translate(162 46)"><path className="ch-spark" d={STAR} fill={C.sun} stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" /></g>
    </>
  );
}

function Thought() {
  return (
    <g>
      <circle cx="146" cy="86" r="3.5" fill={C.paper} {...INK3} />
      <circle cx="155" cy="74" r="5.5" fill={C.paper} {...INK3} />
      <path d="M158 56 a9 9 0 0 1 9 -14 a11 11 0 0 1 20 -4 a10 10 0 0 1 14 12 a8 8 0 0 1 -4 14 a10 10 0 0 1 -18 4 a10 10 0 0 1 -18 -2 a8 8 0 0 1 -3 -10z" fill={C.paper} {...INK} />
      <circle className="ch-dot" cx="170" cy="52" r="2.6" fill={C.ink} />
      <circle className="ch-dot" cx="179" cy="52" r="2.6" fill={C.ink} />
      <circle className="ch-dot" cx="188" cy="52" r="2.6" fill={C.ink} />
    </g>
  );
}
