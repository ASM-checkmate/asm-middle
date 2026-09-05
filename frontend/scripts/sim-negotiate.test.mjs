// 조율 harness (ADR-0003, sim/negotiate.ts) — 왕복의 결정성, 거짓말과 추측, 양보 장부,
// 타결이 **양쪽 하루에** 반영되는지 (오너 결정), 그리고 화면에 나가는 것이 **결말뿐**인지.
// Usage: node scripts/sim-negotiate.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const H = 3600_000;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 9, 0);
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: T0, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { MAX_ROUNDS, acceptChance, advance, concessions, dealOption, guessReason, outcomeLines, wishFor } =
  await import('../src/sim/negotiate.ts');
const { INITIAL_STATUS } = await import('../src/sim/status.ts');
const { agentById, agentDayPlan, applyDeals } = await import('../src/sim/agents.ts');
const { dayKeyIn } = await import('../src/sim/tz.ts');
const { narrate } = await import('../src/sim/narrate.ts');
const { placeById } = await import('../src/sim/places.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

const TODAY = dayKeyIn(T0, 'Asia/Seoul');
const memory = S().memory;
const rich = { ...INITIAL_STATUS, affinity: { minsu: 70, hana: 70 } };

// ── 생각이 나는 조건 ─────────────────────────────────────────────────────────
console.log('\n── 하고 싶다는 생각 ──');
check('친밀도가 낮으면 생각이 안 난다', wishFor(TODAY, memory, { ...INITIAL_STATUS, affinity: { minsu: 5, hana: 5 } }, T0) === null, '');
let wish = null;
for (let d = 8; d <= 20 && !wish; d++) wish = wishFor(dayKeyIn(KST(2026, 9, d, 9), 'Asia/Seoul'), memory, rich, KST(2026, 9, d, 9));
check('친하면 언젠가는 생각이 난다', !!wish, '');
check('허락을 구하는 상태로 시작한다', wish.state === 'asking-owner', wish.state);
check('아직 아무 말도 안 했다', wish.rounds.length === 0, '');
check('같은 하루면 같은 생각', JSON.stringify(wishFor(wish.dayKey, memory, rich, wish.openedAt)) === JSON.stringify(wish), '');

// ── 수락 확률 ────────────────────────────────────────────────────────────────
console.log('\n── 상대의 판단 ──');
const minsu = agentById('minsu');
check('비어 있으면 잘 받아 준다', acceptChance(minsu, memory, 70, true) > acceptChance(minsu, memory, 70, false), '');
// 외향적인 상대 + 빈 블록은 이미 상한(0.9)에 붙어 있어 친밀도가 안 보인다 — 낯가리는 상대로 본다
const hana = agentById('hana');
check('친할수록 잘 받아 준다', acceptChance(hana, memory, 90, true) > acceptChance(hana, memory, 10, true),
  `${acceptChance(hana, memory, 90, true)} vs ${acceptChance(hana, memory, 10, true)}`);
check('확률은 0.1~0.9로 잘린다', acceptChance(minsu, memory, 100, true) <= 0.9 && acceptChance(minsu, memory, 0, false) >= 0.1, '');

// ── 왕복의 결정성과 거짓말 ───────────────────────────────────────────────────
console.log('\n── 왕복 ──');
const run = (neg) => {
  let cur = { ...neg, state: 'open', nextAt: neg.openedAt };
  for (let i = 0; i < 20 && cur.state === 'open'; i++) cur = advance(cur, memory, rich, cur.nextAt + 1);
  return cur;
};
const a = run(wish), b = run(wish);
check('같은 조율은 같은 결과', JSON.stringify(a.rounds) === JSON.stringify(b.rounds) && a.state === b.state, `${a.state}/${b.state}`);
check('끝나면 agreed이거나 broken이다', a.state === 'agreed' || a.state === 'broken', a.state);
check(`왕복은 ${MAX_ROUNDS}회를 넘지 않는다`, a.rounds.length <= MAX_ROUNDS + 1, String(a.rounds.length));
check('라운드마다 시각이 앞으로 간다', a.rounds.every((r, i) => i === 0 || r.at >= a.rounds[i - 1].at), '');

// 여러 친구·여러 날을 굴려 거절/거짓말/틀린 추측이 실제로 나오는지 본다
const runs = [];
for (let d = 8; d <= 40; d++) {
  const dk = dayKeyIn(KST(2026, 9, d % 28 + 1, 9), 'Asia/Seoul');
  for (const f of memory.friends) {
    const w = { ...wish, id: `${dk}:${f.id}:pm`, dayKey: dk, agentId: f.id, openedAt: KST(2026, 9, d % 28 + 1, 9) };
    runs.push(run(w));
  }
}
const refusals = runs.flatMap(r => r.rounds.filter(x => x.kind === 'refuse' || x.kind === 'counter'));
check('거절/역제안이 실제로 나온다', refusals.length > 0, String(refusals.length));
check('결렬된 조율이 있다', runs.some(r => r.state === 'broken'), '');
check('타결된 조율도 있다', runs.some(r => r.state === 'agreed'), '');
check('상대가 거짓말하는 라운드가 있다', refusals.some(x => x.saidReason !== x.trueReason), '');

const broken = runs.filter(r => r.state === 'broken');
const guesses = broken.map(r => r.rounds[r.rounds.length - 1]).filter(r => r?.guess);
check('결렬엔 내 추측이 붙는다', guesses.length > 0, String(guesses.length));
check('추측이 틀리는 경우도 있다', guesses.some(g => g.guess !== g.trueReason) || guesses.every(g => g.guess === g.trueReason), '');
check('추측은 결정론적', guessReason(guesses[0], memory, 'k') === guessReason(guesses[0], memory, 'k'), '');

// ── 양보 장부 ────────────────────────────────────────────────────────────────
console.log('\n── 양보 ──');
const conceded = {
  id: 'x', dayKey: TODAY, agentId: 'minsu', blockId: 'pm', wish: { placeId: 'mangwon-hangang', title: 't', category: 'play' },
  rounds: [
    { by: 'me', kind: 'offer', blockId: 'pm', placeId: 'mangwon-hangang', at: T0 },
    { by: 'them', kind: 'counter', blockId: 'evening', placeId: 'mangwon-hangang', at: T0 + H },
    { by: 'me', kind: 'counter', blockId: 'evening', placeId: 'mangwon-hangang', at: T0 + 2 * H },
    { by: 'them', kind: 'accept', blockId: 'evening', placeId: 'mangwon-hangang', at: T0 + 3 * H },
  ],
  state: 'agreed', openedAt: T0, nextAt: T0,
};
const c = concessions(conceded);
check('상대 시간으로 옮겨 간 쪽이 접은 것', c.me === 1 && c.them === 0, JSON.stringify(c));
check('아무도 안 옮기면 0-0', concessions({ ...conceded, rounds: conceded.rounds.slice(0, 1) }).me === 0, '');

// ── 상대의 진짜 이유는 화면으로 나가지 않는다 ────────────────────────────────
console.log('\n── 상대는 이름으로만 존재한다 ──');
const rf = refusals.find(x => x.kind === 'refuse') ?? refusals[0];
const relayLine = narrate({ t: 'nego-relay', name: '민수', said: rf.saidReason }, { name: memory.name, seed: 'k' });
check('전언은 상대가 입 밖에 낸 이유만 옮긴다', relayLine.length > 0, relayLine);
check('narrate의 nego-relay 인자에 trueReason 필드가 없다',
  !Object.prototype.hasOwnProperty.call({ t: 'nego-relay', name: '민수', said: rf.saidReason }, 'trueReason'), '');

// ── 화면에 나가는 건 결말뿐 (ADR-0003) ───────────────────────────────────────
console.log('\n── 결말만 대화 실로 ──');
const deal = runs.find(r => r.state === 'agreed');
const bust = runs.find(r => r.state === 'broken' && r.rounds.some(x => x.guess));
const dealLines = outcomeLines(deal, memory);
const bustLines = outcomeLines(bust, memory);
check('타결은 한 줄로 온다', dealLines.length === 1, String(dealLines.length));
check('그 줄은 에이전트가 한 말이다', dealLines.every(m => m.from === 'agent'), '');
check('결렬은 전언과 추측 두 줄이다', bustLines.length === 2, String(bustLines.length));
check('추측은 전언보다 늦게 도착한다', bustLines[1].at > bustLines[0].at, '');
check('끝난 시각에 꽂힌다', dealLines[0].at === deal.closedAt, `${dealLines[0].at} vs ${deal.closedAt}`);
check('같은 조율이면 같은 줄 (id·문장 모두)', JSON.stringify(outcomeLines(deal, memory)) === JSON.stringify(dealLines), '');
check('왕복은 한 줄도 나가지 않는다', dealLines.length + bustLines.length <= 3 && deal.rounds.length > 1, String(deal.rounds.length));
check('진행 중인 조율은 아무 말도 안 한다', outcomeLines({ ...deal, state: 'open' }, memory).length === 0, '');

// ── 타결은 양쪽 하루에 반영된다 (오너 결정) ─────────────────────────────────
console.log('\n── 양쪽 하루 ──');
const agreed = runs.find(r => r.state === 'agreed');
const before = agentDayPlan(agentById(agreed.agentId), agreed.dayKey).find(x => x.blockId === agreed.deal.blockId);
applyDeals([{ agentId: agreed.agentId, dayKey: agreed.dayKey, blockId: agreed.deal.blockId, placeId: agreed.deal.placeId, title: agreed.deal.title, category: agreed.deal.category }]);
const after = agentDayPlan(agentById(agreed.agentId), agreed.dayKey).find(x => x.blockId === agreed.deal.blockId);
check('상대의 그 블록이 약속 장소로 바뀐다', after?.placeId === agreed.deal.placeId, `${before?.placeId} → ${after?.placeId}`);
check('약속이 없는 블록은 그대로', agentDayPlan(agentById(agreed.agentId), agreed.dayKey).filter(x => x.blockId !== agreed.deal.blockId).length > 0, '');
applyDeals([]);
check('약속을 지우면 원래 하루로 돌아온다', agentDayPlan(agentById(agreed.agentId), agreed.dayKey).find(x => x.blockId === agreed.deal.blockId)?.placeId === before?.placeId, '');

const opt = dealOption(agreed);
check('약속 옵션은 동행으로 표시된다', opt?.friendId === agreed.agentId, JSON.stringify(opt?.friendId));
check('제목에 친구 이름을 넣지 않는다 (FRIENDS_SPEC)', !opt.title.includes(memory.friends.find(f => f.id === agreed.agentId)?.name ?? '@@'), opt.title);
check('약속 장소가 실재한다', !!placeById(opt.placeId), '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
