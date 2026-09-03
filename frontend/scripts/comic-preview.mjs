// Comic content preview — renders the real comic writer (src/sim/comic.ts) for a New York trip day and a Tokyo day
// and checks every caption fits a panel (≤ 28 chars). Usage: node scripts/comic-preview.mjs   (exit 1 on any failure)
import './ts-hooks.mjs';
import { readFileSync } from 'node:fs';

const { makeComic } = await import('../src/sim/comic.ts');
const { placeById, PLACES, tzOf } = await import('../src/sim/places.ts');
const { estimateJourney } = await import('../src/sim/journey.ts');
const { blockSlotIn } = await import('../src/sim/blocks.ts');
const { dayKeyIn, offsetMinutes } = await import('../src/sim/tz.ts');

const MIN = 60_000, H = 3600_000, MAX = 28;
const len = s => [...s].length;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const fails = [];
const check = (name, ok, detail = '') => { if (!ok) fails.push(name); console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok || !detail ? '' : '  ← ' + detail}`); };

const memory = {
  name: '토리', likes: ['그림 그리기', '커피', '바다'], dislikes: ['매운 거'], traits: ['느긋한'], homePlaceId: 'home',
  friends: [{ id: 'minsu', name: '민수', homePlaceId: 'minsu-home', color: 'var(--coral)', emoji: '🐻' }],
  visited: [],
};

/** A ScheduledActivity the way timeline.ts would build it (journey estimated, zones from the places). */
function act(fromId, placeId, departAt, blockId, title, category = 'play', extra = {}) {
  const fromPlace = placeById(fromId), place = placeById(placeId);
  const originTz = tzOf(fromPlace), tz = tzOf(place);
  const journey = estimateJourney(fromPlace, place);
  const arriveAt = departAt + journey.totalMin * MIN;
  const endAt = arriveAt + 90 * MIN;
  const jump = Math.abs(offsetMinutes(tz, arriveAt) - offsetMinutes(originTz, arriveAt));
  const dayKey = dayKeyIn(departAt, originTz);
  const option = { id: `${blockId}-${placeId}`, title, reason: '', emoji: place.emoji, placeId, category, ...extra.option };
  return {
    key: `${dayKey}:${blockId}`, dayKey, blockIds: [blockId], option, place, fromPlace, journey,
    departAt, arriveAt, endAt, comicUntil: endAt + 8 * MIN, originTz, tz,
    jetlagUntil: extra.jetlagUntil !== undefined ? extra.jetlagUntil : jump >= 180 ? arriveAt + 24 * H : null,
  };
}
/** Later activities inside the 24 h window inherit the jet-lag window (engine deviation 3). */
const inherit = (prev) => ({ jetlagUntil: prev.jetlagUntil !== null && prev.arriveAt < prev.jetlagUntil ? prev.jetlagUntil : null });

function show(label, a) {
  const c = makeComic(a, memory);
  const legs = a.journey.legs.map(l => l.mode).join('>') || 'stay';
  console.log(`\n▶ ${label}  [${a.place.type} · ${legs} · ${a.originTz} → ${a.tz}${a.jetlagUntil && a.arriveAt < a.jetlagUntil ? ' · 😴 jetlag' : ''}]`);
  console.log(`  ${c.title}`);
  for (const p of c.panels) {
    const n = len(p.caption);
    console.log(`  ${p.beat.padEnd(6)} ${String(n).padStart(2)}  ${p.caption}${p.withFriend ? '  (+친구)' : ''}`);
    if (n > MAX) fails.push(`${label}/${p.beat} caption ${n} > ${MAX}: ${p.caption}`);
    if (p.caption.endsWith('…')) console.log(`         ↑ trimmed`);
  }
  console.log(`  » ${c.summary}`);
  return c;
}

// ── New York trip day: Seoul 09:00 KST → JFK, then a jet-lagged New York day, then the flight home ──
console.log('══ 뉴욕 (America/New_York) ══');
const ny0 = act('home', 'central-park', KST(2026, 9, 3, 9, 0), 'am', '뉴욕으로 훌쩍, 센트럴파크 (3박)', 'travel', { option: { spanBlocks: ['am', 'lunch', 'pm', 'evening', 'night'], stayDays: 3 } });
{
  // the flight's onboard blocks in the origin zone, for the eye
  const leg = ny0.journey.legs.find(l => l.mode === 'plane');
  let s = ny0.departAt; for (const l of ny0.journey.legs) { if (l === leg) break; s += l.durationMin * MIN; }
  const ids = []; for (let t = s; t < s + leg.durationMin * MIN;) { const slot = blockSlotIn(t, ny0.originTz); ids.push(slot.id); t = slot.end; }
  console.log(`(flight crosses origin-zone blocks: ${ids.join(' → ')})`);
}
const c0 = show('01 비행 · 센트럴파크', ny0);
check('flight comic uses an on-board opener (기내식/잠)', /기내|잤|자니|잠|담요|졸/.test(c0.panels[0].caption), c0.panels[0].caption);
const t1 = ny0.comicUntil + 20 * MIN;
const nyActs = [
  ['02 카페', 'central-park', 'stumptown-nomad', 'pm', '스텀프타운 커피에서 커피 한 잔'],
  ['03 식당', 'stumptown-nomad', 'katz-deli', 'evening', '카츠 델리에서 저녁', 'meal'],
  ['04 숙소', 'katz-deli', 'standard-high-line', 'night', '더 스탠다드 하이라인에서 쉬기', 'rest'],
  ['05 공원', 'standard-high-line', 'high-line', 'morning', '하이라인 산책하며 사진 찍기'],
  ['06 미술관', 'high-line', 'the-met', 'am', '메트로폴리탄 미술관 전시 보기'],
  ['07 피자 (친구)', 'the-met', 'joes-pizza', 'lunch', '조스 피자에서 민수 만나기', 'social', { option: { friendId: 'minsu' } }],
  ['08 강변', 'joes-pizza', 'brooklyn-bridge-park', 'pm', '브루클린 브릿지 파크 산책'],
  ['09 쇼핑', 'brooklyn-bridge-park', 'macys-herald-square', 'evening', '메이시스 헤럴드스퀘어 구경'],
];
let prev = ny0, t = t1;
const nyComics = [c0];
for (const [label, from, to, block, title, cat = 'play', extra = {}] of nyActs) {
  const a = act(from, to, t, block, title, cat, { ...extra, ...inherit(prev) });
  nyComics.push(show(label, a));
  prev = a; t = a.comicUntil + 15 * MIN;
}
// the way home three days later: JFK → ICN, origin New York, lands in Asia/Seoul
const home = act('standard-high-line', 'home', ny0.arriveAt + 3 * 24 * H, 'morning', '집으로 돌아가기', 'travel', { option: { spanBlocks: ['morning', 'am', 'lunch', 'pm', 'evening', 'night'] } });
nyComics.push(show('10 귀국 · 집', home));
check('10 comics for the New York day', nyComics.length === 10, String(nyComics.length));
check('return flight comic uses an on-board opener', /기내|잤|자니|잠|담요|졸/.test(nyComics[9].panels[0].caption), nyComics[9].panels[0].caption);
check('return flight lands in Asia/Seoul (originTz America/New_York)', home.originTz === 'America/New_York' && home.tz === 'Asia/Seoul');
const nyJet = nyComics.slice(1, 9).flatMap(c => c.panels.map(p => p.caption)).filter(s => /시차|하품|졸|몸 시계|새벽 4시/.test(s));
check('jet-lag lines show up on the New York day (≥ 2)', nyJet.length >= 2, String(nyJet.length));
const nyFlavor = nyComics.flatMap(c => c.panels.map(p => p.caption)).filter(s => /택시|피자|급행|재킷|팁|빌딩|베이글|옐로캡|브루클린|사이렌|횡단보도|뉴욕은/.test(s));
check('New York flavour lines show up (≥ 1)', nyFlavor.length >= 1, String(nyFlavor.length));

// ── Tokyo day: ICN → HND in the morning (no jet lag: +0 h), a full Tokyo day ──
console.log('\n══ 도쿄 (Asia/Tokyo) ══');
const tk0 = act('home', 'tsukiji-market', KST(2026, 9, 10, 7, 30), 'morning', '도쿄행 비행기, 츠키지 장외시장 (2박)', 'travel', { option: { spanBlocks: ['morning', 'am', 'lunch'], stayDays: 2 } });
const tkActs = [
  ['02 카페', 'tsukiji-market', 'fuglen-tokyo', 'pm', '푸글렌 도쿄에서 그림 그리기'],
  ['03 절', 'fuglen-tokyo', 'sensoji', 'pm', '센소지 둘러보기'],
  ['04 라멘', 'sensoji', 'ichiran-shibuya', 'evening', '이치란 시부야에서 저녁', 'meal'],
  ['05 숙소', 'ichiran-shibuya', 'hotel-gracery-shinjuku', 'night', '호텔 그레이서리 신주쿠에서 쉬기', 'rest'],
  ['06 공원', 'hotel-gracery-shinjuku', 'ueno-park', 'morning', '우에노공원 산책하며 사진 찍기'],
  ['07 박물관', 'ueno-park', 'tokyo-national-museum', 'am', '도쿄국립박물관 전시 보기'],
  ['08 시장 (친구)', 'tokyo-national-museum', 'ameyoko', 'lunch', '민수랑 아메요코 시장 먹방', 'social', { option: { friendId: 'minsu' } }],
  ['09 쇼핑', 'ameyoko', 'ginza-six', 'pm', '긴자 식스 구경'],
  ['10 야경', 'ginza-six', 'tokyo-skytree', 'evening', '도쿄 스카이트리 올라가서 야경'],
];
const tkComics = [show('01 비행 · 츠키지', tk0)];
prev = tk0; t = tk0.comicUntil + 20 * MIN;
for (const [label, from, to, block, title, cat = 'play', extra = {}] of tkActs) {
  const a = act(from, to, t, block, title, cat, { ...extra, ...inherit(prev) });
  tkComics.push(show(label, a));
  prev = a; t = a.comicUntil + 15 * MIN;
}
check('10 comics for the Tokyo day', tkComics.length === 10, String(tkComics.length));
check('no jet lag on a Seoul → Tokyo hop', tk0.jetlagUntil === null);
const tkFlavor = tkComics.flatMap(c => c.panels.map(p => p.caption)).filter(s => /자판기|계란샌드|건널목|스이카|역까지|고양이 카페|전철|푸딩|골목마다|어느 동네/.test(s));
check('Tokyo flavour lines show up (≥ 1)', tkFlavor.length >= 1, String(tkFlavor.length));

// ── all three on-board kinds and all vehicles render, and a domestic hotel works ──
console.log('\n══ 탈것 안에서 ══');
const boat = act('home', 'nakasu-yatai', KST(2026, 9, 12, 20, 0), 'night', '배 타고 후쿠오카 나카스 포장마차 거리 (2박)', 'travel');
show('배 · 밤 출발 (잠)', boat);
check('boat journey goes by boat', boat.journey.legs.some(l => l.mode === 'boat'));
const train = act('home', 'paradise-busan', KST(2026, 9, 13, 11, 30), 'am', 'KTX 타고 부산 파라다이스 호텔 부산 (1박)', 'travel');
const trainComic = show('기차 · 점심 (도시락) · 호텔', train);
check('domestic hotel comic uses the hotel script', /체크인|로비|캐리어|침대|엘리베이터|창밖|짐/.test(trainComic.panels[0].caption) || /침대|커튼|냉장고|욕조|슬리퍼|티백|지도|이불/.test(trainComic.panels[1].caption), trainComic.panels.map(p => p.caption).join(' | '));

// ── every template line in comic.ts fits a panel once filled with typical values ──
console.log('\n══ 대사 길이 검사 ══');
const src = readFileSync(new URL('../src/sim/comic.ts', import.meta.url), 'utf8');
const sample = { place: '센트럴파크', area: '미드타운', city: '타이베이', friend: '민수', mode: '비행기 타고', act: '커피 한 잔', like: '그림 그리기', name: '토리' };
const lines = [...src.matchAll(/'([^'\n]*[가-힣][^'\n]*)'/g)].map(m => m[1]).filter(s => !/^var\(/.test(s));
const over = lines.map(s => [s, s.replace(/\{(\w+)\}/g, (_, k) => sample[k] ?? '')]).filter(([, f]) => len(f) > MAX);
check(`${lines.length} Korean string literals ≤ ${MAX} chars once filled (sample values)`, over.length === 0, over.map(([s, f]) => `${len(f)}: ${s}`).join(' ; '));

// ── places: each foreign city ≥ 8 places across types, a hotel per foreign + far domestic city ──
console.log('\n══ 장소 ══');
for (const city of ['tokyo', 'osaka', 'fukuoka', 'taipei', 'newyork']) {
  const ps = PLACES.filter(p => p.city === city);
  const types = new Set(ps.map(p => p.type));
  check(`${city}: ${ps.length} places, ${types.size} types (${[...types].join(', ')})`, ps.length >= 8 && types.has('hotel') && types.has('cafe') && types.has('restaurant') && types.has('park') && types.has('museum') && types.has('mall') && types.has('market') && types.has('station'));
}
for (const city of ['busan', 'jeju', 'gangneung', 'gyeongju', 'jeonju', 'yeosu']) check(`${city} has a hotel`, PLACES.some(p => p.city === city && p.type === 'hotel'));
const ids = PLACES.map(p => p.id);
check('place ids are unique', new Set(ids).size === ids.length);
check('coordinates are sane', PLACES.every(p => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && Number.isFinite(p.lat) && Number.isFinite(p.lng)));

console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}`);
for (const f of fails) console.log('  - ' + f);
process.exit(fails.length ? 1 : 0);
