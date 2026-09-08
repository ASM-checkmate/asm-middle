// ─── 서버 관문 (BACKEND-CONTRACT §3.1 · AUTH-ADDENDUM · docs/adr/0012-spring-backend.md) ─────────────────────
// 토큰 없는 고정 아이디 로그인: 서버가 미리 가진 아이디(yoongwan·hojun·guest1…) 중 하나를 골라 `POST /api/auth/login`으로
// 확인받고 `theworld.user.v1`에 `{ userId, name }`으로 둔다. 비밀번호·세션·기기 id 없음. 보호 경로는 `X-User-Id: <id>`
// 헤더 하나로 통한다. 401을 받으면(서버가 이 아이디를 모른다 — DB 초기화) 저장된 사용자를 버리고 "로그인 필요"로 둔다.
// fetch/localStorage가 없는 환경(node 하네스)에서는 전부 no-op/null — 앱은 백엔드 없이도 돈다 (ADR-0006 결정 4).

/** 배포 빌드에서 다른 오리진의 서버를 쓸 때 (`VITE_API_BASE=https://…`). 개발은 Vite 프록시라 빈 문자열(same-origin). */
export const API_BASE: string = import.meta.env?.VITE_API_BASE ?? '';

const USER_KEY = 'theworld.user.v1';
/** 아이디 모양 (서버 규칙은 `^[a-z][a-z0-9_]{1,23}$` — 여기서는 저장소의 쓰레기만 거른다) */
const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): StorageLike | null => {
  try { return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage : null; } catch { return null; }
};
/** 이 환경에 fetch가 있나 (없으면 관문 전체가 조용히 꺼진다). */
export const hasNet = (): boolean => typeof fetch === 'function';
/** 이 환경에 localStorage가 있나. */
export const hasStorage = (): boolean => storage() !== null;

/** 들어와 있는 사용자 (`theworld.user.v1`). 아이디 하나 = 에이전트 하나 = 서버 문서 한 벌. */
export interface User { userId: string; name: string }

const parseUser = (raw: unknown): User | null => {
  const u = raw as Partial<User> | null;
  return u && typeof u.userId === 'string' && ID_RE.test(u.userId) && typeof u.name === 'string' && u.name ? { userId: u.userId, name: u.name } : null;
};

/** 저장된 사용자. 없거나 모양이 틀리면 null (= 오프라인·로그인 필요). */
export function currentUser(): User | null {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(USER_KEY);
    return raw ? parseUser(JSON.parse(raw)) : null;
  } catch { return null; }
}
/** 사용자를 버린다 (로그아웃·401). 로컬 저장본은 sync.clearLocalDocs가 따로 비운다. */
export function logout() { try { storage()?.removeItem(USER_KEY); } catch { /* ignore */ } }
const saveUser = (u: User) => { try { storage()?.setItem(USER_KEY, JSON.stringify(u)); } catch { /* ignore */ } };

/** 서버가 `!ok`로 답했을 때. `status` 0은 네트워크·제한 시간·환경 부재·사용자 없음. `body`는 파싱된 오류 본문 (409면 서버본이 들어 있다). */
export class ApiError extends Error {
  status: number;
  error: string;
  body: unknown;
  constructor(status: number, error: string, body: unknown = null) {
    super(`${status} ${error}`);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
    this.body = body;
  }
}
/** 이 오류가 "사용자가 없거나 서버가 모른다"인가 — 네트워크 실패(down)가 아니라 로그인이 필요한 상태 */
export const isAuthError = (e: unknown): boolean => e instanceof ApiError && (e.status === 401 || (e.status === 0 && e.error === 'no user'));

/** 제한 시간 신호 (+ 호출자의 신호). AbortSignal.timeout/any가 없는 환경이면 있는 것만. */
const signalOf = (timeoutMs: number, outer?: AbortSignal): AbortSignal | undefined => {
  const t = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
  if (outer && t && typeof AbortSignal.any === 'function') return AbortSignal.any([outer, t]);
  return outer ?? t;
};

/** 응답 본문을 JSON으로. 비었거나 JSON이 아니면 null. */
const jsonOf = async (res: Response): Promise<unknown> => { try { return await res.json(); } catch { return null; } };

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON으로 직렬화해 보낸다 (content-type: application/json) */
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 기본 true — `X-User-Id`를 붙인다 (사용자가 없으면 `ApiError(0,'no user')`). 공개 경로(users/login/health/models)는 false */
  auth?: boolean;
  /** 페이지가 닫히는 중에도 보낸다 (pagehide flush) */
  keepalive?: boolean;
}

/**
 * 서버에 한 번 묻는다. `X-User-Id`·`content-type`·제한 시간을 붙이고, `!ok`면 `ApiError`를 던진다 (본문 `{error}`를 담아서).
 * 사용자가 없으면 `ApiError(0,'no user')`(오프라인 취급), 401이면 저장된 사용자를 버리고 `ApiError(401)`. fetch가 없는 환경이면 `ApiError(0)`.
 *
 * @param path `/api/…`
 * @returns 응답 JSON (204면 undefined)
 */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  if (!hasNet()) throw new ApiError(0, 'no fetch');
  const { method = 'GET', body, timeoutMs = 10_000, signal, auth = true, keepalive } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const u = currentUser();
    if (!u) throw new ApiError(0, 'no user');
    headers['x-user-id'] = u.userId;
  }
  let res: Response;
  try {
    const init: RequestInit = { method, headers, signal: signalOf(timeoutMs, signal) };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (keepalive) init.keepalive = true;
    res = await fetch(API_BASE + path, init);
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? (e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : e.message || 'network') : 'network');
  }
  if (res.status === 401 && auth) {
    // 서버가 이 아이디를 모른다 (DB 초기화·시드 변경) — 버리고 로그인 화면이 다시 묻게 둔다
    logout();
    throw new ApiError(401, 'unauthorized', await jsonOf(res));
  }
  if (!res.ok) {
    const j = await jsonOf(res);
    const error = j && typeof (j as { error?: unknown }).error === 'string' ? (j as { error: string }).error : `http ${res.status}`;
    throw new ApiError(res.status, error, j);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 고를 수 있는 아이디들 (`GET /api/users`, 기본 2초). 서버가 없거나 모양이 틀리면 null — 로그인 화면을 그리지 않는 근거. */
export async function fetchUsers(timeoutMs = 2_000): Promise<User[] | null> {
  if (!hasNet()) return null;
  try {
    const j = await api<{ users?: unknown[] }>('/api/users', { auth: false, timeoutMs });
    if (!Array.isArray(j?.users)) return null;
    return j.users
      .map(raw => { const x = (raw ?? null) as { id?: unknown; name?: unknown } | null; return parseUser({ userId: x?.id, name: x?.name }); })
      .filter((u): u is User => !!u);
  } catch {
    return null;
  }
}

/**
 * 이 아이디로 들어간다 (`POST /api/auth/login`). 서버가 확인해 주면 `theworld.user.v1`에 저장하고 돌려준다.
 * 모르는 아이디(404)·서버 없음은 `ApiError`로 던진다 — 로그인 화면이 말로 보여 준다.
 */
export async function login(userId: string, timeoutMs = 4_000): Promise<User> {
  const r = await api<{ userId?: unknown; name?: unknown }>('/api/auth/login', { method: 'POST', body: { userId }, auth: false, timeoutMs });
  const u = parseUser(r);
  if (!u || u.userId !== userId) throw new ApiError(0, 'bad login response');
  saveUser(u);
  return u;
}

/** 서버가 살아 있나 (`GET /api/health`, 기본 2초). fetch가 없으면 false. */
export async function health(timeoutMs = 2_000): Promise<boolean> {
  if (!hasNet()) return false;
  try {
    const j = await api<{ ok?: boolean }>('/api/health', { auth: false, timeoutMs });
    return j?.ok === true;
  } catch {
    return false;
  }
}
