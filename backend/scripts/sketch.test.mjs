// 그림 읽기 harness — 프롬프트와 파서 (Ollama 없이). Usage: node scripts/sketch.test.mjs
const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const { buildSketchPrompt, parseSketchRead, sketchSchema } = await import('../src/sketch.ts');

const req = { tier: 'good', sketch: 'data:image/png;base64,AAAA', category: 'play', options: [
  { id: 'a', title: '레이어드에서 커피', placeName: '레이어드 연남', placeType: 'cafe' },
  { id: 'b', title: '경의선숲길 산책', placeName: '경의선숲길', placeType: 'park' },
  { id: 'c', title: '펀시티에서 오락실 한 판', placeName: '펀시티 홍대점', placeType: 'arcade' },
] };
console.log('\n── 프롬프트 ──');
const p = buildSketchPrompt(req);
check('옵션 셋이 id와 함께 들어간다', ['id="a"', 'id="b"', 'id="c"', '경의선숲길 산책'].every(x => p.includes(x)), p);
check('모르면 null이라고 못 박는다', p.includes('null'), '');
check('스키마는 옵션 id와 null만 허용한다', JSON.stringify(sketchSchema(['a', 'b']).properties.optionId.enum) === '["a","b",null]', '');

console.log('\n── 파서 ──');
const ids = ['a', 'b', 'c'];
check('정상', JSON.stringify(parseSketchRead('{"seen":"컵","optionId":"a","category":"play"}', ids)) === '{"optionId":"a","seen":"컵","category":"play"}', JSON.stringify(parseSketchRead('{"seen":"컵","optionId":"a","category":"play"}', ids)));
check('모르는 범주는 null', parseSketchRead('{"seen":"컵","optionId":null,"category":"snack"}', ids).category === null, '');
check('범주만 알아본 것도 온다', parseSketchRead('{"seen":"피자","optionId":null,"category":"meal"}', ids).category === 'meal', '');
check('스키마에 범주가 있다', sketchSchema(['a']).properties.category.enum.includes('meal') && sketchSchema(['a']).properties.category.enum.includes(null), '');
check('없는 id는 null', parseSketchRead('{"seen":"컵","optionId":"zzz"}', ids).optionId === null, '');
check('null은 null', parseSketchRead('{"seen":"모르겠음","optionId":null}', ids).optionId === null, '');
check('seen은 짧게 자른다', parseSketchRead(`{"seen":"${'가'.repeat(40)}","optionId":"b"}`, ids).seen.length === 12, '');
check('깨진 JSON은 못 읽은 것', JSON.stringify(parseSketchRead('컵', ids)) === '{"optionId":null,"seen":"","category":null}', '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
