// ─── 식당 방 (ADR-0015 개정 3) ─────────────────────────────────────────────────
// 390×560. 뒷벽(메뉴판·주방 창구·시계) 0..96, 바닥 96..560. 계산대는 오른쪽 위, 물 정수기는 왼쪽 가운데, 내 식탁은 왼쪽 가운데,
// 옆 테이블은 오른쪽 아래, 입구는 오른쪽 아래 구석. 식당·술집·시장이 이 방을 쓴다 (scenes MAP).
// 로그 줄(sim/actlog.ts의 restaurant·bar·market 문장)이 곧 동선이다: 도착 → 계산대에서 주문 → 식탁 · 물은 정수기 · 반찬·한 잔 더는 계산대.
import type { Cue, RoomProp, RoomSpec } from './Room';
import { INK, INK2, Cup, Desk, Patterns, Rug, Sign, Steam, Table, Wall, chairBack, mat, plant, prop, stool } from './parts';
import type { LogLine } from '../sim/actlog';

const ID = 'rm-restaurant';

/** 그릇: 국물 + 김 */
const Bowl = ({ x, y, fill = 'var(--sun)' }: { x: number; y: number; fill?: string }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-14 0 a14 6 0 0 0 28 0 v3 a14 8 0 0 1 -28 0 z" fill="var(--card)" {...INK2} />
    <ellipse cx="0" cy="0" rx="14" ry="6" fill={fill} {...INK2} />
    <Steam x={0} y={-6} />
  </g>
);

const table = Desk({ w: 136, d: 46, top: 'var(--rm-cream)', side: 'var(--rm-wood)', children: (
  <>
    <Bowl x={44} y={26} />
    <Bowl x={90} y={24} fill="var(--coral)" />
    <ellipse cx="66" cy="40" rx="10" ry="4" fill="var(--mint-2)" {...INK2} />
    <Cup x={124} y={30} fill="var(--sky)" />
  </>
) });
const side = Table({ rx: 46, ry: 18, top: 'var(--rm-cream)', side: 'var(--rm-wood)' });

const PROPS: RoomProp[] = [
  // 계산대 (오른쪽 위): 윗판 + 앞면 + 계산기·물병·반찬통
  { key: 'counter', x: 214, y: 116, w: 164, h: 114, base: 228, node: (
    <>
      <rect x="4" y="60" width="156" height="50" rx="6" fill="var(--rm-wood)" {...INK} />
      <rect x="4" y="60" width="156" height="10" fill="var(--rm-wood-2)" />
      <path d="M22 84 h40 M22 98 h40 M80 84 h40 M80 98 h40" stroke="var(--rm-wood-2)" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
      <rect x="2" y="40" width="160" height="26" rx="8" fill="var(--rm-cream)" {...INK} />
      {/* 계산기 */}
      <rect x="112" y="18" width="34" height="28" rx="5" fill="var(--night)" {...INK} />
      <rect x="117" y="23" width="24" height="9" rx="2" fill="var(--mint-2)" />
      <path d="M120 38 h18" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" />
      {/* 반찬통 */}
      <rect x="16" y="26" width="26" height="20" rx="4" fill="var(--mint)" {...INK2} />
      <rect x="48" y="26" width="26" height="20" rx="4" fill="var(--coral-2)" {...INK2} />
      <rect x="14" y="22" width="30" height="7" rx="3" fill="var(--card)" {...INK2} />
      <rect x="46" y="22" width="30" height="7" rx="3" fill="var(--card)" {...INK2} />
      {/* 물병 */}
      <path d="M86 18 h14 l3 28 h-20 z" fill="var(--sky-2)" {...INK2} />
      <rect x="88" y="12" width="10" height="7" rx="2" fill="var(--sky)" {...INK2} />
    </>
  ) },
  // 정수기 (왼쪽 가운데)
  prop('water', 60, 214, 44, 90, (
    <>
      <rect x="8" y="30" width="28" height="58" rx="6" fill="var(--card)" {...INK} />
      <path d="M8 60 h28" stroke="var(--ink)" strokeWidth="2.5" />
      <rect x="12" y="8" width="20" height="24" rx="6" fill="var(--sky)" {...INK2} />
      <rect x="15" y="14" width="14" height="10" rx="2" fill="var(--sky-2)" />
      <circle cx="16" cy="46" r="3" fill="var(--coral)" /><circle cx="28" cy="46" r="3" fill="var(--sky)" />
      <path d="M14 70 h8 l-1 12 h-6 z" fill="var(--paper)" {...INK2} />
    </>
  ), { base: 212 }),
  plant(34, 544, 'var(--coral)'),
  // 내 식탁 (왼쪽 가운데): 등받이 의자 둘 뒤에, 식탁 앞에
  chairBack(150, 368, 'var(--coral)'), chairBack(104, 368, 'var(--coral)'),
  { key: 'table', x: 128 - table.cx, y: 376 - table.cy, w: table.w, h: table.h, base: 428, node: table.node },
  // 옆 테이블 (오른쪽 아래) + 스툴 둘
  stool(262, 454, 'var(--sun)', 'var(--sun-2)'), stool(322, 454, 'var(--sun)', 'var(--sun-2)'),
  { key: 'side', x: 292 - side.cx, y: 416 - side.cy, w: side.w, h: side.h, base: 462, node: side.node },
  // 입구 매트 (오른쪽 아래 구석)
  mat(292, 520),
];

/** 뒷벽과 바닥 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    {/* 타일 바닥 */}
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-tile)`} />
    <Rug cx={128} cy={396} rx={112} ry={52} fill="var(--coral-2)" line="var(--coral)" />
    <Wall fill="var(--rm-cream)" trim="var(--coral)" base="var(--rm-wood)">
      {/* 메뉴판 */}
      <Sign x={24} y={22} w={120} h={54} text="오늘의 메뉴" fill="var(--night)" size={15} />
      <path d="M40 62 h60 M40 68 h44" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
      {/* 시계 */}
      <circle cx="184" cy="46" r="16" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M184 46 v-9 M184 46 h6" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      {/* 주방 창구: 창 + 선반 위 그릇 + 김 */}
      <rect x="218" y="20" width="150" height="58" rx="6" fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="3" />
      <rect x="224" y="26" width="138" height="30" rx="4" fill="var(--sun-2)" />
      {/* 창구 너머 냄비 둘 */}
      <rect x="232" y="38" width="30" height="14" rx="3" fill="var(--night-2)" {...INK2} />
      <rect x="228" y="34" width="38" height="6" rx="3" fill="var(--night)" {...INK2} />
      <rect x="276" y="40" width="26" height="12" rx="3" fill="var(--coral)" {...INK2} />
      <rect x="272" y="36" width="34" height="6" rx="3" fill="var(--coral-2)" {...INK2} />
      <rect x="212" y="74" width="162" height="7" rx="3" fill="var(--rm-wood)" stroke="var(--ink)" strokeWidth="3" />
      <g transform="translate(250 70)">
        <path d="M-12 0 a12 5 0 0 0 24 0 v3 a12 6 0 0 1 -24 0 z" fill="var(--card)" {...INK2} />
        <ellipse cx="0" cy="0" rx="12" ry="5" fill="var(--coral)" {...INK2} />
        <Steam x={0} y={-6} />
      </g>
      <g transform="translate(300 70)">
        <path d="M-12 0 a12 5 0 0 0 24 0 v3 a12 6 0 0 1 -24 0 z" fill="var(--card)" {...INK2} />
        <ellipse cx="0" cy="0" rx="12" ry="5" fill="var(--sun)" {...INK2} />
        <Steam x={0} y={-6} />
      </g>
      <rect x="330" y="58" width="30" height="14" rx="4" fill="var(--mint)" stroke="var(--ink)" strokeWidth="2.5" />
    </Wall>
  </svg>
);

/** 식당·술집·시장 문장 → 큐 (sim/actlog.ts MIDDLE.restaurant·bar·market + 공통 기본 문장과 짝). 도착·돈 줄은 prefix로 */
const CUES: Record<string, Cue> = {
  '주문한 거 나옴': { say: '🍜 나왔다', pose: 'happy' },
  '생각보다 양이 많음': { say: '😳 많다', pose: 'think' },
  '물 두 잔째': { go: 'water', then: 'seat', at: 'water', say: '💧' },
  '반찬 리필함': { go: 'counter', then: 'seat', at: 'counter', say: '반찬 더요' },
  '한 잔 더 시킴': { go: 'counter', then: 'seat', at: 'counter', say: '🍺 한 잔 더' },
  '안주 나옴': { say: '🍢', pose: 'happy' },
  '한 바퀴 더 돎': { go: 'counter', then: 'seat', pose: 'think', say: '👀' },
  '시식 함': { go: 'counter', then: 'seat', at: 'counter', say: '😋' },
  '가격 물어봄': { go: 'counter', then: 'seat', at: 'counter', say: '얼마예요?' },
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'water', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'counter', then: 'seat', at: 'counter', say: '한 명이요' };
  if (/원 씀$/.test(line.text)) return { go: 'counter', then: 'seat', at: 'counter', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const RESTAURANT: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    counter: { x: 296, y: 268 },
    water: { x: 60, y: 256 },
    seat: { x: 150, y: 372 },
    friend: { x: 104, y: 372 },
    side: { x: 292, y: 446 },
    met: { x: 352, y: 452 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'water', pose: 'idle' }, { spot: 'counter', pose: 'think' }, { spot: 'door', pose: 'idle' }],
  seatItem: { x: 150, y: 366, base: 429 },
  cueOf,
};
