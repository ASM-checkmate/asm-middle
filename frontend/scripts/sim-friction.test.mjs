// 마찰 harness (ADR-0001, sim/friction.ts) — 굴림의 결정성, 우회가 여정에 붙는 방식, 발생 비율,
// 그리고 만화가 어긋남을 말하는지. Usage: node scripts/sim-friction.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 16, 0);
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

freezeClockAt(T0);
const { diverts, pickAlternative, rollFriction, weatherOf } = await import('../src/sim/friction.ts');
const { placeById } = await import('../src/sim/places.ts');
const { buildTimeline } = await import('../src/sim/timeline.ts');
const { makeComic } = await import('../src/sim/comic.ts');
const { dayKeyIn } = await import('../src/sim/tz.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

const TODAY = dayKeyIn(T0, 'Asia/Seoul');

// ── 날씨 ─────────────────────────────────────────────────────────────────────
console.log('\n── 날씨 ──');
check('하루 안에서 날씨는 하나다', weatherOf(TODAY) === weatherOf(TODAY), weatherOf(TODAY));
const days = Array.from({ length: 40 }, (_, i) => `2026-09-${String(i % 28 + 1).padStart(2, '0')}@Asia/Seoul`);
const rainy = days.filter(d => weatherOf(d) === 'rain').length;
check('비는 가끔 온다 (10~40%)', rainy / days.length >= 0.1 && rainy / days.length <= 0.4, `${rainy}/${days.length}`);

// ── 굴림의 결정성 ────────────────────────────────────────────────────────────
console.log('\n── 굴림 ──');
const cafe = placeById('layered-yeonnam');
const a1 = rollFriction('2026-09-08@Asia/Seoul:pm', cafe, TODAY);
const a2 = rollFriction('2026-09-08@Asia/Seoul:pm', cafe, TODAY);
check('같은 키 → 같은 결과', a1 === a2, `${a1} vs ${a2}`);
check('집에서는 마찰이 없다', rollFriction('k:1', placeById('home'), TODAY) === null, String(rollFriction('k:1', placeById('home'), TODAY)));

// 200개 활동에서의 발생 비율
const keys = Array.from({ length: 200 }, (_, i) => `2026-09-08@Asia/Seoul:b${i}`);
const hits = keys.map(k => rollFriction(k, cafe, TODAY)).filter(Boolean);
const rate = hits.length / keys.length;
check('마찰 비율이 10~35%', rate >= 0.1 && rate <= 0.35, `${(rate * 100).toFixed(0)}%`);
const detours = hits.filter(k => k === 'detour').length;
check('좋은 마찰(detour)이 섞여 있다', detours > 0, `${detours}/${hits.length}`);
check('detour는 발길을 돌린다', diverts('detour') === true, '');
check("sold-out은 제자리다", diverts('sold-out') === false, '');

// ── 대체 장소 ────────────────────────────────────────────────────────────────
console.log('\n── 대체 장소 ──');
const alt = pickAlternative(cafe, 'k:2', 'closed');
check('가까운 대안을 찾는다', !!alt && alt.id !== cafe.id, alt?.name ?? 'null');
check('같은 도시 안에서만', !alt || alt.city === cafe.city, alt?.city);
check('같은 키 → 같은 대안', pickAlternative(cafe, 'k:2', 'closed')?.id === alt?.id, '');
const rainAlt = pickAlternative(placeById('gyeongui-line-forest'), 'k:3', 'weather');
const INDOOR = ['cafe', 'library', 'mall', 'museum', 'restaurant'];
check('비가 오면 지붕 밑으로', !rainAlt || INDOOR.includes(rainAlt.type), rainAlt?.type);

// ── 타임라인에 붙는 방식 ─────────────────────────────────────────────────────
console.log('\n── 타임라인 ──');
const s = S();
const many = buildTimeline(s.anchor, s.days, s.memory, s.journeys, s.now + 4 * 24 * 3600_000, s.encounters);
const five = Array.from({ length: 5 }, () => buildTimeline(s.anchor, s.days, s.memory, s.journeys, s.now + 4 * 24 * 3600_000, s.encounters));
check('같은 세계를 다섯 번 빌드해도 결과가 같다',
  five.every(t => JSON.stringify(t.map(a => [a.key, a.place.id, a.outcome?.kind ?? null])) === JSON.stringify(many.map(a => [a.key, a.place.id, a.outcome?.kind ?? null]))), '');

const withFx = many.filter(a => a.outcome);
check('마찰이 실제로 생긴다', withFx.length > 0, `${withFx.length}/${many.length}`);
const diverted = withFx.filter(a => a.outcome.plannedPlaceId !== a.place.id);
if (diverted.length) {
  const d = diverted[0];
  check('우회하면 실제로 간 곳이 place다', d.place.id !== d.outcome.plannedPlaceId, `${d.place.id} / ${d.outcome.plannedPlaceId}`);
  check('우회는 여정에 구간을 덧붙인다', d.journey.legs.length >= 2, String(d.journey.legs.length));
  check('발길을 돌린 시각이 도착보다 이르다', d.outcome.divertedAt <= d.arriveAt, `${d.outcome.divertedAt} vs ${d.arriveAt}`);
  check('활동은 여전히 도착 뒤에 끝난다', d.endAt > d.arriveAt, '');
  check('판단 한 줄이 있다', typeof d.outcome.line === 'string' && d.outcome.line.length > 0, d.outcome.line);
} else {
  check('우회한 활동이 하나는 있다', false, '없음');
}
for (const a of many) check(`활동이 블록 안에서 끝난다 (${a.key})`, a.endAt <= a.comicUntil && a.arriveAt < a.endAt, `${a.arriveAt}/${a.endAt}`);

// ── 만화가 어긋남을 말한다 ───────────────────────────────────────────────────
console.log('\n── 만화 ──');
if (diverted.length) {
  const c = makeComic(diverted[0], s.memory);
  const text = c.panels.map(p => p.caption).join(' ');
  check('마찰 컷이 들어간다', /돌렸|왔다|피해|헛걸음|팔렸|샜|계획엔|기다리|서 있었/.test(text), text);
  check('요약이 비어 있지 않다', c.summary.length > 5, c.summary);
  check('캡션은 28자를 넘지 않는다', c.panels.every(p => [...p.caption].length <= 28), JSON.stringify(c.panels.map(p => [...p.caption].length)));
}

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
