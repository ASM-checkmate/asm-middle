// 소품·캐릭터 그림을 이미지→3D 생성의 입력 PNG로 내보낸다 (ADR-0014 개정 7).
// dev 서버의 무대 모듈(window.__stage)로 장소별 소품 상자를 굽고, 장소마다 assets-src/<scene>/<번호>.png + manifest.json을 쓴다.
// Usage: node scripts/export-props.mjs [http://localhost:5173] [outDir=assets-src]
//   생성 서비스(Tripo·Meshy·TRELLIS)에 넣을 때 프롬프트: "flat cartoon prop, simple rounded shapes, solid colors, thick dark outline, no texture detail, white background"
//   결과 glb는 frontend/public/assets/models/ 에 두고 src/stage/assets.json에 { "props": { "<scene>": { "<번호>": { "url": "/assets/models/x.glb" } } } } 로 등록한다.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base = 'http://localhost:5173', outDir = 'assets-src'] = process.argv.slice(2);
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
    const dir = join(outDir, scene);
    mkdirSync(dir, { recursive: true });
    const set = await evaluate(`(async () => { const s = await window.__stage.sceneSet(${JSON.stringify(scene)}); return { floorY: s.floorY, props: s.props.map(p => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, base: p.base, lie: p.lie, top: p.top, png: p.canvas.toDataURL('image/png') })) }; })()`);
    manifest[scene] = { floorY: set.floorY, props: [] };
    set.props.forEach((p, i) => {
      writeFileSync(join(dir, `${i}.png`), Buffer.from(p.png.slice(p.png.indexOf(',') + 1), 'base64'));
      manifest[scene].props.push({ index: i, box: [p.x0, p.y0, p.x1, p.y1], base: p.base, lie: p.lie, top: p.top, file: `${scene}/${i}.png` });
    });
    console.log(scene, set.props.length, 'props');
  }
  // 캐릭터 포즈 (2D 그림) — 캐릭터 생성 입력
  mkdirSync(join(outDir, 'character'), { recursive: true });
  for (const variant of ['me', 'friend']) for (const pose of POSES) {
    const png = await evaluate(`(async () => (await window.__stage.castSprite({ pose: ${JSON.stringify(pose)}, variant: ${JSON.stringify(variant)} })).toDataURL('image/png'))()`);
    writeFileSync(join(outDir, 'character', `${variant}-${pose}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('wrote', outDir);
  ws.close();
} finally { chrome.kill('SIGKILL'); }
