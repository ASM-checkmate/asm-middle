import { Chip } from './Chip';

/** "😴 시차 적응 중" — Jua on sun, 2px ink (TIMEZONE_SPEC 시차 적응). `sticker` tilts it onto the corner of a tag or bubble;
 *  `inline` sits it inside a line of text. Shown wherever a phase carries `jetlag: true`. */
export function JetlagChip({ sticker, inline, className = '' }: { sticker?: boolean; inline?: boolean; className?: string }) {
  return (
    <Chip tiny className={['jetlag', sticker ? 'jetlag--sticker' : '', inline ? 'jetlag--inline' : '', className].filter(Boolean).join(' ')} ariaLabel="시차 적응 중">
      <span className="jetlag-zz" aria-hidden="true">😴</span>시차 적응 중
    </Chip>
  );
}
