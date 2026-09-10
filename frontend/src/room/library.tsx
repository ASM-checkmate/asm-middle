// ─── 도서관 방 (ADR-0015 개정 3) ───────────────────────────────────────────────
// 390×560. 뒷벽(책장·QUIET 팻말) 0..96, 바닥 96..560. 대출대는 오른쪽 위, 서가는 왼쪽 위, 긴 열람 책상(내 자리)은 왼쪽 가운데,
// 다른 책상은 오른쪽 아래, 입구는 오른쪽 아래 구석. 도서관·학교·사무실이 이 방을 쓴다 (scenes MAP).
// 로그 줄(sim/actlog.ts의 library 문장)이 곧 동선이다: 도착 → 서가에서 책 고르기 → 자리 · 책 꺼냄은 서가 · 돈은 대출대.
import type { Cue, RoomProp, RoomSpec } from './Room';
import { INK, INK2, Cup, Desk, Patterns, Rug, Sign, Wall, Window, chairBack, mat, plant, prop } from './parts';
import type { LogLine } from '../sim/actlog';

const ID = 'rm-library';

/** 책 한 줄 (벽 책장·서가 공용): 색색 등 */
const Books = ({ x, y, n, h = 22 }: { x: number; y: number; n: number; h?: number }) => {
  const colors = ['var(--coral)', 'var(--mint)', 'var(--sun)', 'var(--sky)', 'var(--night-2)', 'var(--coral-2)'];
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x + i * 11} y={y + (i % 3 === 1 ? 3 : 0)} width="9" height={h - (i % 3 === 1 ? 3 : 0)} rx="2" fill={colors[i % colors.length]} stroke="var(--ink)" strokeWidth="2" />
      ))}
    </>
  );
};

const desk = Desk({ w: 150, d: 44, top: 'var(--rm-cream)', side: 'var(--rm-wood)', children: (
  <>
    {/* 스탠드 */}
    <path d="M124 30 v-18 q0 -6 -6 -6 h-8" fill="none" {...INK2} />
    <path d="M100 4 h20 l-4 8 h-12 z" fill="var(--leaf)" {...INK2} />
    <path d="M100 12 h20" stroke="var(--sun)" strokeWidth="3" strokeLinecap="round" opacity=".8" />
    {/* 책 더미 */}
    <rect x="30" y="18" width="34" height="8" rx="2" fill="var(--sky)" {...INK2} />
    <rect x="34" y="12" width="30" height="7" rx="2" fill="var(--coral)" {...INK2} />
    <Cup x={138} y={30} fill="var(--mint)" />
  </>
) });
const side = Desk({ w: 96, d: 36, top: 'var(--rm-cream)', side: 'var(--rm-wood)', children: (
  <rect x="34" y="12" width="30" height="12" rx="2" fill="var(--sun)" {...INK2} />
) });

const PROPS: RoomProp[] = [
  // 서가 (왼쪽 위): 두 칸 책장이 바닥에 서 있다
  { key: 'shelf', x: 16, y: 92, w: 140, h: 118, base: 208, node: (
    <>
      <rect x="4" y="4" width="132" height="110" rx="6" fill="var(--rm-wood)" {...INK} />
      <rect x="10" y="10" width="120" height="44" rx="3" fill="var(--rm-cream)" {...INK2} />
      <rect x="10" y="60" width="120" height="44" rx="3" fill="var(--rm-cream)" {...INK2} />
      <Books x={14} y={30} n={10} />
      <Books x={14} y={80} n={10} />
      <rect x="4" y="106" width="132" height="10" rx="3" fill="var(--rm-wood-2)" {...INK2} />
    </>
  ) },
  // 반납 카트 (서가 옆)
  prop('cart', 186, 204, 44, 56, (
    <>
      <circle cx="12" cy="50" r="5" fill="var(--night)" {...INK2} /><circle cx="32" cy="50" r="5" fill="var(--night)" {...INK2} />
      <rect x="4" y="14" width="36" height="32" rx="4" fill="var(--mint-2)" {...INK} />
      <Books x={7} y={18} n={3} h={18} />
      <path d="M8 46 v-38 M36 46 v-38" fill="none" {...INK2} />
    </>
  ), { base: 202 }),
  // 대출대 (오른쪽 위): 윗판 + 앞면 + 컴퓨터·책 더미·스캐너
  { key: 'counter', x: 214, y: 116, w: 164, h: 114, base: 228, node: (
    <>
      <rect x="4" y="60" width="156" height="50" rx="6" fill="var(--rm-wood)" {...INK} />
      <rect x="4" y="60" width="156" height="10" fill="var(--rm-wood-2)" />
      <path d="M28 84 h30 M28 98 h30 M74 84 h30 M74 98 h30 M118 84 h24 M118 98 h24" stroke="var(--rm-wood-2)" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
      <rect x="2" y="40" width="160" height="26" rx="8" fill="var(--rm-cream)" {...INK} />
      {/* 모니터 */}
      <rect x="18" y="8" width="48" height="34" rx="5" fill="var(--night)" {...INK} />
      <rect x="24" y="14" width="36" height="20" rx="2" fill="var(--sky-2)" />
      <path d="M34 42 h16 M42 42 v6" fill="none" {...INK2} />
      {/* 책 더미 */}
      <rect x="80" y="34" width="34" height="8" rx="2" fill="var(--coral)" {...INK2} />
      <rect x="84" y="27" width="30" height="8" rx="2" fill="var(--mint)" {...INK2} />
      <rect x="82" y="20" width="32" height="8" rx="2" fill="var(--sun)" {...INK2} />
      {/* 스캐너 */}
      <rect x="126" y="30" width="26" height="14" rx="4" fill="var(--night-2)" {...INK2} />
      <path d="M132 36 h14" stroke="var(--coral)" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ) },
  plant(34, 544, 'var(--mint)'),
  // 내 열람 책상 (왼쪽 가운데): 등받이 의자 둘 뒤에, 책상 앞에
  chairBack(150, 368, 'var(--night-2)'), chairBack(104, 368, 'var(--night-2)'),
  { key: 'desk', x: 128 - desk.cx, y: 376 - desk.cy, w: desk.w, h: desk.h, base: 428, node: desk.node },
  // 다른 책상 (오른쪽 아래) + 의자
  chairBack(292, 442, 'var(--night-2)'),
  { key: 'side', x: 292 - side.cx, y: 452 - side.cy, w: side.w, h: side.h, base: 500, node: side.node },
  // 입구 매트 (오른쪽 아래 구석)
  mat(292, 520, 'var(--mint)', 'var(--mint-2)'),
];

/** 뒷벽과 바닥 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    {/* 마루 */}
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-plank)`} />
    <Rug cx={128} cy={396} rx={112} ry={52} fill="var(--sky-2)" line="var(--sky)" />
    <Wall fill="var(--paper-2)" trim="var(--rm-wood-2)" base="var(--rm-wood)">
      {/* 벽 책장 (왼쪽·가운데) */}
      <rect x="20" y="18" width="200" height="66" rx="5" fill="var(--rm-wood)" stroke="var(--ink)" strokeWidth="3" />
      <rect x="26" y="24" width="188" height="24" rx="2" fill="var(--rm-cream)" stroke="var(--ink)" strokeWidth="2.5" />
      <rect x="26" y="54" width="188" height="24" rx="2" fill="var(--rm-cream)" stroke="var(--ink)" strokeWidth="2.5" />
      <Books x={30} y={26} n={16} h={20} />
      <Books x={30} y={56} n={16} h={20} />
      {/* QUIET 팻말 */}
      <Sign x={236} y={24} w={72} h={30} text="QUIET" fill="var(--coral)" size={13} />
      {/* 창 (오른쪽) */}
      <Window x={318} y={22} w={54} h={54} id={ID} curtain={null} />
    </Wall>
  </svg>
);

/** 도서관 문장 → 큐 (sim/actlog.ts MIDDLE.library + 공통 기본 문장과 짝). 도착·돈 줄은 prefix로 */
const CUES: Record<string, Cue> = {
  '책 두 권 꺼냄': { go: 'shelf', then: 'seat', at: 'shelf', say: '📚 두 권' },
  '한 챕터 읽음': { say: '📖 한 챕터' },
  '졸음이 옴': { say: '😪', pose: 'think' },
  '메모함': { say: '✏️' },
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'shelf', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'shelf', then: 'seat', at: 'shelf', say: '📚' };
  if (/원 씀$/.test(line.text)) return { go: 'counter', then: 'seat', at: 'counter', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const LIBRARY: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    counter: { x: 296, y: 268 },
    shelf: { x: 86, y: 250 },
    seat: { x: 150, y: 372 },
    friend: { x: 104, y: 372 },
    side: { x: 292, y: 446 },
    met: { x: 352, y: 452 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'shelf', pose: 'think' }, { spot: 'counter', pose: 'idle' }, { spot: 'door', pose: 'idle' }],
  seatItem: { x: 150, y: 366, base: 429 },
  cueOf,
};
