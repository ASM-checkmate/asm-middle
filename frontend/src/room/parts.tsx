// ─── 방 공용 조각 (ADR-0015 개정 3) ─────────────────────────────────────────────
// 모든 방이 같은 선(잉크 3px, 둥근 모서리)과 같은 팔레트(tokens.css + room.css의 --rm-*)를 쓴다. 조각은 "왼쪽 위 모서리 기준의
// svg 조각 + 크기 + 바닥 접점 행(base)"인 RoomProp이거나, 그것을 만드는 함수다. 방 하나(390×560)는 뒷벽(실내) 또는 지평선(야외)
// 0..96 + 바닥 96..560이 기본이다. svg 안의 id(pattern·clipPath)는 방마다 접두사를 달리해 둘이 동시에 떠도 안 겹치게 한다.
import type { ReactNode } from 'react';
import type { RoomProp } from './Room';

export const W = 390, H = 560, WALL = 96;
export const INK = { stroke: 'var(--ink)', strokeWidth: 3, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;
export const INK2 = { ...INK, strokeWidth: 2.5 } as const;

/** 소품 하나를 (x, y)에 놓는다 — cx·cy는 조각 안에서 "발이 놓이는 점"(기본: 아래 가운데) */
export const prop = (key: string, x: number, y: number, w: number, h: number, node: ReactNode, opts: { base?: number; cx?: number; cy?: number } = {}): RoomProp => {
  const cx = opts.cx ?? w / 2, cy = opts.cy ?? h;
  return { key, x: x - cx, y: y - cy, w, h, base: opts.base ?? y, node };
};

// ── 바닥 무늬 (defs 안에 넣는다; id 접두사는 방마다) ──
export function Patterns({ id }: { id: string }) {
  return (
    <defs>
      {/* 타일 */}
      <pattern id={`${id}-tile`} width="36" height="36" patternUnits="userSpaceOnUse">
        <rect width="36" height="36" fill="var(--paper)" />
        <rect x="1.5" y="1.5" width="33" height="33" rx="4" fill="var(--paper-2)" opacity=".55" />
      </pattern>
      {/* 마루 */}
      <pattern id={`${id}-plank`} width="120" height="24" patternUnits="userSpaceOnUse">
        <rect width="120" height="24" fill="var(--rm-cream)" />
        <path d="M0 23.5 h120 M60 0 v12 M0 12 h60 M60 12 v12" stroke="var(--rm-wood)" strokeWidth="1.5" opacity=".7" />
      </pattern>
      {/* 잔디 */}
      <pattern id={`${id}-grass`} width="48" height="32" patternUnits="userSpaceOnUse">
        <rect width="48" height="32" fill="var(--leaf)" />
        <path d="M6 22 l3 -6 l3 6 M28 12 l3 -6 l3 6 M38 26 l3 -6 l3 6" fill="none" stroke="#6FB863" strokeWidth="2" strokeLinecap="round" />
      </pattern>
      {/* 모래 */}
      <pattern id={`${id}-sand`} width="40" height="28" patternUnits="userSpaceOnUse">
        <rect width="40" height="28" fill="var(--sun-2)" />
        <circle cx="8" cy="8" r="1.6" fill="var(--sun)" opacity=".8" /><circle cx="28" cy="18" r="1.6" fill="var(--sun)" opacity=".8" /><circle cx="18" cy="24" r="1.2" fill="var(--sun)" opacity=".6" />
      </pattern>
      {/* 물 */}
      <pattern id={`${id}-water`} width="64" height="24" patternUnits="userSpaceOnUse">
        <rect width="64" height="24" fill="var(--sky)" />
        <path d="M4 14 q8 -6 16 0 t16 0 t16 0 t16 0" fill="none" stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
      </pattern>
      {/* 고무 바닥 (헬스장) */}
      <pattern id={`${id}-rubber`} width="28" height="28" patternUnits="userSpaceOnUse">
        <rect width="28" height="28" fill="var(--night-2)" />
        <circle cx="14" cy="14" r="2" fill="var(--night)" />
      </pattern>
    </defs>
  );
}

/** 실내 뒷벽: 위 두께띠 + 벽면 + 걸레받이. 벽 색과 띠 색은 방마다 */
export function Wall({ fill = 'var(--paper-2)', trim = 'var(--rm-wood-2)', base = 'var(--rm-wood)', children }: { fill?: string; trim?: string; base?: string; children?: ReactNode }) {
  return (
    <>
      <rect x="0" y="0" width={W} height={WALL + 2} fill={fill} />
      <rect x="0" y="0" width={W} height="14" fill={trim} />
      <rect x="0" y={WALL - 10} width={W} height="12" fill={base} />
      <path d={`M0 14 h${W} M0 ${WALL - 10} h${W} M0 ${WALL + 2} h${W}`} stroke="var(--ink)" strokeWidth="3" />
      {children}
    </>
  );
}

/** 야외 지평선: 하늘 + 구름 두 개(흐른다) + 먼 것들(children) + 땅 경계선 */
export function Horizon({ far, children }: { far?: string; children?: ReactNode }) {
  return (
    <>
      <rect x="0" y="0" width={W} height={WALL + 2} fill="var(--sky)" />
      <rect x="0" y="0" width={W} height="40" fill="var(--sky-2)" opacity=".6" />
      <ellipse className="room-cloud" cx="70" cy="34" rx="22" ry="10" fill="var(--card)" />
      <ellipse className="room-cloud" cx="250" cy="24" rx="18" ry="9" fill="var(--card)" />
      {far && <path d={far} fill="var(--mint-2)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />}
      {children}
      <path d={`M0 ${WALL + 2} h${W}`} stroke="var(--ink)" strokeWidth="3" />
    </>
  );
}

/** 벽의 창: 하늘 + 구름 + 창살 + 커튼 */
export function Window({ x, y, w = 124, h = 60, id, curtain = 'var(--coral-2)' }: { x: number; y: number; w?: number; h?: number; id: string; curtain?: string | null }) {
  return (
    <>
      <clipPath id={`${id}-win`}><rect x={x} y={y} width={w} height={h} rx="6" /></clipPath>
      <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--sky)" stroke="var(--ink)" strokeWidth="3" />
      <g clipPath={`url(#${id}-win)`}>
        <ellipse className="room-cloud" cx={x + w * 0.26} cy={y + h * 0.43} rx="16" ry="8" fill="var(--card)" />
        <ellipse className="room-cloud" cx={x + w * 0.68} cy={y + h * 0.27} rx="13" ry="7" fill="var(--card)" />
      </g>
      <path d={`M${x + w / 2} ${y} v${h} M${x} ${y + h / 2} h${w}`} stroke="var(--ink)" strokeWidth="3" />
      {curtain && <path d={`M${x} ${y} q10 ${h / 2} 0 ${h} z M${x + w} ${y} q-10 ${h / 2} 0 ${h} z`} fill={curtain} stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />}
      <rect x={x - 6} y={y + h - 2} width={w + 12} height="7" rx="3" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
    </>
  );
}

/** 둥근 테이블: 상판 타원 + 앞 테두리 + 기둥 + 받침. (0,0)이 상판 중심, base는 받침 아래 */
export function Table({ rx, ry, cup, notes, top = 'var(--rm-wood)', side = 'var(--rm-wood-2)' }: { rx: number; ry: number; cup?: boolean; notes?: boolean; top?: string; side?: string }): { node: ReactNode; w: number; h: number; cx: number; cy: number } {
  const w = rx * 2 + 8, h = ry * 2 + 46;
  const cx = w / 2, cy = ry + 4;
  return {
    w, h, cx, cy,
    node: (
      <>
        <rect x={cx - 6} y={cy + ry - 4} width="12" height="30" rx="3" fill={side} {...INK} />
        <ellipse cx={cx} cy={cy + ry + 28} rx={rx * 0.42} ry="6" fill={side} {...INK} />
        <path d={`M${cx - rx} ${cy} a${rx} ${ry} 0 0 0 ${rx * 2} 0 v8 a${rx} ${ry} 0 0 1 -${rx * 2} 0 z`} fill={side} {...INK} />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={top} {...INK} />
        {cup && <Cup x={cx + rx * 0.3} y={cy - 4} />}
        {notes && <text x={cx - rx * 0.4} y={cy - 2} fontSize="13" fill="var(--ink)">♪</text>}
      </>
    ),
  };
}

/** 컵 (한 모금 잔동작이 .room-cup을 들어 올린다) */
export const Cup = ({ x, y, fill = 'var(--coral)' }: { x: number; y: number; fill?: string }) => (
  <g className="room-cup" transform={`translate(${x} ${y})`}>
    <path d="M-8 -6 h16 l-2 14 h-12 z" fill={fill} {...INK2} />
    <path d="M8 -3 a5 5 0 0 1 0 9" fill="none" {...INK2} />
    <path d="M-3 -10 q2 -4 0 -8 M3 -10 q2 -4 0 -8" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" opacity=".6" />
  </g>
);

/** 네모 테이블 (책상·식탁): 상판 + 앞면 + 다리 둘. (0,0)이 상판 중심 */
export function Desk({ w: tw, d, top = 'var(--rm-wood)', side = 'var(--rm-wood-2)', children }: { w: number; d: number; top?: string; side?: string; children?: ReactNode }): { node: ReactNode; w: number; h: number; cx: number; cy: number } {
  const w = tw + 8, h = d + 46, cx = w / 2, cy = d / 2 + 4;
  return {
    w, h, cx, cy,
    node: (
      <>
        <path d={`M${cx - tw / 2 + 6} ${cy + d / 2 + 6} v28 M${cx + tw / 2 - 6} ${cy + d / 2 + 6} v28`} fill="none" {...INK} />
        <rect x={cx - tw / 2} y={cy + d / 2 - 2} width={tw} height="10" rx="3" fill={side} {...INK} />
        <rect x={cx - tw / 2} y={cy - d / 2} width={tw} height={d} rx="6" fill={top} {...INK} />
        {children}
      </>
    ),
  };
}

/** 스툴: 방석 + 앞면 + 다리 */
export const stool = (x: number, y: number, color = 'var(--coral)', color2 = 'var(--coral-2)'): RoomProp => ({
  key: `stool-${x}-${y}`, x: x - 18, y: y - 30, w: 36, h: 40, base: y + 8,
  node: (
    <>
      <path d="M6 18 v10 M30 18 v10" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M3 12 a15 8 0 0 0 30 0 v7 a15 8 0 0 1 -30 0 z" fill={color2} {...INK} />
      <ellipse cx="18" cy="12" rx="15" ry="8" fill={color} {...INK} />
    </>
  ),
});

/** 등받이 의자의 등판만 — 앉은 인물 뒤에 선다 */
export const chairBack = (x: number, y: number, fill = 'var(--rm-wood)'): RoomProp => ({
  key: `chair-${x}-${y}`, x: x - 20, y: y - 44, w: 40, h: 44, base: y - 44,
  node: <rect x="3" y="3" width="34" height="38" rx="9" fill={fill} {...INK} />,
});

/** 긴 벤치 (공원·강변·역): 앉는 판 + 등판(뒤) + 다리. (x, y)는 앉는 판 앞 가운데 */
export const bench = (x: number, y: number, w = 120, color = 'var(--rm-wood)'): RoomProp[] => [
  { key: `benchback-${x}-${y}`, x: x - w / 2, y: y - 52, w, h: 30, base: y - 52, node: (
    <rect x="2" y="2" width={w - 4} height="22" rx="8" fill={color} {...INK} />
  ) },
  { key: `bench-${x}-${y}`, x: x - w / 2, y: y - 26, w, h: 40, base: y + 10, node: (
    <>
      <path d={`M14 24 v12 M${w - 14} 24 v12`} fill="none" {...INK} />
      <rect x="2" y="12" width={w - 4} height="14" rx="5" fill="var(--rm-wood-2)" {...INK} />
      <rect x="2" y="2" width={w - 4} height="16" rx="6" fill={color} {...INK} />
    </>
  ) },
];

/** 앉는 벤치: 등판·앉는 판·다리 전부 인물 뒤에 선다 — 인물이 판 위에 앉은 것으로 읽힌다 (야외 방의 내 자리). (x, y)는 인물 발 */
export const benchSeat = (x: number, y: number, w = 140, color = 'var(--rm-wood)'): RoomProp[] => [
  prop(`benchback-${x}-${y}`, x, y - 34, w, 32, <rect x="2" y="2" width={w - 4} height="26" rx="9" fill={color} {...INK} />, { base: y - 66 }),
  prop(`bench-${x}-${y}`, x, y + 14, w, 44, (
    <>
      <path d={`M14 30 v12 M${w - 14} 30 v12`} fill="none" {...INK} />
      <rect x="2" y="18" width={w - 4} height="14" rx="5" fill="var(--rm-wood-2)" {...INK} />
      <rect x="2" y="2" width={w - 4} height="22" rx="7" fill={color} {...INK} />
    </>
  ), { base: y - 31 }),
];

/** 화분 */
export const plant = (x: number, y: number, pot = 'var(--coral)'): RoomProp => prop(`plant-${x}-${y}`, x, y, 48, 64, (
  <>
    <path d="M12 40 h24 l-3 20 h-18 z" fill={pot} {...INK} />
    <rect x="9" y="34" width="30" height="9" rx="3" fill="var(--coral-2)" {...INK} />
    <path d="M24 36 v-16" fill="none" {...INK} />
    <ellipse cx="14" cy="18" rx="9" ry="12" fill="var(--leaf)" transform="rotate(-30 14 18)" {...INK2} />
    <ellipse cx="34" cy="14" rx="9" ry="12" fill="var(--leaf)" transform="rotate(30 34 14)" {...INK2} />
    <ellipse cx="24" cy="8" rx="8" ry="11" fill="var(--leaf)" {...INK2} />
  </>
), { base: y - 2 });

/** 나무: 둥근 수관 + 줄기. (x, y)는 줄기 아래 */
export const tree = (x: number, y: number, s = 1, crown = 'var(--leaf)'): RoomProp => prop(`tree-${x}-${y}`, x, y, 90 * s, 120 * s, (
  <g transform={`scale(${s})`}>
    <rect x="39" y="72" width="12" height="46" rx="4" fill="var(--rm-wood-2)" {...INK} />
    <ellipse cx="45" cy="112" rx="18" ry="6" fill="var(--ink)" opacity=".12" />
    <circle cx="30" cy="52" r="24" fill={crown} {...INK} />
    <circle cx="62" cy="48" r="24" fill={crown} {...INK} />
    <circle cx="45" cy="30" r="26" fill={crown} {...INK} />
    <circle cx="45" cy="46" r="22" fill={crown} />
  </g>
), { base: y - 4 });

/** 덤불 */
export const bush = (x: number, y: number, s = 1, fill = 'var(--leaf)'): RoomProp => prop(`bush-${x}-${y}`, x, y, 70 * s, 40 * s, (
  <g transform={`scale(${s})`}>
    <circle cx="18" cy="24" r="14" fill={fill} {...INK} /><circle cx="52" cy="24" r="14" fill={fill} {...INK} /><circle cx="35" cy="16" r="16" fill={fill} {...INK} />
    <ellipse cx="35" cy="34" rx="26" ry="6" fill={fill} />
  </g>
), { base: y - 2 });

/** 입구 매트 — 인물이 그 위에 선다 */
export const mat = (x: number, y: number, color = 'var(--coral)', color2 = 'var(--coral-2)'): RoomProp => ({
  key: `mat-${x}-${y}`, x, y, w: 80, h: 34, base: y - 1,
  node: (
    <>
      <rect x="2" y="2" width="76" height="30" rx="6" fill={color2} {...INK} />
      <path d="M14 8 v18 M28 8 v18 M42 8 v18 M56 8 v18" stroke={color} strokeWidth="6" strokeLinecap="round" opacity=".8" />
    </>
  ),
});

/** 벽에 붙는 간판 (문자) */
export const Sign = ({ x, y, w = 84, h = 48, text, fill = 'var(--night)', color = 'var(--card)', size = 15 }: { x: number; y: number; w?: number; h?: number; text: string; fill?: string; color?: string; size?: number }) => (
  <>
    <rect x={x} y={y} width={w} height={h} rx="7" fill={fill} stroke="var(--ink)" strokeWidth="3" />
    <text x={x + w / 2} y={y + h / 2 + size * 0.38} textAnchor="middle" fontSize={size} fontFamily="var(--display)" fill={color}>{text}</text>
  </>
);

/** 김 (커피·국물·목욕) — room.css .room-steam이 흔든다 */
export const Steam = ({ x, y }: { x: number; y: number }) => (
  <g className="room-steam" transform={`translate(${x} ${y})`} fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round">
    <path d="M-4 0 q2 -4 0 -8" /><path d="M2 -2 q2 -4 0 -8" /><path d="M0 -4 q-2 -4 0 -8" />
  </g>
);

/** 러그 (배경 svg 안에 그린다) */
export const Rug = ({ cx, cy, rx, ry, fill = 'var(--mint-2)', line = 'var(--mint)' }: { cx: number; cy: number; rx: number; ry: number; fill?: string; line?: string }) => (
  <>
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} opacity=".8" />
    <ellipse cx={cx} cy={cy} rx={rx - 16} ry={ry - 12} fill="none" stroke={line} strokeWidth="3" strokeDasharray="10 8" opacity=".7" />
  </>
);
