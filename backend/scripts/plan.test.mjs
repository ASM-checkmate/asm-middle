// 하루 계획 harness (ADR-0010, src/plan.ts) — 프롬프트·스키마·파서. Ollama 없이 돈다.
// Usage: node scripts/plan.test.mjs   (exit 1 on any failed check)
const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { MAX_REASON, MAX_TITLE, buildPlanPrompt, parsePlan, planSchema } = await import('../src/plan.ts');

const req = {
  tier: 'small',
  agent: { name: '모모', traits: ['느긋한', '호기심 많은'], likes: ['그림 그리기', '카페'], dislikes: ['줄 서기'] },
  day: { dateKey: '2026-09-08', weekday: '화요일' },
  city: { key: 'seoul', nameKo: '서울', home: true },
  status: { money: 620000, fatigue: 22, mood: 58 },
  worry: null,
  visited: ['경의선숲길'],
  places: [
    { id: 'home', name: '우리 집', type: 'home', area: '연남동' },
    { id: 'layered-yeonnam', name: '카페 레이어드 연남', type: 'cafe', area: '연남동' },
    { id: 'gyeongui-line-forest', name: '경의선숲길', type: 'park', area: '연남동' },
    { id: 'tuktuk-noodle', name: '툭툭누들타이', type: 'restaurant', area: '연남동' },
    { id: 'the-climb-yeonnam', name: '더클라임 연남', type: 'gym', area: '연남동' },
    { id: 'mapo-central-library', name: '마포중앙도서관', type: 'library', area: '성산동' },
    { id: 'wework-hongdae', name: '위워크 홍대', type: 'office', area: '서교동' },
  ],
  blocks: [
    { id: 'am', category: null, from: '우리 집', avoid: ['tuktuk-noodle'] },
    { id: 'lunch', category: 'meal', from: '카페 레이어드 연남', avoid: [], previous: ['툭툭누들에서 팟타이'] },
  ],
};

console.log('\n── 프롬프트 ──');
const p = buildPlanPrompt(req);
check('이름·취향·상태가 시스템 프롬프트에', p.system.includes('"모모"') && p.system.includes('그림 그리기') && p.system.includes('62만 원') && p.system.includes('화요일'), p.system.slice(0, 160));
check('최근 간 곳', p.system.includes('경의선숲길'), '');
check('고민이 있으면 한 줄', buildPlanPrompt({ ...req, worry: 'work' }).system.includes('일 때문에'), '');
check('카탈로그가 id와 함께 실린다', p.user.includes('- layered-yeonnam: 카페 레이어드 연남 (카페, 연남동)'), p.user.slice(0, 200));
check('블록 줄: 범주 미정은 네가 고른다, 정해진 건 그 범주', p.user.includes('· am 오전(09–12) — 범주 (네가 고른다)') && p.user.includes('· lunch 점심(12–14) — 범주 식사'), p.user);
check('avoid와 previous가 실린다', p.user.includes('avoid: tuktuk-noodle') && p.user.includes('previous: 툭툭누들에서 팟타이'), '');
const schema = planSchema(req.places.map(x => x.id), ['am', 'lunch']);
check('스키마: placeId는 카탈로그 enum, 블록 수 고정, 카드 3장', schema.properties.blocks.minItems === 2 && schema.properties.blocks.items.properties.options.items.properties.placeId.enum.includes('home') && schema.properties.blocks.items.properties.options.minItems === 3, '');

console.log('\n── 파서 ──');
const raw = JSON.stringify({ blocks: [
  { id: 'am', category: 'study', options: [
    { placeId: 'mapo-central-library', title: '마포중앙도서관에서 책 읽기', reason: '조용한 자리 좋아함', emoji: '📚' },
    { placeId: 'layered-yeonnam', title: '레이어드에서 스케치', reason: '창가 자리', emoji: '☕️' },
    { placeId: 'the-climb-yeonnam', title: '클라이밍', reason: '공부 범주에 헬스장은 안 맞음', emoji: '🧗' },   // 범주에 안 맞는 유형 → 버림
    { placeId: 'nope', title: '없는 곳', reason: '', emoji: '❓' },                                   // 카탈로그 밖
  ] },
  { id: 'lunch', category: 'play', options: [                                                          // 정해진 범주(meal)로 고정
    { placeId: 'tuktuk-noodle', title: '툭툭누들에서 팟타이', reason: '매운 건 빼고', emoji: '🍜' },
    { placeId: 'tuktuk-noodle', title: '또 툭툭', reason: '중복', emoji: '🍜' },
    { placeId: 'home', title: '집에서 ' + '가'.repeat(40), reason: '나'.repeat(50), emoji: 'x' },
  ] },
  { id: 'pm', category: 'rest', options: [{ placeId: 'home', title: '집', reason: '', emoji: '🏠' }] },   // 요청에 없는 블록
] });
const out = parsePlan(raw, req);
check('블록 둘만 남는다 (요청에 없는 pm은 버림)', out.length === 2 && out.map(b => b.id).join() === 'am,lunch', JSON.stringify(out.map(b => b.id)));
check('am: 범주에 안 맞는 유형·카탈로그 밖 장소는 빠지고 둘 남는다', out[0].category === 'study' && out[0].options.length === 2 && out[0].options.every(o => o.placeId !== 'the-climb-yeonnam' && o.placeId !== 'nope'), JSON.stringify(out[0]));
check('lunch: 정해진 범주로 고정, 중복 장소 제거, 긴 글은 자른다, 이모지가 아니면 유형 이모지', out[1].category === 'meal' && out[1].options.length === 2 && out[1].options[1].title.length === MAX_TITLE && out[1].options[1].reason.length === MAX_REASON && out[1].options[1].emoji === '🏠', JSON.stringify(out[1]));
check('이모지는 하나만 (변형 선택자 포함)', out[0].options[1].emoji === '☕️', out[0].options[1].emoji);
check('카드가 2장 미만이면 블록을 뺀다', parsePlan(JSON.stringify({ blocks: [{ id: 'am', category: 'study', options: [{ placeId: 'home', title: '집', reason: '', emoji: '🏠' }] }] }), req).length === 0, '');
check('범주를 안 정했는데 모델도 이상한 걸 내면 뺀다', parsePlan(JSON.stringify({ blocks: [{ id: 'am', category: 'sleep', options: [] }] }), req).length === 0, '');
check('깨진 JSON은 빈 배열', parsePlan('{', req).length === 0 && parsePlan('{"blocks":"x"}', req).length === 0, '');
check('빈 이유는 채운다', parsePlan(JSON.stringify({ blocks: [{ id: 'lunch', category: 'meal', options: [{ placeId: 'home', title: '집밥', reason: '', emoji: '🍚' }, { placeId: 'tuktuk-noodle', title: '팟타이', reason: '', emoji: '🍜' }] }] }), req)[0].options[0].reason.length > 0, '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
