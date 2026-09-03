import type { Phase } from '../sim/types';
import { hhmmIn, ownerTz } from '../sim/tz';
import { cityNameKo } from '../sim/places';
import { Character } from '../character';

type Sleeping = Extract<Phase, { kind: 'sleeping' }>;

const STARS: [number, number, number, string][] = [
  [40, 90, 2.4, ''], [120, 60, 1.8, 'd1'], [200, 120, 2.2, 'd2'], [70, 200, 1.6, 'd3'], [330, 80, 2.6, 'd1'], [360, 200, 1.8, ''],
  [150, 210, 1.4, 'd2'], [250, 40, 1.6, 'd3'], [300, 250, 2, ''], [30, 300, 1.6, 'd1'], [370, 320, 1.4, 'd2'], [110, 140, 1.2, 'd3'],
];

/** "우리 집에서 쿨쿨" / "연남 호텔에서 쿨쿨" / "센트럴파크 근처에서 쿨쿨" — nobody sleeps inside a café. */
const whereAsleep = (at: Sleeping['at']) => (at.type === 'home' || at.type === 'hotel' || at.type === 'friend_home' ? `${at.name}에서 쿨쿨` : `${at.name} 근처에서 쿨쿨`);

/** State 5 — night sky, the character asleep in a round window. No card, only the clock. */
export function SleepScreen({ phase }: { phase: Sleeping }) {
  const abroad = phase.tz !== ownerTz;   // the wake-up time is local (phase.tz); abroad the caption names the city too
  return (
    <div className="slp">
      <svg className="slp-sky" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {STARS.map(([x, y, r, d], i) => <circle key={i} cx={x} cy={y} r={r} fill="#FFF6E6" className={`slp-star ${d}`} />)}
        <defs>
          <mask id="slp-moon" maskUnits="userSpaceOnUse" x="-40" y="-40" width="80" height="80">
            <circle r="36" fill="#fff" />
            <circle cx="16" cy="-10" r="30" fill="#000" />
          </mask>
        </defs>
        <g transform="translate(300 128)">
          <circle r="36" fill="#FFE9B3" mask="url(#slp-moon)" />
          <circle cx="-12" cy="6" r="3" fill="#FFC64D" opacity=".6" /><circle cx="-4" cy="18" r="2" fill="#FFC64D" opacity=".6" />
        </g>
        {/* far hills */}
        <path d="M-20 660c70-50 150-60 230-30s120 10 200-20v260H-20z" fill="#3A4270" />
        <path d="M-20 700c90-40 190-30 280 0s110 10 150-10v170H-20z" fill="#2E355E" />
        {/* tree silhouettes */}
        <g fill="#2A2F55">
          <circle cx="42" cy="600" r="34" /><circle cx="70" cy="570" r="26" /><rect x="36" y="620" width="12" height="60" rx="4" />
          <circle cx="352" cy="610" r="28" /><rect x="346" y="630" width="12" height="50" rx="4" />
        </g>
        {/* house */}
        <g className="slp-house">
          {/* chimney (warm wall colour, ink outline) and its smoke, starting right of the chimney top and above the roof line */}
          <rect x="262" y="272" width="26" height="70" rx="3" className="slp-wall" stroke="#2A2118" strokeWidth="2" />
          <rect x="258" y="268" width="34" height="10" rx="3" className="slp-roof" stroke="#2A2118" strokeWidth="2" />
          <g transform="translate(287 258)">
            <circle className="slp-smoke" r="8" fill="#FFF6E6" opacity=".5" />
            <circle className="slp-smoke d1" cx="7" cy="-4" r="6" fill="#FFF6E6" opacity=".5" />
            <circle className="slp-smoke d2" cx="-5" cy="-2" r="7" fill="#FFF6E6" opacity=".5" />
          </g>
          {/* walls: warm paper darkened for night, 2px ink outline like everything else */}
          <rect x="68" y="384" width="254" height="330" rx="10" className="slp-wall" stroke="#2A2118" strokeWidth="2" />
          {/* roof: coral darkened for night, 3px ink outline */}
          <path d="M48 392L195 244l147 148z" className="slp-roof" stroke="#2A2118" strokeWidth="3" strokeLinejoin="round" />
          <path d="M92 392l103-104 103 104" fill="none" stroke="#FFF6E6" strokeWidth="2" opacity=".28" />
          {/* door */}
          <rect x="166" y="610" width="58" height="104" rx="6" fill="#3A4270" stroke="#2A2118" strokeWidth="2" />
          <circle cx="212" cy="664" r="3.5" fill="#FFC64D" />
          <rect x="160" y="712" width="70" height="8" rx="3" fill="#2A2118" />
          {/* small side window */}
          <rect x="98" y="616" width="40" height="40" rx="6" fill="#3A4270" stroke="#2A2118" strokeWidth="2" />
          <path d="M118 616v40M98 636h40" stroke="#2A2118" strokeWidth="2" />
        </g>
        {/* ground */}
        <path d="M-20 720h430v140H-20z" fill="#2A2F55" />
        <path d="M-20 720h430" stroke="#2A2118" strokeWidth="3" opacity=".6" />
        {/* fence */}
        <g fill="#FFF6E6" stroke="#2A2118" strokeWidth="2" opacity=".55">
          {[20, 50, 80, 110].map(x => <path key={x} d={`M${x} 712l6-8 6 8v30h-12z`} />)}
          {[280, 310, 340, 370].map(x => <path key={x} d={`M${x} 712l6-8 6 8v30h-12z`} />)}
        </g>
        {/* fireflies */}
        <circle cx="140" cy="760" r="2.5" fill="#FFC64D" className="slp-star d1" />
        <circle cx="330" cy="748" r="2" fill="#FFC64D" className="slp-star d3" />
      </svg>

      <div className="slp-win">
        <Character className="slp-chara" pose="sleep" size={220} />
      </div>
      <svg className="slp-frame" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g transform="translate(195 472)">
          <circle r="110" fill="none" stroke="#2A2118" strokeWidth="5" />
          <path d="M-110 0h48M62 0h48M0 -110v40M0 62v48" stroke="#2A2118" strokeWidth="2.5" opacity=".35" />
          <path d="M-104 -34c30 20 30 60 8 118" fill="#FFD2C4" stroke="#2A2118" strokeWidth="3" opacity=".95" transform="translate(-4 -6)" />
          <path d="M104 -34c-30 20-30 60-8 118" fill="#FFD2C4" stroke="#2A2118" strokeWidth="3" opacity=".95" transform="translate(4 -6)" />
          <rect x="-124" y="104" width="248" height="14" rx="5" fill="#FFF6E6" stroke="#2A2118" strokeWidth="3" />
          <g transform="translate(-92 104)">
            <path d="M-12 0h24l-4 12h-16z" fill="#FF6A48" stroke="#2A2118" strokeWidth="2.5" />
            <path d="M-8 -6c-8-10-6-22 2-26M8 -8c8-8 6-20 0-24M0 -4c-2-12 4-22 6-30" stroke="#2A2118" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <ellipse cx="-6" cy="-30" rx="5" ry="9" fill="#8FD37E" stroke="#2A2118" strokeWidth="2" transform="rotate(-20 -6 -30)" />
            <ellipse cx="10" cy="-30" rx="5" ry="9" fill="#8FD37E" stroke="#2A2118" strokeWidth="2" transform="rotate(20 10 -30)" />
          </g>
        </g>
      </svg>
      <span className="slp-z z1">z</span><span className="slp-z z2">z</span><span className="slp-z z3">z</span>
      <div className={`slp-caption ${abroad ? 'is-away' : ''}`}>
        <span><b>{hhmmIn(phase.until, phase.tz)}</b>에 일어나요{abroad ? '' : ` · ${whereAsleep(phase.at)}`}</span>
        {abroad && <span>{cityNameKo(phase.at.city)} · {whereAsleep(phase.at)}</span>}
      </div>
    </div>
  );
}
