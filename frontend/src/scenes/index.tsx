// ─── Generic place scenes ────────────────────────────────────────────────────
// One warm 2-layer illustration per place type (back wall/sky + floor) with 2–3 subtly looping props.
// The character (350px) is layered on top by ActivityScreen at x 20..370, y 140..490 (feet ≈ 455),
// so props live at the sides, above y≈150, or in front (y > 480). viewBox = the 390×844 stage.
import type { CSSProperties, ReactNode } from 'react';
import type { PlaceType } from '../sim/types';
import './scenes.css';

export type SceneType = 'cafe' | 'restaurant' | 'park' | 'river' | 'beach' | 'gym' | 'library' | 'mall' | 'museum' | 'home';

export const SCENE_TYPES: SceneType[] = ['cafe', 'restaurant', 'park', 'river', 'beach', 'gym', 'library', 'mall', 'museum', 'home'];

export const SCENE_LABEL: Record<SceneType, string> = {
  cafe: '카페', restaurant: '식당', park: '공원', river: '강변', beach: '해변', gym: '헬스장', library: '도서관', mall: '쇼핑몰', museum: '박물관', home: '집',
};

const MAP: Partial<Record<PlaceType, SceneType>> = {
  home: 'home', friend_home: 'home', hotel: 'home',
  cafe: 'cafe',
  restaurant: 'restaurant', bar: 'restaurant', market: 'restaurant',
  park: 'park', mountain: 'park', island: 'park',
  river: 'river',
  beach: 'beach',
  gym: 'gym', stadium: 'gym',
  library: 'library', school: 'library', office: 'library',
  mall: 'mall', arcade: 'mall', cinema: 'mall', station: 'mall', airport: 'mall', port: 'mall',
  museum: 'museum', temple: 'museum',
};

/** Which generic scene a place type uses (default: park). */
export const sceneTypeFor = (t: PlaceType | SceneType): SceneType =>
  (SCENE_TYPES as string[]).includes(t) ? (t as SceneType) : MAP[t as PlaceType] ?? 'park';

export interface SceneProps {
  type: PlaceType | SceneType;
  className?: string;
  style?: CSSProperties;
  /** hide the props that live under the top-left speech bubble (timetable-over-scene): tagged `.sc-top` */
  hush?: boolean;
}

/** Full-bleed generic scene. */
export function Scene({ type, className = '', style, hush }: SceneProps) {
  const t = sceneTypeFor(type);
  const Body = SCENES[t];
  return (
    <svg className={`scene scene--${t} ${hush ? 'scene--hush' : ''} ${className}`} style={style} viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <Body />
    </svg>
  );
}

// ─── shared parts ───────────────────────────────────────────────────────────

function Grad({ id, a, b, horizontal }: { id: string; a: string; b: string; horizontal?: boolean }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
      <stop offset="0" className={a} />
      <stop offset="1" className={b} />
    </linearGradient>
  );
}

function Cloud({ x, y, s = 1, className = '' }: { x: number; y: number; s?: number; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className={className}>
        <ellipse cx="0" cy="0" rx="34" ry="16" className="f-card" />
        <ellipse cx="-16" cy="-8" rx="18" ry="14" className="f-card" />
        <ellipse cx="12" cy="-10" rx="22" ry="16" className="f-card" />
      </g>
    </g>
  );
}

function Sun({ x, y, r = 28 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r + 14} className="f-sun" opacity=".22" />
      <circle r={r} className="f-sun s-ink" />
      <path d="M-9 4q9 8 18 0" className="s-ink f-none" />
      <circle cx="-9" cy="-4" r="2.4" className="f-ink" /><circle cx="9" cy="-4" r="2.4" className="f-ink" />
    </g>
  );
}

function Steam({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path className="an-steam s-ink2 f-none" d="M-8 0c-4-6 4-8 0-14" opacity=".55" />
      <path className="an-steam d1 s-ink2 f-none" d="M0 0c-4-6 4-8 0-14" opacity=".55" />
      <path className="an-steam d2 s-ink2 f-none" d="M8 0c-4-6 4-8 0-14" opacity=".55" />
    </g>
  );
}

function Cup({ x, y, color = 'f-coral' }: { x: number; y: number; color?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-16 0h32l-4 24h-24z" className={`${color} s-ink`} />
      <path d="M16 4h6a7 7 0 0 1 0 14h-6" className="s-ink f-none" />
      <Steam x={0} y={-4} />
    </g>
  );
}

function Plant({ x, y, s = 1, pot = 'f-coral' }: { x: number; y: number; s?: number; pot?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className="an-swayb">
        <path d="M0 0c-26-24-30-58-6-70" className="s-ink f-none" />
        <path d="M0 0c10-30 34-50 44-52" className="s-ink f-none" />
        <path d="M0 0c-2-32 10-64 18-74" className="s-ink f-none" />
        <ellipse cx="-14" cy="-60" rx="12" ry="20" className="f-leaf s-ink" transform="rotate(-30 -14 -60)" />
        <ellipse cx="42" cy="-46" rx="11" ry="18" className="f-leaf s-ink" transform="rotate(55 42 -46)" />
        <ellipse cx="16" cy="-72" rx="11" ry="20" className="f-leaf s-ink" transform="rotate(8 16 -72)" />
      </g>
      <path d="M-22 0h44l-6 34h-32z" className={`${pot} s-ink`} />
      <rect x="-26" y="-6" width="52" height="12" rx="4" className={`${pot} s-ink`} />
    </g>
  );
}

function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-9" y="-40" width="18" height="50" rx="5" className="f-wood2 s-ink" />
      <circle cx="0" cy="-70" r="46" className="f-leaf s-ink" />
      <circle cx="-26" cy="-52" r="28" className="f-leaf s-ink" />
      <circle cx="28" cy="-56" r="30" className="f-leaf s-ink" />
      <circle cx="-8" cy="-84" r="16" className="f-grass" />
      <circle cx="22" cy="-64" r="8" className="f-grass" />
    </g>
  );
}

function Window({ x, y, w = 118, h = 150, curtain }: { x: number; y: number; w?: number; h?: number; curtain?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx="12" className="f-sky s-ink" />
      <Cloud x={w * 0.35} y={h * 0.32} s={0.55} />
      <path d={`M${w / 2} 0v${h}M0 ${h / 2}h${w}`} className="s-ink2" opacity=".7" />
      <rect x="-6" y={h - 4} width={w + 12} height="10" rx="4" className="f-card s-ink" />
      {curtain && (
        <>
          <path d={`M-4 -4h22c8 30 8 60 -6 ${h * 0.6}c-6 -20 -14 -40 -16 -60z`} className={`${curtain} s-ink`} />
          <path d={`M${w + 4} -4h-22c-8 30 -8 60 6 ${h * 0.6}c6 -20 14 -40 16 -60z`} className={`${curtain} s-ink`} />
        </>
      )}
    </g>
  );
}

function Floor({ y, className, boards }: { y: number; className: string; boards?: boolean }) {
  return (
    <g>
      <rect x="0" y={y} width="390" height={844 - y} className={className} />
      <path d={`M0 ${y}h390`} className="s-ink" opacity=".35" />
      {boards && <path d={`M0 ${y + 70}h390M0 ${y + 140}h390M0 ${y + 210}h390M0 ${y + 280}h390`} className="s-wood2" opacity=".55" />}
    </g>
  );
}

function BookRow({ x, y, w, colors }: { x: number; y: number; w: number; colors: string[] }) {
  const items: ReactNode[] = [];
  let cx = 0; let i = 0;
  while (cx < w - 8) {
    const bw = 10 + ((i * 7) % 9);
    const bh = 30 + ((i * 11) % 14);
    items.push(<rect key={i} x={x + cx} y={y - bh} width={bw} height={bh} rx="2" className={`${colors[i % colors.length]} s-ink2`} />);
    cx += bw + 2; i++;
  }
  return <g>{items}</g>;
}

// ─── scenes ─────────────────────────────────────────────────────────────────

function Cafe() {
  return (
    <>
      <defs><Grad id="sc-cafe-wall" a="st-sun2" b="st-paper2" /></defs>
      <rect width="390" height="844" fill="url(#sc-cafe-wall)" />
      <rect x="0" y="392" width="390" height="58" className="f-cream" />
      <path d="M0 392h390" className="s-ink2" opacity=".3" />
      <Window x={34} y={172} curtain="f-coral2" />
      <Window x={238} y={172} curtain="f-coral2" />
      {/* menu board (between the windows, clear of the place tag; hidden under the timetable bubble) */}
      <g className="sc-top" transform="translate(196 94)">
        <rect width="70" height="56" rx="8" className="f-ink" />
        <text x="35" y="24" textAnchor="middle" fontFamily="Jua" fontSize="14" fill="#FFF6E6">MENU</text>
        <path d="M14 36h42M14 44h30" stroke="#FFF6E6" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
      </g>
      {/* pendant lamp (x 304: clear of the top-right book button and the menu board) */}
      <g className="sc-top" transform="translate(304 0)"><g className="an-sway">
        <path d="M0 0v104" className="s-ink f-none" />
        <path d="M-26 132l8-30h36l8 30z" className="f-coral s-ink" />
        <circle cx="0" cy="130" r="9" className="f-sun s-ink2" />
        <circle cx="0" cy="134" r="22" className="f-sun an-glow" opacity=".4" />
      </g></g>
      <Floor y={450} className="f-wood" boards />
      {/* counter (front right) */}
      <g transform="translate(246 466)">
        <rect x="-4" y="0" width="150" height="20" rx="6" className="f-wood2 s-ink" />
        <rect x="4" y="20" width="134" height="120" rx="8" className="f-card s-ink" />
        <path d="M22 44h98M22 64h98M22 84h98" className="s-line" />
        <g transform="translate(96 -50)">
          <rect x="-24" y="0" width="48" height="50" rx="8" className="f-ink" />
          <rect x="-16" y="10" width="32" height="12" rx="4" className="f-paper" />
          <circle cx="0" cy="34" r="4" className="f-sun an-blink" />
        </g>
        <Cup x={36} y={-26} color="f-paper" />
      </g>
      {/* rug across the middle of the floor (fills the band between the character and the status card; y 608..692) */}
      <g transform="translate(190 650)">
        <ellipse cx="0" cy="0" rx="162" ry="42" className="f-paper2 s-ink2" />
        <ellipse cx="0" cy="0" rx="140" ry="28" className="f-none s-coral" strokeDasharray="9 9" opacity=".8" />
        <circle cx="-96" cy="-2" r="4" className="f-mint" /><circle cx="96" cy="-2" r="4" className="f-mint" />
        <circle cx="-48" cy="12" r="3" className="f-sun" /><circle cx="48" cy="12" r="3" className="f-sun" />
        <circle cx="0" cy="-12" r="3" className="f-sun" />
      </g>
      {/* little round table, centred in front of the character (the seat is on the rug's left edge) */}
      <g transform="translate(182 536)">
        <rect x="-6" y="0" width="12" height="80" className="f-wood2 s-ink" />
        <rect x="-38" y="74" width="76" height="12" rx="6" className="f-wood2 s-ink" />
        <ellipse cx="0" cy="0" rx="64" ry="16" className="f-wood s-ink" />
        <Cup x={-12} y={-24} />
        <rect x="16" y="-16" width="30" height="8" rx="3" className="f-mint s-ink2" />
        <circle cx="31" cy="-19" r="4" className="f-sun s-ink2" />
      </g>
      {/* stool */}
      <g transform="translate(66 566)">
        <path d="M-14 8l-6 48M14 8l6 48" className="s-ink" />
        <path d="M-18 40h36" className="s-ink" opacity=".5" />
        <ellipse cx="0" cy="8" rx="28" ry="10" className="f-wood2 s-ink" />
        <ellipse cx="0" cy="0" rx="28" ry="10" className="f-coral s-ink" />
      </g>
      <Plant x={40} y={420} s={0.9} />
    </>
  );
}

function Restaurant() {
  return (
    <>
      <defs>
        <Grad id="sc-rest-wall" a="st-coral3" b="st-coral2" />
        <pattern id="sc-rest-tile" width="44" height="44" patternUnits="userSpaceOnUse">
          <rect width="22" height="22" className="f-cream" /><rect x="22" y="22" width="22" height="22" className="f-cream" />
          <rect x="22" width="22" height="22" className="f-paper" /><rect y="22" width="22" height="22" className="f-paper" />
        </pattern>
      </defs>
      <rect width="390" height="844" fill="url(#sc-rest-wall)" />
      <rect x="0" y="380" width="390" height="70" className="f-paper2" />
      <path d="M0 380h390" className="s-ink2" opacity=".3" />
      <Window x={30} y={176} w={110} h={140} curtain="f-sun" />
      <Window x={250} y={176} w={110} h={140} curtain="f-sun" />
      {/* open sign (between the windows, clear of the lantern and the place tag) */}
      <g className="sc-top" transform="translate(206 92)">
        <rect width="70" height="44" rx="10" className="f-sun s-ink" />
        <text x="35" y="29" textAnchor="middle" fontFamily="Jua" fontSize="18" fill="#2A2118">OPEN</text>
        <circle cx="8" cy="8" r="3" className="f-coral an-blink" />
      </g>
      {/* paper lantern (x 304: clear of the centre clock and the book button) */}
      <g transform="translate(304 0)"><g className="an-sway">
        <path d="M0 0v58" className="s-ink f-none" />
        <ellipse cx="0" cy="92" rx="30" ry="34" className="f-coral s-ink" />
        <path d="M-28 82h56M-30 96h60M-24 110h48" className="s-ink2 f-none" opacity=".5" />
        <rect x="-8" y="124" width="16" height="8" rx="3" className="f-sun s-ink2" />
      </g></g>
      {/* framed fish */}
      <g transform="translate(22 124) scale(.85)">
        <rect width="80" height="56" rx="6" className="f-card s-ink" />
        <rect x="8" y="8" width="64" height="40" rx="4" className="f-sky" />
        <path d="M22 28c10-12 26-12 36 0-10 12-26 12-36 0z" className="f-coral s-ink2" />
        <path d="M58 28l10-8v16z" className="f-coral s-ink2" />
        <circle cx="28" cy="26" r="2" className="f-ink" />
      </g>
      <rect x="0" y="450" width="390" height="394" fill="url(#sc-rest-tile)" />
      <path d="M0 450h390" className="s-ink" opacity=".35" />
      {/* dining table (front centre) */}
      <g transform="translate(195 520)">
        <rect x="-8" y="0" width="16" height="90" className="f-wood2 s-ink" />
        <rect x="-50" y="84" width="100" height="12" rx="6" className="f-wood2 s-ink" />
        <ellipse cx="0" cy="0" rx="110" ry="24" className="f-wood s-ink" />
        <ellipse cx="0" cy="-4" rx="92" ry="16" className="f-card" opacity=".7" />
        <g transform="translate(-30 -12)">
          <path d="M-26 0h52l-6 22h-40z" className="f-card s-ink" />
          <path d="M-24 0h48" className="s-coral" />
          <path d="M-14 -4h28" className="s-ink f-none" />
          <Steam x={0} y={-6} />
        </g>
        <g transform="translate(46 -6)">
          <ellipse rx="26" ry="10" className="f-card s-ink" />
          <circle cx="-6" cy="-2" r="6" className="f-leaf s-ink2" /><circle cx="8" cy="-1" r="5" className="f-coral s-ink2" />
        </g>
        <path d="M-84 -6l14 -22M-78 -6l14 -22" className="s-ink f-none" />
      </g>
      <Plant x={352} y={430} s={0.85} pot="f-mint" />
    </>
  );
}

function Park() {
  return (
    <>
      <defs><Grad id="sc-park-sky" a="st-sky" b="st-sky2" /></defs>
      <rect width="390" height="844" fill="url(#sc-park-sky)" />
      <Sun x={322} y={160} r={26} />
      <Cloud x={0} y={168} s={1} className="an-drift" />
      <Cloud x={0} y={236} s={0.7} className="an-drift d1" />
      <path d="M-20 400c60-60 140-70 220-30s130 20 190-20v80h-410z" className="f-grass2" />
      <path d="M-20 440c80-40 180-50 260-14s110 20 150-6v440h-410z" className="f-grass" />
      <Tree x={58} y={430} s={1} />
      <Tree x={352} y={430} s={0.85} />
      {/* bench (front) */}
      <g transform="translate(195 540)">
        <rect x="-90" y="-2" width="180" height="14" rx="6" className="f-wood s-ink" />
        <rect x="-90" y="-30" width="180" height="12" rx="6" className="f-wood s-ink" />
        <path d="M-74 12v40M74 12v40M-74 -30v10M74 -30v10" className="s-ink f-none" />
      </g>
      {/* flowers */}
      {[[40, 640], [96, 690], [300, 660], [352, 620], [250, 720]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path d="M0 0v-18" className="s-ink2 f-none" />
          <circle cy="-22" r="7" className={i % 3 === 0 ? 'f-coral s-ink2' : i % 3 === 1 ? 'f-sun s-ink2' : 'f-sky s-ink2'} />
          <circle cy="-22" r="2.5" className="f-paper" />
        </g>
      ))}
      {/* falling leaves */}
      <g transform="translate(60 330)"><path className="an-leaf f-leaf s-ink2" d="M0 0c8-10 18-8 20 2-8 8-18 6-20-2z" /></g>
      <g transform="translate(340 320)"><path className="an-leaf d1 f-sun s-ink2" d="M0 0c8-10 18-8 20 2-8 8-18 6-20-2z" /></g>
      <g transform="translate(110 300)"><path className="an-leaf d2 f-coral s-ink2" d="M0 0c8-10 18-8 20 2-8 8-18 6-20-2z" /></g>
    </>
  );
}

function River() {
  return (
    <>
      <defs><Grad id="sc-river-sky" a="st-sky" b="st-sky2" /></defs>
      <rect width="390" height="844" fill="url(#sc-river-sky)" />
      <Sun x={70} y={150} r={24} />
      <Cloud x={0} y={200} s={0.8} className="an-drift" />
      {/* far bank + tiny trees */}
      <path d="M0 300h390v44H0z" className="f-grass2" />
      <path d="M0 300c60-30 120-30 190-10s130 10 200-14v24H0z" className="f-grass2" />
      {[30, 90, 150, 230, 290].map((x, i) => <circle key={i} cx={x} cy={296 - (i % 2) * 8} r={12 + (i % 2) * 4} className="f-leaf s-ink2" />)}
      {/* bridge */}
      <g transform="translate(250 300)">
        <path d="M0 42V14c40-30 100-30 140 0v28" className="f-stone s-ink" />
        <path d="M14 42V26c30-22 82-22 112 0v16" className="f-sky s-ink2" />
        <path d="M0 6h140" className="s-ink f-none" />
        <path d="M18 6v-14M52 6v-14M86 6v-14M120 6v-14" className="s-ink2 f-none" />
      </g>
      {/* river */}
      <rect x="0" y="344" width="390" height="92" className="f-water" />
      <path d="M0 344h390" className="s-ink" opacity=".3" />
      <g opacity=".9">
        <path className="an-wave s-paper f-none" d="M-60 372q15-8 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0" />
        <path className="an-wave d1 s-water f-none" d="M-60 400q15-8 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0" />
        <path className="an-wave d2 s-paper f-none" d="M-60 422q15-8 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0" opacity=".6" />
      </g>
      {/* duck */}
      <g transform="translate(322 388)"><g className="an-duck">
        <ellipse rx="18" ry="11" className="f-paper s-ink" />
        <circle cx="12" cy="-12" r="9" className="f-paper s-ink" />
        <path d="M20 -11l10 3-10 3z" className="f-sun s-ink2" />
        <circle cx="14" cy="-14" r="1.8" className="f-ink" />
      </g></g>
      {/* near bank */}
      <path d="M0 436h390v408H0z" className="f-grass" />
      <path d="M0 436h390" className="s-ink" opacity=".35" />
      <g transform="translate(46 436)"><g className="an-swayb">
        <path d="M0 0c-4-30 2-60 6-80M10 0c0-30 8-56 16-72M-10 0c-8-24-8-50-4-66" className="s-mint f-none" />
        <ellipse cx="6" cy="-78" rx="5" ry="12" className="f-wood2 s-ink2" />
      </g></g>
      {/* picnic mat + basket */}
      <g transform="translate(120 590)">
        <path d="M-90 0l30-40h120l30 40z" className="f-coral2 s-ink" />
        <path d="M-40 -40l-16 40M0 -40v40M40 -40l16 40M-72 -16h144" className="s-coral f-none" opacity=".7" />
        <g transform="translate(70 -30)">
          <rect x="-22" y="-8" width="44" height="30" rx="6" className="f-wood s-ink" />
          <path d="M-14 -8a14 14 0 0 1 28 0" className="s-ink f-none" />
          <path d="M-12 8h24" className="s-ink2 f-none" opacity=".5" />
        </g>
      </g>
      <path d="M290 700c30-20 60-10 100 0" className="s-line f-none" />
    </>
  );
}

function Beach() {
  return (
    <>
      <defs><Grad id="sc-beach-sky" a="st-sky" b="st-paper" /></defs>
      <rect width="390" height="844" fill="url(#sc-beach-sky)" />
      <Sun x={310} y={162} r={30} />
      <Cloud x={0} y={190} s={0.75} className="an-drift d1" />
      <g className="an-fly"><path d="M0 0q8-10 16 0q8-10 16 0" className="s-ink2 f-none" transform="translate(0 150)" /></g>
      <g className="an-fly d1"><path d="M0 0q7-8 14 0q7-8 14 0" className="s-ink2 f-none" transform="translate(0 210)" /></g>
      {/* sea */}
      <rect x="0" y="290" width="390" height="114" className="f-water" />
      <path d="M0 290h390" className="s-ink" opacity=".25" />
      <g>
        <path className="an-wave s-paper f-none" d="M-60 316q15-8 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0" opacity=".9" />
        <path className="an-wave d1 s-water f-none" d="M-60 350q15-8 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0" />
        <path className="an-wave d2 s-paper f-none" d="M-60 386q15-8 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0" opacity=".8" />
      </g>
      {/* sand */}
      <path d="M0 404h390v440H0z" className="f-sand" />
      <path className="an-wave s-card f-none" d="M-60 410q15-10 30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0t30 0" strokeWidth="6" />
      {/* parasol (left) */}
      <g transform="translate(66 250)">
        <path d="M0 0v260" className="s-ink f-none" />
        <path d="M-70 10a70 70 0 0 1 140 0z" className="f-coral s-ink" />
        <path d="M-42 10a42 42 0 0 1 28-64M-14 10a14 14 0 0 1 28-64M14 10a42 42 0 0 1 28-64" className="s-paper f-none" strokeWidth="9" />
        <path d="M-70 10a70 70 0 0 1 140 0z" className="s-ink f-none" />
      </g>
      {/* beach ball */}
      <g transform="translate(320 600)"><g className="an-bob">
        <circle r="30" className="f-paper s-ink" />
        <path d="M0 -30a30 30 0 0 1 0 60a14 30 0 0 1 0-60" className="f-coral" />
        <path d="M0 -30a14 30 0 0 0 0 60a30 30 0 0 0 0-60" className="f-sky" transform="scale(-1 1)" />
        <circle r="30" className="s-ink f-none" />
      </g></g>
      {/* starfish + shell */}
      <g transform="translate(100 660)"><path d="M0 -22l6 14 16 1-12 10 4 16-14-9-14 9 4-16-12-10 16-1z" className="f-coral s-ink" /><circle cx="-4" cy="-2" r="1.6" className="f-ink" /><circle cx="4" cy="-2" r="1.6" className="f-ink" /></g>
      <g transform="translate(178 612)"><path d="M-14 6a14 14 0 0 1 28 0z" className="f-paper s-ink2" /><path d="M-6 6l6-12M0 6v-13M6 6l-6-12" className="s-ink2 f-none" opacity=".5" /></g>
      <g transform="translate(300 720)"><ellipse rx="26" ry="8" className="f-cream s-ink2" /><rect x="-14" y="-30" width="28" height="24" rx="3" className="f-sun s-ink2" /><rect x="-20" y="-40" width="40" height="12" rx="3" className="f-sun s-ink2" /></g>
    </>
  );
}

function Gym() {
  return (
    <>
      <rect width="390" height="844" className="f-mint2" />
      {/* mirror band */}
      <rect x="0" y="130" width="390" height="210" className="f-sky2" />
      <path d="M0 130h390M0 340h390" className="s-ink" opacity=".35" />
      <path d="M40 150l40 170M300 150l40 170" className="s-card f-none" strokeWidth="8" opacity=".8" />
      <path d="M0 348h390" className="s-ink4 f-none" />
      {/* sign */}
      <g transform="translate(252 82)">
        <rect width="118" height="40" rx="10" className="f-sun s-ink" />
        <text x="59" y="27" textAnchor="middle" fontFamily="Jua" fontSize="18" fill="#2A2118">GYM · 오늘도</text>
      </g>
      {/* clock */}
      <g className="sc-top" transform="translate(60 100)">
        <circle r="20" className="f-card s-ink" />
        <path d="M0 0v-12M0 0l8 4" className="s-ink f-none" />
        <circle r="2" className="f-ink" />
      </g>
      {/* court floor (line 30px above the character's feet so it clearly stands on the boards) */}
      <Floor y={420} className="f-wood" boards />
      <path d="M0 470h390" className="s-coral f-none" strokeWidth="4" />
      <path d="M195 470a60 60 0 0 0 0 120a60 60 0 0 0 0-120" className="s-coral f-none" strokeWidth="4" opacity=".7" />
      {/* dumbbell rack (front right) */}
      <g transform="translate(262 500)">
        <rect x="0" y="0" width="120" height="12" rx="4" className="f-ink" />
        <rect x="0" y="50" width="120" height="12" rx="4" className="f-ink" />
        <path d="M8 12v38M112 12v38M8 62v40M112 62v40" className="s-ink4 f-none" />
        {[[22, 'f-coral'], [60, 'f-sun'], [98, 'f-sky']].map(([x, c], i) => (
          <g key={i} transform={`translate(${x} -8)`}>
            <rect x="-14" y="-6" width="10" height="16" rx="3" className={`${c} s-ink2`} />
            <rect x="4" y="-6" width="10" height="16" rx="3" className={`${c} s-ink2`} />
            <path d="M-4 2h8" className="s-ink f-none" />
          </g>
        ))}
        {[[22, 'f-mint'], [60, 'f-coral'], [98, 'f-sun']].map(([x, c], i) => (
          <g key={i} transform={`translate(${x} 42)`}>
            <rect x="-14" y="-6" width="10" height="16" rx="3" className={`${c} s-ink2`} />
            <rect x="4" y="-6" width="10" height="16" rx="3" className={`${c} s-ink2`} />
            <path d="M-4 2h8" className="s-ink f-none" />
          </g>
        ))}
      </g>
      {/* yoga ball */}
      <g transform="translate(84 610)"><g className="an-bounce">
        <circle r="44" className="f-mint s-ink" />
        <path d="M-20 -26a30 30 0 0 1 36-6" className="s-paper f-none" strokeWidth="5" opacity=".8" />
      </g></g>
      <ellipse cx="84" cy="616" rx="40" ry="6" className="f-ink" opacity=".12" />
      {/* bottle + towel */}
      <g transform="translate(170 620)">
        <rect x="-8" y="-40" width="16" height="44" rx="6" className="f-sky s-ink" />
        <rect x="-5" y="-48" width="10" height="10" rx="3" className="f-coral s-ink2" />
        <path d="M20 -6c20-10 40 6 60-4v14c-20 10-40-6-60 4z" className="f-card s-ink" />
      </g>
    </>
  );
}

function Library() {
  return (
    <>
      <defs><Grad id="sc-lib-wall" a="st-sun2" b="st-paper2" /></defs>
      <rect width="390" height="844" fill="url(#sc-lib-wall)" />
      {/* shelves */}
      {[[18, 100], [268, 100]].map(([x, y], k) => (
        <g key={k} transform={`translate(${x} ${y})`}>
          <rect width="104" height="356" rx="8" className="f-wood s-ink" />
          {[70, 140, 210, 280, 350].map((yy, i) => <path key={i} d={`M0 ${yy}h104`} className="s-ink f-none" />)}
          <BookRow x={6} y={66} w={92} colors={['f-coral', 'f-sky', 'f-sun', 'f-mint', 'f-paper']} />
          <BookRow x={6} y={136} w={92} colors={['f-mint', 'f-paper', 'f-coral', 'f-sun']} />
          <BookRow x={6} y={206} w={92} colors={['f-sun', 'f-sky', 'f-paper', 'f-coral', 'f-mint']} />
          <BookRow x={6} y={276} w={92} colors={['f-paper', 'f-coral', 'f-sky']} />
          <BookRow x={6} y={346} w={92} colors={['f-sky', 'f-sun', 'f-mint', 'f-coral']} />
        </g>
      ))}
      {/* ladder */}
      <g transform="translate(346 130)">
        <path d="M0 0v320M22 0v320" className="s-ink f-none" />
        {[30, 80, 130, 180, 230, 280].map((y, i) => <path key={i} d={`M0 ${y}h22`} className="s-ink f-none" />)}
      </g>
      <Floor y={456} className="f-wood2" boards />
      {/* reading desk with lamp (front) */}
      <g transform="translate(195 528)">
        <rect x="-110" y="-4" width="220" height="16" rx="6" className="f-wood s-ink" />
        <path d="M-92 12v90M92 12v90" className="s-ink4 f-none" />
        <g transform="translate(60 -4)">
          <circle r="42" className="f-sun an-glow" opacity=".5" />
          <rect x="-4" y="-40" width="8" height="40" className="f-ink" />
          <path d="M-30 -36h60l-8-22h-44z" className="f-mint s-ink" />
          <ellipse cx="0" cy="0" rx="18" ry="5" className="f-ink" />
        </g>
        <g transform="translate(-50 -8)">
          <path d="M-36 0l36-6 36 6-36 8z" className="f-card s-ink" />
          <path d="M-36 0v6l36 8v-6zM36 0v6l-36 8v-6z" className="f-paper s-ink" />
          <path d="M-24 -1l24-4M-22 3l22-3" className="s-line f-none" />
        </g>
        <g transform="translate(-100 -14)">
          <rect x="0" y="0" width="44" height="10" rx="2" className="f-coral s-ink2" />
          <rect x="4" y="-10" width="40" height="10" rx="2" className="f-sky s-ink2" />
          <rect x="-2" y="-20" width="42" height="10" rx="2" className="f-sun s-ink2" />
        </g>
      </g>
      {/* dust motes */}
      <g transform="translate(150 420)"><circle className="an-mote f-paper" r="3" /></g>
      <g transform="translate(230 440)"><circle className="an-mote d1 f-paper" r="2.5" /></g>
      <g transform="translate(190 380)"><circle className="an-mote d2 f-sun" r="2.5" /></g>
    </>
  );
}

function Mall() {
  return (
    <>
      <rect width="390" height="844" className="f-sky2" />
      {/* glass roof */}
      <g>
        {[0, 78, 156, 234, 312].map((x, i) => <rect key={i} x={x} y="0" width="78" height="120" className="f-sky" opacity={i % 2 ? 0.55 : 0.35} />)}
        <path d="M0 120h390M78 0v120M156 0v120M234 0v120M312 0v120" className="s-card f-none" strokeWidth="6" />
        <path d="M0 122h390" className="s-ink" opacity=".3" />
      </g>
      {/* shop fronts */}
      {[[8, 'f-coral', 'BAKERY', 'f-sun'], [140, 'f-mint', 'TOYS', 'f-coral'], [272, 'f-sun', 'CAFE', 'f-mint']].map(([x, awn, name, sign], i) => (
        <g key={i} transform={`translate(${x} 150)`}>
          <rect width="110" height="300" rx="8" className="f-paper s-ink" />
          <rect x="12" y="70" width="86" height="150" rx="6" className="f-sky2 s-ink2" />
          <path d="M55 70v150" className="s-ink2 f-none" opacity=".5" />
          <rect x="6" y="230" width="98" height="70" rx="6" className="f-cream s-ink2" />
          <path d="M-4 40h118l-8 26H4z" className={`${awn as string} s-ink`} />
          <path d="M18 40l-2 26M40 40l-1 26M62 40v26M84 40l2 26" className="s-paper f-none" />
          <rect x="18" y="8" width="74" height="24" rx="6" className={`${sign as string} s-ink2 ${i === 1 ? 'an-glow' : ''}`} />
          <text x="55" y="25" textAnchor="middle" fontFamily="Jua" fontSize="12" fill="#2A2118">{name as string}</text>
        </g>
      ))}
      <Floor y={450} className="f-cream" />
      <path d="M0 520h390M0 600h390M0 690h390M0 790h390M60 450l-60 394M130 450l-40 394M260 450l40 394M330 450l60 394" className="s-line f-none" />
      {/* balloons on a stand (left) */}
      <g transform="translate(58 470)">
        <path d="M0 0v-170M0 0v-180" className="s-ink2 f-none" />
        <rect x="-16" y="0" width="32" height="10" rx="4" className="f-ink" />
        <g className="an-bob"><ellipse cx="-22" cy="-210" rx="20" ry="24" className="f-coral s-ink" /><path d="M-22 -186l-4 6h8z" className="f-coral s-ink2" /></g>
        <g className="an-bob d1"><ellipse cx="14" cy="-236" rx="20" ry="24" className="f-sun s-ink" /><path d="M14 -212l-4 6h8z" className="f-sun s-ink2" /></g>
        <g className="an-bob d2"><ellipse cx="26" cy="-192" rx="18" ry="22" className="f-sky s-ink" /><path d="M26 -170l-4 6h8z" className="f-sky s-ink2" /></g>
        <path d="M0 -180c-10-10-16-20-22-30M0 -180c6-16 10-28 14-40M0 -180c10-4 18-8 26-12" className="s-ink2 f-none" opacity=".6" />
      </g>
      {/* bench + bag (front) */}
      <g transform="translate(300 560)">
        <rect x="-70" y="0" width="140" height="14" rx="6" className="f-mint s-ink" />
        <path d="M-56 14v34M56 14v34" className="s-ink4 f-none" />
        <g transform="translate(-30 -40)">
          <path d="M-20 0h40l-4 42h-32z" className="f-coral s-ink" />
          <path d="M-10 0a10 12 0 0 1 20 0" className="s-ink f-none" />
          <circle cy="20" r="6" className="f-paper" />
        </g>
      </g>
    </>
  );
}

function Museum() {
  return (
    <>
      <rect width="390" height="844" className="f-paper2" />
      <rect x="0" y="380" width="390" height="70" className="f-cream" />
      <path d="M0 380h390" className="s-ink2" opacity=".35" />
      {/* paintings */}
      <g transform="translate(46 150)">
        <rect width="112" height="100" rx="4" className="f-sun s-ink4" />
        <rect x="10" y="10" width="92" height="80" className="f-sky" />
        <path d="M10 90l24-40 18 22 16-30 24 48z" className="f-mint s-ink2" />
        <circle cx="78" cy="30" r="9" className="f-sun s-ink2" />
      </g>
      <g transform="translate(232 150)">
        <rect width="112" height="100" rx="4" className="f-coral s-ink4" />
        <rect x="10" y="10" width="92" height="80" className="f-paper" />
        <circle cx="56" cy="50" r="24" className="f-coral2 s-ink2" />
        <circle cx="46" cy="44" r="3" className="f-ink" /><circle cx="66" cy="44" r="3" className="f-ink" />
        <path d="M46 58q10 8 20 0" className="s-ink2 f-none" />
      </g>
      <g className="sc-top" transform="translate(196 86)">
        <rect width="70" height="52" rx="4" className="f-mint s-ink" />
        <rect x="8" y="8" width="54" height="36" className="f-paper" />
        <path d="M18 36l12-18 10 12 8-8 8 14z" className="f-night2" />
      </g>
      {/* spotlight */}
      <g transform="translate(292 66)">
        <rect x="-12" y="0" width="24" height="14" rx="4" className="f-ink" />
        <path d="M-6 14L-64 190H52z" className="f-sun an-glow" opacity=".5" />
      </g>
      {/* banner */}
      <g transform="translate(356 60)"><g className="an-sway d1">
        <path d="M0 0v10" className="s-ink f-none" />
        <path d="M-16 10h32v190l-16-14-16 14z" className="f-mint s-ink" />
        <text x="0" y="60" textAnchor="middle" fontFamily="Jua" fontSize="14" fill="#2A2118" writingMode="vertical-rl">특별전</text>
      </g></g>
      <Floor y={450} className="f-stone" />
      <rect x="0" y="450" width="390" height="394" className="f-paper" opacity=".35" />
      {/* pedestal + vase (front left) */}
      <g transform="translate(86 520)">
        <rect x="-40" y="0" width="80" height="110" rx="4" className="f-card s-ink" />
        <rect x="-46" y="-8" width="92" height="12" rx="3" className="f-card s-ink" />
        <path d="M-16 -8c-8-20-8-40 0-52h32c8 12 8 32 0 52z" className="f-coral s-ink" />
        <path d="M-12 -30h24" className="s-paper f-none" />
      </g>
      {/* rope posts (front right) */}
      <g transform="translate(240 560)">
        <path d="M0 0c40 26 100 26 140 0" className="s-coral f-none" strokeWidth="5" />
        {[0, 140].map((x, i) => (
          <g key={i} transform={`translate(${x} 0)`}>
            <rect x="-5" y="-4" width="10" height="70" className="f-sun s-ink2" />
            <circle r="8" className="f-sun s-ink" />
            <ellipse cy="70" rx="22" ry="6" className="f-sun s-ink2" />
          </g>
        ))}
      </g>
    </>
  );
}

function Home() {
  return (
    <>
      <defs><Grad id="sc-home-wall" a="st-sun2" b="st-paper2" /></defs>
      <rect width="390" height="844" fill="url(#sc-home-wall)" />
      <g opacity=".35">
        {[[40, 80], [120, 60], [330, 100], [60, 300], [340, 330], [200, 110]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" className="f-card" />)}
      </g>
      <Window x={236} y={124} w={118} h={140} curtain="f-coral2" />
      {/* wall clock with pendulum */}
      <g transform="translate(70 152)">
        <rect x="-26" y="-28" width="52" height="96" rx="8" className="f-wood s-ink" />
        <circle r="18" className="f-card s-ink" />
        <path d="M0 0v-11M0 0l7 5" className="s-ink f-none" />
        <circle r="2" className="f-ink" />
        <g transform="translate(0 22)"><g className="an-swing">
          <path d="M0 0v34" className="s-ink f-none" />
          <circle cy="38" r="7" className="f-sun s-ink" />
        </g></g>
      </g>
      {/* shelf with frame */}
      <g transform="translate(104 272)">
        <rect x="-50" y="0" width="100" height="8" rx="3" className="f-wood s-ink2" />
        <rect x="-36" y="-40" width="34" height="40" rx="3" className="f-sun s-ink2" />
        <circle cx="-19" cy="-22" r="9" className="f-skin s-ink2" />
        <rect x="8" y="-30" width="30" height="30" rx="4" className="f-mint s-ink2" />
        <path d="M14 -14h18M14 -8h12" className="s-ink2 f-none" opacity=".6" />
      </g>
      <Floor y={450} className="f-wood" boards />
      {/* rug */}
      <ellipse cx="195" cy="640" rx="150" ry="46" className="f-coral2 s-ink" />
      <ellipse cx="195" cy="640" rx="110" ry="30" className="f-paper s-ink2" />
      <ellipse cx="195" cy="640" rx="60" ry="15" className="f-coral2 s-ink2" />
      {/* sofa + cat (front right) */}
      <g transform="translate(320 520)">
        <rect x="-70" y="-30" width="140" height="70" rx="14" className="f-mint s-ink" />
        <rect x="-74" y="-40" width="18" height="80" rx="8" className="f-mint s-ink" />
        <rect x="56" y="-40" width="18" height="80" rx="8" className="f-mint s-ink" />
        <rect x="-56" y="0" width="112" height="24" rx="8" className="f-mint2 s-ink2" />
        <g transform="translate(-6 -20)">
          <g className="an-tail"><path d="M18 8c16 0 24-14 18-26" className="s-ink4 f-none" /><path d="M18 8c16 0 24-14 18-26" className="s-ink2 f-none" style={{ stroke: 'var(--ink-3)' }} /></g>
          <ellipse cx="0" cy="8" rx="24" ry="13" className="f-ink3 s-ink" />
          <circle cx="-18" cy="-2" r="12" className="f-ink3 s-ink" />
          <path d="M-28 -10l-2-10 8 5zM-8 -10l2-10-8 5z" className="f-ink3 s-ink2" />
          <path d="M-22 -2q2 3 4 0M-16 -2q2 3 4 0" className="s-ink2 f-none" />
          <circle cx="-18" cy="3" r="1.6" className="f-coral" />
        </g>
      </g>
      {/* side table with mug + lamp (front left) */}
      <g transform="translate(76 560)">
        <rect x="-44" y="0" width="88" height="12" rx="4" className="f-wood2 s-ink" />
        <path d="M-32 12v70M32 12v70" className="s-ink4 f-none" />
        <Cup x={-12} y={-24} color="f-sky" />
        <g transform="translate(22 -8)">
          <rect x="-3" y="-30" width="6" height="30" className="f-ink" />
          <path d="M-20 -30h40l-6-22h-28z" className="f-sun s-ink" />
          <circle cy="-36" r="22" className="f-sun an-glow" opacity=".35" />
        </g>
      </g>
      <Plant x={40} y={430} s={0.8} pot="f-sky" />
    </>
  );
}

const SCENES: Record<SceneType, () => ReactNode> = {
  cafe: Cafe, restaurant: Restaurant, park: Park, river: River, beach: Beach, gym: Gym, library: Library, mall: Mall, museum: Museum, home: Home,
};
