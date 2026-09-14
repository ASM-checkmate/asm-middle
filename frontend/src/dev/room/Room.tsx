// ─── 방 그리기: 배경 한 장 + 그 위의 사람 ────────────────────────────────────────────────
// 장면(자기·화장)은 '그 물건 + 사람'이 든 방 전체 그림이라 배경째 갈아 끼운다. 다만 톡 하고 바뀌면 사람이 순간이동한 것처럼
// 보이니, 배경을 전부 겹쳐 두고 **투명도만 바꿔 겹쳐 넘긴다** (crossfade). 장면 안에서 프레임이 도는 것도 같은 방식이라
// 숨 쉬는 것처럼 부드럽다. 그림은 처음부터 다 얹혀 있으니 넘어갈 때 새로 받느라 한 칸 비는 일도 없다.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RoomJson, RoomScene } from './types';

/** 배경이 겹쳐 넘어가는 시간 (ms) — RoomLab 이 걷기·사람 사라짐과 박자를 맞춘다 */
export const FADE = 340;

export function Room({ room, scene, actor, debug }: { room: RoomJson; scene?: RoomScene; actor?: ReactNode; debug?: boolean }) {
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!scene || scene.frames.length < 2) return;
    const id = setInterval(() => setK(i => i + 1), scene.interval);
    return () => clearInterval(id);
  }, [scene]);

  // 칸 번호는 늘 늘려 두고 나머지로 고른다 (장면이 바뀔 때 0으로 되돌리려 effect 에서 setState 하지 않으려고)
  const shown = scene ? scene.frames[k % scene.frames.length] : room.back;
  const layers = [room.back, ...Object.values(room.scenes).flatMap(s => s.frames)];

  return (
    <div style={{ position: 'relative', width: room.w, height: room.h, overflow: 'hidden' }}>
      {layers.map(src => (
        <img
          key={src} src={src} alt="" draggable={false}
          style={{ position: 'absolute', left: 0, top: 0, width: room.w, height: room.h, opacity: src === shown ? 1 : 0, transition: `opacity ${FADE}ms ease-in-out` }}
        />
      ))}
      {actor}
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
