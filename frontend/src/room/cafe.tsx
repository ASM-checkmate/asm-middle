// ─── 카페 방 (ADR-0015) ──────────────────────────────────────────────────────
// 390×560. 뒷벽(창·메뉴판·선반) 0..96, 바닥 96..560. 카운터는 오른쪽 위, 내 테이블은 왼쪽 가운데, 옆 테이블은 오른쪽 아래, 입구는 오른쪽 아래 구석.
// 로그 줄(sim/actlog.ts의 카페 문장)이 곧 동선이다: 도착 → 카운터에서 주문·결제 → 자리에 앉아 활동 → 두 잔째는 카운터 → 창가 구경.
import type { ReactNode } from 'react';
import type { Cue, RoomProp, RoomSpec } from './Room';
import type { LogLine } from '../sim/actlog';

const INK = { stroke: 'var(--ink)', strokeWidth: 3, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;
const INK2 = { ...INK, strokeWidth: 2.5 } as const;

/** 둥근 테이블: 상판 타원 + 앞 테두리 + 기둥 + 받침. (0,0)이 상판 중심, base는 받침 아래 */
function Table({ rx, ry, cup, notes }: { rx: number; ry: number; cup?: boolean; notes?: boolean }): { node: ReactNode; w: number; h: number; cx: number; cy: number } {
  const w = rx * 2 + 8, h = ry * 2 + 46;
  const cx = w / 2, cy = ry + 4;
  return {
    w, h, cx, cy,
    node: (
      <>
        <rect x={cx - 6} y={cy + ry - 4} width="12" height="30" rx="3" fill="var(--rm-wood-2)" {...INK} />
        <ellipse cx={cx} cy={cy + ry + 28} rx={rx * 0.42} ry="6" fill="var(--rm-wood-2)" {...INK} />
        <path d={`M${cx - rx} ${cy} a${rx} ${ry} 0 0 0 ${rx * 2} 0 v8 a${rx} ${ry} 0 0 1 -${rx * 2} 0 z`} fill="var(--rm-wood-2)" {...INK} />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="var(--rm-wood)" {...INK} />
        {cup && (
          <g transform={`translate(${cx + rx * 0.3} ${cy - 4})`}>
            <path d="M-8 -6 h16 l-2 14 h-12 z" fill="var(--coral)" {...INK2} />
            <path d="M8 -3 a5 5 0 0 1 0 9" fill="none" {...INK2} />
            <path d="M-3 -10 q2 -4 0 -8 M3 -10 q2 -4 0 -8" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" opacity=".6" />
          </g>
        )}
        {notes && <text x={cx - rx * 0.4} y={cy - 2} fontSize="13" fill="var(--ink)">♪</text>}
      </>
    ),
  };
}

/** 스툴: 코랄 방석 + 앞면 + 다리 */
const stool = (x: number, y: number): RoomProp => ({
  key: `stool-${x}-${y}`, x: x - 18, y: y - 30, w: 36, h: 40, base: y + 8,
  node: (
    <>
      <path d="M6 18 v10 M30 18 v10" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M3 12 a15 8 0 0 0 30 0 v7 a15 8 0 0 1 -30 0 z" fill="var(--coral-2)" {...INK} />
      <ellipse cx="18" cy="12" rx="15" ry="8" fill="var(--coral)" {...INK} />
    </>
  ),
});

/** 등받이 의자의 등판만 — 앉은 인물 뒤에 선다 */
const chairBack = (x: number, y: number): RoomProp => ({
  key: `chair-${x}`, x: x - 20, y: y - 44, w: 40, h: 44, base: y - 44,
  node: <rect x="3" y="3" width="34" height="38" rx="9" fill="var(--rm-wood)" {...INK} />,
});

const main = Table({ rx: 62, ry: 24, cup: true });
const side = Table({ rx: 46, ry: 18, cup: true, notes: false });

const PROPS: RoomProp[] = [
  // 창가 벤치 (뒷벽 아래)
  { key: 'bench', x: 20, y: 98, w: 136, h: 36, base: 130, node: (
    <>
      <rect x="4" y="14" width="128" height="18" rx="5" fill="var(--rm-wood-2)" {...INK} />
      <rect x="2" y="2" width="132" height="18" rx="7" fill="var(--coral-2)" {...INK} />
      <rect x="12" y="6" width="26" height="10" rx="4" fill="var(--sun-2)" {...INK2} />
      <rect x="98" y="6" width="26" height="10" rx="4" fill="var(--mint-2)" {...INK2} />
    </>
  ) },
  // 화분 (창가 오른쪽)
  { key: 'plant', x: 160, y: 86, w: 48, h: 64, base: 148, node: (
    <>
      <path d="M12 40 h24 l-3 20 h-18 z" fill="var(--coral)" {...INK} />
      <rect x="9" y="34" width="30" height="9" rx="3" fill="var(--coral-2)" {...INK} />
      <path d="M24 36 v-16" fill="none" {...INK} />
      <ellipse cx="14" cy="18" rx="9" ry="12" fill="var(--leaf)" transform="rotate(-30 14 18)" {...INK2} />
      <ellipse cx="34" cy="14" rx="9" ry="12" fill="var(--leaf)" transform="rotate(30 34 14)" {...INK2} />
      <ellipse cx="24" cy="8" rx="8" ry="11" fill="var(--leaf)" {...INK2} />
    </>
  ) },
  // 카운터 (오른쪽 위): 윗판 + 앞면 + 커피머신·계산대·컵
  { key: 'counter', x: 214, y: 116, w: 164, h: 114, base: 228, node: (
    <>
      <rect x="4" y="60" width="156" height="50" rx="6" fill="var(--rm-cream)" {...INK} />
      <rect x="4" y="60" width="156" height="10" fill="var(--rm-wood-2)" />
      <path d="M22 78 h26 M22 92 h26 M62 78 h26 M62 92 h26 M102 78 h26 M102 92 h26" stroke="var(--rm-wood-2)" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
      <rect x="2" y="40" width="160" height="26" rx="8" fill="var(--rm-wood)" {...INK} />
      {/* 커피머신 */}
      <rect x="18" y="8" width="42" height="40" rx="6" fill="var(--night)" {...INK} />
      <rect x="26" y="16" width="26" height="8" rx="3" fill="var(--rm-cream)" />
      <circle cx="39" cy="34" r="4" fill="var(--sun)" />
      <path d="M62 30 h10 l-1 12 h-8 z" fill="var(--paper)" {...INK2} />
      {/* 계산대 */}
      <rect x="112" y="18" width="34" height="28" rx="5" fill="var(--rm-cream)" {...INK} />
      <rect x="117" y="23" width="24" height="9" rx="2" fill="var(--mint-2)" />
      <path d="M120 38 h18" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" />
      {/* 컵 탑 */}
      <path d="M84 36 h12 l-1 12 h-10 z M86 26 h10 l-1 10 h-8 z" fill="var(--paper)" {...INK2} />
    </>
  ) },
  // 내 테이블 (왼쪽 가운데): 등받이 의자 둘 뒤에, 테이블 앞에
  chairBack(150, 368), chairBack(104, 368),
  { key: 'table', x: 128 - main.cx, y: 376 - main.cy, w: main.w, h: main.h, base: 428, node: main.node },
  // 옆 테이블 (오른쪽 아래) + 스툴 둘
  stool(262, 454), stool(322, 454),
  { key: 'side', x: 292 - side.cx, y: 416 - side.cy, w: side.w, h: side.h, base: 462, node: side.node },
  // 입구 매트 (오른쪽 아래 구석) — 인물이 그 위에 선다
  { key: 'mat', x: 292, y: 520, w: 80, h: 34, base: 519, node: (
    <>
      <rect x="2" y="2" width="76" height="30" rx="6" fill="var(--coral-2)" {...INK} />
      <path d="M14 8 v18 M28 8 v18 M42 8 v18 M56 8 v18" stroke="var(--coral)" strokeWidth="6" strokeLinecap="round" opacity=".8" />
    </>
  ) },
];

/** 뒷벽과 바닥 */
const BACK = (
  <>
    <svg viewBox="0 0 390 560" width="390" height="560" style={{ left: 0, top: 0 }}>
      <defs>
        <pattern id="room-tile" width="36" height="36" patternUnits="userSpaceOnUse">
          <rect width="36" height="36" fill="var(--paper)" />
          <rect x="1.5" y="1.5" width="33" height="33" rx="4" fill="var(--paper-2)" opacity=".55" />
        </pattern>
      </defs>
      {/* 바닥 */}
      <rect x="0" y="96" width="390" height="464" fill="url(#room-tile)" />
      {/* 창에서 떨어지는 햇빛 */}
      <path d="M30 100 h116 l40 120 h-150 z" fill="var(--card)" opacity=".45" />
      {/* 러그 (내 테이블 아래) */}
      <ellipse cx="128" cy="396" rx="112" ry="52" fill="var(--mint-2)" opacity=".8" />
      <ellipse cx="128" cy="396" rx="96" ry="40" fill="none" stroke="var(--mint)" strokeWidth="3" strokeDasharray="10 8" opacity=".7" />
      {/* 뒷벽: 위 모서리(두께) + 벽면 + 걸레받이 */}
      <rect x="0" y="0" width="390" height="98" fill="var(--paper-2)" />
      <rect x="0" y="0" width="390" height="14" fill="var(--rm-wood-2)" />
      <rect x="0" y="86" width="390" height="12" fill="var(--rm-wood)" />
      <path d="M0 14 h390 M0 86 h390 M0 98 h390" stroke="var(--ink)" strokeWidth="3" />
      {/* 창 */}
      <rect x="28" y="22" width="124" height="60" rx="6" fill="var(--sky)" stroke="var(--ink)" strokeWidth="3" />
      <ellipse cx="60" cy="48" rx="16" ry="8" fill="var(--card)" /><ellipse cx="112" cy="38" rx="13" ry="7" fill="var(--card)" />
      <path d="M90 22 v60 M28 52 h124" stroke="var(--ink)" strokeWidth="3" />
      <path d="M28 22 q10 30 0 60 z M152 22 q-10 30 0 60 z" fill="var(--coral-2)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      <rect x="22" y="80" width="136" height="7" rx="3" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
      {/* 메뉴판 */}
      <rect x="190" y="24" width="84" height="48" rx="7" fill="var(--night)" stroke="var(--ink)" strokeWidth="3" />
      <text x="232" y="47" textAnchor="middle" fontSize="15" fontFamily="var(--display)" fill="var(--card)">MENU</text>
      <path d="M206 58 h52 M212 64 h40" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
      {/* 선반과 컵 */}
      <rect x="292" y="52" width="80" height="6" rx="3" fill="var(--rm-wood)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M300 40 h10 l-1 12 h-8 z M318 40 h10 l-1 12 h-8 z M336 40 h10 l-1 12 h-8 z M354 40 h10 l-1 12 h-8 z" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
      {/* 입구 표시 */}
      <rect x="300" y="66" width="62" height="16" rx="5" fill="var(--mint)" stroke="var(--ink)" strokeWidth="3" />
      <text x="331" y="78" textAnchor="middle" fontSize="10" fontFamily="var(--mono)" fill="var(--ink)">OPEN</text>
    </svg>
  </>
);

/** 카페 문장 → 큐 (sim/actlog.ts MIDDLE.cafe와 짝). 도착·돈 줄은 prefix로 */
const CUES: Record<string, Cue> = {
  '라떼 한 잔 시킴': { go: 'counter', then: 'seat', at: 'counter', say: '☕ 라떼 하나요' },
  '옆 테이블이 시끄러움': { at: 'side', say: '♪♪', kind: 'notes', pose: 'think' },
  '노트 꺼냄': { say: '📝' },
  '음악이 취향': { say: '♪ 좋다', pose: 'happy' },
  '두 잔째 고민 중': { go: 'counter', then: 'seat', at: 'counter', say: '☕ 한 잔 더?', pose: 'think' },
  '창밖 구경': { go: 'window', pose: 'think', say: '👀' },
};
function cueOf(line: LogLine): Cue | null {
  if (line.fx) return { kind: 'fx' };
  if (line.text.startsWith('도착')) return { go: 'counter', then: 'seat', at: 'counter', say: '주문할게요' };
  if (/원 씀$/.test(line.text)) return { go: 'counter', then: 'seat', at: 'counter', say: `−${line.text.replace(' 씀', '')}`, kind: 'money' };
  return CUES[line.text] ?? null;
}

export const CAFE: RoomSpec = {
  w: 390, h: 560,
  back: BACK,
  props: PROPS,
  spots: {
    door: { x: 332, y: 548 },
    counter: { x: 296, y: 268 },
    seat: { x: 150, y: 372 },
    friend: { x: 104, y: 372 },
    window: { x: 88, y: 152 },
    side: { x: 292, y: 446 },
    met: { x: 352, y: 452 },
  },
  seat: 'seat', friendSeat: 'friend', metSpot: 'met', ghostSeat: 'side', door: 'door',
  seatItem: { x: 150, y: 366, base: 429 },
  cueOf,
};
