// 자이로 → 카메라 각도 (ADR-0014, sim/gyro.ts) — 회전 행렬·상대 회전·각 추출·필터. 순수 함수라 브라우저 없이 돈다.
// Usage: node scripts/sim-gyro.test.mjs   (exit 1 on any failed check)
import './ts-hooks.mjs';

const { rotationMatrix, mul, relative, anglesOf, createFilter, GYRO_DEFAULTS } = await import('../src/sim/gyro.ts');

const fails = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : '  ← ' + detail}`); if (!ok) fails.push(name); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const RAD = Math.PI / 180;
const Rx = d => { const c = Math.cos(d * RAD), s = Math.sin(d * RAD); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = d => { const c = Math.cos(d * RAD), s = Math.sin(d * RAD); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const fmt = a => `yaw ${a.yaw.toFixed(2)} pitch ${a.pitch.toFixed(2)}`;

console.log('\n── 회전 행렬 ──');
const I = rotationMatrix(0, 0, 0);
check('(0,0,0)은 단위 행렬', I.every((v, i) => near(v, i % 4 === 0 ? 1 : 0)), I.join());
check('자기 자신과의 상대 회전은 0', (() => { const a = anglesOf(relative(rotationMatrix(30, 70, -20), rotationMatrix(30, 70, -20))); return near(a.yaw, 0) && near(a.pitch, 0); })());
check('gamma만 20° → yaw 20, pitch 0', (() => { const a = anglesOf(relative(I, rotationMatrix(0, 0, 20))); return near(a.yaw, 20) && near(a.pitch, 0); })(), fmt(anglesOf(relative(I, rotationMatrix(0, 0, 20)))));
check('beta만 15° → pitch 15, yaw 0', (() => { const a = anglesOf(relative(I, rotationMatrix(0, 15, 0))); return near(a.pitch, 15) && near(a.yaw, 0); })(), fmt(anglesOf(relative(I, rotationMatrix(0, 15, 0)))));

console.log('\n── 세운 폰 (beta≈90, 짐벌락 근처) ──');
const up = rotationMatrix(0, 90, 0);
const turned = anglesOf(relative(up, mul(up, Ry(9))));
check('기기 y축으로 9° 돌리면 yaw 9', near(turned.yaw, 9) && near(turned.pitch, 0), fmt(turned));
const tilted = anglesOf(relative(up, mul(up, Rx(-7))));
check('기기 x축으로 -7° 젖히면 pitch -7', near(tilted.pitch, -7) && near(tilted.yaw, 0), fmt(tilted));
const heading = anglesOf(relative(up, rotationMatrix(10, 90, 0)));
check('세운 채 몸을 10° 돌리면(alpha) |yaw| 10, pitch 0 — 오일러 각이 아니라 행렬로 재서 안 튄다', near(Math.abs(heading.yaw), 10, 1e-6) && near(heading.pitch, 0, 1e-6), fmt(heading));
const wrap = anglesOf(relative(rotationMatrix(359, 90, 0), rotationMatrix(1, 90, 0)));
check('alpha가 359→1로 감겨도 2°', near(Math.abs(wrap.yaw), 2, 1e-6), fmt(wrap));
const noisy = rotationMatrix(0, 89.9, 0);
const noisyA = anglesOf(relative(up, noisy));
check('beta 89.9 vs 90은 0.1° 차이 (beta가 줄면 pitch -)', near(noisyA.pitch, -0.1, 1e-3) && near(noisyA.yaw, 0, 1e-3), fmt(noisyA));

console.log('\n── 필터 ──');
const f = createFilter();
const d0 = f.push({ yaw: 0.5, pitch: -0.3 });
check('데드존 안은 0', d0.yaw === 0 && d0.pitch === 0 && !Object.is(d0.yaw, -0) && !Object.is(d0.pitch, -0), JSON.stringify(d0));
const f2 = createFilter();
const first = f2.push({ yaw: 10, pitch: 0 });
check('로우패스: 첫 값은 목표보다 작다', first.yaw > 0 && first.yaw < 10 - GYRO_DEFAULTS.dead, JSON.stringify(first));
let last = first;
for (let i = 0; i < 60; i++) last = f2.push({ yaw: 10, pitch: 0 });
check('로우패스: 같은 값을 계속 넣으면 수렴 (데드존만큼 뺀 값)', near(last.yaw, 10 - GYRO_DEFAULTS.dead, 0.5), JSON.stringify(last));
const f3 = createFilter();
let big = { yaw: 0, pitch: 0 };
for (let i = 0; i < 80; i++) big = f3.push({ yaw: 60, pitch: -60 });
check('상한: yaw ≤ 12, pitch ≥ -14', big.yaw <= GYRO_DEFAULTS.yawMax && big.yaw >= GYRO_DEFAULTS.yawMax - 0.5 && big.pitch >= -GYRO_DEFAULTS.pitchMax && big.pitch <= -GYRO_DEFAULTS.pitchMax + 1, JSON.stringify(big));
check('눈금: yaw 0.5° · pitch 1°', Number.isInteger(big.yaw * 2) && Number.isInteger(big.pitch), JSON.stringify(big));
f3.reset();
const afterReset = f3.push({ yaw: 0, pitch: 0 });
check('reset 뒤엔 0', afterReset.yaw === 0 && afterReset.pitch === 0, JSON.stringify(afterReset));

console.log('');
if (fails.length) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
console.log('all ok');
