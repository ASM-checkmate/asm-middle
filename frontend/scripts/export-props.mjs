// 소품·캐릭터 그림을 이미지→3D 생성의 입력 PNG로 내보낸다 (ADR-0014 개정 7).
// dev 서버의 무대 모듈(window.__stage)로 장소별 소품 상자를 굽고, 장소마다 assets-src/<scene>/<번호>.png + manifest.json을 쓴다.
// Usage: node scripts/export-props.mjs [http://localhost:5173] [outDir=assets-src] [--scene cafe] [--yaw 35] [--pitch 22] [--ink 1]
//   소품마다 두 장: <번호>.png(2D 그림 그대로)와 <번호>.r.png(코드 소품을 3/4 뷰로 그늘지게 렌더 — stage/propshot.ts). 2D 그림은 시점이
//   뒤섞여 생성 모델이 납작한 부조를 만들기 쉬우니 코드 소품이 있는 것은 .r.png를 넣는다.
//   생성 서비스(Tripo·Meshy·TRELLIS)에 넣을 때 프롬프트: "flat cartoon prop, simple rounded shapes, solid colors, thick dark outline, no texture detail, white background"
//   결과 glb는 frontend/public/assets/models/ 에 두고 src/stage/assets.json에 { "props": { "<scene>": { "<번호>": { "url": "/assets/models/x.glb" } } } } 로 등록한다.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [base = 'http://localhost:5173', outDir = 'assets-src'] = pos;
const onlyScene = opt('--scene');
const YAW = +opt('--yaw', 35), PITCH = +opt('--pitch', 22), INK = opt('--ink', '0') === '1';   // 잉크 껍질은 정점색에 검은 얼룩으로 남아 기본 끔
const SCENES = ['cafe', 'restaurant', 'park', 'river', 'beach', 'gym', 'library', 'mall', 'museum', 'home', 'yard'];
const POSES = ['idle', 'walk', 'sit', 'sleep', 'wave', 'draw', 'happy', 'eat', 'read', 'think'];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'tw-export-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  // 카메라를 열어 무대 모듈(three.js)을 불러온다 — window.__stage는 dev 빌드에서만
  await send('Page.navigate', { url: `${base}/?preview=active:cafe&camera=1` });
  await sleep(6000);
  const manifest = {};
  for (const scene of SCENES) {
    if (onlyScene && scene !== onlyScene) continue;
    const dir = join(outDir, scene);
    mkdirSync(dir, { recursive: true });
    const set = await evaluate(`(async () => { const s = await window.__stage.sceneSet(${JSON.stringify(scene)}); return { floorY: s.floorY, props: s.props.map(p => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, base: p.base, lie: p.lie, top: p.top, png: p.canvas.toDataURL('image/png') })) }; })()`);
    manifest[scene] = { floorY: set.floorY, props: [] };
    set.props.forEach((p, i) => {
      writeFileSync(join(dir, `${i}.png`), Buffer.from(p.png.slice(p.png.indexOf(',') + 1), 'base64'));
      manifest[scene].props.push({ index: i, box: [p.x0, p.y0, p.x1, p.y1], base: p.base, lie: p.lie, top: p.top, file: `${scene}/${i}.png` });
    });
    for (let i = 0; i < set.props.length; i++) {
      const png = await evaluate(`(async () => { const c = await window.__stage.propShot(${JSON.stringify(scene)}, ${i}, { yaw: ${YAW}, pitch: ${PITCH}, ink: ${INK} }); return c && c.toDataURL('image/png'); })()`);
      if (png) { writeFileSync(join(dir, `${i}.r.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64')); manifest[scene].props[i].render = `${scene}/${i}.r.png`; }
    }
    console.log(scene, set.props.length, 'props');
  }
  // 캐릭터 포즈 (2D 그림) — 캐릭터 생성 입력
  if (!onlyScene) {
  mkdirSync(join(outDir, 'character'), { recursive: true });
  for (const variant of ['me', 'friend']) for (const pose of POSES) {
    const png = await evaluate(`(async () => (await window.__stage.castSprite({ pose: ${JSON.stringify(pose)}, variant: ${JSON.stringify(variant)} })).toDataURL('image/png'))()`);
    writeFileSync(join(outDir, 'character', `${variant}-${pose}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  }
  }
  writeFileSync(join(outDir, onlyScene ? `manifest.${onlyScene}.json` : 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('wrote', outDir);
  ws.close();
} finally { chrome.kill('SIGKILL'); }
