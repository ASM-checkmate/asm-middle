// ─── 스타벅스 부산대점 (장소별 방, ADR-0015 개정 4 · 공시생 데모) ────────────────────
// 390×560. 카페 방(cafe.tsx)과 같은 자리·같은 동선인데 초록 간판·초록 앞치마 카운터·흰 컵으로 그 가게처럼. 내 테이블엔 공시생의 물건 —
// 에듀윌 교재 두 권과 인강 켜 둔 노트북(ADR-0032 제품 배치: 광고주 제품이 방 안에 놓인다). 큐는 카페 방의 것 그대로.
import type { RoomProp, RoomSpec, Zone } from '../Room';
import { INK, INK2, Patterns, Table, chairBack, mat, plant } from '../parts';
import { cueOf } from '../cafe';

const ID = 'rm-sbux';
const GREEN = '#00704A', GREEN2 = '#1E3932';

/** 사이렌 로고를 단순화한 초록 원 (별 + 물결) */
const Siren = ({ x, y, r = 10 }: { x: number; y: number; r?: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <circle r={r} fill={GREEN} stroke="var(--ink)" strokeWidth="2" />
    <circle r={r * 0.68} fill="none" stroke="var(--card)" strokeWidth={r * 0.14} />
    <path d={`M0 ${-r * 0.42} l${r * 0.14} ${r * 0.3} l${r * 0.32} 0 l-${r * 0.26} ${r * 0.2} l${r * 0.1} ${r * 0.32} l-${r * 0.3} -${r * 0.18} l-${r * 0.3} ${r * 0.18} l${r * 0.1} -${r * 0.32} l-${r * 0.26} -${r * 0.2} l${r * 0.32} 0 z`} fill="var(--card)" />
  </g>
);

/** 흰 종이컵 + 초록 로고 (한 모금 잔동작이 .room-cup을 들어 올린다) */
const PaperCup = ({ x, y }: { x: number; y: number }) => (
  <g className="room-cup" transform={`translate(${x} ${y})`}>
    <path d="M-8 -6 h16 l-2 16 h-12 z" fill="var(--card)" {...INK2} />
    <rect x="-9" y="-10" width="18" height="5" rx="2" fill={GREEN2} {...INK2} />
    <circle cy="3" r="3.2" fill={GREEN} />
    <path d="M-3 -12 q2 -4 0 -8 M3 -12 q2 -4 0 -8" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" opacity=".6" />
  </g>
);

const main = Table({ rx: 66, ry: 25, top: 'var(--rm-wood)', side: 'var(--rm-wood-2)' });
const side = Table({ rx: 46, ry: 18, cup: false, top: 'var(--rm-wood)', side: 'var(--rm-wood-2)' });

/** 에듀윌 교재 두 권 (파란 표지·노란 띠) + 인강 켜 둔 노트북 — 상판 중심이 (0,0). 노트북은 왼쪽(빈 동행 자리 앞), 교재는 앞 왼쪽,
 *  컵은 오른쪽 — 가운데(내 자리 앞)는 손의 책(SeatItem) 자리라 비운다 */
const StudyStuff = () => (
  <>
    {/* 노트북: 화면(뒤로 살짝 기울어 위가 보인다) + 자판 */}
    <g transform="translate(-46 -2)">
      <path d="M-26 6 h52 l4 20 h-60 z" fill="#C9CED6" {...INK2} />
      <rect x="-20" y="10" width="40" height="10" rx="2" fill="#AEB4BD" opacity=".7" />
      <rect x="-30" y="-40" width="56" height="46" rx="4" fill={GREEN2} {...INK2} />
      <rect x="-26" y="-36" width="48" height="38" rx="2" fill="#F4F6FB" />
      <rect x="-26" y="-36" width="48" height="10" fill="#1D4ED8" />
      <text x="-2" y="-28.5" textAnchor="middle" fontSize="7" fontWeight="700" fontFamily="'Noto Sans KR', sans-serif" fill="var(--card)">에듀윌 공무원</text>
      <rect x="-23" y="-23" width="30" height="19" rx="2" fill="#DCE6F7" />
      <path d="M-12 -18 l8 4.5 l-8 4.5 z" fill="#1D4ED8" />
      <path d="M11 -21 h9 M11 -16 h9 M11 -11 h6" stroke="#8B95A7" strokeWidth="2" strokeLinecap="round" />
      <rect x="-23" y="-2" width="42" height="2.5" rx="1" fill="#FACC15" />
    </g>
    {/* 교재 두 권 겹쳐서 (앞에서 보이는 책등) — 상판 앞 왼쪽 */}
    <g transform="translate(-30 16)">
      <rect x="-20" y="-6" width="40" height="11" rx="2" fill="#2563EB" {...INK2} />
      <rect x="-18" y="-4" width="36" height="3" fill="#FACC15" />
      <text x="0" y="3.6" textAnchor="middle" fontSize="6.5" fontWeight="700" fontFamily="'Noto Sans KR', sans-serif" fill="var(--card)">에듀윌</text>
      <rect x="-22" y="5" width="44" height="11" rx="2" fill="#1E40AF" {...INK2} />
      <rect x="-20" y="7" width="40" height="3" fill="#FACC15" />
      <text x="0" y="14.6" textAnchor="middle" fontSize="6.5" fontWeight="700" fontFamily="'Noto Sans KR', sans-serif" fill="var(--card)">기본서</text>
    </g>
    <PaperCup x={46} y={8} />
  </>
);

const PROPS: RoomProp[] = [
  // 창가 벤치 (뒷벽 아래): 초록 방석
  { key: 'bench', x: 20, y: 98, w: 136, h: 36, base: 130, node: (
    <>
      <rect x="4" y="14" width="128" height="18" rx="5" fill="var(--rm-wood-2)" {...INK} />
      <rect x="2" y="2" width="132" height="18" rx="7" fill={GREEN} {...INK} />
      <rect x="12" y="6" width="26" height="10" rx="4" fill="var(--sun-2)" {...INK2} />
      <rect x="98" y="6" width="26" height="10" rx="4" fill="var(--mint-2)" {...INK2} />
    </>
  ) },
  plant(184, 150, GREEN2),
  // 카운터 (오른쪽 위): 초록 앞판 + 나무 윗판 + 커피머신·계산대·컵 탑·시럽
  { key: 'counter', x: 214, y: 116, w: 164, h: 114, base: 228, node: (
    <>
      <rect x="4" y="60" width="156" height="50" rx="6" fill={GREEN2} {...INK} />
      <rect x="4" y="60" width="156" height="10" fill="var(--rm-wood-2)" />
      <Siren x={82} y={90} r={11} />
      <rect x="2" y="40" width="160" height="26" rx="8" fill="var(--rm-wood)" {...INK} />
      {/* 에스프레소 머신 */}
      <rect x="14" y="6" width="50" height="42" rx="6" fill="#3B3F46" {...INK} />
      <rect x="22" y="14" width="34" height="8" rx="3" fill="var(--rm-cream)" />
      <circle cx="30" cy="34" r="3.5" fill="var(--coral)" /><circle cx="46" cy="34" r="3.5" fill={GREEN} />
      <path d="M68 30 h10 l-1 12 h-8 z" fill="var(--card)" {...INK2} />
      <g className="room-steam" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round">
        <path d="M70 28 q2 -4 0 -8" /><path d="M74 26 q2 -4 0 -8" /><path d="M72 24 q-2 -4 0 -8" />
      </g>
      {/* 계산대 */}
      <rect x="114" y="18" width="34" height="28" rx="5" fill="var(--rm-cream)" {...INK} />
      <rect x="119" y="23" width="24" height="9" rx="2" fill="var(--mint-2)" />
      <path d="M122 38 h18" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" />
      {/* 컵 탑 (흰 종이컵) */}
      <path d="M88 36 h12 l-1 12 h-10 z M90 26 h10 l-1 10 h-8 z" fill="var(--card)" {...INK2} />
      <circle cx="94" cy="42" r="2.2" fill={GREEN} />
    </>
  ) },
  // 내 테이블 (왼쪽 가운데): 등받이 의자 둘 뒤에, 테이블 앞에 — 상판 위에 공시생 물건
  chairBack(150, 368, GREEN2), chairBack(104, 368, GREEN2),
  { key: 'table', x: 128 - main.cx, y: 376 - main.cy, w: main.w, h: main.h, base: 428, node: (
    <>
      {main.node}
      <g transform={`translate(${main.cx} ${main.cy})`}><StudyStuff /></g>
    </>
  ) },
  // 옆 테이블 (오른쪽 아래) + 등받이 의자 둘
  chairBack(262, 404, GREEN2, 52), chairBack(322, 404, GREEN2, 52),
  { key: 'side', x: 292 - side.cx, y: 416 - side.cy, w: side.w, h: side.h, base: 462, node: (
    <>
      {side.node}
      <PaperCup x={side.cx + 14} y={side.cy - 4} />
    </>
  ) },
  mat(292, 520, GREEN, '#CFE3D9'),
];

/** 뒷벽(간판·창·메뉴판·선반)과 바닥 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    {/* 바닥: 타일 */}
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-tile)`} />
    <path d="M30 100 h116 l40 120 h-150 z" fill="var(--card)" opacity=".45" />
    <ellipse cx="128" cy="396" rx="112" ry="52" fill="#CFE3D9" opacity=".8" />
    <ellipse cx="128" cy="396" rx="96" ry="40" fill="none" stroke={GREEN} strokeWidth="3" strokeDasharray="10 8" opacity=".6" />
    {/* 뒷벽 */}
    <rect x="0" y="0" width="390" height="98" fill="#F3EBDD" />
    <rect x="0" y="0" width="390" height="14" fill={GREEN2} />
    <rect x="0" y="86" width="390" height="12" fill="var(--rm-wood)" />
    <path d="M0 14 h390 M0 86 h390 M0 98 h390" stroke="var(--ink)" strokeWidth="3" />
    {/* 창 */}
    <clipPath id={`${ID}-win`}><rect x="28" y="22" width="124" height="60" rx="6" /></clipPath>
    <rect x="28" y="22" width="124" height="60" rx="6" fill="var(--sky)" stroke="var(--ink)" strokeWidth="3" />
    <g clipPath={`url(#${ID}-win)`}>
      <ellipse className="room-cloud" cx="60" cy="48" rx="16" ry="8" fill="var(--card)" /><ellipse className="room-cloud" cx="112" cy="38" rx="13" ry="7" fill="var(--card)" />
      {/* 창에 붙은 사이렌 로고 (거꾸로 보이는 건 생략, 그냥 붙어 있다) */}
    </g>
    <path d="M90 22 v60 M28 52 h124" stroke="var(--ink)" strokeWidth="3" />
    <rect x="22" y="80" width="136" height="7" rx="3" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
    {/* 간판: 초록 판 + STARBUCKS + 사이렌 */}
    <rect x="178" y="22" width="120" height="34" rx="7" fill={GREEN} stroke="var(--ink)" strokeWidth="3" />
    <Siren x={198} y={39} r={11} />
    <text x="256" y="44" textAnchor="middle" fontSize="12" fontWeight="700" fontFamily="'Noto Sans KR', sans-serif" letterSpacing="1" fill="var(--card)">STARBUCKS</text>
    {/* 메뉴판 (검정) */}
    <rect x="178" y="60" width="120" height="22" rx="5" fill={GREEN2} stroke="var(--ink)" strokeWidth="3" />
    <path d="M188 67 h40 M188 75 h30 M240 67 h48 M240 75 h36" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
    {/* 선반과 텀블러 */}
    <rect x="310" y="52" width="66" height="6" rx="3" fill="var(--rm-wood)" stroke="var(--ink)" strokeWidth="3" />
    <rect x="316" y="30" width="12" height="22" rx="3" fill={GREEN} stroke="var(--ink)" strokeWidth="2.5" />
    <rect x="334" y="34" width="12" height="18" rx="3" fill="var(--card)" stroke="var(--ink)" strokeWidth="2.5" />
    <rect x="352" y="28" width="12" height="24" rx="3" fill="#F5C242" stroke="var(--ink)" strokeWidth="2.5" />
    {/* 입구 표시 */}
    <rect x="312" y="66" width="62" height="16" rx="5" fill="var(--mint)" stroke="var(--ink)" strokeWidth="3" />
    <text x="343" y="78" textAnchor="middle" fontSize="10" fontFamily="var(--mono)" fill="var(--ink)">OPEN</text>
  </svg>
);

/** 카페 방과 같은 존 */
const ZONES: Zone[] = [
  { key: 'window', x: 14, y: 90, w: 148, h: 72, spots: ['window', 'window2'], pose: 'think', say: '👀', label: '창밖 보기' },
  { key: 'counter', x: 214, y: 118, w: 164, h: 130, spots: ['counter', 'counter2'], say: '아메리카노 하나요', label: '주문하기' },
  { key: 'seat', x: 56, y: 330, w: 144, h: 96, spots: ['seat', 'friend'], label: '내 자리' },
  { key: 'side', x: 236, y: 380, w: 112, h: 92, spots: ['side', 'side2'], pose: 'sit', label: '옆 테이블' },
];

export const STARBUCKS: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    counter: { x: 270, y: 268 }, counter2: { x: 330, y: 268 },
    seat: { x: 150, y: 372 },
    friend: { x: 104, y: 372 },
    window: { x: 62, y: 152 }, window2: { x: 118, y: 152 },
    side: { x: 262, y: 428 }, side2: { x: 322, y: 428 },
    met: { x: 352, y: 452 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'window', pose: 'think' }, { spot: 'counter', pose: 'idle' }, { spot: 'door', pose: 'idle' }],
  // 손의 책(SeatItem)은 상판 오른쪽 — 왼쪽의 노트북·교재와 안 겹친다
  seatItem: { x: 158, y: 366, base: 429 },
  zones: ZONES,
  cueOf,
};
