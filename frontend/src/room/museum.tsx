// ─── 박물관 방 (ADR-0015 개정 3) ─────────────────────────────────────────────
// 390×560. 뒷벽(그림 둘·조명·안내) 0..96, 마루 바닥 96..560. 안내데스크는 오른쪽 위, 관람 벤치는 왼쪽 가운데(그림 A 앞),
// 조각상은 가운데, 그림 B는 이젤로 오른쪽 가운데, 옆 벤치는 오른쪽 아래, 입구는 오른쪽 아래 구석. 사찰도 이 방을 쓴다 (scenes MAP).
// 로그 줄(MIDDLE.museum): 한 방 더 봄 → 그림 B, 설명 읽음 → 설명판, 사진 찍음 → 📷.
import type { Cue, RoomProp, RoomSpec } from './Room';
import type { LogLine } from '../sim/actlog';
import { INK, INK2, Patterns, Wall, Sign, Cup, Steam, bench, plant, prop, mat, W, H, WALL } from './parts';

const ID = 'rm-museum';

/** 벽 그림: 액자 + 그림 (배경 svg 안에) */
const Painting = ({ x, y, w, h, kind }: { x: number; y: number; w: number; h: number; kind: 'sun' | 'sea' }) => (
  <>
    <rect x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx="5" fill="var(--rm-wood)" stroke="var(--ink)" strokeWidth="3" />
    <rect x={x} y={y} width={w} height={h} rx="2" fill={kind === 'sun' ? 'var(--sun-2)' : 'var(--sky-2)'} stroke="var(--ink)" strokeWidth="2.5" />
    {kind === 'sun' ? (
      <>
        <circle cx={x + w * 0.68} cy={y + h * 0.36} r={h * 0.18} fill="var(--sun)" stroke="var(--ink)" strokeWidth="2" />
        <path d={`M${x} ${y + h * 0.72} q${w * 0.25} -${h * 0.3} ${w * 0.5} 0 t${w * 0.5} 0 v${h * 0.28} h-${w} z`} fill="var(--leaf)" stroke="var(--ink)" strokeWidth="2" />
      </>
    ) : (
      <>
        <path d={`M${x} ${y + h * 0.55} q${w * 0.16} -${h * 0.2} ${w * 0.33} 0 t${w * 0.33} 0 t${w * 0.34} 0 v${h * 0.45} h-${w} z`} fill="var(--sky)" stroke="var(--ink)" strokeWidth="2" />
        <path d={`M${x + w * 0.4} ${y + h * 0.5} l${w * 0.12} -${h * 0.3} l${w * 0.12} ${h * 0.3} z`} fill="var(--coral)" stroke="var(--ink)" strokeWidth="2" />
      </>
    )}
    {/* 조명 */}
    <path d={`M${x + w / 2 - 10} ${y - 12} h20`} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
    <path d={`M${x + w / 2 - 14} ${y - 4} l14 -8 l14 8`} fill="var(--sun)" opacity=".35" />
  </>
);

/** 이젤 위 그림 (바닥에 선다): 다리 셋 + 캔버스. (x, y)는 다리 아래 가운데 */
const easel = (x: number, y: number): RoomProp => prop(`easel-${x}-${y}`, x, y, 90, 130, (
  <>
    <path d="M45 60 L18 126 M45 60 L72 126 M45 70 L45 118" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
    <path d="M45 60 L18 126 M45 60 L72 126" fill="none" stroke="var(--rm-wood)" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="10" y="4" width="70" height="66" rx="4" fill="var(--rm-wood)" {...INK} />
    <rect x="16" y="10" width="58" height="54" rx="2" fill="var(--coral-3)" stroke="var(--ink)" strokeWidth="2.5" />
    <circle cx="36" cy="30" r="9" fill="var(--coral)" stroke="var(--ink)" strokeWidth="2" />
    <circle cx="56" cy="44" r="7" fill="var(--mint)" stroke="var(--ink)" strokeWidth="2" />
    <rect x="22" y="48" width="16" height="10" rx="2" fill="var(--sun)" stroke="var(--ink)" strokeWidth="2" />
    <rect x="4" y="66" width="82" height="8" rx="3" fill="var(--rm-wood-2)" {...INK2} />
  </>
), { base: y });

/** 조각상: 받침대 + 흉상 */
const statue = (x: number, y: number): RoomProp => prop(`statue-${x}-${y}`, x, y, 70, 120, (
  <>
    <rect x="12" y="82" width="46" height="36" rx="4" fill="var(--rm-cream)" {...INK} />
    <rect x="8" y="76" width="54" height="10" rx="3" fill="var(--paper-2)" {...INK} />
    <path d="M22 76 v-14 q13 -12 26 0 v14 z" fill="var(--paper-2)" {...INK} />
    <circle cx="35" cy="42" r="16" fill="var(--paper-2)" {...INK} />
    <path d="M22 34 q13 -14 26 0" fill="var(--rm-wood-2)" {...INK2} />
    <circle cx="30" cy="44" r="1.8" fill="var(--ink)" /><circle cx="40" cy="44" r="1.8" fill="var(--ink)" />
    <path d="M33 50 q2 2 4 0" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
    {/* 관람선 기둥 둘 + 줄 */}
    <path d="M2 92 v26 M68 92 v26" fill="none" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
    <path d="M2 100 q33 14 66 0" fill="none" stroke="var(--coral)" strokeWidth="3" strokeLinecap="round" />
  </>
), { base: y });

/** 설명판 (기둥 위 비스듬한 판) */
const label = (x: number, y: number): RoomProp => prop(`label-${x}-${y}`, x, y, 44, 70, (
  <>
    <rect x="18" y="34" width="8" height="34" rx="3" fill="var(--rm-wood-2)" {...INK2} />
    <path d="M4 34 L40 34 L36 6 L8 6 Z" fill="var(--rm-cream)" {...INK} />
    <path d="M12 14 h20 M12 20 h16 M12 26 h18" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" />
  </>
), { base: y });

/** 안내데스크: 윗판 + 앞면 + 팸플릿·커피 */
const desk = (x: number, y: number): RoomProp => prop(`desk-${x}-${y}`, x, y, 150, 100, (
  <>
    <rect x="4" y="52" width="142" height="46" rx="6" fill="var(--night)" {...INK} />
    <rect x="4" y="52" width="142" height="10" fill="var(--night-2)" />
    <text x="75" y="84" textAnchor="middle" fontSize="12" fontFamily="var(--display)" fill="var(--card)">INFO</text>
    <rect x="2" y="34" width="146" height="24" rx="8" fill="var(--rm-cream)" {...INK} />
    {/* 팸플릿 */}
    <rect x="18" y="16" width="30" height="22" rx="3" fill="var(--coral-2)" {...INK2} />
    <rect x="24" y="12" width="30" height="22" rx="3" fill="var(--mint-2)" {...INK2} />
    {/* 티켓 통 */}
    <rect x="70" y="18" width="34" height="20" rx="4" fill="var(--sun-2)" {...INK2} />
    <path d="M76 26 h22" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" />
    {/* 커피 + 김 */}
    <Cup x={128} y={30} fill="var(--paper)" />
    <Steam x={128} y={14} />
  </>
), { base: y });

const PROPS: RoomProp[] = [
  // 설명판 (왼쪽 위, 그림 A 아래)
  label(190, 160),
  // 안내데스크 (오른쪽 위)
  desk(300, 210),
  // 화분 (왼쪽 위 구석)
  plant(30, 170, 'var(--mint)'),
  // 관람 벤치 (왼쪽 가운데, 그림 A 앞)
  ...bench(130, 392, 128, 'var(--night-2)'),
  // 조각상 (가운데)
  statue(228, 330),
  // 이젤 그림 B (오른쪽 가운데)
  easel(346, 348),
  // 옆 벤치 (오른쪽 아래)
  ...bench(292, 462, 96, 'var(--night-2)'),
  // 입구 매트 (오른쪽 아래 구석)
  mat(292, 520, 'var(--night-2)', 'var(--coral-2)'),
];

/** 뒷벽과 바닥 */
const BACK = (
  <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    {/* 마루 */}
    <rect x="0" y={WALL} width={W} height={H - WALL} fill={`url(#${ID}-plank)`} />
    {/* 벤치 아래 러그 */}
    <ellipse cx="130" cy="410" rx="112" ry="52" fill="var(--coral-3)" />
    <ellipse cx="130" cy="410" rx="96" ry="40" fill="none" stroke="var(--coral-2)" strokeWidth="3" strokeDasharray="10 8" />
    {/* 조각상 아래 단 */}
    <rect x="182" y="322" width="92" height="20" rx="6" fill="var(--paper-2)" opacity=".8" />
    <Wall fill="var(--paper)" trim="var(--rm-wood-2)" base="var(--rm-wood)">
      {/* 그림 A (왼쪽) — 관람 벤치가 이 앞 */}
      <Painting x={38} y={28} w={110} h={54} kind="sun" />
      {/* 그림 B (가운데) */}
      <Painting x={178} y={30} w={74} h={50} kind="sea" />
      {/* 안내 */}
      <Sign x={272} y={26} w={100} h={30} text="MUSEUM" fill="var(--night)" size={13} />
      <Sign x={272} y={60} w={100} h={22} text="🔇 조용히" fill="var(--sun-2)" color="var(--ink)" size={11} />
    </Wall>
  </svg>
);

/** 박물관 문장 → 큐 (MIDDLE.museum과 짝). 도착·돈 줄은 prefix로 */
const CUES: Record<string, Cue> = {
  '한 방 더 봄': { go: 'easel', then: 'seat', at: 'easel', say: '🖼️ 다음 방', pose: 'think' },
  '설명 읽음': { go: 'label', then: 'seat', at: 'label', say: '📖 흠…', pose: 'think' },
  '사진 찍음': { go: 'statue', then: 'seat', at: 'statue', say: '📷 찰칵', pose: 'happy' },
  // 기본 줄 (사찰)
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'statue', then: 'seat', pose: 'think', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'seat' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'desk', then: 'seat', at: 'desk', say: '입장권 하나요' };
  if (/원 씀$/.test(line.text)) return { go: 'desk', then: 'seat', at: 'desk', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const MUSEUM: RoomSpec = {
  w: W, h: H,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    desk: { x: 300, y: 250 },       // 안내데스크 앞 — 입장·결제
    label: { x: 150, y: 190 },      // 설명판 옆
    easel: { x: 346, y: 384 },      // 이젤 그림 앞
    statue: { x: 228, y: 370 },     // 조각상 앞 (관람선 밖)
    seat: { x: 150, y: 404 },        // 벤치 앉는 판(base 402)보다 앞 — 판 위에 앉은 것으로 그려진다
    friend: { x: 104, y: 404 },
    side: { x: 292, y: 474 },
    met: { x: 356, y: 456 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'easel', pose: 'think' }, { spot: 'label', pose: 'think' }, { spot: 'desk', pose: 'idle' }],
  seatItem: { x: 150, y: 398, base: 406 },
  cueOf,
};
