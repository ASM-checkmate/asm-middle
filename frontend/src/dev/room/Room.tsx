// ─── 방 그리기: 배경 한 장 + 그 위의 사람 ────────────────────────────────────────────────
// 배경이 바뀔 때 **새 그림만 위에서 덮으며 나타난다**. 두 장을 같이 반투명으로 겹치면(양쪽 다 opacity 0.5) 사이로 흰 바탕이
// 25 % 비쳐 한 번 번쩍인다 — 아래 장은 불투명하게 둔 채 위만 덮어야 그 반짝임이 없다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RoomJson } from './types';

/** 배경이 덮여 바뀌는 시간 (ms) — RoomLab 이 걷기·사람 사라짐과 박자를 맞춘다 */
export const FADE = 340;

const CSS = `@keyframes room-in{from{opacity:0}to{opacity:1}}`;

export function Room({ room, shown, actor, debug }: { room: RoomJson; shown?: string; actor?: ReactNode; debug?: boolean }) {
  const cur = shown ?? room.back;
  // 앞 장은 그리는 중에 정한다 — effect 로 미루면 한 칸(16ms) 동안 엉뚱한 장이 아래 깔려 깜빡인다
  const [pair, setPair] = useState({ cur, prev: cur });
  if (pair.cur !== cur) setPair({ cur, prev: pair.cur });
  const prev = pair.prev;

  const all = [room.back, ...Object.values(room.scenes).flatMap(s => [...(s.enter ?? []), ...s.frames])];
  const box = { position: 'absolute', left: 0, top: 0, width: room.w, height: room.h } as const;

  return (
    <div style={{ position: 'relative', width: room.w, height: room.h, overflow: 'hidden', background: '#0000' }}>
      <style>{CSS}</style>
      {/* 미리 받아 두기 — 넘어갈 때 새로 받느라 한 칸 비지 않게 */}
      {all.map(src => <img key={src} src={src} alt="" aria-hidden style={{ ...box, opacity: 0, pointerEvents: 'none' }} />)}
      <img src={prev} alt="" draggable={false} style={{ ...box, zIndex: 1 }} />
      <img key={cur} src={cur} alt="" draggable={false} style={{ ...box, zIndex: 2, animation: `room-in ${FADE}ms ease-in-out` }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>{actor}</div>
      {debug && (
        <svg width={room.w} height={room.h} style={{ position: 'absolute', left: 0, top: 0, zIndex: 4, pointerEvents: 'none' }}>
          <polygon points={room.walk.map(p => p.join(',')).join(' ')} fill="rgba(42,123,216,.16)" stroke="#2A7BD8" strokeDasharray="5 4" />
          {room.zones.map(z => (
            <g key={z.id}>
              <rect x={z.rect[0]} y={z.rect[1]} width={z.rect[2] - z.rect[0]} height={z.rect[3] - z.rect[1]} fill="rgba(242,178,51,.22)" stroke="#F2B233" strokeWidth="2" />
              <text x={z.rect[0] + 4} y={z.rect[1] + 13} fontSize="11" fill="#7a5200" fontFamily="monospace" stroke="#fff" strokeWidth="2.5" paintOrder="stroke">{z.ko}</text>
              <circle cx={z.stand[0]} cy={z.stand[1]} r="4" fill="#F2B233" stroke="#1B1715" />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
