// Headless Chrome flow capture via CDP. Usage: node scripts/flow.mjs <url> <outDir> <steps.json>
// steps.json: [{ "eval": "js to run in page", "wait": ms, "shot": "name" }, ...]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, outDir, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'tw-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); else if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  await sleep(2500);
  for (const s of steps) {
    if (s.eval) { const r = await send('Runtime.evaluate', { expression: s.eval, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('eval error:', JSON.stringify(r.result.exceptionDetails).slice(0, 300)); else if (r.result?.result?.value !== undefined) console.log('eval →', String(r.result.result.value).slice(0, 600)); }
    if (s.wait) await sleep(s.wait);
    if (s.shot) {
      const info = await send('Runtime.evaluate', { expression: `JSON.stringify({ t: document.querySelector('.clock, .top-clock, [data-clock]')?.textContent?.slice(0,20) ?? null, kind: window.__world ? window.__world.getState().phase.kind : null, mapLoaded: window.__map ? window.__map.loaded() : null })`, returnByValue: true });
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, s.shot + '.png'), Buffer.from(shot.result.data, 'base64'));
      console.log(s.shot, info.result?.result?.value);
    }
  }
  if (logs.length) console.log('LOGS:\n' + logs.slice(0, 12).join('\n'));
  ws.close();
} finally { chrome.kill('SIGKILL'); }
