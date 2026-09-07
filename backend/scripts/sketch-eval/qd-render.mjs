// Quick, Draw! simplified ndjson → 앱과 같은 스타일(240px, 코랄 붓 7px 비율, 종이색 바탕)의 PNG.
// 헤드리스 크롬 캔버스로 그린다 (Node에 canvas가 없다). Usage: node qd-render.mjs <ndjsonDir> <outDir> <perCategory>
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [dir, outDir, perCat = '10'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const items = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.ndjson'))) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).slice(0, -1); // 마지막 줄은 잘렸을 수 있다
  const drawings = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(d => d && d.recognized).slice(0, Number(perCat));
  drawings.forEach((d, i) => items.push({ id: `${f.replace('.ndjson', '')}-${i}`, word: d.word, drawing: d.drawing }));
}
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'qd-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  // SketchOverlay.paint와 같은 규칙: 둥근 끝, 중점 2차 곡선, 240px에 붓 7px * 240/화면 ≈ 5px
  const code = `(() => { const items = ${JSON.stringify(items)}; const OUT = 240, PAD = 18, W = 5;
    const c = document.createElement('canvas'); c.width = OUT; c.height = OUT; const ctx = c.getContext('2d');
    return items.map(it => {
      ctx.fillStyle = '#FFF6E6'; ctx.fillRect(0, 0, OUT, OUT);
      ctx.strokeStyle = '#FF6A48'; ctx.lineWidth = W; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const s = (OUT - 2 * PAD) / 255;
      for (const [xs, ys] of it.drawing) {
        ctx.beginPath(); ctx.moveTo(PAD + xs[0] * s, PAD + ys[0] * s);
        if (xs.length === 1) ctx.lineTo(PAD + xs[0] * s + 0.01, PAD + ys[0] * s);
        for (let i = 1; i < xs.length; i++) ctx.lineTo(PAD + xs[i] * s, PAD + ys[i] * s);
        ctx.stroke();
      }
      return { id: it.id, word: it.word, png: c.toDataURL('image/png') };
    }); })()`;
  const r = await send('Runtime.evaluate', { expression: code, returnByValue: true });
  const out = r.result.result.value;
  const index = [];
  for (const o of out) { writeFileSync(join(outDir, o.id + '.png'), Buffer.from(o.png.split(',')[1], 'base64')); index.push({ id: o.id, word: o.word }); }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`rendered ${index.length} sketches → ${outDir}`);
  ws.close();
} finally { chrome.kill(); }
