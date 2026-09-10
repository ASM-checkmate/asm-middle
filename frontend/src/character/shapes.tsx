// ─── Shared geometry for the theworld character ─────────────────────────────
// Every part lives at a local origin (head centre = 0,0) so the exact same shapes
// feed both the <symbol> set (used by the vehicles) and the inline poses (which
// need animatable parts — CSS keyframes cannot reach inside a <use> shadow tree).
// Colours are the deck's token hex literals (SVG fills only).

import type { Look } from '../sim/types';

export const C = {
  ink: '#2A2118',
  /** 피부·머리·상의는 겉모습 변수(character/look.tsx)를 받는다 — 기본값이 모모 */
  skin: 'var(--ch-skin, #FFD9B8)',
  top: 'var(--ch-top, #FF6A48)',
  coral: '#FF6A48',
  sun: '#FFC64D',
  mint: '#5FC9A6',
  sky: '#A9DCF5',
  night: '#1E2440',
  paper: '#FFF6E6',
  paper2: '#FFEBCB',
  hair: 'var(--ch-hair, #3A2A22)',
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

// 얼굴형: 위 반쪽은 항상 같은 타원 호(머리카락이 거기 앉는다), 아래 반쪽(턱)만 다르다
const FACE_PATH: Record<NonNullable<Look['face']>, string> = {
  round: 'M-62 0 A62 56 0 0 1 62 0 A62 56 0 0 1 -62 0 Z',
  long: 'M-62 0 A62 56 0 0 1 62 0 C62 44 40 84 0 84 C-40 84 -62 44 -62 0 Z',
  square: 'M-62 0 A62 56 0 0 1 62 0 L64 40 Q64 62 44 62 L-44 62 Q-64 62 -64 40 Z',
  heart: 'M-62 0 A62 56 0 0 1 62 0 C62 30 30 58 0 70 C-30 58 -62 30 -62 0 Z',
};
/** 얼굴형에 따라 입·볼·코가 내려가는 양 */
const FACE_DY: Record<NonNullable<Look['face']>, number> = { round: 0, long: 12, square: 3, heart: 0 };

// Bowl cut with three scalloped bangs and a curl on top.
const HAIR_ME =
  'M-61.7 -6 A62 56 0 0 1 61.7 -6 Q56 -22 46 -27 Q32 -6 18 -27 Q0 -6 -18 -27 Q-32 -6 -46 -27 Q-56 -22 -61.7 -6 Z';
// Friend: rounder bob that hugs the cheeks, two soft bangs, a side lock on the right.
const HAIR_FRIEND =
  'M-60 14 A62 56 0 1 1 60 14 C61 -4 58 -18 48 -24 Q34 -32 22 -20 Q8 -34 -8 -22 Q-22 -32 -38 -20 C-50 -14 -57 0 -60 14 Z';

// 겉모습(ADR-0019)의 머리 모양들 — 앞. short는 이마가 보이게 헤어라인이 높고, buzz는 더 얇다. long은 bob에 옆 머리(HAIR_LONG_SIDE, 얼굴 뒤)를 더한다
const HAIR_SHORT = 'M-61.7 -6 A62 56 0 0 1 61.7 -6 Q50 -30 30 -35 Q0 -41 -30 -35 Q-50 -30 -61.7 -6 Z';
const HAIR_BUZZ = 'M-60 -14 A62 56 0 0 1 60 -14 Q40 -37 0 -41 Q-40 -37 -60 -14 Z';
const HAIR_LONG_SIDE = 'M-62 -4 Q-74 40 -62 82 L-40 82 Q-50 44 -46 20 Z M62 -4 Q74 40 62 82 L40 82 Q50 44 46 20 Z';
/** 곱슬: 캡 위에 둥근 뭉치들 (x, y, r) */
const CURLS: [number, number, number][] = [[-52, -20, 15], [-30, -40, 16], [0, -48, 17], [30, -40, 16], [52, -20, 15], [-62, 4, 12], [62, 4, 12]];
// 2026-09-11 확장 — 실루엣을 바꾸는 머리들. side-part는 가르마 쪽이 높고 반대쪽으로 쓸어 넘긴다, bangs는 이마를 일자로 덮는다
const HAIR_SIDE_PART = 'M-61.7 -6 A62 56 0 0 1 61.7 -6 Q52 -30 26 -34 Q-6 -44 -32 -28 Q-52 -20 -61.7 -6 Z';
const HAIR_BANGS = 'M-61.7 -6 A62 56 0 0 1 61.7 -6 Q62 -10 60 -14 L-60 -14 Q-62 -10 -61.7 -6 Z';
/** 포니테일·번·아프로·삐죽·양갈래·웨이브 — 얼굴 뒤에 그리는 덩어리 (앞·뒤 공통). 앞머리 캡은 따로 */
const HAIR_PONYTAIL = 'M44 -34 Q84 -20 82 40 Q78 70 60 84 Q70 44 58 6 Q52 -14 40 -22 Z';
const HAIR_BUN = 'M-18 -60 A18 16 0 1 1 18 -60 A18 16 0 1 1 -18 -60 Z';
const HAIR_AFRO = 'M-80 -6 A80 72 0 1 1 80 -6 A80 72 0 1 1 -80 -6 Z';
const HAIR_SPIKY = 'M-56 -22 L-44 -66 L-30 -36 L-16 -80 L0 -42 L16 -80 L30 -36 L44 -66 L56 -22 Z';
const HAIR_PIGTAILS = 'M-58 -4 Q-84 20 -78 70 Q-74 82 -62 80 Q-58 40 -50 10 Z M58 -4 Q84 20 78 70 Q74 82 62 80 Q58 40 50 10 Z';
const HAIR_WAVY_SIDE = 'M-62 -4 Q-80 20 -70 40 Q-82 60 -66 84 L-40 84 Q-52 60 -44 40 Q-52 20 -46 12 Z M62 -4 Q80 20 70 40 Q82 60 66 84 L40 84 Q52 60 44 40 Q52 20 46 12 Z';
const HAIR_BEHIND: Partial<Record<Look['hairStyle'], string>> = { long: HAIR_LONG_SIDE, ponytail: HAIR_PONYTAIL, bun: HAIR_BUN, afro: HAIR_AFRO, spiky: HAIR_SPIKY, pigtails: HAIR_PIGTAILS, wavy: HAIR_WAVY_SIDE };
/** 스타일별 앞머리 (bald는 없음) */
export const HAIR_FRONT: Record<Look['hairStyle'], string | null> = {
  bowl: HAIR_ME, bob: HAIR_FRIEND, short: HAIR_SHORT, buzz: HAIR_BUZZ, long: HAIR_FRIEND, curly: HAIR_SHORT, bald: null,
  'side-part': HAIR_SIDE_PART, bangs: HAIR_BANGS, ponytail: HAIR_SHORT, bun: HAIR_SIDE_PART, afro: HAIR_SHORT, spiky: HAIR_SHORT, pigtails: HAIR_FRIEND, wavy: HAIR_FRIEND,
};

// 뒷모습: 위 반쪽은 같은 타원 호, 아래 가장자리는 목덜미 위(y≈34)에서 살짝 물결친다
const HAIR_BACK_ME =
  'M-58 20 A62 56 0 1 1 58 20 Q52 34 40 32 Q28 40 14 33 Q0 40 -14 33 Q-28 40 -40 32 Q-52 34 -58 20 Z';
const HAIR_BACK_FRIEND =
  'M-60 14 A62 56 0 1 1 60 14 Q58 44 44 50 Q0 58 -44 50 Q-58 44 -60 14 Z';
const HAIR_BACK_SHORT = 'M-58 10 A62 56 0 1 1 58 10 Q40 28 0 30 Q-40 28 -58 10 Z';
const HAIR_BACK_LONG = 'M-60 14 A62 56 0 1 1 60 14 Q62 62 46 82 Q0 90 -46 82 Q-62 62 -60 14 Z';
const HAIR_BACK: Record<Look['hairStyle'], string | null> = {
  bowl: HAIR_BACK_ME, bob: HAIR_BACK_FRIEND, short: HAIR_BACK_SHORT, buzz: HAIR_BACK_SHORT, long: HAIR_BACK_LONG, curly: HAIR_BACK_SHORT, bald: null,
  'side-part': HAIR_BACK_SHORT, bangs: HAIR_BACK_FRIEND, ponytail: HAIR_BACK_SHORT, bun: HAIR_BACK_SHORT, afro: HAIR_BACK_SHORT, spiky: HAIR_BACK_SHORT, pigtails: HAIR_BACK_FRIEND, wavy: HAIR_BACK_LONG,
};
/** 친구 얼굴의 고정색 — 내 겉모습 변수를 물려받지 않는다 (같은 svg 안에 함께 타는 탈것) */
const FIXED = { skin: '#FFD9B8', hair: '#3A2A22' } as const;

export interface HeadProps {
  face?: Face;
  variant?: Variant;
  /** 3/4 view: features slide toward +x (the travel direction of side-view sprites). */
  quarter?: boolean;
  /** Render both a closed and an open mouth (eat pose toggles them). */
  chew?: boolean;
  /** 뒷모습 — 얼굴 없이 머리카락이 뒤통수를 덮는다 (방 안에서 위로 걸어갈 때) */
  back?: boolean;
  /** 겉모습 (ADR-0019): 머리 모양·안경·수염. 색은 svg 뿌리의 변수(character/look.tsx)로 온다. 없으면 variant의 기본 */
  look?: Look;
  eyesClass?: string;
  mouthClass?: string;
  cheeksClass?: string;
}

/** The head, drawn around (0,0). Hair, eyes, blush, mouth, and the friend's scarf. */
export function Head({ face = 'default', variant = 'me', quarter = false, chew = false, back = false, look, eyesClass, mouthClass, cheeksClass }: HeadProps) {
  const dx = quarter ? 8 : 0;
  const eyeShift = face === 'down' ? 'translate(0 4)' : face === 'up' ? 'translate(3 -3)' : undefined;
  // 친구는 고정색, 나는 변수(겉모습). look이 있으면 누구든 변수를 쓴다 — 그 svg 뿌리가 그 look의 색을 얹는다
  const skin = variant === 'friend' && !look ? FIXED.skin : C.skin;
  const hair = variant === 'friend' && !look ? FIXED.hair : C.hair;
  const style: Look['hairStyle'] = look?.hairStyle ?? (variant === 'friend' ? 'bob' : 'bowl');
  const buzz = style === 'buzz';
  const shape = look?.face ?? 'round';
  const fy = FACE_DY[shape];
  const ears = (look?.ears ?? 'hidden') === 'out' && (
    <>
      <ellipse cx="-64" cy="10" rx="9" ry="12" fill={skin} {...INK} />
      <ellipse cx="64" cy="10" rx="9" ry="12" fill={skin} {...INK} />
    </>
  );
  // 뒷모습의 포니테일은 가운데로 (앞에서는 오른쪽 옆으로 나온다)
  const behindPath = HAIR_BEHIND[style];
  const behind = behindPath && <path d={behindPath} fill={hair} {...INK} transform={back && style === 'ponytail' ? 'translate(-60 0)' : undefined} />;
  const curls = style === 'curly' && CURLS.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={hair} {...INK} />);
  if (back) {
    const backPath = HAIR_BACK[style];
    return (
      <>
        {behind}
        {curls}
        {ears}
        <path d={FACE_PATH[shape]} fill={skin} {...INK} />
        {/* 뒤통수: 바가지 머리가 목덜미 위까지 내려온다 (친구는 단발이라 더 길게) */}
        {backPath && <path d={backPath} fill={hair} opacity={buzz ? 0.8 : 1} {...INK} />}
        <path d="M-32 -38 q8 -10 18 -13" fill="none" stroke={C.paper} strokeWidth="4" strokeLinecap="round" opacity=".35" />
        {variant === 'friend' ? (
          <>
            <path d="M18 60 l4 22 q1 6 7 5 l12 -4 q-8 -8 -8 -24 z" fill={FRIEND} {...INK} />
            <path d="M-44 40 Q0 64 44 40 Q46 56 40 62 Q0 78 -40 62 Q-46 56 -44 40 Z" fill={FRIEND} {...INK} />
          </>
        ) : style === 'bowl' && (
          <path d="M1 -55 q-6 -14 11 -12" fill="none" {...INK} />
        )}
      </>
    );
  }
  const front = HAIR_FRONT[style];
  const glasses = look?.glasses ?? 'none';
  const beard = look?.beard ?? 'none';
  return (
    <>
      {behind}
      {curls}
      {ears}
      <path d={FACE_PATH[shape]} fill={skin} {...INK} />
      {front && <path d={front} fill={hair} opacity={buzz ? 0.8 : 1} {...INK} />}
      {(style === 'side-part' || style === 'bun') && <path d="M26 -34 q-2 -12 4 -20" fill="none" stroke={C.paper} strokeWidth="3" strokeLinecap="round" opacity=".45" />}
      <path d="M-32 -38 q8 -10 18 -13" fill="none" stroke={C.paper} strokeWidth="4" strokeLinecap="round" opacity=".35" />
      {/* 수염 (ADR-0019): 입 아래 턱을 두른다 — 입은 구멍 안에 남는다 */}
      {beard === 'full' && <path d={`M${-46 + dx} 20 Q${-40 + dx} 60 ${dx} 64 Q${40 + dx} 60 ${46 + dx} 20 Q${34 + dx} 44 ${dx} 46 Q${-34 + dx} 44 ${-46 + dx} 20 Z`} fill={hair} {...INK} />}
      {beard === 'stubble' && <path d={`M${-40 + dx} 30 Q${-30 + dx} 60 ${dx} 62 Q${30 + dx} 60 ${40 + dx} 30 Q${20 + dx} 46 ${dx} 46 Q${-20 + dx} 46 ${-40 + dx} 30 Z`} fill={hair} opacity=".28" />}
      {variant === 'friend' ? (
        <rect x="14" y="-34" width="18" height="6" rx="3" fill={FRIEND} transform="rotate(-16 23 -31)" />
      ) : style === 'bowl' && (
        <path d="M1 -55 q-6 -14 11 -12" fill="none" {...INK} />
      )}
      <g className={cheeksClass}>
        <ellipse cx={-38 + dx} cy={26 + fy} rx="10" ry="6" fill={C.coral} opacity=".38" />
        <ellipse cx={38 + dx} cy={26 + fy} rx="10" ry="6" fill={C.coral} opacity=".38" />
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
            <Eyes kind={look?.eyes ?? 'dot'} dx={dx} />
          )}
        </g>
      </g>
      <Brows kind={look?.brows ?? 'none'} dx={dx} />
      <Nose kind={look?.nose ?? 'none'} dx={dx} fy={fy} />
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
          <Mouth kind={look?.mouth ?? 'smile'} dx={dx} fy={fy} />
        )}
      </g>
      {beard === 'mustache' && <path d={`M${-17 + dx} 24 q8 -7 17 -1 q9 -6 17 1 q-8 7 -17 4 q-9 3 -17 -4 z`} fill={hair} {...INK3} />}
      {/* 안경: 눈 (±20, 12) r 7.5를 두른다 */}
      {glasses === 'round' && (
        <g fill={C.white} fillOpacity=".18" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round">
          <circle cx={-20 + dx} cy="12" r="14" /><circle cx={20 + dx} cy="12" r="14" />
          <path d={`M${-6 + dx} 11 h12 M${-34 + dx} 9 l-18 -5 M${34 + dx} 9 l18 -5`} fill="none" />
        </g>
      )}
      {glasses === 'square' && (
        <g fill={C.white} fillOpacity=".18" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x={-35 + dx} y="0" width="28" height="24" rx="6" /><rect x={7 + dx} y="0" width="28" height="24" rx="6" />
          <path d={`M${-7 + dx} 11 h14 M${-35 + dx} 9 l-17 -5 M${35 + dx} 9 l17 -5`} fill="none" />
        </g>
      )}
      {variant === 'friend' && (
        <>
          <path d="M18 60 l4 22 q1 6 7 5 l12 -4 q-8 -8 -8 -24 z" fill={FRIEND} {...INK} />
          <path d="M-44 40 Q0 64 44 40 Q46 56 40 62 Q0 78 -40 62 Q-46 56 -44 40 Z" fill={FRIEND} {...INK} />
        </>
      )}
    </>
  );
}

// ─── 얼굴 축 조각들 (실험) ─────────────────────────────────────────────────
/** 눈. 기준: 눈 중심 (±20, 12) */
function Eyes({ kind, dx }: { kind: NonNullable<Look['eyes']>; dx: number }) {
  if (kind === 'big') return (
    <>
      <circle cx={-20 + dx} cy="12" r="11" fill={C.ink} />
      <circle cx={20 + dx} cy="12" r="11" fill={C.ink} />
      <circle cx={-16 + dx} cy="8" r="4" fill={C.white} />
      <circle cx={24 + dx} cy="8" r="4" fill={C.white} />
      <circle cx={-24 + dx} cy="17" r="1.8" fill={C.white} />
      <circle cx={16 + dx} cy="17" r="1.8" fill={C.white} />
    </>
  );
  if (kind === 'narrow') return (
    <>
      <ellipse cx={-20 + dx} cy="13" rx="9" ry="4.5" fill={C.ink} />
      <ellipse cx={20 + dx} cy="13" rx="9" ry="4.5" fill={C.ink} />
      <circle cx={-17 + dx} cy="11.5" r="1.8" fill={C.white} />
      <circle cx={23 + dx} cy="11.5" r="1.8" fill={C.white} />
    </>
  );
  if (kind === 'sharp') {
    // 아몬드꼴, 바깥쪽 끝이 올라간다
    const almond = (cx: number, dir: number) => `M${cx + dir * 10} 9 Q${cx} 3 ${cx - dir * 9} 13 Q${cx} 21 ${cx + dir * 10} 9 Z`;
    return (
      <>
        <path d={almond(-20 + dx, -1)} fill={C.ink} />
        <path d={almond(20 + dx, 1)} fill={C.ink} />
        <circle cx={-18 + dx} cy="10" r="2" fill={C.white} />
        <circle cx={22 + dx} cy="10" r="2" fill={C.white} />
      </>
    );
  }
  return (
    <>
      <circle cx={-20 + dx} cy="12" r="7.5" fill={C.ink} />
      <circle cx={20 + dx} cy="12" r="7.5" fill={C.ink} />
      <circle cx={-17.4 + dx} cy="9.4" r="2.6" fill={C.white} />
      <circle cx={22.6 + dx} cy="9.4" r="2.6" fill={C.white} />
      <circle cx={-23 + dx} cy="15.5" r="1.3" fill={C.white} />
      <circle cx={17 + dx} cy="15.5" r="1.3" fill={C.white} />
    </>
  );
}

/** 눈썹. 눈 위 y≈-6 */
function Brows({ kind, dx }: { kind: NonNullable<Look['brows']>; dx: number }) {
  if (kind === 'none') return null;
  if (kind === 'angled') return (
    <g fill="none" stroke={C.ink} strokeWidth="4.5" strokeLinecap="round">
      <path d={`M${-31 + dx} -9 L${-10 + dx} -3`} /><path d={`M${31 + dx} -9 L${10 + dx} -3`} />
    </g>
  );
  return (
    <g fill="none" stroke={C.ink} strokeWidth={kind === 'thick' ? 6.5 : 3} strokeLinecap="round">
      <path d={`M${-30 + dx} -4 q10 -7 20 -3`} /><path d={`M${30 + dx} -4 q-10 -7 -20 -3`} />
    </g>
  );
}

/** 코. 눈(12)과 입(28) 사이 */
function Nose({ kind, dx, fy }: { kind: NonNullable<Look['nose']>; dx: number; fy: number }) {
  if (kind === 'none') return null;
  if (kind === 'big') return <path d={`M${-2 + dx} ${13 + fy / 2} q9 6 3 13 q-3 2 -7 0`} fill="none" {...INK3} />;
  return <path d={`M${1 + dx} ${17 + fy / 2} q4 4 0 7`} fill="none" {...INK3} />;
}

/** 입(기본 표정일 때만 — 다른 표정은 표정이 이긴다) */
function Mouth({ kind, dx, fy }: { kind: NonNullable<Look['mouth']>; dx: number; fy: number }) {
  if (kind === 'wide') return <path d={`M${-13 + dx} ${26 + fy} q13 12 26 0`} fill="none" {...INK} />;
  if (kind === 'flat') return <path d={`M${-8 + dx} ${29 + fy} h16`} fill="none" {...INK} />;
  return <path d={`M${-6 + dx} ${28 + fy} q6 6 12 0`} fill="none" {...INK} />;
}

/** Small body (coral shirt, two stubby arms, two feet) around (0,0) = shirt centre. Static — used by <use>. */
export function BodyStub({ look }: { look?: Look } = {}) {
  const bw = BUILD_HALF[look?.build ?? 'normal'];
  return (
    <>
      <ellipse cx="-22" cy="26" rx="12" ry="7" fill={C.skin} {...INK} />
      <ellipse cx="22" cy="26" rx="12" ry="7" fill={C.skin} {...INK} />
      <ellipse cx={-(bw + 4)} cy="0" rx="8" ry="14" fill={C.skin} {...INK} transform={`rotate(24 ${-(bw + 4)} 0)`} />
      <ellipse cx={bw + 4} cy="0" rx="8" ry="14" fill={C.skin} {...INK} transform={`rotate(-24 ${bw + 4} 0)`} />
      <path d={bodyPath(0, -6, bw)} fill={C.top} {...INK} />
    </>
  );
}

/** 체형: 몸통 반폭 (몸통 = 둥근 사각형, 팔은 그 바깥에 붙는다) */
export const BUILD_HALF: Record<NonNullable<Look['build']>, number> = { slim: 25, normal: 32, wide: 41 };
/** 몸통 둥근 사각형 — (cx, top y)에서 반폭 bw, 높이 38, 모서리 14 */
export function bodyPath(cx: number, top: number, bw: number): string {
  return `M${cx - bw} ${top + 14} a14 14 0 0 1 14 -14 h${2 * bw - 28} a14 14 0 0 1 14 14 v10 a14 14 0 0 1 -14 14 H${cx - bw + 14} a14 14 0 0 1 -14 -14z`;
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
