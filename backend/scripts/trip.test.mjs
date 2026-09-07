// 여행지 찾기 harness (ADR-0009, src/trip.ts) — 검색어·프롬프트·파서·조립·검증·지오코딩 파서. 네트워크도 Ollama도 없이 돈다.
// Usage: node scripts/trip.test.mjs   (exit 1 on any failed check)
const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { TRIP_SCHEMA, ThinPlanError, approxCentre, assembleCity, buildTripPrompt, geoQuery, haversineKm, hubQuery, normCity, parseTripDraft, slugify, validatePlan } = await import('../src/trip.ts');
const { buildTripQueries, parseSearchBody, SNIPPET_MAX } = await import('../src/search.ts');
const { nominatimUrl, parseNominatim } = await import('../src/geocode.ts');
const { parseReply } = await import('../src/reply.ts');
const { chatJson } = await import('../src/ollama.ts');

// ── 검색 ─────────────────────────────────────────────────────────────────────
console.log('\n── 검색 ──');
const qs = buildTripQueries('교토');
check('검색어 셋, 전부 도시 이름을 담는다', qs.length === 3 && qs.every(q => q.includes('교토')), JSON.stringify(qs));
check('영어 검색어가 하나 있다', qs.some(q => /travel/.test(q)), '');
const body = parseSearchBody({ results: [{ title: 'A', url: 'https://a', content: 'x'.repeat(900) }, { title: 'B', url: '' }, { title: 'C' }, { url: 'https://c', content: '  여러   공백 ' }] });
check('URL 없는 결과는 버리고 스니펫은 자른다', body.length === 2 && body[0].content.length === SNIPPET_MAX && body[1].content === '여러 공백' && body[1].title === '', JSON.stringify(body.map(b => [b.url, b.content.length])));
check('모양이 아니면 빈 배열', parseSearchBody(null).length === 0 && parseSearchBody({ results: 'x' }).length === 0, '');

// ── 프롬프트 ─────────────────────────────────────────────────────────────────
console.log('\n── 프롬프트 ──');
const hits = [
  { title: '교토 여행 가볼 만한 곳 10', url: 'https://ex.com/kyoto', content: '기요미즈데라(Kiyomizu-dera), 후시미 이나리 신사(Fushimi Inari), 니시키 시장(Nishiki Market), 아라시야마 대나무숲, 교토 타워 호텔' },
  { title: '교토 교통', url: 'https://ex.com/kyoto-transport', content: '간사이 국제공항(Kansai International Airport)에서 하루카로 교토역(Kyoto Station)까지 75분. 시영 지하철 두 노선.' },
  { title: 'Kyoto travel guide', url: 'https://ex.com/en', content: 'Gion, Kinkaku-ji, Philosopher\'s Path, % Arabica Arashiyama cafe, Kyoto Tower Hotel' },
];
const p = buildTripPrompt('교토', hits);
check('시스템 프롬프트에 호텔 하나·근거 번호·지어내지 말라는 규칙', /hotel은 정확히 1개/.test(p.system) && /src/.test(p.system) && /지어내지 않는다/.test(p.system), '');
check('사용자 프롬프트에 번호 붙은 스니펫과 URL', p.user.includes('[1] 교토 여행 가볼 만한 곳 10 — https://ex.com/kyoto') && p.user.includes('[3] Kyoto travel guide'), p.user.slice(0, 200));
check('너무 긴 스니펫 묶음은 앞에서부터 담고 뒤는 버린다', !buildTripPrompt('x', Array.from({ length: 40 }, (_, i) => ({ title: `t${i}`, url: `https://u/${i}`, content: 'y'.repeat(500) }))).user.includes('[39]'), '');
check('스키마가 도시·허브·장소를 요구한다', ['key', 'tz', 'hubs', 'places'].every(k => TRIP_SCHEMA.required.includes(k)) && TRIP_SCHEMA.properties.places.minItems === 6, '');
check('스키마의 장소 유형에 허브·집·일터가 없다', !['airport', 'station', 'port', 'home', 'office'].some(t => TRIP_SCHEMA.properties.places.items.properties.type.enum.includes(t)), '');

// ── 파서 ─────────────────────────────────────────────────────────────────────
console.log('\n── 파서 ──');
const draftJson = {
  key: 'Kyoto', nameKo: '교토', nameEn: 'Kyoto', country: 'jp', tz: 'Asia/Tokyo', stayNights: 2, hasSubway: true,
  hubs: { airport: { nameKo: '간사이 국제공항', nameEn: 'Kansai International Airport (KIX)', lat: 34.43, lng: 135.24 }, station: { nameKo: '교토역', nameEn: 'Kyoto Station' }, port: null },
  places: [
    { nameKo: '기요미즈데라', nameEn: 'Kiyomizu-dera', type: 'temple', area: '히가시야마', emoji: '⛩️', lat: 34.9949, lng: 135.785, src: 1 },
    { nameKo: '후시미 이나리', nameEn: 'Fushimi Inari Taisha', type: 'temple', area: '후시미', emoji: '⛩️', lat: 34.9671, lng: 135.7727, src: 1 },
    { nameKo: '니시키 시장', nameEn: 'Nishiki Market', type: 'market', area: '나카교', emoji: '🍢', lat: 35.005, lng: 135.765, src: 1 },
    { nameKo: '니시키 시장', nameEn: 'Nishiki Ichiba', type: 'market', area: '나카교', emoji: '🍢', lat: 35.005, lng: 135.765, src: 1 },   // 중복 이름
    { nameKo: '아라시야마 대나무숲', nameEn: 'Arashiyama Bamboo Grove', type: 'park', area: '아라시야마', emoji: '🎋', lat: 35.0094, lng: 135.6722, src: 1 },
    { nameKo: '킨카쿠지', nameEn: 'Kinkaku-ji', type: 'museum', area: '기타', emoji: '🏯', lat: 35.0394, lng: 135.7292, src: 3 },
    { nameKo: '아라비카 아라시야마', nameEn: '% Arabica Arashiyama', type: 'cafe', area: '아라시야마', emoji: '☕', lat: 35.0136, lng: 135.6778, src: 3 },
    { nameKo: '기온', nameEn: 'Gion', type: 'market', area: '기온', emoji: '🏮', lat: 35.0037, lng: 135.7751, src: 3 },
    { nameKo: '철학의 길', nameEn: "Philosopher's Path", type: 'park', area: '사쿄', emoji: '🌸', lat: 35.0263, lng: 135.7947, src: 3 },
    { nameKo: '교토 타워 호텔', nameEn: 'Kyoto Tower Hotel', type: 'hotel', area: '교토역', emoji: '🏨', lat: 34.9875, lng: 135.7593, src: 1 },
    { nameKo: '두 번째 호텔', nameEn: 'Second Hotel', type: 'hotel', area: '기온', emoji: '🏨', lat: 35.0, lng: 135.77, src: 3 },   // 호텔은 하나만
    { nameKo: '지어낸 곳', nameEn: 'Made Up', type: 'bar', area: '?', emoji: '🍻', lat: 35.0, lng: 135.77, src: 9 },   // 근거 번호 범위 밖
    { nameKo: '유형 틀림', nameEn: 'Bad Type', type: 'office', area: '?', emoji: '💼', lat: 35.0, lng: 135.77, src: 2 },
    { nameKo: '허브 유형', nameEn: 'Kyoto Station', type: 'station', area: '?', emoji: '🚄', lat: 34.9858, lng: 135.7588, src: 2 },
  ],
};
const draft = parseTripDraft(JSON.stringify(draftJson), 3);
check('도시 키는 소문자 슬러그, 나라는 대문자', draft && draft.key === 'kyoto' && draft.country === 'JP', JSON.stringify(draft && [draft.key, draft.country]));
check('중복 이름·둘째 호텔·범위 밖 src·틀린 유형·허브 유형은 버린다', draft && draft.places.length === 9 && draft.places.filter(p => p.type === 'hotel').length === 1 && !draft.places.some(p => p.nameEn === 'Made Up' || p.nameEn === 'Bad Type' || p.type === 'station'), JSON.stringify(draft && draft.places.map(p => p.nameEn)));
check('허브 셋 중 port는 null', draft && draft.hubs.airport && draft.hubs.station && draft.hubs.port === null, '');
check('허브 영문 이름의 괄호(공항 코드)는 뗀다', draft?.hubs.airport?.nameEn === 'Kansai International Airport' && Number.isNaN(draft?.hubs.station?.lat), JSON.stringify(draft?.hubs));
check('키가 이상하면 영문 이름으로 슬러그를 만든다', parseTripDraft(JSON.stringify({ ...draftJson, key: '교토!' }), 3)?.key === 'kyoto', '');
check('시간대가 틀리면 null', parseTripDraft(JSON.stringify({ ...draftJson, tz: 'Asia/Kyoto' }), 3) === null, '');
check('나라 코드가 틀리면 null', parseTripDraft(JSON.stringify({ ...draftJson, country: 'Japan' }), 3) === null, '');
check('깨진 JSON은 null', parseTripDraft('{', 3) === null, '');
check('slugify', slugify("Philosopher's Path") === 'philosopher-s-path' && slugify('Kiyomizu-dera') === 'kiyomizu-dera' && slugify('교토') === '', slugify("Philosopher's Path"));

// ── 조립 ─────────────────────────────────────────────────────────────────────
console.log('\n── 조립 ──');
const centre = { lat: 35.0116, lng: 135.7681 };
const geo = new Map();
const g = (nameEn, lat, lng) => geo.set(geoQuery(nameEn, 'Kyoto', 'JP'), lat === null ? null : { lat, lng, displayName: nameEn, countryCode: 'JP' });
geo.set(hubQuery('Kansai International Airport', 'JP'), { lat: 34.4347, lng: 135.2440, displayName: '', countryCode: 'JP' });   // 도심 100km — 허브는 200km까지
geo.set(hubQuery('Kyoto Station', 'JP'), { lat: 34.9858, lng: 135.7588, displayName: '', countryCode: 'JP' });
g('Kiyomizu-dera', 34.9949, 135.7850);
g('Fushimi Inari Taisha', 34.9671, 135.7727);
g('Nishiki Market', 35.0050, 135.7650);
g('Arashiyama Bamboo Grove', null);                       // 지오코딩 실패 → 모델 근사값
g('Kinkaku-ji', 35.0394, 135.7292);
g('% Arabica Arashiyama', 35.0136, 135.6778);
g('Gion', 35.0037, 135.7751);
g("Philosopher's Path", 43.0, 141.0);                     // 다른 도시의 동명 → 버림 (근사값도 없다)
geo.set(hubQuery('Gion', 'JP'), { lat: 35.0037, lng: 135.7751, displayName: '', countryCode: 'JP' }); g('Gion', null);   // 도시 붙이면 없고 나라만 붙이면 있다
g('Kyoto Tower Hotel', 34.9875, 135.7593);
const draft2 = { ...draft, places: draft.places.map(p => (p.nameEn === "Philosopher's Path" ? { ...p, lat: NaN, lng: NaN } : p)) };
const { city, places } = assembleCity(draft2, geo, centre);
check('id는 도시 키 + 영문 슬러그', places.some(p => p.id === 'kyoto-kiyomizu-dera') && places.every(p => p.id.startsWith('kyoto-') && p.city === 'kyoto'), JSON.stringify(places.map(p => p.id)));
check('허브가 장소로 만들어지고 hubs에 id가 적힌다 (intlAirport = airport)', city.hubs.airport === 'kyoto-kansai-international-airport' && city.hubs.station === 'kyoto-kyoto-station' && city.hubs.intlAirport === city.hubs.airport && city.hubs.port === undefined && city.hubs.hasSubway === true, JSON.stringify(city.hubs));
check('지오코딩 결과가 좌표가 된다', places.find(p => p.id === 'kyoto-nishiki-market')?.lat === 35.005, '');
check('도시 붙인 조회가 없으면 나라만 붙인 조회를 쓴다', places.find(p => p.id === 'kyoto-gion')?.lat === 35.0037, '');
check('지오코딩이 없으면 모델 근사값(도심 60km 안)', places.find(p => p.id === 'kyoto-arashiyama-bamboo-grove')?.lat === 35.0094, '');
check('도심에서 너무 먼 결과는 버린다', !places.some(p => p.id === 'kyoto-philosopher-s-path'), '');
{
  // 지오코딩이 하나도 없으면 근사값 장소는 셋까지만 — 지도에 없는 이름은 지어낸 이름일 확률이 높다
  const onlyApprox = assembleCity(draft2, new Map([[hubQuery('Kansai International Airport', 'JP'), geo.get(hubQuery('Kansai International Airport', 'JP'))]]), centre);
  check('근사값만 있는 장소는 셋까지 (호텔은 상한 밖)', onlyApprox.places.filter(p => p.type !== 'airport' && p.type !== 'hotel').length === 3 && onlyApprox.places.some(p => p.type === 'hotel'), JSON.stringify(onlyApprox.places.map(p => p.type)));
}
check('국내 아니면 reachBy를 안 단다', places.every(p => p.reachBy === undefined), '');
check('도시 정보', city.key === 'kyoto' && city.nameKo === '교토' && city.tz === 'Asia/Tokyo' && city.stayNights === 2 && city.country === 'JP', JSON.stringify(city));
const ac = approxCentre(draft);
check('도심 대체값은 근사 좌표의 중앙값', ac && Math.abs(ac.lat - 35.005) < 0.03 && Math.abs(ac.lng - 135.77) < 0.03 && approxCentre({ ...draft, places: draft.places.slice(0, 2) }) === null, JSON.stringify(ac));
check('거리 계산 (서울→부산 ≈ 325km)', Math.abs(haversineKm({ lat: 37.5665, lng: 126.978 }, { lat: 35.1796, lng: 129.0756 }) - 325) < 5, '');

// 국내 도시에 역이 없으면 비행기로만
const domestic = { ...draft2, key: 'jindo', nameKo: '진도', nameEn: 'Jindo', country: 'KR', tz: 'Asia/Seoul', hubs: { airport: { nameKo: '진도공항', nameEn: 'Jindo Airport' }, station: null, port: null } };
const geoK = new Map([[hubQuery('Jindo Airport', 'KR'), { lat: 34.5, lng: 126.3, displayName: '', countryCode: 'KR' }]]);
for (const p of draft2.places) geoK.set(geoQuery(p.nameEn, 'Jindo', 'KR'), { lat: 34.48, lng: 126.26, displayName: '', countryCode: 'KR' });
const dom = assembleCity(domestic, geoK, { lat: 34.48, lng: 126.26 });
const noGeoHub = assembleCity({ ...draft2, hubs: { ...draft2.hubs, station: null } }, new Map([...geo].filter(([k]) => !k.startsWith('Kansai'))), centre);
check('허브 지오코딩이 없으면 모델 근사값(200km 안)으로', noGeoHub.city.hubs.airport === 'kyoto-kansai-international-airport' && noGeoHub.places.find(p => p.type === 'airport')?.lat === 34.43, JSON.stringify(noGeoHub.city.hubs));
check('국내인데 역이 없으면 장소마다 reachBy=plane', dom.places.filter(p => p.type !== 'airport').every(p => p.reachBy === 'plane') && dom.city.hubs.station === undefined, JSON.stringify(dom.places.map(p => p.reachBy)));

// ── 검증 ─────────────────────────────────────────────────────────────────────
console.log('\n── 검증 ──');
const throwsThin = f => { try { f(); return false; } catch (e) { return e instanceof ThinPlanError; } };
check('두꺼운 팩은 통과', !throwsThin(() => validatePlan(city, places)) && (() => { validatePlan(city, places); return true; })(), '');
check('호텔이 없으면 얇다', throwsThin(() => validatePlan(city, places.filter(p => p.type !== 'hotel'))), '');
check('장소가 6개 미만이면 얇다', throwsThin(() => validatePlan(city, places.slice(0, 5))), '');
check('해외인데 공항이 없으면 얇다', throwsThin(() => validatePlan({ ...city, hubs: { station: city.hubs.station } }, places)), '');
check('국내는 역만 있어도 된다', !throwsThin(() => validatePlan({ ...city, country: 'KR', hubs: { station: city.hubs.station } }, places)), '');

// ── 지오코딩 파서 ─────────────────────────────────────────────────────────────
console.log('\n── 지오코딩 ──');
check('Nominatim URL', nominatimUrl('Kyoto, JP', 'https://n').startsWith('https://n/search?q=Kyoto%2C+JP&format=jsonv2&limit=1'), nominatimUrl('Kyoto, JP', 'https://n'));
check('첫 결과의 좌표', JSON.stringify(parseNominatim([{ lat: '35.0', lon: '135.7', display_name: 'Kyoto', address: { country_code: 'jp' } }])) === JSON.stringify({ lat: 35, lng: 135.7, displayName: 'Kyoto', countryCode: 'JP' }), '');
check('빈 배열·깨진 좌표는 null', parseNominatim([]) === null && parseNominatim([{ lat: 'x', lon: '1' }]) === null && parseNominatim({}) === null, '');
check('요청 도시명 정규화', normCity(' Kyoto ') === 'kyoto' && normCity('교토') === '교토', '');

// ── 답장의 trip ───────────────────────────────────────────────────────────────
console.log('\n── 답장의 trip ──');
check('여행 가자는 말이면 도시 이름', parseReply('{"text":"오 좋다 찾아볼게","worry":null,"callMe":false,"trip":"교토"}').trip === '교토', '');
check('조사가 붙으면 뗀다', parseReply('{"text":"x","worry":null,"callMe":false,"trip":"교토까지"}').trip === '교토' && parseReply('{"text":"x","worry":null,"callMe":false,"trip":"파리으로"}').trip === '파리', '');
check('한 글자 조사는 안 뗀다 (오슬로)', parseReply('{"text":"x","worry":null,"callMe":false,"trip":"오슬로"}').trip === '오슬로', '');
check('없으면 null', parseReply('{"text":"x","worry":null,"callMe":false,"trip":null}').trip === null && parseReply('{"text":"x","worry":null,"callMe":false}').trip === null && parseReply('{"text":"x","worry":null,"callMe":false,"trip":"  "}').trip === null, '');
check('너무 길면 null', parseReply(`{"text":"x","worry":null,"callMe":false,"trip":"${'가'.repeat(40)}"}`).trip === null, '');

// ── chatJson 옵션 ─────────────────────────────────────────────────────────────
console.log('\n── chatJson 옵션 ──');
{
  const calls = [];
  const realFetch = globalThis.fetch;
  // chatJson은 스트리밍(ndjson)으로 받는다 — 끊기면 Ollama가 바로 멈추게 하려고
  const ndjson = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: '{' }, done: false }) + '\n' + JSON.stringify({ message: { content: '}' }, done: true }) + '\n')); c.close(); } });
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, body: ndjson(), text: async () => '' }; };
  try {
    await chatJson({ url: 'http://o', timeoutMs: 1000 }, 'm', 's', 'u', {});
    await chatJson({ url: 'http://o', timeoutMs: 1000 }, 'm', 's', 'u', {}, undefined, { temperature: 0.2, numPredict: 2500 });
  } finally { globalThis.fetch = realFetch; }
  check('기본은 답장용(0.9·160), 스트리밍으로 받는다', calls[0].options.temperature === 0.9 && calls[0].options.num_predict === 160 && calls[0].stream === true, JSON.stringify(calls[0].options));
  check('옵션을 주면 본문에 실린다', calls[1].options.temperature === 0.2 && calls[1].options.num_predict === 2500, JSON.stringify(calls[1].options));
}

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
