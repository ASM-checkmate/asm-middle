import type { BlockId, Category } from '../sim/types';
import { BLOCKS } from '../sim/blocks';
import { localParts } from '../sim/tz';

/** Ring wedge colour per category (deck: 놀기 coral, 운동 mint, 식사 sky, 일 sun; sleep = night). */
export const CATEGORY_FILL: Record<Category, { fill: string; dark: boolean }> = {
  sleep:    { fill: 'var(--night)',   dark: true },
  meal:     { fill: 'var(--sky)',     dark: false },
  play:     { fill: 'var(--coral)',   dark: true },
  exercise: { fill: 'var(--mint)',    dark: true },
  study:    { fill: 'var(--leaf)',    dark: false },
  work:     { fill: 'var(--sun)',     dark: false },
  rest:     { fill: 'var(--mint-2)',  dark: false },
  travel:   { fill: 'var(--night-2)', dark: true },
};

export interface RingSeg {
  id: BlockId;
  /** category label ("놀기") or "?" */
  label: string;
  /** wedge colour token (category colour, see CATEGORY_FILL) */
  fill: string;
  /** dark fill → paper text */
  dark: boolean;
  state: 'sleep' | 'past' | 'current' | 'future';
  decided: boolean;
}

export interface RingProps {
  segs: RingSeg[];
  selected: BlockId;
  now: number;
  /** the zone the day is lived in (`phase.tz`) — the now-hand reads in it */
  tz: string;
  /** text inside the hub ("오전") */
  center: string;
  onSelect: (id: BlockId) => void;
}

const CX = 100, CY = 100, R = 90;
const ang = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2;
const pt = (h: number, r: number): [number, number] => [CX + r * Math.cos(ang(h)), CY + r * Math.sin(ang(h))];
const f = (n: number) => n.toFixed(2);
const wedge = (h0: number, h1: number) => {
  const [x0, y0] = pt(h0, R), [x1, y1] = pt(h1, R);
  return `M${CX} ${CY} L${f(x0)} ${f(y0)} A${R} ${R} 0 ${h1 - h0 > 12 ? 1 : 0} 1 ${f(x1)} ${f(y1)} Z`;
};

/** The circular 7-block 생활계획표 (190px). Arc length = hours. Sleep = night with "z z", past = desaturated + check,
 *  current = pulsing outline, undecided future = paper-2 with a dotted ink edge and "?", selected = 4px ink stroke + lifted. */
export function Ring({ segs, selected, now, tz, center, onSelect }: RingProps) {
  const lp = localParts(now, tz);
  const nowH = lp.hour + lp.minute / 60;
  const [nx, ny] = pt(nowH, R);
  const order = [...segs].sort((a, b) => (a.id === selected ? 1 : 0) - (b.id === selected ? 1 : 0)); // selected drawn last
  const geo = (s: RingSeg) => {
    const b = BLOCKS.find(x => x.id === s.id)!;
    const mid = (b.startHour + b.endHour) / 2;
    const [lx, ly] = pt(mid, 62);
    const isSel = s.id === selected;
    const pop = isSel ? 4 : 0;
    const filled = s.decided || s.state === 'sleep';
    const faded = s.state === 'past' && s.id !== 'sleep';
    return {
      b, lx, ly, isSel, filled, faded,
      // selected: 4px outward pop + 2px lift
      offset: `translate(${f(pop * Math.cos(ang(mid)))}px, ${f(pop * Math.sin(ang(mid)) - (isSel ? 2 : 0))}px)`,
      text: s.state === 'sleep' ? 'z z' : s.decided ? s.label : '?',
      textFill: faded ? 'var(--ink-2)' : filled ? (s.dark ? 'var(--paper)' : 'var(--ink)') : 'var(--ink-2)',
    };
  };

  return (
    <svg className="ring" viewBox="0 0 200 200" role="listbox" aria-label="오늘의 생활계획표">
      <circle cx={CX} cy={CY} r={R + 5} fill="var(--paper-2)" />
      {order.map(s => {
        const { b, isSel, filled, faded, offset, text } = geo(s);
        const path = wedge(b.startHour, b.endHour);
        return (
          <g
            key={s.id}
            className={`ring-seg is-${s.state} ${isSel ? 'is-sel' : ''}`}
            style={{ transform: offset }}
            onClick={() => onSelect(s.id)}
            role="option"
            aria-selected={isSel}
            aria-label={`${b.label} ${text}`}
          >
            <path d={path} fill={filled ? s.fill : 'var(--paper-2)'} stroke="none" />
            {faded && <path d={path} fill="var(--paper)" opacity=".45" stroke="none" />}
            {!filled && !isSel && <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="1 3.5" strokeLinecap="round" opacity=".3" />}
            <path d={path} fill="none" stroke={isSel ? 'var(--ink)' : '#fff'} strokeWidth={isSel ? 4 : 2} strokeLinejoin="round" />
            {s.state === 'current' && <path className="ring-cur" d={path} fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" />}
          </g>
        );
      })}
      {/* labels: one flat group after every segment (no inherited transform / transition), upright, same font for all */}
      <g className="ring-labels" aria-hidden="true" fontFamily="Jua, 'Noto Sans KR', sans-serif" textAnchor="middle" pointerEvents="none">
        {segs.map(s => {
          const { lx, ly, faded, offset, text, textFill } = geo(s);
          return (
            <g key={s.id} className="ring-lbl" style={{ transform: offset }}>
              <text x={f(lx)} y={f(ly + 4)} fontSize={s.decided ? 12 : 13} fill={textFill}>{text}</text>
              {faded && <path d={`M${f(lx - 5)} ${f(ly + 12)}l3 3 6-7`} fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
            </g>
          );
        })}
      </g>
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--ink)" strokeWidth="3" />
      <circle cx={CX} cy={CY} r="34" fill="#fff" stroke="var(--ink)" strokeWidth="3" />
      <text x={CX} y={CY + 6} textAnchor="middle" fontFamily="Jua, 'Noto Sans KR', sans-serif" fontSize="16" fill="var(--ink)">{center}</text>
      <g transform={`translate(${f(nx)} ${f(ny)})`} aria-hidden="true">
        <circle r="6.5" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
        <circle r="2.2" fill="var(--coral)" />
      </g>
    </svg>
  );
}
