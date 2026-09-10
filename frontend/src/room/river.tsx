// ─── 강변 마당 (ADR-0015 개정 3) ─────────────────────────────────────────────
// 390×560. 지평선(도시 실루엣) 0..96. 왼쪽 0..104는 물, 그 옆 104..122 둑, 150..204는 자전거길(아래 출구까지 이어진다), 오른쪽은 잔디.
// 다리가 위쪽에서 물을 건너고, 자판기는 오른쪽 위, 내 벤치는 자전거길 오른쪽 가운데, 옆 벤치는 오른쪽 아래.
import type { Cue, RoomProp, RoomSpec } from './Room';
import { Cup, Horizon, INK, INK2, Patterns, bush, prop, tree, benchSeat } from './parts';
import type { LogLine } from '../sim/actlog';

const ID = 'rm-river';

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

/** 오리 (물 위) */
const duck = (x: number, y: number, flip = false): RoomProp => prop(`duck-${x}-${y}`, x, y, 34, 26, (
  <g transform={flip ? 'translate(34 0) scale(-1 1)' : undefined}>
    <ellipse cx="17" cy="22" rx="16" ry="4" fill="var(--card)" opacity=".7" />
    <ellipse cx="15" cy="16" rx="12" ry="7" fill="var(--sun)" {...INK2} />
    <circle cx="24" cy="9" r="6" fill="var(--sun)" {...INK2} />
    <path d="M29 9 l6 2 l-6 2 z" fill="var(--coral)" {...INK2} />
    <circle cx="25" cy="8" r="1.4" fill="var(--ink)" />
  </g>
), { base: y });

/** 세워 둔 자전거 */
const bike = (x: number, y: number): RoomProp => prop(`bike-${x}-${y}`, x, y, 64, 44, (
  <>
    <circle cx="14" cy="32" r="11" fill="none" {...INK} /><circle cx="50" cy="32" r="11" fill="none" {...INK} />
    <path d="M14 32 l12 -18 h16 l8 18 M26 14 l10 18 h-22 M26 14 l-4 -4 h8 M42 14 l4 -6" fill="none" stroke="var(--coral)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M36 32 l-4 -18" fill="none" {...INK2} />
  </>
), { base: y });

const PROPS: RoomProp[] = [
  // 오른쪽 위 나무·덤불
  tree(300, 170, 0.8), tree(366, 150, 0.7), bush(240, 130, 0.7),
  // 물 위 오리들
  duck(40, 250), duck(70, 300, true), duck(30, 420),
  // 자판기 (오른쪽 위)
  prop('vend', 340, 178, 44, 70, (
    <>
      <rect x="4" y="4" width="36" height="62" rx="6" fill="var(--sky)" {...INK} />
      <rect x="9" y="10" width="26" height="30" rx="4" fill="var(--card)" {...INK2} />
      <circle cx="16" cy="18" r="3" fill="var(--coral)" /><circle cx="28" cy="18" r="3" fill="var(--sun)" /><circle cx="16" cy="30" r="3" fill="var(--mint)" /><circle cx="28" cy="30" r="3" fill="var(--coral)" />
      <rect x="9" y="46" width="26" height="10" rx="3" fill="var(--night)" />
    </>
  ), { base: 176 }),
  lamp(226, 286), lamp(216, 470),
  bike(176, 336),
  // 내 벤치 (자전거길 오른쪽) + 텀블러
  ...benchSeat(292, 372, 140),
  prop('tumbler', 352, 366, 24, 24, <g transform="translate(12 12)"><Cup x={0} y={0} fill="var(--sky)" /></g>, { base: 383 }),
  // 옆 벤치 (오른쪽 아래)
  ...benchSeat(290, 484, 110),
  bush(370, 540, 0.7),
];

/** 지평선·물·둑·자전거길·잔디·다리 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-grass)`} />
    {/* 물과 둑 */}
    <rect x="0" y="96" width="112" height="464" fill={`url(#${ID}-water)`} />
    <path d="M112 96 v464" stroke="var(--ink)" strokeWidth="3" />
    <rect x="112" y="96" width="14" height="464" fill="var(--rm-wood-2)" opacity=".55" />
    {/* 자전거길 */}
    <rect x="150" y="96" width="54" height="464" fill="var(--paper-2)" stroke="var(--rm-wood-2)" strokeWidth="3" />
    <path d="M177 110 v450" stroke="var(--card)" strokeWidth="3" strokeDasharray="16 14" />
    <text x="177" y="150" textAnchor="middle" fontSize="14" fill="var(--rm-wood-2)" fontFamily="var(--display)">🚲</text>
    {/* 벤치 아래 흙 자리 */}
    <ellipse cx="292" cy="384" rx="104" ry="28" fill="var(--rm-wood-2)" opacity=".25" />
    <ellipse cx="290" cy="496" rx="80" ry="22" fill="var(--rm-wood-2)" opacity=".25" />
    {/* 다리: 물 위를 건넌다 (위쪽) */}
    <rect x="-6" y="150" width="140" height="22" rx="6" fill="var(--rm-wood)" {...INK} />
    <path d="M0 140 h130 M6 140 v10 M30 140 v10 M54 140 v10 M78 140 v10 M102 140 v10 M124 140 v10" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
    <path d="M0 176 q65 30 130 0" fill="none" stroke="var(--rm-wood-2)" strokeWidth="5" strokeLinecap="round" />
    <Horizon far="M0 98 V70 h24 v-16 h18 v16 h20 V50 h26 v48 h30 V60 h22 v-14 h16 v14 h20 v38 h30 V72 h28 v-24 h20 v24 h24 v26 h40 V64 h22 v34 h40 V80 h20 v18 Z">
      <circle cx="60" cy="30" r="13" fill="var(--sun)" stroke="var(--ink)" strokeWidth="3" />
    </Horizon>
  </svg>
);

/** 강변 문장 → 큐 (sim/actlog.ts MIDDLE.river + 기본 문장) */
const CUES: Record<string, Cue> = {
  '자전거가 계속 지나감': { at: 'bike', say: '🚲' },
  '앉아서 물 봄': { go: 'shore', then: 'seat', pose: 'think', say: '🌊' },
  '바람에 머리 엉킴': { say: '💨' },
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'shore', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'shore', then: 'seat', at: 'shore', say: '바람 좋다' };
  if (/원 씀$/.test(line.text)) return { go: 'vend', then: 'seat', at: 'vend', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const RIVER: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 177, y: 548 },
    seat: { x: 314, y: 372 },
    friend: { x: 268, y: 372 },
    side: { x: 290, y: 484 },
    met: { x: 358, y: 530 },
    shore: { x: 134, y: 300 },
    bike: { x: 177, y: 250 },
    bridge: { x: 70, y: 214 },
    vend: { x: 340, y: 216 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'shore', pose: 'think' }, { spot: 'bike', pose: 'idle' }, { spot: 'bridge', pose: 'idle' }],
  seatItem: { x: 314, y: 366, base: 374 },
  cueOf,
};
