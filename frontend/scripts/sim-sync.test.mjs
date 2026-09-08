// 문서 동기화 harness (BACKEND-CONTRACT §3.3, sim/sync.ts + sim/api.ts) — fetch·localStorage를 흉내 내어 부트스트랩 순서
// (places→memory→world→book), 디바운스 1회 PUT, 409 정책(서버본 채택 / force), scale≠1이면 world 미푸시, 오프라인이면 backend 'down'.
// Usage: node scripts/sim-sync.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};
let reloads = 0;
globalThis.location = { reload: () => { reloads++; } };

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// ── 가짜 서버 (AUTH-ADDENDUM 인증 — 고정 아이디 5개·X-User-Id, §2.2 문서) ──────────────────────────
const USERS = { yoongwan: '윤관', hojun: '호준', guest1: '손님1', guest2: '손님2', guest3: '손님3' };
const server = { docs: {}, offline: false, log: [], loginCalls: 0, known: new Set(Object.keys(USERS)) };
const resetServer = () => { server.docs = {}; server.offline = false; server.log = []; server.loginCalls = 0; };
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  if (server.offline) throw new TypeError('fetch failed');
  // 부트스트랩이 문서 하나를 받다 끊기는 상황 (데드라인·네트워크)
  if (server.failGetOnce && method === 'GET' && url.endsWith('/api/me/docs/' + server.failGetOnce)) { server.failGetOnce = null; throw new TypeError('fetch failed'); }
  server.log.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined, keepalive: !!init.keepalive, user: init.headers?.['x-user-id'] ?? null });
  if (url.endsWith('/api/users')) return json(200, { users: Object.entries(USERS).map(([id, name]) => ({ id, name })) });
  if (url.endsWith('/api/auth/login')) { server.loginCalls++; const id = JSON.parse(init.body).userId; return server.known.has(id) ? json(200, { userId: id, name: USERS[id] }) : json(404, { error: 'user not found' }); }
  if (url.endsWith('/api/health')) return json(200, { ok: true });
  const uid = init.headers?.['x-user-id'];
  if (!uid || !server.known.has(uid)) return json(401, { error: 'unauthorized' });
  const m = url.match(/\/api\/me\/docs(?:\/([a-z]+))?$/);
  if (!m) return json(404, { error: 'not found' });
  const name = m[1];
  if (!name) {
    const docs = {};
    for (const [k, d] of Object.entries(server.docs)) docs[k] = { version: d.version, updatedAt: d.updatedAt, clientTs: d.clientTs };
    return json(200, { docs });
  }
  if (method === 'GET') { const d = server.docs[name]; return d ? json(200, { name, ...d }) : json(404, { error: 'not found' }); }
  if (method === 'PUT') {
    const { baseVersion, clientTs, body, force } = init.body ? JSON.parse(init.body) : {};
    const cur = server.docs[name];
    if (!force) {
      if (!cur && baseVersion !== 0) return json(409, { error: 'conflict', name, version: 0, updatedAt: 0, clientTs: 0, body: null });
      if (cur && baseVersion !== cur.version) return json(409, { error: 'conflict', name, version: cur.version, updatedAt: cur.updatedAt, clientTs: cur.clientTs, body: cur.body });
    }
    const version = (cur?.version ?? 0) + 1;
    server.docs[name] = { version, updatedAt: Date.now(), clientTs, body };
    return json(200, { name, version, updatedAt: server.docs[name].updatedAt });
  }
  return json(405, { error: 'method' });
};
const puts = name => server.log.filter(l => l.method === 'PUT' && l.url.endsWith(`/api/me/docs/${name}`));
const meta = () => JSON.parse(storage.get('theworld.sync.v1') ?? 'null');

const { bootstrapSync, onLocalSave, flushAll, checkHealth, syncSnapshot, subscribeSync, syncArmed, clearLocalDocs, DOC_KEYS } = await import('../src/sim/sync.ts');
const { currentUser, login, logout, fetchUsers, health, ApiError } = await import('../src/sim/api.ts');

// ── 1) 부트스트랩: 서버가 더 새것인 문서를 places→memory→world→book 순서로 받는다 ──
console.log('\n── 부트스트랩 ──');
resetServer();
const T = Date.now();
const WORLD = { v: 5, days: {}, anchor: { placeId: 'home', t: T - 3600_000, tz: 'Asia/Seoul' }, journeys: {}, regen: {}, encounters: {}, requests: [], calls: [], messages: [], dueCalls: [], shots: [] };
server.docs = {
  places: { version: 2, updatedAt: T, clientTs: T - 5000, body: { v: 1, cities: {} } },
  memory: { version: 3, updatedAt: T, clientTs: T - 5000, body: { name: '토리', likes: [], dislikes: [], traits: [], homePlaceId: 'home', friends: [], visited: [] } },
  world: { version: 4, updatedAt: T, clientTs: T - 5000, body: WORLD },
  book: { version: 1, updatedAt: T, clientTs: T - 5000, body: [] },
};
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: T, anchorSim: T, scale: 1 }));
let notified = 0;
const off = subscribeSync(() => { notified++; });
// 로그인 화면(main.tsx): 아이디 목록 → 하나 고름 → login → 저장
check('GET /api/users → 고를 수 있는 아이디들 (id 순)', (await fetchUsers())?.map(u => `${u.userId}:${u.name}`).join() === 'yoongwan:윤관,hojun:호준,guest1:손님1,guest2:손님2,guest3:손님3', JSON.stringify(await fetchUsers()));
check('로그인 전엔 사용자 없음', currentUser() === null, JSON.stringify(currentUser()));
await login('yoongwan').catch(() => null);
check('login이 POST /api/auth/login으로 확인받아 theworld.user.v1에 저장한다', currentUser()?.userId === 'yoongwan' && currentUser().name === '윤관' && server.loginCalls === 1 && JSON.parse(storage.get('theworld.user.v1')).name === '윤관', JSON.stringify([currentUser(), server.loginCalls]));
check('모르는 아이디는 404 ApiError', await login('nobody').then(() => false, e => e instanceof ApiError && e.status === 404) && currentUser()?.userId === 'yoongwan', '');
const t0 = Date.now();
await bootstrapSync();
const bootMs = Date.now() - t0;
check('부트스트랩이 금방 끝난다', bootMs < 1000, `${bootMs}ms`);
const gets = server.log.filter(l => l.method === 'GET' && /\/api\/me\/docs\/[a-z]+$/.test(l.url)).map(l => l.url.split('/').pop());
check('문서를 places → memory → world → book 순서로 받는다', gets.join() === 'places,memory,world,book', gets.join());
check('목록을 먼저 묻고 X-User-Id를 붙인다', server.log.some(l => l.url.endsWith('/api/me/docs') && l.user === 'yoongwan'), JSON.stringify(server.log.map(l => [l.url, l.user])));
check('받은 문서가 localStorage 키에 들어간다', JSON.parse(storage.get(DOC_KEYS.memory)).name === '토리' && JSON.parse(storage.get(DOC_KEYS.world)).v === 5 && storage.get(DOC_KEYS.book) === '[]' && JSON.parse(storage.get(DOC_KEYS.places)).v === 1, '');
check('메타에 사용자와 버전이 적힌다', meta()?.userId === 'yoongwan' && JSON.stringify(meta().versions) === JSON.stringify({ places: 2, memory: 3, world: 4, book: 1 }), JSON.stringify(meta()));
const snap = syncSnapshot();
check('backend ok · 상태 스냅샷', snap.backend === 'ok' && snap.sync.userId === 'yoongwan' && snap.sync.versions.world === 4 && snap.sync.skipped === null && snap.sync.lastError === null && notified >= 1, JSON.stringify(snap));
off();

// 같은 버전이면 다시 받지 않는다
server.log = [];
const logins0 = server.loginCalls;
await bootstrapSync();
check('로컬 버전과 같으면 다시 받지 않는다 (login도 다시 안 한다)', !server.log.some(l => /\/api\/me\/docs\/[a-z]+$/.test(l.url)) && server.loginCalls === logins0, JSON.stringify(server.log.map(l => l.url)));

// 로컬 저장본이 없으면(다른 기기) 서버 것을 받고, 서버에 없는 문서는 버전 0으로 둔다
storage.delete(DOC_KEYS.book);
delete server.docs.places;
await bootstrapSync();
check('로컬에 없는 문서는 같은 버전이어도 받는다', storage.get(DOC_KEYS.book) === '[]', String(storage.get(DOC_KEYS.book)));
check('서버에 없는 문서는 다음 PUT이 새로 만들도록 버전 0', meta().versions.places === 0, JSON.stringify(meta().versions));

// ── 2) 푸시: 800 ms 디바운스로 한 번만, baseVersion은 내 버전 ───────────────────
console.log('\n── 푸시 ──');
server.log = [];
onLocalSave('memory', { name: '토리', likes: ['커피'] });
onLocalSave('memory', { name: '토리', likes: ['커피', '바다'] });
await sleep(300);
check('디바운스 안에는 아직 안 올린다', puts('memory').length === 0, String(puts('memory').length));
await sleep(700);
check('연달아 저장해도 PUT은 한 번, 마지막 값으로', puts('memory').length === 1 && puts('memory')[0].body.body.likes.join() === '커피,바다', JSON.stringify(puts('memory')));
check('baseVersion은 내 버전, clientTs는 저장 시각', puts('memory')[0].body.baseVersion === 3 && typeof puts('memory')[0].body.clientTs === 'number' && puts('memory')[0].body.force === undefined, JSON.stringify(puts('memory')[0].body));
check('200이면 버전이 오르고 push 시각이 찍힌다', meta().versions.memory === 4 && syncSnapshot().sync.versions.memory === 4 && typeof syncSnapshot().sync.lastPushAt === 'number', JSON.stringify(meta()));
onLocalSave('places', { v: 1, cities: {} });
await flushAll();
check('서버에 없던 문서는 baseVersion 0으로 만들어진다', puts('places').length === 1 && puts('places')[0].body.baseVersion === 0 && server.docs.places.version === 1 && meta().versions.places === 1, JSON.stringify(puts('places')));

// ── 3) 409: 서버본이 더 나중이면 채택(localStorage + reload), 아니면 force ────────
console.log('\n── 409 ──');
server.log = [];
// 다른 기기가 memory를 v5로 올렸다 (내 저장보다 나중 clientTs)
server.docs.memory = { version: 5, updatedAt: Date.now(), clientTs: Date.now() + 10_000, body: { name: '다른기기', likes: [], dislikes: [], traits: [], homePlaceId: 'home', friends: [], visited: [] } };
onLocalSave('memory', { name: '토리', likes: ['커피'] });
await flushAll();
check('409에 서버본이 더 나중이면 서버본을 localStorage에 쓰고 새로 뜬다', puts('memory').length === 1 && JSON.parse(storage.get(DOC_KEYS.memory)).name === '다른기기' && meta().versions.memory === 5 && reloads === 1, JSON.stringify([puts('memory').length, storage.get(DOC_KEYS.memory), meta().versions, reloads]));
onLocalSave('memory', { name: '낡은' });
await flushAll();
check('채택 뒤 새로 뜨기 전의 저장은 올리지 않는다', puts('memory').length === 1 && server.docs.memory.body.name === '다른기기', String(puts('memory').length));

// 새로 뜬 셈 치고 다시 부트스트랩 — 이번엔 서버본이 내 저장보다 오래됐다
await bootstrapSync();
server.log = [];
server.docs.memory = { version: 7, updatedAt: Date.now(), clientTs: Date.now() - 60_000, body: { name: '옛것' } };
onLocalSave('memory', { name: '토리', likes: ['커피', '바다', '그림'] });
await flushAll();
const mp = puts('memory');
check('409에 내 것이 더 나중이면 force로 다시 보낸다', mp.length === 2 && mp[0].body.force === undefined && mp[1].body.force === true && mp[1].body.body.likes.length === 3, JSON.stringify(mp.map(p => p.body)));
check('force 뒤 서버가 내 것을 갖고 버전이 맞는다', server.docs.memory.body.name === '토리' && server.docs.memory.version === 8 && meta().versions.memory === 8 && reloads === 1, JSON.stringify([server.docs.memory.version, meta().versions.memory]));

// ── 4) dev 시계: scale≠1이면 world/book은 안 올리고 안 받는다 ─────────────────
console.log('\n── dev 시계 ──');
server.log = [];
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: Date.now(), scale: 10 }));
onLocalSave('world', { ...WORLD, regen: { x: {} } });
onLocalSave('book', [{ id: 'c:1' }]);
onLocalSave('memory', { name: '토리', likes: ['커피'] });
await flushAll();
check('scale≠1이면 world/book은 PUT하지 않는다', puts('world').length === 0 && puts('book').length === 0, JSON.stringify(server.log.map(l => l.url)));
check('memory는 그대로 올라간다', puts('memory').length === 1, String(puts('memory').length));
check('건너뛴 이유가 남는다', /x10/.test(syncSnapshot().sync.skipped ?? ''), String(syncSnapshot().sync.skipped));
// 받기: 서버 world가 새것이어도 dev 시계면 안 받는다
server.docs.world = { version: 9, updatedAt: Date.now(), clientTs: Date.now(), body: { ...WORLD, regen: { srv: {} } } };
storage.set(DOC_KEYS.world, JSON.stringify(WORLD));
await bootstrapSync();
check('scale≠1이면 서버 world를 받지 않는다', JSON.parse(storage.get(DOC_KEYS.world)).regen.srv === undefined && meta().versions.world === 4 && /x10/.test(syncSnapshot().sync.skipped ?? ''), JSON.stringify([meta().versions, syncSnapshot().sync.skipped]));
// 시계를 되돌리면 받고, 미래 anchor면 또 안 받는다
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: Date.now(), scale: 1 }));
await bootstrapSync();
check('scale 1로 돌아오면 서버 world를 받는다', JSON.parse(storage.get(DOC_KEYS.world)).regen.srv !== undefined && meta().versions.world === 9 && syncSnapshot().sync.skipped === null, JSON.stringify([meta().versions, syncSnapshot().sync.skipped]));
server.docs.world = { version: 10, updatedAt: Date.now(), clientTs: Date.now(), body: { ...WORLD, anchor: { ...WORLD.anchor, t: Date.now() + 86_400_000 } } };
server.docs.book = { version: 2, updatedAt: Date.now(), clientTs: Date.now(), body: [{ id: 'c:future' }] };
await bootstrapSync();
check('서버 world의 anchor가 미래면 world/book을 받지 않는다', meta().versions.world === 9 && meta().versions.book === 1 && storage.get(DOC_KEYS.book) === '[]' && /미래/.test(syncSnapshot().sync.skipped ?? ''), JSON.stringify([meta().versions, syncSnapshot().sync.skipped]));
// 점프한 시계(scale 1이지만 sim ≠ 실제 — jumpTo·x10→x1 뒤)도 dev 시계다: world는 안 올리고, 이유는 "점프"
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: Date.now() + 6 * 3600_000, scale: 1 }));
server.log = [];
onLocalSave('world', { ...WORLD, regen: { jumped: {} } });
onLocalSave('memory', { name: '토리', likes: ['점프'] });
await flushAll();
check('점프한 시계(scale 1)면 world는 PUT하지 않고 이유가 "점프"', puts('world').length === 0 && puts('memory').length === 1 && /점프/.test(syncSnapshot().sync.skipped ?? ''), JSON.stringify([server.log.map(l => l.url), syncSnapshot().sync.skipped]));
server.docs.world = { version: 11, updatedAt: Date.now(), clientTs: Date.now(), body: { ...WORLD, regen: { srvJump: {} } } };
await bootstrapSync();
check('점프한 시계면 서버 world도 받지 않는다', meta().versions.world === 9 && /점프/.test(syncSnapshot().sync.skipped ?? ''), JSON.stringify([meta().versions, syncSnapshot().sync.skipped]));
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: Date.now(), scale: 1 }));
await bootstrapSync();
check('실시간으로 돌아오면 받는다', meta().versions.world === 11 && syncSnapshot().sync.skipped === null, JSON.stringify([meta().versions, syncSnapshot().sync.skipped]));

// ── 4b) keepalive flush: 64 KB 넘는 본문은 보통 요청으로, keepalive 실패는 down이 아니다 ──
console.log('\n── keepalive ──');
server.log = [];
onLocalSave('book', [{ id: 'c:big', png: 'x'.repeat(70_000) }]);
onLocalSave('memory', { name: '토리', likes: ['작음'] });
await flushAll(true);
check('64 KB 넘는 문서는 keepalive 없이, 작은 문서는 keepalive로 올린다', puts('book').length === 1 && puts('book')[0].keepalive === false && puts('memory').length === 1 && puts('memory')[0].keepalive === true, JSON.stringify(server.log.map(l => [l.url, l.keepalive])));
server.offline = true;
onLocalSave('memory', { name: '토리', likes: ['숨음'] });
await flushAll(true);
check('keepalive PUT이 실패해도 backend는 down이 아니다 (오류만 남는다)', syncSnapshot().backend === 'ok' && /memory/.test(syncSnapshot().sync.lastError ?? ''), JSON.stringify(syncSnapshot()));
server.offline = false;
onLocalSave('memory', { name: '토리', likes: ['다시'] });
await flushAll();
check('다음 저장이 대신 올라간다', server.docs.memory.body.likes?.join() === '다시' && syncSnapshot().sync.lastError === null, JSON.stringify(server.docs.memory.body));

// ── 4c) 부트스트랩이 문서를 받다 끊기면 그 문서의 첫 409는 서버본 채택 — 낡은 로컬본으로 새 서버본을 덮지 않는다 ──
console.log('\n── 못 받은 문서 ──');
server.docs.world = { version: 13, updatedAt: Date.now() - 10_000, clientTs: Date.now() - 10_000, body: { ...WORLD, regen: { srvNew: {} } } };
server.failGetOnce = 'world';
await bootstrapSync();
check('받다 끊기면 down, 버전은 그대로', syncSnapshot().backend === 'down' && meta().versions.world === 11 && JSON.parse(storage.get(DOC_KEYS.world)).regen.srvNew === undefined, JSON.stringify([syncSnapshot().backend, meta().versions]));
const reloads0 = reloads;
server.log = [];
onLocalSave('world', { ...WORLD, regen: { stale: {} } });
await flushAll();
check('못 받은 문서의 409는 내 저장이 나중이어도 서버본 채택 (force 없음, reload)', puts('world').length === 1 && puts('world')[0].body.force === undefined && reloads === reloads0 + 1 && JSON.parse(storage.get(DOC_KEYS.world)).regen.srvNew !== undefined && meta().versions.world === 13, JSON.stringify([puts('world').map(p => p.body.force), reloads - reloads0, meta().versions]));
await bootstrapSync();   // 새로 뜬 셈 — adopting 해제

// ── 5) 오프라인: backend 'down', 앱은 그대로 ────────────────────────────────────
console.log('\n── 오프라인 ──');
server.docs.world = { version: 13, updatedAt: Date.now(), clientTs: Date.now(), body: WORLD };
server.docs.book = { version: 1, updatedAt: Date.now(), clientTs: Date.now(), body: [] };
await bootstrapSync();
check('서버가 돌아오면 ok', syncSnapshot().backend === 'ok', syncSnapshot().backend);
server.offline = true;
onLocalSave('memory', { name: '토리', likes: ['오프라인'] });
await flushAll();
check('PUT이 실패하면 backend down, 오류가 남는다', syncSnapshot().backend === 'down' && /memory/.test(syncSnapshot().sync.lastError ?? ''), JSON.stringify(syncSnapshot()));
check('health가 false면 down 그대로', (await health()) === false && (await checkHealth()) === 'down', '');
server.offline = false;
check('health가 살아나면 ok로 돌아오고 밀린 문서를 올린다', (await checkHealth()) === 'ok', syncSnapshot().backend);
await sleep(50);
await flushAll();
check('밀린 memory가 올라갔다', server.docs.memory.body.likes?.join() === '오프라인', JSON.stringify(server.docs.memory.body));
// 부트스트랩 자체가 오프라인이면: 조용히 down, 금방 끝난다
server.offline = true;
const t1 = Date.now();
await bootstrapSync();
check('부트스트랩이 오프라인이면 down으로 금방 끝난다', syncSnapshot().backend === 'down' && Date.now() - t1 < 1000, JSON.stringify([syncSnapshot().backend, Date.now() - t1]));
check('서버가 없어도 사용자와 앱 데이터는 그대로', currentUser()?.userId === 'yoongwan' && JSON.parse(storage.get(DOC_KEYS.world)).v === 5, '');

// ── 5b) 사용자 바꾸기: 로컬 저장본을 비우고 그 아이디의 문서를 받는다 (AUTH-ADDENDUM 결정 3) ──
console.log('\n── 사용자 바꾸기 ──');
server.offline = false;
const WIPED = ['theworld.world.v5', 'theworld.world.v4', 'theworld.days.v3', 'theworld.memory.v2', 'theworld.book.v1', 'theworld.places.v1', 'theworld.seen.v3', 'theworld.chatseen.v1', 'theworld.onboarded.v1', 'theworld.sync.v1'];
for (const k of ['theworld.world.v4', 'theworld.days.v3', 'theworld.seen.v3', 'theworld.chatseen.v1', 'theworld.onboarded.v1']) storage.set(k, '1');
storage.set('theworld.llm.v1', '"small"'); storage.set('theworld.route.v1:x', '[]');
const worldBefore = storage.get(DOC_KEYS.world);
// 로그인 화면(main.tsx): login → clearLocalDocs → bootstrapSync
server.docs = { memory: { version: 1, updatedAt: Date.now(), clientTs: Date.now(), body: { name: '호준이' } } };
server.log = [];
await login('hojun');
clearLocalDocs();
check('사용자 바꾸면 로컬 저장본이 비워진다 (clock·llm·route는 남는다)', WIPED.every(k => !storage.has(k)) && storage.has('theworld.clock.v1') && storage.get('theworld.llm.v1') === '"small"' && storage.has('theworld.route.v1:x') && currentUser()?.userId === 'hojun', JSON.stringify([...storage.keys()]));
await bootstrapSync();
check('그 뒤 새 아이디의 문서를 받는다 (X-User-Id: hojun, 없는 문서는 새 하루)', server.log.some(l => l.url.endsWith('/api/me/docs') && l.user === 'hojun') && JSON.parse(storage.get(DOC_KEYS.memory)).name === '호준이' && !storage.has(DOC_KEYS.world) && meta().userId === 'hojun' && syncSnapshot().sync.userId === 'hojun' && syncSnapshot().backend === 'ok', JSON.stringify([server.log.map(l => [l.url, l.user]), meta()]));
// 로그인 화면을 거치지 않고 사용자가 바뀌어도(메타의 userId ≠ 현재) 부트스트랩이 먼저 비운다
storage.set(DOC_KEYS.world, worldBefore);
storage.set('theworld.user.v1', JSON.stringify({ userId: 'guest1', name: '손님1' }));
server.docs = {};
await bootstrapSync();
check('메타의 userId ≠ 현재 userId면 부트스트랩이 먼저 비운다', !storage.has(DOC_KEYS.world) && !storage.has(DOC_KEYS.memory) && meta().userId === 'guest1' && syncSnapshot().sync.userId === 'guest1', JSON.stringify([[...storage.keys()], meta()]));
// 비운 뒤 서버 목록을 못 받은 채(오프라인) 새 하루가 먼저 저장되면: 첫 409는 서버본 채택 — 빈 기기의 새 하루로 서버를 덮지 않는다
storage.set('theworld.user.v1', JSON.stringify({ userId: 'guest2', name: '손님2' }));
server.offline = true;
await bootstrapSync();
check('바뀐 사용자로 오프라인 부트스트랩: 비우고 down, 메타는 fresh', !storage.has(DOC_KEYS.memory) && syncSnapshot().backend === 'down' && meta().userId === 'guest2' && meta().fresh === true, JSON.stringify(meta()));
server.offline = false;
server.docs.world = { version: 3, updatedAt: Date.now() - 60_000, clientTs: Date.now() - 60_000, body: { ...WORLD, regen: { srvOld: {} } } };
server.log = [];
const reloadsB = reloads;
onLocalSave('world', { ...WORLD, regen: { newday: {} } });
await flushAll();
check('목록을 못 받은 기기의 첫 409는 내 저장이 나중이어도 서버본 채택 (force 없음, reload)', puts('world').length === 1 && puts('world')[0].body.force === undefined && reloads === reloadsB + 1 && JSON.parse(storage.get(DOC_KEYS.world)).regen.srvOld !== undefined && meta().versions.world === 3, JSON.stringify([puts('world').map(p => p.body.force), reloads - reloadsB, meta().versions]));
// 서버가 이 아이디를 모른다(DB 초기화·시드 변경): down이 아니라 로그인 필요 — 사용자를 버리고, 서버는 살아 있다고 둔다
server.known.delete('guest2');
server.log = [];
await bootstrapSync();
check('401이면 저장된 사용자를 버리고 backend는 down이 아니다 (로그인 필요)', currentUser() === null && syncSnapshot().backend === 'ok' && syncSnapshot().sync.userId === null && /로그인/.test(syncSnapshot().sync.lastError ?? ''), JSON.stringify([currentUser(), syncSnapshot()]));
onLocalSave('memory', { name: '버려짐' });
await flushAll();
check('버려진 뒤엔 푸시하지 않는다', !server.log.some(l => l.method === 'PUT'), JSON.stringify(server.log.map(l => l.url)));

// ── 5c) 사용자 없음 ("오프라인으로 시작"): 부트스트랩이 아무것도 받지 않고, 로컬은 그대로 ──
console.log('\n── 사용자 없음 ──');
logout();
server.docs = { memory: { version: 9, updatedAt: Date.now(), clientTs: Date.now(), body: { name: '서버' } } };
storage.set(DOC_KEYS.memory, JSON.stringify({ name: '로컬' }));
server.log = [];
await bootstrapSync();
onLocalSave('memory', { name: '로컬2' });
await flushAll();
check('사용자 없으면 부트스트랩이 아무것도 안 받는다 (요청 0 · 로컬 그대로 · 푸시도 없음 · armed 아님)', server.log.length === 0 && JSON.parse(storage.get(DOC_KEYS.memory)).name === '로컬' && syncSnapshot().sync.userId === null && !syncArmed() && (await checkHealth()) === 'unknown', JSON.stringify([server.log, syncSnapshot()]));

// ── 6) 하네스: fetch가 없으면 전부 무해 ───────────────────────────────────────
console.log('\n── 하네스 ──');
delete globalThis.fetch;
await bootstrapSync();
onLocalSave('memory', { name: 'x' });
await flushAll();
check('fetch가 없으면 no-op (오류 없음)', (await health()) === false && (await checkHealth()) === 'unknown' && (await fetchUsers()) === null, '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
