// 사진 저장소·업로드 큐 harness (ADR-0020 결정 5, CONTRACT §2.5, sim/media.ts) — IndexedDB 없는 node에서 메모리 폴백으로:
// 넣기/읽기/올라감 표시, 큐가 localStorage `theworld.media-queue.v1`에 남는지, PUT /api/media/{id}?kind= 의 헤더·본문, 403은 줄에서
// 빼고 500은 백오프, 부트스트랩 전엔 안 올리고, 서버에서 받은 사진은 uploaded로 캐시, 한 바퀴 도는 사이에 줄에 선 사진도 올라가는지,
// 상한은 올라간 것만 오래된 순으로 지우는지(blob URL revoke), IDB를 못 열면 메모리 폴백, clearMedia/clearLocalDocs가 전부 비우는지, 401은 로그아웃.
// Usage: node scripts/sim-media.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));
globalThis.location = { reload: () => {} };

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => 'application/json' } });
const warns = [];
const origWarn = console.warn;
console.warn = (...a) => { warns.push(a.join(' ')); };

// ── 가짜 서버: 부트스트랩(문서 없음)·health·미디어 PUT/GET ──────────────────────────────────
const server = { log: [], mediaStatus: 201, offline: false, media: {}, putDelay: 0 };
const bytesOf = async body => new Uint8Array(await body.arrayBuffer());
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  if (server.offline) throw new TypeError('fetch failed');
  const entry = { method, url, headers: init.headers ?? {}, body: init.body instanceof Blob ? await bytesOf(init.body) : init.body };
  server.log.push(entry);
  if (url.endsWith('/api/health')) return json(200, { ok: true });
  if (url.endsWith('/api/me/docs')) return json(200, { docs: {} });
  const m = url.match(/\/api\/media\/([0-9a-f]{32})(?:\?kind=(\w+))?$/);
  if (m && method === 'PUT') {
    if (server.putDelay) await sleep(server.putDelay);   // 느린 서버 — 한 바퀴 도는 사이에 줄에 서는 경우
    if (server.mediaStatus === 201) { server.media[m[1]] = entry.body; return json(201, { id: m[1], ownerId: init.headers['x-user-id'], kind: m[2], mime: init.headers['content-type'], bytes: entry.body.length, createdAt: Date.now() }); }
    return json(server.mediaStatus, { error: server.mediaStatus === 403 ? 'not yours' : server.mediaStatus === 401 ? 'unknown user' : 'boom' });
  }
  if (m && method === 'GET') {
    const b = server.media[m[1]];
    if (!b) return json(404, { error: 'not found' });
    return { ok: true, status: 200, blob: async () => new Blob([b], { type: 'image/webp' }), headers: { get: h => (h === 'content-type' ? 'image/webp' : null) }, json: async () => null };
  }
  return json(404, { error: 'not found' });
};
const puts = () => server.log.filter(l => l.method === 'PUT' && l.url.includes('/api/media/'));
const queue = () => JSON.parse(storage.get('theworld.media-queue.v1') ?? '[]');

freezeClockAt(Date.UTC(2026, 8, 8, 0, 0));   // dev 시계(scale 0) — 사진은 그래도 올라간다 (media.ts 머리 주석)
// 이 기기는 이미 yoongwan의 것 — 부트스트랩이 "다른 아이디"로 보고 저장본(사진 포함)을 비우지 않게
storage.set('theworld.sync.v1', JSON.stringify({ userId: 'yoongwan', versions: {}, lastPushAt: {} }));
const M = await import('../src/sim/media.ts');
const { bootstrapSync, checkHealth, syncSnapshot, syncArmed, clearLocalDocs } = await import('../src/sim/sync.ts');
M.startMediaQueue();   // 스토어가 뜰 때 부르는 것 — 서버가 살아날 때 다시 올리는 구독

const ID1 = '0a'.repeat(16), ID2 = '1b'.repeat(16), ID3 = '2c'.repeat(16), ID4 = '3d'.repeat(16), ID5 = '4e'.repeat(16);
const webp = (seed, size = 64) => new Blob([Uint8Array.from({ length: size }, (_, i) => (i * 7 + seed) & 255)], { type: 'image/webp' });
const same = async (blob, ref) => { const a = new Uint8Array(await blob.arrayBuffer()), b = new Uint8Array(await ref.arrayBuffer()); return a.length === b.length && a.every((v, i) => v === b[i]); };

// ── 1) 부트스트랩 전: 폰에만 있고 줄만 선다 ──────────────────────────────────────────
console.log('\n── 로컬 ──');
check('모듈이 node에서 뜬다 (indexedDB 없음 → 메모리)', typeof indexedDB === 'undefined' && typeof M.putLocal === 'function', '');
check('상수: 큐 키·상한', M.MEDIA_QUEUE_KEY === 'theworld.media-queue.v1' && M.MEDIA_CACHE_MAX_BYTES === 150 * 1024 * 1024, '');
await M.putLocal(ID1, webp(1), 'shot');
check('putLocal → hasLocal', await M.hasLocal(ID1), '');
check('getBlob: 같은 바이트', await same(await M.getBlob(ID1), webp(1)), '');
check('아직 안 올라갔다', M.isUploaded(ID1) === false, '');
check('큐가 localStorage에 남는다', queue().join() === ID1, JSON.stringify(queue()));
await sleep(10);
check('부트스트랩 전(armed 아님)엔 올리지 않는다', !syncArmed() && puts().length === 0, String(puts().length));
await M.flushUploads();
check('flushUploads도 armed 아니면 아무것도 안 한다', puts().length === 0 && queue().join() === ID1, '');
const url1 = await M.objectUrlFor(ID1);
check('objectUrlFor: blob URL 하나, 다시 물으면 같은 것', typeof url1 === 'string' && url1.startsWith('blob:') && (await M.objectUrlFor(ID1)) === url1, String(url1));
check('모르는 id는 null', (await M.getBlob('9f'.repeat(16))) === null && (await M.objectUrlFor('9f'.repeat(16))) === null, '');
let threw = false; try { await M.putLocal('zz', webp(0), 'shot'); } catch { threw = true; }
check('모양이 틀린 id는 거절', threw, '');

// ── 2) 부트스트랩 뒤: PUT /api/media/{id}?kind=shot — 헤더·본문 ──────────────────────
console.log('\n── 업로드 ──');
storage.set('theworld.user.v1', JSON.stringify({ userId: 'yoongwan', name: '윤관' }));
await bootstrapSync();   // backend → ok 구독이 바로 올리기를 시작한다 — flushUploads는 그 바퀴를 돌려준다
check('armed · backend ok', syncArmed() && syncSnapshot().backend === 'ok', JSON.stringify(syncSnapshot()));
await M.flushUploads();
const p1 = puts()[0];
check('PUT 한 번', puts().length === 1 && p1.url.endsWith(`/api/media/${ID1}?kind=shot`), JSON.stringify(puts().map(p => p.url)));
check('헤더: x-user-id · content-type image/webp', p1?.headers['x-user-id'] === 'yoongwan' && p1?.headers['content-type'] === 'image/webp', JSON.stringify(p1?.headers));
check('본문은 blob 바이트 그대로', p1?.body instanceof Uint8Array && (await same(new Blob([p1.body]), webp(1))), '');
check('201 → 올라갔다 · 줄에서 빠진다', M.isUploaded(ID1) && queue().length === 0 && storage.get('theworld.media-queue.v1') === undefined, JSON.stringify(queue()));
check('올라간 뒤에도 로컬에 있다', await M.hasLocal(ID1), '');
await M.flushUploads();
check('줄이 비면 PUT 안 한다', puts().length === 1, '');

// ── 3) 403: 줄에서 빼고 blob은 둔다 (다시 보내도 같다) ────────────────────────────
console.log('\n── 403 ──');
server.mediaStatus = 403;
await M.putLocal(ID2, webp(2), 'shot');   // putLocal이 알아서 올리기를 시작한다
await sleep(20);
check('403 → 줄에서 빠진다', queue().length === 0 && puts().length === 2, JSON.stringify(queue()));
check('403 → blob은 남고 uploaded 아님 · console.warn', (await M.hasLocal(ID2)) && !M.isUploaded(ID2) && warns.some(w => w.includes(ID2) && w.includes('403')), warns.join('|'));
check('403은 down이 아니다', syncSnapshot().backend === 'ok', syncSnapshot().backend);

// ── 4) 500: 줄에 남고 백오프, 서버가 살아나면 다시 ────────────────────────────────
console.log('\n── 500 ──');
server.mediaStatus = 500;
await M.putLocal(ID3, webp(3, 128), 'shot');
await sleep(20);
check('500 → 줄에 남는다 · 재시도 예약 · backend down', queue().join() === ID3 && M.mediaRetryPending() && syncSnapshot().backend === 'down', JSON.stringify([queue(), M.mediaRetryPending(), syncSnapshot().backend]));
const before = puts().length;
await M.flushUploads();
check('down인 동안은 두드리지 않는다', puts().length === before, '');
server.mediaStatus = 201;
await checkHealth();   // 스토어 tick이 30초마다 부른다 — 살아나면 media가 구독으로 다시 올린다
await sleep(20);
check('health 회복 → 다시 올린다', M.isUploaded(ID3) && queue().length === 0 && syncSnapshot().backend === 'ok', JSON.stringify([M.isUploaded(ID3), queue()]));

// ── 5) 서버에서 받기: GET /api/media/{id} (X-User-Id) → uploaded로 캐시 ─────────────
console.log('\n── GET ──');
server.media[ID4] = new Uint8Array(await webp(4, 40).arrayBuffer());
check('받기 전엔 로컬에 없다', !(await M.hasLocal(ID4)), '');
const got = await M.getBlob(ID4);
const g = server.log.find(l => l.method === 'GET' && l.url.endsWith(`/api/media/${ID4}`));
check('GET에 x-user-id', !!g && g.headers['x-user-id'] === 'yoongwan', JSON.stringify(g));
check('바이트 그대로 · uploaded로 캐시', !!got && (await same(got, webp(4, 40))) && M.isUploaded(ID4) && (await M.hasLocal(ID4)), '');
const gets = server.log.filter(l => l.method === 'GET' && l.url.includes(ID4)).length;
await M.getBlob(ID4);
check('두 번째는 폰에서 (GET 안 함)', server.log.filter(l => l.method === 'GET' && l.url.includes(ID4)).length === gets, '');
check('서버에 없는 것은 null', (await M.getBlob(ID5)) === null, '');

// ── 6) 오프라인: 줄에 남는다 ────────────────────────────────────────────────────
console.log('\n── 오프라인 ──');
server.offline = true;
await M.putLocal(ID5, webp(5), 'shot');
await sleep(20);
check('네트워크 실패 → 줄에 남고 down', queue().join() === ID5 && syncSnapshot().backend === 'down', JSON.stringify(queue()));
server.offline = false;
await checkHealth();
await sleep(20);
check('돌아오면 올라간다', M.isUploaded(ID5) && queue().length === 0, JSON.stringify(queue()));

// ── 7) 겹침: 한 바퀴 도는 사이에 줄에 선 사진 (연속 촬영·ComicScreen 컷 네 장) — 다른 계기 없이 올라간다 ──────
console.log('\n── 겹침 ──');
const IDA = '5f'.repeat(16), IDB = '6a'.repeat(16), IDC = '7b'.repeat(16);
server.putDelay = 40;
const n7 = puts().length;
await M.putLocal(IDA, webp(6), 'shot');   // 바퀴 시작 (PUT 40 ms)
await sleep(10);
await M.putLocal(IDB, webp(7), 'shot');   // 도는 중 — putLocal의 flushUploads는 진행 중인 바퀴를 돌려줄 뿐이다
await M.putLocal(IDC, webp(8), 'shot');
check('도는 중엔 줄에 선다', queue().includes(IDB) && queue().includes(IDC) && !M.isUploaded(IDB), JSON.stringify(queue()));
await sleep(250);   // 4)·6)의 백오프 타이머(2 s)는 아직 한참 남았다 — 이 안에 올라갔으면 바퀴가 줄을 다시 본 것이다
server.putDelay = 0;
check('바퀴가 끝나면 그 사이 선 사진도 바로 올라간다', M.isUploaded(IDA) && M.isUploaded(IDB) && M.isUploaded(IDC) && queue().length === 0 && puts().length === n7 + 3, JSON.stringify([queue(), puts().length - n7, [IDA, IDB, IDC].map(M.isUploaded)]));
const n7b = puts().length;
await M.putLocal(IDA, webp(9), 'shot');   // 이미 올라간 id를 다시 넣는다 (같은 창 재촬영이 아니라 같은 id — 픽셀만 바꾼다)
await sleep(20);
check('이미 올라간 id를 다시 넣어도 올라간 상태를 지키고 다시 올리지 않는다', M.isUploaded(IDA) && queue().length === 0 && puts().length === n7b && (await same(await M.getBlob(IDA), webp(9))), JSON.stringify(queue()));

// ── 8) 상한: 올라간 것만 오래된 순으로, 안 올린 건 절대 안 지운다 · 지운 blob URL은 revoke ──────────────
console.log('\n── 상한 ──');
await M.clearMedia();
const revoked = [];
const origRevoke = URL.revokeObjectURL;
URL.revokeObjectURL = u => { revoked.push(u); origRevoke.call(URL, u); };
const E1 = '8c'.repeat(16), E2 = '9d'.repeat(16), E3 = 'a0'.repeat(16), E4 = 'b1'.repeat(16), E5 = 'c2'.repeat(16);
M.setMediaCacheMax(400);
await M.putLocal(E1, webp(11, 128), 'shot'); await sleep(20);   // 올라감, 가장 오래됨
const urlE1 = await M.objectUrlFor(E1);
await M.putLocal(E2, webp(12, 128), 'shot'); await sleep(20);   // 올라감
server.mediaStatus = 403;
await M.putLocal(E3, webp(13, 128), 'shot'); await sleep(20);   // 안 올라감 (403: 줄에서 빠지고 blob은 남는다)
server.mediaStatus = 201;
check('상한 안(384 B ≤ 400 B)이면 안 지운다', (await M.hasLocal(E1)) && (await M.hasLocal(E2)) && (await M.hasLocal(E3)) && M.isUploaded(E1) && M.isUploaded(E2) && !M.isUploaded(E3), '');
await M.putLocal(E4, webp(14, 128), 'shot'); await sleep(20);   // 512 B > 400 B → 올라간 것 중 가장 오래된 E1만 (→ 384 B)
check('넘으면 올라간 것 중 가장 오래된 것부터, 상한 아래로 내려오면 멈춘다', !(await M.hasLocal(E1)) && !M.isUploaded(E1) && (await M.hasLocal(E2)) && (await M.hasLocal(E3)) && (await M.hasLocal(E4)), JSON.stringify([E1, E2, E3, E4].map(M.isUploaded)));
check('지운 사진의 blob URL은 revoke된다', typeof urlE1 === 'string' && revoked.includes(urlE1), JSON.stringify(revoked));
M.setMediaCacheMax(100);
server.mediaStatus = 403;
await M.putLocal(E5, webp(15, 128), 'shot'); await sleep(20);   // 안 올라감 — 상한이 100 B라 올라간 E2·E4는 다 지워지지만 E3·E5는 남는다
server.mediaStatus = 201;
check('안 올린 사진은 상한을 넘어도 절대 안 지운다 (서버에 없다)', (await M.hasLocal(E3)) && (await M.hasLocal(E5)) && !(await M.hasLocal(E2)) && !(await M.hasLocal(E4)), JSON.stringify([E2, E3, E4, E5].map(id => M.isUploaded(id))));
const getsE1 = server.log.filter(l => l.method === 'GET' && l.url.endsWith(`/api/media/${E1}`)).length;
check('지운 사진은 서버에서 다시 받는다', (await same(await M.getBlob(E1), webp(11, 128))) && server.log.filter(l => l.method === 'GET' && l.url.endsWith(`/api/media/${E1}`)).length === getsE1 + 1, '');
M.setMediaCacheMax(M.MEDIA_CACHE_MAX_BYTES);
URL.revokeObjectURL = origRevoke;

// ── 9) IDB가 있는데 못 연다 (프라이빗 모드·용량·막힌 웹뷰): 메모리에 두고 올린다 — 조용히 잃지 않는다 ────────
console.log('\n── IDB 실패 ──');
globalThis.indexedDB = { open: () => { const req = {}; setTimeout(() => req.onerror?.(), 0); return req; } };
const F1 = 'd3'.repeat(16);
const n9 = puts().length;
let threwF = false; try { await M.putLocal(F1, webp(16), 'shot'); } catch { threwF = true; }
await sleep(20);
check('IDB open 실패 → putLocal은 던지지 않고 메모리에 둔다 · 올라간다', !threwF && (await M.hasLocal(F1)) && (await same(await M.getBlob(F1), webp(16))) && M.isUploaded(F1) && puts().length === n9 + 1 && queue().length === 0, JSON.stringify([threwF, queue(), puts().length - n9]));
delete globalThis.indexedDB;

// ── 10) 비우기 ────────────────────────────────────────────────────────────────
console.log('\n── 비우기 ──');
await M.clearMedia();
check('clearMedia: 로컬·큐·URL·올라감 표시 전부 없어진다', !(await M.hasLocal(ID1)) && !M.isUploaded(ID1) && !M.isUploaded(ID3) && !(await M.hasLocal(F1)) && queue().length === 0 && !M.mediaRetryPending(), '');
const gets3 = server.log.filter(l => l.method === 'GET' && l.url.endsWith(`/api/media/${ID3}`)).length;
const url3 = await M.objectUrlFor(ID3);
check('비운 뒤 objectUrlFor는 서버에서 다시 받는다 (GET 한 번)', typeof url3 === 'string' && url3.startsWith('blob:') && url3 !== url1 && server.log.filter(l => l.method === 'GET' && l.url.endsWith(`/api/media/${ID3}`)).length === gets3 + 1 && M.isUploaded(ID3), String(url3));
await M.putLocal(ID2, webp(2), 'shot');
await sleep(5);
clearLocalDocs();   // 사용자가 바뀔 때 — 사진도 그 아이디의 것
await sleep(5);
check('clearLocalDocs가 사진도 비운다', !(await M.hasLocal(ID2)) && queue().length === 0, '');

// ── 11) 401: 서버가 이 아이디를 모른다 — 로그아웃(사용자 키 삭제), down 아님, 사용자 없이는 다시 두드리지 않는다 (api.ts와 같다) ──
console.log('\n── 401 ──');
server.mediaStatus = 401;
const G1 = 'e4'.repeat(16);
const n11 = puts().length;
await M.putLocal(G1, webp(17), 'shot');
await sleep(20);
check('401 → 사용자 키가 지워지고 줄에는 남는다 · down은 아니다', storage.get('theworld.user.v1') === undefined && queue().join() === G1 && !M.isUploaded(G1) && syncSnapshot().backend !== 'down' && puts().length === n11 + 1, JSON.stringify([storage.get('theworld.user.v1'), queue(), syncSnapshot().backend, puts().length - n11]));
await M.flushUploads();
await sleep(20);
check('사용자 없이는 다시 두드리지 않는다', puts().length === n11 + 1, String(puts().length - n11));
server.mediaStatus = 201;

console.warn = origWarn;
console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
