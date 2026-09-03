// ─── A friend's face, small and round ───────────────────────────────────────
// 동행 표시 규칙 (design/FRIENDS_SPEC.md): 칩 = 친구 캐릭터 머리(22px) + 이름, 친구 색 테두리.
// The head itself is the shared friend face symbol from defs.tsx (<use>), tinted through `--friend`
// (the scarf) — never a re-drawn face, so a friend looks the same here and at 350px.
import { useId } from 'react';
import type { CSSProperties } from 'react';

export interface FriendHeadProps {
  /** 22–28px in the UI (chips, block info, bubbles). */
  size?: number;
  /** the friend's token colour — the accessory tint and the ring */
  color?: string;
  /** happy face (the encounter chip) instead of the default one */
  happy?: boolean;
  /** ink-3 silhouette (someone who was there but we never talked to) */
  ghost?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const DEFAULT_COLOR = '#5FC9A6';

/** One friend's head in a circle: paper ground, the friend face, a 2px ink ring in the friend's colour. */
export function FriendHead({ size = 24, color = DEFAULT_COLOR, happy, ghost, className = '', style, title }: FriendHeadProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clip = `fh-${uid}`;
  const st = { '--friend': color, ...style } as CSSProperties;
  return (
    <svg
      className={`fh ${ghost ? 'fh--ghost' : ''} ${className}`.trim()}
      width={size} height={size} viewBox="0 0 100 100" style={st}
      role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}
    >
      <defs><clipPath id={clip}><circle cx="50" cy="50" r="45" /></clipPath></defs>
      <circle cx="50" cy="50" r="45" fill={ghost ? 'var(--ink-3, #B9AC9C)' : 'var(--paper-2, #FFEBCB)'} />
      <g clipPath={`url(#${clip})`} opacity={ghost ? 0.35 : 1}>
        <use href={happy ? '#chara-face-friend-happy' : '#chara-face-friend'} x="4" y="8" width="92" height="92" />
      </g>
      <circle cx="50" cy="50" r="45" fill="none" stroke={ghost ? 'var(--ink-3, #B9AC9C)' : 'var(--ink, #2A2118)'} strokeWidth="5" />
      <circle cx="50" cy="50" r="41" fill="none" stroke={color} strokeWidth="4" opacity={ghost ? 0.3 : 0.9} />
    </svg>
  );
}
