// 시계를 배속해 연속 스크린샷 — 방 안의 동선(걷기·뒷모습·머물다 돌아오기)을 확인한다 (ADR-0015).
// Usage: node scripts/shot-seq.mjs <url> <outPrefix> [frames=30] [intervalMs=700] [scale=200]
//   결과: <outPrefix>-00.png … ; 시계는 localStorage(theworld.clock.v1)에 scale을 넣어 sim 시간을 배속한다 (미리보기는 sim 시계를 따른다)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, frames = '30', interval = '700', scale = '200'] = process.argv.slice(2);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'tw-seq-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
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
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('theworld.clock.v1', JSON.stringify({ anchorReal: Date.now(), anchorSim: Date.now(), scale: ${+scale} }));` });
  await send('Page.navigate', { url });
  await sleep(1500);
  for (let i = 0; i < +frames; i++) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}-${String(i).padStart(2, '0')}.png`, Buffer.from(shot.result.data, 'base64'));
    await sleep(+interval);
  }
  console.log(`${frames} frames → ${out}-NN.png`);
  ws.close();
} finally { chrome.kill('SIGKILL'); }
