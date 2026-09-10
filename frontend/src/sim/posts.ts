// ─── SNS 글·좋아요·피드 클라이언트 (docs/CONTRACT.md §2.5 · ADR-0021) ─────────────────────────────────────
// 글은 opaque 문서가 아니라 서버 리소스다 — 남이 읽어야 하므로 여기서 모양을 정하고 응답을 검증한다. 다른 관문(sync.ts의
// publishAgent·refreshRemote, llm.ts의 ask)과 같은 계약: **검증된 값 아니면 null, UI로 절대 throw하지 않는다.** 사용자가
// 없으면(오프라인으로 시작) fetch 없이 null. 실패 이유는 `lastError`에 한 줄로 남기고 console.warn은 같은 이유가 반복될 땐 한 번만.
// 검증은 순수 함수라 저장본·응답 어느 쪽에도 쓸 수 있다 (remote.ts의 validRemoteAgent와 같은 결).
import { ApiError, api, currentUser } from './api';
import type { RemoteAgent } from './types';
import { validRemoteAgent } from './remote';

// ─── 모양 (§2.5) ───────────────────────────────────────────────────────────────

/** 글의 컷 하나 — `shotId`는 내 미디어(PUT /api/media/{id}), `actKey`·`win`은 책의 그 컷을 가리킨다 */
export interface PostCut { shotId: string; actKey: string; win: 0 | 1 | 2 | 3; by: 'user' | 'agent' }

export interface Post {
  /** 서버가 만든 32자 hex */
  id: string;
  authorId: string;
  createdAt: number;
  /** 1~10장, 순서 있음 */
  cuts: PostCut[];
  caption: string;
  // 추천·검색 면
  place: string;
  area: string;
  city: string;
  category?: string;
  dateKey: string;
  /** 같이 논 친구 id만 (서버가 내 친구 목록과 교집합만 남긴다) */
  companions: string[];
  /** 주인이 고쳤다 ("주인이 고쳤어요" 표식) */
  editedByOwner: boolean;
  likes: number;
  likedByMe: boolean;
}

/** 피드 한 줄. `why`는 추천 구간에만 — 구분선은 첫 `why` 앞에 긋는다 (sns.firstWhyIndex) */
export interface FeedItem { post: Post; author: RemoteAgent; why?: string }
/** GET /api/feed — `next`를 그대로 되돌려 준다 (열어 보지 않는다). null이면 끝 */
export interface Feed { items: FeedItem[]; next: string | null }
/** GET /api/users/{id}/posts · GET /api/me/posts */
export interface Posts { items: Post[]; next: string | null }
/** POST/DELETE /api/posts/{id}/like */
export interface Likes { likes: number; likedByMe: boolean }

/** POST /api/posts 본문. `authorId`는 헤더의 나 — 싣지 않는다 */
export interface PostIn {
  cuts: PostCut[];
  /** ≤ 300자, 없으면 빈 캡션 */
  caption?: string;
  place: string;
  area: string;
  city: string;
  category?: string;
  dateKey: string;
  companions?: string[];
  editedByOwner?: boolean;
}
/** PATCH /api/posts/{id} 본문 — 온 칸만 바꾼다 (고치면 서버가 editedByOwner를 켠다) */
export interface PostPatch { cuts?: PostCut[]; caption?: string }

/**
 * 에이전트가 써 둔 초안 (SNS_SPEC §8·§9). 아직 서버에 없다 — 올리면 PostIn이 된다.
 * `reason`이 있으면 고민이 있어 주인에게 물은 것(채팅의 '그대로 올려 / 컷 고치기'), `dueAt`은 답이 없으면 그냥 올리는 시각.
 */
export interface PostDraft {
  id: string;
  cuts: PostCut[];
  caption: string;
  place: string;
  area: string;
  city: string;
  category?: string;
  dateKey: string;
  companions: string[];
  reason?: string;
  dueAt?: number;
}

/** 컷 개수 상한 (SNS_SPEC §3) */
export const MAX_CUTS = 10;
/** 캡션 길이 상한 (§2.5 POST /api/posts) */
export const MAX_CAPTION = 300;
/** 한 장의 기본 크기 (§2.5 limit 1~50) */
export const PAGE_LIMIT = 20;

// ─── 검증 (모양이 틀리면 null — 모르는 키는 그냥 지나간다) ───────────────────────

const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown, maxItems: number, maxLen: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= maxLen).slice(0, maxItems) : []);

/** 컷 하나. shotId 32자 hex · actKey 1~120자 · win 0~3 · by user|agent */
export function validPostCut(raw: unknown): PostCut | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<PostCut>;
  if (!str(c.shotId, 32) || !/^[0-9a-f]{32}$/.test(c.shotId) || !str(c.actKey, 120)) return null;
  if (c.win !== 0 && c.win !== 1 && c.win !== 2 && c.win !== 3) return null;
  if (c.by !== 'user' && c.by !== 'agent') return null;
  return { shotId: c.shotId, actKey: c.actKey, win: c.win, by: c.by };
}

/** 글 하나. 컷이 하나라도 틀리면 글을 버린다 (컷 순서가 뜻이라 일부만 남기면 다른 글이 된다). */
export function validPost(raw: unknown): Post | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Post>;
  if (!str(p.id, 80) || !str(p.authorId, 80) || !finite(p.createdAt)) return null;
  if (!Array.isArray(p.cuts) || p.cuts.length < 1 || p.cuts.length > MAX_CUTS) return null;
  const cuts: PostCut[] = [];
  for (const c of p.cuts) { const v = validPostCut(c); if (!v) return null; cuts.push(v); }
  if (typeof p.caption !== 'string' || typeof p.place !== 'string' || typeof p.area !== 'string' || typeof p.city !== 'string' || !str(p.dateKey, 120)) return null;
  if (!finite(p.likes) || typeof p.likedByMe !== 'boolean' || typeof p.editedByOwner !== 'boolean') return null;
  const out: Post = {
    id: p.id, authorId: p.authorId, createdAt: p.createdAt, cuts,
    caption: p.caption.normalize('NFC'), place: p.place.normalize('NFC'), area: p.area.normalize('NFC'), city: p.city, dateKey: p.dateKey,
    companions: strings(p.companions, 16, 80), editedByOwner: p.editedByOwner, likes: Math.max(0, Math.floor(p.likes)), likedByMe: p.likedByMe,
  };
  if (str(p.category, 12)) out.category = p.category;
  return out;
}

/** 이유 칩 표시 상한 — `'<area> 이웃'`은 area(서버 상한 120자)만큼 길 수 있다. 길다고 버리면 추천 글이 친구 글로 둔갑하니(구분선은 why 유무) 자른다 */
const MAX_WHY = 140;

/** 피드 한 줄 — 글과 작성자가 둘 다 멀쩡해야 한다. `why`는 비어 있지 않은 문자열일 때만 실린다 (길면 잘라서 — 있냐 없냐가 구간을 가른다) */
export function validFeedItem(raw: unknown): FeedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Partial<FeedItem>;
  const post = validPost(f.post);
  const author = validRemoteAgent(f.author);
  if (!post || !author) return null;
  const out: FeedItem = { post, author };
  if (typeof f.why === 'string' && f.why.length > 0) out.why = f.why.slice(0, MAX_WHY);
  return out;
}

/** 커서: 서버가 준 문자열 그대로, 아니면 null(끝) */
const cursorOf = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 512 ? v : null);

/** 한 장의 피드. 틀린 항목은 항목만 버린다 — 한 줄이 이상하다고 장 전체를 잃진 않는다. `items`가 배열이 아니면 null */
export function validFeed(raw: unknown): Feed | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Partial<Feed>;
  if (!Array.isArray(f.items)) return null;
  return { items: f.items.map(validFeedItem).filter((x): x is FeedItem => !!x), next: cursorOf(f.next) };
}

/** 한 장의 글 목록 (프로필 격자·내 글). 틀린 글은 글만 버린다 */
export function validPosts(raw: unknown): Posts | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Partial<Posts>;
  if (!Array.isArray(f.items)) return null;
  return { items: f.items.map(validPost).filter((x): x is Post => !!x), next: cursorOf(f.next) };
}

export function validLikes(raw: unknown): Likes | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Partial<Likes>;
  if (!finite(l.likes) || typeof l.likedByMe !== 'boolean') return null;
  return { likes: Math.max(0, Math.floor(l.likes)), likedByMe: l.likedByMe };
}

// ─── 클라이언트 ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

/** 마지막 실패 이유 (`'feed: 403 not allowed'` 꼴). 성공하면 빈 문자열. UI가 "친구만 볼 수 있어요" 같은 말을 고를 때 본다 */
export let lastError = '';
/** 마지막으로 console.warn한 이유 — 같은 이유가 연달아 나면 한 번만 적는다 */
let warned = '';

/** 서버가 준 오류 문자열 (`'not yours'`·`'cut not yours'`·`'cursor invalid'`…). ApiError가 아니면 메시지 */
export const errorOf = (e: unknown): string => (e instanceof ApiError ? (e.status ? `${e.status} ${e.error}` : e.error) : e instanceof Error ? e.message : String(e));

const fail = (what: string, e: unknown): null => {
  lastError = `${what}: ${errorOf(e)}`;
  if (lastError !== warned) { warned = lastError; console.warn(`[posts] ${lastError}`); }
  return null;
};
const ok = <T>(v: T): T => { lastError = ''; return v; };
const enc = encodeURIComponent;
const page = (path: string, cursor: string | null | undefined, limit: number) => `${path}?limit=${Math.min(50, Math.max(1, Math.floor(limit)))}${cursor ? `&cursor=${enc(cursor)}` : ''}`;

/**
 * 서버에 묻고 검증한다. 사용자가 없으면 fetch 없이 null(오프라인은 실패가 아니라 조용함 — warn 없이 `lastError`만 `'no user'`로, 앞선 이유가
 * 남지 않게), 서버 오류·모양 오류는 `lastError`에 남기고 null. 어느 경우에도 throw하지 않는다.
 */
async function call<T>(what: string, path: string, valid: (j: unknown) => T | null, opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<T | null> {
  if (!currentUser()) { lastError = `${what}: no user`; return null; }
  try {
    const j = await api<unknown>(path, { ...opts, timeoutMs: TIMEOUT_MS });
    const v = valid(j);
    return v === null ? fail(what, new ApiError(0, 'bad response')) : ok(v);
  } catch (e) {
    return fail(what, e);
  }
}

/** `POST /api/posts` → 만들어진 글 (id는 서버가 만든다). 컷이 내 미디어가 아니면 `400 'cut not yours'` → null */
export const createPost = (body: PostIn): Promise<Post | null> => call('post', '/api/posts', validPost, { method: 'POST', body });

/** `PATCH /api/posts/{id}` — 온 칸만 바꾼다. 작성자가 아니면 `403 'not yours'` → null */
export const patchPost = (id: string, patch: PostPatch): Promise<Post | null> => call('patch', `/api/posts/${enc(id)}`, validPost, { method: 'PATCH', body: patch });

/** `DELETE /api/posts/{id}` — 지웠으면 true (204). 작성자가 아니면 false */
export async function deletePost(id: string): Promise<boolean> {
  return (await call('delete', `/api/posts/${enc(id)}`, () => true, { method: 'DELETE' })) === true;
}

/** 좋아요 켜기(`POST …/like`)·끄기(`DELETE …/like`). 멱등 — 돌아온 수가 진실이다. 비공개 계정의 글은 친구만(`403 'not allowed'`) */
export const setLike = (id: string, on: boolean): Promise<Likes | null> => call('like', `/api/posts/${enc(id)}/like`, validLikes, { method: on ? 'POST' : 'DELETE' });

/** `GET /api/feed?cursor&limit` — 친구 글 먼저(why 없음), 이어서 추천(why 있음). `cursor`는 지난 장의 `next` 그대로, 처음엔 없이 */
export const fetchFeed = (cursor?: string | null, limit = PAGE_LIMIT): Promise<Feed | null> => call('feed', page('/api/feed', cursor, limit), validFeed);

/** `GET /api/users/{id}/posts` — 그 사람의 글 격자. 비공개 + 친구 아님이면 `403 'not allowed'` → null */
export const fetchUserPosts = (id: string, cursor?: string | null, limit = PAGE_LIMIT): Promise<Posts | null> => call('posts', page(`/api/users/${enc(id)}/posts`, cursor, limit), validPosts);

/** `GET /api/me/posts` — 내 글 */
export const fetchMyPosts = (cursor?: string | null, limit = PAGE_LIMIT): Promise<Posts | null> => call('me/posts', page('/api/me/posts', cursor, limit), validPosts);
