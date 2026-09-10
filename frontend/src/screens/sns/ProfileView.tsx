import { useEffect, useMemo, useState } from 'react';
import { useSns } from '../../sim/sns';
import type { FeedItem, Post } from '../../sim/posts';
import type { DayKey, Friend, RemoteAgent } from '../../sim/types';
import { agentById } from '../../sim/agents';
import { hasPlace, placeById } from '../../sim/places';
import { localParts } from '../../sim/tz';
import { Character } from '../../character';
import { Chip } from '../../ui';
import { AuthorHead } from './AuthorHead';
import { PostGrid } from './PostGrid';
import { homeAreaOf, nowLineOf } from './lines';
import { isUserId, relationOf, repShotOf } from './util';

/** 어떻게 만났는지 (옛 FriendsOverlay의 metLine) — 내 캐릭터 시간대로 */
const metLineOf = (f: Friend, tz: string): string => {
  if (f.metAt === undefined) return '처음부터 친구';
  const p = localParts(f.metAt, tz);
  const where = f.metPlaceId && hasPlace(f.metPlaceId) ? placeById(f.metPlaceId).name : null;
  return `${p.m}월 ${p.d}일${where ? ` · ${where}에서 만남` : ' · 새 친구'}`;
};

/**
 * 남의 프로필 (SNS_SPEC §6): 대표컷 크게 · 이름 · 동네 · 공개/비공개 · 글 수(알 때만) / 관계 배지 + 어떻게 만났는지 + 같이 논 N회 /
 * 지금 / 알게 된 것(접기, 기본 접힘) / 글 격자 3열. 진짜 사람(32자 hex)은 서버에서 받고(비공개+친구 아님 → "친구만 볼 수 있어요"),
 * 가상 친구는 내 폰이 만든 글(localPosts·피드)에서 고른다.
 * 관계 칩은 친구이거나 **마주친 적이 있을 때만** — '스친 사이'는 같은 곳에 30분 있었던 사이다(FRIENDS_SPEC §6). 처음 보는 추천 작성자에겐 아무 칩도 없다.
 */
export function ProfileView({ userId, friends, encounters, localPosts, feed, now, tz, today, onPost }: {
  userId: string;
  friends: Friend[];
  encounters: Record<string, number>;
  localPosts: FeedItem[];
  feed: FeedItem[];
  now: number;
  tz: string;
  today: DayKey;
  onPost: (p: Post, author: { id: string; name: string; emoji: string; repShotId?: string }) => void;
}) {
  const remote = isUserId(userId);
  const profile = useSns(s => s.profiles[userId]);
  const loadUserPosts = useSns(s => s.loadUserPosts);
  const friend = friends.find(f => f.id === userId) ?? null;
  const agent = agentById(userId) as RemoteAgent | null;
  // 피드에 실린 작성자 정보가 캐시보다 새롭다 (repShotId·visibility)
  const fromFeed = [...feed, ...localPosts].find(i => i.author.id === userId)?.author ?? null;
  const name = friend?.name ?? agent?.name ?? fromFeed?.name ?? '누구';
  const emoji = friend?.emoji ?? agent?.emoji ?? fromFeed?.emoji ?? '·';
  const visibility = fromFeed?.visibility ?? agent?.visibility ?? (remote ? 'private' : 'public');
  const homeId = friend?.homePlaceId ?? agent?.homePlaceId ?? null;

  useEffect(() => { if (remote) void loadUserPosts(userId); }, [remote, userId, loadUserPosts]);

  const localMine = useMemo(() => {
    const seen = new Set<string>();
    const out: Post[] = [];
    for (const i of [...localPosts, ...feed]) if (i.post.authorId === userId && !seen.has(i.post.id)) { seen.add(i.post.id); out.push(i.post); }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }, [localPosts, feed, userId]);
  const posts = remote ? (profile?.posts ?? []) : localMine;
  const known = remote ? !!profile && !profile.failed && profile.next === null && !profile.loading : true;
  const rep = repShotOf(fromFeed?.repShotId ?? agent?.repShotId, posts);
  const rel = relationOf(friend);
  const met = (encounters[userId] ?? 0) > 0;
  const learned = friend?.learned ?? [];
  // 못 받은 이유 (sns.Profile.error): 비공개 + 친구 아님은 403뿐 — 오프라인·5xx·로그인 전은 다른 말로
  const privateWall = !!profile?.failed && /403 not allowed/.test(profile.error);
  const noUser = !!profile?.failed && /no user/.test(profile.error);
  const [showLearned, setShowLearned] = useState(false);
  const author = { id: userId, name, emoji, ...(rep ? { repShotId: rep } : {}) };

  return (
    <div className="sns-profile">
      <div className="sns-pf-hd">
        <AuthorHead repShotId={rep} emoji={emoji} size={72} className="sns-pf-head" />
        <div className="sns-pf-tx">
          <b>{name}</b>
          <span>{homeId ? homeAreaOf(homeId) : '어딘가'} · {visibility === 'public' ? '공개' : '비공개'}{known ? ` · 글 ${posts.length}` : ''}</span>
        </div>
      </div>
      {friend ? (
        <div className="sns-pf-rel">
          <Chip tone={rel === '친한 친구' ? 'sun' : 'paper2'} tiny>{rel}</Chip>
          <span className="sns-pf-met">{metLineOf(friend, tz)}{friend.bond ? ` · 같이 논 ${friend.bond}회` : ''}</span>
        </div>
      ) : met ? (
        <div className="sns-pf-rel"><Chip tone="ghost" tiny>{rel}</Chip></div>
      ) : null}
      {friend && <span className="sns-fr-now"><i /> 지금 · {nowLineOf(friend, now, tz, today)}</span>}
      {friend && rel === '친한 친구' && (
        <div className="sns-learned">
          <button type="button" className="sns-learned-t" aria-expanded={showLearned} onClick={() => setShowLearned(v => !v)}>
            알게 된 것 <small className="num">{learned.length}</small> <i className={showLearned ? 'is-open' : ''}>▾</i>
          </button>
          {showLearned && (learned.length ? <ul>{learned.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="sns-learned-none">같이 놀면 하나씩 알게 돼요</p>)}
        </div>
      )}
      {remote && profile?.failed && posts.length === 0 ? (
        <div className="book-empty sns-empty sns-empty--sm">
          <Character pose="think" size={120} />
          <span>{privateWall ? '친구만 볼 수 있어요' : noUser ? '로그인하면 보여요' : '지금은 못 받았어요'}</span>
          {!privateWall && !noUser && <button type="button" className="btn btn--text sns-more" onClick={() => void loadUserPosts(userId)}>다시 받기</button>}
        </div>
      ) : posts.length === 0 ? (
        <div className="book-empty sns-empty sns-empty--sm">
          {remote && profile?.loading ? <span>받는 중…</span> : <><Character pose="think" size={120} /><span>아직 올린 글이 없어요</span></>}
        </div>
      ) : (
        <>
          <PostGrid posts={posts} emoji={emoji} onOpen={p => onPost(p, author)} />
          {remote && profile && profile.next !== null && !profile.loading && (
            <button type="button" className="btn btn--text sns-more" onClick={() => void loadUserPosts(userId, true)}>더 보기</button>
          )}
        </>
      )}
    </div>
  );
}
