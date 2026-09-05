// FRIENDS_SPEC harness — runs the real sim (src/sim/**) in node against a fixed clock: no prefill, friend
// proposals, companions, 마주침 and the talk roll, and the 체류 일수 override.
// Usage: node scripts/sim-friends.test.mjs   (exit 1 on any failed check)
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
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

freezeClockAt(T0);
const { CATEGORIES, BLOCK_ORDER } = await import('../src/sim/blocks.ts');
const { AGENTS, agentDayPlan, agentById, agentsAt, isAgentFreeAt, talkChance, rollTalk, companionCtx } = await import('../src/sim/agents.ts');
const { STAY_CHOICES, withStayDays, stayDaysFor } = await import('../src/sim/suggest.ts');
const { placeById } = await import('../src/sim/places.ts');
const { dayKeyIn, dayStartOfKey, addDaysKey } = await import('../src/sim/tz.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

console.log('\n── 범주에서 만남이 사라졌다 ──');
check("CATEGORIES has no 'social'", !CATEGORIES.some(c => c.id === 'social'), CATEGORIES.map(c => c.id).join(','));
check('7 categories (수면 제외)', CATEGORIES.length === 7, String(CATEGORIES.length));

console.log('\n── agents ──');
check('8 agents (친구 2 + NPC 6)', AGENTS.length === 8, String(AGENTS.length));
check('every agent has a real home place', AGENTS.every(a => placeById(a.homePlaceId).ownerFriendId === a.id));
const plan = agentDayPlan(agentById('minsu'), '2026-09-03@Asia/Seoul');
check('민수 lives a 6-block day', plan.length === 6, String(plan.length));
check('…deterministic', JSON.stringify(agentDayPlan(agentById('minsu'), '2026-09-03@Asia/Seoul')) === JSON.stringify(plan));
check('meal blocks eat', plan.filter(a => ['morning', 'lunch', 'evening'].includes(a.blockId)).every(a => a.option.category === 'meal'));
check('isAgentFreeAt is stable', isAgentFreeAt(agentById('hana'), 'pm', '2026-09-03@Asia/Seoul') === isAgentFreeAt(agentById('hana'), 'pm', '2026-09-03@Asia/Seoul'));

console.log('\n── 08:50 KST: 시간표는 미리 채우지 않는다 ──');
S().tick();
const today = S().today;
check('today is the Seoul day', today === '2026-09-03@Asia/Seoul', today);
check('morning (started) was decided by the agent', S().plans.morning.chosenBy === 'agent', String(S().plans.morning.chosenBy));
const future = ['am', 'lunch', 'pm', 'evening', 'night'].map(b => S().plans[b]);
check('future blocks are empty unless a friend proposed', future.every(p => (!p.chosenId && !p.category && !p.options.length) || p.chosenBy === 'friend'),
  JSON.stringify(future.map(p => [p.blockId, p.category, p.chosenBy])));
check('at most 2 friend proposals a day', future.filter(p => p.chosenBy === 'friend').length <= 2);

console.log('\n── 친구가 먼저 계획하면 일단 채워 둔다 ──');
const propBlock = ['am', 'lunch', 'pm', 'evening', 'night'].find(b => S().plans[b].chosenBy === 'friend');
check('a friend proposal pre-filled a future block', !!propBlock, JSON.stringify(future.map(p => [p.blockId, p.chosenBy])));
if (!propBlock) { console.log('cannot continue'); process.exit(1); }
const pp = S().plans[propBlock];
const companion = pp.options.find(o => o.id === pp.chosenId);
check('the proposal is chosen, by the friend', pp.chosenBy === 'friend' && !!companion, JSON.stringify([pp.chosenBy, pp.chosenId]));
check('companion option carries friendId + proposedBy', !!companion.friendId && companion.proposedBy === companion.friendId, JSON.stringify([companion.friendId, companion.proposedBy]));
check('the friend really goes there in that block', agentDayPlan(agentById(companion.friendId), today).find(a => a.blockId === propBlock)?.placeId === companion.placeId);
check('three options: the companion plan + two normal ones', pp.options.length === 3 && pp.options.filter(o => o.proposedBy).length === 1, String(pp.options.length));
let act = S().timeline.find(a => a.dayKey === today && a.blockIds[0] === propBlock);
check('the timeline carries the companion', !!act && act.companions.includes(companion.friendId), JSON.stringify(act?.companions));

console.log('\n── 주인이 바꾸면 동행은 취소된다 ──');
const other = pp.options.find(o => o.id !== companion.id);
S().chooseOption(propBlock, other.id, 'user');
check('changed by the owner → chosenBy user', S().plans[propBlock].chosenBy === 'user', String(S().plans[propBlock].chosenBy));
act = S().timeline.find(a => a.dayKey === today && a.blockIds[0] === propBlock);
check('…the friend goes alone (no companion on my activity)', !!act && act.companions.length === 0, JSON.stringify(act?.companions));
S().tick();
check('…and the agent does not put the proposal back', S().plans[propBlock].chosenId === other.id, String(S().plans[propBlock].chosenId));
S().chooseOption(propBlock, companion.id, 'user');
check('re-choosing the proposal restores the companion plan', S().plans[propBlock].chosenBy === 'friend', String(S().plans[propBlock].chosenBy));
act = S().timeline.find(a => a.dayKey === today && a.blockIds[0] === propBlock);
check('…and the companion is back on the timeline', !!act && act.companions.includes(companion.friendId), JSON.stringify(act?.companions));

console.log('\n── 제목에는 친구 이름을 넣지 않는다 ──');
const NAMES = AGENTS.map(a => a.name);
const titles = [];
for (const b of BLOCK_ORDER) {
  for (const c of ['meal', 'play', 'rest', 'exercise', 'study', 'work']) {
    if (b === 'sleep') continue;
    const { suggestOptions } = await import('../src/sim/suggest.ts');
    for (const o of suggestOptions({ dateKey: today, blockId: b, category: c, memory: S().memory, from: placeById('home'), companions: companionCtx(S().memory, b, today, dayStartOfKey(today)) })) {
      if (placeById(o.placeId).type !== 'friend_home') titles.push(o.title);   // 친구 집은 장소 이름에 이름이 들어간다 (스펙 허용)
    }
  }
}
check(`${titles.length} titles carry no friend name`, titles.every(t => !NAMES.some(nm => t.includes(nm))), titles.filter(t => NAMES.some(nm => t.includes(nm))).join(' | '));
check('no title carries a {friend} template', titles.every(t => !t.includes('{friend}')));
const companionOpts = [];
for (const b of ['am', 'pm', 'evening']) {
  const { suggestOptions } = await import('../src/sim/suggest.ts');
  const opts = suggestOptions({ dateKey: today, blockId: b, category: 'play', memory: S().memory, from: placeById('home'), companions: companionCtx(S().memory, b, today, dayStartOfKey(today)) });
  companionOpts.push(opts.filter(o => o.friendId).length);
}
check('at most 1 companion variant per set of 3', companionOpts.every(c => c <= 1), companionOpts.join(','));

console.log('\n── 마주침과 말 걸 확률 ──');
const chanceBase = talkChance({ myTraits: [], myLikes: [], agent: { id: 'x', name: 'x', homePlaceId: 'home', color: '#000', emoji: '🙂', likes: [], traits: [] }, placeType: 'cafe', overlapMs: 30 * MIN, metBefore: false });
check('base chance = 0.35', Math.abs(chanceBase - 0.35) < 1e-9, String(chanceBase));
const chanceMax = talkChance({ myTraits: ['외향적'], myLikes: ['a', 'b', 'c', 'd'], agent: { id: 'x', name: 'x', homePlaceId: 'home', color: '#000', emoji: '🙂', likes: ['a', 'b', 'c', 'd'], traits: ['수다스러운'] }, placeType: 'bar', overlapMs: 2 * H, metBefore: true });
check('all bonuses clamp at 0.9', chanceMax === 0.9, String(chanceMax));
const chanceMin = talkChance({ myTraits: ['낯가리는'], myLikes: [], agent: { id: 'x', name: 'x', homePlaceId: 'home', color: '#000', emoji: '🙂', likes: [], traits: ['조용한'] }, placeType: 'library', overlapMs: 10 * MIN, metBefore: false });
check('penalties clamp at 0.1', chanceMin === 0.1, String(chanceMin));
check('the roll is deterministic', rollTalk(today, 'p', 'me', 'you', 0.5) === rollTalk(today, 'p', 'me', 'you', 0.5));
check('agentsAt finds agents at a place', agentsAt('home', T0, T0 + H).length === 0);

const byKey = new Map();
// 창을 넉넉히 잡는다: 말 걸기는 확률(기본 35%)이라 며칠짜리 창은 마찰·제안이 바뀔 때마다 깨진다.
// 여기서 보려는 건 "말 걸기가 실제로 성사되기는 하는가"이지 "닷새 안에 되는가"가 아니다.
for (let d = 3; d <= 14; d++) {
  S().jumpTo(KST(2026, 9, d, 23, 55));
  for (const a of S().timeline) if (a.encounter) byKey.set(a.key, a);
}
const seen = [...byKey.values()];
const talked = seen.filter(a => a.encounter.talked && !a.encounter.again);
check('마주침 happened on the timeline', seen.length > 0, String(seen.length));
check('an encounter is a 30-min overlap at the same place', seen.every(a => agentsAt(a.place.id, a.arriveAt, a.endAt).some(x => x.agent.id === a.encounter.agentId && x.overlapMs >= 30 * MIN)));
const perDay = {};
for (const a of talked) perDay[a.dayKey] = (perDay[a.dayKey] ?? 0) + 1;
check('at most one new friend talked to per day', Object.values(perDay).every(v => v === 1), JSON.stringify(perDay));
check('a talk actually landed', talked.length > 0, String(talked.length));

console.log('\n── 말을 걸면 친구가 된다 (활동이 끝난 뒤) ──');
// 아직 정산되지 않은(= friends에 없는) 첫 talk을 고른다. 위 스캔이 이미 여러 날을 살았기 때문에
// 시간을 되감아도 친구 목록은 줄지 않는다 — "끝나기 전엔 친구가 아니다"는 아직 안 산 talk으로 확인한다.
const first = talked.find(a => !S().memory.friends.some(f => f.id === a.encounter.agentId)) ?? talked[0];
const fresh = !S().memory.friends.some(f => f.id === first.encounter.agentId);
freezeClockAt(first.endAt - 5 * MIN);
S().jumpTo(first.endAt - 5 * MIN);
if (fresh) check('before the activity ends: not a friend yet', !S().memory.friends.some(f => f.id === first.encounter.agentId), first.encounter.agentId);
else check('이미 정산된 talk이라 이 검사는 건너뛴다', true, '');
S().jumpTo(first.endAt + 2 * MIN);   // 만화 구간 — 활동이 끝나면 그 자리에서 정산된다
S().tick();
const made = S().memory.friends.find(f => f.id === first.encounter.agentId);
check('after it ends: a new friend with metAt / metPlaceId', !!made && made.metAt === first.endAt && made.metPlaceId === first.place.id, JSON.stringify(made));
check('the encounter log counted it', (S().encounters[first.encounter.agentId] ?? 0) >= 1, JSON.stringify(S().encounters));

const metDay = dayKeyIn(first.endAt, S().tz);
const okOn = day => BLOCK_ORDER.some(b => b !== 'sleep' && companionCtx(S().memory, b, day, dayStartOfKey(day)).homeOk(made.id));
// 새 친구의 집은 다음 날부터 후보 — 그 친구가 집에 있는 블록이 있는 첫 날을 찾아서 확인한다
check("the new friend's home is not suggestable today", !okOn(metDay));
const { isAgentHomeAt } = await import('../src/sim/agents.ts');
let laterOk = false;
for (let d = 1; d <= 4 && !laterOk; d++) {
  const day = addDaysKey(metDay, d);
  if (BLOCK_ORDER.some(b => b !== 'sleep' && isAgentHomeAt(agentById(made.id), b, day))) laterOk = okOn(day);
}
check('…but it is once they are home on a later day', laterOk);
// 오늘도 집에 있는 블록이 있었다면, 막힌 이유가 metAt 게이트라는 것까지 확인
const homeBlockToday = BLOCK_ORDER.find(b => b !== 'sleep' && isAgentHomeAt(agentById(made.id), b, metDay));
if (homeBlockToday) check('…and today it is the metAt gate that blocks it', !companionCtx(S().memory, homeBlockToday, metDay, dayStartOfKey(metDay)).homeOk(made.id));

console.log('\n── 체류 일수 (FRIENDS_SPEC §5) ──');
storage.clear();
freezeClockAt(T0);
const { useWorld: w2 } = await import('../src/sim/store.ts?stay=1');
const S2 = () => w2.getState();
S2().tick();
S2().setCategory('am', 'travel');
let trip = null;
for (let i = 0; i < 12 && !trip; i++) {
  trip = S2().plans.am.options.find(o => placeById(o.placeId).city === 'busan') ?? null;
  if (!trip) S2().regenerateOptions('am');
}
check('a 부산 trip is offered', !!trip, S2().plans.am.options.map(o => o.title).join(' | '));
if (!trip) process.exit(1);
check('부산 defaults to 1박 (당일치기 옵션이면 0)', trip.title.includes('당일치기') ? trip.stayDays === 0 : trip.stayDays === 1 && /\(1박\)$/.test(trip.title), `${trip.stayDays} ${trip.title}`);
check('제주는 2박', stayDaysFor(placeById('hyeopjae')) === 2, String(stayDaysFor(placeById('hyeopjae'))));
check('도쿄는 2박, 뉴욕은 3박', stayDaysFor(placeById('moma')) === 3 && stayDaysFor(placeById('shibuya')) === 2);
check('국내 체류 칩 = 당일치기·1박·2박', JSON.stringify(STAY_CHOICES(trip)) === '[0,1,2]', JSON.stringify(STAY_CHOICES(trip)));
check('해외 체류 칩 = 1·2·3·5박', JSON.stringify(STAY_CHOICES({ ...trip, placeId: 'moma' })) === '[1,2,3,5]');
check('withStayDays rewrites the suffix', withStayDays(trip, 2).title.endsWith('(2박)') && withStayDays(trip, 0).title.endsWith('당일치기'), withStayDays(trip, 0).title);
S2().chooseOption('am', trip.id, 'user', 2);
const stored = S2().plans.am.options.find(o => o.id === trip.id);
check('the plan stores the override', stored.stayDays === 2 && /\(2박\)$/.test(stored.title), `${stored.stayDays} ${stored.title}`);
const busanTrip = S2().timeline.find(a => a.option.id === trip.id);
check('the trip is on the timeline', !!busanTrip);
const arriveDay = dayKeyIn(busanTrip.arriveAt, busanTrip.tz);
const homeOf = day => { S2().jumpTo(dayStartOfKey(day) + 7 * H + 30 * MIN); const p = S2().plans.morning; return p.options.find(o => o.id === p.chosenId)?.placeId; };
check('day 1 in 부산: not going home yet', homeOf(addDaysKey(arriveDay, 1)) !== 'home', String(homeOf(addDaysKey(arriveDay, 1))));
check('day 2 (= stayDays): the way home is auto-picked', homeOf(addDaysKey(arriveDay, 2)) === 'home', String(homeOf(addDaysKey(arriveDay, 2))));

console.log(`\n${n - fails.length}/${n} checks passed${fails.length ? '\nFAILED: ' + fails.join('; ') : ''}`);
process.exit(fails.length ? 1 : 0);
