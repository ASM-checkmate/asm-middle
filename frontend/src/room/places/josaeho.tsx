// ─── 조새호 (장소별 방, ADR-0015 개정 4) ───────────────────────────────────────
// 390×560. 광안리 조개구이집의 창가 자리. 위 띠 0..96은 통유리창 — 노을 하늘·바다·광안대교·모래사장. 내 자리는 창 아래 벤치 등판을 두른
// 둥근 스테인리스 테이블(가운데 숯불 그릴에 가리비), 오른쪽 위는 수족관 카운터, 왼쪽은 셀프 바. 큐는 식당 방의 것 그대로 (셀프 바 = water).
import type { RoomProp, RoomSpec, Zone } from '../Room';
import { INK, INK2, Cup, Patterns, Rug, Table, chairBack, mat, plant, prop } from '../parts';
import { cueOf } from '../restaurant';

const ID = 'rm-josaeho';

/** 가리비 한 개: 껍데기 + 속 */
const Scallop = ({ x, y, r = 1 }: { x: number; y: number; r?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${r})`}>
    <path d="M-10 4 a10 8 0 0 1 20 0 l-2 4 h-16 z" fill="var(--coral-2)" {...INK2} />
    <ellipse cx="0" cy="3" rx="5" ry="3.5" fill="var(--sun)" stroke="var(--ink)" strokeWidth="1.5" />
  </g>
);

const table = Table({ rx: 66, ry: 24, top: '#DDE3E8', side: '#9AA3AD' });

const PROPS: RoomProp[] = [
  // 수족관 카운터 (오른쪽 위): 유리 수조 + 물 + 조개, 아래는 계산대
  { key: 'counter', x: 214, y: 116, w: 164, h: 114, base: 228, node: (
    <>
      <defs>
        <pattern id={`${ID}-tank`} width="32" height="16" patternUnits="userSpaceOnUse">
          <rect width="32" height="16" fill="var(--sky)" />
          <path d="M2 10 q6 -5 12 0 t12 0" fill="none" stroke="var(--card)" strokeWidth="2" strokeLinecap="round" opacity=".8" />
        </pattern>
      </defs>
      <rect x="4" y="60" width="156" height="50" rx="6" fill="var(--rm-wood)" {...INK} />
      <rect x="4" y="60" width="156" height="10" fill="var(--rm-wood-2)" />
      <rect x="2" y="40" width="160" height="26" rx="8" fill="var(--rm-cream)" {...INK} />
      <rect x="14" y="4" width="136" height="40" rx="5" fill={`url(#${ID}-tank)`} {...INK} />
      <path d="M14 14 h136" stroke="var(--card)" strokeWidth="2" opacity=".7" />
      <Scallop x={40} y={30} r={0.9} /><Scallop x={72} y={34} r={0.8} /><Scallop x={104} y={30} r={0.9} /><Scallop x={132} y={34} r={0.8} />
      <rect x="112" y="18" width="30" height="20" rx="4" fill="var(--night)" {...INK2} opacity=".0" />
    </>
  ) },
  // 셀프 바 (왼쪽 가운데): 물통 + 잔 + 반찬통
  prop('water', 60, 214, 72, 90, (
    <>
      <rect x="4" y="44" width="64" height="44" rx="6" fill="var(--rm-wood)" {...INK} />
      <rect x="4" y="44" width="64" height="8" fill="var(--rm-wood-2)" />
      <path d="M12 10 h16 l2 32 h-20 z" fill="var(--sky-2)" {...INK2} />
      <rect x="15" y="4" width="10" height="7" rx="2" fill="var(--sky)" {...INK2} />
      <path d="M36 28 h9 l-1 12 h-7 z M48 28 h9 l-1 12 h-7 z" fill="var(--sky-2)" {...INK2} />
      <rect x="34" y="14" width="26" height="12" rx="3" fill="var(--mint)" {...INK2} />
    </>
  ), { base: 212 }),
  plant(34, 544, 'var(--mint)'),
  // 내 자리 (왼쪽 가운데): 창가 벤치 등판 하나가 둘을 감싼다, 앞에 둥근 스테인리스 테이블 + 그릴
  chairBack(127, 368, 'var(--rm-wood)', 110),
  { key: 'table', x: 128 - table.cx, y: 380 - table.cy, w: table.w, h: table.h, base: 432, node: (
    <>
      {table.node}
      <g transform={`translate(${table.cx} ${table.cy})`}>
        {/* 숯불 그릴 */}
        <ellipse cx="0" cy="0" rx="34" ry="13" fill="var(--night)" {...INK2} />
        <ellipse cx="0" cy="0" rx="28" ry="10" fill="var(--coral)" opacity=".85" />
        <path d="M-24 -3 h48 M-26 1 h52 M-22 5 h44" stroke="var(--night)" strokeWidth="1.5" opacity=".7" />
        <Scallop x={-14} y={-6} r={0.8} /><Scallop x={4} y={-8} r={0.8} /><Scallop x={16} y={-2} r={0.8} />
        {/* 잔 (활동 물건 — 빈 접시 등 — 은 seatItem 자리, 그릴 왼쪽 앞) */}
        <Cup x={50} y={2} fill="var(--mint)" />
      </g>
    </>
  ) },
  // 옆 테이블 (오른쪽 아래) + 의자 둘
  chairBack(262, 396, 'var(--rm-wood)', 52), chairBack(322, 396, 'var(--rm-wood)', 52),
  (() => { const s = Table({ rx: 46, ry: 18, top: '#DDE3E8', side: '#9AA3AD' }); return { key: 'side', x: 292 - s.cx, y: 416 - s.cy, w: s.w, h: s.h, base: 462, node: s.node }; })(),
  // 입구 매트 (오른쪽 아래 구석)
  mat(292, 520, 'var(--sky)', 'var(--sky-2)'),
];

/** 통유리창(노을·바다·다리·모래) + 타일 바닥 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    <defs>
      <linearGradient id={`${ID}-dusk`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--sun-2)" /><stop offset="1" stopColor="var(--coral-2)" />
      </linearGradient>
    </defs>
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-tile)`} />
    <Rug cx={128} cy={400} rx={116} ry={54} fill="var(--coral-2)" line="var(--coral)" />
    {/* 창 너머: 노을 하늘 · 바다 · 모래 */}
    <rect x="0" y="0" width="390" height="98" fill={`url(#${ID}-dusk)`} />
    <circle cx="300" cy="34" r="12" fill="var(--sun)" opacity=".9" />
    <ellipse className="room-cloud" cx="90" cy="22" rx="24" ry="8" fill="var(--card)" opacity=".8" />
    <rect x="0" y="48" width="390" height="34" fill="var(--sky)" />
    <path d="M0 58 q10 -3 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="var(--card)" strokeWidth="2" opacity=".8" />
    <path d="M0 70 q10 -3 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="var(--card)" strokeWidth="2" opacity=".6" />
    <rect x="0" y="80" width="390" height="18" fill={`url(#${ID}-sand)`} />
    <path d="M0 80 q60 6 120 -2 t140 4 t130 -2" fill="none" stroke="var(--card)" strokeWidth="3" opacity=".9" />
    {/* 광안대교 (낮): 상판 + 주탑 + 케이블 */}
    <rect x="0" y="44" width="390" height="5" fill="#8FA4B8" stroke="var(--ink)" strokeWidth="1.5" />
    <path d="M120 44 v-24 M270 44 v-24" stroke="#8FA4B8" strokeWidth="4" strokeLinecap="round" />
    <path d="M0 40 Q60 20 120 20 Q195 52 270 20 Q330 20 390 40" fill="none" stroke="#8FA4B8" strokeWidth="2.5" />
    {/* 창틀 (세로 둘) + 창 아래 턱 */}
    <path d="M130 0 v98 M260 0 v98" stroke="var(--ink)" strokeWidth="4" />
    <rect x="0" y="0" width="390" height="6" fill="var(--rm-wood)" />
    <rect x="0" y="86" width="390" height="12" fill="var(--rm-wood)" stroke="var(--ink)" strokeWidth="3" />
  </svg>
);

const ZONES: Zone[] = [
  { key: 'water', x: 14, y: 130, w: 100, h: 130, spots: ['water'], say: '💧', label: '셀프 바' },
  { key: 'counter', x: 214, y: 118, w: 164, h: 130, spots: ['counter'], say: '조개 추가요', label: '주문하기' },
  { key: 'seat', x: 56, y: 330, w: 144, h: 100, spots: ['seat', 'friend'], label: '창가 자리' },
  { key: 'side', x: 236, y: 380, w: 112, h: 92, spots: ['side'], pose: 'sit', label: '옆 테이블' },
];

export const JOSAEHO: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    counter: { x: 296, y: 268 },
    water: { x: 60, y: 256 },
    seat: { x: 150, y: 372 },
    friend: { x: 104, y: 372 },
    side: { x: 292, y: 410 },
    met: { x: 352, y: 452 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'water', pose: 'idle' }, { spot: 'counter', pose: 'think' }, { spot: 'door', pose: 'idle' }],
  seatItem: { x: 92, y: 384, base: 433 },   // 그릴을 안 가리게 왼쪽 앞
  zones: ZONES,
  cueOf,
};
