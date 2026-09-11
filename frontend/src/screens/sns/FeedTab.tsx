import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useSns } from '../../sim/sns';
import { Character } from '../../character';
import { FeedCard } from './FeedCard';
import { mergeFeed } from './util';

/**
 * 피드 탭 (SNS_SPEC §4): 친구 글(서버 + 내 폰의 가상 친구 글, 시간순) → 구분선 "새로운 사람들" → 추천(서버 순서). 끝에 닿으면 다음 장.
 * 좋아요: 서버 글은 likeToggle(낙관), 가상 친구 글은 likeLocalToggle(폰에서만).
 */
export function FeedTab({ now, tz, nameOf, onAuthor }: {
  now: number;
  tz: string;
  nameOf: (id: string) => string | null;
  onAuthor: (userId: string) => void;
}) {
  const feed = useSns(s => s.feed);
  const localPosts = useSns(s => s.localPosts);
  const loading = useSns(s => s.feedLoading);
  const ended = useSns(s => s.feedEnded);
  const error = useSns(s => s.feedError);
  const loadFeed = useSns(s => s.loadFeed);
  const likeToggle = useSns(s => s.likeToggle);
  const likeLocalToggle = useSns(s => s.likeLocalToggle);

  const { items, dividerAt } = useMemo(() => mergeFeed(feed, localPosts), [feed, localPosts]);
  const localIds = useMemo(() => new Set(localPosts.map(i => i.post.id)), [localPosts]);

  // 무한 스크롤 — 바닥의 보초가 보이면 다음 장 (loadFeed는 받는 중이거나 끝이면 스스로 무시한다)
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || ended || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) void loadFeed(); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ended, loadFeed, items.length]);

  if (items.length === 0 && !loading) {
    // 못 받은 것과 없는 것은 다르다 — 서버가 안 보이거나 로그인 전이면 그렇게 말한다 (posts.lastError가 이유)
    if (error) {
      const noUser = /no user/.test(error);
      return (
        <div className="book-empty sns-empty">
          <Character pose="think" size={170} />
          <span>{noUser ? <>로그인하면 보여요<br />친구 글과 새로운 사람들이 여기 모여요</> : <>서버가 안 보여요<br />잠시 뒤 다시 받아 볼게요</>}</span>
          {!noUser && <button type="button" className="btn btn--text sns-more" onClick={() => void loadFeed(true)}>새로고침</button>}
        </div>
      );
    }
    return (
      <div className="book-empty sns-empty">
        <Character pose="think" size={170} />
        <span>아직 글이 없어요<br />친구를 사귀면 여기 모여요</span>
      </div>
    );
  }
  return (
    <div className="sns-feed">
      {items.map((it, i) => (
        <Fragment key={it.post.id}>
          {i === dividerAt && <div className="sns-divider" role="separator"><span>새로운 사람들</span></div>}
          <FeedCard
            item={it} friend={it.why === undefined} now={now} tz={tz} nameOf={nameOf}
            onAuthor={onAuthor}
            onLike={() => { if (localIds.has(it.post.id)) likeLocalToggle(it.post.id); else void likeToggle(it.post.id); }}
          />
        </Fragment>
      ))}
      <div ref={sentinel} className="sns-sentinel" aria-hidden="true">{loading ? '받는 중…' : error && !/no user/.test(error) ? '다음 장을 못 받았어요' : ended ? '' : ' '}</div>
    </div>
  );
}
