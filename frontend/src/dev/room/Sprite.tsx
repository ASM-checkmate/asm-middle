// ─── 프레임 스프라이트: 같은 상자로 잘린 전신 그림 몇 장을 순서대로 돌린다 (걷기·서 있기). 잘린 조각을 겹치지 않으니 이음새가 없다 ───
// 세트는 frames.json (scripts/frames.py). 발이 (0,0) 에 오도록 놓고, 크기는 size(px 높이)로 맞춘다.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import DATA from './frames.json';

export type SpriteSet = keyof typeof DATA;
export const FRAMES = DATA as Record<SpriteSet, { frames: string[]; w: number; h: number; feetX: number }>;

/** 순서 한 칸: 프레임 번호, 또는 { f, flip?, ms? }.
 *  flip 은 좌우 뒤집어 쓰기 (정면 걷기의 뒷반쪽은 앞반쪽 프레임을 뒤집어 쓴다), ms 는 그 칸만 다른 길이로 (눈 깜빡임은 짧게) */
export type Step = number | { f: number; flip?: true; ms?: number };
const stepMs = (s: Step, fallback: number) => (typeof s === 'number' ? fallback : s.ms ?? fallback);
interface Props { set: SpriteSet; /** 프레임 순서 (기본: 0,1,2,…) */ order?: Step[]; interval?: number; size: number; flip?: boolean; style?: CSSProperties }

export function Sprite({ set, order, interval = 220, size, flip = false, style }: Props) {
  const d = FRAMES[set];
  const seq = order ?? d.frames.map((_, i) => i);
  const [k, setK] = useState(0);
  // 칸마다 길이가 다를 수 있어 setInterval 대신 한 칸씩 예약한다
  useEffect(() => {
    if (seq.length < 2) return;
    const id = setTimeout(() => setK(i => i + 1), stepMs(seq[k % seq.length], interval));
    return () => clearTimeout(id);
  }, [k, interval, seq]);
  const scale = size / d.h;
  const w = d.w * scale;
  const step = seq[k % seq.length] ?? 0;
  const cur = typeof step === 'number' ? step : step.f;
  const flipped = flip !== (typeof step !== 'number' && step.flip === true);
  return (
    <div style={{ position: 'absolute', left: -w * d.feetX, top: -size, width: w, height: size, transform: flipped ? 'scaleX(-1)' : undefined, transformOrigin: `${d.feetX * 100}% 100%`, ...style }}>
      {d.frames.map((src, i) => <img key={src} src={src} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', visibility: cur === i ? 'visible' : 'hidden', pointerEvents: 'none' }} />)}
    </div>
  );
}
