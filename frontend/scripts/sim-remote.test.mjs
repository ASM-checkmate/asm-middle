// 진짜 사람 에이전트 harness (BACKEND-CONTRACT §3.4·§3.5, sim/remote.ts + agents.ts + timeline.ts + store.ts + sync.ts) —
// 가짜 remote 캐시를 world에 넣고: (a) 같은 장소·시간의 진짜 사람이 NPC보다 먼저 마주침이 된다, (b) 진짜 사람 친구의 발행된
// 하루가 동행 카드(친구 제안)가 된다, (c) 친구 목록의 '지금'은 발행된 활동의 `arriveAt <= now < endAt`, (d) 캐시가 비면 NPC 풀
// 그대로, (e) 정렬 시드는 양쪽 기기에서 같은 굴림. 그 뒤 fetch를 흉내 내어 발행·조회·친구 추가의 요청/응답 모양을 본다.
// Usage: node scripts/sim-remote.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const H = 3600_000, MIN = 60_000;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 3, 8, 50);
const SEOUL = 'Asia/Seoul';
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

freezeClockAt(T0);
const remote = await import('../src/sim/remote.ts');
const { validRemoteAgent, validPublished, validRemote, emptyRemote, mergeRemote, pruneRemote, pendingSlots, publishedOf, appearanceOf, remoteNowOf, remoteHomeId } = remote;
const { AGENTS, agentById, agentsAt, agentActivityAt, agentDayPlan, agentOfFriend, isAgentHomeAt, friendNow, rollTalk, rollTalkRemote, talkChance, remoteAgents, isRemoteId } = await import('../src/sim/agents.ts');
const { rng } = await import('../src/sim/rng.ts');
const { PLACES, placeById, hasPlace, registerPlaces, registerRemotePlaces } = await import('../src/sim/places.ts');
const { dayStartOfKey, dayEndOfKey, addDaysKey } = await import('../src/sim/tz.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

// ── 가짜 진짜 사람 ─────────────────────────────────────────────────────────────
const uid = i => 'u' + i.toString(16).padStart(31, '0');
const homeOf = (id, name, city = 'seoul') => ({ id: `home:${id}`, name: `${name}네 집`, type: 'friend_home', lng: 126.9302, lat: 37.5689, area: '연희동', city, country: 'KR', emoji: '🏡', ownerFriendId: id });
const agentOf = (id, name, extra = {}) => ({ id, name, homePlaceId: `home:${id}`, color: '#F6C445', emoji: '🐨', likes: ['카페', '그림 그리기'], traits: ['외향적'], hairStyle: 'bob', home: homeOf(id, name), ...extra });
const pubOf = (agentId, dayKey, blockId, placeId, arriveAt, endAt, extra = {}) => ({ key: `${dayKey}:${blockId}`, agentId, dayKey, blockId, placeId, category: 'play', title: '카페에서 그림 그리기', emoji: '🎨', arriveAt, endAt, tz: SEOUL, companions: [], ...extra });

console.log('\n── 검증 (validRemote) ──');
const A1 = agentOf(uid(1), '토리');
const ok1 = validRemoteAgent(A1);
check('멀쩡한 RemoteAgent는 통과하고 집은 friend_home·ownerFriendId 강제', !!ok1 && ok1.home.type === 'friend_home' && ok1.home.ownerFriendId === A1.id && ok1.homePlaceId === A1.home.id, JSON.stringify(ok1));
check('집이 없거나 좌표가 틀리면 에이전트를 통째로 버린다', validRemoteAgent({ ...A1, home: undefined }) === null && validRemoteAgent({ ...A1, home: { ...A1.home, lng: 'x' } }) === null, '');
check('이름이 비면 버린다', validRemoteAgent({ ...A1, name: '' }) === null, '');
// SNS 세 칸 (§2.5 PUT /api/me/agent 개정): 살아남고, 틀린 값은 그 칸만 빠진다
const REP = 'a'.repeat(32);
const sns = validRemoteAgent({ ...A1, gender: 'female', visibility: 'public', repShotId: REP });
check('gender·visibility·repShotId가 validRemoteAgent를 지나 남는다', sns?.gender === 'female' && sns.visibility === 'public' && sns.repShotId === REP, JSON.stringify(sns));
const snsBad = validRemoteAgent({ ...A1, gender: 'robot', visibility: 'friends', repShotId: 'not-hex' });
check('틀린 gender·visibility·repShotId는 그 칸만 빠지고 에이전트는 남는다', !!snsBad && snsBad.id === A1.id && !('gender' in snsBad) && !('visibility' in snsBad) && !('repShotId' in snsBad), JSON.stringify(snsBad));
check('키가 없으면 없는 채로 (옛 응답·저장본)', !('visibility' in ok1) && !('gender' in ok1) && !('repShotId' in ok1), JSON.stringify(ok1));
const P1 = pubOf(A1.id, '2026-09-03@Asia/Seoul', 'pm', 'layered-yeonnam', KST(2026, 9, 3, 14, 20), KST(2026, 9, 3, 17, 35));
check('발행 활동은 통과, agentId는 준 값으로 덮인다', validPublished({ ...P1, agentId: 'liar' }, A1.id)?.agentId === A1.id, '');
check('arriveAt ≥ endAt · 모르는 블록 · 틀린 시간대는 버린다', validPublished({ ...P1, endAt: P1.arriveAt }) === null && validPublished({ ...P1, blockId: 'brunch' }) === null && validPublished({ ...P1, tz: 'Mars/Olympus' }) === null, '');
check('place는 placeId와 같을 때만 실린다', !!validPublished({ ...P1, place: homeOf(A1.id, '토리') })?.place === false && validPublished({ ...P1, placeId: `home:${A1.id}`, place: homeOf(A1.id, '토리') })?.place?.type === 'friend_home', '');
const badCache = validRemote({ fetchedAt: 1, agents: { [A1.id]: A1, bad: { id: 'bad' } }, slots: { 'k:pm': [{ agentId: A1.id, overlapMs: 1, activity: P1 }, { agentId: 'ghost', overlapMs: 1, activity: P1 }, 'junk'] }, days: { [A1.id]: [P1, null], ghost: [P1] }, friendsAt: 'x' });
check('캐시 검증: 틀린 에이전트·프로필 없는 hit/day·쓰레기는 항목 단위로 걸러진다', Object.keys(badCache.agents).join() === A1.id && badCache.slots['k:pm'].length === 1 && badCache.days[A1.id].length === 1 && !('ghost' in badCache.days) && badCache.friendsAt === 0, JSON.stringify(badCache));
check('모양이 아예 아니면 null', validRemote(null) === null && validRemote('x') === null, '');
const look = appearanceOf(uid(7));
check('내 모습은 userId로 정해져 어느 기기에서나 같다', JSON.stringify(look) === JSON.stringify(appearanceOf(uid(7))) && /^#/.test(look.color) && !!look.emoji && !!look.hairStyle, JSON.stringify(look));
check('remoteNowOf: arriveAt <= now < endAt', remoteNowOf([P1], P1.arriveAt)?.key === P1.key && remoteNowOf([P1], P1.endAt) === null && remoteNowOf([P1], P1.arriveAt - 1) === null && remoteNowOf(undefined, 0) === null, '');

console.log('\n── (e) 정렬 시드: 양쪽 기기에서 같은 굴림 ──');
const D = '2026-09-03@Asia/Seoul';
const both = [0.2, 0.35, 0.5, 0.9].every(c => rollTalkRemote(D, 'layered-yeonnam', uid(9), uid(2), c) === rollTalkRemote(D, 'layered-yeonnam', uid(2), uid(9), c));
check('rollTalkRemote(me, other) === rollTalkRemote(other, me)', both, '');
const [lo, hi] = [uid(2), uid(9)].sort();
check('시드는 `${dayKey}:${placeId}:${min}:${max}`', rollTalkRemote(D, 'p', uid(9), uid(2), 0.5) === (rng(`${D}:p:${lo}:${hi}`).next() < 0.5), '');
check('NPC 굴림은 예전 시드 그대로 (기존 결과 보존)', rollTalk(D, 'p', '모모', 'minsu', 0.5) === (rng(`${D}:p:모모:minsu`).next() < 0.5), '');

console.log('\n── 부팅 (오프라인) — NPC 풀 그대로 ──');
S().tick();
const today = S().today;
check('today is the Seoul day', today === D, today);
check('remote 캐시 없음 · 에이전트 8명 · 서버 사용자 없음', S().remote === null && S().agents.length === 8 && S().sync.userId === null, JSON.stringify([S().remote, S().agents.length, S().sync.userId]));
const encountersOf = () => S().timeline.map(a => `${a.key}=${a.encounter?.agentId ?? '-'}:${a.encounter?.talked ?? ''}`).join(' ');
const base = encountersOf();
const sample = S().timeline[0];

console.log('\n── (d) 캐시가 비면 NPC와 동일 ──');
S().applyRemote(emptyRemote());
check('빈 캐시를 넣어도 마주침이 같다', encountersOf() === base, encountersOf());
check('…에이전트 풀도 NPC 8명 그대로', S().agents.length === 8 && remoteAgents().length === 0, String(S().agents.length));
check('agentsAt 기본 풀 = NPC 풀 (캐시가 비면)', JSON.stringify(agentsAt(sample.place.id, sample.arriveAt, sample.endAt)) === JSON.stringify(agentsAt(sample.place.id, sample.arriveAt, sample.endAt, AGENTS)), '');
S().applyRemote(null);
check('null을 넣으면 remote가 null이고 마주침이 같다', S().remote === null && encountersOf() === base, '');
check('저장본에 remote 키가 없다 (v5 그대로)', !('remote' in JSON.parse(storage.get('theworld.world.v5'))), '');

console.log('\n── (a) 같은 장소·시간의 진짜 사람이 먼저 잡힌다 ──');
// 사용자가 미리 정한 오전 활동 — 출발·도착이 아직이라 슬롯을 묻는 대상이다. 그날 아침에 이미 말을 튼 날이면 다음 날로 넘어간다
// (하루 최대 1명 규칙이 새 친구를 막으므로). 며칠 안엔 반드시 있다.
let act = null, dayIdx = 0;
for (; dayIdx < 6 && !act; dayIdx++) {
  const t = KST(2026, 9, 3 + dayIdx, 8, 50);
  if (dayIdx) { freezeClockAt(t); S().jumpTo(t); }
  const dk = S().today;
  const talkedAlready = S().timeline.some(x => x.dayKey === dk && x.encounter?.talked && !x.encounter.again);
  if (talkedAlready) continue;
  S().setCategory('am', 'play');
  for (const o of S().plans.am.options) {
    S().chooseOption('am', o.id, 'user');
    if (S().plans.am.chosenId === o.id) break;
    if (S().plans.am.verdict?.kind === 'pushback') { S().pushAnyway('am'); if (S().plans.am.chosenId === o.id) break; }
    S().clearVerdict('am');
  }
  act = S().timeline.find(x => x.dayKey === dk && x.blockIds[0] === 'am' && x.arriveAt > S().now) ?? null;
}
check('미리 정한 오전 활동이 있다 (도착 전)', !!act, JSON.stringify(S().plans.am));
if (!act) { console.log('cannot continue'); process.exit(1); }
const now1 = S().now;
check('pendingSlots: 도착 전이고 슬롯이 없는 key만, 창은 [arriveAt, endAt)', pendingSlots(S().timeline, null, now1, [S().today, addDaysKey(S().today, 1)]).some(s => s.key === act.key && s.placeId === act.place.id && s.from === act.arriveAt && s.to === act.endAt), JSON.stringify(pendingSlots(S().timeline, null, now1, [S().today])));
check('…이미 슬롯이 있으면 다시 묻지 않는다', !pendingSlots(S().timeline, { ...emptyRemote(), slots: { [act.key]: [] } }, now1, [S().today]).some(s => s.key === act.key), '');
check('…내 집(type home) 활동은 묻지 않는다 (아무도 "home"으로 발행하지 않는다)', pendingSlots([{ ...act, key: `${act.dayKey}:evening`, place: placeById('home'), arriveAt: now1 + H, endAt: now1 + 2 * H }], null, now1, [S().today]).length === 0, '');
check('…도착이 지났으면 묻지 않는다', !pendingSlots(S().timeline, null, act.arriveAt, [S().today]).some(s => s.key === act.key), '');
// 상대 id는 굴림이 성공하도록 고른다 (결정적 시드라 가능) — meId는 서버 사용자가 없으니 캐릭터 이름
const chanceFor = agent => talkChance({ myTraits: S().memory.traits, myLikes: S().memory.likes, agent, placeType: act.place.type, overlapMs: act.endAt - act.arriveAt, metBefore: false });
let RA = null, RB = null;
for (let i = 10; i < 400 && !(RA && RB); i++) {
  const a = agentOf(uid(i), '토리');
  const talks = rollTalkRemote(act.dayKey, act.place.id, S().memory.name, a.id, chanceFor(a));
  if (talks && !RA) RA = a; else if (!talks && !RB) RB = a;
}
check('굴림이 성공하는 id와 실패하는 id를 하나씩 찾았다', !!RA && !!RB, '');
const hit = (a, extra = {}) => ({ agentId: a.id, overlapMs: act.endAt - act.arriveAt, activity: pubOf(a.id, act.dayKey, 'am', act.place.id, act.arriveAt - 10 * MIN, act.endAt + 5 * MIN, extra) });
const npcThere = agentsAt(act.place.id, act.arriveAt, act.endAt, AGENTS).map(x => x.agent.id);
const before = S().timeline.find(x => x.key === act.key).encounter;
// 두 사람이 같은 곳에 있으면 id 오름차순의 첫 사람 — 서버가 정렬해 주지만 여기선 일부러 거꾸로 넣는다
const [first, second] = [RA, RB].sort((x, y) => (x.id < y.id ? -1 : 1));
const cache1 = { fetchedAt: 1, agents: { [RA.id]: RA, [RB.id]: RB }, slots: { [act.key]: [hit(second), hit(first)] }, days: { [RA.id]: [hit(RA).activity] }, friendsAt: 0 };
S().applyRemote(cache1);
let enc = S().timeline.find(x => x.key === act.key).encounter;
check(`진짜 사람이 마주침이 된다 (NPC ${npcThere.length ? npcThere.join('/') + '도 거기 있었지만' : '없음'}; 전엔 ${before?.agentId ?? '없음'})`, enc?.agentId === first.id, JSON.stringify(enc));
check('여럿이면 agentId 오름차순의 첫 사람 (넣은 순서와 무관)', enc?.agentId === first.id && first.id < second.id, '');
check('agentsAt 기본 풀은 진짜 사람이 NPC보다 앞', agentsAt(act.place.id, act.arriveAt, act.endAt)[0]?.agent.id === RA.id, JSON.stringify(agentsAt(act.place.id, act.arriveAt, act.endAt).map(x => x.agent.id)));
check('agentById가 캐시를 본다 (likes/traits까지)', agentById(RA.id)?.likes.join() === '카페,그림 그리기' && isRemoteId(RA.id) && !isRemoteId('minsu'), '');
check('집이 등록돼 placeById가 throw하지 않는다 · 내 도시라 PLACES에도 보인다', hasPlace(RA.homePlaceId) && placeById(RA.homePlaceId).ownerFriendId === RA.id && PLACES.some(p => p.id === RA.homePlaceId), '');
check('에이전트 풀 미러 = 진짜 사람 2 + NPC 8', S().agents.length === 10 && S().agents[0].id === first.id, String(S().agents.length));
check('world 저장본에 remote가 실린다', JSON.parse(storage.get('theworld.world.v5')).remote?.agents?.[RA.id]?.name === '토리', '');
// 슬롯의 hit 중 장소가 다른 것은 걸러진다 (그 사이 계획을 바꿨다)
S().applyRemote({ ...cache1, slots: { [act.key]: [hit(first, { placeId: 'seoul-forest', key: `${act.dayKey}:am` })] } });
check('hit의 장소가 내 활동과 다르면 그 hit은 안 쓴다 (NPC로 돌아간다)', S().timeline.find(x => x.key === act.key).encounter?.agentId !== first.id, JSON.stringify(S().timeline.find(x => x.key === act.key).encounter));
// 굴림이 성공하는 사람만 — 말을 걸면 활동이 끝난 뒤 친구가 된다 (settle)
S().applyRemote({ ...cache1, agents: { [RA.id]: RA }, slots: { [act.key]: [hit(RA)] } });
enc = S().timeline.find(x => x.key === act.key).encounter;
check('정렬 시드로 굴려 말을 걸었다', enc?.agentId === RA.id && enc.talked === true && !enc.again, JSON.stringify(enc));
check('끝나기 전엔 친구가 아니다', !S().memory.friends.some(f => f.id === RA.id), '');
const endT = act.endAt + 2 * MIN;
freezeClockAt(endT); S().jumpTo(endT); S().tick();
const made = S().memory.friends.find(f => f.id === RA.id);
check('활동이 끝나면 진짜 사람이 친구가 된다 (metAt/metPlaceId, 집은 home:<id>)', !!made && made.metAt === act.endAt && made.metPlaceId === act.place.id && made.homePlaceId === `home:${RA.id}` && made.name === '토리', JSON.stringify(made));
check('마주침 기록에도 남는다', (S().encounters[RA.id] ?? 0) >= 1, JSON.stringify(S().encounters));
check('친구 목록의 "지금": 발행된 활동이 끝났으니 집', friendNow(made, endT + 10 * MIN, SEOUL, S().today).kind === 'home', JSON.stringify(friendNow(made, endT + 10 * MIN, SEOUL, S().today)));
const midT = act.arriveAt + 5 * MIN;
check('…활동 중이면 그 활동 (내 블록이 아니라 그 순간으로)', friendNow(made, midT, SEOUL, S().today).kind === 'act' && friendNow(made, midT, SEOUL, S().today).title === '카페에서 그림 그리기', JSON.stringify(friendNow(made, midT, SEOUL, S().today)));
check('…새벽이면 자는 중 (그 사람 집의 시간대)', friendNow(made, dayStartOfKey(S().today) + 3 * H, SEOUL, S().today).kind === 'sleep', '');
// 정산된 활동은 캐시가 바뀌어도 굳어 있다 (settle 멱등)
S().applyRemote(null);
check('캐시를 비워도 이미 정산된 친구·만화는 그대로', S().memory.friends.some(f => f.id === RA.id) && S().book.some(c => c.id === `c:${act.key}`), '');
check('…친구가 됐지만 캐시가 비면 프로필 없이 Friend만 (agentOfFriend가 빈 likes로 대신한다)', agentById(RA.id) === null && (() => { try { placeById(made.homePlaceId); return true; } catch { return false; } })(), '');
// 프로필이 캐시에 없는 진짜 사람 친구(집이 표에 없다): 부팅(decide)·친구 목록이 placeById로 죽지 않는다 — 빈 하루, 집/자는 중
const ghost = { id: uid(999), name: '유령', homePlaceId: `home:${uid(999)}`, color: '#000', emoji: '👻' };
check('캐시에 없는 remote 친구: agentDayPlan은 빈 하루, 동행 판단은 자유·집', !hasPlace(ghost.homePlaceId) && agentDayPlan(agentOfFriend(ghost), S().today).length === 0 && agentActivityAt(agentOfFriend(ghost), 'am', S().today) === null && isAgentHomeAt(agentOfFriend(ghost), 'am', S().today), '');
check("…friendNow는 throw 없이 집/자는 중", ['home', 'sleep'].includes(friendNow(ghost, T0, SEOUL, S().today).kind), JSON.stringify(friendNow(ghost, T0, SEOUL, S().today)));
useWorld.setState({ memory: { ...S().memory, friends: [...S().memory.friends, ghost] } });
let booted = true; try { S().tick(); } catch (e) { booted = false; console.log(e); }
check('…memory.friends에 있어도 tick(decide·제안)이 죽지 않는다', booted && S().timeline.length > 0, '');
useWorld.setState({ memory: { ...S().memory, friends: S().memory.friends.filter(f => f.id !== ghost.id) } });
// 숨은 remote 장소와 id가 겹치는 내 팩의 장소는 registerPlaces가 바꿔 끼워 제안 스캔에 보인다
registerRemotePlaces([{ id: 'kyoto-test-cafe', name: '친구가 간 카페', type: 'cafe', lng: 135.7, lat: 35.0, area: '', city: 'kyoto', country: 'JP', emoji: '☕' }]);
check('remote 장소는 숨은 채 등록된다', hasPlace('kyoto-test-cafe') && !PLACES.some(p => p.id === 'kyoto-test-cafe'), '');
registerPlaces([{ id: 'kyoto-test-cafe', name: '내 팩의 카페', type: 'cafe', lng: 135.7, lat: 35.0, area: '', city: 'kyoto', country: 'JP', emoji: '☕' }]);
check('같은 id로 도시 팩이 오면 내 팩의 것이 이기고 PLACES에 보인다', placeById('kyoto-test-cafe').name === '내 팩의 카페' && PLACES.some(p => p.id === 'kyoto-test-cafe'), '');
S().applyRemote({ ...emptyRemote(), agents: { [RA.id]: RA } });
check('프로필만 있는 캐시: 이미 친구인 사람은 다시 마주쳐도 "또 만났네" 없이 조용 (슬롯이 없으니)', S().timeline.find(x => x.key === act.key).encounter?.agentId !== RA.id || S().timeline.find(x => x.key === act.key).encounter?.again === undefined, '');

console.log('\n── (b) 진짜 사람 친구의 발행된 하루 → 동행 카드 ──');
storage.clear();
freezeClockAt(T0);
const F = agentOf(uid(500), '하람', { likes: ['카페'], traits: ['조용한'] });
const friendF = { id: F.id, name: F.name, homePlaceId: F.homePlaceId, color: F.color, emoji: F.emoji, metAt: KST(2026, 9, 1, 18, 0), metPlaceId: 'jebi-dabang' };
const pmF = pubOf(F.id, D, 'pm', 'layered-yeonnam', KST(2026, 9, 3, 14, 20), KST(2026, 9, 3, 17, 35), { title: '하람이랑 카페에서 그림 그리기' });
const amF = pubOf(F.id, D, 'am', `home:${F.id}`, KST(2026, 9, 3, 9, 0), KST(2026, 9, 3, 11, 35), { category: 'rest', title: '집에서 뒹굴기', place: homeOf(F.id, '하람') });
storage.set('theworld.memory.v2', JSON.stringify({ name: '모모', likes: ['그림 그리기', '카페'], dislikes: [], traits: ['느긋한'], homePlaceId: 'home', friends: [friendF], visited: [] }));
storage.set('theworld.world.v5', JSON.stringify({ v: 5, remote: { fetchedAt: 1, agents: { [F.id]: F }, slots: {}, days: { [F.id]: [amF, pmF] }, friendsAt: 0 } }));
const { useWorld: w2 } = await import('../src/sim/store.ts?remote=1');
const S2 = () => w2.getState();
S2().tick();
check('저장본의 remote가 부팅 때 살아난다', !!S2().remote?.agents[F.id] && S2().agents.length === 9 && agentById(F.id)?.name === '하람', JSON.stringify([S2().agents.length, agentById(F.id)]));
check('친구 0명 저장본이 아니라 진짜 사람 친구 1명 (NPC 씨앗 친구가 되살아나지 않는다)', S2().memory.friends.length === 1 && S2().memory.friends[0].id === F.id, JSON.stringify(S2().memory.friends));
check('agentActivityAt이 발행된 하루를 읽는다', agentActivityAt(agentById(F.id), 'pm', D)?.placeId === 'layered-yeonnam' && agentActivityAt(agentById(F.id), 'pm', D)?.option.id === pmF.key, JSON.stringify(agentActivityAt(agentById(F.id), 'pm', D)));
check('집에 있는 블록 / 계획 없는 블록은 집', isAgentHomeAt(agentById(F.id), 'am', D) && isAgentHomeAt(agentById(F.id), 'night', D) && !isAgentHomeAt(agentById(F.id), 'pm', D), '');
const pp = S2().plans.pm;
const companion = pp.options.find(o => o.id === pp.chosenId);
check('발행된 하루로 오후 블록이 동행 카드로 미리 채워진다 (chosenBy friend)', pp.chosenBy === 'friend' && !!companion && companion.friendId === F.id && companion.proposedBy === F.id && companion.placeId === 'layered-yeonnam', JSON.stringify([pp.chosenBy, companion]));
check('제목에 그 사람 이름이 없다 (stripNames가 진짜 사람 이름도 지운다)', !!companion && !companion.title.includes('하람') && companion.title.includes('카페'), companion?.title);
check('집(am)은 제안이 아니다 — 친구 집 후보일 뿐', S2().plans.am.chosenBy !== 'friend', String(S2().plans.am.chosenBy));
const actF = S2().timeline.find(a => a.key === pmF.key);
check('시간표에 동행이 실리고, 동행은 마주침이 아니다', !!actF && actF.companions.includes(F.id) && actF.encounter?.agentId !== F.id, JSON.stringify([actF?.companions, actF?.encounter]));
check("(c) 친구 목록의 '지금': 08:50엔 집, 15:00엔 발행된 활동, 03:00엔 자는 중",
  friendNow(friendF, T0, SEOUL, D).kind === 'home' && friendNow(friendF, KST(2026, 9, 3, 15, 0), SEOUL, D).kind === 'act' && friendNow(friendF, KST(2026, 9, 3, 15, 0), SEOUL, D).title === pmF.title && friendNow(friendF, KST(2026, 9, 3, 3, 0), SEOUL, D).kind === 'sleep',
  JSON.stringify([friendNow(friendF, T0, SEOUL, D), friendNow(friendF, KST(2026, 9, 3, 15, 0), SEOUL, D)]));
check("…09:30엔 집에서 뒹굴기 (집에 있어도 발행된 활동이 있으면 그것)", friendNow(friendF, KST(2026, 9, 3, 9, 30), SEOUL, D).kind === 'act', JSON.stringify(friendNow(friendF, KST(2026, 9, 3, 9, 30), SEOUL, D)));
check("NPC 친구의 '지금'은 예전 그대로 (내 블록·내 하루)", (() => { const f = { id: 'minsu', name: '민수', homePlaceId: 'minsu-home', color: '#5FC9A6', emoji: '🐥' }; const a = agentActivityAt(agentById('minsu'), 'morning', D); const r = friendNow(f, T0, SEOUL, D); return a ? r.kind === 'act' && r.title === a.option.title : r.kind === 'home'; })(), '');

console.log('\n── 캐시 정리·병합 ──');
const oldKey = `${addDaysKey(D, -3)}:pm`;
const pruned = pruneRemote({ fetchedAt: 1, agents: { [F.id]: F, [RA.id]: RA }, slots: { [oldKey]: [], [pmF.key]: [] }, days: { [RA.id]: [{ ...pmF, agentId: RA.id, endAt: dayStartOfKey(D) - 1, arriveAt: dayStartOfKey(D) - H }] }, friendsAt: 5 }, dayStartOfKey(D), new Set([F.id]));
check('anchor 이전 날의 슬롯·활동은 지우고, 아무도 안 가리키는 프로필도 지운다 (내 친구는 남긴다)', !(oldKey in pruned.slots) && pmF.key in pruned.slots && !(RA.id in pruned.agents) && F.id in pruned.agents && !(RA.id in pruned.days) && pruned.friendsAt === 5, JSON.stringify(pruned));
const base2 = { ...emptyRemote(), slots: { 'k1': [{ agentId: F.id, overlapMs: 1, activity: pmF }] }, agents: { [F.id]: F } };
const got = { agents: { [RA.id]: RA }, slots: { k1: [], k2: [{ agentId: RA.id, overlapMs: 2, activity: pmF }], k3: [{ agentId: RA.id, overlapMs: 2, activity: pmF }] }, friends: [{ agent: A1, metAt: 7, metPlaceId: 'p', now: P1 }], days: { [F.id]: [amF] } };
const merged = mergeRemote(base2, got, { now: 99, arrivedKeys: new Set(['k3']), friendsAt: 42 });
check('슬롯은 있던 key는 그대로(한 번만), 도착이 지난 key는 빈 목록으로 굳고, 새 key만 들어온다', merged.slots.k1.length === 1 && merged.slots.k2.length === 1 && merged.slots.k3.length === 0, JSON.stringify(merged.slots));
check('프로필은 합쳐지고(친구 포함) 하루는 통째로 바뀌며 친구의 now는 하루가 없을 때 들어간다', A1.id in merged.agents && RA.id in merged.agents && merged.days[F.id].length === 1 && merged.days[A1.id]?.[0].key === P1.key && merged.friendsAt === 42 && merged.fetchedAt === 99, JSON.stringify(Object.keys(merged.days)));

console.log('\n── 발행 모양 (publishedOf) ──');
const strip = (t, keep) => (keep ? t : t.replace(/민수(이랑|랑)?\s*/g, '').trim());
const homeAct = S2().timeline.find(a => a.place.type === 'home') ?? { ...actF, place: placeById('home'), option: { ...actF.option, title: '민수랑 집에서 쉬기' } };
const pubHome = publishedOf(homeAct, uid(1), '모모', strip);
check('내 집은 home:<me>·friend_home·ownerFriendId=me로 나간다 (상대의 home과 섞이지 않게)', pubHome.placeId === remoteHomeId(uid(1)) && pubHome.place.type === 'friend_home' && pubHome.place.ownerFriendId === uid(1) && pubHome.place.name === '모모네 집' && pubHome.agentId === uid(1), JSON.stringify(pubHome));
const pubOut = publishedOf(actF, uid(1), '모모', strip);
check('밖의 활동은 실제 장소 그대로, key/blockId/arriveAt/endAt/tz/companions', pubOut.placeId === 'layered-yeonnam' && pubOut.key === actF.key && pubOut.blockId === 'pm' && pubOut.arriveAt === actF.arriveAt && pubOut.endAt === actF.endAt && pubOut.tz === SEOUL && pubOut.companions.includes(F.id) && pubOut.category === actF.option.category, JSON.stringify(pubOut));

// ── 서버 왕복 (sync.ts) — fetch를 흉내 낸다 ────────────────────────────────────
console.log('\n── sync: 발행·조회·친구 추가 ──');
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ME = 'me00000000000000000000000000000';
const SRV = agentOf(uid(900), '서버사람');
const server = { log: [], offline: false };
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  if (server.offline) throw new TypeError('fetch failed');
  const body = init.body ? JSON.parse(init.body) : undefined;
  server.log.push({ method, url, body });
  if (url.endsWith('/api/auth/login')) return json(200, { userId: ME, name: '나' });
  if (url.endsWith('/api/health')) return json(200, { ok: true });
  if (init.headers?.['x-user-id'] !== ME) return json(401, { error: 'unauthorized' });   // 보호 경로는 X-User-Id 하나 (AUTH-ADDENDUM)
  if (url.endsWith('/api/me/docs')) return json(200, { docs: {} });
  if (url.endsWith('/api/me/agent')) return json(200, { id: ME, name: body.name, homePlaceId: `home:${ME}`, color: body.color, emoji: body.emoji, hairStyle: body.hairStyle, likes: body.likes, traits: body.traits, home: { ...body.home, id: `home:${ME}`, type: 'friend_home', ownerFriendId: ME } });
  if (url.endsWith('/api/me/schedule')) return json(200, { count: body.activities.length });
  if (url.endsWith('/api/agents/at')) return json(200, { hits: Object.fromEntries(body.slots.map(s => [s.key, [{ agent: SRV, overlapMs: 40 * MIN, activity: pubOf(SRV.id, D, 'am', s.placeId, s.from - MIN, s.to + MIN) }]])) });
  if (/\/api\/friends\?at=\d+$/.test(url)) return json(200, { friends: [{ agent: F, metAt: 123, metPlaceId: 'jebi-dabang', now: pmF }] });
  if (/\/api\/friends\/[^/]+\/day\?from=\d+&to=\d+$/.test(url)) return json(200, { activities: [amF, pmF] });
  if (url.endsWith('/api/friends') && method === 'POST') return json(200, { ok: true, created: true });
  return json(404, { error: 'not found' });
};
const { bootstrapSync, publishAgent, publishSchedule, refreshRemote, addFriendRemote, syncArmed, syncSnapshot } = await import('../src/sim/sync.ts');
check('부트스트랩 전엔 전부 no-op', syncArmed() === false && (await publishSchedule(0, 1, [])) === false && (await refreshRemote({ slots: [{ key: 'k', placeId: 'p', from: 0, to: 1 }], friendsAt: null, days: null })) === null, '');
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: Date.now(), scale: 1 }));
storage.set('theworld.user.v1', JSON.stringify({ userId: ME, name: '나' }));   // 로그인 화면이 저장해 둔 사용자
await bootstrapSync();
check('부트스트랩 뒤 armed, 사용자 id (X-User-Id로 목록을 받았다)', syncArmed() && syncSnapshot().sync.userId === ME && server.log.some(l => l.url.endsWith('/api/me/docs')), JSON.stringify(syncSnapshot()));
server.log = [];
const home = placeById('home');
const prof = await publishAgent({ name: '모모', color: '#F6C445', emoji: '🐨', hairStyle: 'bob', likes: ['카페'], traits: ['느긋한'], home: { ...home, id: remoteHomeId(ME), name: '모모네 집', type: 'friend_home', ownerFriendId: ME } });
check('PUT /api/me/agent: 본문 모양(name/color/emoji/hairStyle/likes/traits/home) · 응답은 검증된 RemoteAgent', server.log[0]?.method === 'PUT' && server.log[0].url.endsWith('/api/me/agent') && server.log[0].body.home.type === 'friend_home' && prof?.id === ME && prof.home.ownerFriendId === ME && prof.homePlaceId === `home:${ME}`, JSON.stringify([server.log[0], prof]));
server.log = [];
const okS = await publishSchedule(dayStartOfKey(D), dayEndOfKey(D), [pubOut]);
check('PUT /api/me/schedule: {from,to,activities[]} · 200이면 true', okS && server.log[0]?.url.endsWith('/api/me/schedule') && server.log[0].body.from === dayStartOfKey(D) && server.log[0].body.activities[0].key === actF.key, JSON.stringify(server.log[0]?.body));
server.log = [];
const gotS = await refreshRemote({ slots: [{ key: actF.key, placeId: 'layered-yeonnam', from: actF.arriveAt, to: actF.endAt }], friendsAt: T0, days: { ids: [], from: dayStartOfKey(D), to: dayEndOfKey(addDaysKey(D, 1)) } });
const urls = server.log.map(l => `${l.method} ${l.url.replace(/=\d+/g, '=T')}`);
check('POST /api/agents/at → 슬롯에 hit(agentId·activity), 프로필은 agents에', gotS?.slots[actF.key]?.[0]?.agentId === SRV.id && gotS.slots[actF.key][0].activity.placeId === 'layered-yeonnam' && SRV.id in gotS.agents, JSON.stringify(gotS?.slots));
check('GET /api/friends?at= → friends[{agent, metAt, metPlaceId, now}]', gotS?.friends?.[0]?.agent.id === F.id && gotS.friends[0].metAt === 123 && gotS.friends[0].metPlaceId === 'jebi-dabang' && gotS.friends[0].now?.key === pmF.key, JSON.stringify(gotS?.friends));
check('친구 목록에서 새로 안 친구의 하루도 받는다 (GET /api/friends/{id}/day?from=&to=)', gotS?.days[F.id]?.length === 2 && urls.some(u => u === `GET /api/friends/${F.id}/day?from=T&to=T`), JSON.stringify(urls));
check('요청 순서: agents/at → friends → day', urls[0].startsWith('POST /api/agents/at') && urls[1].startsWith('GET /api/friends?at=') && urls[2].startsWith(`GET /api/friends/${F.id}/day`), urls.join(' | '));
check('backend ok · 오류 없음', syncSnapshot().backend === 'ok' && syncSnapshot().sync.lastError === null, JSON.stringify(syncSnapshot()));
server.log = [];
addFriendRemote(F.id, 777, 'jebi-dabang');
await sleep(20);
check('POST /api/friends {otherId, metAt, metPlaceId} (불 붙이고 잊는다)', server.log[0]?.method === 'POST' && server.log[0].url.endsWith('/api/friends') && JSON.stringify(server.log[0].body) === JSON.stringify({ otherId: F.id, metAt: 777, metPlaceId: 'jebi-dabang' }), JSON.stringify(server.log));
check('물을 게 없으면 요청도 없고 null', (await refreshRemote({ slots: [], friendsAt: null, days: null })) === null && server.log.length === 1, String(server.log.length));
server.offline = true;
check('오프라인이면 null (throw 없음), backend down', (await refreshRemote({ slots: [{ key: 'k', placeId: 'p', from: 0, to: 1 }], friendsAt: null, days: null })) === null && (await publishSchedule(0, 1, [])) === false && syncSnapshot().backend === 'down' && /schedule/.test(syncSnapshot().sync.lastError ?? ''), JSON.stringify(syncSnapshot()));
server.offline = false;

console.log(`\n${n - fails.length}/${n} checks passed${fails.length ? '\nFAILED: ' + fails.join('; ') : ''}`);
process.exit(fails.length ? 1 : 0);
