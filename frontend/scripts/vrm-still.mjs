// 아바타가 준비된 뒤 (옵션: 밤) 스테이지만 한 장
import { spawn } from 'node:child_process'; import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const [url, out, night = '0', go = ''] = process.argv.slice(2);
const port = 9222 + Math.floor(Math.random() * 500); const profile = mkdtempSync(join(tmpdir(), 'tw-vrm-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', '--window-size=390,760', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let targets = null; for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
  await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 760, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) { if (await evalJs('!!(window.__vrm && window.__vrm.ready())')) break; await sleep(300); }
  if (night === '1') await evalJs('window.__vrm.night(true)');
  if (go) await evalJs(`window.__vrm.go(${go})`);
  await sleep(go ? 3500 : 1200);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 14, y: 70, width: 362, height: 600, scale: 1 } });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log(out);
  ws.close();
} finally { chrome.kill('SIGKILL'); }
