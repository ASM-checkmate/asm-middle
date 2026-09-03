// ─── 동행 칩 ────────────────────────────────────────────────────────────────
// FRIENDS_SPEC 동행 표시 규칙: 친구 머리(22px) + 이름, 친구 색 테두리. 여러 명이면 머리가 겹쳐 쌓이고 "+2".
// The chip is the ONLY place a companion's name appears — titles and reasons never carry it.
import type { CSSProperties } from 'react';
import { FriendHead } from '../character/FriendHead';

/** Everything the chip needs of a friend (a `Friend`, or an `Agent` we just met). */
export interface ChipFriend { id: string; name: string; color: string }

export interface CompanionChipProps {
  friends: ChipFriend[];
  /** 22px heads instead of 24px, tighter padding — inside an option card / a bubble line */
  small?: boolean;
  /** a word before the name ("새 친구", "또 만났네") — the encounter chip */
  prefix?: string;
  /** happy faces (an encounter that ended in a hello) */
  happy?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Stacked heads + the first name (+n when more), outlined in the leading friend's colour. */
export function CompanionChip({ friends, small, prefix, happy, className = '', style }: CompanionChipProps) {
  if (!friends.length) return null;
  const [first, ...rest] = friends;
  const size = small ? 22 : 24;
  const st = { '--friend-line': first.color, ...style } as CSSProperties;
  return (
    <span className={`cchip ${small ? 'cchip--sm' : ''} ${className}`.trim()} style={st}>
      <span className="cchip-heads">
        {friends.slice(0, 3).map((f, i) => (
          <FriendHead key={f.id} size={size} color={f.color} happy={happy} style={i ? { marginLeft: -size * 0.42 } : undefined} />
        ))}
      </span>
      <span className="cchip-tx">
        {prefix && <em>{prefix} · </em>}{first.name}{rest.length ? ` +${rest.length}` : ''}
      </span>
    </span>
  );
}
