// ─── 문서 동기화 + 백엔드 상태 (BACKEND-CONTRACT §3.3 · docs/adr/0012-spring-backend.md) ─────────────────────
// localStorage 저장본 4개(places·memory·world·book)를 불투명 JSON 문서로 서버(`/api/me/docs/{name}`)와 맞춘다.
// 시뮬레이션은 프런트에 남는다(ADR-0006 결정 5): 서버는 저장·버전만 알고, 마이그레이션·검증·catch-up은 여전히
// 스토어 부팅 코드가 한다. 그래서 받은 문서는 localStorage에 쓰고 **스토어를 그 뒤에 만든다** (main.tsx).
// 서버가 없으면 조용히 오프라인(`backend:'down'`) — 앱은 그대로 뜬다. fetch/localStorage가 없는 하네스에서는 전부 no-op.
// 사용자(api.currentUser)가 없으면 아무것도 주고받지 않는다 — "오프라인으로 시작". 아이디 하나 = 서버 문서 한 벌이라 이 기기에
// 다른 아이디가 들어오면(메타의 userId ≠ 현재 userId, 또는 로그인·로그아웃 액션) 로컬 저장본을 비우고 그 아이디의 문서를 받는다
// (AUTH-ADDENDUM). 401(서버가 아이디를 모른다)은 down이 아니라 "로그인 필요": 사용자를 버리고 서버는 살아 있다고 둔다.
//
// §3.4(진짜 사람 에이전트)의 publishAgent/publishSchedule/refreshRemote/addFriendRemote는 맨 아래 — 같은 관문(api)·같은
// 상태(backend/lastError)를 쓴다. 무엇을 묻고 결과를 어디에 얹을지는 스토어가 정한다 (이 모듈은 스토어를 모른다).
import { ApiError, api, currentUser, hasNet, hasStorage, health, isAuthError, logout } from './api';
import { clockWhy, loadClock, simNow } from './clock';
import type { Gender, Place, PublishedActivity, RemoteAgent, RemoteHit, Visibility } from './types';
import { validPublished, validRemoteAgent, type RemoteFetch, type SlotReq } from './remote';
// media.ts도 이 모듈을 읽는다(syncArmed·syncSnapshot·subscribeSync·remoteOk/remoteFailed) — 순환이지만 둘 다 모듈 평가 때는 서로를 안 부른다
import { clearMedia } from './media';

export type DocName = 'world' | 'memory' | 'book' | 'places';
/** 문서 이름 → localStorage 키 (store.ts·places.ts의 키와 같아야 한다). */
export const DOC_KEYS: Record<DocName, string> = {
  places: 'theworld.places.v1',
  memory: 'theworld.memory.v2',
  world: 'theworld.world.v5',
  book: 'theworld.book.v1',
};
/** 받는 순서: 장소 팩이 world보다 먼저 있어야 validAnchor·placeOrNull이 그 도시의 활동을 살린다. */
const BOOT_ORDER: DocName[] = ['places', 'memory', 'world', 'book'];
const META_KEY = 'theworld.sync.v1';
/**
 * 사용자가 바뀔 때 비우는 이 기기의 저장본 — 문서 4개와 그 옛 판, 본 시각·온보딩·동기화 메타. clock·llm·route는 기기 것이라 남긴다
 * (store.ts·places.ts·chat의 키와 같아야 한다).
 */
const LOCAL_KEYS = ['theworld.world.v5', 'theworld.world.v4', 'theworld.days.v3', 'theworld.memory.v2', 'theworld.book.v1', 'theworld.places.v1', 'theworld.seen.v3', 'theworld.chatseen.v1', 'theworld.onboarded.v1', META_KEY,
  'theworld.auth.v1', 'theworld.device.v1',   // 옛 기기 토큰(2026-09-08 이전) — 이제 안 쓰니 같이 지운다
  'theworld.media-queue.v1'] as const;          // 아직 안 올린 사진 id들 (media.ts MEDIA_QUEUE_KEY와 같아야 한다) — 다른 아이디의 사진을 올리지 않게

export type BackendStatus = 'unknown' | 'ok' | 'down';
export interface SyncInfo {
  userId: string | null;
  versions: Record<string, number>;
  /** 마지막으로 서버가 받아 준 시각 (실제 ms) */
  lastPushAt: number | null;
  lastError: string | null;
  /** world/book을 받거나 올리지 않은 이유 (dev 시계·미래 anchor). 없으면 null */
  skipped: string | null;
}
export interface SyncSnapshot { backend: BackendStatus; sync: SyncInfo }

/** 부트스트랩 전체 상한 — 이 안에 못 끝내면 앱이 먼저 뜬다 */
const BOOT_DEADLINE_MS = 3_000;
/** 부트스트랩 요청 하나의 제한 시간 */
const BOOT_REQ_MS = 2_500;
/** 저장 뒤 서버에 올리기까지 기다리는 시간 — 한 액션이 persist를 2~3번 연달아 부른다 */
const DEBOUNCE_MS = 800;
const PUT_TIMEOUT_MS = 15_000;
/** 네트워크 실패 뒤 재시도 간격: 2s → 4s → … ≤ 60s */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;
/** keepalive fetch의 본문 상한(브라우저 64 KB) — 넘는 문서는 보통 요청으로 보낸다 (문자 수로 재면 바이트보다 작거나 같다) */
const KEEPALIVE_MAX_CHARS = 60_000;

/** 로컬 메타 (`theworld.sync.v1`): 어느 사용자의 몇 판을 갖고 있나. `fresh` = 비운 뒤 아직 서버 목록을 한 번도 못 받았다. */
interface Meta { userId: string | null; versions: Record<string, number>; lastPushAt: Record<string, number>; fresh?: boolean }
interface Entry { body: unknown; savedAt: number; timer: ReturnType<typeof setTimeout> | null }

let meta: Meta = { userId: null, versions: {}, lastPushAt: {} };
/** 지금 들어와 있는 사용자 (api.currentUser의 복사본). 없거나 401로 버려졌으면 null — 그동안은 아무것도 주고받지 않는다 */
let userId: string | null = null;
let backend: BackendStatus = 'unknown';
let lastError: string | null = null;
let skipped: string | null = null;
/** bootstrapSync가 돌았나 — 안 돌았으면(하네스) 저장 훅·health가 아무것도 안 한다 */
let armed = false;
/** 서버본을 받아들여 새로 뜨는 중 — 그 사이의 저장은 올리지 않는다 (낡은 상태로 서버를 덮지 않게) */
let adopting = false;
/** 디바운스 대기 중(또는 진행 중인 PUT 뒤에 다시 보낼) 문서 */
const pending = new Map<DocName, Entry>();
/** 네트워크 실패로 백오프 대기 중인 문서 */
const failed = new Map<DocName, Entry>();
const inflight = new Map<DocName, Promise<void>>();
/** 문서별 마지막 로컬 저장 시각 — 409 때 "누가 더 나중인가"의 내 쪽 근거 */
const lastLocalSaveAt: Partial<Record<DocName, number>> = {};
/** 부트스트랩이 서버본이 더 새것임을 알고도 못 받은 문서(데드라인·네트워크) — 첫 409에서 서버본을 채택할 근거 */
const unpulled = new Set<DocName>();
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let hooksInstalled = false;
const listeners = new Set<(s: SyncSnapshot) => void>();

const isDoc = (n: string): n is DocName => n in DOC_KEYS;
/** node 타이머가 프로세스를 붙잡지 않게 (브라우저에는 unref가 없다) */
const unref = (t: ReturnType<typeof setTimeout>) => { (t as { unref?: () => void }).unref?.(); };
const readLocal = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key: string, body: unknown) => { try { localStorage.setItem(key, JSON.stringify(body)); } catch { /* ignore */ } };
const loadMeta = (): Meta => {
  try {
    const raw = localStorage.getItem(META_KEY);
    const m = raw ? (JSON.parse(raw) as Partial<Meta>) : null;
    const versions: Record<string, number> = {};
    for (const [k, v] of Object.entries(m?.versions ?? {})) if (isDoc(k) && Number.isFinite(v)) versions[k] = v as number;
    const lastPushAt: Record<string, number> = {};
    for (const [k, v] of Object.entries(m?.lastPushAt ?? {})) if (isDoc(k) && Number.isFinite(v)) lastPushAt[k] = v as number;
    return { userId: typeof m?.userId === 'string' ? m.userId : null, versions, lastPushAt, fresh: m?.fresh === true };
  } catch { return { userId: null, versions: {}, lastPushAt: {} }; }
};
const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ } };

/**
 * 이 기기의 저장본을 비운다 (사용자가 바뀔 때 — 로그인 화면·DevPanel "바꾸기"·부트스트랩의 메타 불일치). 대기 중인 푸시도 버린다.
 * clock·llm·route는 남는다. 그 뒤 `bootstrapSync()`가 새 사용자의 문서를 받는다 (없으면 새 하루).
 */
export function clearLocalDocs() {
  cancelAll();
  for (const k of LOCAL_KEYS) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  // 폰의 사진 캐시(IndexedDB·blob URL)도 그 아이디의 것이다 — 같이 비운다 (ADR-0020 결정 5). 실패는 삼킨다
  void clearMedia().catch(() => { /* ignore */ });
  // 비운 기기에서 새 하루가 먼저 저장되면 baseVersion 0의 PUT이 409를 받는다 — 서버 목록을 받기 전까지는 그 409에서 서버본을 채택한다
  meta = { userId: null, versions: {}, lastPushAt: {}, fresh: true };
  unpulled.clear();
  skipped = null;
}

/** 지금 상태 (스토어의 `backend`·`sync` 필드가 이걸 복사한다). */
export function syncSnapshot(): SyncSnapshot {
  const pushed = Object.values(meta.lastPushAt);
  return {
    backend,
    sync: { userId, versions: { ...meta.versions }, lastPushAt: pushed.length ? Math.max(...pushed) : null, lastError, skipped },
  };
}
/** 상태가 바뀔 때마다 부른다. 해지 함수를 돌려준다. (스토어가 구독한다 — 이 모듈은 스토어를 모른다) */
export function subscribeSync(fn: (s: SyncSnapshot) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const notify = () => { const s = syncSnapshot(); for (const l of listeners) l(s); };

/** sim 시계가 실시간이 아닌 이유("x10"·"점프", clock.clockWhy) — 있으면 dev가 시간을 돌리는 중이라 world/book을 주고받지 않는다. 실시간이면 null */
const devClock = (): string | null => { try { return clockWhy(loadClock()); } catch { return null; } };
const anchorT = (body: unknown): number | null => {
  const t = (body as { anchor?: { t?: unknown } } | null)?.anchor?.t;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
};
const reload = () => { try { if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload(); } catch { /* ignore */ } };
const errorText = (e: unknown) => (e instanceof ApiError ? (e.status ? `${e.status} ${e.error}` : e.error) : e instanceof Error ? e.message : String(e));
/**
 * 401(api가 저장된 사용자를 이미 버렸다) 또는 사용자 없음: down이 아니라 "로그인 필요". 밀린 푸시는 버리고 사용자를 null로 —
 * 스토어의 remoteOn(sync.userId)·onLocalSave가 그대로 멈춘다. 새로 뜨면 main.tsx가 로그인 화면을 그린다.
 */
const authLost = () => {
  userId = null;
  cancelAll();
  lastError = '로그인 필요 — 서버가 이 아이디를 모른다';
};

// ─── 부트스트랩 ────────────────────────────────────────────────────────────────

/**
 * 앱이 뜨기 전에 한 번: 사용자 확인 → (다른 사용자의 저장본이면 비우고) 서버 문서 목록 → 서버가 더 새것인(또는 로컬에 없는)
 * 문서를 places→memory→world→book 순서로 받아 localStorage에 쓴다. 사용자가 없으면 아무것도 받지 않고 끝난다(armed 아님).
 * 가드: dev 시계 scale≠1이거나 서버 world의 anchor가 이 기기의 지금보다 미래면 world/book은 건너뛴다(`skipped`에 이유).
 * 3초 안에 끝나며, 실패해도 앱은 뜬다.
 */
export async function bootstrapSync(): Promise<void> {
  cancelAll();
  if (!hasNet() || !hasStorage()) return;
  const user = currentUser();
  userId = user?.userId ?? null;
  meta = loadMeta();
  if (!user) {
    // 오프라인으로 시작: 서버와 아무것도 주고받지 않는다 (health도, 푸시도, 진짜 사람도). 로컬 저장본은 그대로
    armed = false;
    backend = 'unknown';
    notify();
    return;
  }
  armed = true;
  adopting = false;
  // 이 기기의 저장본이 다른 아이디의 것이다 (또는 아직 누구 것도 아니다) — 비우고 이 아이디의 문서를 받는다 (AUTH-ADDENDUM 결정 3)
  if (meta.userId !== user.userId) { clearLocalDocs(); meta.userId = user.userId; saveMeta(); }
  // 비운 뒤 목록을 못 받은 채 새로 떴다면 여전히 fresh — 첫 409는 서버본
  if (meta.fresh) for (const name of BOOT_ORDER) unpulled.add(name);
  installFlushHooks();
  const ctl = new AbortController();
  const deadline = setTimeout(() => ctl.abort(), BOOT_DEADLINE_MS);
  unref(deadline);
  // 데드라인을 넘긴 요청은 abort로 끝나지만, 혹시 몰라 앱이 먼저 뜨도록 한 번 더 막는다
  let wake: (() => void) | undefined;
  const guardP = new Promise<void>(res => { wake = res; });
  const guard = setTimeout(() => wake?.(), BOOT_DEADLINE_MS + 200);
  unref(guard);
  try {
    await Promise.race([pull(ctl.signal), guardP]);
  } catch (e) {
    if (isAuthError(e)) { backend = 'ok'; authLost(); }   // 서버는 살아 있다 — 아이디만 모른다
    else { backend = 'down'; lastError = errorText(e); }
  } finally {
    clearTimeout(deadline);
    clearTimeout(guard);
    saveMeta();
    notify();
  }
}

async function pull(signal: AbortSignal) {
  const list = await api<{ docs?: Record<string, { version?: number; updatedAt?: number; clientTs?: number }> }>('/api/me/docs', { signal, timeoutMs: BOOT_REQ_MS });
  backend = 'ok';
  lastError = null;
  meta.fresh = false;
  const clock = loadClock();
  // 이 기기의 지금 (scale 1이면 Date.now()와 같다; jump한 시계면 그 시각 — 그보다 미래인 anchor는 못 살린다)
  const now = Number.isFinite(clock.anchorSim) && Number.isFinite(clock.anchorReal) ? simNow(clock) : Date.now();
  const why = clockWhy(clock);   // scale≠1뿐 아니라 점프한 시계(scale 1, sim ≠ 실제)도 dev 시계다
  let hold: string | null = why ? `dev 시계 ${why} — world/book은 안 받음` : null;
  unpulled.clear();
  for (const name of BOOT_ORDER) {
    const remote = list.docs?.[name];
    const local = readLocal(DOC_KEYS[name]);
    if (!remote || typeof remote.version !== 'number') {
      // 서버에 없다: 로컬 것이 있으면 다음 저장 때 baseVersion 0으로 만들어진다
      if (local !== null) meta.versions[name] = 0; else delete meta.versions[name];
      continue;
    }
    const mine = meta.versions[name] ?? 0;
    if (!(remote.version > mine || local === null)) continue;
    if ((name === 'world' || name === 'book') && hold) { skipped = hold; continue; }
    // 받으려던 문서 — 여기서 끊기면(데드라인·네트워크) 낡은 로컬본이 첫 PUT에서 새 서버본을 force로 덮지 않게 기억한다
    unpulled.add(name);
    const doc = await api<{ version?: number; body?: unknown }>(`/api/me/docs/${name}`, { signal, timeoutMs: BOOT_REQ_MS });
    unpulled.delete(name);
    if (typeof doc?.version !== 'number' || doc.body === undefined) continue;
    if (name === 'world') {
      const t = anchorT(doc.body);
      if (t !== null && t > now) {
        // 다른 기기가 시간을 앞당겨 살았다 — 이 기기에서 그 세계를 살리면 today가 어긋난다 (liveOut이 빈 결과)
        hold = `서버 world의 anchor(${new Date(t).toISOString()})가 미래 — world/book은 안 받음`;
        skipped = hold;
        continue;
      }
    }
    writeLocal(DOC_KEYS[name], doc.body);
    meta.versions[name] = doc.version;
  }
  if (!hold) skipped = null;
}

// ─── 푸시 ──────────────────────────────────────────────────────────────────────

/**
 * 스토어의 save()·places.ts의 saveDynamic()이 부른다. 문서별 800 ms 디바운스 뒤 PUT.
 * 부트스트랩이 안 돌았으면(하네스) 아무것도 안 한다.
 *
 * @param name 문서 이름
 * @param value localStorage에 쓴 값 그대로 (JSON 본문이 된다)
 */
export function onLocalSave(name: DocName, value: unknown) {
  if (!armed || adopting || !userId) return;
  const now = Date.now();
  lastLocalSaveAt[name] = now;
  const prev = pending.get(name);
  if (prev?.timer) clearTimeout(prev.timer);
  failed.delete(name);   // 새 저장이 밀린 것을 대신한다
  const timer = setTimeout(() => { void flush(name); }, DEBOUNCE_MS);
  unref(timer);
  pending.set(name, { body: value, savedAt: now, timer });
}

/** 대기 중인 문서를 지금 올린다 (진행 중인 것은 기다렸다가). pagehide 때는 keepalive로. */
export async function flushAll(keepalive = false): Promise<void> {
  await Promise.all([...inflight.values()]);
  await Promise.all([...pending.keys()].map(n => flush(n, keepalive)));
  await Promise.all([...inflight.values()]);
}

async function flush(name: DocName, keepalive = false): Promise<void> {
  const p = pending.get(name);
  if (!p) return;
  if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  if (inflight.has(name)) return;   // 진행 중 — 끝나면 남은 것을 다시 본다
  const why = name === 'world' || name === 'book' ? devClock() : null;
  if (why) {
    // dev가 시간을 돌리는 중(x10이든 점프든): 그 하루를 서버(다른 기기)에 옮기면 안 된다
    pending.delete(name);
    skipped = `dev 시계 ${why} — ${name}은 안 올림`;
    notify();
    return;
  }
  pending.delete(name);
  // keepalive fetch는 본문 64 KB 상한이라(Chromium은 넘으면 바로 거부) 큰 문서(사진이 든 book·shots)는 보통 요청으로 — 탭이 숨는 것뿐이면 도착한다
  const big = keepalive && JSON.stringify(p.body).length > KEEPALIVE_MAX_CHARS;
  const run = put(name, p, keepalive && !big, false);
  inflight.set(name, run);
  try { await run; } finally {
    inflight.delete(name);
    if (pending.has(name)) void flush(name, keepalive);
  }
}

async function put(name: DocName, p: Entry, keepalive: boolean, force: boolean): Promise<void> {
  const body: Record<string, unknown> = { baseVersion: meta.versions[name] ?? 0, clientTs: p.savedAt, body: p.body };
  if (force) body.force = true;
  try {
    const r = await api<{ version?: number }>(`/api/me/docs/${name}`, { method: 'PUT', body, timeoutMs: PUT_TIMEOUT_MS, keepalive });
    if (typeof r?.version === 'number') meta.versions[name] = r.version;
    meta.lastPushAt[name] = Date.now();
    unpulled.delete(name);
    saveMeta();
    backend = 'ok'; lastError = null; failures = 0;
    notify();
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && !force) { await onConflict(name, p, e); return; }
    if (isAuthError(e)) { authLost(); notify(); return; }   // 로그인 필요 — 다시 보내 봐야 같다, 서버는 살아 있다
    if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
      // 400·404·413: 다시 보내도 같다 — 버리고 이유만 남긴다
      lastError = `${name}: ${e.status} ${e.error}`;
      notify();
      return;
    }
    // 네트워크·제한 시간·5xx·재발급 실패: 백오프 뒤 재시도. 그 사이 새 저장이 오면 그것이 대신한다
    lastError = `${name}: ${errorText(e)}`;
    // keepalive 실패는 페이지가 닫히는 중의 제약(본문 상한·끊긴 탭)일 수 있어 서버 생사로 보지 않는다 — 회색 점이 탭을 바꿀 때마다 깜박이지 않게
    if (e instanceof ApiError && (e.status === 0 || e.status >= 500) && !keepalive) backend = 'down';
    if (!pending.has(name)) failed.set(name, { ...p, timer: null });
    scheduleRetry();
    notify();
  }
}

/**
 * 409: 서버본이 내 마지막 로컬 저장보다 나중이면 서버본 채택(localStorage에 쓰고 새로 뜬다), 아니면 force로 덮어쓴다.
 * 부트스트랩이 더 새것임을 알고도 못 받은 문서(`unpulled`)는 내 저장이 나중이어도 서버본이다 — 그 저장은 낡은 본문 위에 얹은 것이다.
 */
async function onConflict(name: DocName, p: Entry, e: ApiError) {
  const srv = (e.body ?? null) as { version?: unknown; clientTs?: unknown; body?: unknown } | null;
  const mine = lastLocalSaveAt[name] ?? p.savedAt;
  if (srv && typeof srv.clientTs === 'number' && typeof srv.version === 'number' && srv.body !== undefined
    && (srv.clientTs > mine || (unpulled.has(name) && srv.version > (meta.versions[name] ?? 0)))) {
    adopting = true;
    for (const [, q] of pending) if (q.timer) clearTimeout(q.timer);
    pending.clear(); failed.clear();
    writeLocal(DOC_KEYS[name], srv.body);
    meta.versions[name] = srv.version;
    saveMeta();
    backend = 'ok'; lastError = null;
    notify();
    reload();
    return;
  }
  await put(name, p, false, true);
}

function scheduleRetry() {
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures, 6));
  failures++;
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; retryNow(); }, delay);
  unref(retryTimer);
}
/** 밀린 문서를 지금 다시 올린다 (백오프 타이머·health 회복이 부른다). */
function retryNow() {
  for (const [name, entry] of failed) if (!pending.has(name)) pending.set(name, entry);
  failed.clear();
  for (const name of [...pending.keys()]) void flush(name);
}

function cancelAll() {
  for (const [, p] of pending) if (p.timer) clearTimeout(p.timer);
  pending.clear(); failed.clear();
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  failures = 0;
}

/** 페이지가 닫히거나 숨을 때 대기 중인 것을 바로 보낸다 (keepalive — 본문 64 KB 상한은 브라우저 제약). */
function installFlushHooks() {
  if (hooksInstalled || typeof document === 'undefined' || typeof addEventListener !== 'function') return;
  hooksInstalled = true;
  const onHide = () => { if (pending.size) void flushAll(true); };
  addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });
}

// ─── 상태 ──────────────────────────────────────────────────────────────────────

/** `GET /api/health`로 backend 상태를 갱신한다 (스토어의 tick이 30초마다). 살아났으면 밀린 문서를 올린다. */
export async function checkHealth(): Promise<BackendStatus> {
  if (!armed) return backend;
  const ok = await health();
  const was = backend;
  backend = ok ? 'ok' : 'down';
  if (ok && was !== 'ok' && failed.size) retryNow();
  if (was !== backend) notify();
  return backend;
}

// ─── 진짜 사람 에이전트 (BACKEND-CONTRACT §2.3·§3.4) ─────────────────────────
// 부트스트랩이 안 돌았으면(하네스·저장소 없음) 전부 no-op/null. 실패는 삼키고 `lastError`에만 남긴다 — NPC 풀이 그 자리를 채운다.

/** bootstrapSync가 돌았나 — 스토어가 발행·조회 타이머를 걸지 말지 정할 때 본다 */
export const syncArmed = (): boolean => armed;
const REMOTE_TIMEOUT_MS = 10_000;
const SCHEDULE_TIMEOUT_MS = 15_000;

/** remote 요청이 실패했다: 이유를 남기고, 서버가 안 닿으면 backend down (401·사용자 없음은 down이 아니라 로그인 필요). media.ts의 업로드도 같은 문을 쓴다 */
export const remoteFailed = (what: string, e: unknown) => {
  if (isAuthError(e)) { authLost(); notify(); return; }
  lastError = `${what}: ${errorText(e)}`;
  if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) backend = 'down';
  notify();
};
/** remote 요청이 됐다: 서버가 살아 있고, 남겨 둔 이유는 지운다 */
export const remoteOk = () => { if (backend !== 'ok' || lastError !== null) { backend = 'ok'; lastError = null; notify(); } };

/**
 * `PUT /api/me/agent`의 본문 — 내 프로필. 서버가 home을 `home:<userId>`·friend_home·ownerFriendId로 강제한다.
 * gender·visibility·repShotId(CONTRACT §2.5 개정)는 **키를 빼면 이전 값을 지킨다** — 메모리에 있을 때만 싣는다 (null로만 지운다; 지우기는 아직 안 쓴다)
 */
export interface AgentPut {
  name: string; color: string; emoji: string; hairStyle?: string; likes: string[]; traits: string[]; home: Place;
  gender?: Gender; visibility?: Visibility; repShotId?: string;
}

/** 내 프로필을 올린다 (부팅·updateMemory 뒤). 돌아온 RemoteAgent, 실패면 null. */
export async function publishAgent(body: AgentPut): Promise<RemoteAgent | null> {
  if (!armed || !userId) return null;
  try {
    const r = await api<unknown>('/api/me/agent', { method: 'PUT', body, timeoutMs: REMOTE_TIMEOUT_MS });
    remoteOk();
    return validRemoteAgent(r);
  } catch (e) {
    remoteFailed('agent', e);
    return null;
  }
}

/** 내 확정 일정을 `[from, to)` 창째로 올린다 (`PUT /api/me/schedule` — 서버가 창을 교체한다). 받아 줬으면 true. */
export async function publishSchedule(from: number, to: number, activities: PublishedActivity[]): Promise<boolean> {
  if (!armed || !userId) return false;
  try {
    await api<{ count?: number }>('/api/me/schedule', { method: 'PUT', body: { from, to, activities }, timeoutMs: SCHEDULE_TIMEOUT_MS });
    remoteOk();
    return true;
  } catch (e) {
    remoteFailed('schedule', e);
    return false;
  }
}

export interface RemoteRequest {
  /** 아직 슬롯이 없는 내 활동들 (≤ 16) — 비면 묻지 않는다 */
  slots: SlotReq[];
  /** 친구 목록을 받을지 (`GET /api/friends?at=`) — 그때의 시각 */
  friendsAt: number | null;
  /** 하루를 받을 친구들과 창 (친구 목록에서 새로 안 사람도 합친다) */
  days: { ids: string[]; from: number; to: number } | null;
}

/** 서버 응답의 hit `{ agent, overlapMs, activity }` → 캐시 hit + 프로필 */
const parseHit = (raw: unknown, agents: Record<string, RemoteAgent>): RemoteHit | null => {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as { agent?: unknown; overlapMs?: unknown; activity?: unknown };
  const agent = validRemoteAgent(h.agent);
  if (!agent || typeof h.overlapMs !== 'number' || !Number.isFinite(h.overlapMs)) return null;
  const activity = validPublished(h.activity, agent.id);
  if (!activity) return null;
  agents[agent.id] = agent;
  return { agentId: agent.id, overlapMs: h.overlapMs, activity };
};

/**
 * 진짜 사람들을 묻는다 (§3.4 c): 슬롯 겹침(`POST /api/agents/at`), 친구 목록(`GET /api/friends`), 친구의 하루
 * (`GET /api/friends/{id}/day`). 요청 하나가 실패해도 나머지는 살린다. 물을 게 없거나 전부 실패하면 null.
 */
export async function refreshRemote(req: RemoteRequest): Promise<RemoteFetch | null> {
  if (!armed || !userId) return null;
  const out: RemoteFetch = { agents: {}, slots: {}, friends: null, days: {} };
  let any = false, failed = false;
  if (req.slots.length) {
    try {
      const r = await api<{ hits?: Record<string, unknown[]> }>('/api/agents/at', { method: 'POST', body: { slots: req.slots.slice(0, 16) }, timeoutMs: REMOTE_TIMEOUT_MS });
      // 서버가 agent.id 오름차순으로 준다 (§2.3) — 그래도 한 번 더 정렬해 결정성을 여기서 보장한다
      for (const s of req.slots) {
        const hits = Array.isArray(r?.hits?.[s.key]) ? r.hits![s.key].map(h => parseHit(h, out.agents)).filter((h): h is RemoteHit => !!h) : [];
        out.slots[s.key] = hits.sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0)).slice(0, 8);
      }
      any = true;
    } catch (e) { failed = true; remoteFailed('agents/at', e); }
  }
  const dayIds = new Set(req.days?.ids ?? []);
  if (req.friendsAt !== null) {
    try {
      const r = await api<{ friends?: unknown[] }>(`/api/friends?at=${Math.round(req.friendsAt)}`, { timeoutMs: REMOTE_TIMEOUT_MS });
      out.friends = [];
      for (const raw of Array.isArray(r?.friends) ? r.friends : []) {
        const f = raw as { agent?: unknown; metAt?: unknown; metPlaceId?: unknown; now?: unknown };
        const agent = validRemoteAgent(f?.agent);
        if (!agent) continue;
        out.agents[agent.id] = agent;
        dayIds.add(agent.id);
        out.friends.push({
          agent,
          metAt: typeof f.metAt === 'number' && Number.isFinite(f.metAt) ? f.metAt : null,
          metPlaceId: typeof f.metPlaceId === 'string' && f.metPlaceId ? f.metPlaceId : null,
          now: f.now ? validPublished(f.now, agent.id) : null,
        });
      }
      any = true;
    } catch (e) { failed = true; remoteFailed('friends', e); }
  }
  if (req.days && dayIds.size) {
    const { from, to } = req.days;
    await Promise.all([...dayIds].map(async id => {
      try {
        const r = await api<{ activities?: unknown[] }>(`/api/friends/${encodeURIComponent(id)}/day?from=${Math.round(from)}&to=${Math.round(to)}`, { timeoutMs: REMOTE_TIMEOUT_MS });
        out.days[id] = (Array.isArray(r?.activities) ? r.activities : []).map(x => validPublished(x, id)).filter((p): p is PublishedActivity => !!p);
        any = true;
      } catch (e) {
        // 403(더는 친구가 아니다)·404는 조용히 — 그 친구의 하루만 비운다
        if (!(e instanceof ApiError && (e.status === 403 || e.status === 404))) { failed = true; remoteFailed('friends/day', e); }
      }
    }));
  }
  if (any && !failed) remoteOk();
  return any ? out : null;
}

/**
 * 말을 튼 마주침이 진짜 사람이면 관계를 서버에도 적는다 (`POST /api/friends`, 대칭·멱등). 불 붙이고 잊는다 —
 * settle()은 순수하고 앨범이 굳는 순간이라 기다리지 않는다.
 */
export function addFriendRemote(otherId: string, metAt: number, metPlaceId: string): void {
  if (!armed || !userId) return;
  void api<{ ok?: boolean }>('/api/friends', { method: 'POST', body: { otherId, metAt, metPlaceId }, timeoutMs: REMOTE_TIMEOUT_MS })
    .then(() => remoteOk(), e => remoteFailed('friends', e));
}

/**
 * 다른 아이디로 들어가기 (AUTH-ADDENDUM): 밀린 문서를 올리고(최대 3초) → 사용자 버림 → 이 기기의 저장본 비움 → 새로 뜨면 로그인 화면.
 * 친구 목록의 로그아웃 버튼과 개발 패널의 "바꾸기"가 같이 쓴다.
 */
export async function switchUser(): Promise<void> {
  await Promise.race([flushAll(), new Promise(r => setTimeout(r, 3_000))]);
  logout();
  clearLocalDocs();
  try { location.reload(); } catch { /* 하네스 */ }
}
