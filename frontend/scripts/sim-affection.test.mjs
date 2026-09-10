// 설렘 harness (AFFECTION_SPEC §1~§5, ADR-0023 — sim/affection.ts · agents.ts castAt · store.ts settle/decay/decide/agentAutoLike · chat.ts · llm.ts):
// 띠의 문턱이 한 곳에서 같게 나오는지, 이성에게만 생기는지, 재료(마주침·동행·취향·연속 실패·좋아요·감쇠)의 크기와 바닥, 활동 정산이 결정적으로 올리는지,
// 날이 바뀌면 식는지, 채팅 프롬프트에 단계가 실리고 규칙 답장은 이름 없이 얼버무리는지, 먼저 좋아요는 글마다 한 번·하루 셋이고 주인의 기록에 안 적히는지,
// 계획 카드 셋째가 그 사람이 가는 곳이 되는지(설렘 없으면 그대로), 같은 공간의 설렘 대상이 돌아본 모습(glance)으로 그려지는지.
// Usage: node scripts/sim-affection.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const MIN = 60_000, DAY = 86_400_000;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 8, 50);
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ── 가짜 서버: 피드와 좋아요만 (그 외는 404 — 스토어의 다른 요청은 조용히 실패한다) ─────────────────────────
const ME = 'tester';
const hex = (c, len = 32) => c.repeat(len);
const homeOf = (id, name) => ({ id: `home:${id}`, name: `${name}네 집`, type: 'friend_home', lng: 126.93, lat: 37.56, area: '연희동', city: 'seoul', country: 'KR', emoji: '🏡', ownerFriendId: id });
const agentOf = (id, name, extra = {}) => ({ id, name, homePlaceId: `home:${id}`, color: '#F6C445', emoji: '🐨', likes: ['카페'], traits: ['외향적'], home: homeOf(id, name), visibility: 'public', ...extra });
const cut = c => ({ shotId: hex(c), actKey: '2026-09-08@Asia/Seoul:am', win: 0, by: 'user' });
const postOf = (id, authorId, extra = {}) => ({
  id, authorId, createdAt: 1_700_000_000_000, cuts: [cut('a')], caption: '카페', place: '카페', area: '연남동', city: 'seoul', dateKey: '2026-09-08', companions: [], editedByOwner: false, likes: 1, likedByMe: false, ...extra,
});
const BOY = agentOf('guest2', '손님2', { gender: 'male' });
const OTHER = agentOf('guest1', '손님1', { gender: 'male' });
const server = { log: [], feed: [] };
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  server.log.push({ method, url });
  const path = new URL(url, 'http://x').pathname;
  if (/^\/api\/posts\/[a-f0-9]+\/like$/.test(path)) return json(200, { likes: 2, likedByMe: method === 'POST' });
  if (path === '/api/feed') return server.down ? json(503, { error: 'down' }) : json(200, { items: server.feed, next: null });
  return json(404, { error: 'not found' });
};
storage.set('theworld.user.v1', JSON.stringify({ userId: ME, name: '테스터' }));

const aff = await import('../src/sim/affection.ts');
const { crushStage, crushTarget, topCrush, likesOrMore, eligible, chanceEncounter, plannedTogether, tasteBonus, likedMyPost, decay, decayAll, crushAfterActivity,
  pickAutoLikes, validAgentLikes, emptyAgentLikes, CRUSH_INTEREST_MIN, CRUSH_LIKE_MIN, CRUSH_LOVE_MIN, CRUSH_ASK, CRUSH_CHANCE, CRUSH_PLANNED, CRUSH_TASTE_CAP, CRUSH_LIKED, CRUSH_DECAY_PER_DAY, AGENT_LIKES_PER_DAY, AGENT_LIKES_CAP } = aff;
const { AGENTS, agentById, agentActivityAt, agentsAt, castAt, comicCastOf, castOfComic, friendOf } = await import('../src/sim/agents.ts');
const { friendOfRemote } = await import('../src/sim/remote.ts');
const { shotCastOf } = await import('../src/screens/util.ts');
const { placeById } = await import('../src/sim/places.ts');
const { blockStartAt } = await import('../src/sim/blocks.ts');
const { dayStartOfKey } = await import('../src/sim/tz.ts');
const { INITIAL_STATUS } = await import('../src/sim/status.ts');
const { replyToAll, EVASIVE, CRUSH_ASK_RE, crushAsked } = await import('../src/sim/chat.ts');
const { requestOf } = await import('../src/sim/llm.ts');

const f = (id, v, extra = {}) => ({ id, name: id, homePlaceId: 'h', color: '#000', emoji: '·', ...(v === undefined ? {} : { crush: { v, at: 0 } }), ...extra });
const mem = (friends, extra = {}) => ({ name: '모모', likes: ['카페', '책'], dislikes: [], traits: [], homePlaceId: 'home', friends, visited: [], ...extra });

console.log('\n── crushStage ──');
check('문턱: 0.2 / 0.5 / 0.8 (CRUSH_ASK = 좋아함)', CRUSH_INTEREST_MIN === 0.2 && CRUSH_LIKE_MIN === 0.5 && CRUSH_LOVE_MIN === 0.8 && CRUSH_ASK === 0.5, '');
check('없음: undefined·0·0.19', crushStage(undefined) === null && crushStage(0) === null && crushStage(0.19) === null, '');
check('관심: 0.2 ≤ v < 0.5', crushStage(0.2) === 'interest' && crushStage(0.49) === 'interest', '');
check('좋아함: 0.5 ≤ v < 0.8', crushStage(0.5) === 'like' && crushStage(0.79) === 'like', '');
check('많이 좋아함: v ≥ 0.8', crushStage(0.8) === 'love' && crushStage(1) === 'love', '');
check('NaN은 없음', crushStage(Number.NaN) === null, '');
check('likesOrMore: 0.5부터 (SNS §9 고민 줄 · §4 계획 훅)', !likesOrMore(0.49) && likesOrMore(0.5) && !likesOrMore(undefined), '');

console.log('\n── eligible (§2 이성만) ──');
check('둘 다 있고 다르면 된다', eligible({ gender: 'female' }, { gender: 'male' }) && eligible({ gender: 'male' }, { gender: 'female' }), '');
check('같은 성별은 안 된다', !eligible({ gender: 'female' }, { gender: 'female' }) && !eligible({ gender: 'male' }, { gender: 'male' }), '');
check('한쪽이라도 모르면 안 된다 (추정하지 않는다)', !eligible({}, { gender: 'male' }) && !eligible({ gender: 'female' }, {}) && !eligible({}, {}), '');
check('NPC 풀: 성별이 전부 있고 양쪽이 섞여 있다, id·순서는 그대로', AGENTS.every(a => a.gender === 'female' || a.gender === 'male') && AGENTS.some(a => a.gender === 'female') && AGENTS.some(a => a.gender === 'male') && AGENTS.map(a => a.id).join() === 'minsu,hana,jiwoo,taerin,doyun,serin,hyeon,bomi', JSON.stringify(AGENTS.map(a => [a.id, a.gender])));
check('friendOf가 성별을 복사한다 (met 있든 없든)', friendOf(agentById('hana')).gender === 'female' && friendOf(agentById('minsu'), { at: 1, placeId: 'p' }).gender === 'male' && friendOf(agentById('minsu'), { at: 1, placeId: 'p' }).metAt === 1, JSON.stringify(friendOf(agentById('hana'))));
check('friendOf: 성별 모르는 에이전트면 gender 키가 없다', !('gender' in friendOf({ id: 'x', name: 'x', homePlaceId: 'h', color: '#000', emoji: '·', likes: [], traits: [] })), '');
check('friendOfRemote가 서버 프로필의 성별을 복사한다', friendOfRemote({ ...BOY }, 5, 'p').gender === 'male' && !('gender' in friendOfRemote({ ...OTHER, gender: undefined }, null, null)), JSON.stringify(friendOfRemote(BOY, 5, 'p')));

console.log('\n── 사건 (§3) ──');
const c0 = chanceEncounter(undefined, 100);
check('우연한 마주침 +0.12, at 갱신 (v·at뿐 — 실패 수 같은 건 없다)', near(c0.v, CRUSH_CHANCE) && c0.at === 100 && Object.keys(c0).join() === 'v,at', JSON.stringify(c0));
check('마주침은 말을 텄든 보기만 했든 같은 크기 — 한 번 만나선 관심(0.2)이 안 된다', CRUSH_CHANCE < CRUSH_INTEREST_MIN && crushStage(chanceEncounter(undefined, 1).v) === null, '');
check('계획된 동행 +0.06 — 마주침의 절반 (§3 "2배" 그대로, 그 이상은 아니다)', near(plannedTogether(undefined, 1).v, CRUSH_PLANNED) && CRUSH_CHANCE === 2 * CRUSH_PLANNED, '');
check('취향 근접: 같은 likes 하나당 +0.02, 최대 +0.06', near(tasteBonus(1), 0.02) && near(tasteBonus(3), CRUSH_TASTE_CAP) && near(tasteBonus(9), CRUSH_TASTE_CAP) && tasteBonus(0) === 0, '');
check('취향 근접은 마주침·동행에 얹힌다', near(chanceEncounter(undefined, 1, 2).v, 0.16) && near(plannedTogether(undefined, 1, 5).v, 0.12), '');
check('쌓인다: 0.12 → 0.24 → 0.30', near(plannedTogether(chanceEncounter(chanceEncounter(undefined, 1), 2), 3).v, 0.30), '');
check('1을 넘지 않는다', chanceEncounter({ v: 0.95, at: 0 }, 1).v === 1, '');
check('상대의 좋아요 +0.04 (아직 부르는 곳 없음 — 훅만)', near(likedMyPost({ v: 0.1, at: 0 }, 7).v, 0.1 + CRUSH_LIKED), '');
check('상수는 스펙 그대로', CRUSH_DECAY_PER_DAY === 0.03 && CRUSH_LIKED === 0.04, '');
check('연속 실패 재료는 없다 (1차 — 친구는 굴리지 않으니 재료가 없다, ADR-0023 미룬 것)', !('failedTalk' in aff) && !('CRUSH_FAIL' in aff) && !('CRUSH_CHANCE_TALKED' in aff), '');

console.log('\n── 감쇠 (§3 2주 넘게 안 봄) ──');
const c14 = { v: 0.6, at: 0 };
check('14일까지는 그대로 (같은 객체)', decay(c14, 14 * DAY) === c14 && decay(c14, 14 * DAY + DAY - 1) === c14, '');
check('15일째 −0.03, 20일째 −0.18', near(decay(c14, 15 * DAY).v, 0.57) && near(decay(c14, 20 * DAY).v, 0.42), JSON.stringify([decay(c14, 15 * DAY), decay(c14, 20 * DAY)]));
check('소비한 날만큼 at이 옮겨져 두 번 적용해도 겹쳐 깎이지 않는다 (멱등)', (() => { const a = decay(c14, 20 * DAY); const b = decay(a, 20 * DAY); return b === a && a.at === 6 * DAY; })(), JSON.stringify(decay(c14, 20 * DAY)));
check('하루씩 굴려도 한 번에 굴려도 같다', (() => { let c = c14; for (let d = 1; d <= 30; d++) c = decay(c, d * DAY); return near(c.v, decay(c14, 30 * DAY).v); })(), '');
check('관심(0.2)에 닿은 마음은 그 아래로 안 떨어진다', decay({ v: 0.25, at: 0 }, 100 * DAY).v === CRUSH_INTEREST_MIN && decay({ v: 0.2, at: 0 }, 100 * DAY).v === CRUSH_INTEREST_MIN, JSON.stringify(decay({ v: 0.25, at: 0 }, 100 * DAY)));
check('관심 아래였으면 0까지', decay({ v: 0.15, at: 0 }, 100 * DAY).v === 0, '');
const dm = mem([f('a', 0.6), f('b'), f('c', 0.3)]);
dm.friends[0].crush.at = 0; dm.friends[2].crush.at = 10 * DAY;
const dm2 = decayAll(dm, 20 * DAY);
check('decayAll: 지난 사람만 깎이고 나머지 항목은 같은 객체', near(dm2.friends[0].crush.v, 0.42) && dm2.friends[1] === dm.friends[1] && dm2.friends[2] === dm.friends[2], JSON.stringify(dm2.friends));
check('decayAll: 깎을 게 없으면 같은 memory', decayAll(dm, 5 * DAY) === dm, '');

console.log('\n── crushTarget · topCrush ──');
check('아무도 없으면 null', crushTarget(mem([f('a'), f('b', 0.1)])) === null && topCrush(mem([f('a')])) === null, '');
check('v가 가장 큰 사람', crushTarget(mem([f('a', 0.3), f('b', 0.9), f('c', 0.6)]))?.friend.id === 'b', '');
check('단계도 같이', crushTarget(mem([f('a', 0.3), f('b', 0.9)]))?.stage === 'love' && crushTarget(mem([f('a', 0.3)]))?.stage === 'interest', '');
check('같으면 id 오름차순 (결정적)', crushTarget(mem([f('z', 0.6), f('b', 0.6), f('m', 0.6)]))?.friend.id === 'b', '');
check('min 단계: like면 관심만 있는 사람은 안 본다', crushTarget(mem([f('a', 0.3)]), 'like') === null && crushTarget(mem([f('a', 0.3), f('b', 0.5)]), 'like')?.friend.id === 'b', '');
check('min love', crushTarget(mem([f('a', 0.79)]), 'love') === null && crushTarget(mem([f('a', 0.8)]), 'love')?.stage === 'love', '');
check('입력 순서를 바꾸지 않는다', (() => { const xs = [f('z', 0.6), f('b', 0.6)]; crushTarget(mem(xs)); return xs[0].id === 'z'; })(), '');
check('topCrush: id·이름·단계 (숫자는 없다)', JSON.stringify(topCrush(mem([f('a', 0.3), { ...f('b', 0.55), name: '하늘' }]))) === JSON.stringify({ id: 'b', name: '하늘', stage: 'like' }), JSON.stringify(topCrush(mem([f('b', 0.55)]))));

console.log('\n── crushAfterActivity (활동 정산) ──');
const boy = { id: 'boy', name: '남', homePlaceId: 'h', color: '#000', emoji: '·', gender: 'male' };
const girl = { id: 'girl', name: '여', homePlaceId: 'h', color: '#000', emoji: '·', gender: 'female' };
const noGender = { id: 'who', name: '?', homePlaceId: 'h', color: '#000', emoji: '·' };
const others = { boy: { gender: 'male', likes: ['책', '산책'] }, girl: { gender: 'female', likes: ['책'] }, who: { gender: 'male', likes: [] } };
const otherOf = id => others[id] ?? null;
const me = mem([boy, girl, noGender], { gender: 'female' });
const act = (o = {}) => ({ companions: [], presentNearby: [], endAt: 500, ...o });
const r1 = crushAfterActivity(me, act({ companions: ['boy', 'girl'] }), otherOf);
check('동행: 이성만 +0.06 + 취향(책 1개 = +0.02), 동성은 그대로, at = 활동 끝', near(r1.friends[0].crush.v, 0.08) && r1.friends[0].crush.at === 500 && r1.friends[1] === me.friends[1], JSON.stringify(r1.friends));
check('말을 튼 마주침: +0.12 + 취향', near(crushAfterActivity(me, act({ encounter: { agentId: 'boy', talked: true }, presentNearby: ['boy'] }), otherOf).friends[0].crush.v, 0.14), '');
const seen1 = crushAfterActivity(me, act({ encounter: { agentId: 'boy', talked: false }, presentNearby: ['boy'] }), otherOf);
const seen2 = crushAfterActivity(seen1, act({ encounter: { agentId: 'boy', talked: false }, presentNearby: ['boy'], endAt: 600 }), otherOf);
check('말 못 튼 마주침도 같은 크기 (+0.14) — 정산이 talked에 안 매인다', near(seen1.friends[0].crush.v, 0.14) && near(seen2.friends[0].crush.v, 0.28) && seen2.friends[0].crush.at === 600, JSON.stringify([seen1.friends[0].crush, seen2.friends[0].crush]));
check('같은 공간에 있기만 한 친구: 우연한 마주침 (+0.12 + 취향)', near(crushAfterActivity(me, act({ presentNearby: ['boy'] }), otherOf).friends[0].crush.v, 0.14), '');
check('같은 공간에 있었지만 친구가 아닌 사람: 아무 일 없음 (friends에 없다)', crushAfterActivity(me, act({ presentNearby: ['stranger'] }), otherOf) === me, '');
check('내 성별을 모르면 아무 일 없음 (같은 memory); 아무 사건도 없어도 같은 memory', (() => { const m0 = mem([boy]); return crushAfterActivity(m0, act({ companions: ['boy'] }), otherOf) === m0 && crushAfterActivity(me, act(), otherOf) === me; })(), '');
check('친구 칸에 성별이 없으면 풀·프로필의 성별로 (옛 저장본)', near(crushAfterActivity(me, act({ companions: ['who'] }), otherOf).friends[2].crush.v, 0.06), '');
check('풀에도 없고 친구 칸에도 없으면 아무 일 없음', crushAfterActivity(me, act({ companions: ['who'] }), () => null) === me, '');
check('동성 친구는 몇 번을 만나도 crush가 안 생긴다', !crushAfterActivity(me, act({ encounter: { agentId: 'girl', talked: true }, presentNearby: ['girl'] }), otherOf).friends[1].crush, '');

console.log('\n── castAt: 같은 공간의 설렘 대상은 돌아본 모습 ──');
const cafe = placeById('layered-yeonnam');
const fakeAct = { key: 'k', dayKey: '2026-09-08@Asia/Seoul', place: cafe, arriveAt: 1_000_000, endAt: 1_000_000 + 100 * MIN, companions: [], presentNearby: ['hana', 'jiwoo'], option: { id: 'o', title: '카페', reason: '', emoji: '☕', placeId: cafe.id, category: 'play' } };
const memGlance = mem([{ ...friendOf(agentById('jiwoo')), crush: { v: 0.3, at: 0 } }], { gender: 'female' });
const ca = castAt(fakeAct, fakeAct.arriveAt, memGlance);
check('관심 이상인 사람만 glance, 나머지는 뒷모습 그대로 (glance 키 없음)', ca.present.find(p => p.id === 'jiwoo')?.glance === true && !('glance' in ca.present.find(p => p.id === 'hana')), JSON.stringify(ca.present));
check('관심 아래(0.1)면 glance 없음', !('glance' in castAt(fakeAct, fakeAct.arriveAt, mem([{ ...friendOf(agentById('jiwoo')), crush: { v: 0.1, at: 0 } }])).present.find(p => p.id === 'jiwoo')), '');
check('친구가 아니면 glance 없음', !castAt(fakeAct, fakeAct.arriveAt, mem([])).present.some(p => p.glance), '');
const cc = comicCastOf(fakeAct, memGlance);
check('comicCastOf도 같은 규칙 — 만화가 찍힐 때의 마음을 기억한다', cc.present.find(p => p.id === 'jiwoo')?.glance === true && !cc.present.find(p => p.id === 'hana').glance, JSON.stringify(cc));
check('castOfComic은 기억한 glance를 그대로 넘긴다', castOfComic(cc, fakeAct.arriveAt).present.find(p => p.id === 'jiwoo')?.glance === true, '');
const sc = shotCastOf(ca);
check('shotCastOf → 무대 props에 glance가 실린다 (없는 사람은 키 없음)', sc.present.some(p => p.glance === true) && sc.present.some(p => !('glance' in p)), JSON.stringify(sc));
check('말을 튼 뒤(met)는 정면 — glance는 배경 인물에만', (() => { const c = castAt({ ...fakeAct, encounter: { agentId: 'jiwoo', talked: true, at: fakeAct.arriveAt } }, fakeAct.arriveAt, memGlance); return c.met?.agent.id === 'jiwoo' && !('glance' in c.met) && !c.present.some(p => p.id === 'jiwoo'); })(), '');

console.log('\n── 채팅: 프롬프트에 단계, 규칙 답장은 얼버무림 ──');
const waiting = { kind: 'waiting', at: placeById('home'), currentBlockId: 'pm', nextBlockId: 'evening', nextStartAt: null, tz: 'Asia/Seoul', jetlag: false, companions: [] };
const memCrush = mem([{ ...f('sky', 0.55), name: '하늘' }, f('a', 0.3)], { gender: 'female' });
const req = requestOf(['뭐 해'], { phase: waiting, status: INITIAL_STATUS, memory: memCrush, messages: [], now: T0 }, 'small', 'b1');
check('requestOf: situation.crush = { name, stage } — 숫자 없음', JSON.stringify(req.situation.crush) === JSON.stringify({ name: '하늘', stage: 'like' }), JSON.stringify(req.situation));
check('requestOf: 관심 아래·없음이면 null', requestOf(['뭐 해'], { phase: waiting, status: INITIAL_STATUS, memory: mem([f('a', 0.1)]), now: T0, messages: [] }, 'small', 'b1').situation.crush === null, '');
check('requestOf: 관심(0.3)이면 interest', requestOf(['뭐 해'], { phase: waiting, status: INITIAL_STATUS, memory: mem([f('a', 0.3)]), now: T0, messages: [] }, 'small', 'b1').situation.crush?.stage === 'interest', '');
const ctx = (crush, seed = 'k') => ({ phase: waiting, status: INITIAL_STATUS, name: '모모', seed, crush });
const asks = ['너 하늘이 좋아해?', '좋아하는 사람 있어?', '짝사랑 중이야?', '요즘 누구 생각해?', '썸 타?', '누구 좋아해?', '너 하늘이가 좋아?', '걔 좋아해?'];
check('사람을 묻는 꼴을 다 잡는다 — 이름은 crushAsked가 설렘 대상의 이름꼴로', asks.every(t => crushAsked(t, '하늘')), JSON.stringify(asks.filter(t => !crushAsked(t, '하늘'))));
const notAsks = ['커피 좋아해?', '나 너 좋아해', '떡볶이 좋아해?', '이 노래 좋아해', '썸머 타임', '나 좋아해?', '하늘 보러 갈래?'];
check('사물·나·너를 묻는 좋아해는 마음 물음이 아니다 (love 그대로)', notAsks.every(t => !crushAsked(t, '하늘') && !CRUSH_ASK_RE.test(t)), JSON.stringify(notAsks.filter(t => crushAsked(t, '하늘'))));
check('받침 없는 이름은 이름 그대로 ("유리 좋아해?"), 정규식 문자는 이스케이프', crushAsked('너 유리 좋아해?', '유리') && crushAsked('유리를 좋아해', '유리') && !crushAsked('커피 좋아해?', 'A.B'), '');
check('설렘이 있어도 "커피 좋아해?"·"나 너 좋아해"는 얼버무리지 않는다', notAsks.slice(0, 4).every(t => !EVASIVE.includes(replyToAll([t], ctx({ name: '하늘' })).text)), JSON.stringify(notAsks.slice(0, 4).map(t => replyToAll([t], ctx({ name: '하늘' })).text)));
const evasive = asks.map((t, i) => replyToAll([t], ctx({ name: '하늘' }, `s${i}`)));
check('설렘이 있으면 얼버무리는 네 마디 중 하나 (시드로)', evasive.every(r => EVASIVE.includes(r.text)), JSON.stringify(evasive.map(r => r.text)));
check('이름은 절대 안 나온다', evasive.every(r => !r.text.includes('하늘')), '');
check('같은 시드면 같은 마디, 시드가 다르면 골고루', replyToAll(['너 하늘이 좋아해?'], ctx({ name: '하늘' }, 'x')).text === replyToAll(['너 하늘이 좋아해?'], ctx({ name: '하늘' }, 'x')).text && new Set(Array.from({ length: 20 }, (_, i) => replyToAll(['짝사랑 중이야?'], ctx({ name: '하늘' }, `q${i}`)).text)).size >= 3, '');
check('설렘이 없으면 평소대로 (좋아해 → love 답)', !EVASIVE.includes(replyToAll(['너 하늘이 좋아해?'], ctx(null)).text) && !EVASIVE.includes(replyToAll(['너 하늘이 좋아해?'], ctx(undefined)).text), replyToAll(['너 하늘이 좋아해?'], ctx(null)).text);
check('지쳤다는 말이 섞이면 전화 약속이 먼저', !!replyToAll(['지쳤어… 누구 생각나'], ctx({ name: '하늘' })).worry, '');
check('얼버무려도 읽고 답하는 시각은 규칙대로', evasive.every(r => r.readMs > 0 && r.delayMs > r.readMs), '');

console.log('\n── pickAutoLikes (순수) ──');
const likeMem = mem([f('boy', 0.6), f('meh', 0.3)]);
const items = ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => ({ id, authorId: 'boy', likedByMe: false }));
const pa = pickAutoLikes(likeMem, [{ id: 'x', authorId: 'meh', likedByMe: false }, { id: 'y', authorId: 'boy', likedByMe: true }, ...items], emptyAgentLikes(), 'D1');
check('좋아함 이상인 사람의 글만, 주인이 누른 글은 빼고, 하루 3개', pa.picked.join() === 'p1,p2,p3' && pa.state.count === 3 && pa.state.day === 'D1' && pa.state.ids.join() === 'p1,p2,p3', JSON.stringify(pa));
check('같은 날 다시 보면 더 안 누른다 (같은 state)', pickAutoLikes(likeMem, items, pa.state, 'D1').picked.length === 0 && pickAutoLikes(likeMem, items, pa.state, 'D1').state === pa.state, '');
const pb = pickAutoLikes(likeMem, items, pa.state, 'D2');
check('다음 날엔 남은 글 (글마다 한 번)', pb.picked.join() === 'p4,p5' && pb.state.count === 2 && pb.state.day === 'D2', JSON.stringify(pb));
check('설렘이 없으면 아무것도', pickAutoLikes(mem([f('boy', 0.4)]), items, emptyAgentLikes(), 'D1').picked.length === 0, '');
check('기록은 최근 100개', pickAutoLikes(likeMem, [{ id: 'new', authorId: 'boy', likedByMe: false }], { ids: Array.from({ length: AGENT_LIKES_CAP }, (_, i) => `o${i}`), day: 'D9', count: 0 }, 'D9').state.ids.length === AGENT_LIKES_CAP && AGENT_LIKES_PER_DAY === 3, '');
check('validAgentLikes: 틀린 모양은 빈 값', JSON.stringify(validAgentLikes(null)) === JSON.stringify(emptyAgentLikes()) && validAgentLikes({ ids: ['a', 3], day: 'x', count: 2.7 }).ids.join() === 'a' && validAgentLikes({ ids: ['a'], day: 'x', count: 2.7 }).count === 2, '');

// ── 스토어 ──────────────────────────────────────────────────────────────────────
console.log('\n── store: settle → crush ──');
freezeClockAt(T0);
const { useWorld } = await import('../src/sim/store.ts');
const { useSns } = await import('../src/sim/sns.ts');
const S = () => useWorld.getState();
S().tick();
const today = S().today;
const dayStart = dayStartOfKey(today);
S().setSnsProfile({ gender: 'female' });
check('내 성별을 골랐다', S().memory.gender === 'female', '');
const NPC = 'jiwoo';   // 남자, 아직 친구 아님
const planAt = (blockId, place, friendId) => {
  const opt = { id: `aff-${blockId}`, title: `${place.name}에서 시간 보내기`, reason: '검사용', emoji: place.emoji, placeId: place.id, category: 'play', ...(friendId ? { friendId } : {}) };
  const plans = { ...S().plans, [blockId]: { blockId, category: 'play', options: [opt], chosenId: opt.id, chosenBy: 'user', status: 'confirmed' } };
  useWorld.setState({ plans, days: { ...S().days, [today]: plans } });
};
planAt('am', cafe, NPC);
S().jumpTo(blockStartAt(dayStart, 'am') + 1000);
const am = S().timeline.find(a => a.dayKey === today && a.blockIds[0] === 'am');
check('오전 동행 활동 (companions = [지우])', !!am && am.companions.join() === NPC, JSON.stringify(am?.companions));
let jw = null;
if (am) {
  S().jumpTo(am.endAt + 2 * MIN); S().tick();
  jw = S().memory.friends.find(x => x.id === NPC);
  const shared = S().memory.likes.filter(l => agentById(NPC).likes.includes(l)).length;
  const want = plannedTogether(undefined, am.endAt, shared);
  check('동행이 끝나면 친구 + 설렘(계획된 동행 +0.06 + 취향), 성별 복사', !!jw && jw.gender === 'male' && jw.crush && near(jw.crush.v, want.v) && jw.crush.at === am.endAt, JSON.stringify([jw, want]));
  check('동성 친구(하나)는 crush 없음', !S().memory.friends.find(x => x.id === 'hana')?.crush, JSON.stringify(S().memory.friends.find(x => x.id === 'hana')));
  check('crush가 있는 친구는 전부 이성', S().memory.friends.filter(x => x.crush).every(x => (x.gender ?? agentById(x.id)?.gender) === 'male'), JSON.stringify(S().memory.friends));
  check('memory 문서에 저장된다', near(JSON.parse(storage.get('theworld.memory.v2') ?? '{}').friends?.find(x => x.id === NPC)?.crush?.v ?? -1, want.v), '');
  S().jumpTo(am.endAt + 3 * MIN); S().tick();
  check('같은 활동은 두 번 세지 않는다 (settle 멱등)', near(S().memory.friends.find(x => x.id === NPC).crush.v, want.v), '');

  // 우연한 마주침: 지우가 가는 곳에 (동행 없이) 가면 같은 공간 → 마주침이 크게 올린다. 마찰(문 닫음 등)로 딴 데 가는 블록은 건너뛴다
  const later = ['pm', 'evening', 'night'].map(b => [b, agentActivityAt(agentById(NPC), b, today)]).filter(([b, a]) => a && a.placeId !== agentById(NPC).homePlaceId && placeById(a.placeId).city === 'seoul' && blockStartAt(dayStart, b) > S().now);
  check('지우가 오늘 오후·저녁·밤에 서울 어딘가에 간다', later.length > 0, JSON.stringify(agentActivityAt(agentById(NPC), 'pm', today)));
  let hit = null;
  for (const [blockId, jact] of later) {
    planAt(blockId, placeById(jact.placeId));
    S().jumpTo(blockStartAt(dayStart, blockId) + 1000);
    const a2 = S().timeline.find(a => a.dayKey === today && a.blockIds[0] === blockId);
    const overlap = a2 && agentsAt(a2.place.id, a2.arriveAt, a2.endAt, [agentById(NPC)])[0]?.overlapMs;
    if (a2 && a2.place.id === jact.placeId && overlap >= 30 * MIN) { hit = { a2, overlap }; break; }
  }
  check('그 활동에 지우가 같은 공간에 있다 (presentNearby 또는 굴림 상대)', !!hit && (hit.a2.presentNearby.includes(NPC) || hit.a2.encounter?.agentId === NPC), JSON.stringify(hit && [hit.a2.presentNearby, hit.a2.encounter, hit.overlap]));
  if (hit) {
    const { a2 } = hit;
    const before = S().memory.friends.find(x => x.id === NPC).crush;
    {
      S().jumpTo(a2.endAt + 2 * MIN); S().tick();
      const after = S().memory.friends.find(x => x.id === NPC).crush;
      const e = a2.encounter;
      const shared2 = S().memory.likes.filter(l => agentById(NPC).likes.includes(l)).length;
      // 굴림 상대(again)든 같은 공간에 있기만 했든 같은 값 — 마주침은 talked에 안 매인다
      const want2 = chanceEncounter(before, a2.endAt, shared2);
      check('우연한 마주침: 규칙대로 (결정적), 동행보다 크게 오른다', near(after.v, want2.v) && after.at === a2.endAt && after.v - before.v > CRUSH_PLANNED, JSON.stringify([before, after, want2, e]));
    }
  }
}

console.log('\n── store: 날이 바뀌면 감쇠 ──');
{
  const ghost = (id, v, at) => ({ id, name: id, homePlaceId: 'nowhere', color: '#000', emoji: '·', gender: 'male', crush: { v, at } });   // 풀에 없는 사람 — 오늘 어디에도 안 나타난다
  useWorld.setState({ memory: { ...S().memory, friends: [...S().memory.friends, ghost('old', 0.5, T0 - 20 * DAY), ghost('floor', 0.25, T0 - 40 * DAY), ghost('fresh', 0.5, T0 - 3 * DAY)] } });
  const t1 = dayStart + DAY + 9 * 3600_000;
  S().jumpTo(t1);
  const g = id => S().memory.friends.find(x => x.id === id).crush;
  check('20일 전 0.5 → 규칙대로 깎인다 (7일치 −0.21)', near(g('old').v, decay({ v: 0.5, at: T0 - 20 * DAY }, t1).v) && near(g('old').v, 0.29), JSON.stringify(g('old')));
  check('관심 아래로는 안 떨어진다', g('floor').v === CRUSH_INTEREST_MIN, JSON.stringify(g('floor')));
  check('3일 전 것은 그대로', g('fresh').v === 0.5 && g('fresh').at === T0 - 3 * DAY, JSON.stringify(g('fresh')));
  check('memory 문서에 저장된다', near(JSON.parse(storage.get('theworld.memory.v2')).friends.find(x => x.id === 'old').crush.v, 0.29), '');
  const again = g('old');
  S().jumpTo(t1 + 3600_000);
  check('같은 날 안에서는 더 안 깎인다', g('old') === again || near(g('old').v, again.v), '');
}

console.log('\n── store: 계획 카드 훅 (§4 그 사람이 가는 곳) ──');
{
  const d2 = S().today, ds2 = dayStartOfKey(d2);
  const withCrush = v => useWorld.setState({ memory: { ...S().memory, friends: S().memory.friends.map(x => (x.id === NPC ? { ...x, crush: { v, at: S().now } } : x)) } });
  const emptyBlock = id => { const plans = { ...S().plans, [id]: { blockId: id, category: null, options: [], chosenId: null, chosenBy: null, status: 'empty' } }; useWorld.setState({ plans, days: { ...S().days, [d2]: plans } }); };
  const cand = ['pm', 'night', 'evening', 'am'].map(b => [b, agentActivityAt(agentById(NPC), b, d2)]).find(([b, a]) => a && a.placeId !== agentById(NPC).homePlaceId && placeById(a.placeId).city === 'seoul' && !['friend_home', 'home'].includes(placeById(a.placeId).type) && blockStartAt(ds2, b) > S().now);
  check('지우가 오늘 서울 어딘가에 가는 블록이 있다', !!cand, JSON.stringify(['pm', 'night', 'evening', 'am'].map(b => agentActivityAt(agentById(NPC), b, d2)?.placeId)));
  if (cand) {
    const [blockId, jact] = cand;
    const place = placeById(jact.placeId);
    withCrush(0.6);
    emptyBlock(blockId);
    S().jumpTo(blockStartAt(ds2, blockId) + 1000);
    const p = S().plans[blockId];
    const card = p.options.find(o => o.id === `${blockId}-crush-${place.id}`);
    // 무조건 단언한다 — "이미 그 장소가 카드에 있다"로 빠져나가면 시드·장소 풀이 바뀔 때 아래 계약이 조용히 안 검사된다
    check('빈 블록이 시작하면 카드 3장 중 셋째가 그 사람이 가는 곳', p.options.length === 3 && !!card && p.options[2] === card, JSON.stringify(p.options.map(o => [o.id, o.reason])));
    check('이유는 얼버무림 "왠지 {동네} 가고 싶어", 이름 없음', !!card && card.reason === `왠지 ${place.area} 가고 싶어` && !card.reason.includes('지우') && !card.title.includes('지우'), JSON.stringify(card));
    check('동행이 아니다 — friendId·proposedBy 없음, 장소·범주는 그 사람의 활동', !!card && !card.friendId && !card.proposedBy && card.placeId === place.id && card.category === jact.option.category, JSON.stringify(card));
    check('에이전트가 골라도 같은 문(review)을 지난다 — chosenId는 카드 중 하나', p.chosenBy === 'agent' && p.options.some(o => o.id === p.chosenId), JSON.stringify([p.chosenId, p.chosenBy]));
    const withCard = p.options.map(o => o.id);
    // 설렘이 관심뿐이면(0.3) 카드는 그대로 — sim-plan의 카드 수·결정성이 유지된다
    withCrush(0.3);
    emptyBlock(blockId);
    S().jumpTo(blockStartAt(ds2, blockId) + 2000);
    const q = S().plans[blockId];
    // 셋 다 review에 막히면 집에서 쉬는 fallback 카드가 뒤에 하나 더 붙는다 — 그건 설렘과 무관
    check('좋아함 아래면 설렘 카드가 없다 (규칙 카드 3장 그대로)', q.options.filter(o => !o.id.startsWith('fallback')).length === 3 && q.options.every(o => !o.id.includes('-crush-')), JSON.stringify(q.options.map(o => o.id)));
    check('앞 두 장은 같다 (결정적 — 셋째만 바뀐다)', withCard.slice(0, 2).join() === q.options.slice(0, 2).map(o => o.id).join(), JSON.stringify([withCard, q.options.map(o => o.id)]));
    withCrush(0.6);
    emptyBlock(blockId);
    S().jumpTo(blockStartAt(ds2, blockId) + 3000);
    check('다시 좋아함이면 같은 카드 (결정적)', S().plans[blockId].options.map(o => o.id).join() === withCard.join(), JSON.stringify(S().plans[blockId].options.map(o => o.id)));
    // 사용자가 범주만 골라 둔 블록(options 없음)엔 끼우지 않는다 — 카드의 범주는 그 사람 활동의 것이라 고르면 블록 이름이 바뀐다
    const userCat = jact.option.category === 'study' ? 'exercise' : 'study';
    { const plans = { ...S().plans, [blockId]: { blockId, category: userCat, options: [], chosenId: null, chosenBy: null, status: 'empty' } }; useWorld.setState({ plans, days: { ...S().days, [d2]: plans } }); }
    S().jumpTo(blockStartAt(ds2, blockId) + 4000);
    const u = S().plans[blockId];
    check('사용자가 범주를 골라 둔 블록엔 설렘 카드가 없다 (범주 그대로)', u.category === userCat && u.options.every(o => !o.id.includes('-crush-') && o.category === userCat), JSON.stringify(u.options.map(o => [o.id, o.category])));
    // 다른 블록이 이미 그 장소를 쓰면 안 끼운다 (suggestOptions의 usedPlaceIds와 같은 문)
    const otherBlock = ['am', 'pm', 'evening', 'night'].find(b => b !== blockId);
    emptyBlock(blockId);
    { const opt = { id: 'used-x', title: '거기', reason: '', emoji: '·', placeId: place.id, category: 'play' }; const plans = { ...S().plans, [otherBlock]: { blockId: otherBlock, category: 'play', options: [opt], chosenId: opt.id, chosenBy: 'user', status: 'confirmed' } }; useWorld.setState({ plans, days: { ...S().days, [d2]: plans } }); }
    S().jumpTo(blockStartAt(ds2, blockId) + 5000);
    check('다른 블록이 그 장소를 쓰면 설렘 카드가 없다', S().plans[blockId].options.every(o => !o.id.includes('-crush-')), JSON.stringify(S().plans[blockId].options.map(o => o.id)));
  }
}

console.log('\n── store: 먼저 좋아요 (§4) ──');
{
  const guest = { ...friendOfRemote(BOY, null, null), crush: { v: 0.6, at: S().now } };
  const meh = { ...friendOfRemote(OTHER, null, null), crush: { v: 0.3, at: S().now } };
  useWorld.setState({ memory: { ...S().memory, friends: [...S().memory.friends.filter(x => x.id !== BOY.id && x.id !== OTHER.id), guest, meh] }, agentLikes: emptyAgentLikes() });
  server.feed = [
    { post: postOf(hex('1'), BOY.id), author: BOY }, { post: postOf(hex('2'), OTHER.id), author: OTHER }, { post: postOf(hex('3'), BOY.id, { likedByMe: true }), author: BOY },
    { post: postOf(hex('4'), BOY.id), author: BOY }, { post: postOf(hex('5'), BOY.id), author: BOY }, { post: postOf(hex('6'), BOY.id), author: BOY },
  ];
  server.log.length = 0;
  const sns = useSns.getState();
  const likedBefore = JSON.stringify(S().agentPost.likedAuthors);
  await sns.loadFeed(true);
  await new Promise(r => setTimeout(r, 10));
  const likes = () => server.log.filter(l => l.method === 'POST' && /\/like$/.test(l.url)).map(l => l.url.match(/posts\/([a-f0-9]+)\/like/)[1]);
  check('피드가 오면 좋아함 이상인 사람의 글에 좋아요 — 주인이 누른 글은 빼고, 하루 3개, 관심(0.3)뿐인 사람 글은 안 누른다', likes().join() === [hex('1'), hex('4'), hex('5')].join(), JSON.stringify(likes()));
  check('화면에도 켜진다 (likedByMe)', useSns.getState().feed.filter(i => i.post.likedByMe).map(i => i.post.id).join() === [hex('1'), hex('3'), hex('4'), hex('5')].join(), '');
  check('기록: agentLikes에 글 id·오늘·수', S().agentLikes.ids.join() === [hex('1'), hex('4'), hex('5')].join() && S().agentLikes.count === 3 && S().agentLikes.day === S().today, JSON.stringify(S().agentLikes));
  check('world 저장본에 실린다', JSON.parse(storage.get('theworld.world.v5')).agentLikes?.count === 3, '');
  check('주인의 좋아요 기록(noteLike → likedAuthors)엔 안 적힌다', JSON.stringify(S().agentPost.likedAuthors) === likedBefore && !S().agentPost.likedAuthors[BOY.id], JSON.stringify(S().agentPost.likedAuthors));
  await sns.loadFeed(true);
  await new Promise(r => setTimeout(r, 10));
  check('같은 날 다시 받아도 더 안 누른다 (글마다 한 번·하루 3개)', likes().length === 3, String(likes().length));
  useWorld.setState({ agentLikes: { ...S().agentLikes, day: 'yesterday' } });
  await sns.loadFeed(true);
  await new Promise(r => setTimeout(r, 10));
  check('다음 날엔 아직 안 누른 글 하나 더 (이미 누른 글은 다시 안 누른다)', likes().join() === [hex('1'), hex('4'), hex('5'), hex('6')].join() && S().agentLikes.count === 1, JSON.stringify([likes(), S().agentLikes]));
  // 가상 친구(NPC) 글도 — 내 폰의 로컬 문서
  const jiwooItem = { post: postOf(hex('7'), NPC), author: { ...agentOf(NPC, '지우', { gender: 'male' }) } };
  useWorld.setState({ agentLikes: emptyAgentLikes(), memory: { ...S().memory, friends: S().memory.friends.map(x => (x.id === NPC ? { ...x, crush: { v: 0.7, at: S().now } } : x)) } });
  useSns.getState().setLocalPosts([jiwooItem]);
  server.feed = [];
  await sns.loadFeed(true);
  await new Promise(r => setTimeout(r, 10));
  check('가상 친구의 글은 내 폰에서 켜진다 (서버 요청 없이), 기록에 남는다', useSns.getState().localPosts[0].post.likedByMe === true && S().agentLikes.ids.includes(hex('7')) && likes().length === 4 && !S().agentPost.likedAuthors[NPC], JSON.stringify([useSns.getState().localPosts[0].post.likedByMe, S().agentLikes]));
  // 주인이 직접 누르면 여전히 기록된다 (에이전트 좋아요만 빠진다)
  useSns.getState().likeLocalToggle(hex('7'));   // 끄기 — 기록 없음
  useSns.getState().likeLocalToggle(hex('7'));   // 켜기 — 주인
  check('주인이 직접 켜면 likedAuthors에 적힌다', !!S().agentPost.likedAuthors[NPC], JSON.stringify(S().agentPost.likedAuthors));
  // 서버가 없어도(오프라인·사용자 없음) 내 폰의 가상 친구 글은 눌린다 — 피드 한 장이 실패해도 듣는 쪽엔 알린다
  const jiwoo2 = { post: postOf(hex('8'), NPC), author: { ...agentOf(NPC, '지우', { gender: 'male' }) } };
  useWorld.setState({ agentLikes: emptyAgentLikes() });
  useSns.getState().setLocalPosts([jiwoo2, ...useSns.getState().localPosts]);
  server.down = true;
  const nLikes = likes().length;
  await sns.loadFeed(true);
  await new Promise(r => setTimeout(r, 10));
  check('피드를 못 받아도 가상 친구 글엔 먼저 좋아요 (서버 요청 없이)', useSns.getState().feedError !== '' && useSns.getState().localPosts.find(i => i.post.id === hex('8'))?.post.likedByMe === true && S().agentLikes.ids.includes(hex('8')) && likes().length === nLikes, JSON.stringify([useSns.getState().feedError, S().agentLikes]));
  server.down = false;
  // 가상 친구 글이 새로 들어올 때도 (pumpNpcPosts의 setLocalPosts 뒤 → agentAutoLike([])) — 스토어가 items 없이 로컬 글만으로 고른다
  const jiwoo3 = { post: postOf(hex('9'), NPC), author: { ...agentOf(NPC, '지우', { gender: 'male' }) } };
  useSns.getState().setLocalPosts([jiwoo3, ...useSns.getState().localPosts]);
  S().agentAutoLike([]);
  check('새 가상 친구 글이 들어오면 피드 없이도 눌린다', useSns.getState().localPosts.find(i => i.post.id === hex('9'))?.post.likedByMe === true && S().agentLikes.ids.includes(hex('9')), JSON.stringify(S().agentLikes));
}

console.log('\n── store: 몰아서 정산해도 같은 마음 (부팅·날 바뀜 — 친구가 되기 전에 지은 시간표로 정산) ──');
{
  // 도윤(남, 아직 친구 아님): 내일 오전 동행 → 친구, 그 뒤 도윤이 가는 곳에 (동행 없이). 켜 두고 보면 뒤 활동의 시간표는 친구가 된 뒤 다시 지어져 도윤이 `again`이고,
  // 부팅·날 바뀜의 몰아서 정산(prune·remember)은 친구가 되기 **전** 시간표(도윤 = 굴림 상대·talked는 시드, 또는 배경)로 정산한다 — 어느 쪽이든 같은 값이어야 한다
  const NPC2 = 'doyun';
  S().jumpTo(dayStartOfKey(S().today) + DAY + 5 * 3600_000);   // 내일 새벽 — 오전 블록이 아직 안 시작했다
  const d3 = S().today, ds3 = dayStartOfKey(d3);
  check('도윤은 남자고 아직 친구가 아니다', agentById(NPC2).gender === 'male' && !S().memory.friends.some(x => x.id === NPC2), JSON.stringify(S().memory.friends.map(x => x.id)));
  const empty = id => ({ blockId: id, category: null, options: [], chosenId: null, chosenBy: null, status: 'empty' });
  const optAt = (blockId, place, friendId) => ({ id: `batch-${blockId}`, title: `${place.name}에서 시간 보내기`, reason: '검사용', emoji: place.emoji, placeId: place.id, category: 'play', ...(friendId ? { friendId } : {}) });
  const later = ['pm', 'evening', 'night'].map(b => [b, agentActivityAt(agentById(NPC2), b, d3)]).find(([, a]) => a && a.placeId !== agentById(NPC2).homePlaceId && placeById(a.placeId).city === 'seoul');
  check('도윤이 내일 오후·저녁·밤에 서울 어딘가에 간다', !!later, JSON.stringify(['pm', 'evening', 'night'].map(b => agentActivityAt(agentById(NPC2), b, d3)?.placeId)));
  if (later && blockStartAt(ds3, 'am') > S().now) {
    const [lb, dact] = later;
    const amOpt = optAt('am', cafe, NPC2), lOpt = optAt(lb, placeById(dact.placeId));
    const plans = { ...S().plans, am: { ...empty('am'), category: 'play', options: [amOpt], chosenId: amOpt.id, chosenBy: 'user', status: 'confirmed' }, [lb]: { ...empty(lb), category: 'play', options: [lOpt], chosenId: lOpt.id, chosenBy: 'user', status: 'confirmed' } };
    useWorld.setState({ plans, days: { ...S().days, [d3]: plans } });
    S().jumpTo(blockStartAt(ds3, 'am') - MIN); S().tick();
    const amAct = S().timeline.find(a => a.dayKey === d3 && a.blockIds[0] === 'am');
    const stale = S().timeline.find(a => a.dayKey === d3 && a.blockIds[0] === lb);   // 친구가 되기 전의 시간표 — 몰아서 정산할 때 보는 것
    const present = stale && stale.place.id === dact.placeId && (stale.presentNearby.includes(NPC2) || stale.encounter?.agentId === NPC2);
    check('오전 동행 + 뒤 활동에 도윤이 같은 공간 (마찰로 딴 데 가면 이 검사는 건너뛴다)', !!amAct && amAct.companions.join() === NPC2 && !!stale, JSON.stringify([amAct?.companions, stale?.place.id, dact.placeId, stale?.presentNearby, stale?.encounter]));
    if (amAct && stale && present) {
      check('친구가 되기 전 시간표의 도윤은 again이 아니다 (굴림 상대거나 배경)', !stale.encounter?.again, JSON.stringify(stale.encounter));
      // 켜 두고 본 길: 오전이 끝나 정산 → 친구·계획된 동행. 뒤 활동은 다시 지어져 도윤이 again
      S().jumpTo(amAct.endAt + 2 * MIN); S().tick();
      const afterAm = S().memory;
      const live = S().timeline.find(a => a.dayKey === d3 && a.blockIds[0] === lb);
      const shared = afterAm.likes.filter(l => agentById(NPC2).likes.includes(l)).length;
      check('오전이 끝나면 친구 + 계획된 동행', afterAm.friends.some(x => x.id === NPC2) && near(afterAm.friends.find(x => x.id === NPC2).crush.v, plannedTogether(undefined, amAct.endAt, shared).v), JSON.stringify(afterAm.friends.find(x => x.id === NPC2)));
      check('친구가 된 뒤 다시 지은 시간표의 도윤은 again', live?.encounter?.agentId === NPC2 && live.encounter.again === true, JSON.stringify(live?.encounter));
      S().jumpTo(live.endAt + 2 * MIN); S().tick();
      const liveCrush = S().memory.friends.find(x => x.id === NPC2).crush;
      const want = chanceEncounter(plannedTogether(undefined, amAct.endAt, shared), live.endAt, shared);
      check('켜 두고 본 값: 동행(+0.06+취향) 뒤 마주침(+0.12+취향)', near(liveCrush.v, want.v) && liveCrush.at === live.endAt, JSON.stringify([liveCrush, want]));
      // 몰아서 정산한 길: 같은 memory(오전 뒤)에 친구가 되기 전 시간표의 활동을 정산 — talked에 안 매이니 같은 값
      const batch = crushAfterActivity(afterAm, stale, id => { const ag = agentById(id); return ag ? { gender: ag.gender, likes: ag.likes } : null; }).friends.find(x => x.id === NPC2).crush;
      check('몰아서 정산한 값 = 켜 두고 본 값 (어느 기기에서 봐도 같은 마음)', near(batch.v, liveCrush.v) && batch.at === liveCrush.at, JSON.stringify([batch, liveCrush, stale.encounter]));
    }
  }
}

console.log(`\n${n - fails.length}/${n} ok`);
if (fails.length) { console.log('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
