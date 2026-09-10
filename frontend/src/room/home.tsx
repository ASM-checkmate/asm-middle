// ─── 집 방 (ADR-0015 개정 3) ──────────────────────────────────────────────────
// 390×560. 뒷벽(창·시계·선반) 0..96, 바닥 96..560. 침대는 왼쪽 위, 부엌 카운터는 오른쪽 위, 책상(내 자리)은 왼쪽 가운데,
// 소파는 오른쪽 아래, 문은 오른쪽 아래 구석. 집·친구 집·호텔이 이 방을 쓴다 (scenes MAP).
// 로그 줄(sim/actlog.ts의 home·friend_home 문장)이 곧 동선이다: 집. → 침대에 털썩 → 책상 · 설거지·간식은 부엌 · 낮잠·뒹굴은 침대 · 게임은 소파.
import type { Cue, RoomProp, RoomSpec } from './Room';
import { INK, INK2, Cup, Desk, Patterns, Rug, Steam, Wall, Window, chairBack, mat, plant, prop } from './parts';
import type { LogLine } from '../sim/actlog';

const ID = 'rm-home';

const desk = Desk({ w: 132, d: 44, children: (
  <>
    {/* 노트북 */}
    <rect x="46" y="12" width="40" height="22" rx="3" fill="var(--night)" {...INK2} />
    <rect x="50" y="15" width="32" height="14" rx="2" fill="var(--sky-2)" />
    <Cup x={110} y={26} fill="var(--sun)" />
  </>
) });

/** 침대: 머리판(뒤) + 매트리스 + 베개 + 이불. (x, y)는 왼쪽 위 모서리, base는 발치 */
const bed: RoomProp = { key: 'bed', x: 16, y: 88, w: 136, h: 120, base: 206, node: (
  <>
    <rect x="4" y="2" width="128" height="30" rx="8" fill="var(--rm-wood)" {...INK} />
    <rect x="4" y="24" width="128" height="88" rx="8" fill="var(--card)" {...INK} />
    <rect x="14" y="30" width="46" height="22" rx="7" fill="var(--sun-2)" {...INK2} />
    <path d="M4 60 h128 v44 a8 8 0 0 1 -8 8 h-112 a8 8 0 0 1 -8 -8 z" fill="var(--coral-2)" {...INK} />
    <path d="M4 60 h128 v10 h-128 z" fill="var(--coral)" opacity=".7" />
    <path d="M30 80 q10 8 20 0 M80 90 q10 8 20 0" fill="none" stroke="var(--coral)" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
  </>
) };

/** 소파: 등판(뒤) + 방석(앞) — 옆 손님·실루엣이 앉는 자리 */
const sofaBack: RoomProp = { key: 'sofa-back', x: 240, y: 396, w: 110, h: 46, base: 400, node: (
  <rect x="3" y="3" width="104" height="40" rx="12" fill="var(--mint)" {...INK} />
) };
const sofaSeat: RoomProp = { key: 'sofa-seat', x: 236, y: 432, w: 118, h: 44, base: 462, node: (
  <>
    <path d="M10 30 v10 M108 30 v10" fill="none" {...INK} />
    <rect x="2" y="10" width="114" height="24" rx="8" fill="var(--mint-2)" {...INK} />
    <rect x="2" y="2" width="18" height="30" rx="7" fill="var(--mint)" {...INK} />
    <rect x="98" y="2" width="18" height="30" rx="7" fill="var(--mint)" {...INK} />
  </>
) };

const PROPS: RoomProp[] = [
  bed,
  // 협탁 + 스탠드 (침대 오른쪽)
  prop('nightstand', 176, 200, 44, 70, (
    <>
      <rect x="6" y="36" width="32" height="30" rx="5" fill="var(--rm-wood)" {...INK} />
      <path d="M12 50 h20" stroke="var(--rm-wood-2)" strokeWidth="3" strokeLinecap="round" />
      <path d="M22 36 v-12" fill="none" {...INK2} />
      <path d="M8 24 h28 l-6 -18 h-16 z" fill="var(--sun)" {...INK2} />
    </>
  ), { base: 198 }),
  // 부엌 카운터 (오른쪽 위): 윗판 + 앞면(서랍) + 가스레인지·냄비(김)·싱크대
  { key: 'kitchen', x: 214, y: 116, w: 164, h: 114, base: 228, node: (
    <>
      <rect x="4" y="60" width="156" height="50" rx="6" fill="var(--rm-cream)" {...INK} />
      <rect x="4" y="60" width="156" height="10" fill="var(--rm-wood-2)" />
      <path d="M22 84 h36 M22 98 h36 M78 84 h36 M78 98 h36 M130 84 h20 M130 98 h20" stroke="var(--rm-wood-2)" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
      <rect x="2" y="40" width="160" height="26" rx="8" fill="var(--paper-2)" {...INK} />
      {/* 가스레인지 */}
      <rect x="14" y="44" width="56" height="18" rx="4" fill="var(--night)" {...INK2} />
      <circle cx="28" cy="53" r="5" fill="var(--night-2)" stroke="var(--card)" strokeWidth="2" />
      <circle cx="56" cy="53" r="5" fill="var(--night-2)" stroke="var(--card)" strokeWidth="2" />
      {/* 냄비 + 김 */}
      <rect x="18" y="24" width="24" height="16" rx="3" fill="var(--coral)" {...INK2} />
      <rect x="14" y="20" width="32" height="7" rx="3" fill="var(--night-2)" {...INK2} />
      <Steam x={30} y={18} />
      {/* 싱크대 */}
      <rect x="96" y="44" width="52" height="18" rx="6" fill="var(--sky-2)" {...INK2} />
      <path d="M122 44 v-14 q0 -8 8 -8 h6" fill="none" {...INK2} />
      <path d="M118 16 h16" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      {/* 컵 */}
      <path d="M80 30 h10 l-1 10 h-8 z" fill="var(--paper)" {...INK2} />
    </>
  ) },
  plant(196, 262, 'var(--sun)'),
  // 내 책상 (왼쪽 가운데): 등받이 의자 둘 뒤에, 책상 앞에
  chairBack(150, 368), chairBack(104, 368),
  { key: 'desk', x: 128 - desk.cx, y: 376 - desk.cy, w: desk.w, h: desk.h, base: 428, node: desk.node },
  // 소파 (오른쪽 아래) + 쿠션
  sofaBack, sofaSeat,
  // 문 앞 매트 (오른쪽 아래 구석)
  mat(292, 520, 'var(--sun)', 'var(--sun-2)'),
];

/** 뒷벽과 바닥 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    {/* 마루 */}
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-plank)`} />
    {/* 창에서 떨어지는 햇빛 */}
    <path d="M30 100 h116 l40 120 h-150 z" fill="var(--card)" opacity=".4" />
    <Rug cx={128} cy={396} rx={112} ry={52} fill="var(--sun-2)" line="var(--sun)" />
    <Wall fill="var(--sky-2)" trim="var(--rm-wood-2)" base="var(--rm-wood)">
      <Window x={28} y={22} id={ID} curtain="var(--sun-2)" />
      {/* 시계 */}
      <circle cx="232" cy="46" r="18" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M232 46 v-11 M232 46 h8" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      {/* 선반 + 액자·책 */}
      <rect x="284" y="56" width="88" height="6" rx="3" fill="var(--rm-wood)" stroke="var(--ink)" strokeWidth="3" />
      <rect x="292" y="30" width="24" height="26" rx="3" fill="var(--coral-2)" stroke="var(--ink)" strokeWidth="2.5" />
      <circle cx="304" cy="43" r="6" fill="var(--sun)" />
      <rect x="326" y="34" width="8" height="22" rx="2" fill="var(--mint)" stroke="var(--ink)" strokeWidth="2.5" />
      <rect x="336" y="30" width="8" height="26" rx="2" fill="var(--coral)" stroke="var(--ink)" strokeWidth="2.5" />
      <rect x="346" y="36" width="8" height="20" rx="2" fill="var(--sky)" stroke="var(--ink)" strokeWidth="2.5" />
    </Wall>
  </svg>
);

/** 집·친구 집 문장 → 큐 (sim/actlog.ts MIDDLE.home·friend_home + 공통 기본 문장과 짝). '집.'·'도착'·돈 줄은 prefix로 */
const CUES: Record<string, Cue> = {
  '뒹굴거림': { go: 'bed', then: 'seat', pose: 'sit', say: '뒹굴뒹굴' },
  '음악 틀어놓음': { say: '♪♪', kind: 'notes', pose: 'happy' },
  '설거지함': { go: 'kitchen', then: 'seat', at: 'kitchen', say: '🧽' },
  '낮잠 잠깐': { go: 'bed', then: 'seat', pose: 'sit', say: '💤' },
  '게임 한 판': { go: 'side', then: 'seat', pose: 'sit', say: '🎮' },
  '간식 꺼내옴': { go: 'kitchen', then: 'seat', at: 'kitchen', say: '🍪' },
  '수다 중': { say: '💬', pose: 'happy' },
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'bed', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('집.')) return { go: 'bed', then: 'seat', say: '휴' };
  if (line.text.startsWith('도착')) return { go: 'kitchen', then: 'seat', at: 'kitchen', say: '안녕!' };
  if (/원 씀$/.test(line.text)) return { go: 'door', then: 'seat', at: 'door', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const HOME: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    kitchen: { x: 296, y: 268 },
    bed: { x: 84, y: 240 },
    seat: { x: 150, y: 372 },
    friend: { x: 104, y: 372 },
    side: { x: 292, y: 446 },
    met: { x: 352, y: 452 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'kitchen', pose: 'idle' }, { spot: 'bed', pose: 'think' }, { spot: 'door', pose: 'idle' }],
  seatItem: { x: 150, y: 366, base: 429 },
  cueOf,
};
