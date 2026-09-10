// ─── 공원 마당 (ADR-0015 개정 3) ─────────────────────────────────────────────
// 390×560. 지평선(언덕) 0..96, 잔디 96..560. 분수는 가운데 위, 꽃밭은 왼쪽 위, 매점(자판기)은 오른쪽 위, 내 벤치는 왼쪽 가운데,
// 옆 벤치는 오른쪽 아래, 산책로가 가운데에서 오른쪽 아래 출구로 내려간다. 산·섬(mountain·island)도 이 마당을 쓴다.
import type { Cue, RoomProp, RoomSpec } from './Room';
import { Cup, Horizon, INK, INK2, Patterns, bush, prop, tree, benchSeat } from './parts';
import type { LogLine } from '../sim/actlog';

const ID = 'rm-park';

/** 가로등 */
const lamp = (x: number, y: number): RoomProp => prop(`lamp-${x}-${y}`, x, y, 28, 96, (
  <>
    <ellipse cx="14" cy="92" rx="10" ry="4" fill="var(--ink)" opacity=".12" />
    <rect x="11" y="22" width="6" height="68" rx="2" fill="var(--night-2)" {...INK2} />
    <rect x="6" y="86" width="16" height="8" rx="3" fill="var(--night-2)" {...INK2} />
    <path d="M4 22 h20 l-4 -16 h-12 z" fill="var(--sun)" {...INK2} />
    <circle cx="14" cy="14" r="3" fill="var(--card)" opacity=".8" />
  </>
), { base: y - 2 });

/** 쓰레기통 */
const bin = (x: number, y: number): RoomProp => prop(`bin-${x}-${y}`, x, y, 30, 40, (
  <>
    <path d="M4 10 h22 l-3 28 h-16 z" fill="var(--mint)" {...INK} />
    <rect x="2" y="4" width="26" height="8" rx="3" fill="var(--mint-2)" {...INK} />
    <path d="M11 18 v14 M19 18 v14" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" opacity=".5" />
  </>
), { base: y });

const PROPS: RoomProp[] = [
  // 뒤쪽 나무·덤불 (지평선 바로 아래)
  tree(36, 176, 0.85), tree(120, 150, 0.7), tree(352, 168, 0.85), bush(210, 132, 0.8), bush(300, 140, 0.7),
  // 꽃밭 (왼쪽 위)
  prop('flowers', 76, 236, 120, 46, (
    <>
      <ellipse cx="60" cy="34" rx="58" ry="12" fill="var(--rm-wood-2)" opacity=".5" />
      <ellipse cx="60" cy="30" rx="56" ry="11" fill="#6FB863" {...INK2} />
      {[10, 30, 52, 74, 96].map((cx, i) => (
        <g key={cx}>
          <path d={`M${cx + 8} 30 v-12`} stroke="#6FB863" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx={cx + 8} cy="14" r="6" fill={['var(--coral)', 'var(--sun)', 'var(--card)', 'var(--coral)', 'var(--sun)'][i]} {...INK2} />
          <circle cx={cx + 8} cy="14" r="2" fill="var(--sun-2)" />
        </g>
      ))}
    </>
  ), { base: 228 }),
  // 분수 (가운데 위): 아래 수반 + 기둥 + 위 수반 + 물줄기
  prop('fountain', 205, 232, 130, 96, (
    <>
      <ellipse cx="65" cy="80" rx="62" ry="14" fill="var(--paper-2)" {...INK} />
      <ellipse cx="65" cy="74" rx="56" ry="12" fill="var(--sky)" {...INK2} />
      <rect x="59" y="38" width="12" height="36" rx="3" fill="var(--paper-2)" {...INK2} />
      <ellipse cx="65" cy="40" rx="24" ry="8" fill="var(--paper-2)" {...INK} />
      <ellipse cx="65" cy="37" rx="19" ry="6" fill="var(--sky)" />
      <g className="room-steam" fill="none" stroke="var(--sky)" strokeWidth="3" strokeLinecap="round">
        <path d="M65 30 q-6 -14 -2 -24" /><path d="M65 30 q6 -14 2 -24" /><path d="M65 28 v-22" />
      </g>
      <path d="M30 74 q6 -4 12 0 M84 76 q6 -4 12 0" fill="none" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" opacity=".9" />
    </>
  ), { base: 224 }),
  // 매점 자판기 (오른쪽 위)
  prop('kiosk', 336, 176, 44, 70, (
    <>
      <rect x="4" y="4" width="36" height="62" rx="6" fill="var(--coral)" {...INK} />
      <rect x="9" y="10" width="26" height="30" rx="4" fill="var(--sky-2)" {...INK2} />
      <circle cx="16" cy="18" r="3" fill="var(--sun)" /><circle cx="28" cy="18" r="3" fill="var(--mint)" /><circle cx="16" cy="30" r="3" fill="var(--coral)" /><circle cx="28" cy="30" r="3" fill="var(--sky)" />
      <rect x="9" y="46" width="26" height="10" rx="3" fill="var(--night)" />
    </>
  ), { base: 174 }),
  lamp(352, 330), lamp(222, 534),
  // 내 벤치 (왼쪽 가운데) + 텀블러 + 쓰레기통
  ...benchSeat(150, 372, 150),
  prop('tumbler', 214, 366, 24, 24, <g transform="translate(12 12)"><Cup x={0} y={0} fill="var(--mint)" /></g>, { base: 383 }),
  bin(58, 404),
  // 옆 벤치 (오른쪽 아래)
  ...benchSeat(296, 458, 116),
  bush(50, 520, 0.9), bush(130, 548, 0.7),
];

/** 지평선·잔디·산책로·벤치 아래 흙 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-grass)`} />
    {/* 산책로: 가운데 위에서 오른쪽 아래 출구로 */}
    <path d="M176 98 C170 180 300 260 262 360 C236 430 300 500 300 560 L346 560 C346 500 286 440 306 372 C340 270 214 190 226 98 Z" fill="var(--paper-2)" stroke="var(--rm-wood-2)" strokeWidth="3" strokeLinejoin="round" opacity=".95" />
    {/* 벤치 아래 흙 자리 */}
    <ellipse cx="150" cy="384" rx="110" ry="30" fill="var(--rm-wood-2)" opacity=".25" />
    <ellipse cx="296" cy="470" rx="82" ry="22" fill="var(--rm-wood-2)" opacity=".25" />
    <Horizon far="M0 98 C40 62 110 56 160 78 C210 58 280 50 330 76 C355 66 380 70 390 80 V98 Z">
      <circle cx="330" cy="30" r="14" fill="var(--sun)" stroke="var(--ink)" strokeWidth="3" />
    </Horizon>
  </svg>
);

/** 공원 문장 → 큐 (sim/actlog.ts MIDDLE.park + 기본 문장) */
const CUES: Record<string, Cue> = {
  '한 바퀴 돎': { go: 'path', then: 'seat', pose: 'idle', say: '🚶' },
  '벤치에 앉음': { go: 'seat' },
  '강아지 지나감': { at: 'path', say: '🐕' },
  '해가 좋다': { pose: 'happy', say: '☀️' },
  '신발 끈 다시 묶음': { say: '👟' },
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'flowers', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'fountain', then: 'seat', at: 'fountain', say: '좋다' };
  if (/원 씀$/.test(line.text)) return { go: 'kiosk', then: 'seat', at: 'kiosk', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const PARK: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 322, y: 548 },
    seat: { x: 172, y: 372 },
    friend: { x: 126, y: 372 },
    side: { x: 296, y: 458 },
    met: { x: 356, y: 500 },
    fountain: { x: 205, y: 262 },
    flowers: { x: 76, y: 266 },
    path: { x: 270, y: 420 },
    kiosk: { x: 336, y: 214 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'fountain', pose: 'think' }, { spot: 'flowers', pose: 'idle' }, { spot: 'path', pose: 'idle' }],
  seatItem: { x: 172, y: 366, base: 374 },
  cueOf,
};
