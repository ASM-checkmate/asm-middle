// ─── 헬스장 방 (ADR-0015 개정 3) ─────────────────────────────────────────────
// 390×560. 뒷벽(거울·시계·안내판) 0..96, 고무 바닥 96..560. 러닝머신은 오른쪽 위, 내 매트(벤치)는 왼쪽 가운데, 물통대는 왼쪽 위,
// 옆 매트는 오른쪽 아래, 입구는 오른쪽 아래 구석. 로그 줄(sim/actlog.ts MIDDLE.gym): 20분 뜀 → 러닝머신, 물 마심 → 물통대.
import type { Cue, RoomProp, RoomSpec } from './Room';
import type { LogLine } from '../sim/actlog';
import { INK, INK2, Patterns, Wall, Sign, Steam, prop, mat, W, H, WALL } from './parts';

const ID = 'rm-gym';

/** 운동 매트: 바닥에 붙는 납작한 사각형 — 앉는 자리. (x, y)는 매트 앞 가운데 */
const gymMat = (x: number, y: number, color = 'var(--mint)', color2 = 'var(--mint-2)'): RoomProp => ({
  key: `mat-${x}-${y}`, x: x - 62, y: y - 44, w: 124, h: 50, base: y - 44,
  node: (
    <>
      <rect x="2" y="2" width="120" height="44" rx="8" fill={color2} {...INK} />
      <rect x="10" y="8" width="104" height="30" rx="6" fill="none" stroke={color} strokeWidth="3" strokeDasharray="8 6" opacity=".8" />
    </>
  ),
});

/** 러닝머신: 발판(뒤로 기울어진) + 손잡이 기둥 + 계기판. (x, y)는 발판 앞 가운데 */
const treadmill = (x: number, y: number): RoomProp => prop(`treadmill-${x}-${y}`, x, y, 96, 110, (
  <>
    {/* 발판 */}
    <path d="M12 70 L84 70 L92 104 L4 104 Z" fill="var(--night)" {...INK} />
    <path d="M18 76 h60 M16 84 h64 M14 92 h68" stroke="var(--night-2)" strokeWidth="3" strokeLinecap="round" />
    {/* 기둥 둘 + 손잡이 */}
    <path d="M22 70 L28 24 M74 70 L68 24" fill="none" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
    <path d="M22 70 L28 24 M74 70 L68 24" fill="none" stroke="var(--rm-cream)" strokeWidth="2" strokeLinecap="round" />
    <rect x="20" y="16" width="56" height="14" rx="6" fill="var(--rm-cream)" {...INK} />
    {/* 계기판 */}
    <rect x="30" y="0" width="36" height="22" rx="5" fill="var(--night)" {...INK} />
    <rect x="35" y="5" width="26" height="8" rx="2" fill="var(--mint)" />
    <circle cx="42" cy="17" r="1.8" fill="var(--coral)" /><circle cx="54" cy="17" r="1.8" fill="var(--sun)" />
  </>
), { base: y });

/** 덤벨 선반: 선반 + 덤벨 셋. (x, y)는 선반 앞 가운데 */
const rack = (x: number, y: number): RoomProp => prop(`rack-${x}-${y}`, x, y, 110, 56, (
  <>
    <path d="M10 34 v20 M100 34 v20" fill="none" {...INK} />
    <rect x="2" y="26" width="106" height="12" rx="4" fill="var(--rm-wood-2)" {...INK} />
    <rect x="2" y="6" width="106" height="24" rx="6" fill="var(--rm-wood)" {...INK} />
    {[20, 55, 90].map(cx => (
      <g key={cx} transform={`translate(${cx} 4)`}>
        <rect x="-11" y="-6" width="8" height="12" rx="2" fill="var(--night)" {...INK2} />
        <rect x="3" y="-6" width="8" height="12" rx="2" fill="var(--night)" {...INK2} />
        <path d="M-3 0 h6" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      </g>
    ))}
  </>
), { base: y });

/** 물통대: 정수기 + 물통(컵) — 한 모금 잔동작이 .room-cup을 든다. (x, y)는 아래 가운데 */
const cooler = (x: number, y: number): RoomProp => prop(`cooler-${x}-${y}`, x, y, 44, 84, (
  <>
    <rect x="6" y="30" width="32" height="52" rx="6" fill="var(--rm-cream)" {...INK} />
    <rect x="12" y="52" width="20" height="10" rx="3" fill="var(--sky-2)" {...INK2} />
    <path d="M8 6 a14 14 0 0 1 28 0 v24 h-28 z" fill="var(--sky)" {...INK} />
    <path d="M14 12 q4 -5 8 0" fill="none" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" />
    <g className="room-cup" transform="translate(40 68)">
      <path d="M-6 -12 h12 l-1.5 14 h-9 z" fill="var(--sky-2)" {...INK2} />
      <rect x="-7" y="-16" width="14" height="5" rx="2" fill="var(--sky)" {...INK2} />
    </g>
  </>
), { base: y });

/** 짐볼 */
const ball = (x: number, y: number, color = 'var(--coral)'): RoomProp => prop(`ball-${x}-${y}`, x, y, 46, 48, (
  <>
    <ellipse cx="23" cy="44" rx="16" ry="4" fill="var(--ink)" opacity=".12" />
    <circle cx="23" cy="22" r="20" fill={color} {...INK} />
    <path d="M12 14 q8 -6 16 -2" fill="none" stroke="var(--card)" strokeWidth="3" strokeLinecap="round" opacity=".7" />
  </>
), { base: y });

const PROPS: RoomProp[] = [
  // 물통대 (왼쪽 위)
  cooler(46, 200),
  // 덤벨 선반 (왼쪽 위, 벽 아래)
  rack(150, 150),
  // 러닝머신 (오른쪽 위)
  treadmill(300, 214),
  // 내 매트 (왼쪽 가운데): 인물 뒤에 깔린다
  gymMat(150, 400),
  // 옆 매트 (오른쪽 아래)
  gymMat(292, 470, 'var(--coral)', 'var(--coral-2)'),
  // 짐볼 (오른쪽 가운데)
  ball(356, 350),
  // 입구 매트 (오른쪽 아래 구석)
  mat(292, 520, 'var(--night-2)', 'var(--sky-2)'),
];

/** 뒷벽과 바닥 */
const BACK = (
  <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    {/* 고무 바닥 */}
    <rect x="0" y={WALL} width={W} height={H - WALL} fill={`url(#${ID}-rubber)`} />
    {/* 러닝 트랙 줄 (바닥 오른쪽) */}
    <path d="M236 250 v280 M366 250 v280" stroke="var(--sun)" strokeWidth="3" strokeDasharray="14 10" opacity=".5" />
    {/* 매트 아래 밝은 구역 */}
    <rect x="60" y="330" width="180" height="120" rx="16" fill="var(--night-2)" opacity=".5" />
    <Wall fill="var(--paper-2)" trim="var(--night)" base="var(--night-2)">
      {/* 거울 (왼쪽): 비친 방 — 하늘색 판 + 반사광 */}
      <rect x="24" y="22" width="150" height="60" rx="6" fill="var(--sky-2)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M40 76 L86 28 M60 76 L106 28" stroke="var(--card)" strokeWidth="6" strokeLinecap="round" opacity=".8" />
      <rect x="18" y="80" width="162" height="7" rx="3" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
      {/* 시계 */}
      <circle cx="222" cy="50" r="18" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M222 50 v-11 M222 50 h8" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      {/* 안내판 */}
      <Sign x={262} y={26} w={100} h={48} text="GYM" fill="var(--coral)" />
      {/* 벽 김: 사우나 문 틈 (오른쪽 끝) */}
      <rect x="372" y="34" width="14" height="52" rx="3" fill="var(--rm-wood-2)" stroke="var(--ink)" strokeWidth="3" />
      <Steam x={379} y={34} />
    </Wall>
  </svg>
);

/** 헬스장 문장 → 큐 (sim/actlog.ts MIDDLE.gym과 짝). 도착·돈 줄은 prefix로 */
const CUES: Record<string, Cue> = {
  '20분 뜀': { go: 'treadmill', then: 'seat', at: 'treadmill', say: '🏃 20분', pose: 'idle' },
  '기구 두 개 돎': { go: 'rack', then: 'seat', at: 'rack', say: '🏋️ 두 개', pose: 'idle' },
  '땀이 많이 남': { say: '💦', pose: 'happy' },
  '물 마심': { go: 'cooler', then: 'seat', at: 'cooler', say: '💧 꿀꺽', pose: 'idle' },
  // 기본 줄 (장소 유형 표에 없는 경기장 등)
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'mirror', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'desk', then: 'seat', at: 'desk', say: '체크인' };
  if (/원 씀$/.test(line.text)) return { go: 'desk', then: 'seat', at: 'desk', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const GYM: RoomSpec = {
  w: W, h: H,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    desk: { x: 312, y: 120 },        // 안내판 아래 — 체크인·결제
    treadmill: { x: 300, y: 250 },   // 러닝머신 발판 앞
    rack: { x: 150, y: 190 },
    cooler: { x: 86, y: 212 },
    mirror: { x: 100, y: 150 },
    seat: { x: 150, y: 404 },
    friend: { x: 104, y: 404 },
    side: { x: 292, y: 474 },
    met: { x: 352, y: 452 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'treadmill', pose: 'idle' }, { spot: 'cooler', pose: 'idle' }, { spot: 'mirror', pose: 'think' }],
  seatItem: { x: 150, y: 398, base: 406 },
  cueOf,
};
