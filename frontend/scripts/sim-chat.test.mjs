// 대화 harness (ADR-0002, sim/chat.ts) — 알아듣기·답장·실 합치기, 그리고 이 기능의 전부인
// "지쳤다고 하면 진짜로 전화가 온다". Usage: node scripts/sim-chat.test.mjs   (exit 1 on any failed check)
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

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

const { buildThread, intentOf, replyTo, reactToWorry, trimMessages, unreadCount, worryOf, WORRY_CALL_MS } = await import('../src/sim/chat.ts');
const { fmtDur, worryLines } = await import('../src/sim/call.ts');
const { placeById } = await import('../src/sim/places.ts');
const { jumpedTo } = await import('../src/sim/clock.ts');
const { INITIAL_STATUS } = await import('../src/sim/status.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

const waiting = { kind: 'waiting', at: placeById('home'), currentBlockId: 'pm', nextBlockId: 'evening', nextStartAt: null, tz: 'Asia/Seoul', jetlag: false, companions: [] };
const sleeping = { kind: 'sleeping', until: T0 + 3600_000, at: placeById('home'), tz: 'Asia/Seoul' };
const ctx = (phase = waiting, seed = 'k') => ({ phase, status: INITIAL_STATUS, name: '모모', seed });

// ── 알아듣기 ─────────────────────────────────────────────────────────────────
console.log('\n── 알아듣기 ──');
check('지쳤다는 말을 알아듣는다', intentOf('나 오늘 너무 지쳤어') === 'tired', intentOf('나 오늘 너무 지쳤어'));
check('어디냐고 물으면 안다', intentOf('너 지금 어디야?') === 'where', intentOf('너 지금 어디야?'));
check('뭐 하냐고 물으면 안다', intentOf('뭐 해?') === 'what', intentOf('뭐 해?'));
check('전화해 달라는 말을 안다', intentOf('전화 좀 해줘') === 'call', intentOf('전화 좀 해줘'));
check('모르는 말은 모른다고 한다', intentOf('ㅁㄴㅇㄹ 우가우가') === 'unknown', intentOf('ㅁㄴㅇㄹ 우가우가'));
check('사람에 지친 건 people', worryOf('사람한테 너무 지쳤어') === 'people', worryOf('사람한테 너무 지쳤어'));
check('일에 지친 건 work', worryOf('일이 안 풀려서 힘들어') === 'work', worryOf('일이 안 풀려서 힘들어'));
check('짚을 게 없으면 몸으로 본다', worryOf('그냥 지쳤어') === 'body', worryOf('그냥 지쳤어'));

// ── 답장 ─────────────────────────────────────────────────────────────────────
console.log('\n── 답장 ──');
const tired = replyTo('나 사람한테 너무 지쳤어', ctx());
check('지쳤다고 하면 고민으로 듣는다', tired.worry === 'people', String(tired.worry));
check('그 자리에서 전화를 약속한다', /전화/.test(tired.text), tired.text);
check('같은 시드면 같은 답장', replyTo('나 사람한테 너무 지쳤어', ctx()).text === tired.text, '');
check('모르면 모른다고 답한다', /모르겠|무슨 말/.test(replyTo('ㅁㄴㅇㄹ', ctx()).text), replyTo('ㅁㄴㅇㄹ', ctx()).text);
check('어디냐고 물으면 장소를 말한다', replyTo('어디야?', ctx()).text.includes(placeById('home').name), replyTo('어디야?', ctx()).text);
check('전화해 달라면 걸어 준다', replyTo('전화해줘', ctx()).callMe === true, '');
const asleep = replyTo('뭐 해?', ctx(sleeping));
check('자는 중이면 답이 늦는다', asleep.delayMs > replyTo('뭐 해?', ctx()).delayMs, String(asleep.delayMs));
check('늦게 답할 땐 먼저 사과한다', /미안|자고/.test(asleep.text), asleep.text);
check('자는 중에도 지쳤다는 말엔 전화를 약속한다', !!replyTo('지쳤어', ctx(sleeping)).worry, '');
check('약속 문구는 시드가 안정적이다', reactToWorry('people', 'x') === reactToWorry('people', 'x'), '');

// ── 실 합치기 ────────────────────────────────────────────────────────────────
console.log('\n── 대화 실 ──');
const msgs = [
  { id: 'm1', at: T0 - 60_000, from: 'me', text: '뭐 해?' },
  { id: 'm1:r', at: T0 - 30_000, from: 'agent', text: '카페야' },
  { id: 'm2:r', at: T0 + 600_000, from: 'agent', text: '아직 안 온 답장' },
];
const reqs = [{ id: 'r1', kind: 'worry', at: T0 - 120_000, dueAt: T0 + 3600_000, line: '무슨 일 있어?', choices: [] }];
const calls = [{ id: 'c1', at: T0 - 90_000, dir: 'in', result: 'answered', durSec: 192 }];
const thread = buildThread(msgs, reqs, calls, T0);
check('세 갈래가 한 실에 섞인다', thread.length === 4, String(thread.length));
check('시각 순으로 선다', thread.map(i => i.id).join(',') === 'r1,c1,m1,m1:r', thread.map(i => i.id).join(','));
check('아직 안 온 답장은 안 보인다', !thread.some(i => i.id === 'm2:r'), '');
check('통화 기록도 한 줄로 들어간다', thread.some(i => i.kind === 'call' && i.call.durSec === 192), '');
check('안 읽은 줄만 센다', unreadCount(thread, T0 - 100_000) === 2, String(unreadCount(thread, T0 - 100_000)));
check('내가 보낸 말은 안 읽은 줄이 아니다', unreadCount(buildThread([msgs[0]], [], [], T0), 0) === 0, '');
check('통화 시간은 사람 말로 읽힌다', fmtDur(192) === '3분 12초' && fmtDur(9) === '9초', `${fmtDur(192)} / ${fmtDur(9)}`);
check('실은 최근 것만 남긴다', trimMessages(Array.from({ length: 100 }, (_, i) => ({ id: String(i), at: T0 + i, from: 'me', text: 'x' })), 0).length === 80, '');

// ── 지쳤다고 하면 진짜로 전화가 온다 (ADR-0002의 전부) ───────────────────────
console.log('\n── 고민 → 전화 ──');
const req = { id: `${S().today}:worry`, kind: 'worry', at: S().now, dueAt: S().now + 4 * 3600_000, line: '무슨 일 있어?', choices: [{ id: 'people', label: '사람한테 지침' }] };
useWorld.setState({ requests: [req], messages: [], calls: [], dueCalls: [], activeCall: null, say: null });
S().answerRequest(req.id, 'people');
check('들은 고민이 메모리에 남는다', S().memory.worry?.key === 'people', JSON.stringify(S().memory.worry));
check('그 자리에서 한마디 한다', !!S().say && /전화/.test(S().say.text), JSON.stringify(S().say));
check('그 한마디가 대화 실에도 남는다', S().messages.some(m => m.from === 'agent' && /전화/.test(m.text)), '');
check('전화가 예약된다', S().dueCalls.length === 1 && S().dueCalls[0].worry === 'people', JSON.stringify(S().dueCalls));

S().tick();
check('약속한 시각 전에는 안 온다', S().activeCall === null, JSON.stringify(S().activeCall));

S().jumpBy(WORRY_CALL_MS + 60_000);
S().tick();
const inc = S().activeCall;
check('약속한 시각이 되면 전화가 온다', !!inc && inc.dir === 'in' && inc.why === 'worry', JSON.stringify(inc));
check('통화가 그 고민을 짚는다', inc?.lines?.[0] === worryLines('people', inc.id.slice(3))[0], JSON.stringify(inc?.lines));
check('예약은 한 번만 쓰인다', S().dueCalls.length === 0, JSON.stringify(S().dueCalls));

S().answerCall(true);
check('받으면 통화가 시작된 시각이 찍힌다', S().calls.find(c => c.id === inc.id).startedAt === S().now, '');
S().jumpBy(192_000);
S().endCall();
const rec = S().calls.find(c => c.id === inc.id);
check('끊으면 통화 시간이 남는다', rec.durSec === 192, String(rec.durSec));
check('통화가 대화 실의 그 시각에 꽂힌다', buildThread(S().messages, S().requests, S().calls, S().now).some(i => i.kind === 'call' && i.call.id === inc.id), '');

// ── 채팅으로 말해도 같은 일이 된다 (칩과 대화창, 둘 다) ─────────────────────
console.log('\n── 채팅 → 전화 ──');
useWorld.setState({ requests: [], messages: [], calls: [], dueCalls: [], activeCall: null, say: null, memory: { ...S().memory, worry: undefined } });
S().sendMessage('나 일 때문에 너무 지쳤어');
check('내 말이 실에 남는다', S().messages.some(m => m.from === 'me' && m.at <= S().now), JSON.stringify(S().messages));
check('답장은 시간을 두고 온다', S().messages.some(m => m.from === 'agent' && m.at > S().now), JSON.stringify(S().messages));
check('채팅으로 말해도 고민으로 듣는다', S().memory.worry?.key === 'work', JSON.stringify(S().memory.worry));
check('채팅으로 말해도 전화가 예약된다', S().dueCalls.length === 1 && S().dueCalls[0].worry === 'work', JSON.stringify(S().dueCalls));
check('보내자마자는 답장이 실에 없다', !buildThread(S().messages, [], [], S().now).some(i => i.kind === 'msg' && i.msg.from === 'agent'), '');
S().jumpBy(WORRY_CALL_MS + 5 * 60_000);
check('시간이 지나면 답장이 보인다', buildThread(S().messages, [], [], S().now).some(i => i.kind === 'msg' && i.msg.from === 'agent'), '');
S().tick();
check('채팅에서 시작한 전화도 온다', S().activeCall?.why === 'worry', JSON.stringify(S().activeCall));
S().answerCall(false);

// ── 못 받으면 내용이 없다 (ADR-0001) ────────────────────────────────────────
console.log('\n── 부재중 ──');
useWorld.setState({ activeCall: null, calls: [], dueCalls: [{ id: 'later', at: S().now + 60_000, why: 'worry', worry: 'work' }] });
// 앱을 오래 꺼 둔 상태로 그 시각을 지나간다 (lastTick은 그대로, 시계만 앞으로)
useWorld.setState({ clock: jumpedTo(S().clock, S().now + 3 * 3600_000) });
S().tick();
check('자리를 비운 사이의 전화는 부재중이 된다', S().activeCall === null && S().calls.length === 1, JSON.stringify(S().calls));
check('부재중에는 내용이 없다', S().calls[0].lines === undefined, JSON.stringify(S().calls[0]));

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
