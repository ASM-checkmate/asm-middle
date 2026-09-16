// ─── 이동 제휴 광고 카드 (ADR-0031) ──────────────────────────────────────────
// 이동 카드(.mc, MOVEMENT_SPEC §5 — 카드 하나, 크기 고정) 위에 따로 서는 작은 카드. 귀가가 제휴 택시일 때만(act.ride).
// 로고 없이 동백꽃 아이콘 + 이름 + 한 줄. 누르는 동작은 없다 (데모). 'AD' 알약(ui/AdTag — 시간표·활동 태그와 같은 것)으로 광고임을 밝힌다.
import type { RideSponsor } from '../sim/types';
import { AdTag } from '../ui';

/** 동백꽃: 빨간 다섯 잎 + 노란 술 */
function Camellia({ size = 34 }: { size?: number }) {
  const petals = Array.from({ length: 5 }, (_, i) => i * 72);
  return (
    <svg viewBox="-20 -20 40 40" width={size} height={size} aria-hidden="true">
      {petals.map(a => <ellipse key={a} cx="0" cy="-9" rx="7" ry="10" fill="#E0323F" stroke="#2A2118" strokeWidth="2" transform={`rotate(${a})`} />)}
      <circle r="5.5" fill="#FFC64D" stroke="#2A2118" strokeWidth="2" />
      <circle cx="-1.5" cy="-1.5" r="1.2" fill="#2A2118" /><circle cx="2" cy="1" r="1.2" fill="#2A2118" />
    </svg>
  );
}

export function AdCard({ ride }: { ride: RideSponsor }) {
  return (
    <div className="mc-ad" role="note" aria-label={`광고 · ${ride.name}`}>
      <span className="mc-ad-ic">{ride.id === 'dongbaek-taxi' ? <Camellia /> : <span className="mc-ad-emoji">{ride.emoji}</span>}</span>
      <span className="mc-ad-txt">
        <b>{ride.name}</b>
        <small>{ride.tagline}</small>
      </span>
      <AdTag />
    </div>
  );
}
