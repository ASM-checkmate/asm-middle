// 통화 harness (ADR-0001 §1, sim/call.ts) — 못 받는 규칙 전수, 부재중에 내용이 없다는 규칙,
// 그리고 늦게 오는 문자. Usage: node scripts/sim-call.test.mjs   (exit 1 on any failed check)
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

const { callLines, lateText, missedLine, pickupRule, trimCalls } = await import('../src/sim/call.ts');
const { placeById } = await import('../src/sim/places.ts');
const { useWorld } = await import('../src/sim/store.ts');
const S = () => useWorld.getState();

const actAt = (placeId, category = 'play') => ({
  key: 'k', dayKey: '2026-09-08@Asia/Seoul', blockIds: ['pm'],
  option: { id: 'o', title: 't', reason: 'r', emoji: '🙂', placeId, category },
  place: placeById(placeId), fromPlace: placeById('home'),
  journey: { legs: [{ mode: 'walk', fromId: 'home', toId: placeId, path: [], distanceKm: 1, durationMin: 12, label: '걸어서', refined: false }], totalMin: 12 },
  departAt: T0, arriveAt: T0, endAt: T0 + 3600_000, comicUntil: T0 + 3600_000,
  originTz: 'Asia/Seoul', tz: 'Asia/Seoul', jetlagUntil: null, companions: [],
});
const active = (placeId, category) => ({ kind: 'active', act: actAt(placeId, category), remainingMin: 20, progress: .4, tz: 'Asia/Seoul', jetlag: false, companions: [] });

// ── 못 받는 규칙 ─────────────────────────────────────────────────────────────
console.log('\n── 받을 수 있는가 ──');
check('자는 중엔 못 받는다', pickupRule({ kind: 'sleeping', until: 0, at: placeById('home'), tz: 'Asia/Seoul' }).block === 'sleeping', '');
check('대기 중엔 받는다', pickupRule({ kind: 'waiting', at: placeById('home'), currentBlockId: 'pm', nextBlockId: 'evening', nextStartAt: null, tz: 'Asia/Seoul', jetlag: false, companions: [] }).ok, '');

const QUIET = ['library', 'office', 'cinema', 'museum', 'temple', 'school'];
for (const t of QUIET) {
  const p = ['library', 'cinema', 'museum'].includes(t)
    ? { library: 'starfield-library', cinema: 'cgv-hongdae', museum: 'leeum' }[t]
    : null;
  if (!p) continue;
  const r = pickupRule(active(p));
  check(`${t}에서는 못 받는다`, !r.ok && r.block === 'quiet', JSON.stringify(r));
}
check('밥 먹는 중엔 못 받는다', pickupRule(active('layered-yeonnam', 'meal')).block === 'meal', '');
check('카페에서 놀 때는 받는다', pickupRule(active('layered-yeonnam', 'play')).ok, '');

const movingPhase = (onboard, mode) => ({
  kind: 'moving', act: { ...actAt('home'), journey: { legs: [{ mode, fromId: 'a', toId: 'b', path: [], distanceKm: 10, durationMin: 30, label: '', refined: false }], totalMin: 30 } },
  legIndex: 0, legProgress: .5, position: { lng: 0, lat: 0 }, heading: 0, remainingMin: 10, totalProgress: .5,
  tz: 'Asia/Seoul', onboard, companions: [],
});
check('비행기 안에서는 못 받는다', pickupRule(movingPhase(null, 'plane')).block === 'onboard', '');
check('기내에서 자면 못 받는다', pickupRule(movingPhase('sleep', 'train')).block === 'onboard', '');
check('걸어갈 때는 받는다', pickupRule(movingPhase(null, 'walk')).ok, '');
check('지하철에서는 받는다', pickupRule(movingPhase(null, 'subway')).ok, '');

// ── 늦게 오는 문자 ───────────────────────────────────────────────────────────
console.log('\n── 늦게 오는 문자 ──');
check('못 받으면 문자가 온다', lateText('quiet', 'k').length > 0, lateText('quiet', 'k'));
check('같은 통화면 같은 문자', lateText('quiet', 'k') === lateText('quiet', 'k'), '');
check('도서관 문자에 이유가 들어 있다', /도서관|조용|통화 못/.test(lateText('quiet', 'k')), lateText('quiet', 'k'));

// ── 받은 통화 ────────────────────────────────────────────────────────────────
console.log('\n── 받은 통화 ──');
const lines = callLines('cafe', 'k');
check('2줄이 온다', lines.length === 2, String(lines.length));
check('자랑으로 시작한다', /지금|여기|자리/.test(lines[0]), lines[0]);
check('같은 시드면 같은 말', JSON.stringify(callLines('cafe', 'k')) === JSON.stringify(callLines('cafe', 'k')), '');

// ── 부재중은 내용이 없다 ─────────────────────────────────────────────────────
console.log('\n── 부재중 ──');
check('부재중 문구는 시각만 말한다', !/무슨|얘기|내용/.test(missedLine()), missedLine());
S().callAgent();
const c0 = S().activeCall;
check('내가 걸면 통화가 하나 생긴다', !!c0 && c0.dir === 'out', JSON.stringify(c0?.dir));
check('기록에도 남는다', S().calls.some(c => c.id === c0.id), '');
S().endCall();
check('끊으면 화면에서 사라진다', S().activeCall === null, '');
check('기록은 남아 있다', S().calls.length >= 1, String(S().calls.length));

// 수신을 안 받으면 lines가 지워진다 — 안 받았으면 못 듣는다. 안 받기를 눌러도 12초가 지나도 똑같이 부재중이다 (ADR-0004)
useWorld.setState({ activeCall: { id: 'in:x', at: T0, dir: 'in', result: 'missed', lines: ['비밀'] }, calls: [{ id: 'in:x', at: T0, dir: 'in', result: 'missed', lines: ['비밀'] }] });
S().answerCall(false);
const rec = S().calls.find(c => c.id === 'in:x');
check('안 받으면 내용이 사라지고 부재중으로 남는다', rec.result === 'missed' && rec.lines === undefined, JSON.stringify(rec));
check('화면도 닫힌다', S().activeCall === null, '');

useWorld.setState({ activeCall: { id: 'in:y', at: T0, dir: 'in', result: 'missed', lines: ['들린다'] }, calls: [{ id: 'in:y', at: T0, dir: 'in', result: 'missed', lines: ['들린다'] }] });
S().answerCall(true);
check('받으면 내용이 남는다', S().calls.find(c => c.id === 'in:y').lines?.[0] === '들린다', '');

check('기록은 최근 것만 남긴다', trimCalls(Array.from({ length: 60 }, (_, i) => ({ id: String(i), at: T0 + i, dir: 'in', result: 'missed' })), 0).length === 40, '');

// ── 약속한 전화만 (ADR-0013) ─────────────────────────────────────────────────
console.log('\n── 약속한 전화만 ──');
const { withScale } = await import('../src/sim/clock.ts');
const waiting = { kind: 'waiting', at: placeById('home'), currentBlockId: 'pm', nextBlockId: 'evening', nextStartAt: null, tz: 'Asia/Seoul', jetlag: false, companions: [] };

// 막힌 상태에서 내가 걸면 못 받고, 늦게 오는 문자가 기록에 남는다
useWorld.setState({ activeCall: null, calls: [], dueCalls: [], phase: { kind: 'sleeping', until: S().now + 3600_000, at: placeById('home'), tz: 'Asia/Seoul' } });
S().callAgent();
const ref = S().activeCall;
check('자는 중에 걸면 못 받는다', !!ref && ref.dir === 'out' && ref.result === 'refused' && ref.block === 'sleeping', JSON.stringify(ref));
check('못 받은 발신엔 늦게 오는 문자가 있다', typeof ref?.text === 'string' && ref.text.length > 0, JSON.stringify(ref));
S().endCall();
check('끊으면 기록만 남는다', S().activeCall === null && S().calls.find(c => c.id === ref.id)?.result === 'refused', JSON.stringify(S().calls));

// 걸어 달라고 해서 잡힌 전화가 실제로 울린다 — 내용은 자랑 2줄
useWorld.setState({ activeCall: null, calls: [], dueCalls: [{ id: 'ask:b', at: S().now + 1000, why: 'ask' }], phase: waiting });
S().jumpBy(2000);
S().tick();
const ask = S().activeCall;
check('걸어 달란 전화가 울린다', !!ask && ask.dir === 'in' && ask.why === 'ask' && ask.id === 'in:ask:b', JSON.stringify(ask));
check('울리는 동안 내용을 갖고 있다', Array.isArray(ask?.lines) && ask.lines.length === 2, JSON.stringify(ask?.lines));
check('기록에는 받기 전까지 내용이 없다', S().calls.find(c => c.id === 'in:ask:b')?.lines === undefined, JSON.stringify(S().calls));
check('예약은 지워졌다', S().dueCalls.length === 0, JSON.stringify(S().dueCalls));

// 통화 시간은 실제로 통화한 초다 — dev 배속에서도
S().answerCall(true);
check('받으면 기록에 내용이 붙는다', S().calls.find(c => c.id === 'in:ask:b')?.lines?.length === 2, JSON.stringify(S().calls));
useWorld.setState({ clock: withScale(S().clock, 10) });
S().jumpBy(100_000);
S().endCall();
const timed = S().calls.find(c => c.id === 'in:ask:b');
check('x10 배속에서 sim 100초 통화는 10초로 남는다', timed?.durSec >= 10 && timed?.durSec <= 11, String(timed?.durSec));
useWorld.setState({ clock: withScale(S().clock, 0) });

// 지난 약속이 여럿이면 이른 것부터, tick마다 하나
useWorld.setState({ activeCall: null, calls: [], dueCalls: [{ id: 'ask:late', at: S().now + 3000, why: 'ask' }, { id: 'worry:early', at: S().now + 1000, why: 'worry', worry: 'work' }] });
S().jumpBy(5000);
S().tick();
check('이른 약속이 먼저 울린다', S().activeCall?.id === 'in:worry:early', JSON.stringify(S().activeCall));
check('나머지 약속은 남아 있다', S().dueCalls.length === 1 && S().dueCalls[0].id === 'ask:late', JSON.stringify(S().dueCalls));
S().answerCall(false);
S().tick();
check('통화가 끝난 다음 tick에 다음 약속이 울린다', S().activeCall?.id === 'in:ask:late', JSON.stringify(S().activeCall));
S().answerCall(false);

// 약속 시각이 10분 넘게 지난 약속(다른 기기에서 받아 온 저장본)은 보고 있어도 벨 없이 부재중이다
useWorld.setState({ activeCall: null, calls: [], dueCalls: [{ id: 'ask:stale', at: S().now - 20 * 60_000, why: 'ask' }] });
S().tick();
const stale = S().calls.find(c => c.id === 'in:ask:stale');
check('한참 지난 약속은 벨 없이 부재중이다', S().activeCall === null && stale?.result === 'missed' && stale.lines === undefined, JSON.stringify(S().calls));

// 계획과 다른 곳에 도착해도 전화는 없다 (통보 전화 삭제) — 진짜 우회 활동을 찾아 도착 순간을 보고 있는 채로 지난다
const { jumpedTo } = await import('../src/sim/clock.ts');
useWorld.setState({ activeCall: null, calls: [], dueCalls: [] });
let div = null;
for (let day = 0; day < 7 && !div; day++) {
  div = S().timeline.find(a => a.outcome && a.outcome.plannedPlaceId !== a.place.id && a.arriveAt > S().now + 60_000) ?? null;
  if (!div) S().jumpBy(24 * 3600_000);
}
check('우회하는 활동이 하나 있다', !!div, JSON.stringify(S().timeline.map(a => [a.key, a.outcome?.kind ?? null])));
if (div) {
  S().jumpTo(div.arriveAt - 30_000);
  const same = S().timeline.find(a => a.key === div.key);
  check('도착 30초 전엔 그리로 가는 중이다', !!same?.outcome && S().phase.kind === 'moving' && S().phase.act.key === div.key, `${S().phase.kind} ${JSON.stringify(same?.outcome?.kind)}`);
  useWorld.setState({ activeCall: null, calls: [], dueCalls: [], clock: jumpedTo(S().clock, div.arriveAt + 1000) });
  S().tick();
  check('도착하면 활동 중이 된다', S().phase.kind === 'active' && S().phase.act.key === div.key, S().phase.kind);
  check('우회 도착에 전화가 없다', S().activeCall === null && !S().calls.some(c => c.id === `in:${div.key}`), JSON.stringify(S().calls));
}

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
