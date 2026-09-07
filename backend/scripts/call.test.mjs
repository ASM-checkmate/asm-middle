// 통화 harness (ADR-0011, src/call.ts) — 프롬프트·문장 나누기·다듬기, 그리고 스트리밍 파서. Ollama 없이 돈다.
// Usage: node scripts/call.test.mjs   (exit 1 on any failed check)
const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { MAX_SENTENCE, buildCallPrompt, callTurn, splitSentences, tidy } = await import('../src/call.ts');

const req = {
  tier: 'small',
  agent: { name: '모모', traits: ['느긋한'], likes: ['카페'], dislikes: [] },
  situation: { where: '연남동 카페', doing: '커피 마시는 중', hhmm: '16:25', mood: 70, fatigue: 20 },
  why: 'worry', worry: 'people',
  transcript: [{ from: 'agent', text: '여보세요, 나야.' }, { from: 'me', text: '어 왔어?' }],
  user: '아 그냥 팀 사람들이 좀 그래',
};

console.log('\n── 프롬프트 ──');
const p = buildCallPrompt(req);
check('통화 중이라는 것과 상황이 시스템 프롬프트에', p.system.includes('전화 통화 중') && p.system.includes('연남동 카페에서 커피 마시는 중'), p.system.slice(0, 160));
check('약속한 전화면 고민을 먼저 묻고 내가 뭘 하겠다를 말하라고', p.system.includes('사람 때문에 힘들다고') && p.system.includes('네가 오늘 뭘 하겠다'), '');
check('말로 하는 규칙 — 짧게, 이모지·지문 금지', p.system.includes('한 턴에 한두 문장') && p.system.includes('지문 금지'), '');
check('지금까지와 방금 들은 말이 나뉜다', p.user.includes('[지금까지]') && p.user.includes('모모: 여보세요, 나야.') && p.user.includes('[방금 들은 말]') && p.user.includes('사용자: 아 그냥 팀 사람들이 좀 그래'), p.user);
const first = buildCallPrompt({ ...req, transcript: [], user: null });
check('첫 턴이면 네가 먼저 말하라고 한다', first.user.includes('네가 먼저 말한다') && !first.user.includes('[지금까지]'), first.user);
check('사용자가 걸었으면 그렇게 적는다', buildCallPrompt({ ...req, why: 'out' }).system.includes('사용자가 먼저 걸어 왔다'), '');

console.log('\n── 문장 나누기 ──');
let r = splitSentences('어 그랬구나. 많이 힘들었겠다! 오늘은 조용');
check('마침표·느낌표에서 자르고 꼬리를 남긴다', r.sentences.join('|') === '어 그랬구나.|많이 힘들었겠다!' && r.rest === '오늘은 조용', JSON.stringify(r));
r = splitSentences('누가 그랬어?\n');
check('물음표와 줄바꿈', r.sentences.join('|') === '누가 그랬어?' && r.rest === '', JSON.stringify(r));
r = splitSentences('음… 듣고 있어. ');
check('말줄임표는 안 자른다', r.sentences[0] === '음… 듣고 있어.' && r.rest === '', JSON.stringify(r));
r = splitSentences('아직 안 끝난 문장');
check('끝이 없으면 전부 꼬리', r.sentences.length === 0 && r.rest === '아직 안 끝난 문장', JSON.stringify(r));

console.log('\n── 다듬기 ──');
check('이름표와 따옴표를 뗀다', tidy('모모: "여보세요"') === '여보세요', tidy('모모: "여보세요"'));
check('지문·이모지를 걷어 낸다', tidy('(웃음) 나야 😊 *손 흔들며*') === '나야', tidy('(웃음) 나야 😊 *손 흔들며*'));
check('너무 길면 자른다', tidy('가 '.repeat(60)).length <= MAX_SENTENCE + 1, '');

console.log('\n── 스트리밍 ──');
{
  // Ollama의 ndjson 스트림을 흉내 낸다 — 토큰이 조각조각 오고, 문장이 끝날 때마다 onSentence가 불려야 한다
  const tokens = ['어… ', '그랬', '구나. ', '많이 ', '힘들었겠다', '! ', '오늘은 ', '내가 조용한 데로 잡아 놨어'];
  const body = tokens.map(t => JSON.stringify({ message: { content: t }, done: false }) + '\n').join('') + JSON.stringify({ message: { content: '' }, done: true }) + '\n';
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    const enc = new TextEncoder();
    const parts = [body.slice(0, 40), body.slice(40, 95), body.slice(95)];
    const stream = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
    return { ok: true, status: 200, body: stream, text: async () => '' };
  };
  try {
    const got = [];
    const out = await callTurn(req, 'm', { url: 'http://o', timeoutMs: 1000 }, s => got.push(s));
    check('문장이 완성될 때마다 흘러나온다', got.join('|') === '어… 그랬구나.|많이 힘들었겠다!|오늘은 내가 조용한 데로 잡아 놨어', JSON.stringify(got));
    check('반환값도 같다', JSON.stringify(out) === JSON.stringify(got), '');
    check('스트리밍으로, 짧게, 형식 없이 부른다', sent.stream === true && sent.options.num_predict <= 120 && !('format' in sent), JSON.stringify(sent.options));
  } finally { globalThis.fetch = realFetch; }
}

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
