import type { Post } from '../../sim/posts';
import { Chip, Glyph } from '../../ui';
import { AuthorHead } from './AuthorHead';
import { CutStrip } from './CutStrip';
import { companionsLine, relTime } from './util';

/** 카드가 작성자에게서 읽는 것 — FeedItem.author(RemoteAgent)도, 내 글의 '나'도 이 모양이다 */
export interface AuthorLite { id: string; name: string; emoji: string; repShotId?: string }
export interface CardItem { post: Post; author: AuthorLite; why?: string }

/**
 * 피드 카드 하나 (SNS_SPEC §4): 작성자 줄(대표컷·이름·장소·시각 / 오른쪽에 친구 배지 또는 이유 칩) → 컷 슬라이드 → 캡션 →
 * 좋아요 · 동행 · "주인이 고쳤어요". 작성자를 누르면 프로필, 컷을 누르면 크게 보기.
 * 친구 배지는 **친구의 글에만**(`friend`) — 내 글이나 아직 친구가 아닌 사람의 글(추천 작성자의 격자에서 연 것)에는 아무 칩도 없다.
 */
export function FeedCard({ item, friend = false, now, tz, nameOf, onAuthor, onCut, onLike }: {
  item: CardItem;
  /** 작성자가 내 친구다 (이유 칩이 없을 때 '친구' 배지) */
  friend?: boolean;
  now: number;
  tz: string;
  nameOf: (id: string) => string | null;
  onAuthor: (userId: string) => void;
  onCut: (i: number) => void;
  onLike: () => void;
}) {
  const { post, author, why } = item;
  const with_ = companionsLine(post.companions, nameOf);
  return (
    <article className="sns-card">
      <div className="sns-au">
        <button type="button" className="sns-au-btn" onClick={() => onAuthor(author.id)} aria-label={`${author.name} 프로필`}>
          <AuthorHead repShotId={author.repShotId} emoji={author.emoji} />
          <span className="sns-au-tx">
            <b>{author.name}</b>
            <small>{post.place} · {relTime(post.createdAt, now, tz)}</small>
          </span>
        </button>
        {why ? <Chip tone="sun" tiny className="sns-why">{why}</Chip> : friend ? <Chip tone="paper2" tiny className="sns-why">친구</Chip> : null}
      </div>
      <CutStrip cuts={post.cuts} onOpen={onCut} fallback={<span className="sns-cut-empty">{author.emoji}</span>} />
      {post.caption && <p className="sns-cap">{post.caption}</p>}
      <div className="sns-meta">
        <button type="button" className={`sns-like ${post.likedByMe ? 'is-on' : ''}`} onClick={onLike} aria-pressed={post.likedByMe} aria-label="좋아요">
          <Glyph name="heart" size={18} color="currentColor" />
          <span className="num">{post.likes}</span>
        </button>
        {with_ && <span className="sns-with">{with_}</span>}
        {post.editedByOwner && <span className="sns-edited">✎ 주인이 고쳤어요</span>}
      </div>
    </article>
  );
}
