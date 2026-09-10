import { useMemo } from 'react';
import type { DayKey, Friend, RemoteAgent } from '../../sim/types';
import type { FeedItem } from '../../sim/posts';
import { agentById } from '../../sim/agents';
import { homeAreaOf, nowLineOf } from './lines';
import { Character } from '../../character';
import { Chip } from '../../ui';
import { AuthorHead } from './AuthorHead';
import { relationOf, repShotOf } from './util';

/**
 * 친구 탭 (SNS_SPEC §5): 대표컷(본인이 올린 것만 — 핀한 것, 없으면 최근 글 첫 컷: 서버 피드·내 폰의 가상 친구 글 둘 다에서) · 이름 · 동네 ·
 * 관계 단계 · 지금 뭐 하는 중. 아래 "최근 마주친"은 스친 사이 — 이름만. 친구 맺기 버튼은 없다 — 친구는 마주침에서만 생긴다 (FRIENDS_SPEC §4·§6).
 */
export function FriendsTab({ friends, encounters, localPosts, feed, now, tz, today, onOpen }: {
  friends: Friend[];
  encounters: Record<string, number>;
  localPosts: FeedItem[];
  feed: FeedItem[];
  now: number;
  tz: string;
  today: DayKey;
  onOpen: (userId: string) => void;
}) {
  const repOf = (id: string) => {
    const a = agentById(id) as RemoteAgent | null;
    // 피드에 실린 작성자 정보가 캐시보다 새롭다 (ProfileView와 같은 순서)
    const theirs = [...feed, ...localPosts].filter(i => i.post.authorId === id);
    return repShotOf(theirs.find(i => i.author.id === id)?.author.repShotId ?? a?.repShotId, theirs.map(i => i.post));
  };
  const met = useMemo(() => {
    const friendIds = new Set(friends.map(f => f.id));
    return Object.entries(encounters)
      .filter(([id, n]) => n > 0 && !friendIds.has(id))
      .map(([id, n]) => ({ id, n, name: agentById(id)?.name ?? null }))
      .filter((x): x is { id: string; n: number; name: string } => x.name !== null)
      .sort((a, b) => b.n - a.n);
  }, [friends, encounters]);

  if (friends.length === 0 && met.length === 0) {
    return (
      <div className="book-empty sns-empty">
        <Character pose="think" size={170} />
        <span>아직 친구가 없어요<br />같은 곳에서 마주치면 말을 걸어볼게요</span>
      </div>
    );
  }
  return (
    <div className="sns-friends">
      {friends.length > 0 && (
        <section className="book-group">
          <h3 className="book-group-hd"><span>친구</span><small className="num">{friends.length}명</small></h3>
          {friends.map(f => (
            <button key={f.id} type="button" className="book-item sns-fr" style={{ ['--friend' as string]: f.color }} onClick={() => onOpen(f.id)}>
              <span className="sns-fr-row">
                <AuthorHead repShotId={repOf(f.id)} emoji={f.emoji} size={44} />
                <span className="sns-fr-main">
                  <b>{f.name}</b>
                  <span className="sns-fr-home">{homeAreaOf(f.homePlaceId)}에 사는 친구</span>
                </span>
                <Chip tone={relationOf(f) === '친한 친구' ? 'sun' : 'paper2'} tiny className="sns-rel">{relationOf(f)}</Chip>
              </span>
              <span className="sns-fr-now"><i /> 지금 · {nowLineOf(f, now, tz, today)}</span>
            </button>
          ))}
        </section>
      )}
      {met.length > 0 && (
        <section className="book-group">
          <h3 className="book-group-hd"><span>최근 마주친</span><small className="num">{met.length}명</small></h3>
          <div className="sns-met">
            {met.map(m => (
              <span key={m.id} className="sns-met-one">
                <b>{m.name}</b>
                <small>스친 사이{m.n > 1 ? ` · ${m.n}번` : ''}</small>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
