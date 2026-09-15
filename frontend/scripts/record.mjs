// 데모 영상 녹화 (CDP 스크린캐스트 + macOS `say` TTS). Usage: node scripts/record.mjs <outDir> <steps.json> [untilStep]
// 창 760×1000 @2x — `.stage`가 둥근 폰 무대가 되고(index.css @media), 왼쪽에 폰·오른쪽에 자막 패널(나레이터 + 캐릭터 독백)을 주입한다.
// 로딩 중 프레임은 버린다(hold): goto·jump·ready 스텝 뒤 window.__demoReady()(폰트·지도 타일·시트 지도)가 참일 때까지.
// 자막마다 TTS(나레이터: Yuna / 캐릭터: Yuna 높은 음)를 만들어 그 시점에 섞는다 — 다음 자막·전환은 목소리가 끝난 뒤.
// steps: goto{url} · intro[독백] · introOff · say[나레이터, 독백] · click(셀렉터|[x,y]) · tapClick(셀렉터|[셀렉터,글자]) · eval · jump("HH:MM"|"+1 00:30")
//        · scale(n) · waitUntil{expr,max} · hold{expr,max} · dropPhoto{url,cell} · wait(ms) · mark(라벨)
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [outDir, stepsFile, untilArg] = process.argv.slice(2);
const until = untilArg ? Number(untilArg) : Infinity;
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
mkdirSync(join(outDir, 'frames'), { recursive: true });
mkdirSync(join(outDir, 'tts'), { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 760, H = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── TTS: 미리 만든다 (같은 문장은 재사용) ───
const VOICE = process.env.VOICE || 'Yuna';
const tts = (text, who) => {
  const key = createHash('md5').update(who + '|' + text).digest('hex').slice(0, 10);
  const file = join(outDir, 'tts', `${who}-${key}.aiff`);
  if (!existsSync(file)) {
    const args = who === 'c' ? ['-v', VOICE, '-o', file, `[[pbas 62]] [[rate 188]] ${text}`] : ['-v', VOICE, '-r', '172', '-o', file, text];
    const r = spawnSync('say', args); if (r.status !== 0) { console.log('tts fail', text); return null; }
  }
  const d = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return { file, dur: Number(String(d.stdout).trim()) || 1 };
};
for (const s of steps) { if (s.say) { s._tts = [s.say[0] ? tts(s.say[0], 'n') : null, s.say[1] ? tts(s.say[1], 'c') : null]; } if (s.intro) s._tts = [null, tts(s.intro, 'c')]; }
console.log('tts ready');

/** 페이지 주입: 폰 베젤 + 자막 패널 + 탭 표시 + 준비 판정 + 사진 떨구기 */
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
    #demo-intro { position: absolute; inset: 0; z-index: 900; background: #FFF6E6; display: grid; place-items: center; align-content: center; gap: 22px; opacity: 0; transition: opacity .4s ease; }
    #demo-intro.is-on { opacity: 1; }
    #demo-intro svg { width: 300px; height: 300px; animation: demo-bob 1.6s ease-in-out infinite; }
    @keyframes demo-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
    #demo-intro .dc-bubble { position: relative; margin: 0 28px; background: #FFFFFF; border: 2px solid #2A2118; border-radius: 22px; padding: 16px 20px; box-shadow: 4px 4px 0 #2A2118; font-family: 'Jua', 'Noto Sans KR', sans-serif; font-size: 24px; line-height: 1.35; color: #2A2118; text-align: center; word-break: keep-all; }
    #demo-intro .dc-bubble::before { content: ''; position: absolute; left: 50%; top: -14px; margin-left: -8px; border: 8px solid transparent; border-bottom-color: #2A2118; border-top: 0; }
    #demo-intro .dc-bubble::after { content: ''; position: absolute; left: 50%; top: -10px; margin-left: -6px; border: 6px solid transparent; border-bottom-color: #FFFFFF; border-top: 0; }
    #demo-intro small { font-family: 'DM Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: .14em; color: #A08C76; }
    #demo-drop { position: fixed; z-index: 10001; pointer-events: none; background: #FFFFFF; border: 2px solid #2A2118; border-radius: 6px; padding: 8px 8px 28px; box-shadow: 6px 8px 0 rgba(42,33,24,.35); }
    #demo-drop img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 3px; }
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
  window.__demoIntro = (text) => {
    let el = document.getElementById('demo-intro');
    if (!text) { if (el) { el.classList.remove('is-on'); setTimeout(() => el.remove(), 450); } return; }
    if (!el) { el = document.createElement('div'); el.id = 'demo-intro'; el.innerHTML = '<svg viewBox="30 6 140 140"><use href="#chara-face-happy" x="30" y="6" width="140" height="140"/></svg><div class="dc-bubble"></div><small>THEWORLD · DEMO</small>'; document.querySelector('.stage').appendChild(el); }
    el.querySelector('.dc-bubble').textContent = text; void el.offsetWidth; el.classList.add('is-on');
  };
  // 준비 판정: 폰트, 이동 지도(타일까지), 장소 시트 지도
  window.__demoReady = () => {
    if (document.fonts && document.fonts.status !== 'loaded') return false;
    const ms = document.querySelector('.map-scene');
    if (ms) { if (ms.classList.contains('is-loading')) return false; const m = window.__map; if (!m || !m.loaded() || !m.areTilesLoaded()) return false; }
    if (document.querySelector('.ps-map')) { const m = window.__sheetMap; if (!m || !m.loaded() || !m.areTilesLoaded()) return false; }
    return true;
  };
  // 생성된 사진이 위에서 액자처럼 떨어져 필름 칸에 안착한다 → 그 뒤 호출자가 replaceShotId로 칸을 바꾼다
  window.__demoDrop = (url, cellIndex) => new Promise(res => {
    const cell = document.querySelectorAll('.cam-cell .cam-thumb')[cellIndex]; const st = document.querySelector('.stage').getBoundingClientRect();
    if (!cell) return res('no cell');
    const r = cell.getBoundingClientRect();
    const el = document.createElement('div'); el.id = 'demo-drop'; el.innerHTML = '<img src="' + url + '">';
    const w = 200, h = Math.round(w * r.height / r.width) + 20;
    el.style.width = w + 'px'; el.style.height = (h + 20) + 'px'; el.style.left = (st.left + st.width / 2 - w / 2) + 'px'; el.style.top = (st.top + 120) + 'px';
    document.body.appendChild(el);
    const dx = (r.left + r.width / 2) - (st.left + st.width / 2), dy = (r.top + r.height / 2) - (st.top + 120 + (h + 20) / 2);
    const sx = r.width / (w + 20);
    const a = el.animate([
      { transform: 'translateY(-560px) rotate(-10deg)', opacity: 0 },
      { transform: 'translateY(0) rotate(4deg)', opacity: 1, offset: .42 },
      { transform: 'translateY(0) rotate(-2deg)', opacity: 1, offset: .62 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(0deg) scale(' + sx + ')', opacity: 1 },
    ], { duration: 2000, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' });
    a.onfinish = () => { setTimeout(() => { el.remove(); res('dropped'); }, 120); };
  });
  return 'injected';
})()`;

const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'tw-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--force-device-scale-factor=2', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

try {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  // 프레임: hold 중엔 버린다. 영상 시각(vt)은 남긴 프레임의 간격 합 — hold가 끝난 첫 프레임은 1/30초 뒤에 붙는다 (구멍 없이)
  const frames = []; let n = 0; let holding = true; let lastTs = null; let lastVt = 0; let lastKeptWall = Date.now(); let resumed = false;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.screencastFrame') {
      const ts = m.params.metadata.timestamp;
      ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
      if (!holding) {
        const vt = lastTs === null ? 0 : lastVt + (resumed ? 1 / 30 : Math.min(0.5, ts - lastTs));
        resumed = false;
        const name = `frames/${String(++n).padStart(5, '0')}.jpg`;
        writeFileSync(join(outDir, name), Buffer.from(m.params.data, 'base64'));
        frames.push({ name, vt }); lastVt = vt; lastKeptWall = Date.now();
      } else resumed = true;
      lastTs = ts;
    } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) { console.log('eval error:', JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return undefined; } return r.result?.result?.value; };
  const videoNow = () => (frames.length ? lastVt + (holding ? 0 : (Date.now() - lastKeptWall) / 1000) : 0);
  const mark = label => console.log(`[vt ${videoNow().toFixed(1)}s] ${label}`);
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
  const centerOf = async (sel, txt = null) => JSON.parse(await ev(`(() => { const list = [...document.querySelectorAll(${JSON.stringify(sel)})]; const e = ${txt === null ? 'list[0]' : `list.find(b => (b.textContent || '').includes(${JSON.stringify(txt)}))`}; if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`) ?? 'null');
  /** 준비될 때까지 프레임을 버린다 */
  const holdUntil = async (expr, max = 15000, settle = 350) => {
    holding = true; const t0 = Date.now();
    while (Date.now() - t0 < max) { if (await ev(expr)) break; await sleep(150); }
    if (Date.now() - t0 >= max) console.log('  hold timeout:', expr.slice(0, 60));
    await sleep(settle); holding = false; lastKeptWall = Date.now();
  };
  const waitUntil = async (expr, max = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < max) { if (await ev(expr)) return true; await sleep(200); } console.log('  waitUntil timeout:', expr.slice(0, 60)); return false; };
  // 목소리: 영상 시각에 맞춰 나중에 섞는다. 다음 자막·전환은 목소리가 끝난 뒤
  const voices = []; let voiceUntilWall = 0;
  const speak = (clips) => {
    let at = videoNow(); let wall = Date.now();
    for (const c of clips) { if (!c) continue; voices.push({ file: c.file, at }); at += c.dur + 0.35; wall += (c.dur + 0.35) * 1000; }
    voiceUntilWall = Math.max(voiceUntilWall, wall);
  };
  const voiceDone = async () => { const d = voiceUntilWall - Date.now(); if (d > 0) await sleep(d); };

  let k = 0;
  for (const s of steps) {
    if (++k > until) break;
    if (s.goto) {
      holding = true;
      await send('Page.navigate', { url: s.goto });
      await sleep(s.load ?? 6000);
      const off = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => /오프라인/.test(b.textContent)); if (b) { b.click(); return true; } return false; })()`);
      if (off) await sleep(2500);
      for (let i = 0; i < 20; i++) { const ok = await ev(`!!document.querySelector('.stage')`); if (ok) break; await sleep(500); }
      console.log('overlay:', await ev(OVERLAY));
      await holdUntil('window.__demoReady && window.__demoReady()', 15000, 600);
      mark(`goto ${s.goto}`);
    }
    if (s.intro !== undefined) { await voiceDone(); await ev(`window.__demoIntro(${JSON.stringify(s.intro)})`); await sleep(450); speak([s._tts?.[1]]); }
    if (s.introOff) { await voiceDone(); await sleep(400); await ev(`window.__demoIntro('')`); await sleep(500); }
    if (s.say) { await voiceDone(); await ev(`window.__demoSay(${JSON.stringify(s.say[0])}, ${JSON.stringify(s.say[1])})`); speak(s._tts ?? []); }
    if (s.click) {
      const pt = Array.isArray(s.click) ? s.click : await centerOf(s.click);
      if (!pt) console.log('click: not found', s.click); else await clickAt(pt[0], pt[1]);
    }
    if (s.tapClick) {
      const [sel, txt] = Array.isArray(s.tapClick) ? s.tapClick : [s.tapClick, null];
      const pt = await centerOf(sel, txt);
      if (!pt) console.log('tapClick: not found', s.tapClick);
      else { await ev(`window.__demoTap(${pt[0]}, ${pt[1]})`); await sleep(150); await ev(`(() => { const list = [...document.querySelectorAll(${JSON.stringify(sel)})]; const e = ${txt === null ? 'list[0]' : `list.find(b => (b.textContent || '').includes(${JSON.stringify(txt)}))`}; e && e.click(); })()`); await sleep(250); }
    }
    if (s.eval) { const v = await ev(s.eval); if (v !== undefined) console.log('eval →', String(v).slice(0, 200)); }
    if (s.jump) {
      await voiceDone();
      const m = /^(?:\+(\d+)\s+)?(\d{1,2}):(\d{2})$/.exec(s.jump);
      if (!m) console.log('jump: bad', s.jump);
      else {
        holding = true;
        const v = await ev(`(() => { const st = window.__world.getState(); const d = new Date(st.now); d.setHours(0, 0, 0, 0); const t = d.getTime() + ${Number(m[1] ?? 0)} * 86400000 + ${Number(m[2])} * 3600000 + ${Number(m[3])} * 60000;
          for (const a of st.timeline) if (a.endAt < t && a.endAt > st.now && a.option.category !== 'sleep' && !window.__world.getState().book.some(c => c.id === 'c:' + a.key)) window.__world.getState().jumpTo(a.endAt + 1000);
          window.__world.getState().jumpTo(t); return new Date(t).toString().slice(16, 21); })()`);
        await sleep(400);
        await holdUntil('window.__demoReady && window.__demoReady()', 20000, 500);
        console.log('jump →', v);
      }
    }
    if (s.scale) { await ev(`window.__world.getState().setScale(${Number(s.scale)})`); }
    if (s.hold) { await holdUntil(s.hold.expr ?? s.hold, s.hold.max ?? 15000); }
    if (s.waitUntil) { await waitUntil(s.waitUntil.expr ?? s.waitUntil, s.waitUntil.max ?? 30000); }
    if (s.dropPhoto) {
      const r = await ev(`window.__demoDrop(${JSON.stringify(s.dropPhoto.url)}, ${Number(s.dropPhoto.cell ?? 0)})`);
      console.log('drop →', r);
      const v = await ev(`(async () => { const st = window.__world.getState(); const shot = st.shots.filter(x => x.actKey === st.phase.act.key).at(-1); if (!shot) return 'no shot'; const blob = await (await fetch(${JSON.stringify(s.dropPhoto.url)})).blob(); const id = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join(''); await window.__media.putLocal(id, blob, 'shot'); window.__world.getState().replaceShotId(shot.shotId, id); return 'replaced ' + id.slice(0, 6); })()`);
      console.log('photo →', v);
    }
    if (s.wait) await sleep(s.wait);
    if (s.mark) mark(s.mark);
  }
  await voiceDone();
  await sleep(600);
  await send('Page.stopScreencast');
  ws.close();
  let list = '';
  for (let i = 0; i < frames.length; i++) { const d = i + 1 < frames.length ? Math.max(0.01, frames[i + 1].vt - frames[i].vt) : 0.6; list += `file '${frames[i].name}'\nduration ${d.toFixed(3)}\n`; }
  if (frames.length) list += `file '${frames[frames.length - 1].name}'\n`;
  writeFileSync(join(outDir, 'list.txt'), list);
  console.log(`frames: ${frames.length}, ${(frames.at(-1)?.vt ?? 0).toFixed(1)}s, voices: ${voices.length}`);
  if (logs.length) console.log('LOGS:\n' + logs.slice(0, 10).join('\n'));
  let r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-fps_mode', 'cfr', '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', 'video.mp4'], { cwd: outDir, stdio: 'inherit' });
  console.log('ffmpeg video exit', r.status);
  // 목소리 섞기: 클립마다 adelay, amix
  if (voices.length) {
    const inputs = voices.flatMap(v => ['-i', v.file]);
    const filt = voices.map((v, i) => `[${i + 1}]adelay=${Math.round(v.at * 1000)}|${Math.round(v.at * 1000)}[a${i}]`).join(';') + ';' + voices.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${voices.length}:normalize=0:dropout_transition=0[aout]`;
    r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'video.mp4', ...inputs, '-filter_complex', filt, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', 'demo.mp4'], { cwd: outDir, stdio: 'inherit' });
    console.log('ffmpeg mix exit', r.status, '→', join(outDir, 'demo.mp4'));
  } else spawnSync('cp', ['video.mp4', 'demo.mp4'], { cwd: outDir });
} finally { chrome.kill('SIGKILL'); }
