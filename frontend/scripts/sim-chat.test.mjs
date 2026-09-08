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

const { buildThread, intentOf, isUnread, openBatch, replyTo, replyToAll, reactToWorry, trimMessages, unreadCount, worryOf, WORRY_CALL_MS } = await import('../src/sim/chat.ts');
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
check('집중이 안 되는 건 focus', worryOf('집중이 안 돼서 힘들어') === 'focus', worryOf('집중이 안 돼서 힘들어'));
check('그냥 안 좋은 건 blue', worryOf('그냥 기분이 안 좋아') === 'blue', worryOf('그냥 기분이 안 좋아'));

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

// ── 읽음 · 읽씹 · 묶음 답장 (ADR-0005) ──────────────────────────────────────
console.log('\n── 읽음 / 읽씹 ──');
check('추임새는 추임새로 듣는다', intentOf('ㅋㅋㅋ') === 'ack' && intentOf('ㅇㅇ') === 'ack' && intentOf('응 알겠어~') === 'ack', `${intentOf('ㅋㅋㅋ')} ${intentOf('응 알겠어~')}`);
check('추임새에 물음이 섞이면 물음이다', intentOf('ㅋㅋ 어디야') === 'where', intentOf('ㅋㅋ 어디야'));
const ack = replyTo('ㅋㅋ', ctx());
check('추임새만 오면 읽고 답하지 않는다 (읽씹)', ack.text === undefined && ack.readMs > 0 && ack.delayMs === ack.readMs, JSON.stringify(ack));
const plain = replyTo('어디야?', ctx());
check('읽는 시각이 답하는 시각보다 앞선다', plain.readMs > 0 && plain.delayMs > plain.readMs, JSON.stringify([plain.readMs, plain.delayMs]));
const sulky = replyTo('안녕!', { ...ctx(), status: { ...INITIAL_STATUS, mood: 20 } });
check('기분이 바닥이면 인사는 읽씹한다', sulky.text === undefined, JSON.stringify(sulky));
check('기분이 바닥이어도 지쳤다는 말엔 답한다', !!replyTo('지쳤어', { ...ctx(), status: { ...INITIAL_STATUS, mood: 20 } }).text, '');
const asleepRead = replyTo('뭐 해?', { ...ctx(sleeping), now: T0 });
check('자는 중엔 깰 때까지 안 읽는다 (안읽씹)', asleepRead.readMs >= 3600_000, String(asleepRead.readMs));
check('자다가도 지쳤다는 말은 금방 본다', replyTo('지쳤어', { ...ctx(sleeping), now: T0 }).readMs <= 4 * 60_000, '');
const three = replyToAll(['야', '어디야', '뭐해'], ctx());
check('세 줄에 답은 한 줄이다', typeof three.text === 'string' && !three.text.includes('\n'), JSON.stringify(three));
check('제일 급한 물음에 답하고 다음 물음을 덧붙인다', three.text.includes(placeById('home').name) && /중/.test(three.text), three.text);
check('못 알아들은 줄은 알아들은 줄이 있으면 넘긴다', !/모르겠|무슨 말/.test(replyToAll(['ㅁㄴㅇㄹ', '어디야'], ctx()).text), replyToAll(['ㅁㄴㅇㄹ', '어디야'], ctx()).text);
check('같은 묶음 같은 시드면 같은 답', replyToAll(['야', '어디야'], ctx()).text === replyToAll(['야', '어디야'], ctx()).text, '');

console.log('\n── 스토어: 연달아 보내면 한 번에 읽고 한 번에 답한다 ──');
useWorld.setState({ requests: [], messages: [], calls: [], dueCalls: [], activeCall: null, say: null, memory: { ...S().memory, worry: undefined } });
S().sendMessage('야');
S().jumpBy(3_000);
S().sendMessage('어디야');
S().jumpBy(3_000);
S().sendMessage('뭐해');
const mine = S().messages.filter(m => m.from === 'me');
const theirs = S().messages.filter(m => m.from === 'agent');
check('내 말 셋이 한 묶음이다', mine.length === 3 && new Set(mine.map(m => m.batch)).size === 1, JSON.stringify(mine.map(m => m.batch)));
check('답장은 하나뿐이다', theirs.length === 1, JSON.stringify(theirs));
check('보내자마자는 셋 다 안 읽음 ("1")', mine.every(m => isUnread(m, S().now)), JSON.stringify(mine.map(m => m.readAt - S().now)));
check('셋을 같은 순간에 읽는다', new Set(mine.map(m => m.readAt)).size === 1, JSON.stringify(mine.map(m => m.readAt)));
check('답장은 읽은 뒤에 온다', theirs[0].at > mine[0].readAt, `${theirs[0].at} vs ${mine[0].readAt}`);
check('묶음은 답이 올 때까지 열려 있다', openBatch(S().messages, S().now) === mine[0].batch, String(openBatch(S().messages, S().now)));
S().jumpBy(mine[0].readAt - S().now + 1_000);
check('읽는 시각이 지나면 "1"이 사라진다', S().messages.filter(m => m.from === 'me').every(m => !isUnread(m, S().now)), '');
check('읽었지만 아직 답은 안 왔다', !buildThread(S().messages, [], [], S().now).some(i => i.kind === 'msg' && i.msg.from === 'agent'), '');
S().jumpBy(theirs[0].at - S().now + 1_000);
check('답이 오면 실에 보인다', buildThread(S().messages, [], [], S().now).some(i => i.kind === 'msg' && i.msg.from === 'agent'), '');
check('답이 오면 묶음이 닫힌다', openBatch(S().messages, S().now) === null, String(openBatch(S().messages, S().now)));
S().jumpBy(60_000);
S().sendMessage('ㅋㅋ');
const ackMsg = S().messages.filter(m => m.from === 'me').at(-1);
check('닫힌 뒤의 말은 새 묶음이다', ackMsg.batch === ackMsg.id, `${ackMsg.batch} / ${ackMsg.id}`);
check('추임새엔 답장이 저장되지 않는다 (읽씹)', S().messages.filter(m => m.from === 'agent').length === 1, JSON.stringify(S().messages.filter(m => m.from === 'agent')));
check('그래도 읽는 시각은 있다', isUnread(ackMsg, S().now) && ackMsg.readAt > S().now, JSON.stringify(ackMsg));
// 고민을 묶음에 뒤늦게 붙이면 앞의 답장이 고민 답장으로 바뀌고 전화가 잡힌다
useWorld.setState({ messages: [], dueCalls: [], memory: { ...S().memory, worry: undefined } });
S().sendMessage('어디야');
S().jumpBy(2_000);
S().sendMessage('나 일 때문에 너무 지쳤어');
check('뒤늦게 붙은 고민에 답장이 갈아끼워진다', S().messages.filter(m => m.from === 'agent').length === 1 && /전화/.test(S().messages.find(m => m.from === 'agent').text), JSON.stringify(S().messages.filter(m => m.from === 'agent')));
check('그 묶음으로 전화가 하나만 예약된다', S().dueCalls.length === 1 && S().dueCalls[0].worry === 'work', JSON.stringify(S().dueCalls));
useWorld.setState({ messages: [], dueCalls: [], memory: { ...S().memory, worry: undefined } });

// ── 백엔드가 지은 답장 끼우기 (ADR-0006): 본 적 없는 답장만 바뀐다 ──────────
console.log('\n── LLM 답장 끼우기 ──');
S().sendMessage('어디야');
const b = S().messages.find(m => m.from === 'me').batch;
const ruleText = S().messages.find(m => m.id === `${b}:r`).text;
S().applyLlmReply(b, 2, { text: '엉뚱한 seq', worry: null, callMe: false, model: 'x', ms: 1 });
check('묶음에 말이 더 붙은 뒤 온 답장은 버린다', S().messages.find(m => m.id === `${b}:r`).text === ruleText, '');
S().applyLlmReply(b, 1, { text: '나 지금 레이어드야, 커피 마셔', worry: null, callMe: false, model: 'x', ms: 1 });
check('제때 온 답장은 말만 갈아끼운다', S().messages.find(m => m.id === `${b}:r`).text === '나 지금 레이어드야, 커피 마셔', JSON.stringify(S().messages));
check('시각은 규칙이 정한 그대로다', S().messages.find(m => m.id === `${b}:r`).at > S().now, '');
S().applyLlmReply(b, 1, { text: '헉 왜 그래, 이따 전화할게', worry: 'people', callMe: false, model: 'x', ms: 1 });
check('모델이 고민을 알아들으면 전화가 잡힌다', S().dueCalls.some(d => d.id === `worry:${b}`) && S().memory.worry?.key === 'people', JSON.stringify(S().dueCalls));
S().applyLlmReply(b, 1, { text: null, worry: null, callMe: false, model: 'x', ms: 1 });
check('전화를 약속한 묶음은 모델이 침묵을 골라도 답장이 남는다', !!S().messages.find(m => m.id === `${b}:r`), '');
S().jumpBy(S().messages.find(m => m.id === `${b}:r`).at - S().now + 1000);
S().applyLlmReply(b, 1, { text: '늦은 답장', worry: null, callMe: false, model: 'x', ms: 1 });
check('이미 뜬 답장은 바꾸지 않는다', S().messages.find(m => m.id === `${b}:r`).text !== '늦은 답장', '');
useWorld.setState({ messages: [], dueCalls: [], memory: { ...S().memory, worry: undefined } });
S().sendMessage('안녕');
const b2 = S().messages.find(m => m.from === 'me').batch;
S().applyLlmReply(b2, 1, { text: null, worry: null, callMe: false, model: 'x', ms: 1 });
check('모델이 침묵을 고르면 규칙 답장을 지운다 (읽씹)', !S().messages.some(m => m.from === 'agent'), JSON.stringify(S().messages));
useWorld.setState({ messages: [], dueCalls: [], memory: { ...S().memory, worry: undefined } });

// ── 못 받으면 내용이 없다 (ADR-0001) ────────────────────────────────────────
console.log('\n── 부재중 ──');
useWorld.setState({ activeCall: null, calls: [], dueCalls: [{ id: 'later', at: S().now + 60_000, why: 'worry', worry: 'work' }] });
// 앱을 오래 꺼 둔 상태로 그 시각을 지나간다 (lastTick은 그대로, 시계만 앞으로)
useWorld.setState({ clock: jumpedTo(S().clock, S().now + 3 * 3600_000) });
S().tick();
check('자리를 비운 사이의 전화는 부재중이 된다', S().activeCall === null && S().calls.length === 1, JSON.stringify(S().calls));
check('부재중에는 내용이 없다', S().calls[0].lines === undefined, JSON.stringify(S().calls[0]));

// ── 도착 혼잣말 (ADR-0004 오너 결정 6: 도착 알림 대신, 보고 있을 때 도착 순간 한마디) ──────────
console.log('\n── 도착 혼잣말 ──');
const { blockStartAt } = await import('../src/sim/blocks.ts');
const { dayStartOfKey } = await import('../src/sim/tz.ts');
// 다음 날 오전으로 옮겨, 오후 블록에 혼자 가는 계획을 사용자가 확정해 둔다
S().jumpTo(KST(2026, 9, 9, 10, 0));
useWorld.setState({ activeCall: null, calls: [], dueCalls: [], messages: [], requests: [], say: null });
const pmStart = blockStartAt(dayStartOfKey(S().today), 'pm');
// 이동 시간이 있고 동행·말 튼 마주침·마찰이 없는 계획이어야 혼잣말이 나온다 — 시드에 따라 후보를 고른다
const SOLO = ['layered-yeonnam', 'anthracite-hapjeong', 'seoul-forest', 'coffee-hanyakbang', 'seokchon-lake'];
let solo = null;
for (const placeId of SOLO) {
  const opt = { id: `solo-${placeId}`, title: `${placeById(placeId).name}에서 혼자 놀기`, reason: '검사용', emoji: '🙂', placeId, category: 'play' };
  const plans = { ...S().plans, pm: { blockId: 'pm', category: 'play', options: [opt], chosenId: opt.id, chosenBy: 'user', status: 'confirmed' } };
  useWorld.setState({ plans, days: { ...S().days, [S().today]: plans } });
  S().jumpTo(pmStart + 1000);
  const act = S().timeline.find(a => a.dayKey === S().today && a.blockIds[0] === 'pm');
  if (act && act.arriveAt - act.departAt >= 2 * 60_000 && !act.companions.length && !act.encounter?.talked && !act.outcome) { solo = act; break; }
}
check('혼자 가는 계획이 하나 잡힌다', !!solo, JSON.stringify(S().timeline.map(a => [a.key, a.companions, a.encounter, a.outcome?.kind])));
if (solo) {
  S().jumpTo(solo.arriveAt - 30_000);
  check('도착 30초 전엔 이동 중이다', S().phase.kind === 'moving' && S().phase.act.key === solo.key, S().phase.kind);
  // 보고 있는 채로 도착 순간을 지난다 (lastTick은 그대로, 시계만 앞으로) — jumpTo는 전이를 tick에 보여주지 않는다
  useWorld.setState({ clock: jumpedTo(S().clock, solo.arriveAt + 1000) });
  S().tick();
  check('도착하면 활동 중이 된다', S().phase.kind === 'active' && S().phase.act.key === solo.key, S().phase.kind);
  check('도착 순간 기분 한 줄이 뜬다 (부탁이 아니다)', !!S().say && !/찍어/.test(S().say.text), JSON.stringify(S().say));
  check('문자로는 남기지 않는다 — 문자는 마음이 오갈 때만', !S().messages.some(m => m.id.startsWith('arrive:')), JSON.stringify(S().messages));
  const said = S().say?.text;
  S().tick();
  check('한 번만 말한다', S().say?.text === said, JSON.stringify(S().say));
  // 오래 꺼 뒀다가 켠 도착은 말하지 않는다 (보고 있던 사람에게만 하는 말)
  useWorld.setState({ messages: [], say: null });
  S().jumpTo(solo.departAt + 1000);
  useWorld.setState({ clock: jumpedTo(S().clock, S().now + 3 * 3600_000) });
  S().tick();
  check('안 보고 있던 도착에는 혼잣말이 없다', S().say === null && !S().messages.some(m => m.id.startsWith('arrive:')), JSON.stringify(S().say));
}

// ── 약속은 상황과 무관하게 지킨다 (ADR-0013) ─────────────────────────────────
console.log('\n── 약속은 지킨다 ──');
const { ASK_CALL_MS } = await import('../src/sim/chat.ts');
const okAsk = replyTo('전화해줘', ctx());
check('받을 수 있으면 답장 뒤 20초에 건다', okAsk.callMe === true && okAsk.callInMs === okAsk.delayMs + ASK_CALL_MS, JSON.stringify(okAsk));
const blockedAsk = replyTo('전화해줘', { ...ctx(sleeping), now: T0 });
check('자는 중에 걸어 달라면 힐끗 보고 나중에 걸겠다고 한다', blockedAsk.callMe === true && /나중에/.test(blockedAsk.text) && blockedAsk.readMs <= 8 * 60_000 && blockedAsk.delayMs > blockedAsk.readMs, JSON.stringify(blockedAsk));
check('그 약속은 깬 뒤에 지켜진다', blockedAsk.callInMs >= 3600_000 && blockedAsk.callInMs >= blockedAsk.delayMs + ASK_CALL_MS, JSON.stringify(blockedAsk));
const both = replyToAll(['오늘 너무 힘들어', '전화 좀 해줘'], ctx());
check('지쳤다면서 걸어 달라면 곧 거는 고민 전화다', !!both.worry && both.callInMs === both.delayMs + ASK_CALL_MS, JSON.stringify(both));
const bothOne = replyTo('힘들어 전화해줘', ctx());
check('한 줄에 같이 있어도 본다', !!bothOne.worry && bothOne.callInMs === bothOne.delayMs + ASK_CALL_MS, JSON.stringify(bothOne));

const reset = () => useWorld.setState({ requests: [], messages: [], calls: [], dueCalls: [], activeCall: null, say: null, phase: waiting, memory: { ...S().memory, worry: undefined } });
reset();
S().sendMessage('전화해줘');
const askReplyAt = S().messages.find(m => m.from === 'agent').at;
check('걸어 달란 말에 전화가 예약된다', S().dueCalls.length === 1 && S().dueCalls[0].why === 'ask' && S().dueCalls[0].at === askReplyAt + ASK_CALL_MS, JSON.stringify(S().dueCalls));
S().jumpBy(S().dueCalls[0].at - S().now + 1000);
S().tick();
check('그 전화가 실제로 온다', S().activeCall?.why === 'ask' && S().activeCall.lines?.length === 2, JSON.stringify(S().activeCall));
S().answerCall(false);

reset();
S().sendMessage('힘들어 전화해줘');
const soonReplyAt = S().messages.find(m => m.from === 'agent').at;
check('지쳤다면서 걸어 달라면 고민 전화가 곧 잡힌다', S().dueCalls.length === 1 && S().dueCalls[0].why === 'worry' && S().dueCalls[0].at === soonReplyAt + ASK_CALL_MS, JSON.stringify(S().dueCalls));

// 모델 답장의 callMe — 못 받는 상황이면 깬 뒤로, 고민과 같이 오면 곧 거는 고민 전화
reset();
useWorld.setState({ phase: { ...sleeping, until: S().now + 3600_000 } });
S().sendMessage('뭐 해?');
const b3 = S().messages.find(m => m.from === 'me').batch;
S().applyLlmReply(b3, 1, { text: '끝나고 걸게', worry: null, callMe: true, model: 'x', ms: 1 });
check('자는 중의 모델 callMe도 버리지 않는다', S().dueCalls.some(d => d.id === `ask:${b3}` && d.at >= S().now + 3600_000), JSON.stringify(S().dueCalls));

reset();
S().sendMessage('뭐 해?');
const b4 = S().messages.find(m => m.from === 'me').batch;
const b4ReplyAt = S().messages.find(m => m.id === `${b4}:r`).at;
S().applyLlmReply(b4, 1, { text: '헐 무슨 일이야, 지금 걸게', worry: 'work', callMe: true, model: 'x', ms: 1 });
check('모델이 고민과 전화 부탁을 같이 들으면 곧 거는 고민 전화 하나다', S().dueCalls.length === 1 && S().dueCalls[0].why === 'worry' && S().dueCalls[0].worry === 'work' && S().dueCalls[0].at === b4ReplyAt + ASK_CALL_MS, JSON.stringify(S().dueCalls));

// 규칙이 걸어 달란 전화(ask)로 들었는데 모델이 고민을 들었다 — 시각은 그대로, 고민 전화로 바뀌고 메모리에도 적힌다
reset();
S().sendMessage('요즘 좀 그래… 전화 좀 해줘');
const b5 = S().messages.find(m => m.from === 'me').batch;
const askAt = S().dueCalls.find(d => d.id === `ask:${b5}`)?.at;
check('규칙은 걸어 달란 말로만 듣는다', typeof askAt === 'number' && !S().memory.worry, JSON.stringify(S().dueCalls));
S().applyLlmReply(b5, 1, { text: '헐 무슨 일이야, 지금 걸게', worry: 'blue', callMe: true, model: 'x', ms: 1 });
check('모델이 고민을 들으면 그 전화가 고민 전화가 된다', S().dueCalls.length === 1 && S().dueCalls[0].id === `worry:${b5}` && S().dueCalls[0].worry === 'blue' && S().dueCalls[0].at === askAt, JSON.stringify(S().dueCalls));
check('고민이 메모리에 남는다', S().memory.worry?.key === 'blue', JSON.stringify(S().memory.worry));

// 규칙이 38분 뒤 고민 전화를 잡았는데 모델이 전화 부탁도 들었다 — 곧으로 당긴다
reset();
S().sendMessage('힘들어');
const b6 = S().messages.find(m => m.from === 'me').batch;
const b6ReplyAt = S().messages.find(m => m.id === `${b6}:r`).at;
check('규칙은 38분 뒤로 잡는다', S().dueCalls[0]?.at === b6ReplyAt + WORRY_CALL_MS, JSON.stringify(S().dueCalls));
S().applyLlmReply(b6, 1, { text: '무슨 일이야, 지금 걸게', worry: 'work', callMe: true, model: 'x', ms: 1 });
check('모델이 전화 부탁을 들으면 고민 전화를 곧으로 당긴다', S().dueCalls.length === 1 && S().dueCalls[0].why === 'worry' && S().dueCalls[0].at === b6ReplyAt + ASK_CALL_MS, JSON.stringify(S().dueCalls));
reset();

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
