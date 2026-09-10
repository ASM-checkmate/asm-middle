// 관계 사다리 harness (FRIENDS_SPEC §6, ADR-0022 — sim/timeline.ts addEncounters · sim/agents.ts castAt/castOfComic/learnedLine · sim/comic.ts cast ·
// sim/store.ts settle): 같은 공간(presentNearby)과 같이 놀기(companions)가 데이터에서 갈리는지, 말을 튼 순간(encounter.at)이 활동 안에서 결정적인지,
// castAt이 그 전엔 뒷모습·뒤엔 정면을 주는지, 동행이 끝나면 친구·우정·알게 된 것이 쌓이는지, 만화가 인물 구성을 기억하는지.
// Usage: node scripts/sim-ladder.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const MIN = 60_000, H = 3600_000;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 8, 50);
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { AGENTS, agentsAt, agentById, castAt, castOfComic, comicCastOf, friendOf, learnedLine, appendLearned, LEARNED_CAP, PRESENT_MAX, hairStyleOf } = await import('../src/sim/agents.ts');
const { panelCast, shotCastOf } = await import('../src/screens/util.ts');
const { buildTimeline, emptyPlans, presentIds, talkAt } = await import('../src/sim/timeline.ts');
const { makeComic } = await import('../src/sim/comic.ts');
const { PLACES, placeById } = await import('../src/sim/places.ts');
const { blockStartAt, blockEndAt, categoryDef } = await import('../src/sim/blocks.ts');
const { dayKeyIn, dayStartOfKey } = await import('../src/sim/tz.ts');

const TZ = 'Asia/Seoul';
// 외향적·수다스러운 + NPC 취향을 다 가진 나 — 말 걸 확률이 상한(0.9)에 붙어 며칠 안에 성사되는 활동이 나온다
const memory = { name: '토리', likes: [...new Set(AGENTS.flatMap(a => a.likes))], dislikes: [], traits: ['외향적', '수다스러운'], homePlaceId: 'home', friends: [], visited: [] };

// ── 순수 조각 ──────────────────────────────────────────────────────────────────
console.log('\n── presentIds · talkAt ──');
check('presentIds: id 오름차순, 중복 제거', presentIds(['b', 'a', 'b'], 'a').join() === 'a,b', presentIds(['b', 'a', 'b'], 'a').join());
check('presentIds: 최대 3', presentIds(['d', 'c', 'b', 'a'], 'a').join() === 'a,b,c', presentIds(['d', 'c', 'b', 'a'], 'a').join());
check('presentIds: 굴림 상대는 순서에서 밀려도 남는다', presentIds(['a', 'b', 'c', 'z'], 'z').join() === 'a,b,z', presentIds(['a', 'b', 'c', 'z'], 'z').join());
const cafe = placeById('layered-yeonnam');
const fakeAct = { key: 'k', dayKey: '2026-09-08@Asia/Seoul', place: cafe, arriveAt: 1_000_000, endAt: 1_000_000 + 100 * MIN, companions: [], presentNearby: [] };
const at1 = talkAt(fakeAct, 'me', 'jiwoo');
check('talkAt: 활동의 30~64 % 안', at1 >= fakeAct.arriveAt + 30 * MIN && at1 <= fakeAct.arriveAt + 64 * MIN, String((at1 - fakeAct.arriveAt) / MIN));
check('talkAt: 결정적', talkAt(fakeAct, 'me', 'jiwoo') === at1, '');
check('talkAt: 상대·날짜가 다르면 다른 순간', talkAt(fakeAct, 'me', 'hana') !== at1 || talkAt({ ...fakeAct, dayKey: '2026-09-09@Asia/Seoul' }, 'me', 'jiwoo') !== at1, '');
const spread = new Set(Array.from({ length: 40 }, (_, i) => talkAt({ ...fakeAct, dayKey: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}@Asia/Seoul`, key: `k${i}` }, 'me', AGENTS[i % 8].id)));
check('talkAt: 시드마다 퍼진다', spread.size > 20, String(spread.size));

// ── 타임라인: 같은 공간의 사람들 ─────────────────────────────────────────────────
console.log('\n── presentNearby ──');
// 서울 장소·날·블록을 훑어 NPC 둘 이상이 30분 넘게 겹치는 활동을 찾는다 (풀의 하루는 시드로 결정적이라 반드시 있다)
const seoul = PLACES.filter(p => p.city === 'seoul' && p.type !== 'home' && p.type !== 'friend_home');
const found = [];
for (let d = 8; d <= 20 && found.length < 12; d++) {
  const dayKey = `2026-09-${String(d).padStart(2, '0')}@${TZ}`;
  const dayStart = dayStartOfKey(dayKey);
  for (const blockId of ['am', 'pm', 'evening']) {
    const from = blockStartAt(dayStart, blockId) + 25 * MIN, to = blockEndAt(dayStart, blockId) - 25 * MIN;
    for (const p of seoul) {
      const hits = agentsAt(p.id, from, to, AGENTS).filter(x => x.overlapMs >= 30 * MIN);
      if (hits.length >= 2) found.push({ dayKey, blockId, place: p, hits: hits.map(h => h.agent.id) });
    }
  }
}
check('NPC 둘 이상이 같은 곳에 있는 활동 후보가 있다', found.length > 0, String(found.length));
const build = (c, mem = memory) => {
  const dayStart = dayStartOfKey(c.dayKey);
  const opt = { id: `o-${c.place.id}`, title: `${c.place.name}에서 시간 보내기`, reason: '', emoji: c.place.emoji, placeId: c.place.id, category: 'play' };
  const plans = emptyPlans();
  plans[c.blockId] = { blockId: c.blockId, category: 'play', options: [opt], chosenId: opt.id, chosenBy: 'user', status: 'confirmed' };
  const anchor = { placeId: 'home', t: dayStart + 7 * H, tz: TZ };
  const tl = buildTimeline(anchor, { [c.dayKey]: plans }, mem, {}, blockEndAt(dayStart, c.blockId));
  return tl.find(a => a.blockIds[0] === c.blockId);
};
const acts = found.map(c => [c, build(c)]).filter(([, a]) => a && a.presentNearby.length >= 2);
check('그 활동의 presentNearby에 둘 이상이 적힌다', acts.length > 0, JSON.stringify(found.slice(0, 3).map(c => [c.place.id, c.hits])));
const [cand, act] = acts[0] ?? [null, null];
if (act) {
  check('presentNearby: id 오름차순, 최대 3', act.presentNearby.length <= 3 && [...act.presentNearby].sort().join() === act.presentNearby.join(), act.presentNearby.join());
  check('presentNearby: 전부 그 자리에 30분 넘게 있던 사람', act.presentNearby.every(id => cand.hits.includes(id) || agentsAt(act.place.id, act.arriveAt, act.endAt, AGENTS).some(x => x.agent.id === id && x.overlapMs >= 30 * MIN)), act.presentNearby.join());
  check('마주침(굴림 상대)도 presentNearby 안에 있다', !!act.encounter && act.presentNearby.includes(act.encounter.agentId), JSON.stringify(act.encounter));
  check('동행은 presentNearby에 없다', !act.presentNearby.some(id => act.companions.includes(id)), '');
  check('같은 입력이면 같은 presentNearby·encounter', JSON.stringify([build(cand).presentNearby, build(cand).encounter]) === JSON.stringify([act.presentNearby, act.encounter]), '');
}
const talkedActs = acts.map(([, a]) => a).filter(a => a.encounter?.talked);
const seenActs = acts.map(([, a]) => a).filter(a => a.encounter && !a.encounter.talked);
check('말을 튼 활동과 못 튼 활동이 둘 다 있다', talkedActs.length > 0 && seenActs.length > 0, `talked ${talkedActs.length} seen ${seenActs.length}`);
const talked = talkedActs[0], seen = seenActs[0];
if (talked) {
  const e = talked.encounter;
  check('talked: encounter.at이 활동 안(30~64 %)에 있다', typeof e.at === 'number' && e.at >= talked.arriveAt + (talked.endAt - talked.arriveAt) * 0.3 && e.at <= talked.arriveAt + (talked.endAt - talked.arriveAt) * 0.64, JSON.stringify([e.at, talked.arriveAt, talked.endAt]));
  check('talked: at은 3컷째(65 %) 전이다 — 만남 장면이 정면으로 나온다', e.at <= talked.arriveAt + (talked.endAt - talked.arriveAt) * 0.65, '');
}
if (seen) check('seen: at이 없다 (말을 안 텄으니 끝까지 배경)', seen.encounter.at === undefined, JSON.stringify(seen.encounter));

// ── castAt: 전엔 뒷모습, 뒤엔 정면 ─────────────────────────────────────────────
console.log('\n── castAt ──');
if (talked) {
  const e = talked.encounter;
  const before = castAt(talked, e.at - 1, memory), after = castAt(talked, e.at, memory);
  check('at 전: met 없음, 그 사람은 present(배경)에', !before.met && before.present.some(p => p.id === e.agentId), JSON.stringify(before));
  check('at 부터: met = 그 사람, present에선 빠진다', after.met?.agent.id === e.agentId && after.met.color === agentById(e.agentId).color && !after.present.some(p => p.id === e.agentId), JSON.stringify(after));
  check('present는 최대 둘', before.present.length <= PRESENT_MAX && after.present.length <= PRESENT_MAX, '');
  check('present 항목: id·색·(허용값일 때만) 머리 모양', before.present.every(p => typeof p.id === 'string' && /^#/.test(p.color) && (p.hairStyle === undefined || hairStyleOf(agentById(p.id)) === p.hairStyle)), JSON.stringify(before.present));
  check('companions는 memory.friends(없으면 풀)에서', castAt({ ...talked, companions: ['minsu'] }, e.at, memory).companions[0]?.id === 'minsu', '');
  check('동행은 present에 안 나온다', !castAt({ ...talked, companions: [talked.presentNearby[0]] }, talked.arriveAt, memory).present.some(p => p.id === talked.presentNearby[0]), '');
  check('at 없는 옛 마주침은 처음부터 met', castAt({ ...talked, encounter: { agentId: e.agentId, talked: true } }, talked.arriveAt, memory).met?.agent.id === e.agentId, '');
}
if (seen) check('seen: 끝까지 met 없음, 배경에만', !castAt(seen, seen.endAt, memory).met && castAt(seen, seen.endAt, memory).present.some(p => p.id === seen.encounter.agentId), JSON.stringify(castAt(seen, seen.endAt, memory)));
// 셋이 같은 곳에 있고 굴림 상대의 id가 맨 뒤일 때 — presentNearby는 셋을 남기지만 그림은 둘(PRESENT_MAX)이라, id 순서대로 자르면 대화 전엔 안 보이다가 at에 불쑥 나타난다
if (talked) {
  const e = talked.encounter;
  const span = talked.endAt - talked.arriveAt;
  const three = { ...talked, encounter: { agentId: 'taerin', talked: true, at: e.at }, presentNearby: ['hana', 'jiwoo', 'taerin'] };
  const b3 = castAt(three, e.at - 1, memory), a3 = castAt(three, e.at, memory);
  check('셋 중 id가 맨 뒤인 굴림 상대: at 전엔 배경의 맨 앞 (잘리지 않는다)', !b3.met && b3.present.length === PRESENT_MAX && b3.present[0].id === 'taerin' && b3.present[1].id === 'hana', JSON.stringify(b3.present));
  check('…at 부터는 met, 배경은 나머지 둘(id 순)', a3.met?.agent.id === 'taerin' && a3.present.map(p => p.id).join() === 'hana,jiwoo', JSON.stringify(a3.present));
  const seen3 = castAt({ ...three, encounter: { agentId: 'taerin', talked: false } }, three.endAt, memory);
  check('말 못 건 굴림 상대도 끝까지 배경의 맨 앞', !seen3.met && seen3.present[0].id === 'taerin' && seen3.present.length === PRESENT_MAX, JSON.stringify(seen3.present));
  const again3 = castAt({ ...three, encounter: { ...three.encounter, again: true } }, e.at - 1, { ...memory, friends: [friendOf(agentById('taerin'))] });
  check('again(이미 친구)도 at 전엔 배경의 맨 앞', !again3.met && again3.present[0].id === 'taerin', JSON.stringify(again3.present));
  const c3 = makeComic(three, memory).cast;
  check('comicCastOf: 굴림 상대가 present 맨 앞, 나머지는 id 순', c3.present.map(p => p.id).join() === 'taerin,hana,jiwoo' && c3.met?.id === 'taerin', JSON.stringify(c3));
  const p1 = castOfComic(c3, three.arriveAt + span * 0.05), p3 = castOfComic(c3, three.arriveAt + span * 0.65);
  check('castOfComic: 1컷은 그 사람이 배경 맨 앞, 3컷은 met + 나머지 둘', !p1.met && p1.present.length === PRESENT_MAX && p1.present[0].id === 'taerin' && p3.met?.id === 'taerin' && p3.present.map(p => p.id).join() === 'hana,jiwoo', JSON.stringify([p1, p3]));
  const oldCast = { ...c3, present: [...c3.present].sort((a, b) => (a.id < b.id ? -1 : 1)) };
  check('옛 저장본(present가 id 순)도 castOfComic이 굴림 상대를 앞에 둔다', castOfComic(oldCast, three.arriveAt).present[0].id === 'taerin', JSON.stringify(castOfComic(oldCast, three.arriveAt).present));
}

// ── 만화가 인물 구성을 기억한다 ───────────────────────────────────────────────────
console.log('\n── comic.cast ──');
if (talked) {
  const e = talked.encounter;
  const comic = makeComic(talked, memory);
  check('makeComic: cast가 실린다 (met.at = encounter.at, present = presentNearby — 굴림 상대가 맨 앞)', comic.cast && comic.cast.met?.id === e.agentId && comic.cast.met.at === e.at && comic.cast.present.map(p => p.id).sort().join() === [...talked.presentNearby].sort().join() && comic.cast.present[0].id === e.agentId && comic.cast.companions.length === 0, JSON.stringify(comic.cast));
  check('makeComic: cast는 comicCastOf와 같고 결정적', JSON.stringify(comic.cast) === JSON.stringify(comicCastOf(talked, memory)) && JSON.stringify(makeComic(talked, memory)) === JSON.stringify(comic), '');
  const c0 = castOfComic(comic.cast, comic.panels[0].t), c3 = castOfComic(comic.cast, comic.panels[3].t);
  check('castOfComic: 1컷(5 %)은 그 사람이 배경, 4컷(95 %)은 정면', !c0.met && c0.present.some(p => p.id === e.agentId) && c3.met?.id === e.agentId && !c3.present.some(p => p.id === e.agentId), JSON.stringify([c0, c3]));
  check('castOfComic: 3컷(65 %)은 만남 장면 — 정면', castOfComic(comic.cast, comic.panels[2].t).met?.id === e.agentId, '');
  check('castOfComic: present는 최대 둘', c0.present.length <= PRESENT_MAX, '');
  const plain = makeComic({ ...talked, encounter: undefined, presentNearby: [] }, memory);
  check('마주침 없는 활동: cast는 비어 있다', plain.cast && !plain.cast.met && plain.cast.present.length === 0 && plain.panels.length === 4, JSON.stringify(plain.cast));
  // 캡션·기울기 골든 — cast를 싣는 일이 comic:/shot: 난수 순서를 건드리지 않았는지 (값은 ADR-0022 직전 HEAD의 makeComic에서 뽑았다; 캡션 문구·크롭 규칙을
  // 일부러 바꿨을 때만 다시 뽑는다: node -e 로 아래 golden(comic)을 찍으면 된다)
  const golden = c => JSON.stringify(c.panels.map(p => [p.caption, p.crop.rot]));
  check('골든: 마주침 있는 만화의 캡션·기울기가 그대로', golden(comic) === JSON.stringify([['망원시장 도착. 오늘은 뭘 먹지.', 14.5], ['시간 보내기. 양손에 봉지가 하나씩.', 0.1], ['"내일 오세요." 알겠습니다…', 0.1], ['친구가 한 명 늘었다. 민수.', 1.6]]), golden(comic));
  check('골든: 마주침 없는 만화의 캡션·기울기가 그대로', golden(plain) === JSON.stringify([['망원시장 도착. 오늘은 뭘 먹지.', 14.5], ['시간 보내기. 양손에 봉지가 하나씩.', 0.1], ['"내일 오세요." 알겠습니다…', 0.1], ['시장 냄새가 옷에 배었다.', 1.6]]), golden(plain));
}

// ── 컷의 인물 (screens/util panelCast): cast가 있으면 그것이 전부, 만난 사람은 컷 시각이 정한다 ─────────────
console.log('\n── panelCast ──');
{
  const tc = { friendColor: undefined, metColor: '#F6C445', present: [{ color: '#8FD694' }] };   // comic.cast에서 되찾은 at 뒤의 컷: 동행 없음, 만난 사람, 배경 하나
  const F0 = '#A9DCF5';   // memory.friends[0] 색 — 옛 경로의 대체값
  check('timed: at 뒤 컷은 withFriend가 아니어도 만난 사람 정면', panelCast({ by: 'agent', withFriend: false }, tc, F0, true).metColor === '#F6C445', '');
  check('timed: 동행 없는 cast에 friendColor(memory.friends[0])를 채우지 않는다 — 유령 동행 없음', panelCast({ by: 'agent', withFriend: true }, tc, F0, true).friendColor === undefined && panelCast({ by: 'agent', withFriend: true }, tc, F0, true).metColor === '#F6C445', '');
  const before = panelCast({ by: 'agent', withFriend: false }, { present: [{ color: '#8FD694' }] }, F0, true);
  check('timed: at 전 컷(met 없음)은 배경만', !before.metColor && !before.friendColor && before.present?.length === 1, JSON.stringify(before));
  check('timed: 동행은 withFriend 컷에만 (1컷은 혼자 도착)', panelCast({ by: 'agent', withFriend: false }, { friendColor: '#5FC9A6' }, F0, true).friendColor === undefined && panelCast({ by: 'agent', withFriend: true }, { friendColor: '#5FC9A6' }, F0, true).friendColor === '#5FC9A6', '');
  check('옛 경로(castOf, 시각 없음): 만난 사람은 withFriend 컷에만', !panelCast({ by: 'agent', withFriend: false }, tc, F0, false).metColor && panelCast({ by: 'agent', withFriend: true }, tc, F0, false).metColor === '#F6C445', '');
  check('cast 없는 옛 만화: withFriend면 friendColor로 동행만', panelCast({ by: 'agent', withFriend: true }, undefined, F0, false).friendColor === F0 && !panelCast({ by: 'agent', withFriend: false }, undefined, F0, false).friendColor, '');
  const user = panelCast({ by: 'user', withFriend: false }, { friendColor: '#5FC9A6', metColor: '#F6C445' }, F0, false);
  check('사용자 컷: 찍을 때 서 있던 그대로 (withFriend 무관)', user.friendColor === '#5FC9A6' && user.metColor === '#F6C445', JSON.stringify(user));
  if (talked) {
    const e = talked.encounter, metColor = agentById(e.agentId).color;
    const comic = makeComic(talked, memory);
    check('진짜 만화: at 뒤의 모든 컷에 만난 사람, 그 전엔 없다', comic.panels.every(p => panelCast(p, shotCastOf(castOfComic(comic.cast, p.t)), F0, true).metColor === (p.t >= comic.cast.met.at ? metColor : undefined)), JSON.stringify(comic.panels.map(p => [p.t >= comic.cast.met.at, p.withFriend])));
    check('진짜 만화: 동행이 없으니 어느 컷에도 friendColor가 없다', comic.panels.every(p => panelCast(p, shotCastOf(castOfComic(comic.cast, p.t)), F0, true).friendColor === undefined), '');
    // 이미 친구를 또 만난 활동(again): 4컷의 withFriend는 동행 굴림뿐이라 false여도, 만난 사람은 at 뒤라 나온다
    const againComic = makeComic({ ...talked, encounter: { ...e, again: true } }, { ...memory, friends: [friendOf(agentById(e.agentId))] });
    const p4 = againComic.panels[3];
    check('again: 4컷은 withFriend가 아니어도 만난 친구가 정면', !p4.withFriend && panelCast(p4, shotCastOf(castOfComic(againComic.cast, p4.t)), F0, true).metColor === metColor, JSON.stringify([p4.withFriend, againComic.cast]));
  }
}

// ── 알게 된 것 ────────────────────────────────────────────────────────────────
console.log('\n── learnedLine ──');
if (talked) {
  const l1 = learnedLine(talked, 'jiwoo', categoryDef('play').label, []);
  check('learnedLine: 한 줄, 결정적', typeof l1 === 'string' && l1.length > 0 && learnedLine(talked, 'jiwoo', '놀기', []) === l1, String(l1));
  check('learnedLine: 이미 적힌 줄은 피한다', learnedLine(talked, 'jiwoo', '놀기', [l1]) !== l1, '');
  check('learnedLine: 다른 활동이면 다른 시드', learnedLine({ ...talked, key: 'other' }, 'jiwoo', '놀기', []) !== l1 || learnedLine({ ...talked, key: 'other2' }, 'jiwoo', '놀기', []) !== l1, '');
  const twelve = Array.from({ length: LEARNED_CAP }, (_, i) => `x${i}`);
  check('appendLearned: 중복은 안 붙고, 12개 넘으면 오래된 것부터 버린다', appendLearned(['a'], 'a').join() === 'a' && appendLearned(twelve, 'new').length === LEARNED_CAP && appendLearned(twelve, 'new').at(-1) === 'new' && !appendLearned(twelve, 'new').includes('x0') && appendLearned(undefined, null).length === 0, '');
}

// ── settle: 같이 놀았으면 SNS 친구, 우정 +1, 알게 된 것 +1 ────────────────────────
console.log('\n── settle (store) ──');
freezeClockAt(T0);
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();
S().tick();
const today = S().today;
check('오늘', today === dayKeyIn(T0, TZ), today);
const dayStart = dayStartOfKey(today);
const NPC = 'jiwoo';   // 풀에만 있고 친구는 아닌 사람
check('지우는 아직 친구가 아니다', !S().memory.friends.some(f => f.id === NPC), '');
const planWith = (blockId, place, friendId) => {
  const opt = { id: `ladder-${blockId}`, title: `${place.name}에서 같이 놀기`, reason: '검사용', emoji: place.emoji, placeId: place.id, category: 'play', friendId };
  const plans = { ...S().plans, [blockId]: { blockId, category: 'play', options: [opt], chosenId: opt.id, chosenBy: 'user', status: 'confirmed' } };
  useWorld.setState({ plans, days: { ...S().days, [today]: plans } });
};
planWith('am', cafe, NPC);
S().jumpTo(blockStartAt(dayStart, 'am') + 1000);
const am = S().timeline.find(a => a.dayKey === today && a.blockIds[0] === 'am');
check('오전 동행 활동이 잡힌다 (companions = [지우])', !!am && am.companions.join() === NPC, JSON.stringify(am?.companions));
if (am) {
  check('동행은 presentNearby에 없다', !am.presentNearby.includes(NPC), am.presentNearby.join());
  S().jumpTo(am.endAt - 5 * MIN);
  check('끝나기 전엔 아직 친구가 아니다', !S().memory.friends.some(f => f.id === NPC), '');
  S().jumpTo(am.endAt + 2 * MIN);
  S().tick();
  const f1 = S().memory.friends.find(f => f.id === NPC);
  check('끝나면 자동으로 SNS 친구 — metAt·metPlaceId는 그 활동', !!f1 && f1.metAt === am.endAt && f1.metPlaceId === cafe.id && f1.name === '지우', JSON.stringify(f1));
  check('bond 1, learned 한 줄', f1?.bond === 1 && f1?.learned?.length === 1, JSON.stringify(f1));
  const expected = learnedLine(am, NPC, categoryDef('play').label, []);
  check('learned 줄은 규칙대로 (learnedLine과 같다)', f1?.learned?.[0] === expected, JSON.stringify([f1?.learned, expected]));
  check('memory 문서에 저장된다', JSON.parse(storage.get('theworld.memory.v2') ?? '{}').friends?.find(f => f.id === NPC)?.bond === 1, storage.get('theworld.memory.v1')?.slice(0, 80));
  check('책의 만화가 cast를 들고 있다 (동행 = 지우)', S().book.find(c => c.id === `c:${am.key}`)?.cast?.companions?.[0]?.id === NPC, JSON.stringify(S().book.find(c => c.id === `c:${am.key}`)?.cast));
  check('book 문서에도 cast가 실린다', JSON.parse(storage.get('theworld.book.v1') ?? '[]').find(c => c.id === `c:${am.key}`)?.cast?.companions?.[0]?.id === NPC, '');
  check('마주침 카운트는 동행으로 오르지 않는다', !S().encounters[NPC], JSON.stringify(S().encounters));
  check('같은 공간의 사람은 전부 마주침 카운트에 (§6 표 — 관계 효과 없음, 카운트만)', am.presentNearby.every(id => (S().encounters[id] ?? 0) >= 1), JSON.stringify([am.presentNearby, S().encounters]));
  if (am.encounter?.talked) check('말을 튼 상대도 같이 논 것 — bond 1, learned 한 줄', S().memory.friends.find(f => f.id === am.encounter.agentId)?.bond === 1 && S().memory.friends.find(f => f.id === am.encounter.agentId)?.learned?.length === 1, JSON.stringify(S().memory.friends.find(f => f.id === am.encounter.agentId)));
  S().jumpTo(am.endAt + 3 * MIN);
  S().tick();
  check('같은 활동은 두 번 세지 않는다 (settle 멱등)', S().memory.friends.find(f => f.id === NPC)?.bond === 1, '');

  // 두 번째 동행 → bond 2, learned 2 (다른 줄)
  const park = placeById('gyeongui-line-forest');
  planWith('pm', park, NPC);
  S().jumpTo(blockStartAt(dayStart, 'pm') + 1000);
  const pm = S().timeline.find(a => a.dayKey === today && a.blockIds[0] === 'pm');
  check('오후 동행 활동이 잡힌다', !!pm && pm.companions.join() === NPC, JSON.stringify(pm?.companions));
  if (pm) {
    S().jumpTo(pm.endAt + 2 * MIN);
    S().tick();
    const f2 = S().memory.friends.find(f => f.id === NPC);
    check('두 번째 동행: bond 2, learned 두 줄(서로 다름)', f2?.bond === 2 && f2?.learned?.length === 2 && f2.learned[0] !== f2.learned[1], JSON.stringify(f2));
    check('metAt은 처음 것 그대로', f2?.metAt === am.endAt, '');
    // 12개 상한: 가짜 12줄을 채운 뒤 세 번째 동행 — 새 줄이 맨 뒤, 가장 오래된 줄이 빠진다
    const stuffed = Array.from({ length: LEARNED_CAP }, (_, i) => `가짜 ${i}`);
    useWorld.setState({ memory: { ...S().memory, friends: S().memory.friends.map(f => f.id === NPC ? { ...f, learned: stuffed } : f) } });
    planWith('evening', placeById('soi-yeonnam'), NPC);
    S().jumpTo(blockStartAt(dayStart, 'evening') + 1000);
    const ev = S().timeline.find(a => a.dayKey === today && a.blockIds[0] === 'evening');
    if (ev) {
      S().jumpTo(ev.endAt + 2 * MIN);
      S().tick();
      const f3 = S().memory.friends.find(f => f.id === NPC);
      check('learned는 12개까지 — 새 줄이 맨 뒤, "가짜 0"이 빠진다', f3?.learned?.length === LEARNED_CAP && !f3.learned.includes('가짜 0') && !f3.learned.at(-1).startsWith('가짜'), JSON.stringify(f3?.learned));
      check('bond 3 — 친한 친구 문턱', f3?.bond === 3, String(f3?.bond));
    } else check('저녁 동행 활동이 잡힌다', false, JSON.stringify(S().timeline.map(a => a.key)));
  }
}

// 결정성: 새 스토어(빈 저장본)에서 같은 하루를 살면 같은 learned 줄
storage.clear();
freezeClockAt(T0);
const { useWorld: w2 } = await import('../src/sim/store.ts?ladder=2');
const S2 = () => w2.getState();
S2().tick();
{
  const opt = { id: 'ladder-am', title: `${cafe.name}에서 같이 놀기`, reason: '검사용', emoji: cafe.emoji, placeId: cafe.id, category: 'play', friendId: NPC };
  const plans = { ...S2().plans, am: { blockId: 'am', category: 'play', options: [opt], chosenId: opt.id, chosenBy: 'user', status: 'confirmed' } };
  w2.setState({ plans, days: { ...S2().days, [S2().today]: plans } });
  S2().jumpTo(blockStartAt(dayStart, 'am') + 1000);
  const a2 = S2().timeline.find(a => a.dayKey === S2().today && a.blockIds[0] === 'am');
  if (a2) { S2().jumpTo(a2.endAt + 2 * MIN); S2().tick(); }
  const g = S2().memory.friends.find(f => f.id === NPC);
  check('다른 기기(새 스토어)에서도 같은 learned 줄', !!g && g.learned?.[0] === (am ? learnedLine(am, NPC, categoryDef('play').label, []) : null), JSON.stringify(g?.learned));
}

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
