// ─── 해변 마당 (ADR-0015 개정 3) ─────────────────────────────────────────────
// 390×560. 지평선(바다 끝·섬) 0..96, 바다 96..~200(물결 가장자리), 모래 그 아래. 매점 오두막은 오른쪽 위, 조개는 왼쪽,
// 내 자리는 왼쪽 가운데 돗자리(파라솔 뒤), 옆 자리는 오른쪽 아래 돗자리, 나무 데크가 오른쪽 아래 출구로 내려간다.
import type { Cue, RoomProp, RoomSpec } from './Room';
import { Cup, Horizon, INK, INK2, Patterns, prop } from './parts';
import type { LogLine } from '../sim/actlog';

const ID = 'rm-beach';

/** 파라솔: 기둥 아래가 (x, y). 캐노피가 크니 앉은 인물 뒤에 선다(base = y) */
const parasol = (x: number, y: number): RoomProp => prop(`parasol-${x}-${y}`, x, y, 150, 150, (
  <>
    <rect x="72" y="60" width="6" height="88" rx="2" fill="var(--rm-wood-2)" {...INK2} />
    <path d="M4 62 Q75 -10 146 62 Z" fill="var(--coral)" {...INK} />
    <path d="M40 62 Q60 8 75 2 Q90 8 110 62 Z" fill="var(--card)" {...INK2} />
    <path d="M4 62 q18 8 36 0 q18 8 36 0 q18 8 36 0 q18 8 34 0" fill="none" {...INK2} />
  </>
), { base: y - 2 });

/** 갈매기 (하늘) */
const Gull = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <path d={`M${x - 12 * s} ${y} q6 -8 12 0 q6 -8 12 0`} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
);

/** 조개 */
const shell = (x: number, y: number, fill = 'var(--coral-2)'): RoomProp => prop(`shell-${x}-${y}`, x, y, 22, 18, (
  <>
    <path d="M11 16 L2 6 Q11 0 20 6 Z" fill={fill} {...INK2} />
    <path d="M11 16 L7 6 M11 16 L11 4 M11 16 L15 6" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
  </>
), { base: y });

const PROPS: RoomProp[] = [
  // 매점 오두막 (오른쪽 위, 모래 위)
  prop('kiosk', 322, 292, 116, 108, (
    <>
      <rect x="14" y="44" width="88" height="60" rx="6" fill="var(--rm-cream)" {...INK} />
      <rect x="24" y="60" width="40" height="22" rx="4" fill="var(--sky)" {...INK2} />
      <path d="M34 82 h20" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M4 46 L58 8 L112 46 Z" fill="var(--coral)" {...INK} />
      <path d="M22 46 h20 M46 46 h20 M70 46 h20" stroke="var(--card)" strokeWidth="4" strokeLinecap="round" opacity=".8" />
      <rect x="70" y="58" width="24" height="16" rx="3" fill="var(--sun)" {...INK2} />
      <text x="82" y="70" textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--ink)">ICE</text>
    </>
  ), { base: 290 }),
  // 조개 (왼쪽)
  shell(60, 262), shell(92, 280, 'var(--sun-2)'), shell(46, 296, 'var(--card)'),
  // 모래성
  prop('castle', 120, 236, 56, 46, (
    <>
      <rect x="6" y="20" width="44" height="24" rx="4" fill="var(--sun)" {...INK2} />
      <rect x="12" y="6" width="12" height="18" rx="2" fill="var(--sun)" {...INK2} /><rect x="32" y="6" width="12" height="18" rx="2" fill="var(--sun)" {...INK2} />
      <path d="M18 6 v-8 l8 3 l-8 3" fill="var(--coral)" {...INK2} />
      <path d="M24 44 v-12 a4 4 0 0 1 8 0 v12" fill="var(--rm-wood-2)" {...INK2} />
    </>
  ), { base: 236 }),
  // 내 자리: 파라솔(뒤) + 텀블러(앞) + 비치볼
  parasol(196, 344),
  prop('tumbler', 216, 376, 24, 24, <g transform="translate(12 12)"><Cup x={0} y={0} fill="var(--sun)" /></g>, { base: 391 }),
  prop('ball', 66, 386, 36, 36, (
    <>
      <circle cx="18" cy="18" r="15" fill="var(--card)" {...INK} />
      <path d="M8 6 Q18 18 8 30 M28 6 Q18 18 28 30" fill="none" stroke="var(--coral)" strokeWidth="6" />
      <path d="M8 6 Q18 18 8 30 M28 6 Q18 18 28 30" fill="none" {...INK2} />
    </>
  ), { base: 386 }),
  // 옆 자리 파라솔 (오른쪽 아래)
  parasol(296, 448),
];

/** 지평선·바다·모래·돗자리·데크 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-sand)`} />
    {/* 바다: 물결 가장자리 + 거품선 */}
    <path d="M0 96 H390 V178 C350 196 320 170 280 186 C240 202 200 180 160 196 C120 212 80 190 40 204 C26 208 12 206 0 200 Z" fill={`url(#${ID}-water)`} stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
    <path d="M0 208 C12 214 26 216 40 212 C80 198 120 220 160 204 C200 188 240 210 280 194 C320 178 350 204 390 186" fill="none" stroke="var(--card)" strokeWidth="4" strokeLinecap="round" opacity=".9" />
    <path d="M0 220 C40 214 80 226 120 216 M200 214 C240 208 270 220 300 210" fill="none" stroke="var(--sky-2)" strokeWidth="3" strokeLinecap="round" opacity=".8" />
    {/* 돗자리 둘 (평행사변형: 위가 오른쪽으로 16 밀린다) */}
    <path d="M100 346 h150 l-16 68 h-150 z" fill="var(--sky)" {...INK} />
    <path d="M108 362 h134 M104 378 h134 M100 394 h134" stroke="var(--card)" strokeWidth="3" strokeDasharray="12 10" opacity=".9" />
    <path d="M250 450 h100 l-14 56 h-100 z" fill="var(--mint)" {...INK} />
    <path d="M256 466 h86 M252 482 h86" stroke="var(--card)" strokeWidth="3" strokeDasharray="12 10" opacity=".9" />
    {/* 나무 데크: 오른쪽 아래 출구로 */}
    <path d="M304 474 L376 474 L388 560 L292 560 Z" fill="var(--rm-wood)" {...INK} />
    <path d="M302 490 h78 M300 506 h82 M298 522 h86 M296 538 h90" stroke="var(--rm-wood-2)" strokeWidth="3" strokeLinecap="round" />
    <Horizon far="M0 98 V90 h120 v8 Z M250 98 C262 84 296 78 320 86 C334 80 356 84 366 92 L368 98 Z">
      <circle cx="80" cy="34" r="16" fill="var(--sun)" stroke="var(--ink)" strokeWidth="3" />
      <Gull x={180} y={30} /><Gull x={214} y={44} s={0.8} /><Gull x={310} y={26} s={0.9} />
    </Horizon>
  </svg>
);

/** 해변 문장 → 큐 (sim/actlog.ts MIDDLE.beach + 기본 문장) */
const CUES: Record<string, Cue> = {
  '발만 담가봄': { go: 'shore', then: 'seat', at: 'shore', say: '🌊 차갑다' },
  '조개 주움': { go: 'shells', then: 'seat', at: 'shells', say: '🐚' },
  '모래에 앉음': { go: 'seat' },
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'shore', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'shore', then: 'seat', at: 'shore', say: '🌊 바다다' };
  if (/원 씀$/.test(line.text)) return { go: 'kiosk', then: 'seat', at: 'kiosk', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const BEACH: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 340, y: 548 },
    seat: { x: 160, y: 382 },
    friend: { x: 114, y: 382 },
    side: { x: 294, y: 486 },
    met: { x: 110, y: 470 },
    shore: { x: 200, y: 238 },
    shells: { x: 70, y: 310 },
    kiosk: { x: 322, y: 322 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'shore', pose: 'think' }, { spot: 'shells', pose: 'idle' }, { spot: 'kiosk', pose: 'idle' }],
  seatItem: { x: 160, y: 376, base: 384 },
  cueOf,
};
