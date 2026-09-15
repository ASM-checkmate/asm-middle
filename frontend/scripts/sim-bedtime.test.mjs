// 취침 전 이동 harness (sim/timeline.ts bedPlaceFor·buildTimeline) — 잘 만한 곳이 아니면 수면 슬롯 앞에 집·숙소로 가는 이동이 붙는다.
// Usage: node scripts/sim-bedtime.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};
const fails = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { buildTimeline, emptyPlans, bedPlaceFor, isBedtime, isBlockFree } = await import('../src/sim/timeline.ts');
const { PLACES, placeById } = await import('../src/sim/places.ts');
const { blockStartAt, blockEndAt } = await import('../src/sim/blocks.ts');
const { dayStartOfKey } = await import('../src/sim/tz.ts');

const TZ = 'Asia/Seoul', MIN = 60_000, H = 3600_000;
const DAY = '2026-09-08@Asia/Seoul';
const dayStart = dayStartOfKey(DAY);
const memory = { name: '토리', likes: [], dislikes: [], traits: [], homePlaceId: 'home', friends: [], visited: [] };
const opt = (place, category = 'play') => ({ id: `o-${place.id}`, title: `${place.name}에서 놀기`, reason: '', emoji: place.emoji, placeId: place.id, category });
const plansWith = (entries) => {
  const plans = emptyPlans();
  for (const [blockId, place, category] of entries) { const o = opt(place, category); plans[blockId] = { blockId, category: o.category, options: [o], chosenId: o.id, chosenBy: 'user', status: 'confirmed' }; }
  return plans;
};
const nextDay7 = dayStart + 31 * H;   // 다음 날 07:00 — 수면 슬롯이 끝나는 곳까지 본다
const seoulBar = PLACES.find(p => p.city === 'seoul' && (p.type === 'bar' || p.type === 'restaurant'));
const seoulCafe = PLACES.find(p => p.city === 'seoul' && p.type === 'cafe');

console.log('\n── bedPlaceFor ──');
check('집에 있으면 갈 곳이 없다', bedPlaceFor(placeById('home'), memory) === null, '');
check('집 도시의 가게에서는 집으로', bedPlaceFor(seoulBar, memory)?.id === 'home', bedPlaceFor(seoulBar, memory)?.id);
check('다른 도시에서는 그 도시의 호텔로', bedPlaceFor(placeById('gwangalli'), memory)?.id === 'paradise-busan', bedPlaceFor(placeById('gwangalli'), memory)?.id);
check('호텔에 있으면 갈 곳이 없다', bedPlaceFor(placeById('paradise-busan'), memory) === null, '');

console.log('\n── 밤 활동 뒤 귀가 ──');
{
  const anchor = { placeId: 'home', t: dayStart + 7 * H, tz: TZ };
  const tl = buildTimeline(anchor, { [DAY]: plansWith([['night', seoulBar]]) }, memory, {}, nextDay7);
  const night = tl.find(a => a.blockIds[0] === 'night');
  const bed = tl.find(isBedtime);
  check('밤 활동 뒤에 귀가 활동이 있다', !!night && !!bed, tl.map(a => a.key).join());
  check('귀가는 집으로, 앨범 없이 (endAt = comicUntil = arriveAt)', bed?.place.id === 'home' && bed.endAt === bed.arriveAt && bed.comicUntil === bed.arriveAt, JSON.stringify(bed && [bed.place.id, bed.endAt - bed.arriveAt, bed.comicUntil - bed.arriveAt]));
  check('앨범이 끝난 뒤 출발한다', !!bed && !!night && bed.departAt >= night.comicUntil, `${bed?.departAt} vs ${night?.comicUntil}`);
  check('출발지는 밤 활동이 실제로 있던 곳 (우회했으면 그곳)', !!bed && !!night && bed.fromPlace.id === night.place.id, `${bed?.fromPlace.id} vs ${night?.place.id}`);
  check('key는 `${dayKey}:bed`, 블록은 sleep, 범주 sleep', bed?.key === `${DAY}:bed` && bed.blockIds[0] === 'sleep' && bed.option.category === 'sleep', bed?.key);
}

console.log('\n── 밤 블록이 비었을 때 ──');
{
  const anchor = { placeId: 'home', t: dayStart + 7 * H, tz: TZ };
  const plans = plansWith([['evening', seoulCafe]]);
  const tl = buildTimeline(anchor, { [DAY]: plans }, memory, {}, nextDay7);
  const evening = tl.find(a => a.blockIds[0] === 'evening');
  const bed = tl.find(isBedtime);
  const midnight = dayStart + 24 * H;
  check('귀가는 자정 20분 전에 닿게 늦춰 출발한다', !!bed && bed.arriveAt <= midnight - 20 * MIN && bed.arriveAt > midnight - 20 * MIN - 2 * MIN, `${bed && (midnight - bed.arriveAt) / MIN}분 전 도착`);
  check('저녁 활동의 앨범보다 늦게 출발한다', !!bed && !!evening && bed.departAt >= evening.comicUntil, '');
  check('귀가가 걸쳐도 밤 블록은 비어 있다 (covers에서 뺀다)', isBlockFree('night', DAY, tl, anchor) === true, '');
  check('상태 접기·마주침에서 빠진다: presentNearby 없음', !!bed && bed.presentNearby.length === 0 && !bed.encounter, '');
}

console.log('\n── 집에서 하루를 마치면 ──');
{
  const anchor = { placeId: 'home', t: dayStart + 7 * H, tz: TZ };
  const tl = buildTimeline(anchor, { [DAY]: emptyPlans() }, memory, {}, nextDay7);
  check('활동이 없으면 귀가도 없다', !tl.some(isBedtime), tl.map(a => a.key).join());
}

console.log('\n── 여행지에서는 숙소로 ──');
{
  const anchor = { placeId: 'gwangalli', t: dayStart + 7 * H, tz: TZ };
  const tl = buildTimeline(anchor, { [DAY]: plansWith([['evening', placeById('josaeho'), 'meal']]) }, memory, {}, nextDay7);
  const bed = tl.find(isBedtime);
  check('부산에서 저녁을 먹으면 파라다이스 호텔로 간다', bed?.place.id === 'paradise-busan' && bed.option.title === '숙소로', JSON.stringify(bed && [bed.place.id, bed.option.title]));
  const next = blockStartAt(dayStart + 24 * H, 'morning'), nextEnd = blockEndAt(dayStart + 24 * H, 'morning');
  check('다음 날은 호텔에서 시작한다', next < nextEnd && tl.every(a => a.departAt < next || a.fromPlace.id === 'paradise-busan'), '');
}

console.log(fails.length ? `\nFAILED: ${fails.join(', ')}` : '\nall ok');
process.exit(fails.length ? 1 : 0);
