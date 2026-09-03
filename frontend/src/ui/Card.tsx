import type { CSSProperties, ReactNode } from 'react';

export interface CardProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** translucent white, no hard shadow (activity status card) */
  soft?: boolean;
  /** outline only, no shadow */
  flat?: boolean;
  onClick?: () => void;
}

/** White card with 2px ink outline + 4px hard shadow, radius 26 (deck). */
export function Card({ children, className = '', style, soft, flat, onClick }: CardProps) {
  const cls = ['card', soft ? 'card--soft' : '', flat ? 'card--flat' : '', className].filter(Boolean).join(' ');
  return <div className={cls} style={style} onClick={onClick}>{children}</div>;
}
