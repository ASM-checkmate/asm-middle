// 말로 하는 통화 harness (ADR-0011, sim/callvoice.ts + store) — 턴 요청 조립, ndjson 스트림 파서, 통화 줄 쌓기.
// 브라우저(마이크·WebSocket) 없이 돈다. Usage: node scripts/sim-voice.test.mjs   (exit 1 on any failed check)
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

const { callTurnRequestOf, streamCallTurn } = await import('../src/sim/callvoice.ts');
const { placeById } = await import('../src/sim/places.ts');
const { INITIAL_STATUS } = await import('../src/sim/status.ts');
const { useWorld, DEFAULT_MEMORY } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

console.log('\n── 턴 요청 ──');
const waiting = { kind: 'waiting', at: placeById('layered-yeonnam'), currentBlockId: 'pm', nextBlockId: 'evening', nextStartAt: null, tz: 'Asia/Seoul', jetlag: false, companions: [] };
const st = { phase: waiting, status: INITIAL_STATUS, memory: { ...DEFAULT_MEMORY, worry: { key: 'people', at: T0 - 3600_000 } }, now: T0 };
const inCall = { id: 'in:w1', at: T0, dir: 'in', result: 'answered', why: 'worry', startedAt: T0 };
let r = callTurnRequestOf(inCall, [{ from: 'agent', text: '여보세요' }], null, st, 'small');
check('약속한 전화면 why=worry, 최근 고민이 실린다', r.why === 'worry' && r.worry === 'people' && r.user === null && r.transcript.length === 1, JSON.stringify(r));
check('상황은 지금 있는 곳', r.situation.where === '카페 레이어드 연남' && r.situation.hhmm === '16:00' && r.agent.name === '모모', JSON.stringify(r.situation));
r = callTurnRequestOf({ ...inCall, dir: 'out', why: undefined }, [], '뭐해', st, 'good');
check('내가 걸었으면 why=out, 고민은 안 싣는다', r.why === 'out' && r.worry === null && r.user === '뭐해' && r.tier === 'good', JSON.stringify([r.why, r.worry]));
r = callTurnRequestOf({ ...inCall, why: undefined }, [], null, st, 'small');
check('why 없는 수신은 어긋남 통보', r.why === 'friction', r.why);
r = callTurnRequestOf(inCall, Array.from({ length: 30 }, (_, i) => ({ from: 'me', text: String(i) })), 'x', st, 'small');
check('오간 말은 마지막 20줄만', r.transcript.length === 20 && r.transcript[0].text === '10', String(r.transcript.length));
check('오래된 고민은 잊는다', callTurnRequestOf(inCall, [], null, { ...st, memory: { ...st.memory, worry: { key: 'people', at: T0 - 10 * 24 * 3600_000 } } }, 'small').worry === null, '');

console.log('\n── 스트림 파서 ──');
const ndjson = '{"s":"어… 그랬구나."}\n{"s":"많이 힘들었겠다."}\n{"done":true,"model":"m","ms":1}\n';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const enc = new TextEncoder();
  const parts = [ndjson.slice(0, 15), ndjson.slice(15, 50), ndjson.slice(50)];
  return { ok: true, status: 200, body: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), _url: url, _body: JSON.parse(init.body) };
};
try {
  const got = [];
  const out = await streamCallTurn(r, s => got.push(s), new AbortController().signal);
  check('문장마다 콜백, 조각난 청크도 이어 붙인다', got.join('|') === '어… 그랬구나.|많이 힘들었겠다.' && JSON.stringify(out) === JSON.stringify(got), JSON.stringify(got));
  globalThis.fetch = async () => ({ ok: false, status: 502, body: null });
  check('서버가 실패하면 빈 배열 (통화는 계속)', (await streamCallTurn(r, () => {}, new AbortController().signal)).length === 0, '');
  globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
  check('끊겨도 조용히 빈 배열', (await streamCallTurn(r, () => {}, new AbortController().signal)).length === 0, '');
} finally { globalThis.fetch = realFetch; }

console.log('\n── 통화 줄 쌓기 ──');
S().jumpToHour(8, 50);   // 집에서 기다리는 중 — 받을 수 있는 상황
S().callAgent();
const c0 = S().activeCall;
check('내가 걸면 규칙 대사가 먼저 있다', c0 && c0.result === 'answered' && c0.lines.length >= 2 && !c0.voice, JSON.stringify(c0));
S().beginVoiceCall();
check('말로 붙으면 규칙 대사를 비우고 voice를 켠다', S().activeCall.voice === true && S().activeCall.lines.length === 0, JSON.stringify(S().activeCall));
S().appendCallLine('agent', '여보세요, 나야.');
S().appendCallLine('me', '어 왔어?');
S().appendCallLine('agent', '뭐 하고 있었어?');
check('오간 말이 순서대로, 내 말은 "나: "로', S().activeCall.lines.join('|') === '여보세요, 나야.|나: 어 왔어?|뭐 하고 있었어?', JSON.stringify(S().activeCall.lines));
check('calls 기록에도 같은 줄', S().calls.find(c => c.id === c0.id).lines.length === 3 && S().calls.find(c => c.id === c0.id).voice === true, '');
S().jumpBy(45_000);
S().endCall();
const done = S().calls.find(c => c.id === c0.id);
check('끊으면 통화 시간과 줄이 남는다', S().activeCall === null && done.durSec >= 45 && done.lines.length === 3 && done.voice === true, JSON.stringify(done));
check('저장본에도 남는다', JSON.parse(storage.get('theworld.world.v5')).calls.some(c => c.id === c0.id && c.voice && c.lines.length === 3), '');
S().appendCallLine('me', '끊긴 뒤');
check('통화가 없으면 줄을 안 쌓는다', S().calls.find(c => c.id === c0.id).lines.length === 3, '');

console.log('\n── 통화가 붙으면 하루 계획을 양보한다 ──');
{
  let seen = null; let release;
  const gate = new Promise(r => { release = r; });
  globalThis.fetch = async (url, init) => { if (String(url) === '/api/plan/options') { seen = init.signal; await gate; return { ok: false, status: 502, json: async () => ({}) }; } return { ok: false, status: 404, json: async () => ({}) }; };
  try {
    S().jumpToHour(8, 55);
    const { emptyPlans } = await import('../src/sim/timeline.ts');
    const fresh = emptyPlans();   // 앞 절에서 지나간 블록들이 이미 정해져 있다 — 빈 하루로 되돌린다
    useWorld.setState({ plans: fresh, days: { ...S().days, [S().today]: fresh }, llmPlans: {} });
    const p = S().planDay();
    await new Promise(r => setTimeout(r, 10));
    check('계획 요청이 나갔고 아직 안 끊겼다', seen && !seen.aborted && S().planBusy === true, JSON.stringify([!!seen, seen?.aborted, S().planBusy]));
    S().callAgent(); S().beginVoiceCall();
    check('말 통화가 붙으면 계획 요청을 끊는다', seen.aborted === true, String(seen?.aborted));
    release(); await p;
    check('끊긴 뒤엔 busy가 내려간다', S().planBusy === false, '');
    S().endCall();
  } finally { globalThis.fetch = realFetch; }
}

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
