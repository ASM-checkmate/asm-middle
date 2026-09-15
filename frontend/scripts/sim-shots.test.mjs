// 사진 harness (ADR-0029, sim/shots.ts · sim/comic.ts · sim/store.ts addShot/removeShot) — 순서·상한 3장, 저장·교체·지우기·
// resetDay, 앨범이 사용자 컷을 찍은 그대로 싣고 안 찍으면 에이전트 한 장, 열화가 없는지, 캡션 시드가 샷 유무와 무관한지.
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
const ID = ch => ch.repeat(16);

// ── 순수 함수 ─────────────────────────────────────────────────────────────────
console.log('\n── shots ──');
const { MAX_SHOTS, shotsFor, trimShots } = await import('../src/sim/shots.ts');
check('최대 3장', MAX_SHOTS === 3, String(MAX_SHOTS));
const crop = (scale, x = 0, y = 0, rot = 0) => ({ scale, x, y, rot });
const pile = [
  { actKey: 'a', at: 12, crop: crop(1.3), shotId: ID('a3') },
  { actKey: 'b', at: 11, crop: crop(1.2), shotId: ID('b1') },
  { actKey: 'a', at: 10, crop: crop(1.1), shotId: ID('a1') },
  { actKey: 'a', at: 13, crop: crop(1.4), shotId: ID('a1') },   // 같은 id — 교체 (뒤가 이긴다)
  { actKey: 'a', at: 9, crop: crop(1.0) },                      // id 없는 옛 샷도 순서에 든다
];
const mine = shotsFor(pile, 'a');
check('shotsFor: 활동의 샷을 찍은 순서로, 같은 id는 뒤가 이긴다', mine.map(s => s.at).join() === '9,12,13' && mine[2].crop.scale === 1.4, JSON.stringify(mine));
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
    { actKey: 'old', win: 1, at: T0, crop: crop(1.2, 3, -4, 5), shotId: ID('a1') },   // 옛 4창 샷 — win은 떼고 산다
    { actKey: 'old2', at: T0, crop: crop(1.1), shotId: 'not-a-media-id' },           // id 모양이 틀리면 id만 뗀다
    { actKey: 'new', at: T0, crop: crop(1), backdrop: 'busan:x', me: { x: 40, y: 80, scale: 0.5, pose: 'sit' }, friend: { x: 60, y: 80, scale: 0.5 }, gen: 'plain', shotId: ID('c3') },
    { actKey: 'bad', at: T0, crop: crop(1), me: { x: 'a' } },
    { actKey: 'bad2', at: T0, crop: { scale: 'x' } },
    { actKey: 'bad3', at: T0, crop: crop(1), gen: 'weird' },
    null, 'junk',
  ],
}));
freezeClockAt(T0);
const { useWorld } = await import('../src/sim/store.ts');
const { makeComic } = await import('../src/sim/comic.ts');
const { placeById } = await import('../src/sim/places.ts');
const S = () => useWorld.getState();
check('모양이 어긋난 샷은 버린다', S().shots.length === 3 && S().shots.map(s => s.actKey).join() === 'old,old2,new', JSON.stringify(S().shots));
check('옛 win은 떼어 낸다, shotId는 32자 hex만', !('win' in S().shots[0]) && S().shots[0].shotId === ID('a1') && !('shotId' in S().shots[1]), JSON.stringify(S().shots));
check('배경·자리·자세·gen이 그대로 산다', S().shots[2].backdrop === 'busan:x' && S().shots[2].me.pose === 'sit' && S().shots[2].friend.x === 60 && S().shots[2].gen === 'plain', JSON.stringify(S().shots[2]));
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
  const shot = (at, c, extra = {}) => ({ actKey: act.key, at, crop: c, me: { x: 50, y: 78, scale: 0.84, pose: 'idle' }, gen: 'plain', ...extra });
  S().jumpTo(act.arriveAt + span * 0.3);
  check('활동 중이다', S().phase.kind === 'active', S().phase.kind);
  const c1 = crop(1.4, -12, 8, 0);
  const [A, B, C, D] = [ID('a1'), ID('b2'), ID('c3'), ID('d4')];
  S().addShot(shot(S().now, c1, { shotId: A }));
  check('한 장 저장된다', S().shots.length === 1 && S().shots[0].shotId === A && sameCrop(S().shots[0].crop, c1), JSON.stringify(S().shots));
  check('저장본에 실린다', JSON.parse(storage.get('theworld.world.v5')).shots?.length === 1, storage.get('theworld.world.v5')?.slice(0, 40));
  const c1b = crop(1.9, 4, -3, 0);
  S().addShot(shot(S().now + 2 * MIN, c1b, { shotId: A, me: { x: 30, y: 90, scale: 0.5, pose: 'sit' } }));
  check('같은 id를 다시 넣으면 교체된다 (뒤가 이김)', S().shots.length === 1 && sameCrop(S().shots[0].crop, c1b) && S().shots[0].me.pose === 'sit', JSON.stringify(S().shots));
  S().addShot(shot(S().now, crop(1), { shotId: 'bad id' }));
  check('addShot: 모양이 틀린 shotId는 떼고 받는다', S().shots.length === 2 && !('shotId' in S().shots[1]), JSON.stringify(S().shots));
  useWorld.setState({ shots: S().shots.filter(x => x.shotId) });
  S().jumpTo(act.arriveAt + span * 0.6);
  const c2 = crop(1.0, 0, 0, 0);
  S().addShot(shot(S().now, c2, { shotId: B, backdrop: 'busan:x' }));
  S().addShot(shot(S().now + MIN, c2, { shotId: C }));
  check('세 장까지 쌓인다', S().shots.length === 3 && S().shots.map(x => x.shotId).join() === [A, B, C].join(), String(S().shots.length));
  S().addShot(shot(S().now + 2 * MIN, c2, { shotId: D }));
  check('넷째는 무시된다 (MAX_SHOTS)', S().shots.length === 3 && !S().shots.some(x => x.shotId === D), String(S().shots.length));
  S().addShot(shot(S().now + 3 * MIN, c2, { shotId: C, me: { x: 70, y: 70, scale: 0.6 } }));
  check('꽉 차도 같은 id 교체는 된다', S().shots.length === 3 && S().shots.find(x => x.shotId === C)?.me.x === 70, JSON.stringify(S().shots));
  S().removeShot(C);
  check('removeShot: 지우면 자리가 빈다 (저장본도)', S().shots.length === 2 && !JSON.stringify(JSON.parse(storage.get('theworld.world.v5')).shots).includes(C), String(S().shots.length));
  S().removeShot(ID('e5'));
  check('removeShot: 모르는 id는 아무것도 안 한다', S().shots.length === 2, '');
  S().addShot(shot(S().now + 4 * MIN, c2, { shotId: C }));
  S().setShotGen(C, 'pending');
  check('setShotGen: 상태만 바뀐다', S().shots.find(x => x.shotId === C)?.gen === 'pending' && JSON.parse(storage.get('theworld.world.v5')).shots.find(x => x.shotId === C)?.gen === 'pending', JSON.stringify(S().shots));
  // 굽기가 실패한 컷: id를 떼면 옛 경로(다시 그리기) — 샷 자체는 남는다
  S().dropShotId(B);
  check('dropShotId: 샷은 남고 id만 뗀다', S().shots.length === 3 && S().shots.filter(x => x.shotId).length === 2 && !JSON.stringify(JSON.parse(storage.get('theworld.world.v5')).shots).includes(B), JSON.stringify(S().shots));
  check('모르는 활동은 무시된다', (S().addShot({ ...shot(S().now, c2), actKey: 'nope' }), S().shots.length === 3), String(S().shots.length));

  // 끝나면 앨범이 한 번 만들어져 고정된다
  S().jumpTo(act.endAt + 1000);
  check('활동 종료 뒤엔 못 찍는다', (S().addShot(shot(S().now, c2, { shotId: D })), S().shots.length === 3), String(S().shots.length));
  const comic = S().phase.kind === 'comic' ? S().phase.comic : S().book.find(c => c.id === `c:${act.key}`);
  check('앨범이 나왔다 — 사진 3장', !!comic && comic.panels.length === 3, `${S().phase.kind} ${comic?.panels.length}`);
  if (comic) {
    const [p0, p1, p2] = comic.panels;
    const shots = shotsFor(S().shots, act.key);
    check('컷은 찍은 순서, 촬영 시각, 자리·자세·배경 그대로 (by user, % 단위)', p0.by === 'user' && p0.unit === 'pct' && p0.t === shots[0].at && sameCrop(p0.crop, c1b) && p0.me.pose === 'sit' && p1.backdrop === 'busan:x' && p2.t === shots[2].at, JSON.stringify(comic.panels));
    check('shotId: 있는 컷은 그대로, 뗀 컷엔 없다', p0.shotId === A && p1.shotId === undefined && p2.shotId === C, JSON.stringify(comic.panels.map(p => p.shotId)));
    check('열화·흐림은 없다', comic.panels.every(p => p.flaws === undefined && p.blur === undefined), '');
    check('세 장이면 가운데가 트위스트, 나머지는 시각대로', ['arrive', 'doing'].includes(p0.beat) && p1.beat === 'twist' && ['doing', 'end'].includes(p2.beat), comic.panels.map(p => p.beat).join());
    check('작성자 수: 내가 3장', comic.shots?.user === 3 && comic.shots?.agent === 0, JSON.stringify(comic.shots));
    check('앨범에 고정된다', S().book.some(c => c.id === `c:${act.key}` && c.shots?.user === 3), '');
    const again = makeComic(act, S().memory, []);
    check('안 찍으면 에이전트 한 장 (트위스트, 활동 한가운데)', again.panels.length === 1 && again.panels[0].by === 'agent' && again.panels[0].beat === 'twist' && again.shots?.user === 0 && again.shots?.agent === 1, JSON.stringify(again.panels));
    check('샷이 있어도 캡션은 같다 (시드 순서 불변)', again.panels[0].caption === p1.caption && again.summary === comic.summary, JSON.stringify([again.panels[0].caption, p1.caption]));
    const one = makeComic(act, S().memory, [shots[1]]);
    check('한 장이면 그 장이 트위스트', one.panels.length === 1 && one.panels[0].by === 'user' && one.panels[0].beat === 'twist', JSON.stringify(one.panels.map(p => p.beat)));
    const twice = makeComic(act, S().memory, shots);
    check('같은 입력이면 같은 결과 (shotId 포함)', JSON.stringify(twice) === JSON.stringify(comic), '');

    // ── patchPanelShot: 픽셀 없는 컷을 화면이 구운 뒤 앨범에 적는다 ──
    const ID3 = ID('f6');
    const bookBefore = S().book;
    S().patchPanelShot(comic.id, 1, ID3);
    const patched = S().book.find(c => c.id === comic.id);
    check('patchPanelShot: 그 컷에만 id가 붙고 앨범 항목은 새 객체다', patched.panels[1].shotId === ID3 && patched.panels[0].shotId === A && patched !== comic && S().book !== bookBefore, JSON.stringify(patched.panels.map(p => p.shotId)));
    check('patchPanelShot: book 문서에 저장된다', JSON.parse(storage.get('theworld.book.v1')).find(c => c.id === comic.id)?.panels[1].shotId === ID3, storage.get('theworld.book.v1')?.slice(0, 60));
    S().patchPanelShot(comic.id, 1, ID('a7'));
    check('patchPanelShot: 이미 id가 있으면 덮지 않는다', S().book.find(c => c.id === comic.id).panels[1].shotId === ID3, '');
    const bookNow = S().book;
    S().patchPanelShot(comic.id, 9, ID3); S().patchPanelShot('c:nope', 0, ID3); S().patchPanelShot(comic.id, 2, 'bad');
    check('patchPanelShot: 없는 컷·모르는 앨범·틀린 id는 아무것도 안 한다', S().book === bookNow, '');
    S().jumpTo(S().now + 1000);
    check('patchPanelShot: 화면의 앨범(phase.comic)에도 다음 tick에 보인다', S().phase.kind === 'comic' && S().phase.comic.panels[1].shotId === ID3, S().phase.kind);

    // ── dropShotId가 endAt 뒤에 오면(굽기가 늦게 실패) 앨범의 컷에서도 뗀다 ──
    S().dropShotId(C);
    const dropped = S().book.find(c => c.id === comic.id);
    check('dropShotId: 샷·앨범의 컷에서 같이 뗀다 (다른 컷은 그대로)', !S().shots.some(x => x.shotId === C) && dropped.panels[2].shotId === undefined && dropped.panels[0].shotId === A && dropped.panels[1].shotId === ID3, JSON.stringify(dropped.panels.map(p => p.shotId)));
    check('dropShotId: book 문서에도 없다', !JSON.stringify(JSON.parse(storage.get('theworld.book.v1'))).includes(C), '');
    check('removeShot: 활동이 끝난 뒤엔 못 지운다', (S().removeShot(A), S().shots.some(x => x.shotId === A)), '');
  }
}

// ── resetDay ─────────────────────────────────────────────────────────────────
console.log('\n── resetDay ──');
S().resetDay();
check('리셋하면 샷이 비고 오버레이도 닫힌다', S().shots.length === 0 && S().sketchOpen === null && S().camera === null, JSON.stringify([S().shots.length, S().sketchOpen, S().camera]));
check('UI 플래그', (S().setSketchOpen('pm'), S().openCamera('busan:x'), S().sketchOpen === 'pm' && S().camera?.backdrop === 'busan:x'), '');
S().openCamera();
check('openCamera(): 배경 없이', S().camera !== null && S().camera.backdrop === null, JSON.stringify(S().camera));
S().setSketchOpen(null); S().closeCamera();
check('closeCamera', S().camera === null, '');

// ── 열화 없음 (ADR-0029: 열화 시스템 삭제) ─────────────────────────────────────
console.log('\n── 에이전트 컷 ──');
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
let bad = 0, shifted = 0;
for (let i = 0; i < 60; i++) {
  const a = fakeAct(i, ['layered-yeonnam', 'gyeongui-line-forest', 'mangwon-hangang', 'home'][i % 4]);
  const c = makeComic(a, memory);
  if (c.panels.length !== 1 || c.panels[0].by !== 'agent' || c.panels[0].crop.scale !== 1 || c.panels[0].crop.rot !== 0 || c.panels[0].flaws || c.panels[0].blur) bad++;
  const withMine = makeComic(a, memory, [{ actKey: a.key, at: a.arriveAt + MIN, crop: { scale: 1.3, x: 5, y: -3, rot: 0 }, shotId: ID('a1') }]);
  if (withMine.summary !== c.summary || withMine.panels.length !== 1 || withMine.panels[0].by !== 'user') shifted++;
}
check('안 찍은 활동은 에이전트 한 장, 열화·기울기 없음 (임의 활동 60개)', bad === 0, String(bad));
check('샷이 있어도 요약(캡션 시드)은 같다', shifted === 0, `${shifted}/60`);

console.log(`\n${n - fails.length}/${n} checks passed`);
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
