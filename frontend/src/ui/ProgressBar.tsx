import type { CSSProperties } from 'react';

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}

/** 10px track with an ink border; the fill is animated with transform: scaleX only. */
export function ProgressBar({ value, color = 'var(--coral)', className = '', style }: ProgressBarProps) {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <div className={`pbar ${className}`} style={style} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <i style={{ transform: `scaleX(${v})`, background: color }} />
    </div>
  );
}
