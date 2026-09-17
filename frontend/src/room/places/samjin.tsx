// ─── 삼진포차 (장소별 방, ADR-0015 개정 4) ─────────────────────────────────────
// 390×560. 광안리 해변의 야외 포차, 밤. 위 띠 0..96은 벽이 아니라 풍경 — 밤하늘·광안대교·바다. 그 앞 유리 바람막이와 난간(96..160),
// 바닥은 나무 데크. 빨간 플라스틱 의자와 체크 테이블, 오른쪽 위에 천막 카운터. 카메라 배경(busan:samjin-*)과 같은 자리·같은 물건.
// 큐는 식당 방(술집 문장)의 것을 쓰되 정수기(water)가 없으니 그 걸음은 난간(rail)으로.
import type { Cue, RoomEvent, RoomProp, RoomSpec, Zone } from '../Room';
import { INK, INK2, Desk, Patterns, chairBack, mat, stool } from '../parts';
import { cueOf as restaurantCueOf } from '../restaurant';
import type { LogLine } from '../../sim/actlog';

const ID = 'rm-samjin';
const CHECK = `${ID}-check`;

/** 빨강·파랑 체크 상보 무늬 — 소품 svg 안에서 쓰니 defs를 같이 넣는다 */
const CheckDefs = ({ id }: { id: string }) => (
  <defs>
    <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
      <rect width="16" height="16" fill="var(--coral)" />
      <rect width="8" height="8" fill="var(--night-2)" /><rect x="8" y="8" width="8" height="8" fill="var(--night-2)" />
    </pattern>
  </defs>
);

const ASAHI_RED = '#C8102E', ASAHI_SILVER = '#DCE1E7', ASAHI_SILVER2 = '#B9C1CB';
/** 아사히 로고 글자 — 은색 캔·상자·현수막이 같은 것을 쓴다 (ADR-0032 제품 배치) */
const AsahiWord = ({ x, y, size }: { x: number; y: number; size: number }) => (
  <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight="900" fontStyle="italic" fontFamily="'Helvetica Neue', Arial, sans-serif" letterSpacing="-0.02em" fill={ASAHI_RED}>Asahi</text>
);
/** 아사히 슈퍼드라이 캔: 은색 몸통 + 빨간 로고 띠 */
const AsahiCan = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="-6" y="-24" width="12" height="30" rx="2.5" fill={ASAHI_SILVER} {...INK2} />
    <rect x="-6" y="-24" width="12" height="3" rx="1.5" fill={ASAHI_SILVER2} />
    <rect x="-6" y="-13" width="12" height="9" fill="var(--card)" />
    <AsahiWord x={0} y={-6} size={5} />
    <path d="M-3 -21 v20" stroke="var(--card)" strokeWidth="1.5" opacity=".7" />
  </g>
);
/** 맥주잔: 노란 맥주 + 흰 거품 */
const BeerGlass = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-5 -10 h10 l-1 14 h-8 z" fill="var(--sun)" {...INK2} />
    <path d="M-6 -10 h12 v3 h-12 z" fill="var(--card)" {...INK2} />
    <path d="M5 -7 a4 4 0 0 1 0 8" fill="none" {...INK2} />
  </g>
);

/** 아사히 캔 둘 + 맥주잔 둘 — 소주 대신 (데모 1편 v3의 술 광고) */
const Asahi = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <AsahiCan x={-4} y={2} />
    <AsahiCan x={10} y={4} />
    <BeerGlass x={26} y={4} />
    <BeerGlass x={-22} y={4} />
  </g>
);

const table = Desk({ w: 136, d: 46, top: `url(#${CHECK})`, side: 'var(--night-2)', children: (
  <>
    <CheckDefs id={CHECK} />
    <Asahi x={52} y={30} />
    {/* 안주: 접시 위 꼬치 */}
    <ellipse cx="108" cy="30" rx="18" ry="8" fill="var(--card)" {...INK2} />
    <path d="M96 30 h24 M100 27 h16" stroke="var(--coral)" strokeWidth="4" strokeLinecap="round" />
  </>
) });
const side = Desk({ w: 96, d: 36, top: `url(#${CHECK}-s)`, side: 'var(--night-2)', children: (
  <>
    <CheckDefs id={`${CHECK}-s`} />
    <path d="M30 14 h9 l-1 9 h-7 z" fill="var(--sky-2)" {...INK2} />
  </>
) });

const PROPS: RoomProp[] = [
  // 천막 카운터 (오른쪽 위): 빨강·흰 줄무늬 천막 + 윗판 + 냄비·잔
  { key: 'counter', x: 214, y: 90, w: 164, h: 140, base: 228, node: (
    <>
      <path d="M2 30 L82 6 L162 30 L162 44 L2 44 Z" fill="var(--coral)" {...INK} />
      <path d="M22 44 v-10 M42 44 v-16 M62 44 v-22 M82 44 v-26 M102 44 v-22 M122 44 v-16 M142 44 v-10" stroke="var(--card)" strokeWidth="6" strokeLinecap="round" opacity=".9" />
      <path d="M8 44 v52 M156 44 v52" fill="none" {...INK2} />
      <rect x="4" y="86" width="156" height="50" rx="6" fill="var(--rm-wood)" {...INK} />
      <rect x="4" y="86" width="156" height="10" fill="var(--rm-wood-2)" />
      <rect x="2" y="66" width="160" height="26" rx="8" fill="var(--rm-cream)" {...INK} />
      {/* 냄비 (어묵탕) + 김 */}
      <rect x="20" y="52" width="40" height="18" rx="4" fill="var(--night-2)" {...INK2} />
      <rect x="16" y="48" width="48" height="7" rx="3" fill="var(--night)" {...INK2} />
      <g fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="room-steam"><path d="M32 46 q2 -4 0 -8" /><path d="M42 44 q2 -4 0 -8" /></g>
      {/* 아사히 맥주 상자 (ADR-0032) */}
      <rect x="82" y="46" width="34" height="24" rx="3" fill={ASAHI_SILVER} {...INK2} />
      <rect x="82" y="46" width="34" height="5" fill={ASAHI_SILVER2} />
      <AsahiWord x={99} y={64} size={9} />
      {/* 잔 더미 */}
      <path d="M126 58 h10 l-1 12 h-8 z M138 58 h10 l-1 12 h-8 z" fill="var(--sky-2)" {...INK2} />
    </>
  ) },
  // 난간 앞 빈 스툴 (왼쪽 위)
  stool(50, 214, 'var(--coral)', '#C94A2E'),
  // 내 테이블 (왼쪽 가운데): 빨간 플라스틱 의자 둘 뒤에, 체크 테이블 앞에
  chairBack(150, 368, 'var(--coral)', 38), chairBack(104, 368, 'var(--coral)', 38),
  { key: 'table', x: 128 - table.cx, y: 376 - table.cy, w: table.w, h: table.h, base: 428, node: table.node },
  stool(60, 440, 'var(--coral)', '#C94A2E'),
  // 옆 테이블 (오른쪽 아래) + 의자
  chairBack(292, 396, 'var(--coral)', 38),
  { key: 'side', x: 292 - side.cx, y: 416 - side.cy, w: side.w, h: side.h, base: 462, node: side.node },
  stool(250, 478, 'var(--coral)', '#C94A2E'), stool(334, 478, 'var(--coral)', '#C94A2E'),
  // 입구 매트 (오른쪽 아래 구석)
  mat(292, 520, 'var(--night-2)', 'var(--night)'),
];

/** 풍경(밤하늘·광안대교·바다) + 바람막이·난간 + 데크 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    <defs>
      <pattern id={`${ID}-deck`} width="120" height="24" patternUnits="userSpaceOnUse">
        <rect width="120" height="24" fill="#8A6A3E" />
        <path d="M0 23.5 h120 M60 0 v12 M0 12 h60 M60 12 v12" stroke="#5E4526" strokeWidth="1.5" opacity=".8" />
      </pattern>
    </defs>
    {/* 데크 */}
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-deck)`} />
    {/* 밤하늘 + 별 */}
    <rect x="0" y="0" width="390" height="98" fill="var(--night)" />
    <g fill="var(--card)" opacity=".9">
      <circle cx="30" cy="16" r="1.6" /><circle cx="88" cy="30" r="1.2" /><circle cx="150" cy="12" r="1.6" /><circle cx="210" cy="26" r="1.2" /><circle cx="290" cy="10" r="1.6" /><circle cx="350" cy="24" r="1.2" /><circle cx="120" cy="40" r="1" /><circle cx="330" cy="42" r="1" />
    </g>
    {/* 바다 (수평선 62) */}
    <rect x="0" y="62" width="390" height="36" fill="#233A6B" />
    <path d="M0 74 q10 -3 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="var(--sky)" strokeWidth="1.5" opacity=".5" />
    <path d="M0 86 q10 -3 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="var(--sky)" strokeWidth="1.5" opacity=".35" />
    {/* 광안대교: 상판 + 주탑 둘 + 케이블 + 조명 점 */}
    <rect x="0" y="56" width="390" height="6" fill="var(--night-2)" stroke="var(--ink)" strokeWidth="2" />
    <path d="M110 56 v-30 M280 56 v-30" stroke="var(--sky)" strokeWidth="4" strokeLinecap="round" />
    <path d="M0 50 Q55 26 110 26 Q195 62 280 26 Q335 26 390 50" fill="none" stroke="var(--sky)" strokeWidth="2.5" />
    <path d="M40 40 v14 M75 30 v24 M145 32 v22 M195 44 v10 M245 32 v22 M315 30 v24 M350 40 v14" stroke="var(--sky)" strokeWidth="1.5" opacity=".8" />
    <g fill="var(--sun)"><circle cx="20" cy="47" r="1.6" /><circle cx="75" cy="30" r="1.6" /><circle cx="110" cy="24" r="2" /><circle cx="160" cy="36" r="1.6" /><circle cx="195" cy="44" r="1.6" /><circle cx="230" cy="36" r="1.6" /><circle cx="280" cy="24" r="2" /><circle cx="315" cy="30" r="1.6" /><circle cx="370" cy="47" r="1.6" /></g>
    {/* 바다에 비친 빛 */}
    <path d="M100 66 v28 M112 68 v22 M270 66 v28 M284 68 v22" stroke="var(--sun)" strokeWidth="2" opacity=".35" strokeLinecap="round" />
    {/* 드론쇼 (이벤트 drone — room.css가 .room.ev-drone일 때만 보인다): 다리 위 하늘에 하트를 그리는 드론 불빛 + 흩어진 드론 */}
    <g data-ev="drone">
      <g opacity=".35"><circle cx="195.0" cy="23.5" r="4" fill="var(--coral)" /><circle cx="195.3" cy="22.2" r="4" fill="var(--sun)" /><circle cx="197.1" cy="19.1" r="4" fill="var(--sky)" /><circle cx="201.2" cy="15.9" r="4" fill="var(--mint)" /><circle cx="207.2" cy="14.5" r="4" fill="var(--coral)" /><circle cx="213.7" cy="15.8" r="4" fill="var(--sun)" /><circle cx="218.7" cy="19.6" r="4" fill="var(--sky)" /><circle cx="220.6" cy="24.8" r="4" fill="var(--mint)" /><circle cx="218.7" cy="30.3" r="4" fill="var(--coral)" /><circle cx="213.7" cy="35.5" r="4" fill="var(--sun)" /><circle cx="207.2" cy="40.3" r="4" fill="var(--sky)" /><circle cx="201.2" cy="44.6" r="4" fill="var(--mint)" /><circle cx="197.1" cy="48.4" r="4" fill="var(--coral)" /><circle cx="195.3" cy="51.1" r="4" fill="var(--sun)" /><circle cx="195.0" cy="52.1" r="4" fill="var(--sky)" /><circle cx="194.7" cy="51.1" r="4" fill="var(--mint)" /><circle cx="192.9" cy="48.4" r="4" fill="var(--coral)" /><circle cx="188.8" cy="44.6" r="4" fill="var(--sun)" /><circle cx="182.8" cy="40.3" r="4" fill="var(--sky)" /><circle cx="176.3" cy="35.5" r="4" fill="var(--mint)" /><circle cx="171.3" cy="30.3" r="4" fill="var(--coral)" /><circle cx="169.4" cy="24.8" r="4" fill="var(--sun)" /><circle cx="171.3" cy="19.6" r="4" fill="var(--sky)" /><circle cx="176.3" cy="15.8" r="4" fill="var(--mint)" /><circle cx="182.8" cy="14.5" r="4" fill="var(--coral)" /><circle cx="188.8" cy="15.9" r="4" fill="var(--sun)" /><circle cx="192.9" cy="19.1" r="4" fill="var(--sky)" /><circle cx="194.7" cy="22.2" r="4" fill="var(--mint)" /></g>
      <circle cx="195.0" cy="23.5" r="2" fill="var(--coral)" /><circle cx="195.3" cy="22.2" r="2" fill="var(--sun)" /><circle cx="197.1" cy="19.1" r="2" fill="var(--sky)" /><circle cx="201.2" cy="15.9" r="2" fill="var(--mint)" /><circle cx="207.2" cy="14.5" r="2" fill="var(--coral)" /><circle cx="213.7" cy="15.8" r="2" fill="var(--sun)" /><circle cx="218.7" cy="19.6" r="2" fill="var(--sky)" /><circle cx="220.6" cy="24.8" r="2" fill="var(--mint)" /><circle cx="218.7" cy="30.3" r="2" fill="var(--coral)" /><circle cx="213.7" cy="35.5" r="2" fill="var(--sun)" /><circle cx="207.2" cy="40.3" r="2" fill="var(--sky)" /><circle cx="201.2" cy="44.6" r="2" fill="var(--mint)" /><circle cx="197.1" cy="48.4" r="2" fill="var(--coral)" /><circle cx="195.3" cy="51.1" r="2" fill="var(--sun)" /><circle cx="195.0" cy="52.1" r="2" fill="var(--sky)" /><circle cx="194.7" cy="51.1" r="2" fill="var(--mint)" /><circle cx="192.9" cy="48.4" r="2" fill="var(--coral)" /><circle cx="188.8" cy="44.6" r="2" fill="var(--sun)" /><circle cx="182.8" cy="40.3" r="2" fill="var(--sky)" /><circle cx="176.3" cy="35.5" r="2" fill="var(--mint)" /><circle cx="171.3" cy="30.3" r="2" fill="var(--coral)" /><circle cx="169.4" cy="24.8" r="2" fill="var(--sun)" /><circle cx="171.3" cy="19.6" r="2" fill="var(--sky)" /><circle cx="176.3" cy="15.8" r="2" fill="var(--mint)" /><circle cx="182.8" cy="14.5" r="2" fill="var(--coral)" /><circle cx="188.8" cy="15.9" r="2" fill="var(--sun)" /><circle cx="192.9" cy="19.1" r="2" fill="var(--sky)" /><circle cx="194.7" cy="22.2" r="2" fill="var(--mint)" />
      <circle cx="60" cy="20" r="1.4" fill="var(--card)" /> <circle cx="95" cy="14" r="1.4" fill="var(--card)" /> <circle cx="140" cy="36" r="1.4" fill="var(--card)" /> <circle cx="250" cy="38" r="1.4" fill="var(--card)" /> <circle cx="300" cy="12" r="1.4" fill="var(--card)" /> <circle cx="340" cy="22" r="1.4" fill="var(--card)" /> <circle cx="170" cy="8" r="1.4" fill="var(--card)" /> <circle cx="225" cy="6" r="1.4" fill="var(--card)" />
    </g>
    {/* 전구 줄 (천막 처마) */}
    <path d="M0 8 Q98 22 195 10 Q292 22 390 8" fill="none" stroke="var(--ink)" strokeWidth="2" />
    <g fill="var(--sun)" stroke="var(--ink)" strokeWidth="1.5"><circle cx="50" cy="16" r="4" /><circle cx="120" cy="18" r="4" /><circle cx="195" cy="12" r="4" /><circle cx="270" cy="18" r="4" /><circle cx="340" cy="15" r="4" /></g>
    {/* 아사히 현수막 (ADR-0032): 전구 줄에 매단 흰 천 — 오른쪽 위, 드론쇼(x 169..221)를 가리지 않는다 */}
    <g transform="translate(300 40)">
      <path d="M-48 -22 l4 -6 M48 -22 l-4 -6" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M-50 -22 h100 v40 q-50 5 -100 0 z" fill="var(--card)" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
      <AsahiWord x={0} y={4} size={22} />
      <text x="0" y="15" textAnchor="middle" fontSize="7" fontWeight="700" fontFamily="'Helvetica Neue', Arial, sans-serif" letterSpacing=".18em" fill="var(--ink)">SUPER DRY</text>
    </g>
    {/* 유리 바람막이 + 난간 (풍경이 비쳐 보인다) */}
    <rect x="0" y="96" width="390" height="60" fill="var(--sky)" opacity=".18" />
    <path d="M0 98 h390" stroke="var(--ink)" strokeWidth="3" />
    <path d="M4 98 v58 M130 98 v58 M260 98 v58 M386 98 v58" stroke="#8FA4B8" strokeWidth="3" />
    <rect x="0" y="150" width="390" height="8" rx="3" fill="#8FA4B8" stroke="var(--ink)" strokeWidth="2.5" />
  </svg>
);

/** 식당 방 큐를 그대로 — 정수기(water) 걸음은 난간(rail)으로 */
function cueOf(line: LogLine): Cue | null {
  const c = restaurantCueOf(line);
  if (!c) return null;
  return c.go === 'water' ? { ...c, go: 'rail', at: c.at === 'water' ? 'rail' : c.at } : c;
}

/** 광안리 드론쇼 — 데모는 21:00부터 30분 (실제는 주말 저녁). 그동안 난간의 📷는 '드론쇼 앞'만 */
const EVENTS: RoomEvent[] = [{ key: 'drone', from: '21:00', to: '21:30', say: '🚁 드론쇼 시작!' }];

const ZONES: Zone[] = [
  { key: 'rail', x: 10, y: 96, w: 196, h: 100, spots: ['rail'], say: '🌉', label: '난간' },
  { key: 'counter', x: 214, y: 118, w: 164, h: 130, spots: ['counter'], say: '한 병 더요', label: '주문하기' },
  { key: 'seat', x: 56, y: 330, w: 144, h: 96, spots: ['seat', 'friend'], label: '앞 테이블' },
  { key: 'side', x: 236, y: 380, w: 112, h: 92, spots: ['side'], pose: 'sit', label: '옆 테이블' },
];

export const SAMJIN: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    counter: { x: 296, y: 268 },
    rail: { x: 108, y: 186 },
    seat: { x: 150, y: 372 },
    friend: { x: 104, y: 372 },
    side: { x: 292, y: 410 },
    met: { x: 352, y: 452 },
    met2: { x: 214, y: 300 },   // 같이 온 사람 (ADR-0031) — 데크 가운데, 카운터 앞
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'rail', pose: 'idle' }, { spot: 'counter', pose: 'think' }, { spot: 'door', pose: 'idle' }],
  seatItem: { x: 150, y: 366, base: 429 },
  zones: ZONES,
  events: EVENTS,
  cueOf,
};
