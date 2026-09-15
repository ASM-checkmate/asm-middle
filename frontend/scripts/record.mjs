// 데모 영상 녹화 (CDP 스크린캐스트). Usage: node scripts/record.mjs <outDir> <steps.json> [untilStep]
// 창 760×1000 @2x — `.stage`가 둥근 폰 무대가 되고(index.css @media), 왼쪽에 폰·오른쪽에 자막 패널(나레이터 + 캐릭터 독백)을 주입한다.
// steps: goto{url,load} · say[나레이터, 독백] · click(셀렉터|[x,y]) · eval(js) · jump("HH:MM" | "+1 00:30") · wait(ms) · mark(라벨)
// 프레임은 frames/NNNNN.jpg + list.txt(concat demuxer) → ffmpeg로 demo.mp4. CROP=WxH 환경변수로 아래 여백을 잘라 낸다.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [outDir, stepsFile, untilArg] = process.argv.slice(2);
const until = untilArg ? Number(untilArg) : Infinity;
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
mkdirSync(join(outDir, 'frames'), { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 760, H = 1000;
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'tw-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--force-device-scale-factor=2', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 페이지 주입: 폰 베젤 + 자막 패널 + 탭 표시 (한 번만, 다시 goto하면 다시) */
const OVERLAY = `(() => {
  if (document.getElementById('demo-cap')) return 'kept';
  const st = document.createElement('style'); st.id = 'demo-style';
  st.textContent = \`
    #root { justify-items: start !important; padding-left: 40px; }
    .stage { outline: 14px solid #1E2440; border-radius: 56px !important; box-shadow: 0 30px 60px rgba(42,33,24,.28) !important; }
    #demo-notch { position: fixed; width: 110px; height: 12px; border-radius: 0 0 16px 16px; background: #1E2440; z-index: 9999; pointer-events: none; }
    #demo-cap { position: fixed; width: 270px; z-index: 9999; pointer-events: none; display: grid; gap: 18px; font-family: 'Noto Sans KR', system-ui, sans-serif; }
    .dc-n { background: #FFF6E6; border: 2px solid #2A2118; border-radius: 18px; padding: 14px 16px; box-shadow: 4px 4px 0 #2A2118; opacity: 0; transition: opacity .35s ease; }
    .dc-n.is-on { opacity: 1; }
    .dc-n small { display: block; font-family: 'DM Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: .12em; color: #A08C76; margin-bottom: 6px; }
    .dc-n p { margin: 0; font-size: 15px; line-height: 1.55; color: #6B5B4B; word-break: keep-all; }
    .dc-c { display: flex; align-items: flex-end; gap: 10px; opacity: 0; transition: opacity .35s ease; }
    .dc-c.is-on { opacity: 1; }
    .dc-c .dc-face { flex: none; width: 56px; height: 56px; border-radius: 50%; background: #FFFFFF; border: 2px solid #2A2118; overflow: hidden; display: grid; place-items: center; }
    .dc-c .dc-face svg { width: 84px; height: 84px; margin-top: 10px; }
    .dc-c .dc-bubble { position: relative; background: #FFFFFF; border: 2px solid #2A2118; border-radius: 18px; padding: 12px 14px; box-shadow: 4px 4px 0 #2A2118; font-family: 'Jua', 'Noto Sans KR', sans-serif; font-size: 19px; line-height: 1.35; color: #2A2118; word-break: keep-all; }
    .dc-c .dc-bubble::before { content: ''; position: absolute; left: -12px; bottom: 16px; border: 6px solid transparent; border-right-color: #2A2118; border-left: 0; }
    .dc-c .dc-bubble::after { content: ''; position: absolute; left: -8px; bottom: 17px; border: 5px solid transparent; border-right-color: #FFFFFF; border-left: 0; }
    #demo-tap { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: rgba(255,106,72,.45); border: 3px solid #FF6A48; z-index: 10000; pointer-events: none; opacity: 0; transform: scale(.4); }
    #demo-tap.is-on { animation: demo-tap .55s ease-out both; }
    @keyframes demo-tap { 0% { opacity: 1; transform: scale(.4); } 100% { opacity: 0; transform: scale(1.4); } }
  \`;
  document.head.appendChild(st);
  const place = () => {
    const r = document.querySelector('.stage')?.getBoundingClientRect(); if (!r) return;
    const n = document.getElementById('demo-notch'); n.style.left = (r.left + r.width / 2 - 55) + 'px'; n.style.top = (r.top - 2) + 'px';
    const c = document.getElementById('demo-cap'); c.style.left = (r.right + 30) + 'px'; c.style.top = (r.top + 60) + 'px';
  };
  const notch = document.createElement('div'); notch.id = 'demo-notch'; document.body.appendChild(notch);
  const cap = document.createElement('div'); cap.id = 'demo-cap';
  cap.innerHTML = '<div class="dc-n"><small>NARRATOR</small><p></p></div><div class="dc-c"><div class="dc-face"><svg viewBox="30 6 140 140"><use href="#chara-face-3q" x="30" y="6" width="140" height="140"/></svg></div><div class="dc-bubble"></div></div>';
  document.body.appendChild(cap);
  const tap = document.createElement('div'); tap.id = 'demo-tap'; document.body.appendChild(tap);
  place(); window.addEventListener('resize', place); setTimeout(place, 500);
  window.__demoSay = (n, c) => {
    const N = cap.querySelector('.dc-n'), C = cap.querySelector('.dc-c');
    if (n !== undefined) { if (n) { N.querySelector('p').textContent = n; N.classList.add('is-on'); } else N.classList.remove('is-on'); }
    if (c !== undefined) { if (c) { C.querySelector('.dc-bubble').textContent = c; C.classList.add('is-on'); } else C.classList.remove('is-on'); }
  };
  window.__demoTap = (x, y) => { tap.style.left = x + 'px'; tap.style.top = y + 'px'; tap.classList.remove('is-on'); void tap.offsetWidth; tap.classList.add('is-on'); };
  return 'injected';
})()`;

try {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  const frames = []; let n = 0; let t0 = null;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.screencastFrame') {
      const ts = m.params.metadata.timestamp; if (t0 === null) t0 = ts;
      const name = `frames/${String(++n).padStart(5, '0')}.jpg`;
      writeFileSync(join(outDir, name), Buffer.from(m.params.data, 'base64'));
      frames.push({ name, t: ts - t0 });
      ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
    } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) { console.log('eval error:', JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return undefined; } return r.result?.result?.value; };
  const started = Date.now();
  const mark = label => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${label}`);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });

  const clickAt = async (x, y) => {
    await ev(`window.__demoTap && window.__demoTap(${x}, ${y})`);
    await sleep(120);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const rectOf = async sel => JSON.parse(await ev(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`) ?? 'null');

  let k = 0;
  for (const s of steps) {
    if (++k > until) break;
    if (s.goto) {
      await send('Page.navigate', { url: s.goto });
      await sleep(s.load ?? 6000);
      const off = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => /오프라인/.test(b.textContent)); if (b) { b.click(); return true; } return false; })()`);
      if (off) await sleep(2500);
      for (let i = 0; i < 20; i++) { const ok = await ev(`!!document.querySelector('.stage')`); if (ok) break; await sleep(500); }
      console.log('overlay:', await ev(OVERLAY));
      mark(`goto ${s.goto}`);
    }
    if (s.say) { await ev(`window.__demoSay(${JSON.stringify(s.say[0])}, ${JSON.stringify(s.say[1])})`); }
    if (s.click) {
      let pt = Array.isArray(s.click) ? s.click : await rectOf(s.click);
      if (!pt) { console.log('click: not found', s.click); } else await clickAt(pt[0], pt[1]);
    }
    if (s.tapClick) {   // 셀렉터(또는 [셀렉터, 글자])를 찾아 물결 표시 뒤 el.click() — 크롬 버튼·탭·시트 닫기처럼 마우스 좌표 클릭이 안 먹는 곳
      const [sel, txt] = Array.isArray(s.tapClick) ? s.tapClick : [s.tapClick, null];
      const pt = JSON.parse(await ev(`(() => { const list = [...document.querySelectorAll(${JSON.stringify(sel)})]; const e = ${txt === null ? 'list[0]' : `list.find(b => (b.textContent || '').includes(${JSON.stringify(txt)}))`}; if (!e) return 'null'; const r = e.getBoundingClientRect(); window.__demoTap && window.__demoTap(r.left + r.width / 2, r.top + r.height / 2); setTimeout(() => e.click(), 150); return JSON.stringify([r.left, r.top]); })()`) ?? 'null');
      if (!pt) console.log('tapClick: not found', s.tapClick); else await sleep(300);
    }
    if (s.clickText) {   // 글자로 버튼 찾기: [셀렉터, 포함 글자]
      const pt = JSON.parse(await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(s.clickText[0])})].find(b => (b.textContent || '').includes(${JSON.stringify(s.clickText[1])})); if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`) ?? 'null');
      if (!pt) console.log('clickText: not found', s.clickText); else await clickAt(pt[0], pt[1]);
    }
    if (s.eval) { const v = await ev(s.eval); if (v !== undefined) console.log('eval →', String(v).slice(0, 200)); }
    if (s.jump) {
      const m = /^(?:\+(\d+)\s+)?(\d{1,2}):(\d{2})$/.exec(s.jump);
      if (!m) console.log('jump: bad', s.jump);
      else {
        // 건너뛰는 활동은 endAt 직후로 한 번 들렀다 간다 — 앨범·친구가 정산된다 (한 eval 안에서 두 번 jumpTo: 화면은 한 번만 그린다)
        const v = await ev(`(() => { const st = window.__world.getState(); const d = new Date(st.now); d.setHours(0, 0, 0, 0); const t = d.getTime() + ${Number(m[1] ?? 0)} * 86400000 + ${Number(m[2])} * 3600000 + ${Number(m[3])} * 60000;
          for (const a of st.timeline) if (a.endAt < t && a.endAt > st.now && a.option.category !== 'sleep' && !window.__world.getState().book.some(c => c.id === 'c:' + a.key)) window.__world.getState().jumpTo(a.endAt + 1000);
          window.__world.getState().jumpTo(t); return new Date(t).toString().slice(16, 21); })()`);
        console.log('jump →', v);
      }
    }
    if (s.wait) await sleep(s.wait);
    if (s.mark) mark(s.mark);
  }
  await sleep(600);
  await send('Page.stopScreencast');
  ws.close();
  // concat 목록: 프레임 간격이 duration. 마지막은 0.6초
  let list = '';
  for (let i = 0; i < frames.length; i++) { const d = i + 1 < frames.length ? Math.max(0.01, frames[i + 1].t - frames[i].t) : 0.6; list += `file '${frames[i].name}'\nduration ${d.toFixed(3)}\n`; }
  if (frames.length) list += `file '${frames[frames.length - 1].name}'\n`;
  writeFileSync(join(outDir, 'list.txt'), list);
  console.log(`frames: ${frames.length}, ${(frames.at(-1)?.t ?? 0).toFixed(1)}s`);
  if (logs.length) console.log('LOGS:\n' + logs.slice(0, 10).join('\n'));
  const crop = process.env.CROP ? `-vf crop=${process.env.CROP.replace('x', ':')}:0:0` : '';
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-fps_mode', 'cfr', '-r', '30', ...(crop ? crop.split(' ') : []), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', 'demo.mp4'], { cwd: outDir, stdio: 'inherit' });
  console.log('ffmpeg exit', r.status, '→', join(outDir, 'demo.mp4'));
} finally { chrome.kill('SIGKILL'); }
