// ─── 프레임 반복: 같은 자리에 같은 크기로 잘린 조각 몇 장을 interval 마다 바꿔 보여 준다 (제자리 동작) ────────
import { useEffect, useState } from 'react';
import type { RoomProp } from './types';

export function FrameLoop({ frames, interval }: { frames: RoomProp[]; interval: number }) {
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI(k => (k + 1) % Math.max(1, frames.length)), interval); return () => clearInterval(id); }, [frames.length, interval]);
  if (!frames.length) return null;
  const f = frames[i];
  return <img src={f.src} alt="" draggable={false} style={{ position: 'absolute', left: f.x, top: f.y, width: f.w, height: f.h, pointerEvents: 'none' }} />;
}
