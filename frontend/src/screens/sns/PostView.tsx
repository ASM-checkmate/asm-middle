import type { Post } from '../../sim/posts';
import { Button } from '../../ui';
import { FeedCard, type AuthorLite } from './FeedCard';

/**
 * 글 하나 (격자에서 눌렀을 때). 카드 그대로 + 내 글이면 편집·삭제. 대표컷 핀은 컷을 크게 볼 때(CutViewer의 '대표컷으로').
 */
export function PostView({ post, author, mine, friend, now, tz, nameOf, onAuthor, onCut, onLike, onEdit, onRemove }: {
  post: Post;
  author: AuthorLite;
  mine: boolean;
  /** 작성자가 내 친구다 — 카드의 '친구' 배지 (내 글엔 없다) */
  friend: boolean;
  now: number;
  tz: string;
  nameOf: (id: string) => string | null;
  onAuthor: (userId: string) => void;
  onCut: (i: number) => void;
  onLike: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="sns-post">
      <FeedCard item={{ post, author }} friend={!mine && friend} now={now} tz={tz} nameOf={nameOf} onAuthor={onAuthor} onCut={onCut} onLike={onLike} />
      {mine && (
        <div className="sns-post-actions">
          <Button small tone="sun" onClick={onEdit}>✎ 편집</Button>
          <Button small onClick={onRemove}>삭제</Button>
        </div>
      )}
      {mine && <p className="sns-hint">컷을 크게 보면 대표컷으로 걸 수 있어요</p>}
    </div>
  );
}
