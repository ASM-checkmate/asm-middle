// 3D 무대의 기하 (ADR-0014 개정 2, sim/stage.ts) — 기본 카메라(눈높이·숙임), 되쏘기(바닥·세운 평면), 뒷막 거리, 인물 상자,
// 카메라 자세(발 축 궤도·롤·줌·화면 이동). 순수 함수라 브라우저 없이 돈다.
// Usage: node scripts/sim-stage.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const S = await import('../src/sim/stage.ts');
const { ANCHOR_Y, CAM_DIST, CAM_PITCH, FRAME_ASPECT, WALL_K_MAX, WALL_K_MIN, CAST_DEPTH, castBox, castRect, eyeHeight, rayFromFrame, hitGround, hitVertical, frameOfRow, rowOfFrame, frameOfCol, wallDepth, wallZ, wallFootRow, stagePose, stageFov } = S;

const fails = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const j = v => JSON.stringify(v);
const crop = (o = {}) => ({ scale: 1, x: 0, y: 0, rot: 0, pitch: 0, yaw: 0, ...o });

console.log('\n── 기본 카메라 ──');
check('시야각: 깊이 D의 평면 높이 = 프레임 높이', near(2 * CAM_DIST * Math.tan((stageFov() / 2) * Math.PI / 180), FRAME_ASPECT), String(stageFov()));
const h = eyeHeight();
check('눈높이 > 0, 숙임 10°', h > 0 && CAM_PITCH === 10, String(h));
const feetHit = hitGround(rayFromFrame(0, ANCHOR_Y - 0.5));
check('발(78 %)로 가는 광선은 원점(캐릭터 발)에 닿는다', feetHit && near(feetHit[0], 0) && near(feetHit[1], 0) && near(feetHit[2], 0), j(feetHit));
check('프레임 중심 광선은 아래를 본다 (숙임)', rayFromFrame(0, 0).d[1] < 0);
check('행 ↔ 프레임: 422 = 중심, 540 ≈ 발', near(frameOfRow(422), 0) && near(rowOfFrame(ANCHOR_Y - 0.5), 540.16, 0.01) && near(frameOfCol(195), 0) && near(frameOfCol(390), 0.5));
const zNear = hitGround(rayFromFrame(0, frameOfRow(700)))[2], zFar = hitGround(rayFromFrame(0, frameOfRow(500)))[2];
check('되쏘기: 아래 행일수록 바닥의 가까운 곳 (z 큼)', zNear > zFar && zFar < 0, `${zNear} ${zFar}`);
check('세운 평면 되쏘기: z가 그 값', near(hitVertical(rayFromFrame(0.2, 0.1), -0.7)[2], -0.7));
check('지평선 위 광선은 바닥에 안 닿는다', hitGround(rayFromFrame(0, -0.6)) === null);

console.log('\n── 뒷막 ──');
const kCafe = wallDepth(450);
check('카페(경계 450)의 뒷막은 1.6~4 사이, 2 근처', kCafe >= WALL_K_MIN && kCafe <= WALL_K_MAX && kCafe > 1.6 && kCafe < 2.2, String(kCafe));
check('해변(경계 290, 지평선 위)은 상한', wallDepth(290) === WALL_K_MAX, String(wallDepth(290)));
check('경계가 낮을수록 벽이 가깝다', wallDepth(500) < wallDepth(450) && wallDepth(450) < wallDepth(400));
check('벽 발치 행: 그 행의 광선이 벽 z에서 바닥에 닿는다', (() => { const k = 2; const row = wallFootRow(k); const p = hitGround(rayFromFrame(0, frameOfRow(row))); return p && near(p[2], wallZ(k), 1e-6); })(), String(wallFootRow(2)));
check('벽 발치 행은 그림의 경계선보다 아래일 수 없다 (상한에 걸린 해변)', wallFootRow(wallDepth(290)) > 290);

console.log('\n── 인물 상자 (camera.css) ──');
const me = castBox('me', false, false);
check('me: 너비 84 %, 가운데, 발이 78 %에', near(me.w, 0.84) && near(me.cx, 0.5) && near(me.bottom - 0.09 * 0.84 / FRAME_ASPECT, ANCHOR_Y), j(me));
check('me: 동행이나 마주침이 있으면 39 %, 둘 다면 44 %', near(castBox('me', true, false).cx, 0.39) && near(castBox('me', false, true).cx, 0.39) && near(castBox('me', true, true).cx, 0.44));
check('friend: left 56 % + 너비 62 %', near(castBox('friend', true, false).cx, 0.87) && near(castBox('friend', true, false).w, 0.62));
check('met: 동행 있으면 오른쪽 -6 %에 붙는다', near(castBox('met', true, true).cx, 1 - 0.53 + 0.06 + 0.265) && near(castBox('met', false, true).cx, 0.865));
check('ghost: 오른쪽 -2 %, 바닥 30 %', near(castBox('ghost', false, false).cx, 1 - 0.53 + 0.02 + 0.265) && near(castBox('ghost', false, false).bottom, 0.7));
const rme = castRect('me', false, false);
check('me 카드(그림 좌표): 정사각 328, 발(아래에서 9 %)이 540 행', near(rme.x1 - rme.x0, 0.84 * 390) && near(rme.y1 - 0.09 * (rme.x1 - rme.x0), rowOfFrame(ANCHOR_Y - 0.5), 0.5), j(rme));
check('인물 깊이: ghost > friend > me(1) > met', CAST_DEPTH.ghost > CAST_DEPTH.friend && CAST_DEPTH.friend > CAST_DEPTH.me && CAST_DEPTH.me === 1 && CAST_DEPTH.met < 1);

console.log('\n── 카메라 자세 ──');
const base = stagePose(crop());
check('기본: 카메라 (0, h, D), 아래를 보고, up은 거의 +y, 줌 1, 이동 0', near(base.pos[0], 0) && near(base.pos[1], h) && near(base.pos[2], CAM_DIST) && base.target[1] < base.pos[1] && base.up[1] > 0.98 && base.zoom === 1 && near(base.offset[0], 0) && near(base.offset[1], 0), j(base));
const yawR = stagePose(crop({ yaw: 12 }));
check('yaw +12: 카메라가 오른쪽(+x)으로, 높이는 그대로', yawR.pos[0] > 0 && yawR.pos[2] < CAM_DIST && near(yawR.pos[1], h), j(yawR.pos));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
check('yaw·pitch로 돌아도 카메라~발(원점) 거리는 같다 (궤도)', near(dist(yawR.pos, [0, 0, 0]), dist(base.pos, [0, 0, 0])) && near(dist(stagePose(crop({ yaw: -9, pitch: 14 })).pos, [0, 0, 0]), dist(base.pos, [0, 0, 0])));
check('pitch +14(위에서): 카메라가 올라간다', stagePose(crop({ pitch: 14 })).pos[1] > h);
check('pitch -14(아래에서): 카메라가 내려간다', stagePose(crop({ pitch: -14 })).pos[1] < h);
const rolled = stagePose(crop({ rot: 10 }));
check('rot +10: up이 x 쪽으로 기운다 (롤), 위치는 그대로', Math.abs(rolled.up[0]) > 0.1 && near(rolled.pos[2], CAM_DIST), j(rolled.up));
const zoomed = stagePose(crop({ scale: 2 }));
check('scale 2: 줌 2, 발이 제자리에 남게 화면이 위로', zoomed.zoom === 2 && near(zoomed.offset[1], (ANCHOR_Y - 0.5) * (1 - 2)) && near(zoomed.offset[0], 0), j(zoomed.offset));
check('끌기 x 10 %·y -5 %: 화면 이동 그대로', (() => { const p = stagePose(crop({ x: 10, y: -5 })); return near(p.offset[0], 0.1) && near(p.offset[1], -0.05); })());
check('끌기는 확대 뒤에: x 10 %·1.5배 = 15 %', near(stagePose(crop({ x: 10, scale: 1.5 })).offset[0], 0.15));
check('rot 90에서 오른쪽 끌기는 아래로 간다', stagePose(crop({ x: 10, rot: 90 })).offset[1] > 0);

console.log('');
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
console.log('all ok');
