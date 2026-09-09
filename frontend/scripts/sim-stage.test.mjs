// 3D 무대의 기하 (ADR-0014 개정, sim/stage.ts) — 인물 상자, 카메라 자세(회전 축·롤·줌·화면 이동), 시야각. 순수 함수라 브라우저 없이 돈다.
// Usage: node scripts/sim-stage.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const { ANCHOR_Y, CAM_DIST, FRAME_ASPECT, LAYERS, LAYER_DEPTH, CAST_DEPTH, castBox, stagePose, stageFov } = await import('../src/sim/stage.ts');

const fails = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const j = v => JSON.stringify(v);
const crop = (o = {}) => ({ scale: 1, x: 0, y: 0, rot: 0, pitch: 0, yaw: 0, ...o });

console.log('\n── 표 ──');
check('층 4개, 뒤(far·mid·floor) > 1 > 앞(front)', LAYERS.length === 4 && LAYER_DEPTH.far > LAYER_DEPTH.mid && LAYER_DEPTH.mid > LAYER_DEPTH.floor && LAYER_DEPTH.floor > 1 && LAYER_DEPTH.front < 1, j(LAYER_DEPTH));
check('인물 깊이: ghost > friend > me(1) > met — 2D z-index 순', CAST_DEPTH.ghost > CAST_DEPTH.friend && CAST_DEPTH.friend > CAST_DEPTH.me && CAST_DEPTH.me === 1 && CAST_DEPTH.met < 1, j(CAST_DEPTH));
check('시야각: 깊이 D의 평면 높이 = 프레임 높이', near(2 * CAM_DIST * Math.tan((stageFov() / 2) * Math.PI / 180), FRAME_ASPECT), String(stageFov()));

console.log('\n── 인물 상자 (camera.css) ──');
const me = castBox('me', false, false);
check('me: 너비 84 %, 가운데, 발이 78 %에 (svg 발 91 % → 아래 끝은 78 % + 9 %·너비)', near(me.w, 0.84) && near(me.cx, 0.5) && near(me.bottom - 0.09 * 0.84 / FRAME_ASPECT, ANCHOR_Y), j(me));
check('me: 동행이나 마주침이 있으면 39 %, 둘 다면 44 %', near(castBox('me', true, false).cx, 0.39) && near(castBox('me', false, true).cx, 0.39) && near(castBox('me', true, true).cx, 0.44));
check('friend: left 56 % + 너비 62 %', near(castBox('friend', true, false).cx, 0.87) && near(castBox('friend', true, false).w, 0.62));
check('met: 동행 있으면 오른쪽 -6 %에 붙는다', near(castBox('met', true, true).cx, 1 - 0.53 + 0.06 + 0.265) && near(castBox('met', false, true).cx, 0.865));
check('ghost: 오른쪽 -2 %, 바닥 30 %', near(castBox('ghost', false, false).cx, 1 - 0.53 + 0.02 + 0.265) && near(castBox('ghost', false, false).bottom, 0.7));

console.log('\n── 카메라 자세 ──');
const base = stagePose(crop());
check('기본: 카메라 (0,0,D)가 원점을 보고 up은 +y, 줌 1, 이동 0', near(base.pos[2], CAM_DIST) && near(base.pos[0], 0) && near(base.pos[1], 0) && base.target.every(v => near(v, 0)) && near(base.up[1], 1) && base.zoom === 1 && near(base.offset[0], 0) && near(base.offset[1], 0), j(base));
const yawR = stagePose(crop({ yaw: 12 }));
check('yaw +12: 카메라가 오른쪽(+x)으로, 발 축의 높이는 그대로', yawR.pos[0] > 0 && yawR.pos[2] < CAM_DIST && near(yawR.pos[1], 0), j(yawR.pos));
const pivotY = (0.5 - ANCHOR_Y) * FRAME_ASPECT;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
check('yaw·pitch로 돌아도 카메라~발 축 거리는 같다 (궤도)', near(dist(yawR.pos, [0, pivotY, 0]), dist(base.pos, [0, pivotY, 0])) && near(dist(stagePose(crop({ yaw: -9, pitch: 14 })).pos, [0, pivotY, 0]), dist(base.pos, [0, pivotY, 0])));
const up = stagePose(crop({ pitch: 14 }));
check('pitch +14(위에서): 카메라가 올라가고 시선이 내려다본다', up.pos[1] > 0 && up.target[1] < 0, j({ pos: up.pos, target: up.target }));
const down = stagePose(crop({ pitch: -14 }));
check('pitch -14(아래에서): 카메라가 내려간다', down.pos[1] < 0, j(down.pos));
const rolled = stagePose(crop({ rot: 10 }));
check('rot +10: up이 x 쪽으로 기운다 (카메라 롤), 위치는 그대로', Math.abs(rolled.up[0]) > 0.1 && near(rolled.pos[2], CAM_DIST), j(rolled.up));
const zoomed = stagePose(crop({ scale: 2 }));
check('scale 2: 줌 2, 발이 제자리에 남게 화면이 위로 (offset y = 0.28·(1-2))', zoomed.zoom === 2 && near(zoomed.offset[1], (ANCHOR_Y - 0.5) * (1 - 2)) && near(zoomed.offset[0], 0), j(zoomed.offset));
const panned = stagePose(crop({ x: 10, y: -5 }));
check('끌기 x 10 %·y -5 %: 화면 이동 그대로', near(panned.offset[0], 0.1) && near(panned.offset[1], -0.05), j(panned.offset));
const panZoom = stagePose(crop({ x: 10, scale: 1.5 }));
check('끌기는 확대 뒤에 (2D의 rotate → scale → translate 순서): x 10 %·1.5배 = 15 %', near(panZoom.offset[0], 0.15), j(panZoom.offset));
const panRot = stagePose(crop({ x: 10, rot: 90 }));
check('rot 90에서 오른쪽 끌기는 아래로 간다', near(panRot.offset[0], 0 + (ANCHOR_Y - 0.5) * FRAME_ASPECT, 1e-6) && panRot.offset[1] > 0, j(panRot.offset));

console.log('');
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
console.log('all ok');
