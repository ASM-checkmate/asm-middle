// SNS 화면의 순수 계산 (screens/sns/util.ts · SNS_SPEC §4·§5·§7) — 피드 합치기·구분선, 상대 시각(캐릭터 시간대), 조사, 컷 뽑기, 대표컷, 순서 바꾸기.
// Usage: node scripts/sns-util.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const MIN = 60_000;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { mergeFeed, relTime, withParticle, withSubject, companionsLine, actKeyOfComic, cutOfPanel, comicOfCut, relationOf, repShotOf, moveCut, hex32, isUserId } = await import('../src/screens/sns/util.ts');

const hex = c => c.repeat(32);
const post = (id, createdAt, authorId = 'a') => ({ id: hex(id), authorId, createdAt, cuts: [{ shotId: hex(id), actKey: 'k', win: 0, by: 'user' }], caption: '', place: 'p', area: 'a', city: 'seoul', dateKey: '2026-09-11', companions: [], editedByOwner: false, likes: 0, likedByMe: false });
const author = { id: 'a', name: '가', homePlaceId: 'home', color: '#000', emoji: '🐥', likes: [], traits: [], home: {} };
const item = (id, at, why) => ({ post: post(id, at), author, ...(why ? { why } : {}) });

console.log('\n── 피드 합치기 (§4 한 줄기) ──');
{
  const server = [item('1', 100), item('2', 300), item('5', 50, '요즘 인기'), item('6', 900, '연남동 이웃')];
  const local = [item('3', 200), item('4', 400), item('2', 300)];   // 2는 서버와 겹친다
  const { items, dividerAt } = mergeFeed(server, local);
  check('친구 글은 createdAt 내림차순, 중복 없음', items.slice(0, 4).map(i => i.post.id[0]).join('') === '4231', items.map(i => i.post.id[0]).join(''));
  check('구분선은 첫 추천 앞', dividerAt === 4, String(dividerAt));
  check('추천은 서버 순서 그대로 (시간 무시)', items.slice(4).map(i => i.post.id[0]).join('') === '56', items.map(i => i.post.id[0]).join(''));
  check('추천이 없으면 구분선 없음', mergeFeed([item('1', 1)], []).dividerAt === -1);
  check('서버가 비어도 로컬 글은 산다', mergeFeed([], local).items.length === 3);
}

console.log('\n── 상대 시각 (캐릭터 시간대) ──');
{
  const tz = 'Asia/Seoul';
  const now = KST(2026, 9, 11, 14, 30);
  check('방금', relTime(now - 20_000, now, tz) === '방금');
  check('n분 전', relTime(now - 7 * MIN, now, tz) === '7분 전');
  check('같은 날은 n시간 전', relTime(now - 3 * 60 * MIN, now, tz) === '3시간 전');
  check('날짜가 넘어가면 어제', relTime(KST(2026, 9, 10, 23, 50), now, tz) === '어제', relTime(KST(2026, 9, 10, 23, 50), now, tz));
  check('그 전은 M월 D일', relTime(KST(2026, 9, 3, 9), now, tz) === '9월 3일', relTime(KST(2026, 9, 3, 9), now, tz));
  // 뉴욕 시간대: 같은 순간이 뉴욕에선 아직 어제일 수 있다
  const ny = 'America/New_York';
  const nowNy = Date.UTC(2026, 8, 11, 2, 0);   // 뉴욕 9/10 22:00
  check('시간대가 다르면 날짜 경계도 다르다', relTime(Date.UTC(2026, 8, 10, 20, 0), nowNy, ny) === '6시간 전', relTime(Date.UTC(2026, 8, 10, 20, 0), nowNy, ny));
}

console.log('\n── 조사·동행 줄 ──');
{
  check('받침 있음 → 과', withParticle('윤관') === '윤관과');
  check('받침 없음 → 와', withParticle('하나') === '하나와');
  check('한글 아님 → 과', withParticle('Tom') === 'Tom과');
  check('주격: 받침 없음 → 가', withSubject('하나') === '하나가');
  check('주격: 받침 있음 → 이', withSubject('윤관') === '윤관이');
  const nameOf = id => ({ hana: '하나', minsu: '민수' })[id] ?? null;
  check('동행 줄', companionsLine(['hana'], nameOf) === '하나와 함께', companionsLine(['hana'], nameOf));
  check('여럿', companionsLine(['hana', 'minsu'], nameOf) === '하나, 민수와 함께', companionsLine(['hana', 'minsu'], nameOf));
  check('모르는 id는 뺀다', companionsLine(['ghost'], nameOf) === '');
}

console.log('\n── 컷 뽑기 (책 → 글) ──');
{
  const comic = { id: 'c:2026-09-11@Asia/Seoul:am', panels: [{ shotId: hex('a'), by: 'user' }, { shotId: hex('b') }, {}, { shotId: hex('d'), by: 'agent' }], placeName: 'p' };
  check('actKey는 c: 뒤', actKeyOfComic(comic.id) === '2026-09-11@Asia/Seoul:am');
  check('프리뷰 만화 id도 그대로', actKeyOfComic('c:k:0') === 'k:0');
  const c0 = cutOfPanel(comic, 0);
  check('사용자 컷', c0 && c0.win === 0 && c0.by === 'user' && c0.shotId === hex('a'));
  check('by 없으면 agent', cutOfPanel(comic, 1)?.by === 'agent');
  check('shotId 없으면 못 싣는다', cutOfPanel(comic, 2) === null);
  check('범위 밖', cutOfPanel(comic, 4) === null);
  check('첫 컷의 만화를 되찾는다', comicOfCut([comic], c0) === comic);
  check('id로도 되찾는다', comicOfCut([comic], { shotId: hex('f'), actKey: '2026-09-11@Asia/Seoul:am', win: 0, by: 'user' }) === comic);
  check('컷이 없으면 null', comicOfCut([comic], undefined) === null);
}

console.log('\n── 관계·대표컷·순서 ──');
{
  check('bond 없음 → SNS 친구', relationOf({}) === 'SNS 친구');
  check('bond 3 → 친한 친구', relationOf({ bond: 3 }) === '친한 친구');
  check('친구 아님 → 스친 사이', relationOf(null) === '스친 사이');
  check('핀이 먼저', repShotOf(hex('9'), [post('1', 5)]) === hex('9'));
  check('핀 없으면 최근 글 첫 컷', repShotOf(undefined, [post('1', 5), post('2', 9)]) === hex('2'));
  check('글 없으면 null (이름만)', repShotOf(undefined, []) === null);
  check('앞으로', moveCut(['a', 'b', 'c'], 1, -1).join('') === 'bac');
  check('뒤로', moveCut(['a', 'b', 'c'], 1, 1).join('') === 'acb');
  check('끝이면 그대로', moveCut(['a', 'b', 'c'], 2, 1).join('') === 'abc');
  check('hex32는 32자 hex', /^[0-9a-f]{32}$/.test(hex32('x')));
  check('같은 시드 → 같은 id', hex32('x') === hex32('x') && hex32('x') !== hex32('y'));
  check('userId 판별', isUserId(hex32('x')) && !isUserId('minsu'));
}

console.log(`\n${n - fails.length}/${n} passed${fails.length ? ' — FAILED: ' + fails.join(', ') : ''}`);
process.exit(fails.length ? 1 : 0);
