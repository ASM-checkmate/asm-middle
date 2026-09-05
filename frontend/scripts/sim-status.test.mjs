// 누적 상태 harness (ADR-0001, sim/status.ts) — 접기의 결정성, prune 불변, 용돈·수면 회복, v3 → v4 승급.
// Usage: node scripts/sim-status.test.mjs   (exit 1 on any failed check)
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
const T0 = KST(2026, 9, 8, 16, 0);
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

freezeClockAt(T0);
const { INITIAL_STATUS, MONTHLY_ALLOWANCE, SLEEP_RECOVERY, actDelta, applyDelta, costOf, foldStatus, validStatus, wonKo } =
  await import('../src/sim/status.ts');
const { placeById } = await import('../src/sim/places.ts');
const { dayKeyIn } = await import('../src/sim/tz.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

// ── 비용표 ────────────────────────────────────────────────────────────────────
console.log('\n── 비용 ──');
const cafe = placeById('layered-yeonnam');
const park = placeById('gyeongui-line-forest');
const walkLeg = { mode: 'walk', fromId: 'home', toId: cafe.id, path: [], distanceKm: 1.2, durationMin: 18, label: '걸어서', refined: false };
const trainLeg = { mode: 'train', fromId: 'home', toId: 'haeundae', path: [], distanceKm: 325, durationMin: 150, label: 'KTX', refined: false };

check('공원은 공짜', costOf('play', park, [], 120) === 0, String(costOf('play', park, [], 120)));
check('카페 2시간 = 8,500원', costOf('play', cafe, [], 120) === 8_500, String(costOf('play', cafe, [], 120)));
check('걸어가면 요금 0', costOf('play', cafe, [walkLeg], 120) === 8_500, String(costOf('play', cafe, [walkLeg], 120)));
check('KTX는 비싸다 (4만원 넘음)', costOf('travel', park, [trainLeg], 120) > 40_000, String(costOf('travel', park, [trainLeg], 120)));
check('일은 돈을 번다 (음수)', costOf('work', park, [], 240) < 0, String(costOf('work', park, [], 240)));
check('wonKo 음수 표기', wonKo(-3200) === '−3,200원', wonKo(-3200));

// ── 델타 ──────────────────────────────────────────────────────────────────────
console.log('\n── 활동 하나의 효과 ──');
const memory = { name: '토리', likes: ['커피', '그림 그리기'], dislikes: ['매운 거'], traits: ['느긋한'], homePlaceId: 'home', friends: [], visited: [] };
const mkAct = (place, category, opts = {}) => ({
  key: 'k', dayKey: dayKeyIn(T0, 'Asia/Seoul'), blockIds: ['pm'],
  option: { id: 'o', title: `${place.name}에서 커피`, reason: '그냥', emoji: '☕', placeId: place.id, category },
  place, fromPlace: placeById('home'), journey: { legs: [walkLeg], totalMin: 18 },
  departAt: T0, arriveAt: T0 + 18 * 60_000, endAt: T0 + 2 * H, comicUntil: T0 + 2 * H,
  originTz: 'Asia/Seoul', tz: 'Asia/Seoul', jetlagUntil: null, companions: [], ...opts,
});
const dCafe = actDelta(mkAct(cafe, 'play'), memory);
check('카페는 돈이 나간다', dCafe.money < 0, String(dCafe.money));
check('좋아하는 것이면 기분 +', dCafe.mood >= 6, String(dCafe.mood));
const dGym = actDelta(mkAct(placeById('home'), 'exercise'), memory);
check('운동은 피로가 크다', dGym.fatigue > actDelta(mkAct(placeById('home'), 'rest'), memory).fatigue, String(dGym.fatigue));
check('쉬기는 피로가 줄어든다', actDelta(mkAct(placeById('home'), 'rest'), memory).fatigue < 0, '');
const dWith = actDelta(mkAct(cafe, 'play', { companions: ['minsu'] }), memory);
check('동행은 친밀도를 올린다', (dWith.affinity?.minsu ?? 0) > 0, JSON.stringify(dWith.affinity));
check('동행은 기분도 올린다', dWith.mood > dCafe.mood, `${dWith.mood} vs ${dCafe.mood}`);

check('돈은 음수로 내려갈 수 있다 (밀어붙인 대가)', applyDelta({ ...INITIAL_STATUS, money: 1000 }, { money: -5000 }).money === -4000, '');
check('피로는 0~100으로 잘린다', applyDelta(INITIAL_STATUS, { fatigue: 999 }).fatigue === 100, '');
check('친밀도는 0~100으로 잘린다', applyDelta(INITIAL_STATUS, { affinity: { a: 999 } }).affinity.a === 100, '');

// ── 접기의 결정성과 prune 불변 ────────────────────────────────────────────────
console.log('\n── 접기 ──');
const s0 = S();
const anchor0 = s0.anchor;
const acts = s0.timeline;
const f1 = foldStatus(anchor0, acts, s0.now, s0.memory);
const f2 = foldStatus(anchor0, acts, s0.now, s0.memory);
check('같은 입력이면 같은 출력', JSON.stringify(f1) === JSON.stringify(f2), '');
check('스토어의 status가 접기와 같다', JSON.stringify(S().status) === JSON.stringify(f1), `${JSON.stringify(S().status)} vs ${JSON.stringify(f1)}`);
check('입력을 변형하지 않는다', anchor0.status === s0.anchor.status, '');

// prune 불변: 중간에서 한 번 구운 뒤 이어 접어도 통째로 접은 것과 같아야 한다
const mid = acts.length > 2 ? acts[Math.floor(acts.length / 2)].endAt : s0.now;
const baked = foldStatus(anchor0, acts, mid, s0.memory);
const midAct = acts.filter(a => a.endAt <= mid).pop();
const midAnchor = midAct
  ? { placeId: midAct.place.id, t: midAct.endAt, tz: midAct.tz, status: baked }
  : { ...anchor0, status: baked };
const twoStep = foldStatus(midAnchor, acts.filter(a => a.endAt > mid), s0.now, s0.memory);
const oneStep = foldStatus(anchor0, acts, s0.now, s0.memory);
check('prune 불변 — 나눠 접어도 같다 (money)', twoStep.money === oneStep.money, `${twoStep.money} vs ${oneStep.money}`);
check('prune 불변 — 나눠 접어도 같다 (fatigue)', near(twoStep.fatigue, oneStep.fatigue), `${twoStep.fatigue} vs ${oneStep.fatigue}`);

// ── 용돈은 재생해도 한 번만 ───────────────────────────────────────────────────
console.log('\n── 용돈과 밤 ──');
const anchorAug = { placeId: 'home', t: KST(2026, 8, 30, 0), tz: 'Asia/Seoul', status: { ...INITIAL_STATUS, money: 50_000, paidMonth: '2026-08' } };
const septAct = { ...mkAct(park, 'play'), dayKey: dayKeyIn(KST(2026, 9, 1, 12), 'Asia/Seoul'), endAt: KST(2026, 9, 1, 14) };
const paid = foldStatus(anchorAug, [septAct], KST(2026, 9, 2, 0), s0.memory);
check('달이 바뀌면 용돈이 들어온다', paid.money >= 50_000 + MONTHLY_ALLOWANCE - 1000, String(paid.money));
check('용돈 지급 달이 기록된다', paid.paidMonth === '2026-09', paid.paidMonth);
const paidAgain = foldStatus(anchorAug, [septAct], KST(2026, 9, 2, 0), s0.memory);
check('두 번 접어도 용돈은 한 번', paidAgain.money === paid.money, `${paidAgain.money} vs ${paid.money}`);

const tired = { ...anchorAug, status: { ...INITIAL_STATUS, fatigue: 90, paidMonth: '2026-09' } };
const rested = foldStatus(tired, [{ ...septAct, dayKey: dayKeyIn(KST(2026, 9, 1, 12), 'Asia/Seoul') }], KST(2026, 9, 2, 0), s0.memory);
check('날이 바뀌면 피로가 풀린다', rested.fatigue < 90 + SLEEP_RECOVERY.fatigue + 30, String(rested.fatigue));

// ── 저장과 승급 ───────────────────────────────────────────────────────────────
console.log('\n── 저장 ──');
const saved = JSON.parse(storage.get('theworld.world.v5'));
check('v5 키로 저장된다', !!saved && saved.v === 5, JSON.stringify(saved?.v));
check('anchor에 status가 실린다', !!saved.anchor.status && typeof saved.anchor.status.money === 'number', JSON.stringify(saved?.anchor?.status));
check('validStatus는 쓰레기를 걸러낸다', validStatus({ money: 'x', fatigue: 999 }).fatigue === 100, '');
check('validStatus는 null을 undefined로', validStatus(null) === undefined, '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
