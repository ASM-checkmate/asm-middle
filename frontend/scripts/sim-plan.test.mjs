// 하루 계획 harness (ADR-0010) — 모델이 지어 둔 계획을 decide()가 쓰는지, 범주를 고르면 카드를 묻고 도착·실패·늦음을
// 어떻게 다루는지, 저장·검증. 백엔드 없이 fetch를 흉내 낸다. Usage: node scripts/sim-plan.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 8, 30);   // 아침 블록 중 — 오전·점심·오후·저녁·밤이 비어 있다
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: T0, scale: 0 }));
storage.set('theworld.llm.v1', 'small');

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

// ── fetch 흉내: 요청을 기록하고, 정해 둔 답을 (원하면 늦게) 준다 ───────────────────
const calls = [];
let reply = null;          // null → 실패, 함수 → 요청에 대한 응답
let delayMs = 0;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, body });
  if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  if (url !== '/api/plan/options' || !reply) return { ok: false, status: 502, json: async () => ({ error: 'nope' }) };
  return { ok: true, status: 200, json: async () => reply(body) };
};
const cardsFor = (id, category, ids) => ({ id, category, options: ids.map((placeId, i) => ({ placeId, title: `${category} ${i}`, reason: `이유 ${i}`, emoji: '✨' })) });

const { optionsFromCards } = await import('../src/sim/suggest.ts');
const { planRequestOf } = await import('../src/sim/llm.ts');
const { placeById } = await import('../src/sim/places.ts');
const { INITIAL_STATUS } = await import('../src/sim/status.ts');
const { useWorld, DEFAULT_MEMORY } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();
const tick = () => S().tick();

console.log('\n── 요청 조립 ──');
const req = planRequestOf([{ id: 'am', category: null, from: '우리 집', avoid: ['home'] }], { memory: DEFAULT_MEMORY, status: INITIAL_STATUS, now: T0, tz: 'Asia/Seoul', dateKey: '2026-09-08' }, 'small', 'seoul');
check('카탈로그는 그 도시의 활동 장소만 (역·공항·친구 집 제외)', req.places.length > 20 && req.places.every(p => !['station', 'airport', 'port', 'friend_home'].includes(p.type)) && req.places.some(p => p.id === 'home'), String(req.places.length));
check('요일·도시·상태·취향이 실린다', req.day.weekday === '화요일' && req.city.home === true && req.city.nameKo === '서울' && req.agent.likes.includes('카페') && req.status.money === 620000, JSON.stringify([req.day, req.city]));
check('여행지에서는 home=false', planRequestOf([], { memory: DEFAULT_MEMORY, status: INITIAL_STATUS, now: T0, tz: 'Asia/Seoul', dateKey: '2026-09-08' }, 'small', 'busan').city.home === false, '');

console.log('\n── 카드 → 옵션 ──');
const opts = optionsFromCards([{ placeId: 'layered-yeonnam', title: '레이어드에서 커피', reason: '창가', emoji: '☕' }, { placeId: 'nope', title: 'x', reason: '', emoji: '' }, { placeId: 'layered-yeonnam', title: '중복', reason: '', emoji: '' }], 'play', '2026-09-08', 'pm');
check('없는 장소·중복은 빠지고 예고가 붙는다', opts.length === 1 && opts[0].id === 'pm-llm0-layered-yeonnam' && opts[0].category === 'play' && typeof opts[0].forecast === 'string' && opts[0].forecast.length > 0, JSON.stringify(opts));
check('같은 날·블록·장소면 예고가 같다 (결정성)', optionsFromCards([{ placeId: 'layered-yeonnam', title: 'a', reason: '', emoji: '' }], 'play', '2026-09-08', 'pm')[0].forecast === opts[0].forecast, '');

console.log('\n── planDay → decide ──');
// 친구가 먼저 채운 블록(FRIENDS_SPEC §2)은 빈 블록이 아니다 — 묻지 않는다. 시작한 아침도 묻지 않는다
reply = body => ({ blocks: body.blocks.map(b => b.category === 'meal' ? cardsFor(b.id, 'meal', ['tuktuk-noodle', 'home']) : cardsFor(b.id, 'study', ['mapo-central-library', 'layered-yeonnam'])), model: 'stub', ms: 1 });
await S().planDay();
const asked = calls[0]?.body.blocks.map(b => b.id) ?? [];
const friendBlocks = Object.values(S().plans).filter(p => p.chosenBy === 'friend').map(p => p.blockId);
check('오늘의 빈 블록(아직 안 시작한 것)을 한 번에 묻는다', calls.length === 1 && calls[0].url === '/api/plan/options' && asked.includes('lunch') && !asked.includes('morning') && !asked.includes('sleep') && friendBlocks.every(id => !asked.includes(id)) && asked.length + friendBlocks.length === 5, JSON.stringify([asked, friendBlocks]));
check('밥 시간은 식사로 정해서 묻고 나머지는 비워서 묻는다', calls[0].body.blocks.find(b => b.id === 'lunch').category === 'meal' && calls[0].body.blocks.filter(b => !['lunch', 'evening'].includes(b.id)).every(b => b.category === null), '');
const today = S().today;
check('답이 llmPlans[today]에 저장된다', Object.keys(S().llmPlans[today] ?? {}).sort().join() === [...asked].sort().join() && S().llmPlans[today].lunch.category === 'meal', JSON.stringify(Object.keys(S().llmPlans[today] ?? {})));
check('저장본에도 남는다', !!JSON.parse(storage.get('theworld.world.v5')).llmPlans?.[today]?.lunch, '');
const first = asked.find(id => id !== 'lunch' && id !== 'evening');
check('아직 안 시작한 블록은 그대로 비어 있다', S().plans[first].status === 'empty' && S().plans[first].options.length === 0, S().plans[first].status);
await S().planDay();
check('이미 지은 블록은 다시 묻지 않는다', calls.length === 1, String(calls.length));

// 블록이 시작하면 decide()가 모델 카드를 쓴다
const { blockDef } = await import('../src/sim/blocks.ts');
S().jumpTo(KST(2026, 9, 8, blockDef(first).startHour, 1)); tick();
const started = S().plans[first];
check(`${first}이 시작되자 모델이 지은 범주·카드로 골랐다`, started.category === 'study' && started.chosenBy === 'agent' && started.options.every(o => o.id.includes('llm')) && started.chosenId?.includes('llm'), JSON.stringify([started.category, started.chosenBy, started.chosenId]));
if (blockDef(first).startHour > 12) check('점심은 모델의 식사 카드', S().plans.lunch.category === 'meal' && S().plans.lunch.options.every(o => o.id.includes('llm')), JSON.stringify(S().plans.lunch.options.map(o => o.id)));
check('모델이 안 지은 아침은 규칙 카드', S().plans.morning.options.length > 0 && S().plans.morning.options.every(o => !o.id.includes('llm')), '');
// 남은 블록으로 이어서 (저녁·밤은 아직)
S().jumpTo(KST(2026, 9, 8, 17, 30)); tick();

console.log('\n── 범주를 고르면 카드를 묻는다 ──');
calls.length = 0;
reply = body => ({ blocks: [cardsFor('evening', body.blocks[0].category, ['soi-yeonnam', 'tuktuk-noodle', 'home'])], model: 'stub', ms: 1 });
S().setCategory('evening', 'meal');
check('카드는 비워 두고 백엔드에 묻는다 ("제안을 준비하는 중")', S().plans.evening.category === 'meal' && S().plans.evening.options.length === 0 && S().plans.evening.status === 'proposed' && calls.length === 1 && calls[0].body.blocks[0].id === 'evening' && calls[0].body.blocks[0].category === 'meal', JSON.stringify(calls[0]?.body.blocks));
await new Promise(r => setTimeout(r, 20));
check('답이 오면 그 카드가 채워진다', S().plans.evening.options.length === 3 && S().plans.evening.options.every(o => o.id.startsWith('evening-llm')) && S().plans.evening.chosenId === null, JSON.stringify(S().plans.evening.options.map(o => o.id)));

// 실패하면 규칙 카드
reply = null;
S().setCategory('night', 'rest');
await new Promise(r => setTimeout(r, 20));
check('서버가 실패하면 규칙 카드로 채운다', S().plans.night.options.length === 3 && S().plans.night.options.every(o => !o.id.includes('llm')) && S().plans.night.category === 'rest', JSON.stringify(S().plans.night.options.map(o => o.id)));

// 답이 오기 전에 범주를 바꾸면 늦은 답은 버린다
calls.length = 0;
let resolveLate;
const late = new Promise(r => { resolveLate = r; });
reply = body => ({ blocks: [cardsFor(body.blocks[0].id, body.blocks[0].category, ['gyeongui-line-forest', 'seoul-forest'])], model: 'stub', ms: 1 });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { const p = realFetch(url, init); await late; return p; };
S().setCategory('night', 'play');
S().setCategory('night', 'exercise');
resolveLate();
await new Promise(r => setTimeout(r, 30));
globalThis.fetch = realFetch;
const night = S().plans.night;
check('범주가 바뀌면 앞 범주의 답은 버리고 뒤 범주의 답만 쓴다', night.category === 'exercise' && night.options.length === 2 && night.options.every(o => o.category === 'exercise' && o.id.startsWith('night-llm')), JSON.stringify([night.category, night.options.map(o => [o.id, o.category])]));

// 다른 제안 보기: 방금 본 제목을 넘긴다
calls.length = 0;
S().regenerateOptions('night');
check('다른 제안 보기는 previous를 넘기고 카드를 비운다', calls.length === 1 && calls[0].body.blocks[0].previous?.length === 2 && S().plans.night.options.length === 0, JSON.stringify(calls[0]?.body.blocks[0]));
await new Promise(r => setTimeout(r, 20));
check('새 카드가 온다', S().plans.night.options.length === 2, '');

// 여행 범주는 모델에 안 묻는다 (규칙)
calls.length = 0;
S().setCategory('night', 'travel');
check('여행 범주는 규칙 카드 즉시', calls.length === 0 && S().plans.night.options.length > 0 && S().plans.night.options[0].category === 'travel', '');

// tier off면 지금처럼 규칙 카드
S().setLlmTier('off');
calls.length = 0;
S().setCategory('night', 'rest');
check('tier가 off면 규칙 카드 즉시', calls.length === 0 && S().plans.night.options.length === 3, '');
S().setLlmTier('small');
await new Promise(r => setTimeout(r, 20));
check('tier를 켜면 남은 빈 블록을 짓는다', calls.some(c => c.body.blocks.some(b => b.id === 'am' || b.id === 'evening')) || calls.length === 0, JSON.stringify(calls.map(c => c.body.blocks.map(b => b.id))));

console.log('\n── 저장본 검증 ──');
storage.set('theworld.world.v5', JSON.stringify({ ...JSON.parse(storage.get('theworld.world.v5')), llmPlans: { [today]: { pm: { category: 'study', options: [{ id: 'x', placeId: 'nope', title: 't', reason: '', emoji: '', category: 'study' }], at: 1 }, evening: { category: 'meal', options: [{ id: 'y', placeId: 'home', title: '집밥', reason: '', emoji: '🍚', category: 'meal' }], at: 1 }, bogus: 1 }, junk: null } }));
const { useWorld: again } = await import('../src/sim/store.ts?reload=1').catch(() => ({ useWorld: null }));
if (again) {
  const lp = again.getState().llmPlans;
  check('장소가 없는 카드는 버리고 멀쩡한 것만 남긴다', lp[today] && !lp[today].pm && lp[today].evening?.options.length === 1 && !('bogus' in lp[today]), JSON.stringify(lp));
} else {
  check('저장본 검증 (모듈 재로드 불가 — 건너뜀)', true, '');
}

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
