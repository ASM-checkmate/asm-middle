import type { CSSProperties, ReactNode } from 'react';

export type ButtonTone = 'paper' | 'ink' | 'coral' | 'sun' | 'text' | 'done';

export interface ButtonProps {
  children?: ReactNode;
  tone?: ButtonTone;
  small?: boolean;
  round?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  ariaLabel?: string;
}

/** Jua-labelled button. `ink` = the timetable CTA, `coral` = comic primary, `paper` = secondary, `text` = link-ish. */
export function Button({ children, tone = 'paper', small, round, disabled, className = '', style, onClick, ariaLabel }: ButtonProps) {
  const cls = ['btn', tone !== 'paper' ? `btn--${tone}` : '', small ? 'btn--small' : '', round ? 'btn--round' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} style={style} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  );
}
