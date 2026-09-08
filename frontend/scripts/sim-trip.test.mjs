// 여행지 찾기 harness (ADR-0009) — 찾아 온 도시 팩이 places.ts에 등록되고, 규칙 엔진(여행 카드·이동·시간대)이
// 그것을 붙박이 도시처럼 쓰는지. 그리고 "교토 가자" → planTrip → 후속 줄. 백엔드 없이 fetch를 흉내 낸다.
// Usage: node scripts/sim-trip.test.mjs   (exit 1 on any failed check)
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
storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: T0, scale: 0 }));
storage.set('theworld.llm.v1', 'small');

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

// ── 픽스처: 교토 팩 (백엔드 /api/trip/plan의 응답 모양) ────────────────────────
const P = (id, name, type, lng, lat, area, emoji) => ({ id, name, type, lng, lat, area, city: 'kyoto', country: 'JP', emoji });
const KYOTO = {
  city: { key: 'kyoto', nameKo: '교토', nameEn: 'Kyoto', country: 'JP', tz: 'Asia/Tokyo', stayNights: 2, hubs: { airport: 'kyoto-kansai-international-airport', intlAirport: 'kyoto-kansai-international-airport', station: 'kyoto-kyoto-station', hasSubway: true } },
  places: [
    P('kyoto-kansai-international-airport', '간사이 국제공항', 'airport', 135.2440, 34.4347, '교토', '✈️'),
    P('kyoto-kyoto-station', '교토역', 'station', 135.7588, 34.9858, '교토', '🚄'),
    P('kyoto-kiyomizu-dera', '기요미즈데라', 'temple', 135.7850, 34.9949, '히가시야마', '⛩️'),
    P('kyoto-fushimi-inari-taisha', '후시미 이나리', 'temple', 135.7727, 34.9671, '후시미', '⛩️'),
    P('kyoto-nishiki-market', '니시키 시장', 'market', 135.7650, 35.0050, '나카교', '🍢'),
    P('kyoto-arashiyama-bamboo-grove', '아라시야마 대나무숲', 'park', 135.6722, 35.0094, '아라시야마', '🎋'),
    P('kyoto-kinkaku-ji', '킨카쿠지', 'museum', 135.7292, 35.0394, '기타', '🏯'),
    P('kyoto-arabica-arashiyama', '아라비카 아라시야마', 'cafe', 135.6778, 35.0136, '아라시야마', '☕'),
    P('kyoto-gion', '기온', 'market', 135.7751, 35.0037, '기온', '🏮'),
    P('kyoto-omen', '오멘 긴카쿠지', 'restaurant', 135.7960, 35.0250, '사쿄', '🍜'),
    P('kyoto-kyoto-tower-hotel', '교토 타워 호텔', 'hotel', 135.7593, 34.9875, '교토역', '🏨'),
  ],
  sources: ['https://ex.com/kyoto'], cached: false, model: 'qwen3.5:9b', ms: 1,
};

// 1) 저장된 팩이 스토어보다 먼저 올라오는지 — 여기서 미리 넣어 두고 import한다
storage.set('theworld.places.v1', JSON.stringify({ v: 1, cities: { kyoto: { info: KYOTO.city, places: KYOTO.places, at: T0 } } }));

const places = await import('../src/sim/places.ts');
const { CITY_HUBS, cityKeyOfName, cityNameKo, dynamicCities, hasPlace, loadDynamic, placeById, registerCity, stayNightsOf, tzOf, validPack } = places;
const { estimateJourney } = await import('../src/sim/journey.ts');
const { suggestOptions, stayDaysFor } = await import('../src/sim/suggest.ts');
const { tripFollowUp } = await import('../src/sim/chat.ts');
const { INITIAL_STATUS } = await import('../src/sim/status.ts');
const { useWorld, DEFAULT_MEMORY } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

console.log('\n── 저장된 팩이 올라온다 ──');
check('교토 장소를 id로 찾는다', hasPlace('kyoto-kiyomizu-dera') && placeById('kyoto-kiyomizu-dera').name === '기요미즈데라', '');
check('허브·이름·시간대·체류가 표에 적힌다', CITY_HUBS.kyoto?.airport === 'kyoto-kansai-international-airport' && cityNameKo('kyoto') === '교토' && tzOf({ city: 'kyoto', country: 'JP' }) === 'Asia/Tokyo' && stayNightsOf('kyoto', 'JP') === 2, JSON.stringify([CITY_HUBS.kyoto, cityNameKo('kyoto')]));
check('이름 → 키 (붙박이도, 찾아 온 것도)', cityKeyOfName('교토') === 'kyoto' && cityKeyOfName('도쿄') === 'tokyo' && cityKeyOfName('Kyoto') === 'kyoto' && cityKeyOfName('화성') === null, '');
check('dynamicCities에 교토만', dynamicCities().map(c => c.key).join() === 'kyoto', '');

console.log('\n── 검증 ──');
const pack = { info: KYOTO.city, places: KYOTO.places, at: 1 };
check('멀쩡한 팩은 통과', validPack('kyoto', pack) !== null, '');
check('붙박이 키와 겹치면 버린다', validPack('tokyo', { ...pack, info: { ...pack.info, key: 'tokyo' }, places: pack.places.map(p => ({ ...p, city: 'tokyo' })) }) === null, '');
check('허브 id가 팩에 없으면 버린다', validPack('kyoto', { ...pack, info: { ...pack.info, hubs: { airport: 'kyoto-nope' } } }) === null, '');
check('좌표가 깨지면 버린다', validPack('kyoto', { ...pack, places: [{ ...pack.places[0], lat: 'x' }, ...pack.places.slice(1)] }) === null, '');
check('시간대가 틀리면 버린다', validPack('kyoto', { ...pack, info: { ...pack.info, tz: 'Asia/Kyoto' } }) === null, '');
check('다른 도시 키의 장소가 섞이면 버린다', validPack('kyoto', { ...pack, places: [{ ...pack.places[2], city: 'osaka' }, ...pack.places] }) === null, '');
check('loadDynamic은 틀린 팩만 빼고 남긴다', Object.keys(loadDynamic({ v: 1, cities: { kyoto: pack, bad: { info: {} } } })).join() === 'kyoto' && Object.keys(loadDynamic(null)).length === 0, '');

console.log('\n── 규칙 엔진이 교토를 쓴다 ──');
const home = placeById('home');
const j = estimateJourney(home, placeById('kyoto-kiyomizu-dera'));
check('집 → 교토는 인천에서 간사이로 나는 여정', j.legs.some(l => l.mode === 'plane' && l.fromId === 'incheon-airport' && l.toId === 'kyoto-kansai-international-airport'), JSON.stringify(j.legs.map(l => [l.mode, l.fromId, l.toId])));
const memWish = { ...DEFAULT_MEMORY, wish: { city: 'kyoto', at: T0 - 3600_000 } };
const ctx = (memory, blockId = 'am') => ({ dateKey: '2026-09-08', blockId, category: 'travel', memory, from: home });
const a = suggestOptions(ctx(memWish)), b = suggestOptions(ctx(memWish));
const first = placeById(a[0].placeId);
check('소원이 있으면 첫 여행 카드가 교토', first.city === 'kyoto' && a[0].category === 'travel', JSON.stringify(a.map(o => o.title)));
check('제목에 (2박), stayDays 2, spanBlocks가 하루 남은 블록', /\(2박\)$/.test(a[0].title) && a[0].stayDays === 2 && a[0].spanBlocks.length >= 3, JSON.stringify([a[0].title, a[0].stayDays, a[0].spanBlocks]));
check('같은 입력이면 같은 카드 (결정성)', JSON.stringify(a) === JSON.stringify(b), '');
check('카드는 넷까지', a.length <= 4, String(a.length));
const noWish = suggestOptions(ctx(DEFAULT_MEMORY));
check('소원이 없으면 교토가 첫 장이 아니고 뉴욕 카드는 그대로', placeById(noWish[0].placeId).city !== 'kyoto' && noWish.some(o => placeById(o.placeId).city === 'newyork'), JSON.stringify(noWish.map(o => o.title)));
const stale = suggestOptions(ctx({ ...DEFAULT_MEMORY, wish: { city: 'kyoto', at: T0 - 30 * 24 * 3600_000 } }));
check('오래된 소원은 잊는다', JSON.stringify(stale) === JSON.stringify(noWish), '');
const visited = [{ placeId: 'kyoto-gion', at: T0 }];
const been = suggestOptions(ctx({ ...memWish, visited }));
check('말한 뒤 다녀왔으면 잊는다', JSON.stringify(been) === JSON.stringify(suggestOptions(ctx({ ...DEFAULT_MEMORY, visited }))) && placeById(been[0].placeId).city !== 'kyoto', JSON.stringify(been.map(o => o.title)));
check('밤 블록엔 기차만 — 교토 카드는 안 뜬다', suggestOptions(ctx(memWish, 'night')).every(o => placeById(o.placeId).city !== 'kyoto'), '');
check('stayDaysFor가 찾아 온 도시의 박수를 안다', stayDaysFor(placeById('kyoto-gion')) === 2 && stayDaysFor(placeById('kyoto-gion'), 'x 당일치기') === 0, '');

console.log('\n── 후속 줄 ──');
const waiting = { kind: 'waiting', at: home, currentBlockId: 'pm', nextBlockId: 'evening', nextStartAt: null, tz: 'Asia/Seoul', jetlag: false, companions: [] };
const sleeping = { kind: 'sleeping', until: T0 + 3600_000, at: home, tz: 'Asia/Seoul' };
const cctx = (phase = waiting) => ({ phase, status: INITIAL_STATUS, name: '모모', seed: 'b1', now: T0 });
const f1 = tripFollowUp('found', cctx(), '교토', ['기요미즈데라', '니시키 시장']);
check('찾았으면 장소 둘을 댄다', f1.text.includes('교토') && f1.text.includes('기요미즈데라랑 니시키 시장'), f1.text);
check('받을 수 있으면 20~90초 뒤', f1.delayMs >= 20_000 && f1.delayMs <= 90_000, String(f1.delayMs));
check('자는 중이면 깬 뒤에', tripFollowUp('found', cctx(sleeping), '교토', []).delayMs >= 3600_000, '');
check('못 찾았으면 그렇다고 한다', /잘 안 됐어|잘 모르겠다/.test(tripFollowUp('failed', cctx(), '화성').text), tripFollowUp('failed', cctx(), '화성').text);
check('아는 도시면 바로 좋다고', tripFollowUp('known', cctx(), '도쿄').text.includes('도쿄'), '');
check('같은 시드면 같은 줄', tripFollowUp('found', cctx(), '교토', ['기요미즈데라', '니시키 시장']).text === f1.text, '');

console.log('\n── planTrip ──');
const calls = [];
// 인증(AUTH-ADDENDUM)은 저장된 사용자의 `X-User-Id` 하나 — 스텁은 그 헤더만 본다. 세는 것은 여행 요청뿐. 베이스 URL이 붙어도 맞게 endsWith
storage.set('theworld.user.v1', JSON.stringify({ userId: 'u_test', name: '테스트' }));
globalThis.fetch = async (url, init) => {
  if (init.headers?.['x-user-id'] !== 'u_test') return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) };
  if (url.endsWith('/api/trip/plan')) {
    calls.push({ url, body: JSON.parse(init.body) });
    const city = JSON.parse(init.body).city;
    if (city === '화성') return { ok: false, status: 422, json: async () => ({ error: 'thin' }) };
    const key = city === '나라' ? 'nara' : null;
    if (!key) return { ok: false, status: 502, json: async () => ({}) };
    const pl = KYOTO.places.map(p => ({ ...p, id: p.id.replace('kyoto-', 'nara-'), city: 'nara' }));
    return { ok: true, status: 200, json: async () => ({ ...KYOTO, city: { ...KYOTO.city, key: 'nara', nameKo: '나라', nameEn: 'Nara', hubs: { airport: 'nara-kansai-international-airport', intlAirport: 'nara-kansai-international-airport', station: 'nara-kyoto-station', hasSubway: false } }, places: pl }) };
  }
  return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
};
const msgs = () => S().messages.filter(m => m.from === 'agent');

await S().planTrip('도쿄', 'b1');
check('아는 도시면 fetch 없이 소원만 적고 한 줄 남긴다', calls.length === 0 && S().memory.wish?.city === 'tokyo' && msgs().some(m => m.id === 'b1:trip' && m.text.includes('도쿄') && m.at > T0), JSON.stringify([calls.length, S().memory.wish, msgs().map(m => m.text)]));
check('소원이 메모리에 저장된다', JSON.parse(storage.get('theworld.memory.v2')).wish?.city === 'tokyo', '');
await S().planTrip('서울', 'b1s');
check('집 도시는 소원이 안 된다', S().memory.wish?.city === 'tokyo' && !msgs().some(m => m.id === 'b1s:trip'), '');

await S().planTrip('나라', 'b2');
check('모르는 도시면 백엔드에 묻는다', calls.length === 1 && calls[0].url === '/api/trip/plan' && calls[0].body.city === '나라' && calls[0].body.tier === 'small', JSON.stringify(calls));
check('팩이 등록되고 소원이 그 도시로 바뀐다', hasPlace('nara-gion') && cityNameKo('nara') === '나라' && S().memory.wish?.city === 'nara', JSON.stringify(S().memory.wish));
check('찾았다는 줄이 답장 뒤 시각으로 붙는다', msgs().some(m => m.id === 'b2:trip' && m.text.includes('나라') && m.at > T0), JSON.stringify(msgs().map(m => [m.id, m.text])));
check('팩이 localStorage에 저장된다', Object.keys(JSON.parse(storage.get('theworld.places.v1')).cities).sort().join() === 'kyoto,nara', '');
check('찾는 중 표시가 내려간다', S().tripBusy === null, '');

await S().planTrip('화성', 'b3');
check('못 찾으면 그렇다고 한 줄, 소원은 그대로', msgs().some(m => m.id === 'b3:trip' && /잘 안 됐어|잘 모르겠다/.test(m.text)) && S().memory.wish?.city === 'nara', JSON.stringify(msgs().map(m => m.text)));

S().setLlmTier('off');
await S().planTrip('삿포로', 'b4');
check('tier가 off면 모르는 도시는 안 묻는다', calls.length === 2 && !msgs().some(m => m.id === 'b4:trip'), String(calls.length));
S().setLlmTier('small');

check('registerCity는 틀린 팩을 거절한다', registerCity({ ...KYOTO.city, key: 'bad', tz: 'nope' }, []) === false, '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
