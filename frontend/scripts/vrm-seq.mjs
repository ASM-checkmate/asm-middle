// VRM 랩 연속 캡처: 페이지 열고 __vrm.ready 기다린 뒤 go(x,z) 를 순서대로 부르며 프레임을 찍는다
// Usage: node vrm-seq.mjs <url> <outPrefix> "<x,z;x,z;...>" [frames=12] [intervalMs=350]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [url, out, route, frames = '12', interval = '350'] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'tw-vrm-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--window-size=390,760', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 760, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) { if (await evalJs('!!(window.__vrm && window.__vrm.ready())')) break; await sleep(300); }
  await sleep(800);
  const legs = route.split(';').map(s => s.split(',').map(Number));
  let n = 0;
  for (const [x, z] of legs) {
    await evalJs(`window.__vrm.go(${x}, ${z})`);
    for (let f = 0; f < +frames; f++) {
      await sleep(+interval);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 14, y: 70, width: 362, height: 600, scale: 1 } });
      writeFileSync(`${out}-${String(n++).padStart(2, '0')}.png`, Buffer.from(shot.result.data, 'base64'));
    }
  }
  console.log('frames', n, logs.join('\n'));
  ws.close();
} finally { chrome.kill('SIGKILL'); }
