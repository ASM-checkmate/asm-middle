// ─── SNS 상태 (ADR-0021 · SNS_SPEC §1·§4~§6) ─────────────────────────────────────────────────────────
// useWorld와 **일부러 따로** 둔다 — 피드·글·좋아요는 시뮬레이션이 아니라 서버 리소스라 저장본(world·memory)에 끼지 않고,
// 새로고침하면 서버에서 다시 받는다. 이 스토어는 서버에서 받은 장들을 이어 붙이고(중복 없이, 순서 그대로), 좋아요는 먼저
// 화면에 반영한 뒤 서버가 거절하면 되돌린다. 네트워크는 posts.ts가 맡는다 (여기서는 null만 본다). React 컴포넌트 없음.
import { create } from 'zustand';
import { currentUser } from './api';
import { createPost, deletePost, fetchFeed, fetchMyPosts, fetchUserPosts, lastError, patchPost, setLike, validFeedItem, type FeedItem, type Post, type PostDraft, type PostIn, type PostPatch } from './posts';

export type SnsTab = 'feed' | 'friends' | 'mine';

// ─── 가상 친구 글의 로컬 문서 (ADR-0021 결정 6) ───────────────────────────────────────────
// 서버는 가상 친구를 모른다 — 내 폰이 만든 걸 여기 둔다 (sync.ts LOCAL_KEYS에 있어 아이디가 바뀌면 같이 비운다). 최신 30편.
export const LOCAL_POSTS_KEY = 'theworld.snslocal.v1';
const LOCAL_POSTS_CAP = 30;
const normalizeLocal = (items: readonly FeedItem[]): FeedItem[] => {
  const seen = new Set<string>();
  return [...items].sort((a, b) => b.post.createdAt - a.post.createdAt || a.post.id.localeCompare(b.post.id)).filter(i => (seen.has(i.post.id) ? false : (seen.add(i.post.id), true))).slice(0, LOCAL_POSTS_CAP);
};
/** 저장된 가상 친구 글 — 모양이 틀린 항목은 버린다 (validFeedItem). localStorage가 없으면(하네스) 빈 배열 */
export function loadLocalPosts(): FeedItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_POSTS_KEY);
    if (!raw) return [];
    const doc = JSON.parse(raw) as { v?: unknown; items?: unknown };
    if (!doc || !Array.isArray(doc.items)) return [];
    return normalizeLocal(doc.items.map(validFeedItem).filter((x): x is FeedItem => !!x));
  } catch { return []; }
}
const saveLocalPosts = (items: FeedItem[]) => { try { localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify({ v: 1, items })); } catch { /* ignore */ } };

/** 주인이 좋아요를 **켤 때** 듣는다 — 스토어가 world.agentPost.likedAuthors에 적는다 ("관심 있는 사람", SNS_SPEC §9). 돌려주는 함수로 끊는다 */
const likeListeners = new Set<(authorId: string) => void>();
export const onLike = (fn: (authorId: string) => void): (() => void) => { likeListeners.add(fn); return () => { likeListeners.delete(fn); }; };
const noteLiked = (authorId: string) => { for (const fn of likeListeners) { try { fn(authorId); } catch { /* 듣는 쪽의 오류는 좋아요를 막지 않는다 */ } } };

/**
 * 한 사람의 글 격자 (프로필). 항목이 없으면 아직 안 받은 것. `failed`면 마지막 요청이 거절됐다 — 이유는 `error`(posts.lastError 그대로,
 * `'user posts: 403 not allowed'` 꼴). 비공개 + 친구 아님은 403뿐이다 — 오프라인·5xx·사용자 없음을 "친구만 볼 수 있어요"로 읽으면 안 된다
 */
export interface Profile { posts: Post[]; next: string | null; loading: boolean; failed: boolean; error: string }

export interface SnsState {
  // ── 피드 (한 줄기: 친구 글 → 구분선 → 추천) ──
  feed: FeedItem[];
  /** 다음 장의 커서 — 서버가 준 것 그대로. null이면 끝 */
  feedNext: string | null;
  feedLoading: boolean;
  feedEnded: boolean;
  /** 마지막 피드 요청이 실패한 이유 (posts.lastError — `'feed: no user'`·`'feed: 503 …'`). 성공하면 빈 문자열. 빈 화면이 "글이 없다"와 "못 받았다"를 가른다 */
  feedError: string;
  /** 피드를 (더) 받는다. `reset`이면 처음부터. 같은 글은 한 번만, 순서는 받은 그대로 */
  loadFeed(reset?: boolean): Promise<void>;
  /** 좋아요 토글 — 먼저 화면을 바꾸고, 서버가 거절하면 되돌린다. 서버가 준 수가 진실이다. 연타하면 마지막 누름의 답만 적는다 */
  likeToggle(postId: string): Promise<void>;

  // ── 내 글 ──
  myPosts: Post[];
  myNext: string | null;
  myLoading: boolean;
  /** 내 글을 받는다. `more`면 다음 장, 아니면 처음부터 */
  loadMyPosts(more?: boolean): Promise<void>;

  // ── 프로필 격자 ──
  profiles: Record<string, Profile>;
  /** 그 사람의 글을 받는다. `more`면 다음 장, 아니면 처음부터 */
  loadUserPosts(userId: string, more?: boolean): Promise<void>;

  // ── 글 쓰기·고치기·지우기 (모두 서버가 받아 준 뒤에만 로컬을 바꾼다) ──
  /** 글을 올린다 — 되면 내 글·내 프로필 맨 앞에 끼운다 */
  publishPost(body: PostIn): Promise<Post | null>;
  /** 글을 고친다 — 되면 피드·내 글·프로필 어디에 있든 바꿔 끼운다 */
  editPost(id: string, patch: PostPatch): Promise<Post | null>;
  /** 글을 지운다 — 되면 어디서든 뺀다 */
  removePost(id: string): Promise<boolean>;

  // ── 내 폰이 만든 것 (서버에 없다) ──
  /** 가상 친구의 글 (ADR-0021 결정 6) — 내 시뮬이 만들고 굽는다. 피드의 친구 구간에만 끼고 추천엔 절대 없다. 채우는 쪽은 sim/agentPosts */
  localPosts: FeedItem[];
  setLocalPosts(items: FeedItem[]): void;
  /** 에이전트가 써 둔 오늘의 초안 — 채팅의 '컷 고치기'나 내 글 탭에서 글쓰기 화면이 이걸 미리 채운 채 열린다 */
  draft: PostDraft | null;
  setDraft(draft: PostDraft | null): void;
  /** 가상 친구 글의 좋아요 — 서버가 없으니 내 폰에서만 뒤집힌다 */
  likeLocalToggle(postId: string): void;

  // ── UI 플래그 (화면은 다음 단계 — 여기서는 자리만) ──
  snsOpen: boolean;
  snsTab: SnsTab;
  /** 열려 있는 프로필의 userId, 없으면 null */
  profileOpen: string | null;
  /** 글쓰기(책의 고르기 모드, SNS_SPEC §7) */
  composeOpen: boolean;
  /** 닫으면(false) 열려 있던 프로필·글쓰기도 접는다 — 다시 열 때는 보던 탭으로 (채팅의 '보러 가기'가 남의 프로필에 떨어지지 않게) */
  setSnsOpen(open: boolean): void;
  setSnsTab(tab: SnsTab): void;
  setProfileOpen(userId: string | null): void;
  setComposeOpen(open: boolean): void;
}

/** 구분선 자리 — 첫 추천 글(why가 있는 첫 항목)의 index. 추천이 아직 없으면 -1 */
export const firstWhyIndex = (feed: readonly FeedItem[]): number => feed.findIndex(i => i.why !== undefined);

/** 받은 장을 뒤에 잇는다 — 이미 있는 글(id)은 건너뛴다 (좋아요 사이에 추천 경계가 움직여 같은 글이 다시 올 수 있다, §2.5) */
export function appendFeed(base: readonly FeedItem[], got: readonly FeedItem[]): FeedItem[] {
  const seen = new Set(base.map(i => i.post.id));
  const out = [...base];
  for (const i of got) if (!seen.has(i.post.id)) { seen.add(i.post.id); out.push(i); }
  return out;
}
const appendPosts = (base: readonly Post[], got: readonly Post[]): Post[] => {
  const seen = new Set(base.map(p => p.id));
  const out = [...base];
  for (const p of got) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
  return out;
};

/** 글 하나를 피드·내 글·프로필 어디에 있든 `fn`으로 바꾼다 (null이면 뺀다). 아무것도 안 바뀌면 같은 배열을 돌려준다 */
function mapEverywhere(s: Pick<SnsState, 'feed' | 'myPosts' | 'profiles'>, id: string, fn: (p: Post) => Post | null): Pick<SnsState, 'feed' | 'myPosts' | 'profiles'> {
  const posts = (arr: Post[]): Post[] => (arr.some(p => p.id === id) ? arr.flatMap(p => { if (p.id !== id) return [p]; const q = fn(p); return q ? [q] : []; }) : arr);
  const feed = s.feed.some(i => i.post.id === id) ? s.feed.flatMap(i => { if (i.post.id !== id) return [i]; const q = fn(i.post); return q ? [{ ...i, post: q }] : []; }) : s.feed;
  const myPosts = posts(s.myPosts);
  let profiles = s.profiles;
  for (const [uid, prof] of Object.entries(s.profiles)) {
    const next = posts(prof.posts);
    if (next !== prof.posts) profiles = { ...profiles, [uid]: { ...prof, posts: next } };
  }
  return { feed, myPosts, profiles };
}

/** 어디에든 있는 그 글 (좋아요 토글의 지금 값을 읽을 때) */
function findPost(s: Pick<SnsState, 'feed' | 'myPosts' | 'profiles'>, id: string): Post | null {
  return s.feed.find(i => i.post.id === id)?.post ?? s.myPosts.find(p => p.id === id) ?? Object.values(s.profiles).flatMap(p => p.posts).find(p => p.id === id) ?? null;
}

const emptyProfile = (): Profile => ({ posts: [], next: null, loading: false, failed: false, error: '' });

/** 글마다 마지막 좋아요 토글의 번호 — 겹쳐 누르면(연타) 마지막 것의 답만 적고, 먼저 간 것의 답은 늦게 와도 버린다 */
const likeSeq = new Map<string, number>();

export const useSns = create<SnsState>((set, get) => ({
  feed: [], feedNext: null, feedLoading: false, feedEnded: false, feedError: '',
  myPosts: [], myNext: null, myLoading: false,
  profiles: {},
  localPosts: loadLocalPosts(), draft: null,
  snsOpen: false, snsTab: 'feed', profileOpen: null, composeOpen: false,

  async loadFeed(reset = false) {
    const s = get();
    if (s.feedLoading) return;
    if (!reset && s.feedEnded) return;
    set({ feedLoading: true });
    const r = await fetchFeed(reset ? null : s.feedNext);
    if (!r) { set({ feedLoading: false, feedError: lastError || 'feed: failed' }); return; }   // 실패 — 있던 것은 그대로, 이유만 적는다
    const base = reset ? [] : get().feed;   // 그 사이 좋아요가 바뀌었을 수 있으니 지금 것에 잇는다
    set({ feed: appendFeed(base, r.items), feedNext: r.next, feedEnded: r.next === null, feedLoading: false, feedError: '' });
  },

  async likeToggle(postId) {
    const cur = findPost(get(), postId);
    if (!cur) return;
    const on = !cur.likedByMe;
    const before = { likes: cur.likes, likedByMe: cur.likedByMe };
    const seq = (likeSeq.get(postId) ?? 0) + 1;
    likeSeq.set(postId, seq);
    // 먼저 화면에
    set(s => mapEverywhere(s, postId, p => ({ ...p, likedByMe: on, likes: Math.max(0, p.likes + (on ? 1 : -1)) })));
    if (on) noteLiked(cur.authorId);
    const r = await setLike(postId, on);
    // 그 사이 또 눌렀으면 이 답은 낡았다 — 마지막 누름의 답이 적는다 (순서가 뒤바뀌어 와도 화면이 서버와 어긋나지 않게)
    if (likeSeq.get(postId) !== seq) return;
    likeSeq.delete(postId);
    // 서버가 준 수가 진실 — 거절이면 누르기 전으로
    const after = r ?? before;
    set(s => mapEverywhere(s, postId, p => ({ ...p, likedByMe: after.likedByMe, likes: after.likes })));
  },

  async loadMyPosts(more = false) {
    const s = get();
    if (s.myLoading) return;
    if (more && s.myNext === null && s.myPosts.length) return;   // 끝까지 받았다
    set({ myLoading: true });
    const r = await fetchMyPosts(more ? s.myNext : null);
    if (!r) { set({ myLoading: false }); return; }
    set({ myPosts: more ? appendPosts(get().myPosts, r.items) : r.items, myNext: r.next, myLoading: false });
  },

  async loadUserPosts(userId, more = false) {
    const cur = get().profiles[userId] ?? emptyProfile();
    if (cur.loading) return;
    if (more && cur.next === null && cur.posts.length) return;
    set(s => ({ profiles: { ...s.profiles, [userId]: { ...cur, loading: true } } }));
    const r = await fetchUserPosts(userId, more ? cur.next : null);
    set(s => {
      const now = s.profiles[userId] ?? cur;
      const prof: Profile = r
        ? { posts: more ? appendPosts(now.posts, r.items) : r.items, next: r.next, loading: false, failed: false, error: '' }
        : { ...now, loading: false, failed: true, error: lastError || 'user posts: failed' };
      return { profiles: { ...s.profiles, [userId]: prof } };
    });
  },

  async publishPost(body) {
    const p = await createPost(body);
    if (!p) return null;
    const me = currentUser()?.userId ?? p.authorId;
    set(s => {
      const mine = s.profiles[me];
      return {
        myPosts: [p, ...s.myPosts.filter(x => x.id !== p.id)],
        profiles: mine ? { ...s.profiles, [me]: { ...mine, posts: [p, ...mine.posts.filter(x => x.id !== p.id)] } } : s.profiles,
      };
    });
    return p;
  },

  async editPost(id, patch) {
    const p = await patchPost(id, patch);
    if (!p) return null;
    set(s => mapEverywhere(s, id, () => p));
    return p;
  },

  async removePost(id) {
    const ok = await deletePost(id);
    if (!ok) return false;
    set(s => mapEverywhere(s, id, () => null));
    return true;
  },

  // 가상 친구 글은 내 폰의 문서다 — 넣거나 좋아요를 뒤집을 때마다 저장한다 (최신 30편, 중복 없이)
  setLocalPosts: items => { const localPosts = normalizeLocal(items); set({ localPosts }); saveLocalPosts(localPosts); },
  setDraft: draft => set({ draft }),
  likeLocalToggle: postId => {
    const cur = get().localPosts.find(i => i.post.id === postId);
    if (!cur) return;
    const on = !cur.post.likedByMe;
    const localPosts = get().localPosts.map(i => (i.post.id !== postId ? i : { ...i, post: { ...i.post, likedByMe: on, likes: Math.max(0, i.post.likes + (on ? 1 : -1)) } }));
    set({ localPosts });
    saveLocalPosts(localPosts);
    if (on) noteLiked(cur.author.id);
  },
  setSnsOpen: open => set(open ? { snsOpen: true } : { snsOpen: false, profileOpen: null, composeOpen: false }),
  setSnsTab: tab => set({ snsTab: tab }),
  setProfileOpen: userId => set({ profileOpen: userId }),
  setComposeOpen: open => set({ composeOpen: open }),
}));
