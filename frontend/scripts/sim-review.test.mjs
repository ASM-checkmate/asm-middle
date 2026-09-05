// 판단 harness (ADR-0001, sim/review.ts) — 반대·거절·역제안·밀어붙이기, 그리고 에이전트의 자기 선택도
// 같은 문을 지나는지. Usage: node scripts/sim-review.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 8, 50);      // 아침 끝자락 — 오전 블록은 아직 안 시작
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

freezeClockAt(T0);
const { LIMITS, PUSH_COST, fallbackOption, optionCost, review } = await import('../src/sim/review.ts');
const { INITIAL_STATUS } = await import('../src/sim/status.ts');
const { suggestOptions } = await import('../src/sim/suggest.ts');
const { placeById } = await import('../src/sim/places.ts');
const { blockStartAt, blockEndAt } = await import('../src/sim/blocks.ts');
const { dayKeyIn, dayStartIn } = await import('../src/sim/tz.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

const TZ = 'Asia/Seoul';
const memory = { name: '토리', likes: ['커피', '바다'], dislikes: ['매운 거'], traits: ['느긋한'], homePlaceId: 'home', friends: [], visited: [] };
const home = placeById('home');
const dayStart = dayStartIn(T0, TZ);
const today = dayKeyIn(T0, TZ);
const ctxOf = (status, blockId = 'am') => ({
  dayKey: today, status, memory, from: home, blockId,
  blockStart: blockStartAt(dayStart, blockId), blockEnd: blockEndAt(dayStart, blockId),
});
const opts = (category, blockId = 'am') =>
  suggestOptions({ dateKey: today, blockId, category, memory, from: home, usedPlaceIds: [] });

// ── 통과 ─────────────────────────────────────────────────────────────────────
console.log('\n── 받아들이는 경우 ──');
const rich = { ...INITIAL_STATUS };
const play = opts('play');
check('넉넉하면 통과한다 (null)', review(play[0], ctxOf(rich), play) === null, JSON.stringify(review(play[0], ctxOf(rich), play)));

// ── 돈 ───────────────────────────────────────────────────────────────────────
console.log('\n── 돈 ──');
const meal = opts('meal');
const mealCost = optionCost(meal[0], ctxOf(rich)).cost;
check('식사에는 돈이 든다', mealCost > 0, String(mealCost));
const tight = review(meal[0], ctxOf({ ...rich, money: mealCost - 4_200 }), meal);
check('모자라면 반대한다 (밀어붙일 수 있다)', tight?.kind === 'pushback' && tight.reason === 'no-money', JSON.stringify(tight));
check('근거로 남은 돈을 보여준다', !!tight?.evidence && tight.evidence.label === '남은 돈', JSON.stringify(tight?.evidence));
check('밀어붙이기 대가가 붙는다', tight?.cost?.mood === PUSH_COST.mood, JSON.stringify(tight?.cost));
const broke = review(meal[0], ctxOf({ ...rich, money: 0 }), meal);
check('지갑이 0이면 거절한다 (하한)', broke?.kind === 'refuse' && broke.reason === 'no-money', JSON.stringify(broke));
const freeWalk = { id: 'z', title: '경의선숲길 산책', reason: '바람 쐬고 싶음', emoji: '🍃', placeId: 'gyeongui-line-forest', category: 'play' };
check('걸어가는 공원은 공짜', optionCost(freeWalk, ctxOf(rich)).cost === 0, String(optionCost(freeWalk, ctxOf(rich)).cost));
check('공짜인 건 지갑이 0이어도 통과', review(freeWalk, ctxOf({ ...rich, money: 0 })) === null, JSON.stringify(review(freeWalk, ctxOf({ ...rich, money: 0 }))));

// ── 체력 ─────────────────────────────────────────────────────────────────────
console.log('\n── 체력 ──');
const ex = opts('exercise');
const soft = review(ex[0], ctxOf({ ...rich, fatigue: LIMITS.tiredSoft + 2 }), ex);
check('지치면 운동에 반대한다', soft?.kind === 'pushback' && soft.reason === 'too-tired', JSON.stringify(soft));
const hard = review(ex[0], ctxOf({ ...rich, fatigue: LIMITS.tiredHard + 2 }), ex);
check('하한 아래면 거절한다', hard?.kind === 'refuse' && hard.reason === 'too-tired', JSON.stringify(hard));
const restAtHome = { id: 'x', title: '집에서 쉬기', reason: '', emoji: '🛋️', placeId: 'home', category: 'rest' };
check('지쳐도 집에서 쉬기는 통과', review(restAtHome, ctxOf({ ...rich, fatigue: 99 })) === null, '');
check('fallbackOption은 언제나 통과', review(fallbackOption('am', memory), ctxOf({ ...rich, fatigue: 100, money: 0 })) === null, '');

// ── 싫어하는 것 ───────────────────────────────────────────────────────────────
console.log('\n── dislikes ──');
const spicy = { id: 'y', title: '매운 거 먹으러 가기', reason: '', emoji: '🌶️', placeId: 'home', category: 'meal' };
const dis = review(spicy, ctxOf(rich));
check('명시적으로 싫어하는 건 거절한다', dis?.kind === 'refuse' && dis.reason === 'dislike', JSON.stringify(dis));

// ── 역제안 ───────────────────────────────────────────────────────────────────
console.log('\n── 역제안 ──');
const counter = review(meal[0], ctxOf({ ...rich, money: mealCost - 4_200 }), meal);
if (counter?.counterOptionId) {
  check('역제안은 같은 블록의 다른 옵션', meal.some(o => o.id === counter.counterOptionId), counter.counterOptionId);
  check('역제안 자체는 통과하는 옵션', review(meal.find(o => o.id === counter.counterOptionId), ctxOf({ ...rich, money: mealCost - 4_200 })) === null, '');
  check('역제안 문구가 장소를 부른다', /어때|가면 안 돼|가자/.test(counter.line), counter.line);
} else {
  check('세 옵션이 다 막히면 역제안이 없다', counter?.counterOptionId === undefined, JSON.stringify(counter));
}
check('거절에는 역제안이 붙지 않는다', broke?.counterOptionId === undefined, JSON.stringify(broke?.counterOptionId));

// ── 결정성 ───────────────────────────────────────────────────────────────────
console.log('\n── 결정성 ──');
const a = review(meal[0], ctxOf({ ...rich, money: mealCost - 4_200 }), meal);
const b = review(meal[0], ctxOf({ ...rich, money: mealCost - 4_200 }), meal);
check('같은 입력 → 같은 판정과 같은 문장', JSON.stringify(a) === JSON.stringify(b), '');

// ── 스토어: 확정은 제안이 된다 ────────────────────────────────────────────────
console.log('\n── 스토어 ──');
const s0 = S();
const target = ['am', 'pm', 'evening'].find(id => {
  s0.selectBlock(id);
  return S().plans[id] !== undefined;
}) ?? 'am';
S().setCategory(target, 'meal');
let plan = S().plans[target];
check('범주를 고르면 제안 상태', plan.status === 'proposed' && plan.options.length === 3, JSON.stringify([plan.status, plan.options.length]));

// 지갑을 비워 거절을 유도한다 (anchor에 굽는다 — 스토어가 그 위에서 접는다)
const poor = { ...S().anchor, status: { ...(S().anchor.status ?? INITIAL_STATUS), money: 0 } };
useWorld.setState({ anchor: poor });
S().chooseOption(target, S().plans[target].options[0].id, 'user');
plan = S().plans[target];
const costly = optionCost(plan.options[0], ctxOf({ ...INITIAL_STATUS, money: 0 }, target)).cost > 0;
if (costly) {
  check('거절되면 chosenId가 안 바뀐다', plan.chosenId === null, String(plan.chosenId));
  check('판정이 계획에 실린다', plan.status === 'refused' && !!plan.verdict, JSON.stringify([plan.status, !!plan.verdict]));
  check('거절엔 밀어붙이기가 안 통한다', (S().pushAnyway(target), S().plans[target].chosenId === null), String(S().plans[target].chosenId));
} else {
  check('공짜라 통과했다', plan.status === 'confirmed', plan.status);
}

// 반대 → 밀어붙이기.
// statusAt은 anchor에서 그 블록까지 **접은** 값이라, anchor를 그냥 바꾸면 원하는 지갑이 안 나온다.
// 지금 접힌 값과 목표의 차이만큼 anchor를 밀어 준다.
S().clearVerdict(target);
const blockStart = blockStartAt(dayStartIn(S().now, S().tz), target);
const want = Math.max(1, optionCost(plan.options[0], ctxOf(INITIAL_STATUS, target)).cost - 3_000);
const folded = S().statusAt(blockStart).money;
const cur = S().anchor.status?.money ?? INITIAL_STATUS.money;
useWorld.setState({ anchor: { ...S().anchor, status: { ...(S().anchor.status ?? INITIAL_STATUS), money: cur + (want - folded) } } });
S().chooseOption(target, S().plans[target].options[0].id, 'user');
plan = S().plans[target];
if (plan.status === 'pushback') {
  const moodBefore = S().statusAt(S().now).mood;
  S().pushAnyway(target);
  plan = S().plans[target];
  check('밀어붙이면 확정된다', plan.status === 'forced' && plan.chosenId === plan.options[0].id, JSON.stringify([plan.status, plan.chosenId]));
  check('기분이 그만큼 떨어진다', S().statusAt(S().now).mood <= moodBefore + PUSH_COST.mood + 0.5, `${S().statusAt(S().now).mood} vs ${moodBefore}`);
} else {
  check('반대가 나오는 지갑이었다', false, plan.status);
}

// 에이전트의 자기 선택도 같은 문을 지난다
console.log('\n── 에이전트의 자기 선택 ──');
const started = S().plans[S().phase.currentBlockId ?? 'morning'];
check('시작된 블록은 에이전트가 확정해 둔다', !started || started.status === 'confirmed' || started.status === 'empty', started?.status);
check('fallbackOption은 집에서 쉬기', fallbackOption('am', memory).placeId === memory.homePlaceId, '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
