// TIMEZONE_SPEC harness — runs the real sim (src/sim/**) in node against a fixed clock and walks a Seoul → New York
// trip and back. Usage: node scripts/sim-tz.test.mjs   (exit 1 on any failed check; prints the lived timeline)
import './ts-hooks.mjs';

// ── localStorage shim (the store guards every access, but the clock/seen/days keys drive the scenario) ──
const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const H = 3600_000, MIN = 60_000;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);     // Asia/Seoul  = UTC+9
const EDT = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h + 4, mi);     // New York in September = UTC−4
const SEOUL = 'Asia/Seoul', NY = 'America/New_York';
const T0 = KST(2026, 9, 3, 8, 50);

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
/** freeze the sim clock at `t` (scale 0 → simNow() === t until the next jump) */
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

freezeClockAt(T0);
const tz = await import('../src/sim/tz.ts');
const { hhmmIn, dayKeyIn, dayStartIn, dayStartOfKey, addDaysKey, offsetMinutes } = tz;
const { isBlockEditable } = await import('../src/sim/timeline.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();
const fmt = (t, z) => `${dayKeyIn(t, z).split('@')[0]} ${hhmmIn(t, z)}`;
/** waiting/active/comic carry `jetlag`; a journey (moving) shows it through its activity's inherited window */
const jetlagOf = (p, t) => ('jetlag' in p ? p.jetlag : p.kind === 'moving' ? p.act.jetlagUntil !== null && t < p.act.jetlagUntil : null);

console.log('\n── tz helpers ──');
check('offsetMinutes Seoul = 540', offsetMinutes(SEOUL, T0) === 540, String(offsetMinutes(SEOUL, T0)));
check('offsetMinutes New York (Sept) = −240', offsetMinutes(NY, T0) === -240, String(offsetMinutes(NY, T0)));
check('dayStartIn Seoul = 00:00 KST', dayStartIn(T0, SEOUL) === KST(2026, 9, 3, 0), fmt(dayStartIn(T0, SEOUL), SEOUL));
check('dayStartIn New York = 00:00 EDT of Sep 2', dayStartIn(T0, NY) === EDT(2026, 9, 2, 0), fmt(dayStartIn(T0, NY), NY));
check('dayStartOfKey round-trips', dayStartOfKey('2026-09-03@America/New_York') === EDT(2026, 9, 3, 0));
check('addDaysKey +3', addDaysKey('2026-09-03@America/New_York', 3) === '2026-09-06@America/New_York', addDaysKey('2026-09-03@America/New_York', 3));

console.log('\n── 08:50 KST, home in Seoul ──');
S().tick();
check('today is the Seoul day', S().today === '2026-09-03@Asia/Seoul', S().today);
check('phase: waiting in Asia/Seoul', S().phase.kind === 'waiting' && S().phase.tz === SEOUL, `${S().phase.kind} ${S().phase.tz}`);
check('am block is editable', isBlockEditable(T0, 'am', S().today, S().timeline, S().anchor));
check('morning already auto-picked by the agent (started block)', S().plans.morning.chosenBy === 'agent', String(S().plans.morning.chosenBy));

// the travel category; regenerate until a New York option shows up (the rng rotates trip kinds)
let opt = null;
S().setCategory('am', 'travel');
for (let i = 0; i < 12 && !opt; i++) {
  opt = S().plans.am.options.find(o => o.placeId === 'moma' || o.placeId === 'central-park') ?? null;
  if (!opt) S().regenerateOptions('am');
}
check('a New York option is offered', !!opt, JSON.stringify(S().plans.am.options.map(o => o.title)));
// FRIENDS_SPEC (오너): 여행 범주는 기차·배·가까운 비행·먼 비행을 한 칸씩 — 뉴욕이 셔플에 밀려 사라지면 안 된다
const { placeById: pid } = await import('../src/sim/places.ts');
for (let i = 0; i < 6; i++) {
  const cities = S().plans.am.options.map(o => pid(o.placeId).city);
  check(`travel set #${i} always offers 뉴욕`, cities.includes('newyork'), cities.join(','));
  S().regenerateOptions('am');
}
S().setCategory('am', 'travel');
opt = null;
for (let i = 0; i < 12 && !opt; i++) {
  opt = S().plans.am.options.find(o => o.placeId === 'moma' || o.placeId === 'central-park') ?? null;
  if (!opt) S().regenerateOptions('am');
}
check('a New York place option is still reachable', !!opt, JSON.stringify(S().plans.am.options.map(o => o.title)));
if (!opt) process.exit(1);
if (!opt) { console.log('cannot continue'); process.exit(1); }
check('trip title carries "(3박)"', /\(3박\)$/.test(opt.title), opt.title);
check('trip stayDays = 3', opt.stayDays === 3, String(opt.stayDays));
S().chooseOption('am', opt.id, 'user');
const trip = S().timeline.find(a => a.option.id === opt.id);
check('trip is on the timeline', !!trip);
check('trip planned in the Seoul day', trip.dayKey === '2026-09-03@Asia/Seoul', trip.dayKey);
check('trip departs 09:00 KST', trip.departAt === KST(2026, 9, 3, 9, 0), fmt(trip.departAt, SEOUL));
check('trip originTz Asia/Seoul → tz America/New_York', trip.originTz === SEOUL && trip.tz === NY, `${trip.originTz} → ${trip.tz}`);
check('flight is ICN → JFK', trip.journey.legs.some(l => l.mode === 'plane' && l.fromId === 'incheon-airport' && l.toId === 'jfk'), trip.journey.legs.map(l => `${l.mode}:${l.fromId}>${l.toId}`).join(' '));
check('jetlagUntil = arriveAt + 24 h', trip.jetlagUntil === trip.arriveAt + 24 * H);
check('departure-day blocks stay Asia/Seoul (phase.tz)', S().phase.tz === SEOUL, S().phase.tz);
check('evening (Seoul day) is covered by the trip → not editable', !isBlockEditable(T0, 'evening', S().today, S().timeline, S().anchor));
const snapshotAfterPlanning = new Map(storage);

console.log('\n── in the air ──');
S().jumpTo(KST(2026, 9, 3, 12, 30));
check('12:30 KST: moving, onboard meal, tz Asia/Seoul', S().phase.kind === 'moving' && S().phase.onboard === 'meal' && S().phase.tz === SEOUL, `${S().phase.kind} ${S().phase.onboard} ${S().phase.tz}`);
check('12:30 KST: today still the Seoul day', S().today === '2026-09-03@Asia/Seoul', S().today);
S().jumpTo(KST(2026, 9, 4, 2, 0));
check('02:00 KST next day: moving, onboard sleep', S().phase.kind === 'moving' && S().phase.onboard === 'sleep', `${S().phase.kind} ${S().phase.onboard}`);
check('02:00 KST: phase.tz still Asia/Seoul (origin blocks)', S().phase.tz === SEOUL, S().phase.tz);
check('02:00 KST: today is the Seoul Sep 4 day (in flight)', S().today === '2026-09-04@Asia/Seoul', S().today);
check('02:00 KST: nothing planned for that day (all blocks unreachable)', Object.values(S().plans).every(p => p.blockId === 'sleep' || !p.chosenId), JSON.stringify(Object.values(S().plans).filter(p => p.chosenId).map(p => p.blockId)));

console.log('\n── landed in New York ──');
S().jumpTo(trip.arriveAt + MIN);
const nyDay = dayKeyIn(trip.arriveAt, NY);
check('phase: active in America/New_York', S().phase.kind === 'active' && S().phase.tz === NY, `${S().phase.kind} ${S().phase.tz}`);
check('jetlag chip on', S().phase.jetlag === true);
check(`today = ${nyDay}`, S().today === nyDay, S().today);
check('tz = America/New_York', S().tz === NY, S().tz);
const later = ['evening', 'night'].map(b => S().plans[b]);
// FRIENDS_SPEC §1: 아직 시작 안 한 블록은 비어 있다 (친구 제안만 예외)
check('evening/night of the NY day are NOT pre-filled', later.every(p => !p.chosenId || p.chosenBy === 'friend'), JSON.stringify(later.map(p => [p.blockId, p.chosenBy])));
const { placeById } = await import('../src/sim/places.ts');
check('NY morning/am/lunch (before/under the flight) not editable', ['morning', 'am', 'lunch'].every(b => !isBlockEditable(trip.arriveAt + MIN, b, S().today, S().timeline, S().anchor)));
check('NY evening editable', isBlockEditable(trip.arriveAt + MIN, 'evening', S().today, S().timeline, S().anchor));
S().jumpTo(dayStartOfKey(nyDay) + 18 * H + 5 * MIN);
const ev = S().plans.evening;
check('NY evening is decided once it starts', !!ev.chosenId, JSON.stringify([ev.category, ev.chosenBy]));
check('…with New York places only', ev.options.length > 0 && ev.options.every(o => placeById(o.placeId).city === 'newyork'), ev.options.map(o => `${o.placeId}:${placeById(o.placeId).city}`).join(','));

S().jumpTo(trip.arriveAt + 23 * H);
check('23 h after arrival: jetlag still on', jetlagOf(S().phase, S().now) === true, `${S().phase.kind} jetlag=${jetlagOf(S().phase, S().now)}`);
S().jumpTo(trip.arriveAt + 25 * H);
check('25 h after arrival: jetlag off', jetlagOf(S().phase, S().now) === false, `${S().phase.kind} jetlag=${jetlagOf(S().phase, S().now)}`);

console.log('\n── sleeping abroad ──');
S().jumpTo(EDT(2026, 9, 4, 3, 0));
check('03:00 EDT: sleeping, tz America/New_York, in New York', S().phase.kind === 'sleeping' && S().phase.tz === NY && S().phase.at.city === 'newyork', `${S().phase.kind} ${S().phase.tz} ${S().phase.at?.city}`);
S().jumpTo(KST(2026, 9, 5, 3, 0));   // = 14:00 EDT Sep 4
check('03:00 KST (14:00 EDT): NOT sleeping', S().phase.kind !== 'sleeping', S().phase.kind);
check('…and the day is a New York day', S().today.endsWith('@' + NY), S().today);

console.log('\n── the way home (arrival date + stayDays) ──');
S().jumpTo(EDT(2026, 9, 5, 0, 30));
check('Sep 5 NY (day 2): morning is not the trip home', S().plans.morning.category !== 'travel', `${S().plans.morning.category}`);
S().jumpTo(EDT(2026, 9, 6, 0, 30));
check('Sep 6 NY: today is 2026-09-06@America/New_York', S().today === '2026-09-06@America/New_York', S().today);
const mp = S().plans.morning;
const chosen = mp.options.find(o => o.id === mp.chosenId);
check('Sep 6 NY: morning auto-picked travel · 집으로 돌아가기', mp.category === 'travel' && chosen?.placeId === 'home' && chosen?.title === '집으로 돌아가기' && mp.chosenBy === 'agent', JSON.stringify({ category: mp.category, chosen: chosen?.title, by: mp.chosenBy }));
check('travel options abroad start with 집으로 돌아가기 (🏠, 슬슬 집이 그리움)', mp.options[0]?.placeId === 'home' && mp.options[0]?.emoji === '🏠' && mp.options[0]?.reason === '슬슬 집이 그리움', JSON.stringify(mp.options[0]));
check('morning is still editable (the owner may change it)', isBlockEditable(EDT(2026, 9, 6, 0, 30), 'morning', S().today, S().timeline, S().anchor));
const ret = S().timeline.find(a => a.dayKey === '2026-09-06@America/New_York' && a.place.id === 'home');
check('return trip on the timeline', !!ret);
check('return originTz America/New_York → tz Asia/Seoul', ret?.originTz === NY && ret?.tz === SEOUL, `${ret?.originTz} → ${ret?.tz}`);
check('return flight is JFK → ICN', !!ret && ret.journey.legs.some(l => l.mode === 'plane' && l.fromId === 'jfk' && l.toId === 'incheon-airport'), ret?.journey.legs.map(l => `${l.mode}:${l.fromId}>${l.toId}`).join(' '));
S().jumpTo(ret.departAt + 2 * H);
check('in the return flight: moving, tz America/New_York', S().phase.kind === 'moving' && S().phase.tz === NY, `${S().phase.kind} ${S().phase.tz}`);
S().jumpTo(ret.arriveAt + MIN);
check('landed: tz Asia/Seoul', S().phase.tz === SEOUL && S().tz === SEOUL, `${S().phase.tz} ${S().tz}`);
check('landed: today is the Seoul day of arrival', S().today === dayKeyIn(ret.arriveAt, SEOUL), S().today);
check('landed: jetlag on again', jetlagOf(S().phase, S().now) === true, `${S().phase.kind} jetlag=${jetlagOf(S().phase, S().now)}`);
S().jumpTo(ret.arriveAt + 26 * H);
check('next day at home: waiting/active at home, no jetlag', S().phase.tz === SEOUL && jetlagOf(S().phase, S().now) === false, `${S().phase.kind} ${S().phase.tz} jetlag=${jetlagOf(S().phase, S().now)}`);
check('the character did not teleport: still Seoul-side, last place tracked', ['waiting', 'active', 'comic', 'sleeping'].includes(S().phase.kind));

console.log('\n── lived timeline ──');
for (const a of S().timeline) {
  const legs = a.journey.legs.map(l => l.mode).join('>') || 'stay';
  console.log(`  ${fmt(a.departAt, a.originTz)} ${a.originTz.padEnd(16)} → ${fmt(a.arriveAt, a.tz)} ${a.tz.padEnd(16)} ${legs.padEnd(18)} ${a.option.title}  @${a.place.name}${a.jetlagUntil ? '  😴' : ''}`);
}
check('timeline is chronological', S().timeline.every((a, i, arr) => i === 0 || arr[i - 1].comicUntil <= a.departAt));
check('days older than 5 are pruned, anchor advanced', Object.keys(S().days).every(k => dayStartOfKey(k) >= S().now - 5 * 24 * H) && S().anchor.t >= S().now - 5 * 24 * H, `${Object.keys(S().days).join(',')} anchor=${fmt(S().anchor.t, S().anchor.tz)}`);

console.log('\n── catch-up across days (reopen 2 days later) ──');
storage.clear(); for (const [k, v] of snapshotAfterPlanning) storage.set(k, v);
storage.set('theworld.seen.v3', JSON.stringify(T0));
freezeClockAt(EDT(2026, 9, 5, 12, 0));
const { useWorld: reopened } = await import('../src/sim/store.ts?reopen=1');
const R = reopened.getState();
check('reopened: today is the NY Sep 5 day', R.today === '2026-09-05@America/New_York', R.today);
check('reopened: summary sheet present', Array.isArray(R.summary) && R.summary.length > 0, String(R.summary?.length));
const sumDays = new Set((R.summary ?? []).map(i => i.act.dayKey));
check('reopened: summary spans several days', sumDays.size >= 2, [...sumDays].join(','));
check('reopened: summary includes the New York arrival', (R.summary ?? []).some(i => i.act.option.id === opt.id), (R.summary ?? []).map(i => i.act.option.title).join(' | '));
check('reopened: comics landed in the book', R.book.length >= (R.summary?.length ?? 0), `${R.book.length} vs ${R.summary?.length}`);
for (const it of R.summary ?? []) console.log(`  · ${it.act.dayKey}  ${it.comic.title} — ${it.comic.summary}`);

console.log(`\n${n - fails.length}/${n} checks passed${fails.length ? '\nFAILED: ' + fails.join('; ') : ''}`);
process.exit(fails.length ? 1 : 0);
