// ─── 방 그리기: 배경 한 장 + 그 위의 사람. 장면 중이면 배경을 장면 프레임으로 갈아 끼우고 사람은 안 그린다 ─────────
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RoomJson, RoomScene } from './types';

export function Room({ room, scene, actor, debug }: { room: RoomJson; scene?: RoomScene; actor?: ReactNode; debug?: boolean }) {
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!scene || scene.frames.length < 2) return;
    const id = setInterval(() => setK(i => i + 1), scene.interval);
    return () => clearInterval(id);
  }, [scene]);

  // 칸 번호는 늘 늘려 두고 나머지로 고른다 — 장면이 바뀔 때 0으로 되돌리려고 effect 에서 setState 하지 않으려고
  const back = scene ? scene.frames[k % scene.frames.length] : room.back;
  return (
    <div style={{ position: 'relative', width: room.w, height: room.h, overflow: 'hidden' }}>
      {/* 장면 프레임을 미리 받아 둔다 — 처음 바뀔 때 한 칸 비는 걸 막는다 */}
      {Object.values(room.scenes).flatMap(s => s.frames).map(f => (
        <link key={f} rel="preload" as="image" href={f} />
      ))}
      <img src={back} alt="" draggable={false} style={{ position: 'absolute', left: 0, top: 0, width: room.w, height: room.h }} />
      {!scene && actor}
      {debug && (
        <svg width={room.w} height={room.h} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
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
