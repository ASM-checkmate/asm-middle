// 캐릭터 한 명을 투명 PNG로 — ?lab=charpng 페이지를 헤드리스 크롬으로 찍는다 (카메라 배경 합성 시험용, 임시).
//   node scripts/char-png.mjs <out.png> [pose=idle] [variant=me|friend] [color=#hex] [hair=short] — hair는 동행(NPC)의 머리 모양 (App.tsx charpng 분기)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [out, pose = 'idle', variant = 'me', color = '', hair = ''] = process.argv.slice(2);
const url = `http://localhost:5173/?lab=charpng&pose=${pose}&variant=${variant}${color ? `&color=${encodeURIComponent(color)}` : ''}${hair ? `&hair=${hair}` : ''}`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'tw-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--window-size=800,800', 'about:blank'], { stdio: 'ignore' });
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
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 800, deviceScaleFactor: 2, mobile: false });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send('Page.navigate', { url });
  await sleep(4000);
  // 페이지·루트 배경을 투명으로 (index.css 가 종이색을 깐다)
  await send('Runtime.evaluate', { expression: `document.documentElement.style.background='transparent';document.body.style.background='transparent';document.querySelectorAll('#root,#root>*').forEach(e=>e.style.background='transparent');'ok'` });
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(out);
  ws.close();
} finally { chrome.kill('SIGKILL'); }
