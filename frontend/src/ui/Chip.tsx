import type { CSSProperties, ReactNode } from 'react';

export type ChipTone = 'sun' | 'paper' | 'paper2' | 'ghost' | 'coral' | 'mint' | 'sky' | 'night' | 'ink';

export interface ChipProps {
  children?: ReactNode;
  tone?: ChipTone;
  on?: boolean;
  big?: boolean;
  /** 24px sticker size (the jet-lag chip) */
  tiny?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  ariaLabel?: string;
}

/** Pill chip with 2px ink outline. Sun by default (category chip in the deck). */
export function Chip({ children, tone = 'sun', on, big, tiny, className = '', style, onClick, ariaLabel }: ChipProps) {
  const cls = ['chip', `chip--${tone}`, on ? 'is-on' : '', big ? 'chip--big' : '', tiny ? 'chip--tiny' : '', className].filter(Boolean).join(' ');
  if (onClick) return <button type="button" className={cls} style={style} onClick={onClick} aria-pressed={on} aria-label={ariaLabel}>{children}</button>;
  return <span className={cls} style={style}>{children}</span>;
}
