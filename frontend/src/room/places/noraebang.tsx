// ─── 코인노래방 부산대점 (장소별 방, ADR-0015 개정 4 · 공시생 데모) ──────────────────
// 390×560. 어두운 방. 뒷벽 0..96은 큰 화면(가사·점수)과 네온 띠, 바닥은 어두운 카펫. 내 자리는 화면 앞(서서 핸드마이크로 부른다 — seat이 'mic', 자세 sing),
// 왼쪽 아래 소파와 낮은 테이블(노래책·탬버린·물), 오른쪽 위 코인 기계. 마이크는 핸드마이크 — 캐릭터의 sing 자세가 손에 든다(스탠드 없음, 오너). 큐는 actlog의 오락실 문장(arcade)으로 — 코인 넣기·한 곡 더·점수.
import type { Cue, RoomProp, RoomSpec, Zone } from '../Room';
import { INK, INK2, Patterns, mat, prop } from '../parts';
import type { LogLine } from '../../sim/actlog';

const ID = 'rm-nrb';
const NEON = '#FF5CC8', NEON2 = '#5CE1FF';

/** 소파 (등판은 인물 뒤, 앉는 판은 앞) */
const SOFA_BACK: RoomProp = { key: 'sofa-back', x: 40, y: 400, w: 150, h: 40, base: 398, node: (
  <rect x="3" y="3" width="144" height="34" rx="10" fill="#6B2E8C" {...INK} />
) };
const SOFA_SEAT: RoomProp = { key: 'sofa-seat', x: 40, y: 432, w: 150, h: 34, base: 468, node: (
  <>
    <rect x="3" y="3" width="144" height="22" rx="8" fill="#8A3DB3" {...INK} />
    <path d="M14 26 v6 M136 26 v6" fill="none" {...INK} />
  </>
) };

const PROPS: RoomProp[] = [
  // 코인 기계 (오른쪽 위): 노란 상자 + 동전 구멍 + COIN
  prop('coin', 306, 250, 76, 110, (
    <>
      <rect x="6" y="14" width="64" height="94" rx="6" fill="#F5C242" {...INK} />
      <rect x="6" y="14" width="64" height="12" rx="6" fill="#D9A21B" />
      <rect x="14" y="34" width="48" height="26" rx="4" fill="var(--night)" {...INK2} />
      <text x="38" y="52" textAnchor="middle" fontSize="12" fontWeight="700" fontFamily="var(--display)" fill={NEON2}>COIN</text>
      <rect x="30" y="70" width="16" height="5" rx="2" fill="var(--night)" />
      <circle cx="22" cy="90" r="6" fill="var(--sun)" {...INK2} />
      <circle cx="54" cy="90" r="6" fill="var(--sun)" {...INK2} />
      <path d="M30 4 l16 -4 v14 l-16 4 z" fill={NEON} {...INK2} />
    </>
  ), { base: 250 }),
  // 낮은 테이블 (소파 앞): 노래책 + 탬버린 + 물병
  prop('lowtable', 115, 500, 130, 44, (
    <>
      <path d="M14 30 v12 M116 30 v12" fill="none" {...INK} />
      <rect x="4" y="18" width="122" height="14" rx="4" fill="#3A2A5A" {...INK} />
      <rect x="4" y="4" width="122" height="18" rx="6" fill="#4D3878" {...INK} />
      {/* 노래책 */}
      <rect x="14" y="0" width="34" height="12" rx="2" fill="var(--coral)" {...INK2} />
      <path d="M20 6 h22" stroke="var(--card)" strokeWidth="2" strokeLinecap="round" />
      {/* 탬버린 */}
      <circle cx="74" cy="8" r="10" fill="var(--sun)" {...INK2} /><circle cx="74" cy="8" r="6" fill="var(--card)" opacity=".7" />
      <circle cx="66" cy="4" r="1.6" fill="var(--ink)" /><circle cx="82" cy="4" r="1.6" fill="var(--ink)" /><circle cx="74" cy="17" r="1.6" fill="var(--ink)" />
      {/* 물병 */}
      <rect x="98" y="-6" width="10" height="20" rx="3" fill={NEON2} {...INK2} /><rect x="99" y="-10" width="8" height="5" rx="1.5" fill="var(--card)" {...INK2} />
    </>
  ), { base: 500, cy: 44 }),
  SOFA_BACK, SOFA_SEAT,
  // 스피커 둘 (화면 양옆 바닥)
  prop('spk-l', 30, 170, 40, 70, (
    <>
      <rect x="4" y="4" width="32" height="64" rx="5" fill="var(--night)" {...INK} />
      <circle cx="20" cy="22" r="8" fill="var(--night-2)" {...INK2} /><circle cx="20" cy="46" r="11" fill="var(--night-2)" {...INK2} />
      <circle cx="20" cy="46" r="4" fill={NEON} />
    </>
  ), { base: 170 }),
  prop('spk-r', 362, 170, 40, 70, (
    <>
      <rect x="4" y="4" width="32" height="64" rx="5" fill="var(--night)" {...INK} />
      <circle cx="20" cy="22" r="8" fill="var(--night-2)" {...INK2} /><circle cx="20" cy="46" r="11" fill="var(--night-2)" {...INK2} />
      <circle cx="20" cy="46" r="4" fill={NEON2} />
    </>
  ), { base: 170 }),
  mat(292, 520, '#8A3DB3', '#4D3878'),
];

/** 어두운 뒷벽: 큰 화면(가사·점수) + 네온 띠 + 미러볼, 바닥은 어두운 카펫 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    <defs>
      <pattern id={`${ID}-carpet`} width="28" height="28" patternUnits="userSpaceOnUse">
        <rect width="28" height="28" fill="#2A1F45" />
        <circle cx="14" cy="14" r="2" fill="#3A2A5A" />
        <circle cx="0" cy="0" r="1.2" fill={NEON} opacity=".35" /><circle cx="28" cy="28" r="1.2" fill={NEON2} opacity=".35" />
      </pattern>
      <radialGradient id={`${ID}-glow`} cx="50%" cy="20%" r="70%">
        <stop offset="0" stopColor={NEON} stopOpacity=".28" /><stop offset="1" stopColor={NEON} stopOpacity="0" />
      </radialGradient>
    </defs>
    {/* 바닥 */}
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-carpet)`} />
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-glow)`} />
    {/* 화면 빛이 바닥에 떨어진다 */}
    <path d="M90 100 h210 l40 130 h-290 z" fill={NEON2} opacity=".12" />
    {/* 뒷벽 */}
    <rect x="0" y="0" width="390" height="98" fill="#1A1433" />
    <rect x="0" y="0" width="390" height="14" fill="#0F0B22" />
    <rect x="0" y="86" width="390" height="12" fill="#2A1F45" />
    <path d="M0 14 h390 M0 86 h390 M0 98 h390" stroke="var(--ink)" strokeWidth="3" />
    {/* 네온 띠 */}
    <path d="M12 20 h366" stroke={NEON} strokeWidth="3" strokeLinecap="round" opacity=".9" />
    <path d="M12 26 h366" stroke={NEON2} strokeWidth="2" strokeLinecap="round" opacity=".6" />
    {/* 미러볼 */}
    <path d="M60 14 v10" stroke="var(--ink)" strokeWidth="2" />
    <circle cx="60" cy="34" r="11" fill="#C9D3E3" stroke="var(--ink)" strokeWidth="2.5" />
    <path d="M52 30 h16 M50 36 h20 M54 41 h12 M56 24 v20 M62 24 v20" stroke="#8FA4B8" strokeWidth="1.2" />
    <circle cx="57" cy="31" r="2" fill="var(--card)" />
    {/* 큰 화면: 가사 두 줄(하이라이트) + 점수 */}
    <rect x="96" y="28" width="198" height="56" rx="5" fill="var(--night)" stroke="var(--ink)" strokeWidth="3" />
    <rect x="100" y="32" width="190" height="48" rx="3" fill="#0B1E3A" />
    <rect x="100" y="32" width="190" height="48" rx="3" fill={NEON2} opacity=".12" />
    <rect x="110" y="40" width="70" height="7" rx="3" fill={NEON} />
    <rect x="184" y="40" width="60" height="7" rx="3" fill="var(--card)" opacity=".55" />
    <rect x="110" y="52" width="110" height="7" rx="3" fill="var(--card)" opacity=".55" />
    <text x="272" y="70" textAnchor="end" fontSize="16" fontWeight="700" fontFamily="var(--display)" fill="var(--sun)">97</text>
    <text x="284" y="70" textAnchor="end" fontSize="8" fontFamily="var(--display)" fill="var(--sun)">점</text>
    <text x="110" y="72" fontSize="8" fontFamily="var(--mono)" fill={NEON2}>♪ 01:12</text>
    {/* 화면 옆 작은 네온 글자 */}
    <text x="330" y="50" textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="var(--display)" fill={NEON}>노래</text>
    <text x="330" y="66" textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="var(--display)" fill={NEON2}>연습장</text>
    <rect x="308" y="36" width="44" height="36" rx="6" fill="none" stroke={NEON} strokeWidth="2" opacity=".8" />
  </svg>
);

/** 오락실 문장(actlog MIDDLE.arcade) → 큐: 코인은 기계로, 노래는 마이크에서 음표, 물은 소파에서 */
const CUES: Record<string, Cue> = {
  '코인 넣음': { go: 'coin', then: 'mic', at: 'coin', say: '🪙', kind: 'money' },
  '한 곡 더': { go: 'mic', say: '♪♪', kind: 'notes', pose: 'sing' },
  '점수 97점': { say: '97점!', kind: 'notes', pose: 'sing' },
  '물 마심': { go: 'sofa', then: 'mic', at: 'sofa', pose: 'sit', say: '💧' },
  '가만히 있음': { say: '…' },
  '주변 구경': { go: 'sofa', then: 'mic', pose: 'sit', say: '👀' },
  '시간 감': { say: '⏳' },
  '잠깐 앉음': { go: 'sofa', then: 'mic', pose: 'sit' },
  '생각 정리': { pose: 'think', say: '💭' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'coin', then: 'mic', at: 'coin', say: '🪙 코인' };
  if (/원 씀$/.test(line.text)) return { go: 'coin', then: 'mic', at: 'coin', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

const ZONES: Zone[] = [
  { key: 'mic', x: 96, y: 150, w: 200, h: 120, spots: ['mic', 'mic2'], pose: 'sing', say: '🎤', label: '노래 부르기' },
  { key: 'coin', x: 262, y: 150, w: 120, h: 110, spots: ['coin'], say: '🪙 코인', label: '코인 넣기' },
  { key: 'sofa', x: 40, y: 360, w: 150, h: 100, spots: ['sofa', 'sofa2'], pose: 'sit', label: '소파' },
];

export const NORAEBANG: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    // 내 자리는 마이크 앞 (서서 부른다) — 동행은 옆에
    mic: { x: 206, y: 262 }, mic2: { x: 150, y: 262 },
    coin: { x: 260, y: 262 },
    sofa: { x: 88, y: 440 }, sofa2: { x: 142, y: 440 },
    met: { x: 320, y: 470 },
  },
  seat: 'mic', friendSeat: 'mic2', metSpot: 'met', ghostSeat: 'sofa2', door: 'door',
  strolls: [{ spot: 'sofa', pose: 'sit' }, { spot: 'coin', pose: 'idle' }, { spot: 'door', pose: 'idle' }],
  // seatItem 없음: 마이크 앞엔 테이블이 없다
  zones: ZONES,
  cueOf,
};
