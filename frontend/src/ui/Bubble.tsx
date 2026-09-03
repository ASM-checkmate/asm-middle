import type { CSSProperties, ReactNode } from 'react';

export interface BubbleProps {
  children?: ReactNode;
  side?: 'left' | 'right';
  className?: string;
  style?: CSSProperties;
}

/** Speech bubble (Jua 15px, ink outline, hard shadow). Re-keys itself on text so it pops when the line changes. */
export function Bubble({ children, side = 'left', className = '', style }: BubbleProps) {
  const key = typeof children === 'string' ? children : undefined;
  return <div key={key} className={`bubble ${side === 'right' ? 'bubble--right' : ''} ${className}`} style={style}>{children}</div>;
}
