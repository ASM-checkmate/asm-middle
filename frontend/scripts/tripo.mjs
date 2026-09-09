// Tripo 이미지→3D (ADR-0014 개정 7): export-props.mjs가 뽑은 PNG를 올려 glb를 받는다. 키는 frontend/.env의 TRIPO_API_KEY.
// Usage:
//   node scripts/tripo.mjs <png> [--name cafe-table] [--rig idle|walk] [--out public/assets/models] [--version v2.5-20250123]
//   node scripts/tripo.mjs --scene cafe [--src assets-src]         # 그 장소의 (눕지 않는) 소품 전부 → cafe-<번호>.glb
// 결과 glb는 out 폴더에, 등록용 매니페스트 조각은 stdout 마지막 줄(JSON)에. 톤 패스가 팔레트·셀 셰이딩·외곽선을 입히니 texture는 켠다.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes(k);
const env = Object.fromEntries(existsSync('.env') ? readFileSync('.env', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]) : []);
const KEY = process.env.TRIPO_API_KEY || env.TRIPO_API_KEY;
if (!KEY) { console.error('TRIPO_API_KEY가 없다 (.env)'); process.exit(1); }
const API = 'https://api.tripo3d.ai/v2/openapi';
const H = { Authorization: `Bearer ${KEY}` };
const out = opt('--out', 'public/assets/models');
const version = opt('--version', 'v2.5-20250123');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.code !== 0) throw new Error(`${path}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j.data;
}
async function upload(png) {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(png)], { type: 'image/png' }), basename(png));
  return (await api('/upload', { method: 'POST', body: fd })).image_token;
}
async function wait(taskId, label) {
  for (let i = 0; i < 240; i++) {
    const d = await api(`/task/${taskId}`);
    if (d.status === 'success') return d;
    if (['failed', 'cancelled', 'unknown', 'banned', 'expired'].includes(d.status)) throw new Error(`${label}: ${d.status}`);
    if (i % 6 === 0) process.stdout.write(`  ${label} ${d.status} ${d.progress ?? ''}%\n`);
    await sleep(5000);
  }
  throw new Error(`${label}: timeout`);
}
async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** 그림 한 장 → glb. rig가 있으면 리깅 뒤 프리셋 애니메이션(idle·walk…)을 입힌 glb */
async function generate(png, name, rig) {
  mkdirSync(out, { recursive: true });
  console.log(`▶ ${name} ← ${png}`);
  const token = await upload(png);
  const task = await api('/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    type: 'image_to_model', file: { type: 'png', file_token: token }, model_version: version,
    texture: true, pbr: false, texture_quality: 'standard', auto_size: false, face_limit: 20000,
  }) });
  let done = await wait(task.task_id, name);
  let modelTask = task.task_id;
  if (rig) {
    const chk = await api('/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'animate_prerigcheck', original_model_task_id: modelTask }) });
    const c = await wait(chk.task_id, `${name} rig-check`);
    if (c.output?.riggable === false) console.log('  리깅 불가 — 정지 모델만');
    else {
      const rigT = await api('/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'animate_rig', original_model_task_id: modelTask, out_format: 'glb' }) });
      await wait(rigT.task_id, `${name} rig`);
      const anim = await api('/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'animate_retarget', original_model_task_id: rigT.task_id, animation: `preset:${rig}`, out_format: 'glb' }) });
      done = await wait(anim.task_id, `${name} ${rig}`);
      modelTask = anim.task_id;
    }
  }
  const url = done.output?.model ?? done.output?.pbr_model ?? done.output?.base_model;
  if (!url) throw new Error(`${name}: 결과 URL 없음 ${JSON.stringify(done.output).slice(0, 200)}`);
  const file = join(out, `${name}.glb`);
  await download(url, file);
  console.log(`✓ ${file}`);
  return `/assets/models/${name}.glb`;
}

const scene = opt('--scene');
const manifestOut = {};
if (scene) {
  const src = opt('--src', 'assets-src');
  const m = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'))[scene];
  if (!m) { console.error(`manifest에 ${scene} 없음`); process.exit(1); }
  manifestOut.props = { [scene]: {} };
  for (const p of m.props) {
    if (p.lie) continue;   // 눕는 것(러그·돗자리)은 그림 그대로
    try { manifestOut.props[scene][String(p.index)] = { url: await generate(join(src, p.file), `${scene}-${p.index}`) }; }
    catch (e) { console.error(`✗ ${scene}-${p.index}: ${e.message}`); }
  }
} else {
  const png = args.find(a => a.endsWith('.png'));
  if (!png) { console.error('png 경로나 --scene이 필요하다'); process.exit(1); }
  const name = opt('--name', basename(png, '.png'));
  const url = await generate(png, name, opt('--rig'));
  manifestOut.single = { name, url };
}
console.log(JSON.stringify(manifestOut));
