import { useState } from 'react';
import type { Post } from '../../sim/posts';
import { Button, Glyph } from '../../ui';
import { FeedCard, type AuthorLite } from './FeedCard';

/**
 * 글 하나 (격자에서 눌렀을 때). 카드 그대로 + 내 글이면 편집·삭제·대표컷.
 * 대표컷은 **지금 보는 컷**에 건다 (SNS_SPEC §5) — 사진을 눌러 크게 보는 화면은 없앴다 (오너 결정 2026-09-11).
 */
export function PostView({ post, author, mine, friend, now, tz, nameOf, onAuthor, onLike, onEdit, onRemove, onPin, pinnedShotId }: {
  post: Post;
  author: AuthorLite;
  mine: boolean;
  /** 작성자가 내 친구다 — 카드의 '친구' 배지 (내 글엔 없다) */
  friend: boolean;
  now: number;
  tz: string;
  nameOf: (id: string) => string | null;
  onAuthor: (userId: string) => void;
  onLike: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
  /** 내 글에서만 — 이 컷을 프로필 대표컷으로 */
  onPin?: (shotId: string) => void;
  /** 지금 걸려 있는 대표컷 */
  pinnedShotId?: string;
}) {
  const [i, setI] = useState(0);
  const cut = post.cuts[Math.min(i, post.cuts.length - 1)];
  const pinned = !!cut && cut.shotId === pinnedShotId;
  return (
    <div className="sns-post">
      <FeedCard item={{ post, author }} friend={!mine && friend} now={now} tz={tz} nameOf={nameOf} onAuthor={onAuthor} onIndex={setI} onLike={onLike} />
      {mine && (
        <div className="sns-post-actions">
          <Button small tone="sun" onClick={onEdit}>✎ 편집</Button>
          <Button small onClick={onRemove}>삭제</Button>
        </div>
      )}
      {mine && onPin && cut && (
        <Button small tone={pinned ? 'done' : 'paper'} onClick={() => onPin(cut.shotId)}>
          {pinned ? <><Glyph name="check" size={16} /> 대표컷</> : post.cuts.length > 1 ? `${i + 1}번째 컷을 대표컷으로` : '대표컷으로'}
        </Button>
      )}
    </div>
  );
}
