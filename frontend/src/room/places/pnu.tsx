// ─── 부산대학교 (장소별 방, ADR-0015 개정 4) ───────────────────────────────────
// 390×560. 대학본부 앞 야외 캠퍼스. 위 띠 0..96은 하늘과 본부 건물(흰 석조·창 격자·파란 현수막·깃발), 그 아래 계단(96..134)과 보도,
// 잔디 마당에 벤치(내 자리)·안내판·가로등·나무. 학교는 actlog에 전용 문장이 없어 큐는 도서관 방의 것을 쓰되 서가(shelf)는 안내판(label),
// 대출대(counter)는 건물 앞(front)으로.
import type { Cue, RoomProp, RoomSpec, Zone } from '../Room';
import { INK, INK2, Horizon, Patterns, benchSeat, bush, mat, prop, tree } from '../parts';
import { cueOf as libraryCueOf } from '../library';
import type { LogLine } from '../../sim/actlog';

const ID = 'rm-pnu';

const PROPS: RoomProp[] = [
  // 안내판 (왼쪽 가운데): 기둥 둘 + 판 + 종이
  prop('label', 60, 214, 84, 96, (
    <>
      <path d="M14 96 v-58 M70 96 v-58" fill="none" {...INK} />
      <rect x="4" y="4" width="76" height="52" rx="5" fill="var(--rm-wood)" {...INK} />
      <rect x="10" y="10" width="64" height="40" rx="3" fill="var(--rm-cream)" {...INK2} />
      <rect x="16" y="16" width="22" height="16" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.5" />
      <rect x="44" y="20" width="22" height="20" fill="var(--sky-2)" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M19 22 h16 M19 27 h10" stroke="var(--ink-3)" strokeWidth="1.5" />
    </>
  ), { base: 212 }),
  // 가로등 (오른쪽 위)
  prop('lamp', 300, 262, 30, 120, (
    <>
      <path d="M15 120 v-96" fill="none" {...INK} />
      <path d="M9 24 h12 l-2 -14 h-8 z" fill="var(--sun)" {...INK2} />
      <rect x="7" y="4" width="16" height="8" rx="3" fill="var(--night-2)" {...INK2} />
      <ellipse cx="15" cy="118" rx="10" ry="4" fill="var(--night-2)" {...INK2} />
    </>
  ), { base: 260 }),
  tree(352, 236, 0.9), bush(232, 300, 0.8),
  // 내 자리: 긴 벤치 (둘이 앉는다), 인물 뒤에 선다
  ...benchSeat(127, 372, 150),
  // 옆 벤치 (오른쪽 아래)
  ...benchSeat(292, 452, 110),
  bush(40, 480, 1), tree(60, 560, 0.8),
  // 나가는 길 매트 대신 보도블록
  mat(292, 520, 'var(--paper-2)', 'var(--line)'),
];

/** 하늘 + 대학본부 + 계단·보도 + 잔디 */
const BACK = (
  <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
    <Patterns id={ID} />
    <rect x="0" y="96" width="390" height="464" fill={`url(#${ID}-grass)`} />
    {/* 보도: 계단에서 문까지 */}
    <path d="M150 134 h130 l60 426 h-200 z" fill="var(--paper-2)" opacity=".9" />
    <path d="M150 134 h130 l60 426 h-200 z" fill="none" stroke="var(--line)" strokeWidth="3" />
    <path d="M160 200 h130 M168 270 h132 M176 340 h136 M184 410 h140 M192 480 h144" stroke="var(--line)" strokeWidth="2" opacity=".8" />
    <Horizon far="M0 98 V84 h60 v14 Z M330 98 V86 h60 v12 Z">
      {/* 대학본부: 흰 석조 건물 + 창 격자 + 현수막 + 깃발 둘 */}
      <rect x="62" y="16" width="266" height="82" fill="#EEE9DD" stroke="var(--ink)" strokeWidth="3" />
      <rect x="62" y="16" width="266" height="8" fill="#D9D2C2" />
      <g fill="var(--sky-2)" stroke="var(--ink)" strokeWidth="1.5">
        {Array.from({ length: 5 }, (_, r) => Array.from({ length: 9 }, (_, c) => (
          <rect key={`${r}-${c}`} x={76 + c * 27} y={30 + r * 13} width="14" height="8" />
        )))}
      </g>
      <path d="M62 44 h266 M62 70 h266" stroke="#D9D2C2" strokeWidth="2" />
      {/* 현수막 */}
      <rect x="146" y="34" width="98" height="40" rx="3" fill="var(--night-2)" stroke="var(--ink)" strokeWidth="2.5" />
      <circle cx="195" cy="54" r="10" fill="none" stroke="var(--card)" strokeWidth="3" />
      <path d="M150 40 h14 M226 40 h14" stroke="var(--card)" strokeWidth="2" opacity=".7" />
      {/* 정문 */}
      <rect x="180" y="78" width="30" height="20" fill="var(--night)" stroke="var(--ink)" strokeWidth="2" />
      {/* 깃발 */}
      <path d="M40 98 v-52 M350 98 v-52" stroke="var(--ink)" strokeWidth="2.5" />
      {/* 태극기: 흰 바탕 + 태극(위 빨강·아래 파랑) + 사괘 넷 */}
      <rect x="40" y="46" width="26" height="17" fill="var(--card)" {...INK2} />
      <path d="M53 50.5 a4 4 0 0 1 0 8 a2 2 0 0 1 0 -4 a2 2 0 0 0 0 -4 z" fill="#0047A0" />
      <path d="M53 50.5 a4 4 0 0 0 0 8 a2 2 0 0 0 0 -4 a2 2 0 0 1 0 -4 z" fill="#CD2E3A" />
      <g stroke="var(--ink)" strokeWidth="1.2"><path d="M43 49 h4 M43 51 h4 M43 53 h4" /><path d="M59 49 h4 M59 51 h4 M59 53 h4" /><path d="M43 56 h4 M43 58 h4 M43 60 h4" /><path d="M59 56 h4 M59 58 h4 M59 60 h4" /></g>
      {/* 대학 깃발: 남색 바탕에 흰 원 */}
      <path d="M350 46 h22 l-4 7 l4 7 h-22 z" fill="var(--night-2)" {...INK2} /><circle cx="358" cy="53" r="3" fill="none" stroke="var(--card)" strokeWidth="1.5" />
    </Horizon>
    {/* 계단 3단 (건물 앞) */}
    <rect x="60" y="98" width="270" height="12" fill="#E4DDCC" stroke="var(--ink)" strokeWidth="2.5" />
    <rect x="52" y="110" width="286" height="12" fill="#DDD5C2" stroke="var(--ink)" strokeWidth="2.5" />
    <rect x="44" y="122" width="302" height="12" fill="#D6CDB8" stroke="var(--ink)" strokeWidth="2.5" />
  </svg>
);

/** 도서관 큐를 캠퍼스 자리로: 서가 → 안내판, 대출대 → 건물 앞 */
const MAP: Record<string, string> = { shelf: 'label', counter: 'front' };
function cueOf(line: LogLine): Cue | null {
  const c = libraryCueOf(line);
  if (!c) return null;
  return { ...c, ...(c.go ? { go: MAP[c.go] ?? c.go } : {}), ...(c.at ? { at: MAP[c.at] ?? c.at } : {}), ...(c.then ? { then: MAP[c.then] ?? c.then } : {}) };
}

const ZONES: Zone[] = [
  { key: 'front', x: 44, y: 96, w: 302, h: 90, spots: ['front'], say: '🏫', label: '대학본부 앞' },
  { key: 'label', x: 10, y: 150, w: 100, h: 120, spots: ['label'], pose: 'think', say: '📋', label: '안내판' },
  { key: 'seat', x: 40, y: 320, w: 176, h: 100, spots: ['seat', 'friend'], label: '벤치' },
  { key: 'side', x: 230, y: 400, w: 124, h: 92, spots: ['side'], pose: 'sit', label: '옆 벤치' },
];

export const PNU: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    front: { x: 195, y: 176 },
    label: { x: 60, y: 256 },
    seat: { x: 150, y: 372 },
    friend: { x: 104, y: 372 },
    side: { x: 292, y: 452 },
    met: { x: 352, y: 452 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  strolls: [{ spot: 'front', pose: 'idle' }, { spot: 'label', pose: 'think' }, { spot: 'door', pose: 'idle' }],
  seatItem: { x: 150, y: 380, base: 429 },
  zones: ZONES,
  cueOf,
};
