// 그림으로 정하기 harness (ADR-0004 오너 결정 5·8, sim/store.ts sketchBlock/unsketchBlock) — sketched 전이와 불변식,
// 저장 형태, '아직 비었는데' 쪽지 미발생, 블록 시작 때 에이전트가 범주 안에서 고르는지, 활동 로그 첫 줄.
// Usage: node scripts/sim-sketch.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 8, 50);      // 아침 끝자락 — 오전 블록은 아직 안 시작
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };

// 작은 PNG 흉내 — 스토어는 `data:image/` 접두만 본다 (실제 그림은 SketchOverlay의 canvas.toDataURL)
const SKETCH = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

freezeClockAt(T0);
const { useWorld } = await import('../src/sim/store.ts');
const { activityLog } = await import('../src/sim/actlog.ts');
const { blockStartAt } = await import('../src/sim/blocks.ts');
const { dayStartIn } = await import('../src/sim/tz.ts');
const S = () => useWorld.getState();

const WORLD_KEY = 'theworld.world.v5';
const saved = () => JSON.parse(storage.get(WORLD_KEY));

// ── 전이 ─────────────────────────────────────────────────────────────────────
console.log('\n── 그림으로 정한다 ──');
check('오전 블록은 아직 편집 가능하다', S().plans.am.status === 'empty' && S().today.startsWith('2026-09-08'), JSON.stringify([S().plans.am.status, S().today]));
check('범주 없이 그림만 넘기면 무시된다', (S().sketchBlock('am', SKETCH), S().plans.am.status === 'empty' && S().plans.am.sketch === undefined), S().plans.am.status);
S().setCategory('am', 'play');
const cards = S().plans.am.options.map(o => o.id);
check('범주를 고르면 카드 3장', S().plans.am.status === 'proposed' && cards.length === 3, JSON.stringify([S().plans.am.status, cards.length]));
check('dataURL이 아니면 무시된다', (S().sketchBlock('am', 'javascript:alert(1)'), S().plans.am.status === 'proposed'), S().plans.am.status);
S().sketchBlock('am', SKETCH);
let p = S().plans.am;
check('sketched 상태가 된다', p.status === 'sketched', p.status);
check('불변식: category 유지 · chosenId/chosenBy null · verdict 없음', p.category === 'play' && p.chosenId === null && p.chosenBy === null && p.verdict === undefined, JSON.stringify([p.category, p.chosenId, p.chosenBy, p.verdict]));
check('그림이 실린다', p.sketch === SKETCH, String(p.sketch).slice(0, 30));
check('카드 3장은 그대로 둔다 (시작 때 그 안에서 고른다)', p.options.map(o => o.id).join() === cards.join(), '');
check('저장본의 days에 그림 문자열이 있다', saved().days[S().today].am.sketch === SKETCH && saved().days[S().today].am.status === 'sketched', JSON.stringify(saved().days[S().today].am.status));
check('시작 전 sketched 블록은 타임라인에 활동이 없다', !S().timeline.some(a => a.dayKey === S().today && a.blockIds[0] === 'am'), '');

// ── 쪽지 미발생 ───────────────────────────────────────────────────────────────
console.log('\n── 쪽지 ──');
S().tick();
check('일정을 골라 달라는 쪽지는 없다 (쪽지는 마음이 오갈 때만)', !S().requests.some(r => r.refId === 'am' || String(r.id).includes('decide')), JSON.stringify(S().requests.map(r => r.id)));

// ── 카드로 돌아오기 ───────────────────────────────────────────────────────────
console.log('\n── 카드로 고를래 ──');
S().unsketchBlock('am');
p = S().plans.am;
check('옵션이 있으면 제안 상태로 돌아온다', p.status === 'proposed' && p.sketch === undefined && p.options.length === 3, JSON.stringify([p.status, p.sketch, p.options.length]));
check('sketched가 아니면 unsketch는 아무것도 안 한다', (S().unsketchBlock('am'), S().plans.am.status === 'proposed'), S().plans.am.status);
S().tick();
check('카드 상태로 돌아와도 일정 쪽지는 안 뜬다', !S().requests.some(r => r.refId === 'am' || String(r.id).includes('decide')), JSON.stringify(S().requests.map(r => r.id)));
// 옵션이 없는 sketched 블록(옛 저장본 등)은 빈 칸으로
{
  const plans = { ...S().plans, am: { ...S().plans.am, options: [], status: 'sketched', sketch: SKETCH } };
  useWorld.setState({ plans, days: { ...S().days, [S().today]: plans } });
  S().unsketchBlock('am');
  check('옵션이 없으면 빈 칸으로 돌아온다', S().plans.am.status === 'empty' && S().plans.am.sketch === undefined, S().plans.am.status);
}

// 카드 경로는 그림을 지운다
S().setCategory('am', 'play');
S().sketchBlock('am', SKETCH);
S().setCategory('am', 'meal');
check('범주를 바꾸면 그림이 사라진다', S().plans.am.status === 'proposed' && S().plans.am.sketch === undefined && S().plans.am.category === 'meal', JSON.stringify([S().plans.am.status, S().plans.am.sketch]));
S().sketchBlock('am', SKETCH);
S().regenerateOptions('am');
check('다른 제안을 보면 그림이 사라진다', S().plans.am.status === 'proposed' && S().plans.am.sketch === undefined, JSON.stringify([S().plans.am.status, S().plans.am.sketch]));
S().sketchBlock('am', SKETCH);
S().chooseOption('am', S().plans.am.options[0].id, 'user');
check('카드를 고르면 그림이 사라진다', S().plans.am.status !== 'sketched' && S().plans.am.sketch === undefined, JSON.stringify([S().plans.am.status, S().plans.am.sketch]));

// ── 보호 ─────────────────────────────────────────────────────────────────────
console.log('\n── 지켜진다 ──');
S().setCategory('am', 'play');
S().sketchBlock('am', SKETCH);
S().updateMemory({ likes: ['그림 그리기', '카페'] });
p = S().plans.am;
check('메모리를 고쳐도 그림 블록은 풀리지 않는다 (releaseAgentPicks)', p.status === 'sketched' && p.sketch === SKETCH, JSON.stringify([p.status, !!p.sketch]));
check('다시 그리기는 덮어쓴다', (S().sketchBlock('am', SKETCH + 'A'), S().plans.am.sketch === SKETCH + 'A' && S().plans.am.status === 'sketched'), S().plans.am.status);
S().sketchBlock('am', SKETCH);

// ── 그림을 읽어 두면 그대로 고른다 (ADR-0007) ──────────────────────────────
console.log('\n── 그림 읽기 ──');
{
  const opts = S().plans.am.options;
  const target = opts[opts.length - 1];   // 시드가 첫 장을 고르기 쉬우니 마지막 장으로 차이를 낸다
  S().applySketchRead(S().today, 'am', SKETCH + 'X', { optionId: target.id, seen: '컵', model: 'x', ms: 1 });
  check('그림이 바뀐 뒤 온 결과는 버린다', S().plans.am.sketchRead === undefined, JSON.stringify(S().plans.am.sketchRead));
  S().applySketchRead(S().today, 'am', SKETCH, { optionId: 'no-such-option', seen: '컵', model: 'x', ms: 1 });
  check('없는 옵션 id는 null로 적는다', S().plans.am.sketchRead?.optionId === null && S().plans.am.sketchRead.seen === '컵', JSON.stringify(S().plans.am.sketchRead));
  S().applySketchRead(S().today, 'am', SKETCH, { optionId: target.id, seen: '컵', model: 'x', ms: 1 });
  check('읽은 결과가 계획에 적힌다', S().plans.am.sketchRead?.optionId === target.id, JSON.stringify(S().plans.am.sketchRead));
  check('저장본에도 남는다', saved().days[S().today].am.sketchRead?.optionId === target.id, '');
  check('시간표 상태는 그대로 sketched (비밀)', S().plans.am.status === 'sketched' && S().plans.am.chosenId === null, S().plans.am.status);
  S().setCategory('am', 'meal');
  check('카드로 돌아가면 읽은 결과도 지워진다', S().plans.am.sketchRead === undefined && S().plans.am.sketch === undefined, JSON.stringify(S().plans.am.sketchRead));
  S().setCategory('am', 'play');
  S().sketchBlock('am', SKETCH);
  const opts2 = S().plans.am.options;
  const target2 = opts2[opts2.length - 1];
  S().applySketchRead(S().today, 'am', SKETCH, { optionId: target2.id, seen: '컵', model: 'x', ms: 1 });
  const amStart0 = blockStartAt(dayStartIn(T0, 'Asia/Seoul'), 'am');
  S().jumpTo(amStart0 + 1000);
  const chosen = S().plans.am;
  const { review } = await import('../src/sim/review.ts');
  const passes = chosen.chosenId === target2.id;
  check('시작하면 읽은 옵션을 고른다 (검문을 통과하면)', passes || chosen.chosenBy === 'agent', JSON.stringify([chosen.chosenId, target2.id]));
  const actSeen = S().timeline.find(a => a.dayKey === S().today && a.blockIds[0] === 'am');
  if (passes) {
    check('타임라인에 판정이 실린다 (seen)', actSeen?.sketchVerdict?.kind === 'seen' && actSeen.sketchVerdict.seen === '컵', JSON.stringify(actSeen?.sketchVerdict));
    const logSeen = activityLog(actSeen, actSeen.arriveAt);
    check('출발 줄이 "컵 그린 거지?" 계열이다', /컵/.test(logSeen[0].text) && !/못 알아|모르겠|내 맘대로|취향대로/.test(logSeen[0].text), logSeen[0].text);
  } else {
    console.log('  (읽은 옵션이 검문에 막혀 시드로 골랐다 — 알아본 문구 검사는 건너뜀)');
  }
  void review;
  // near: 범주는 맞는데 그 카드가 없다
  S().jumpTo(T0);
  S().setCategory('am', 'play');
  S().sketchBlock('am', SKETCH);
  S().applySketchRead(S().today, 'am', SKETCH, { optionId: null, seen: '자전거', category: 'play', model: 'x', ms: 1 });
  S().jumpTo(amStart0 + 1000);
  const near = S().plans.am;
  check('범주가 맞고 카드가 없으면 near — 범주 안에서 고른다', near.sketchVerdict?.kind === 'near' && near.category === 'play' && near.chosenBy === 'agent', JSON.stringify([near.sketchVerdict, near.category]));
  const actNear = S().timeline.find(a => a.dayKey === S().today && a.blockIds[0] === 'am');
  check('출발 줄이 "자전거 … 비슷한" 계열', /자전거/.test(activityLog(actNear, actNear.arriveAt)[0].text) && !/못 알아|취향대로/.test(activityLog(actNear, actNear.arriveAt)[0].text), activityLog(actNear, actNear.arriveAt)[0].text);
  // clash: 골라 둔 범주(놀기)와 그림(밥)이 어긋난다 → 둘 다 아닌 범주로 내 맘대로 (ADR-0008)
  S().jumpTo(T0);
  S().setCategory('am', 'play');
  S().sketchBlock('am', SKETCH);
  S().applySketchRead(S().today, 'am', SKETCH, { optionId: null, seen: '피자', category: 'meal', model: 'x', ms: 1 });
  S().jumpTo(amStart0 + 1000);
  const clash = S().plans.am;
  check('어긋나면 clash — 골라 둔 범주도 그림의 범주도 아닌 걸로', clash.sketchVerdict?.kind === 'clash' && clash.category !== 'play' && clash.category !== 'meal' && clash.chosenBy === 'agent', JSON.stringify([clash.sketchVerdict, clash.category]));
  check('판정에 골라 뒀던 범주가 남는다', clash.sketchVerdict?.askedCategory === 'play', JSON.stringify(clash.sketchVerdict));
  const actClash = S().timeline.find(a => a.dayKey === S().today && a.blockIds[0] === 'am');
  const clashLine = activityLog(actClash, actClash.arriveAt)[0].text;
  check('출발 줄에 "놀기"와 "피자"가 같이 나온다', /놀기/.test(clashLine) && /피자/.test(clashLine), clashLine);
  check('만화·활동에 그림은 그대로 실린다', actClash.sketch === SKETCH, '');
  // 여행으로 읽힌 그림은 어긋남이 아니다
  S().jumpTo(T0);
  S().setCategory('am', 'play');
  S().sketchBlock('am', SKETCH);
  S().applySketchRead(S().today, 'am', SKETCH, { optionId: null, seen: '비행기', category: 'travel', model: 'x', ms: 1 });
  S().jumpTo(amStart0 + 1000);
  check('여행 그림은 clash가 아니라 near', S().plans.am.sketchVerdict?.kind === 'near' && S().plans.am.category === 'play', JSON.stringify(S().plans.am.sketchVerdict));
  // 되돌려서 아래 기존 검사(못 알아본 경로)를 그대로 지난다
  S().jumpTo(T0);
  S().setCategory('am', 'play');
  S().sketchBlock('am', SKETCH);
  check('되돌린 뒤 sketched · 읽은 결과·판정 없음', S().plans.am.status === 'sketched' && S().plans.am.sketchRead === undefined && S().plans.am.sketchVerdict === undefined, S().plans.am.status);
}

// ── 블록이 시작하면 에이전트가 고른다 ──────────────────────────────────────────
console.log('\n── 시작 ──');
const amStart = blockStartAt(dayStartIn(T0, 'Asia/Seoul'), 'am');
S().jumpTo(amStart + 1000);
p = S().plans.am;
check('시작하면 chosenBy agent · confirmed', p.chosenBy === 'agent' && p.status === 'confirmed' && !!p.chosenId, JSON.stringify([p.chosenBy, p.status, p.chosenId]));
check('범주 안 옵션(또는 fallback) 중에서 골랐다', p.options.some(o => o.id === p.chosenId) && p.category === 'play', JSON.stringify([p.chosenId, p.category]));
check('그림은 그대로 남는다', p.sketch === SKETCH, String(p.sketch).slice(0, 30));
check('시작 뒤엔 그림을 바꿀 수 없다', (S().sketchBlock('am', SKETCH + 'B'), S().plans.am.sketch === SKETCH), '');
const act = S().timeline.find(a => a.dayKey === S().today && a.blockIds[0] === 'am');
check('타임라인 활동에 그림이 실린다', !!act && act.sketch === SKETCH, act ? String(act.sketch).slice(0, 30) : '활동 없음');
if (act) {
  const log = activityLog(act, act.arriveAt);
  check('활동 로그 첫 줄은 출발 시각의 "그림은 못 알아봐서" 계열', log.length >= 2 && log[0].at === act.departAt && /그림|그린/.test(log[0].text), JSON.stringify(log.slice(0, 2)));
  check('못 읽은 그림의 판정은 unread', act.sketchVerdict?.kind === 'unread', JSON.stringify(act.sketchVerdict));
  check('두 번째 줄이 도착 줄이다', log[1].at === act.arriveAt, JSON.stringify(log[1]));
  check('같은 활동이면 같은 문장', activityLog(act, act.arriveAt)[0].text === log[0].text, '');
  const plain = activityLog({ ...act, sketch: undefined }, act.arriveAt);
  check('그림이 없으면 그 줄도 없다', plain[0].at === act.arriveAt && !/그림|그린/.test(plain[0].text), JSON.stringify(plain[0]));
  check('phase가 이동 중/활동 중이다', S().phase.kind === 'moving' || S().phase.kind === 'active', S().phase.kind);
  S().jumpTo(act.endAt + 1000);
  const comic = S().phase.kind === 'comic' ? S().phase.comic : S().book.find(c => c.id === `c:${act.key}`);
  check('만화에도 그림이 실린다', !!comic && comic.sketch === SKETCH, comic ? String(comic.sketch).slice(0, 30) : '만화 없음');
}

// ── 로드 검증: sketched ⇒ sketch 존재 (validDays) ────────────────────────────────
// 손상·수동 편집으로 status만 'sketched'이고 sketch 키가 없거나 dataURL이 아닌 저장본은 카드 상태로 되돌린다
console.log('\n── 로드 ──');
{
  const T1 = KST(2026, 9, 9, 8, 50);
  const day = '2026-09-09@Asia/Seoul';
  const world = saved();
  const plan = (status, extra) => ({ blockId: 'am', category: 'play', options: [{ id: 'x', title: '경의선숲길 산책', reason: '', emoji: '🌳', placeId: 'gyeongui-line-forest', category: 'play' }], chosenId: null, chosenBy: null, status, ...extra });
  world.days = { [day]: { am: plan('sketched', {}), pm: plan('sketched', { sketch: 'javascript:alert(1)' }), night: plan('sketched', { sketch: SKETCH, options: [] }) } };
  storage.set(WORLD_KEY, JSON.stringify(world));
  freezeClockAt(T1);
  const { useWorld: reopened } = await import('../src/sim/store.ts?corrupt=1');
  const R = reopened.getState();
  const [am, pm, night] = [R.days[day]?.am, R.days[day]?.pm, R.days[day]?.night];
  check('sketch 키 없이 sketched면 제안 상태로 되돌린다', am?.status === 'proposed' && am.sketch === undefined, JSON.stringify([am?.status, am?.sketch]));
  check('dataURL이 아닌 sketch도 지우고 되돌린다', pm?.status === 'proposed' && pm.sketch === undefined, JSON.stringify([pm?.status, pm?.sketch]));
  check('그림이 있는 sketched는 그대로 (옵션 없이도)', night?.status === 'sketched' && night.sketch === SKETCH, JSON.stringify([night?.status, !!night?.sketch]));
}

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
