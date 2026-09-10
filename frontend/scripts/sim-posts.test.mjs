// SNS 글·좋아요·피드 harness (CONTRACT §2.5 · ADR-0021, sim/posts.ts + sim/sns.ts) — fetch를 흉내 내어: 글 올리기 본문과
// 검증된 응답, PATCH는 PATCH로, 좋아요 끄기는 DELETE로, 피드는 cursor/limit을 싣고 틀린 항목만 버리며, 403은 null + lastError,
// 사용자가 없으면 fetch 없이 null. 그 위의 useSns: 이어 붙이기·중복 제거·구분선 index, 낙관적 좋아요와 되돌리기, 지우면 어디서든 빠진다.
// Usage: node scripts/sim-posts.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

/** posts.ts의 console.warn을 받아 둔다 — 같은 이유는 한 번만 적는지 본다 */
const warns = [];
console.warn = (...a) => { warns.push(a.join(' ')); };

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// ── 가짜 서버 (§2.5 posts·likes·feed·users/{id}/posts·me/posts) ────────────────────────────
const ME = 'yoongwan';
const hex = (c, len = 32) => c.repeat(len);
const homeOf = (id, name) => ({ id: `home:${id}`, name: `${name}네 집`, type: 'friend_home', lng: 126.93, lat: 37.56, area: '연희동', city: 'seoul', country: 'KR', emoji: '🏡', ownerFriendId: id });
const agentOf = (id, name, extra = {}) => ({ id, name, homePlaceId: `home:${id}`, color: '#F6C445', emoji: '🐨', likes: ['카페'], traits: ['외향적'], home: homeOf(id, name), visibility: 'public', ...extra });
const cut = (c, win = 0, by = 'user') => ({ shotId: hex(c), actKey: '2026-09-11@Asia/Seoul:am', win, by });
let seq = 0;
const postOf = (authorId, extra = {}) => ({
  id: hex((seq++ % 10).toString(), 32), authorId, createdAt: 1_700_000_000_000 + seq, cuts: [cut('a'), cut('b', 1, 'agent')], caption: '카페에서 그림',
  place: '카페 레이어드 연남', area: '연남동', city: 'seoul', category: 'play', dateKey: '2026-09-11', companions: [], editedByOwner: false, likes: 3, likedByMe: false, ...extra,
});
const F1 = agentOf('hojun', '호준', { visibility: 'private', repShotId: hex('e') });
const R1 = agentOf('guest1', '손님1');
const R2 = agentOf('guest2', '손님2', { gender: 'female' });
const P_F1 = postOf('hojun', { id: hex('1') });
const P_F2 = postOf('hojun', { id: hex('2'), likes: 0 });
const P_R1 = postOf('guest1', { id: hex('3'), likes: 12 });
const P_R2 = postOf('guest2', { id: hex('4'), likes: 7, likedByMe: true });
const P_R3 = postOf('guest1', { id: hex('5') });
const P_ME = postOf(ME, { id: hex('6'), editedByOwner: true });

/** likeDefer가 배열이면 좋아요 응답을 바로 주지 않고 resolver를 쌓는다 — 겹친 토글의 답 순서를 시험에서 정한다 */
const server = { log: [], offline: false, likes: {}, likeDefer: null };
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  if (server.offline) throw new TypeError('fetch failed');
  const body = init.body ? JSON.parse(init.body) : undefined;
  const user = init.headers?.['x-user-id'] ?? null;
  server.log.push({ method, url, body, user });
  if (user !== ME) return json(401, { error: 'unauthorized' });
  const u = new URL(url, 'http://x');
  const path = u.pathname;
  let m;
  if (path === '/api/posts' && method === 'POST') {
    if (body.cuts.some(c => c.shotId === hex('f'))) return json(400, { error: 'cut not yours' });
    return json(201, { ...postOf(ME, { id: hex('9') }), ...body, caption: body.caption ?? '', companions: body.companions ?? [], editedByOwner: body.editedByOwner ?? false, likes: 0, likedByMe: false, authorId: ME, extra: 'ignored' });
  }
  if ((m = path.match(/^\/api\/posts\/([0-9a-f]{32})$/))) {
    if (m[1] === hex('1')) return json(403, { error: 'not yours' });
    if (method === 'PATCH') return json(200, { ...P_ME, ...body, editedByOwner: true });
    if (method === 'DELETE') return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
  }
  if ((m = path.match(/^\/api\/posts\/([0-9a-f]{32})\/like$/))) {
    if (m[1] === hex('2')) return json(403, { error: 'not allowed' });
    if (server.likeFail) return json(500, { error: 'boom' });
    const on = method === 'POST';
    server.likes[m[1]] = on;
    const res = json(200, { likes: on ? 100 : 99, likedByMe: on });
    if (server.likeDefer) return new Promise(r => server.likeDefer.push(() => r(res)));
    return res;
  }
  if (path === '/api/feed') {
    const cursor = u.searchParams.get('cursor'), limit = u.searchParams.get('limit');
    if (cursor === 'bad') return json(400, { error: 'cursor invalid' });
    if (!cursor) return json(200, { items: [{ post: P_F1, author: F1 }, { post: P_F2, author: F1 }, { post: { ...P_R1, cuts: [] }, author: R1 }, 'junk', { post: P_R1, author: R1, why: '놀기 글을 좋아하셔서' }], next: `f:2:${limit}` });
    if (cursor.startsWith('f:2')) return json(200, { items: [{ post: P_R1, author: R1, why: '놀기 글을 좋아하셔서' }, { post: P_R2, author: R2, why: '연남동 이웃' }], next: 'r:2' });
    return json(200, { items: [{ post: P_R3, author: R1, why: '요즘 인기' }], next: null });
  }
  if ((m = path.match(/^\/api\/users\/([a-z0-9_]+)\/posts$/))) {
    if (m[1] === 'guest3') return json(403, { error: 'not allowed' });
    const cursor = u.searchParams.get('cursor');
    if (m[1] === 'guest1') return cursor ? json(200, { items: [P_R3], next: null }) : json(200, { items: [P_R1, { id: 'broken' }], next: 'u:1' });
    return json(200, { items: [], next: null });
  }
  if (path === '/api/me/posts') {
    const cursor = u.searchParams.get('cursor');
    return cursor ? json(200, { items: [{ ...P_F2, id: hex('8'), authorId: ME }], next: null }) : json(200, { items: [P_ME, { ...P_F1, id: hex('7'), authorId: ME }], next: 'm:1' });
  }
  return json(404, { error: 'not found' });
};

freezeClockAt(Date.UTC(2026, 8, 11, 0, 0));
const posts = await import('../src/sim/posts.ts');
const { createPost, patchPost, deletePost, setLike, fetchFeed, fetchUserPosts, fetchMyPosts, validPost, validPostCut, validFeedItem, validFeed, validPosts, validLikes } = posts;
const { useSns, firstWhyIndex, appendFeed } = await import('../src/sim/sns.ts');
const S = () => useSns.getState();
const last = () => server.log[server.log.length - 1];

// ── 사용자 없음 ───────────────────────────────────────────────────────────────
console.log('\n── 사용자 없음 ──');
check('사용자가 없으면 fetch 없이 null', (await fetchFeed()) === null && (await createPost({ cuts: [cut('a')], place: 'p', area: 'a', city: 'seoul', dateKey: 'd' })) === null && (await deletePost(hex('1'))) === false && server.log.length === 0, String(server.log.length));

// ── 검증 ─────────────────────────────────────────────────────────────────────
console.log('\n── 검증 ──');
check('validPost: 멀쩡한 글은 통과, 모르는 키는 지나간다', validPost({ ...P_F1, extra: 1 })?.id === hex('1') && !('extra' in validPost({ ...P_F1, extra: 1 })), '');
check('validPost: 컷이 비거나 하나라도 틀리면 글을 버린다', validPost({ ...P_F1, cuts: [] }) === null && validPost({ ...P_F1, cuts: [cut('a'), { ...cut('b'), win: 4 }] }) === null && validPost({ ...P_F1, cuts: [{ ...cut('a'), by: 'me' }] }) === null, '');
check('validPost: likes·likedByMe·editedByOwner·dateKey 모양이 틀리면 버린다', validPost({ ...P_F1, likes: 'x' }) === null && validPost({ ...P_F1, likedByMe: 1 }) === null && validPost({ ...P_F1, dateKey: '' }) === null, '');
check('validPost: category는 문자열일 때만 실린다', validPost({ ...P_F1, category: 7 })?.category === undefined && validPost(P_F1)?.category === 'play', '');
check('validPost: companions는 문자열만·80자 이하·16개까지, likes는 내림·0 이상', JSON.stringify(validPost({ ...P_F1, companions: ['a', 3, '', 'x'.repeat(81), ...Array.from({ length: 20 }, (_, i) => `c${i}`)] })?.companions) === JSON.stringify(['a', ...Array.from({ length: 15 }, (_, i) => `c${i}`)]) && validPost({ ...P_F1, companions: 'x' })?.companions.length === 0 && validPost({ ...P_F1, likes: 2.7 })?.likes === 2 && validPost({ ...P_F1, likes: -4 })?.likes === 0, '');
check('validPostCut: shotId 32자 hex · win 0~3 · by user|agent, 모르는 키는 지나간다', validPostCut({ ...cut('a'), extra: 1 })?.shotId === hex('a') && !('extra' in validPostCut({ ...cut('a'), extra: 1 })) && validPostCut(cut('g')) === null && validPostCut({ ...cut('a'), win: '1' }) === null && validPostCut({ ...cut('a'), actKey: '' }) === null && validPostCut(null) === null, '');
check('validFeedItem: why가 80자를 넘어도 추천 글이다 (잘라서 싣는다 — 없애면 친구 글로 둔갑)', validFeedItem({ post: P_R1, author: R1, why: '이'.repeat(100) })?.why === '이'.repeat(100) && validFeedItem({ post: P_R1, author: R1, why: '이'.repeat(200) })?.why?.length === 140 && validFeedItem({ post: P_R1, author: R1, why: '' })?.why === undefined && validFeedItem({ post: P_R1, author: R1, why: 3 })?.why === undefined, '');
check('validPosts: 틀린 글만 버리고 next는 문자열 아니면 null', validPosts({ items: [P_F1, { id: 'x' }, null], next: 'u' })?.items.length === 1 && validPosts({ items: [], next: 0 })?.next === null && validPosts({ items: {} }) === null && validPosts(null) === null, '');
check('validFeed: 틀린 항목만 버리고 next는 문자열 아니면 null', validFeed({ items: [{ post: P_F1, author: F1 }, { post: P_F1, author: { id: 'x' } }, 1], next: 5 })?.items.length === 1 && validFeed({ items: [], next: 'c' })?.next === 'c' && validFeed({ items: 'x' }) === null, '');
check('validLikes', validLikes({ likes: 2, likedByMe: true })?.likes === 2 && validLikes({ likes: -1, likedByMe: false })?.likes === 0 && validLikes({ likes: 1 }) === null, '');

// ── 클라이언트 ────────────────────────────────────────────────────────────────
console.log('\n── 클라이언트 ──');
storage.set('theworld.user.v1', JSON.stringify({ userId: ME, name: '윤관' }));
server.log = [];
const made = await createPost({ cuts: [cut('a'), cut('b', 2, 'agent')], caption: '올렸어', place: '카페 레이어드 연남', area: '연남동', city: 'seoul', category: 'play', dateKey: '2026-09-11', companions: ['hojun'] });
check('createPost: POST /api/posts에 본문 그대로, 응답은 검증된 Post (모르는 키 없음)', last().method === 'POST' && last().url.endsWith('/api/posts') && last().body.cuts.length === 2 && last().body.caption === '올렸어' && last().body.companions[0] === 'hojun' && made?.id === hex('9') && made.authorId === ME && made.caption === '올렸어' && !('extra' in made) && posts.lastError === '', JSON.stringify([last(), made]));
check('createPost: 남의 컷이면 400 cut not yours → null, lastError', (await createPost({ cuts: [cut('f')], place: 'p', area: 'a', city: 'seoul', dateKey: 'd' })) === null && /cut not yours/.test(posts.lastError), posts.lastError);
server.log = [];
const patched = await patchPost(hex('6'), { caption: '고쳤어' });
check('patchPost: method PATCH · 본문은 온 칸만 · editedByOwner true', last().method === 'PATCH' && last().url.endsWith(`/api/posts/${hex('6')}`) && JSON.stringify(last().body) === JSON.stringify({ caption: '고쳤어' }) && patched?.caption === '고쳤어' && patched.editedByOwner === true, JSON.stringify([last(), patched]));
check('patchPost: 남의 글이면 403 not yours → null, lastError', (await patchPost(hex('1'), { caption: 'x' })) === null && /403 not yours/.test(posts.lastError), posts.lastError);
const warnsBefore = warns.length;
await patchPost(hex('1'), { caption: 'x' });
await patchPost(hex('1'), { caption: 'x' });
check('같은 이유가 연달아 나면 console.warn은 한 번만 (앞서 적은 것과 같으면 안 적는다)', warns.length === warnsBefore && /\[posts\] patch: 403 not yours/.test(warns[warns.length - 1]), JSON.stringify(warns));
await deletePost(hex('1'));
check('…다른 이유면 다시 적는다', warns.length === warnsBefore + 1 && /delete: 403 not yours/.test(warns[warns.length - 1]), JSON.stringify(warns.slice(-2)));
check('실패 뒤 성공하면 lastError는 다시 빈 문자열', (await patchPost(hex('6'), { caption: '다시' }))?.caption === '다시' && posts.lastError === '', posts.lastError);
server.log = [];
check('deletePost: DELETE → 204 → true', (await deletePost(hex('6'))) === true && last().method === 'DELETE' && last().url.endsWith(`/api/posts/${hex('6')}`), JSON.stringify(last()));
check('deletePost: 403이면 false', (await deletePost(hex('1'))) === false && /not yours/.test(posts.lastError), posts.lastError);
server.log = [];
const on = await setLike(hex('3'), true);
const off = await setLike(hex('3'), false);
check('setLike(on) = POST …/like, setLike(off) = DELETE …/like → Likes', server.log[0].method === 'POST' && server.log[0].url.endsWith(`/api/posts/${hex('3')}/like`) && server.log[1].method === 'DELETE' && on?.likes === 100 && on.likedByMe === true && off?.likes === 99 && off.likedByMe === false, JSON.stringify([server.log, on, off]));
check('setLike: 비공개 글은 403 not allowed → null, lastError', (await setLike(hex('2'), true)) === null && /not allowed/.test(posts.lastError), posts.lastError);
server.log = [];
const page1 = await fetchFeed();
check('fetchFeed: 처음엔 cursor 없이 limit=20, 응답 검증 (틀린 항목만 빠지고 장은 산다)', last().url.endsWith('/api/feed?limit=20') && page1?.items.length === 3 && page1.items[0].post.id === hex('1') && page1.items[2].why === '놀기 글을 좋아하셔서' && page1.next === 'f:2:20', JSON.stringify([last().url, page1?.items.map(i => i.post.id), page1?.next]));
check('fetchFeed: 작성자는 RemoteAgent로 검증돼 visibility·repShotId·gender가 남는다', page1?.items[0].author.visibility === 'private' && page1.items[0].author.repShotId === hex('e') && page1.items[0].author.home.type === 'friend_home', JSON.stringify(page1?.items[0].author));
server.log = [];
const page2 = await fetchFeed(page1.next, 5);
check('fetchFeed: 다음 장은 next를 그대로 cursor로, limit도 싣는다', last().url.endsWith('/api/feed?limit=5&cursor=f%3A2%3A20') && page2?.items.length === 2 && page2.next === 'r:2', JSON.stringify([last().url, page2]));
check('fetchFeed: cursor invalid → null, lastError', (await fetchFeed('bad')) === null && /cursor invalid/.test(posts.lastError), posts.lastError);
server.log = [];
const up = await fetchUserPosts('guest1');
check('fetchUserPosts: GET /api/users/{id}/posts, 틀린 글만 빠진다', last().url.endsWith('/api/users/guest1/posts?limit=20') && up?.items.length === 1 && up.next === 'u:1', JSON.stringify([last().url, up]));
check('fetchUserPosts: 비공개 + 친구 아님 403 → null, lastError', (await fetchUserPosts('guest3')) === null && /403 not allowed/.test(posts.lastError), posts.lastError);
const mine = await fetchMyPosts();
check('fetchMyPosts: GET /api/me/posts', last().url.endsWith('/api/me/posts?limit=20') && mine?.items.length === 2 && mine.next === 'm:1', JSON.stringify(mine));
server.offline = true;
check('오프라인이면 null (throw 없음), lastError', (await fetchFeed()) === null && (await setLike(hex('3'), true)) === null && /feed|like/.test(posts.lastError), posts.lastError);
server.offline = false;
// 사용자가 사라진 뒤(401 → logout) 앞선 실패 이유가 남으면 UI가 엉뚱한 말을 한다 — fetch 없이 null, lastError는 'no user', warn 없음
await fetchUserPosts('guest3');
server.log = [];
const warnsNoUser = warns.length;
storage.delete('theworld.user.v1');
check('사용자가 없으면 앞선 실패 이유가 남지 않는다 (lastError = "posts: no user", fetch·warn 없음)', (await fetchUserPosts('guest3')) === null && posts.lastError === 'posts: no user' && !/not allowed/.test(posts.lastError) && server.log.length === 0 && warns.length === warnsNoUser, posts.lastError);
storage.set('theworld.user.v1', JSON.stringify({ userId: ME, name: '윤관' }));

// ── useSns ───────────────────────────────────────────────────────────────────
console.log('\n── useSns: 피드 ──');
check('처음엔 비어 있고 UI 플래그는 닫힘', S().feed.length === 0 && S().feedNext === null && !S().feedEnded && !S().snsOpen && S().snsTab === 'feed' && S().profileOpen === null && !S().composeOpen, JSON.stringify(S()));
await S().loadFeed();
check('loadFeed: 첫 장 (틀린 항목 빠진 3개), next 보관, 아직 안 끝남', S().feed.length === 3 && S().feedNext === 'f:2:20' && !S().feedEnded && !S().feedLoading, JSON.stringify(S().feed.map(i => i.post.id)));
check('firstWhyIndex: 첫 추천 글 앞이 구분선 (친구 글 2개 뒤)', firstWhyIndex(S().feed) === 2 && firstWhyIndex([]) === -1 && firstWhyIndex(S().feed.slice(0, 2)) === -1, String(firstWhyIndex(S().feed)));
await S().loadFeed();
check('loadFeed: 다음 장을 이어 붙이고 같은 글(P_R1)은 한 번만, 순서 그대로', S().feed.map(i => i.post.id).join() === [hex('1'), hex('2'), hex('3'), hex('4')].join() && S().feedNext === 'r:2', S().feed.map(i => i.post.id).join());
await S().loadFeed();
check('loadFeed: 마지막 장이면 ended', S().feed.length === 5 && S().feedEnded && S().feedNext === null, JSON.stringify([S().feed.length, S().feedEnded]));
server.log = [];
await S().loadFeed();
check('끝났으면 다시 묻지 않는다', server.log.length === 0, String(server.log.length));
await S().loadFeed(true);
check('loadFeed(reset): 처음부터 다시', S().feed.length === 3 && S().feedNext === 'f:2:20' && !S().feedEnded, String(S().feed.length));
check('appendFeed는 순수 (중복 제거·순서 유지)', appendFeed([{ post: P_F1, author: F1 }], [{ post: P_F1, author: F1 }, { post: P_R1, author: R1, why: 'w' }]).map(i => i.post.id).join() === [hex('1'), hex('3')].join(), '');
server.offline = true;
await S().loadFeed(true);
check('실패하면 있던 피드는 그대로, loading은 풀린다', S().feed.length === 3 && !S().feedLoading, JSON.stringify([S().feed.length, S().feedLoading]));
server.offline = false;

console.log('\n── useSns: 좋아요 ──');
await S().loadFeed();   // P_R2(4)까지
await S().loadUserPosts('guest1');
await S().loadMyPosts();
const before = S().feed.find(i => i.post.id === hex('3')).post;
check('준비: 피드 4개 · guest1 프로필 1개(같은 글 P_R1) · 내 글 2개', S().feed.length === 4 && S().profiles.guest1?.posts.length === 1 && S().profiles.guest1.posts[0].id === hex('3') && S().myPosts.length === 2 && before.likes === 12 && before.likedByMe === false, JSON.stringify([S().feed.length, S().profiles, S().myPosts.length]));
let settled = false;
const p = S().likeToggle(hex('3')).then(() => { settled = true; });
check('likeToggle: 서버 답 전에 먼저 바뀐다 (피드·프로필 둘 다)', !settled && S().feed.find(i => i.post.id === hex('3')).post.likedByMe === true && S().feed.find(i => i.post.id === hex('3')).post.likes === 13 && S().profiles.guest1.posts[0].likedByMe === true, JSON.stringify(S().feed.find(i => i.post.id === hex('3')).post));
await p;
check('…서버가 준 수가 진실 (100)', S().feed.find(i => i.post.id === hex('3')).post.likes === 100 && S().feed.find(i => i.post.id === hex('3')).post.likedByMe === true && S().profiles.guest1.posts[0].likes === 100 && server.likes[hex('3')] === true, JSON.stringify(S().feed.find(i => i.post.id === hex('3')).post));
await S().likeToggle(hex('3'));
check('한 번 더 누르면 끈다 (DELETE, 99)', S().feed.find(i => i.post.id === hex('3')).post.likedByMe === false && S().feed.find(i => i.post.id === hex('3')).post.likes === 99 && server.likes[hex('3')] === false, '');
server.likeFail = true;
const p2 = S().likeToggle(hex('4'));
const mid = S().feed.find(i => i.post.id === hex('4')).post;
await p2;
const after = S().feed.find(i => i.post.id === hex('4')).post;
check('likeToggle: 실패하면 누르기 전으로 되돌린다 (7·true → 6·false → 7·true)', mid.likes === 6 && mid.likedByMe === false && after.likes === 7 && after.likedByMe === true, JSON.stringify([mid, after]));
server.likeFail = false;
await S().likeToggle(hex('2'));
check('403인 글(비공개)도 되돌아온다', S().feed.find(i => i.post.id === hex('2')).post.likes === 0 && S().feed.find(i => i.post.id === hex('2')).post.likedByMe === false, '');
server.log = [];
const snapUnknown = JSON.stringify([S().feed, S().myPosts, S().profiles]);
await S().likeToggle(hex('0'));
check('모르는 글이면 아무 일도 없다 (fetch 없음, 상태 그대로)', server.log.length === 0 && JSON.stringify([S().feed, S().myPosts, S().profiles]) === snapUnknown, String(server.log.length));
// 연타: POST가 나간 채 DELETE가 나가고, DELETE의 답(99·false)이 먼저, POST의 답(100·true)이 늦게 온다 — 마지막 누름(끄기)의 답만 적는다
const find3 = () => S().feed.find(i => i.post.id === hex('3')).post;
server.likeDefer = [];
server.log = [];
const t1 = S().likeToggle(hex('3'));   // 99·false → 켜기 (POST)
const t2 = S().likeToggle(hex('3'));   // 낙관적 100·true → 끄기 (DELETE)
check('겹친 토글: 둘 다 먼저 화면에 (켜기 → 끄기), 요청은 POST·DELETE 순', find3().likedByMe === false && find3().likes === 99 && server.log.map(l => l.method).join() === 'POST,DELETE' && server.likeDefer.length === 2, JSON.stringify([find3(), server.log.map(l => l.method)]));
server.likeDefer[1]();   // DELETE의 답이 먼저
await t2;
server.likeDefer[0]();   // POST의 답이 늦게
await t1;
server.likeDefer = null;
check('…답이 뒤바뀌어 와도 마지막 누름의 답(99·false)이 남는다 — 먼저 간 켜기의 답(100·true)은 버린다', find3().likedByMe === false && find3().likes === 99 && S().profiles.guest1.posts[0].likedByMe === false, JSON.stringify(find3()));
// 연타 중 마지막 것이 거절되면 그 누름 전으로 (먼저 간 것의 답은 여전히 버린다)
server.likeDefer = [];
const t3 = S().likeToggle(hex('3'));   // 켜기 (POST) → 100·true
server.likeFail = true;
const t4 = S().likeToggle(hex('3'));   // 끄기 (DELETE) → 500
server.likeFail = false;
server.likeDefer[0]();
await t3;
await t4;
server.likeDefer = null;
check('…마지막 누름이 거절되면 그 누름 전(켜진 채)으로 되돌린다', find3().likedByMe === true && find3().likes === 100, JSON.stringify(find3()));
await S().likeToggle(hex('3'));   // 끄기 — 뒤의 검사가 기대하는 99·false로
check('…그 뒤 한 번 누르면 평소처럼 답을 적는다', find3().likedByMe === false && find3().likes === 99, JSON.stringify(find3()));

console.log('\n── useSns: 내 글·프로필·고치기·지우기 ──');
check('loadMyPosts: 첫 장 내 글 2개, next 보관', S().myPosts.length === 2 && S().myPosts[0].id === hex('6') && S().myNext === 'm:1' && !S().myLoading, JSON.stringify(S().myPosts.map(x => x.id)));
server.log = [];
await S().loadMyPosts(true);
check('loadMyPosts(more): next를 cursor로 다음 장을 잇고 끝', last().url.endsWith('/api/me/posts?limit=20&cursor=m%3A1') && S().myPosts.map(x => x.id).join() === [hex('6'), hex('7'), hex('8')].join() && S().myNext === null && !S().myLoading, JSON.stringify([last().url, S().myPosts.map(x => x.id)]));
server.log = [];
await S().loadMyPosts(true);
check('loadMyPosts(more): 끝났으면 다시 묻지 않는다', server.log.length === 0 && S().myPosts.length === 3, String(server.log.length));
await S().loadMyPosts();
check('loadMyPosts(): 처음부터 다시 (첫 장으로)', S().myPosts.length === 2 && S().myNext === 'm:1', JSON.stringify(S().myPosts.map(x => x.id)));
await S().loadUserPosts('guest1', true);
check('loadUserPosts(more): 다음 장을 잇고 끝', S().profiles.guest1.posts.map(x => x.id).join() === [hex('3'), hex('5')].join() && S().profiles.guest1.next === null && !S().profiles.guest1.loading && !S().profiles.guest1.failed, JSON.stringify(S().profiles.guest1));
await S().loadUserPosts('guest3');
check('loadUserPosts: 403이면 failed (글은 빈 채)', S().profiles.guest3?.failed === true && S().profiles.guest3.posts.length === 0 && !S().profiles.guest3.loading && /not allowed/.test(posts.lastError), JSON.stringify(S().profiles.guest3));
const edited = await S().editPost(hex('6'), { caption: '주인이 고침' });
check('editPost: PATCH 뒤 내 글에서 바꿔 끼운다', edited?.caption === '주인이 고침' && S().myPosts.find(x => x.id === hex('6')).caption === '주인이 고침' && S().myPosts.find(x => x.id === hex('6')).editedByOwner === true, JSON.stringify(S().myPosts[0]));
check('editPost: 남의 글이면 null, 로컬은 그대로', (await S().editPost(hex('1'), { caption: 'x' })) === null && S().feed.find(i => i.post.id === hex('1')).post.caption === '카페에서 그림', '');
// P_R1(3)은 피드와 guest1 프로필 양쪽에 있다 — 지우면 둘 다에서 빠진다 (서버 fake는 1번만 403)
useSns.setState({ myPosts: [...S().myPosts, P_R1] });
check('removePost: 지우면 피드·내 글·프로필 어디서든 빠진다', (await S().removePost(hex('3'))) === true && !S().feed.some(i => i.post.id === hex('3')) && !S().myPosts.some(x => x.id === hex('3')) && !S().profiles.guest1.posts.some(x => x.id === hex('3')) && S().feed.length === 3 && S().profiles.guest1.posts.length === 1, JSON.stringify([S().feed.map(i => i.post.id), S().profiles.guest1.posts.map(x => x.id)]));
check('removePost: 403이면 false, 로컬은 그대로', (await S().removePost(hex('1'))) === false && S().feed.some(i => i.post.id === hex('1')), '');
const pub = await S().publishPost({ cuts: [cut('c')], caption: '새 글', place: 'p', area: 'a', city: 'seoul', dateKey: '2026-09-11' });
check('publishPost: 되면 내 글 맨 앞에', pub?.id === hex('9') && S().myPosts[0].id === hex('9') && S().myPosts[0].caption === '새 글', JSON.stringify(S().myPosts.map(x => x.id)));
S().setSnsOpen(true); S().setSnsTab('mine'); S().setProfileOpen('hojun'); S().setComposeOpen(true);
check('UI 플래그 setter', S().snsOpen && S().snsTab === 'mine' && S().profileOpen === 'hojun' && S().composeOpen, JSON.stringify([S().snsOpen, S().snsTab, S().profileOpen, S().composeOpen]));

console.log(`\n${n - fails.length}/${n} checks passed${fails.length ? '\nFAILED: ' + fails.join('; ') : ''}`);
process.exit(fails.length ? 1 : 0);
