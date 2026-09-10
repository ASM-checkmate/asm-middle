import { useEffect, useState } from 'react';
import { useSns, type SnsTab } from '../sim/sns';
import { useWorld } from '../sim/store';
import type { Post, PostCut } from '../sim/posts';
import type { Comic, Friend } from '../sim/types';
import { agentById } from '../sim/agents';
import { currentUser } from '../sim/api';
import { subscribeUploaded } from '../sim/media';
import { Button, Glyph } from '../ui';
import { FeedTab } from './sns/FeedTab';
import { FriendsTab } from './sns/FriendsTab';
import { MineTab } from './sns/MineTab';
import { ProfileView } from './sns/ProfileView';
import { PostView } from './sns/PostView';
import { ComposeSheet } from './sns/ComposeSheet';
import { CutViewer } from './sns/CutStrip';
import type { AuthorLite } from './sns/FeedCard';
import './sns.css';

const TABS: { id: SnsTab; label: string }[] = [{ id: 'feed', label: '피드' }, { id: 'friends', label: '친구' }, { id: 'mine', label: '내 글' }];

/** `?preview=sns…`가 스토어 대신 넣어 주는 것 — 친구·마주침·책은 스토어(memory·world)를 건드리지 않고 화면에만 얹는다 */
export interface SnsPreviewData { friends?: Friend[]; encounters?: Record<string, number>; comics?: Comic[] }

/**
 * SNS (ADR-0021 · SNS_SPEC §1): 홈 왼쪽 위 버튼. 피드 / 친구 / 내 글 세 탭. 그 위에 프로필(뒤로 가면 보던 탭), 글 하나, 컷 크게 보기,
 * 글쓰기(책의 고르기 모드)가 얹힌다. 상태는 useSns(서버 자원·UI 플래그) — 시뮬 저장본에 끼지 않는다.
 */
export function SnsOverlay({ onClose, preview }: { onClose: () => void; preview?: SnsPreviewData }) {
  const memory = useWorld(s => s.memory);
  const encountersStore = useWorld(s => s.encounters);
  const now = useWorld(s => s.now);
  const tz = useWorld(s => s.tz);
  const today = useWorld(s => s.today);
  // remote 캐시가 바뀌면 진짜 사람 친구의 '지금'도 바뀐다 — 구독해 두어야 다시 그려진다
  useWorld(s => s.remote);
  const setSnsProfile = useWorld(s => s.setSnsProfile);

  const tab = useSns(s => s.snsTab);
  const setTab = useSns(s => s.setSnsTab);
  const profileOpen = useSns(s => s.profileOpen);
  const setProfileOpen = useSns(s => s.setProfileOpen);
  const composeOpen = useSns(s => s.composeOpen);
  const setComposeOpen = useSns(s => s.setComposeOpen);
  const draft = useSns(s => s.draft);
  const feed = useSns(s => s.feed);
  const localPosts = useSns(s => s.localPosts);
  const loadFeed = useSns(s => s.loadFeed);
  const feedLoading = useSns(s => s.feedLoading);
  const feedError = useSns(s => s.feedError);
  const likeToggle = useSns(s => s.likeToggle);
  const likeLocalToggle = useSns(s => s.likeLocalToggle);
  const removePost = useSns(s => s.removePost);
  const myPosts = useSns(s => s.myPosts);
  const profiles = useSns(s => s.profiles);

  const friends = preview?.friends ?? memory.friends;
  const encounters = preview?.encounters ?? encountersStore;
  const meId = currentUser()?.userId ?? null;

  /** 격자에서 연 글 (내 글이면 편집·삭제) */
  const [post, setPost] = useState<{ post: Post; author: AuthorLite; mine: boolean } | null>(null);
  const [viewer, setViewer] = useState<{ cuts: PostCut[]; index: number; mine: boolean } | null>(null);
  const [editing, setEditing] = useState<Post | null>(null);
  // 업로드가 끝날 때마다 다시 그린다 — 초안 카드·글쓰기의 '업로드 중…'이 걷힌다
  const [uploadedTick, setUploadedTick] = useState(0);
  useEffect(() => subscribeUploaded(() => setUploadedTick(n => n + 1)), []);
  // 처음 열 때 피드를 새로 받는다 (이미 받는 중이면 loadFeed가 무시)
  useEffect(() => { void loadFeed(true); }, [loadFeed]);

  // 격자의 글이 스토어에서 바뀌면(편집·좋아요) 열어 둔 글도 따라간다
  const livePost = post ? [...myPosts, ...feed.map(i => i.post), ...localPosts.map(i => i.post), ...Object.values(profiles).flatMap(p => p.posts)].find(p => p.id === post.post.id) ?? post.post : null;

  const nameOf = (id: string): string | null => friends.find(f => f.id === id)?.name ?? agentById(id)?.name ?? (id === meId ? memory.name : null);
  /** 내 친구인가 — 카드의 '친구' 배지: 내 친구 목록, 피드의 친구 구간(why 없는 서버 글), 내 폰의 가상 친구 글 */
  const isFriend = (id: string): boolean => friends.some(f => f.id === id) || feed.some(i => i.author.id === id && i.why === undefined) || localPosts.some(i => i.author.id === id);
  const openProfile = (id: string) => { setPost(null); setViewer(null); setProfileOpen(id === meId ? null : id); if (id === meId) setTab('mine'); };
  const me: AuthorLite = { id: meId ?? 'me', name: memory.name, emoji: '🙂', ...(memory.repShotId ? { repShotId: memory.repShotId } : {}) };
  const localIds = new Set(localPosts.map(i => i.post.id));
  const like = (p: Post) => { if (localIds.has(p.id)) likeLocalToggle(p.id); else void likeToggle(p.id); };

  const title = post ? (post.mine ? '내 글' : post.author.name) : profileOpen ? nameOf(profileOpen) ?? '프로필' : 'SNS';
  const back = post ? () => setPost(null) : profileOpen ? () => setProfileOpen(null) : null;

  return (
    <div className="book sns" role="dialog" aria-label="SNS">
      <div className="book-hd sns-hd">
        {back && <Button round ariaLabel="뒤로" onClick={back}><Glyph name="back" /></Button>}
        <h2>{title}</h2>
        {!back && tab === 'feed' && (
          <button type="button" className="btn btn--text sns-refresh" disabled={feedLoading} onClick={() => void loadFeed(true)}>{feedLoading ? '받는 중…' : feedError && !/no user/.test(feedError) ? '다시 받기' : '새로고침'}</button>
        )}
        <Button round ariaLabel="닫기" onClick={onClose}><Glyph name="close" /></Button>
      </div>
      {!back && (
        <div className="sns-tabs" role="tablist" aria-label="SNS 탭">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      )}
      <div className="sns-body">
        {post && livePost ? (
          <PostView
            post={livePost} author={post.author} mine={post.mine} friend={isFriend(post.author.id)} now={now} tz={tz} nameOf={nameOf}
            onAuthor={openProfile}
            onCut={i => setViewer({ cuts: livePost.cuts, index: i, mine: post.mine })}
            onLike={() => like(livePost)}
            onEdit={() => { setEditing(livePost); setComposeOpen(true); }}
            onRemove={() => { if (confirm('이 글을 지울까요? 사진은 책에 남아요.')) void removePost(livePost.id).then(ok => { if (ok) setPost(null); }); }}
          />
        ) : profileOpen ? (
          <ProfileView
            userId={profileOpen} friends={friends} encounters={encounters} localPosts={localPosts} feed={feed} now={now} tz={tz} today={today}
            onPost={(p, author) => setPost({ post: p, author, mine: false })}
          />
        ) : tab === 'feed' ? (
          <FeedTab now={now} tz={tz} nameOf={nameOf} onAuthor={openProfile} onCut={(it, i) => setViewer({ cuts: it.post.cuts, index: i, mine: false })} />
        ) : tab === 'friends' ? (
          <FriendsTab friends={friends} encounters={encounters} localPosts={localPosts} feed={feed} now={now} tz={tz} today={today} onOpen={openProfile} />
        ) : (
          <MineTab now={now} uploadedTick={uploadedTick} onOpenPost={p => setPost({ post: p, author: me, mine: true })} onCompose={() => { setEditing(null); setComposeOpen(true); }} />
        )}
      </div>
      {viewer && (
        <CutViewer
          cuts={viewer.cuts} index={viewer.index} onClose={() => setViewer(null)}
          action={viewer.mine ? { label: '대표컷으로', onClick: i => setSnsProfile({ repShotId: viewer.cuts[i].shotId }), done: i => memory.repShotId === viewer.cuts[i].shotId } : undefined}
        />
      )}
      {composeOpen && (
        <ComposeSheet
          // 키는 고치는 글로만 — 초안 id로 걸면 고치는 사이 스토어가 초안을 비울 때(엔진이 올림) 화면이 새로 떠 손본 것이 날아간다
          key={editing?.id ?? 'draft'}
          draft={editing ? null : draft} edit={editing} comics={preview?.comics} uploadedTick={uploadedTick}
          onClose={() => { setComposeOpen(false); setEditing(null); }}
          onDone={p => { setComposeOpen(false); setEditing(null); setProfileOpen(null); setTab('mine'); if (post) setPost({ ...post, post: p }); }}
        />
      )}
    </div>
  );
}
