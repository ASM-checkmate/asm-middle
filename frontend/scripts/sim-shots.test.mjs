// 사진 harness (ADR-0004 오너 결정 7·14, sim/shots.ts · sim/comic.ts · sim/store.ts addShot) — 창 계산, 저장·교체·
// resetDay, 만화가 사용자 컷을 그대로 쓰고 에이전트 컷은 거의 항상 열화되는지, 기존 시드 재현이 안 바뀌는지.
// Usage: node scripts/sim-shots.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear(),
};

const MIN = 60_000;
const KST = (y, m, d, h, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const T0 = KST(2026, 9, 8, 8, 50);      // 아침 끝자락 — 오전 블록은 아직 안 시작
const freezeClockAt = t => storage.set('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: t, scale: 0 }));

const fails = [];
let n = 0;
const check = (name, ok, detail = '') => { n++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const sameCrop = (a, b) => ['scale', 'x', 'y', 'rot'].every(k => a[k] === b[k]);

// ── 순수 함수 ─────────────────────────────────────────────────────────────────
console.log('\n── 창 ──');
const { WIN_LABEL, shotsFor, trimShots, winAt, winStarts, winState } = await import('../src/sim/shots.ts');
check('창 이름 4개', WIN_LABEL.length === 4 && WIN_LABEL[0] === '도착', JSON.stringify(WIN_LABEL));
check('winAt: 4등분', [winAt(0), winAt(0.24), winAt(0.25), winAt(0.5), winAt(0.74), winAt(0.75), winAt(0.99)].join() === '0,0,1,2,2,3,3', [winAt(0), winAt(0.24), winAt(0.25), winAt(0.5), winAt(0.74), winAt(0.75), winAt(0.99)].join());
check('winAt: 밖은 잘린다', winAt(1) === 3 && winAt(-0.5) === 0 && winAt(7) === 3, '');
const ws = winStarts({ arriveAt: 1000, endAt: 5000 });
check('winStarts: [arriveAt, +25%, +50%, +75%]', ws.join() === '1000,2000,3000,4000', ws.join());
check('winState', winState(0, 2) === 'past' && winState(2, 2) === 'now' && winState(3, 2) === 'future', '');
const crop = (scale, x = 0, y = 0, rot = 0) => ({ scale, x, y, rot });
const pile = [
  { actKey: 'a', win: 1, at: 10, crop: crop(1.1) },
  { actKey: 'b', win: 1, at: 11, crop: crop(1.2) },
  { actKey: 'a', win: 3, at: 12, crop: crop(1.3) },
  { actKey: 'a', win: 1, at: 13, crop: crop(1.4) },   // 재촬영 — 뒤가 이긴다
];
const byWin = shotsFor(pile, 'a');
check('shotsFor: 활동의 샷을 창별로, 같은 창은 뒤가 이긴다', byWin[1]?.crop.scale === 1.4 && byWin[3]?.crop.scale === 1.3 && byWin[0] === undefined && byWin[2] === undefined, JSON.stringify(byWin));
check('trimShots: 오래된 건 버린다', trimShots(pile, 12).length === 2, String(trimShots(pile, 12).length));

// ── 로드 검증 (옛/깨진 저장본) ────────────────────────────────────────────────
console.log('\n── 로드 ──');
const { dayKeyIn, dayStartIn } = await import('../src/sim/tz.ts');
const { blockStartAt } = await import('../src/sim/blocks.ts');
const TODAY = dayKeyIn(T0, 'Asia/Seoul');
storage.set('theworld.world.v5', JSON.stringify({
  v: 5,
  days: { [TODAY]: { am: { blockId: 'am', category: 'play', options: [], chosenId: null, chosenBy: null, status: 'sketched', sketch: 'javascript:alert(1)' } } },
  shots: [
    { actKey: 'old', win: 1, at: T0, crop: crop(1.2, 3, -4, 5) },
    { actKey: 'bad', win: 9, at: T0, crop: crop(1) },
    { actKey: 'bad2', win: 0, at: T0, crop: { scale: 'x' } },
    null, 'junk',
  ],
}));
freezeClockAt(T0);
const { useWorld } = await import('../src/sim/store.ts');
const { makeComic } = await import('../src/sim/comic.ts');
const { placeById } = await import('../src/sim/places.ts');
const S = () => useWorld.getState();
check('모양이 어긋난 샷은 버린다', S().shots.length === 1 && S().shots[0].actKey === 'old', JSON.stringify(S().shots));
check('dataURL이 아닌 그림은 지우고 카드 상태로 되돌린다', S().plans.am.sketch === undefined && S().plans.am.status === 'empty', JSON.stringify([S().plans.am.sketch, S().plans.am.status]));
useWorld.setState({ shots: [] });

// ── 찍는다 ───────────────────────────────────────────────────────────────────
console.log('\n── addShot ──');
const cafe = placeById('layered-yeonnam');
const opt = { id: 'am-cafe', title: `${cafe.name}에서 그림 그리기`, reason: '검사용', emoji: '☕', placeId: cafe.id, category: 'play' };
{
  const plans = { ...S().plans, am: { blockId: 'am', category: 'play', options: [opt], chosenId: opt.id, chosenBy: 'user', status: 'confirmed' } };
  useWorld.setState({ plans, days: { ...S().days, [S().today]: plans } });
}
const amStart = blockStartAt(dayStartIn(T0, 'Asia/Seoul'), 'am');
S().jumpTo(amStart + 1000);
const act = S().timeline.find(a => a.dayKey === S().today && a.blockIds[0] === 'am');
check('오전 활동이 잡힌다', !!act, JSON.stringify(S().timeline.map(a => a.key)));
if (act) {
  const span = act.endAt - act.arriveAt;
  const shot = (win, at, c) => ({ actKey: act.key, win, at, crop: c });
  // 아직 이동 중 — 그래도 활동 종료 전이면 받는다 (카메라 버튼 노출은 화면이 active로 제한한다)
  S().jumpTo(act.arriveAt + span * 0.3);
  check('활동 중이다 (창 1)', S().phase.kind === 'active' && winAt(S().phase.progress) === 1, `${S().phase.kind} ${S().phase.progress}`);
  const c1 = crop(1.4, -12, 8, -6);
  S().addShot(shot(1, S().now, c1));
  check('한 장 저장된다', S().shots.length === 1 && S().shots[0].win === 1 && sameCrop(S().shots[0].crop, c1), JSON.stringify(S().shots));
  check('저장본에 실린다', JSON.parse(storage.get('theworld.world.v5')).shots?.length === 1, storage.get('theworld.world.v5')?.slice(0, 40));
  const c1b = crop(1.9, 4, -3, 11);
  S().addShot(shot(1, S().now + 2 * MIN, c1b));
  check('같은 창을 다시 찍으면 교체된다 (뒤가 이김)', S().shots.length === 1 && sameCrop(S().shots[0].crop, c1b), JSON.stringify(S().shots));
  S().jumpTo(act.arriveAt + span * 0.6);
  check('창 2로 넘어갔다', winAt(S().phase.progress) === 2, String(S().phase.progress));
  const c2 = { ...crop(1.0, 0, 0, 0), pitch: 10, light: 0.7, dof: 0.5, focus: 'far' };   // 각도·조도·심도·초점 (선택 필드)
  S().addShot(shot(2, S().now, c2));
  check('다른 창은 추가된다', S().shots.length === 2, String(S().shots.length));
  check('각도·조도·심도가 저장된다', S().shots.find(x => x.win === 2)?.crop.pitch === 10 && JSON.parse(storage.get('theworld.world.v5')).shots.find(x => x.win === 2)?.crop.dof === 0.5, JSON.stringify(S().shots));
  check('창 밖 번호는 무시된다', (S().addShot(shot(5, S().now, c2)), S().shots.length === 2), String(S().shots.length));
  check('모르는 활동은 무시된다', (S().addShot({ ...shot(0, S().now, c2), actKey: 'nope' }), S().shots.length === 2), String(S().shots.length));

  // 끝나면 만화가 한 번 만들어져 고정된다
  S().jumpTo(act.endAt + 1000);
  check('활동 종료 뒤엔 못 찍는다', (S().addShot(shot(3, S().now, c2)), S().shots.length === 2), String(S().shots.length));
  const comic = S().phase.kind === 'comic' ? S().phase.comic : S().book.find(c => c.id === `c:${act.key}`);
  check('만화가 나왔다', !!comic && comic.panels.length === 4, S().phase.kind);
  if (comic) {
    const [p0, p1, p2, p3] = comic.panels;
    check('사용자 컷: by user · % 단위 · crop 그대로 · 촬영 시각', p1.by === 'user' && p1.unit === 'pct' && sameCrop(p1.crop, c1b) && p1.t === S().shots[0].at, JSON.stringify(p1));
    check('각도·조도·심도·초점도 컷에 그대로 실린다', p2.by === 'user' && p2.crop.pitch === 10 && p2.crop.light === 0.7 && p2.crop.dof === 0.5 && p2.crop.focus === 'far', JSON.stringify(p2.crop));
    check('사용자 컷: 흐림·열화 없음', p1.blur === undefined && p1.flaws === undefined && p2.blur === undefined && p2.flaws === undefined, JSON.stringify([p1.blur, p1.flaws, p2.blur, p2.flaws]));
    check('사용자 컷 캡션은 "잘 안 찍혔다"로 바뀌지 않는다', p1.caption !== '이건 잘 안 찍혔다' && p2.caption !== '이건 잘 안 찍혔다', p1.caption);
    check('에이전트 컷: by agent · px 단위', p0.by === 'agent' && p0.unit === 'px' && p3.by === 'agent' && p3.unit === 'px', JSON.stringify([p0.by, p0.unit, p3.by, p3.unit]));
    check('작성자 수: 내가 2장, 에이전트 2장', comic.shots?.user === 2 && comic.shots?.agent === 2, JSON.stringify(comic.shots));
    check('앨범에 그 만화가 고정된다', S().book.some(c => c.id === `c:${act.key}` && c.shots?.user === 2), '');
    const again = makeComic(act, S().memory, {});
    check('샷이 있어도 캡션은 같다 (기존 시드 순서 불변)', again.panels.every((p, i) => p.caption === comic.panels[i].caption), JSON.stringify([again.panels.map(p => p.caption), comic.panels.map(p => p.caption)]));
    check('샷 없이 만들면 전부 에이전트 컷', again.shots?.user === 0 && again.panels.every(p => p.by === 'agent'), JSON.stringify(again.shots));
    check('에이전트 컷의 열화는 샷 유무와 무관하게 같다', again.panels[0].flaws?.join() === p0.flaws?.join() && again.panels[3].flaws?.join() === p3.flaws?.join(), JSON.stringify([again.panels[0].flaws, p0.flaws]));
  }
}

// ── resetDay ─────────────────────────────────────────────────────────────────
console.log('\n── resetDay ──');
S().resetDay();
check('리셋하면 샷이 비고 오버레이도 닫힌다', S().shots.length === 0 && S().sketchOpen === null && S().cameraOpen === false, JSON.stringify([S().shots.length, S().sketchOpen, S().cameraOpen]));
check('UI 플래그', (S().setSketchOpen('pm'), S().setCameraOpen(true), S().sketchOpen === 'pm' && S().cameraOpen === true), '');
S().setSketchOpen(null); S().setCameraOpen(false);

// ── 에이전트 컷 열화 (오너 결정 14: 거의 항상 하나 이상) ─────────────────────────
console.log('\n── 열화 ──');
const { estimateJourney } = await import('../src/sim/journey.ts');
const { tzOf } = await import('../src/sim/places.ts');
const memory = { name: '토리', likes: ['그림 그리기', '커피'], dislikes: [], traits: ['느긋한'], homePlaceId: 'home', friends: [], visited: [] };
const fakeAct = (i, placeId = 'layered-yeonnam') => {
  const fromPlace = placeById('home'), place = placeById(placeId);
  const journey = estimateJourney(fromPlace, place);
  const departAt = KST(2026, 9, 1 + (i % 27), 9, 0);
  const arriveAt = departAt + journey.totalMin * MIN, endAt = arriveAt + 90 * MIN;
  const dayKey = dayKeyIn(departAt, tzOf(fromPlace));
  return {
    key: `${dayKey}:b${i}`, dayKey, blockIds: ['am'], option: { id: `o${i}`, title: `${place.name}에서 그림 그리기`, reason: '', emoji: '☕', placeId, category: 'play' },
    place, fromPlace, journey, departAt, arriveAt, endAt, comicUntil: endAt + 8 * MIN, originTz: tzOf(fromPlace), tz: tzOf(place), jetlagUntil: null, companions: [],
  };
};
const FLAWS = new Set(['blur', 'dark', 'overzoom', 'cut', 'tilt']);
const SCALE = [0.82, 1.14, 1.72, 1.05];   // comic.ts의 컷별 기본 화각 (×0.94~1.06) — overzoom은 여기에 ×1.75
let panels = 0, flawed = 0, badKind = 0, overzoomOk = true, tiltOk = true, cutOk = true, shifted = 0;
for (let i = 0; i < 100; i++) {
  const a = fakeAct(i, ['layered-yeonnam', 'gyeongui-line-forest', 'mangwon-hangang', 'home'][i % 4]);
  const c = makeComic(a, memory);
  const plain = makeComic(a, memory);   // 열화 전 값과 비교하려고 같은 활동을 한 번 더 — 같은 시드라 같은 결과
  // 창 0에 사용자 샷 하나 — 나머지 컷의 열화(종류·값)는 샷이 없을 때와 같아야 한다 (fill 시드의 next() 소비 순서가 샷 유무와 무관)
  const withMine = makeComic(a, memory, { 0: { actKey: a.key, win: 0, at: a.arriveAt + MIN, crop: { scale: 1.3, x: 5, y: -3, rot: 2 } } });
  for (let k = 1; k < 4; k++) if (JSON.stringify(withMine.panels[k]) !== JSON.stringify(c.panels[k])) shifted++;
  c.panels.forEach((p, k) => {
    panels++;
    if (p.flaws?.length) flawed++;
    for (const f of p.flaws ?? []) if (!FLAWS.has(f)) badKind++;
    if (p.flaws?.includes('overzoom') && !(p.crop.scale >= SCALE[k] * 0.94 * 1.75 - 0.01)) overzoomOk = false;
    if (!p.flaws?.includes('overzoom') && !(p.crop.scale <= SCALE[k] * 1.06 + 0.01)) overzoomOk = false;
    if (p.flaws?.includes('tilt') && !(Math.abs(p.crop.rot) >= 14 && Math.abs(p.crop.rot) <= 22)) tiltOk = false;
    if (p.flaws?.includes('cut') && !(Math.abs(p.crop.x) >= 40 - 17 || Math.abs(p.crop.y) >= 40 - 11)) cutOk = false;
    if (JSON.stringify(plain.panels[k]) !== JSON.stringify(p)) badKind++;
  });
}
const rate = flawed / panels;
check(`에이전트 컷은 대부분 열화된다 (${(rate * 100).toFixed(0)}%, ≥ 80%)`, rate >= 0.8, String(rate));
check('열화 종류는 다섯 가지뿐이고 결정적이다', badKind === 0, String(badKind));
check('overzoom이면 확대돼 있다', overzoomOk, '');
check('tilt면 14~22°', tiltOk, '');
check('cut이면 크게 밀려 있다', cutOk, '');
check('제대로 찍힌 컷도 가끔 있다 (< 100%)', rate < 1, String(rate));
check('사용자 컷이 끼어도 나머지 컷의 열화는 같다 (임의 활동 100개)', shifted === 0, `${shifted}/300 어긋남`);

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
