// ─── PNG 레이어 방 렌더러: 뒤 그림 → (소품·인물을 base/발 y 로 섞어) 앞뒤 순서대로 ────────────────
import type { ReactNode } from 'react';
import type { RoomJson } from './types';

interface Actor { key: string; /** 발 y — 소품의 base 와 비교해 앞뒤 */ y: number; node: ReactNode }

export function PngRoom({ room, actors, debug }: { room: RoomJson; actors: Actor[]; debug?: boolean }) {
  return (
    <div className="pr" style={{ position: 'relative', width: room.w, height: room.h, overflow: 'hidden' }}>
      <img src={room.back} alt="" draggable={false} style={{ position: 'absolute', left: 0, top: 0, width: room.w, height: room.h }} />
      {room.props.map(p => (
        <img key={p.id} src={p.src} alt="" draggable={false} style={{ position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h, zIndex: Math.round(p.base) }} />
      ))}
      {actors.map(a => <div key={a.key} style={{ position: 'absolute', left: 0, top: 0, zIndex: Math.round(a.y) }}>{a.node}</div>)}
      {debug && (
        <svg width={room.w} height={room.h} style={{ position: 'absolute', left: 0, top: 0, zIndex: 10000, pointerEvents: 'none' }}>
          {room.props.map(p => (
            <g key={p.id}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} fill="none" stroke="#FF6E58" strokeDasharray="4 3" />
              <line x1={p.x} x2={p.x + p.w} y1={p.base} y2={p.base} stroke="#2A7BD8" strokeWidth="2" />
              <text x={p.x + 3} y={p.y + 11} fontSize="10" fill="#FF6E58" fontFamily="monospace">{p.id} · base {p.base}</text>
            </g>
          ))}
          {Object.entries(room.spots).map(([k, s]) => (
            <g key={k}><circle cx={s.x} cy={s.y} r="5" fill="#F2B233" stroke="#1B1715" /><text x={s.x + 8} y={s.y + 4} fontSize="10" fill="#1B1715" fontFamily="monospace" stroke="#fff" strokeWidth="2" paintOrder="stroke">{k}</text></g>
          ))}
        </svg>
      )}
    </div>
  );
}
