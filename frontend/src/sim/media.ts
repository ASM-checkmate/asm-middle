// ─── 폰의 사진 저장소 + 업로드 큐 (ADR-0020 결정 5 · CONTRACT §2.5) ─────────────────────────────────
// 컷은 찍는 순간 픽셀로 굳고(photo/bake.tsx) 문서(world의 shots·book의 panels)는 id만 가리킨다. 픽셀은 여기 — IndexedDB
// `theworld-media`/`blobs`(id → { blob, mime, bytes, kind, at, uploaded })에 두고, 아직 안 올린 id는 localStorage
// `theworld.media-queue.v1`에 줄 세워 서버(`PUT /api/media/{id}?kind=`)에 하나씩 올린다. 받은 남의 사진도 같은 곳에
// (uploaded: true) — 상한 150 MB를 넘으면 **올라간 것만** 오래된 순으로 지운다(서버에서 다시 받는다).
// `GET /api/media/{id}`는 헤더 인증이라 <img src>로 못 받는다 — fetch해서 blob URL로 그린다(objectUrlFor).
//
// 브라우저 API(indexedDB·URL.createObjectURL)는 전부 가드 — node 하네스에서는 메모리 Map으로 같은 API가 돈다.
// sync.ts와 서로 읽는다(순환): 이쪽은 syncArmed·syncSnapshot·subscribeSync·remoteOk/remoteFailed를 **부를 때만** 쓰고,
// 저쪽은 clearLocalDocs에서 clearMedia()를 부른다 — 모듈 평가 때는 서로를 안 건드린다(clearMedia는 function 선언이라 순환에서도 산다).
//
// **dev 시계 예외.** world/book(sync.ts)·발행(store.ts remoteOn)은 dev가 시간을 돌리는 중이면 서버에 안 올린다 — 그 하루를
// 다른 기기에 옮기면 안 되니까. 사진은 다르다: id가 폰에서 정해진 고유값이고 PUT이 멱등이며, 픽셀은 "그때의 모습"일 뿐 세계의
// 시각을 옮기지 않는다. 그래서 isRealClock에는 걸지 않는다 (CONTRACT §2.5 PUT /api/media 참고). 글(posts)도 같다.
import { API_BASE, ApiError, currentUser, hasNet, logout } from './api';
import { remoteFailed, remoteOk, subscribeSync, syncArmed, syncSnapshot } from './sync';
import { isShotId } from '../photo/geometry';

export type MediaKind = 'shot' | 'sketch' | 'npc';
/** 아직 안 올린 id들 (JSON string[]). 사용자가 바뀌면 sync.clearLocalDocs가 지운다 — sync.ts LOCAL_KEYS와 같아야 한다 */
export const MEDIA_QUEUE_KEY = 'theworld.media-queue.v1';
/** 폰 캐시 상한 (ADR-0020 결정 5: 100~200 MB) */
export const MEDIA_CACHE_MAX_BYTES = 150 * 1024 * 1024;
let cacheMax = MEDIA_CACHE_MAX_BYTES;
/** 하네스용: 상한을 낮춰 evict를 돌려 본다 (앱은 부르지 않는다) */
export const setMediaCacheMax = (bytes: number) => { cacheMax = bytes; };
const DB_NAME = 'theworld-media';
const DB_VERSION = 1;
const STORE = 'blobs';
const PUT_TIMEOUT_MS = 15_000;
const GET_TIMEOUT_MS = 10_000;
/** 네트워크 실패·5xx 뒤 재시도 간격: 2s → 4s → … ≤ 60s (sync.ts와 같다) */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** 저장 항목 — IDB에 이 모양 그대로 */
interface Rec { id: string; blob: Blob; mime: string; bytes: number; kind: MediaKind; at: number; uploaded: boolean }
type Meta = Omit<Rec, 'blob'>;

/** 메모리 색인 id → 메타. isUploaded·LRU가 동기적으로 본다. IDB가 있으면 첫 호출 때 한 번 채운다 (`at`은 여기서만 갱신 — LRU는 근사) */
const index = new Map<string, Meta>();
/**
 * 서버에 있는 걸 아는 id들 — 올린 것과 서버에서 받은 것. evict가 색인에서 지워도 여기엔 남는다(서버가 가진 컷은 글에 실을 수 있다,
 * `cut not yours`가 아니다). clearMedia만 비운다. 이 탭이 사는 동안만 — 다시 뜨면 IDB 색인(uploaded)에서 다시 채운다
 */
const uploadedIds = new Set<string>();
/** IDB가 없거나(node) 못 쓰는(프라이빗 모드·용량·막힌 웹뷰) 환경의 blob 자리 — 이 탭이 사는 동안만 */
const memBlobs = new Map<string, Blob>();
/** id → blob URL. 지울 때 revoke */
const urls = new Map<string, string>();

const unref = (t: ReturnType<typeof setTimeout>) => { (t as { unref?: () => void }).unref?.(); };
const metaOf = (r: Rec): Meta => ({ id: r.id, mime: r.mime, bytes: r.bytes, kind: r.kind, at: r.at, uploaded: r.uploaded });
const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;

// ─── IndexedDB (없으면 전부 null/no-op) ───────────────────────────────────────────
const hasIdb = () => typeof indexedDB !== 'undefined';
let dbP: Promise<IDBDatabase | null> | null = null;
const openDb = (): Promise<IDBDatabase | null> => {
  if (!hasIdb()) return Promise.resolve(null);
  if (dbP) return dbP;
  dbP = new Promise(res => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
      req.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbP;
};
const wait = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode: IDBTransactionMode): Promise<IDBObjectStore | null> => {
  const db = await openDb();
  if (!db) return null;
  try { return db.transaction(STORE, mode).objectStore(STORE); } catch { return null; }
};
const idbGet = async (id: string): Promise<Rec | null> => { try { const s = await tx('readonly'); return s ? ((await wait(s.get(id))) as Rec | undefined) ?? null : null; } catch { return null; } };
/** 썼으면 true — false(열기 실패·용량·프라이빗 모드)면 writeRec이 메모리에 둔다 */
const idbPut = async (rec: Rec): Promise<boolean> => { try { const s = await tx('readwrite'); if (!s) return false; await wait(s.put(rec)); return true; } catch { return false; } };
const idbDel = async (id: string): Promise<void> => { try { const s = await tx('readwrite'); if (s) await wait(s.delete(id)); } catch { /* ignore */ } };
const idbAll = async (): Promise<Rec[]> => { try { const s = await tx('readonly'); return s ? ((await wait(s.getAll())) as Rec[]) : []; } catch { return []; } };
const idbClear = async (): Promise<void> => { try { const s = await tx('readwrite'); if (s) await wait(s.clear()); } catch { /* ignore */ } };

/** 첫 호출 때 IDB의 색인을 메모리에 올린다 (한 번) */
let ready: Promise<void> | null = null;
let indexed = false;
const ensureReady = (): Promise<void> => {
  if (!ready) ready = (async () => { for (const r of await idbAll()) if (r && isShotId(r.id)) { index.set(r.id, metaOf(r)); if (r.uploaded) uploadedIds.add(r.id); } indexed = true; })();
  return ready;
};
/** 색인이 메모리에 올라왔나 — 그 전엔(부팅 직후) isUploaded가 전부 false다. 올라간 컷을 모른다고 오늘 글을 접지 않게 스토어가 본다 */
export const mediaReady = (): boolean => indexed;

// ─── 저장·읽기 ────────────────────────────────────────────────────────────────────
const writeRec = async (rec: Rec) => {
  index.set(rec.id, metaOf(rec));
  if (rec.uploaded) uploadedIds.add(rec.id);
  // IDB에 못 쓰면 메모리에 — 조용히 잃으면 문서엔 id가 남는데 픽셀이 없어 영영 옛 경로로 그리게 된다
  if (hasIdb() && (await idbPut(rec))) memBlobs.delete(rec.id); else memBlobs.set(rec.id, rec.blob);
};
const readRec = async (id: string): Promise<Rec | null> => {
  const m = index.get(id);
  if (!m) return null;
  const mem = memBlobs.get(id);
  if (mem) return { ...m, blob: mem };
  const r = hasIdb() ? await idbGet(id) : null;
  if (!r) { index.delete(id); return null; }   // 색인과 어긋남(다른 탭이 지움) — 색인을 맞춘다
  return { ...r, ...m };   // at·uploaded는 메모리 쪽이 최신
};
const removeRec = async (id: string) => {
  index.delete(id);
  memBlobs.delete(id);
  const u = urls.get(id);
  if (u) { urls.delete(id); try { URL.revokeObjectURL(u); } catch { /* ignore */ } }
  if (hasIdb()) await idbDel(id);
};
/** 상한을 넘으면 올라간 것만 오래된 순으로 지운다 — 아직 안 올린 사진은 절대 안 지운다 (서버에 없으니 되찾을 길이 없다) */
const evict = async () => {
  let total = 0;
  for (const m of index.values()) total += m.bytes;
  if (total <= cacheMax) return;
  const victims = [...index.values()].filter(m => m.uploaded).sort((a, b) => a.at - b.at);
  for (const m of victims) { if (total <= cacheMax) break; await removeRec(m.id); total -= m.bytes; }
};

/**
 * 방금 구운 사진을 넣고 업로드 줄에 세운다. `kind`는 서버의 `?kind=`(shot·sketch·npc). 이미 올라간 id를 다시 넣어도 올라간 상태는 지킨다.
 * 넣자마자 (될 때) 올리기를 시작한다 — 기다리지 않는다. 넣고 바로 못 읽으면 던진다 — 부른 쪽(카메라·ComicScreen)이 id를 떼게.
 */
export async function putLocal(id: string, blob: Blob, kind: MediaKind): Promise<void> {
  if (!isShotId(id)) throw new Error(`media: bad id ${id}`);
  await ensureReady();
  const uploaded = index.get(id)?.uploaded === true;
  await writeRec({ id, blob, mime: blob.type || 'application/octet-stream', bytes: blob.size, kind, at: Date.now(), uploaded });
  if (!(await readRec(id))) throw new Error(`media: 저장 실패 ${id}`);
  if (!uploaded) enqueue(id);
  await evict();
  void flushUploads();
}
/** 이 폰에 있나 (올렸든 안 올렸든) */
export async function hasLocal(id: string): Promise<boolean> { await ensureReady(); return index.has(id); }
/** 서버가 가진 걸 아나 — 올렸거나 서버에서 받은 id (evict로 픽셀이 지워졌어도). 글에 실을 수 있는 컷은 이것뿐이다 (서버가 `cut not yours`로 막는다) */
export const isUploaded = (id: string): boolean => uploadedIds.has(id) || index.get(id)?.uploaded === true;

/**
 * 픽셀: 폰에 있으면 그것, 없으면 `GET /api/media/{id}`(X-User-Id)로 받아 uploaded:true로 캐시한다. 못 받으면 null
 * (권한 없음·404·오프라인·사용자 없음·서버 down).
 */
export async function getBlob(id: string): Promise<Blob | null> {
  if (!isShotId(id)) return null;
  await ensureReady();
  const local = await readRec(id);
  if (local) { local.at = Date.now(); index.set(id, metaOf(local)); return local.blob; }
  if (!hasNet() || syncSnapshot().backend === 'down') return null;
  const u = currentUser();
  if (!u) return null;
  try {
    const res = await fetch(`${API_BASE}/api/media/${id}`, { headers: { 'x-user-id': u.userId }, signal: timeoutSignal(GET_TIMEOUT_MS) });
    if (!res.ok) return null;
    const blob = await res.blob();
    await writeRec({ id, blob, mime: res.headers?.get?.('content-type') || blob.type || 'application/octet-stream', bytes: blob.size, kind: 'shot', at: Date.now(), uploaded: true });
    await evict();
    // 서버에서 받은 것도 "서버가 가진 컷"이다 — 듣는 쪽(글쓰기 화면의 '업로드 중…')이 걷히게 알린다
    for (const fn of uploadedListeners) { try { fn(id); } catch { /* 듣는 쪽의 오류는 받기를 막지 않는다 */ } }
    return blob;
  } catch { return null; }
}
/** 그릴 수 있는 URL (blob:). 한 id에 하나만 만들고 지울 때 revoke한다. 못 받으면 null */
export async function objectUrlFor(id: string): Promise<string | null> {
  const have = urls.get(id);
  if (have) return have;
  const blob = await getBlob(id);
  if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const again = urls.get(id);   // 기다리는 사이 다른 호출이 먼저 만들었으면 그것
  if (again) return again;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

// ─── 업로드 큐 ────────────────────────────────────────────────────────────────────
const readQueue = (): string[] => {
  try {
    const raw = localStorage.getItem(MEDIA_QUEUE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter(isShotId) : [];
  } catch { return []; }
};
const writeQueue = (q: string[]) => { try { if (q.length) localStorage.setItem(MEDIA_QUEUE_KEY, JSON.stringify(q)); else localStorage.removeItem(MEDIA_QUEUE_KEY); } catch { /* ignore */ } };
const enqueue = (id: string) => { const q = readQueue(); if (!q.includes(id)) writeQueue([...q, id]); };
const dequeue = (id: string) => writeQueue(readQueue().filter(x => x !== id));
/** 아직 안 올린 id들 (하네스·DevPanel) */
export const mediaQueue = (): string[] => readQueue();

/** 진행 중인 올리기 한 바퀴 — 겹쳐 부르면 이걸 돌려준다(기다릴 수 있게) */
let flushing: Promise<void> | null = null;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** 지금 올려도 되나: 부트스트랩이 돌았고(사용자 있음) 서버가 죽어 있지 않다. dev 시계는 보지 않는다 (위 주석) */
const canUpload = () => hasNet() && syncArmed() && !!currentUser() && syncSnapshot().backend !== 'down';
const scheduleRetry = () => {
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures, 6));
  failures++;
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; void flushUploads(); }, delay);
  unref(retryTimer);
};
/** 재시도가 걸려 있나 (하네스) */
export const mediaRetryPending = (): boolean => retryTimer !== null;
/** 서버가 받아 준 id를 듣는다 — 스토어가 대표 사진(repShotId)이 올라가면 프로필을 다시 보내려고. 돌려주는 함수로 끊는다 */
const uploadedListeners = new Set<(id: string) => void>();
export const subscribeUploaded = (fn: (id: string) => void): (() => void) => { uploadedListeners.add(fn); return () => { uploadedListeners.delete(fn); }; };

/** 한 장: 'ok'(받아 줌) · 'drop'(다시 보내도 같다 — 400·403·413) · 'retry'(네트워크·5xx·401) */
async function upload(rec: Rec): Promise<'ok' | 'drop' | 'retry'> {
  const u = currentUser();
  if (!u) return 'retry';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/media/${rec.id}?kind=${rec.kind}`, {
      method: 'PUT', headers: { 'x-user-id': u.userId, 'content-type': rec.mime }, body: rec.blob, signal: timeoutSignal(PUT_TIMEOUT_MS),
    });
  } catch (e) {
    remoteFailed('media', new ApiError(0, e instanceof Error ? (e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : e.message || 'network') : 'network'));
    return 'retry';
  }
  if (res.ok) return 'ok';
  let body: unknown = null;
  try { body = await res.json(); } catch { /* 본문 없음 */ }
  const error = body && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `http ${res.status}`;
  const e = new ApiError(res.status, error, body);
  if (res.status === 401) { logout(); remoteFailed('media', e); return 'retry'; }   // 서버가 이 아이디를 모른다 — 로그인 필요 (api.ts와 같다)
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    // 400(모양)·403(남의 id)·413(너무 큼): 다시 보내도 같다 — 줄에서 빼고 blob은 둔다 (책은 그대로 보인다)
    console.warn(`media: ${rec.id} 안 올림 — ${res.status} ${error}`);
    remoteFailed('media', e);
    return 'drop';
  }
  remoteFailed('media', e);
  return 'retry';
}

/**
 * 줄 선 사진을 순서대로 올린다 (한 번에 한 바퀴 — 겹쳐 부르면 진행 중인 바퀴를 돌려준다). 사용자·서버 조건이 안 맞으면 조용히 끝.
 * 네트워크·5xx면 거기서 멈추고 백오프 뒤 다시 (health가 살아나도 다시). 한 바퀴 도는 사이에 줄에 선 id(연속 촬영·ComicScreen의
 * 컷 네 장)는 그 바퀴가 끝나고 바로 다음 바퀴에 — 안 그러면 다른 계기가 올 때까지 줄에 남는다.
 */
export function flushUploads(): Promise<void> {
  if (flushing) return flushing;
  if (!canUpload() || !readQueue().length) return Promise.resolve();
  flushing = (async () => {
    try {
      await ensureReady();
      // 한 바퀴는 그때의 줄을 다 처리한다(올림·뺌) — 멈춘(retry) 경우가 아니면 줄에 남은 건 도는 사이 새로 선 것뿐이다
      let stopped = false;
      while (!stopped && canUpload() && readQueue().length) {
        for (const id of readQueue()) {
          if (!canUpload()) { stopped = true; break; }
          const rec = await readRec(id);
          if (!rec) { dequeue(id); continue; }   // blob이 사라졌다(캐시 비움) — 올릴 게 없다
          if (rec.uploaded) { dequeue(id); continue; }
          const r = await upload(rec);
          if (r === 'retry') { scheduleRetry(); stopped = true; break; }
          dequeue(id);
          if (r === 'ok') {
            rec.uploaded = true;
            await writeRec(rec);
            failures = 0;
            remoteOk();
            for (const fn of uploadedListeners) { try { fn(id); } catch { /* 듣는 쪽의 오류는 줄을 멈추지 않는다 */ } }
          }
        }
      }
    } finally { flushing = null; }
  })();
  return flushing;
}

let started = false;
/**
 * 스토어가 뜰 때 한 번: 색인을 올리고 밀린 사진을 올리고, 서버가 살아날 때(backend → ok)마다 다시 올린다.
 * 부트스트랩이 안 돌았으면(하네스·오프라인) flush가 알아서 아무것도 안 한다.
 */
export function startMediaQueue(): void {
  if (started) return;
  started = true;
  let was = syncSnapshot().backend;
  subscribeSync(s => { const now = s.backend; if (now === 'ok' && was !== 'ok' && readQueue().length) void flushUploads(); was = now; });
  void ensureReady().then(() => flushUploads());
}

/** 전부 비운다 — 사용자가 바뀔 때 sync.clearLocalDocs가 부른다. 대기 중인 재시도도 버린다 */
export async function clearMedia(): Promise<void> {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  failures = 0;
  for (const u of urls.values()) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } }
  urls.clear();
  index.clear();
  uploadedIds.clear();
  memBlobs.clear();
  try { localStorage.removeItem(MEDIA_QUEUE_KEY); } catch { /* ignore */ }
  ready = Promise.resolve(); indexed = true;   // 비운 뒤엔 IDB를 다시 읽을 게 없다
  if (hasIdb()) await idbClear();
}
