// 백엔드 harness — 프롬프트와 파서, 그리고 서버의 계약 검증. Ollama 없이 돈다.
// Usage: node scripts/reply.test.mjs   (exit 1 on any failed check)
const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { buildPrompt, parseReply, MAX_REPLY } = await import('../src/reply.ts');

const req = {
  tier: 'small',
  agent: { name: '모모', traits: ['느긋한'], likes: ['카페'], dislikes: [] },
  situation: { where: '연남동 카페', doing: '커피 마시는 중', hhmm: '16:25', lateWhy: null, mood: 70, fatigue: 20, worry: null },
  recent: [{ from: 'me', text: '잘 지내?' }, { from: 'agent', text: '나야 좋지! 너는?' }],
  texts: ['야', '어디야', '뭐해'],
};

console.log('\n── 프롬프트 ──');
const p = buildPrompt(req);
check('이름과 상황이 시스템 프롬프트에 들어간다', p.system.includes('"모모"') && p.system.includes('연남동 카페에서 커피 마시는 중'), p.system.slice(0, 120));
check('늦게 본 게 아니면 사과 지시가 없다', !p.system.includes('미안'), '');
check('늦게 봤으면 사과 지시가 붙는다', buildPrompt({ ...req, situation: { ...req.situation, lateWhy: '자느라' } }).system.includes('자느라 못 봤고'), '');
check('들은 고민이 있으면 기억하라고 한다', buildPrompt({ ...req, situation: { ...req.situation, worry: 'work' } }).system.includes('일 때문에 힘들다고'), '');
check('최근 대화와 이번 묶음이 나뉜다', p.user.includes('[최근 대화]') && p.user.includes('[방금 온 말]') && p.user.indexOf('[최근 대화]') < p.user.indexOf('[방금 온 말]'), p.user);
check('이번 묶음 세 줄이 다 들어간다', ['사용자: 야', '사용자: 어디야', '사용자: 뭐해'].every(l => p.user.includes(l)), p.user);
check('최근 대화가 없으면 그 칸이 없다', !buildPrompt({ ...req, recent: [] }).user.includes('[최근 대화]'), '');

console.log('\n── 파서 ──');
check('정상 JSON', JSON.stringify(parseReply('{"text":"나 카페야. 커피 마시는 중","worry":null,"callMe":false}')) === JSON.stringify({ text: '나 카페야. 커피 마시는 중', worry: null, callMe: false }), '');
check('null text는 읽씹', parseReply('{"text":null,"worry":null,"callMe":false}').text === null, '');
check('줄바꿈은 한 줄로', parseReply('{"text":"나 카페야\\n커피 마시는 중","worry":null,"callMe":false}').text === '나 카페야 커피 마시는 중', parseReply('{"text":"나 카페야\\n커피 마시는 중","worry":null,"callMe":false}').text);
check('너무 길면 자른다', parseReply(`{"text":"${'가'.repeat(200)}","worry":null,"callMe":false}`).text.length <= MAX_REPLY + 1, '');
check('모르는 worry는 버린다', parseReply('{"text":"x","worry":"love","callMe":false}').worry === null, '');
check('아는 worry는 남긴다', parseReply('{"text":"헉 왜, 이따 전화할게","worry":"people","callMe":false}').worry === 'people', '');
check('callMe는 true일 때만', parseReply('{"text":"지금 걸게","worry":null,"callMe":"yes"}').callMe === false && parseReply('{"text":"지금 걸게","worry":null,"callMe":true}').callMe === true, '');
check('깨진 JSON은 침묵', parseReply('나 카페야').text === null, '');
check('빈 문자열은 침묵', parseReply('{"text":"  ","worry":null,"callMe":false}').text === null, '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
