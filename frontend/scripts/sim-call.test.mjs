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
const lines = callLines('cafe', 'k', '문 닫았더라. 옆 공원 갔어.');
check('2~3줄이 온다', lines.length >= 2 && lines.length <= 3, String(lines.length));
check('덧붙인 줄이 들어간다', lines.includes('문 닫았더라. 옆 공원 갔어.'), JSON.stringify(lines));
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

// 수신을 거절하면 lines가 지워진다 — 안 받았으면 못 듣는다
useWorld.setState({ activeCall: { id: 'in:x', at: T0, dir: 'in', result: 'missed', lines: ['비밀'] }, calls: [{ id: 'in:x', at: T0, dir: 'in', result: 'missed', lines: ['비밀'] }] });
S().answerCall(false);
const rec = S().calls.find(c => c.id === 'in:x');
check('안 받으면 내용이 사라진다', rec.result === 'declined' && rec.lines === undefined, JSON.stringify(rec));
check('화면도 닫힌다', S().activeCall === null, '');

useWorld.setState({ activeCall: { id: 'in:y', at: T0, dir: 'in', result: 'missed', lines: ['들린다'] }, calls: [{ id: 'in:y', at: T0, dir: 'in', result: 'missed', lines: ['들린다'] }] });
S().answerCall(true);
check('받으면 내용이 남는다', S().calls.find(c => c.id === 'in:y').lines?.[0] === '들린다', '');

check('기록은 최근 것만 남긴다', trimCalls(Array.from({ length: 60 }, (_, i) => ({ id: String(i), at: T0 + i, dir: 'in', result: 'missed' })), 0).length === 40, '');

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
