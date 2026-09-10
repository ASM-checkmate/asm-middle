// ─── 쇼핑몰 방 (ADR-0015 개정 3) ─────────────────────────────────────────────
// 390×560. 뒷벽(쇼윈도 둘·층 안내) 0..96, 타일 바닥 96..560. 에스컬레이터는 오른쪽 위, 안내판은 가운데 위, 아트리움 벤치는 왼쪽
// 가운데(앉는 자리), 옆 벤치는 오른쪽 아래, 입구는 오른쪽 아래 구석. 영화관·오락실·역·공항·항구도 이 방을 쓴다 (scenes MAP).
// 로그 줄(MIDDLE.mall): 한 층 더 올라감 → 에스컬레이터, 아이쇼핑 → 쇼윈도, 다리 아픔 → 벤치. 영화관 줄은 벤치에서 표시만.
import type { Cue, RoomProp, RoomSpec } from './Room';
import type { LogLine } from '../sim/actlog';
import { INK, INK2, Patterns, Wall, Window, Sign, Cup, Steam, bench, plant, prop, mat, W, H, WALL } from './parts';

const ID = 'rm-mall';

/** 에스컬레이터: 위로 올라가는 계단 띠 + 난간. (x, y)는 아래 입구 가운데 */
const escalator = (x: number, y: number): RoomProp => prop(`escalator-${x}-${y}`, x, y, 110, 130, (
  <>
    {/* 계단 띠 (위로 갈수록 좁아진다) */}
    <path d="M14 126 L96 126 L78 8 L32 8 Z" fill="var(--night-2)" {...INK} />
    {[20, 38, 56, 74, 92, 110].map((yy, i) => {
      const t = (126 - yy) / 118;
      const half = 41 - 18 * t;
      return <path key={i} d={`M${55 - half} ${yy} h${half * 2}`} stroke="var(--card)" strokeWidth="3" strokeLinecap="round" opacity=".55" />;
    })}
    {/* 난간 */}
    <path d="M8 126 L28 4" fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
    <path d="M8 126 L28 4" fill="none" stroke="var(--sun)" strokeWidth="2" strokeLinecap="round" />
    <path d="M102 126 L82 4" fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
    <path d="M102 126 L82 4" fill="none" stroke="var(--sun)" strokeWidth="2" strokeLinecap="round" />
    {/* 위층 표시 */}
    <rect x="34" y="0" width="42" height="12" rx="4" fill="var(--card)" {...INK2} />
    <path d="M55 3 l-4 6 h8 z" fill="var(--coral)" />
  </>
), { base: y });

/** 안내판 (층 안내): 기둥 위 판 */
const board = (x: number, y: number): RoomProp => prop(`board-${x}-${y}`, x, y, 60, 96, (
  <>
    <ellipse cx="30" cy="92" rx="18" ry="4" fill="var(--ink)" opacity=".12" />
    <rect x="26" y="58" width="8" height="32" rx="3" fill="var(--rm-wood-2)" {...INK2} />
    <rect x="4" y="4" width="52" height="58" rx="7" fill="var(--night)" {...INK} />
    <rect x="10" y="10" width="40" height="10" rx="3" fill="var(--sun)" />
    <path d="M12 28 h36 M12 36 h28 M12 44 h34 M12 52 h22" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
  </>
), { base: y });

/** 매장 앞 진열대: 상자 + 상품 */
const display = (x: number, y: number): RoomProp => prop(`display-${x}-${y}`, x, y, 90, 60, (
  <>
    <rect x="4" y="26" width="82" height="30" rx="6" fill="var(--rm-cream)" {...INK} />
    <rect x="4" y="26" width="82" height="8" fill="var(--rm-wood)" />
    <rect x="12" y="6" width="22" height="22" rx="4" fill="var(--coral-2)" {...INK2} />
    <rect x="40" y="10" width="18" height="18" rx="4" fill="var(--mint-2)" {...INK2} />
    <rect x="62" y="2" width="18" height="26" rx="4" fill="var(--sun-2)" {...INK2} />
  </>
), { base: y });

/** 팝콘 부스 (영화관 줄용): 카트 + 김 */
const popcorn = (x: number, y: number): RoomProp => prop(`popcorn-${x}-${y}`, x, y, 70, 90, (
  <>
    <rect x="8" y="46" width="54" height="40" rx="6" fill="var(--coral)" {...INK} />
    <path d="M14 56 v22 M26 56 v22 M38 56 v22 M50 56 v22" stroke="var(--card)" strokeWidth="5" strokeLinecap="round" opacity=".8" />
    <rect x="12" y="16" width="46" height="32" rx="5" fill="var(--sky-2)" {...INK} />
    <circle cx="24" cy="30" r="5" fill="var(--sun)" /><circle cx="36" cy="26" r="5" fill="var(--sun)" /><circle cx="46" cy="32" r="5" fill="var(--sun)" />
    <Steam x={35} y={16} />
    <Cup x={64} y={40} fill="var(--sun)" />
  </>
), { base: y });

const PROPS: RoomProp[] = [
  // 진열대 (왼쪽 위, 쇼윈도 아래)
  display(78, 158),
  // 안내판 (가운데 위)
  board(196, 190),
  // 팝콘 부스 (가운데 위, 안내판 오른쪽)
  popcorn(262, 178),
  // 에스컬레이터 (오른쪽 위)
  escalator(334, 226),
  // 화분 (왼쪽 가운데)
  plant(34, 300),
  // 아트리움 벤치 (왼쪽 가운데): 등판은 인물 뒤, 앉는 판은 인물 발 아래
  ...bench(130, 392, 128),
  // 옆 벤치 (오른쪽 아래)
  ...bench(292, 462, 96, 'var(--sky)'),
  // 화분 (오른쪽 아래)
  plant(360, 380, 'var(--mint)'),
  // 입구 매트 (오른쪽 아래 구석)
  mat(292, 520, 'var(--sun)', 'var(--sun-2)'),
];

/** 뒷벽과 바닥 */
const BACK = (
  <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    {/* 광택 타일 */}
    <rect x="0" y={WALL} width={W} height={H - WALL} fill={`url(#${ID}-tile)`} />
    {/* 아트리움 채광 (위에서 떨어지는 빛) */}
    <path d="M40 100 h190 l60 160 h-250 z" fill="var(--card)" opacity=".4" />
    {/* 벤치 아래 원형 러그 */}
    <ellipse cx="130" cy="410" rx="112" ry="52" fill="var(--sun-2)" opacity=".8" />
    <ellipse cx="130" cy="410" rx="96" ry="40" fill="none" stroke="var(--sun)" strokeWidth="3" strokeDasharray="10 8" opacity=".7" />
    <Wall fill="var(--card)" trim="var(--sky)" base="var(--sky-2)">
      {/* 쇼윈도 (왼쪽): 마네킹 셋 */}
      <rect x="20" y="22" width="118" height="60" rx="6" fill="var(--sky-2)" stroke="var(--ink)" strokeWidth="3" />
      {[44, 79, 114].map((cx, i) => (
        <g key={cx}>
          <circle cx={cx} cy="40" r="7" fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2.5" />
          <path d={`M${cx - 9} 50 h18 l-3 26 h-12 z`} fill={['var(--coral)', 'var(--mint)', 'var(--sun)'][i]} stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
        </g>
      ))}
      <Sign x={152} y={24} w={90} h={30} text="SALE" fill="var(--coral)" size={14} />
      {/* 층 안내 */}
      <Sign x={152} y={58} w={90} h={22} text="3F ▲" fill="var(--night)" size={11} />
      {/* 창 (오른쪽) */}
      <Window x={258} y={22} w={112} h={60} id={ID} curtain={null} />
    </Wall>
  </svg>
);

/** 쇼핑몰 문장 → 큐 (MIDDLE.mall·cinema와 짝). 도착·돈 줄은 prefix로 */
const CUES: Record<string, Cue> = {
  '한 층 더 올라감': { go: 'escalator', then: 'seat', at: 'escalator', say: '⬆ 3층' },
  '아이쇼핑 중': { go: 'window', then: 'seat', at: 'window', say: '👀 예쁘다', pose: 'think' },
  '다리 아픔': { go: 'seat', say: '🦵 아야', pose: 'think' },
  // 영화관
  '광고 끝남': { say: '🎬 시작!', pose: 'happy' },
  '중간쯤 봄': { say: '🍿' },
  '옆자리 부스럭거림': { at: 'side', say: '🍿 바스락', kind: 'notes', pose: 'think' },
  // 기본 줄 (오락실·역·공항·항구)
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'board', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'board', then: 'seat', at: 'board', say: '어디부터 볼까' };
  if (/원 씀$/.test(line.text)) return { go: 'counter', then: 'seat', at: 'counter', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const MALL: RoomSpec = {
  w: W, h: H,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    window: { x: 78, y: 200 },       // 쇼윈도·진열대 앞
    board: { x: 196, y: 232 },       // 안내판 앞
    counter: { x: 262, y: 222 },     // 팝콘 부스 앞 — 결제
    escalator: { x: 334, y: 262 },   // 에스컬레이터 아래
    seat: { x: 150, y: 404 },        // 벤치 앉는 판(base 402)보다 앞 — 판 위에 앉은 것으로 그려진다
    friend: { x: 104, y: 404 },
    side: { x: 292, y: 474 },
    met: { x: 356, y: 456 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'window', pose: 'think' }, { spot: 'escalator', pose: 'idle' }, { spot: 'board', pose: 'think' }],
  seatItem: { x: 150, y: 398, base: 406 },
  cueOf,
};
