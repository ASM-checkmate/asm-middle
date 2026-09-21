// 나노바나나(Gemini 이미지 모델)에서 필요한 그림을 받아 저장한다. 매니페스트의 job 을 순서대로 호출하고 art/gen/<name>.png 로 쓴다.
//   node scripts/nano-banana.mjs art/gen/manifest.json            # 없는 것만 받는다 (있으면 건너뜀)
//   node scripts/nano-banana.mjs art/gen/manifest.json --only room,room-empty --force
//   node scripts/nano-banana.mjs art/gen/manifest.json --dry      # 호출 없이 계획만
// 키: 환경변수 GEMINI_API_KEY 또는 frontend/.env.local 의 GEMINI_API_KEY=... (*.local 은 .gitignore)
// API: models/{model}:generateContent (generationConfig.responseModalities ["IMAGE"], imageConfig.aspectRatio·imageSize) — 편집은 참고 그림을
// inlineData 로 같이 보낸다. 응답의 inlineData(base64) 를 찾아 저장. 429/5xx 는 물러났다 다시, 그림이 안 오면(거절 등) 글을 남기고 한 번 더.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const ENDPOINT = process.env.GEMINI_ENDPOINT ?? 'https://generativelanguage.googleapis.com/v1beta/models';   // 테스트용 가짜 서버로 돌릴 때 바꾼다
const args = process.argv.slice(2);
const manifestPath = args.find(a => !a.startsWith('--')) ?? 'art/gen/manifest.json';
const flag = k => args.includes(`--${k}`);
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('only')?.split(',').map(s => s.trim()).filter(Boolean);
const DRY = flag('dry'), FORCE = flag('force');

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const f of ['.env.local', '../.env.local']) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\n]+)"?\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const OUT = manifest.out ?? 'art/gen';
mkdirSync(OUT, { recursive: true });
/** 저장 파일: 모델이 jpeg 를 주면 .jpg 로 저장하므로, 있는 쪽을 찾는다 (없으면 .png) */
const outPath = name => [join(OUT, `${name}.png`), join(OUT, `${name}.jpg`)].find(existsSync) ?? join(OUT, `${name}.png`);
/** ref: 다른 job 이름(그 출력) 또는 파일 경로 */
/** ref: 다른 job 이름(그 출력), out 폴더에 미리 둔 그림 이름(anime-room 처럼 손으로 넣은 것), 또는 파일 경로 */
const refPath = r => (manifest.jobs.some(j => j.name === r) || existsSync(outPath(r)) ? outPath(r) : r);
const mimeOf = p => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[extname(p).toLowerCase()] ?? 'image/png';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = line => { console.log(line); appendFileSync(join(OUT, '_log.txt'), `${new Date().toISOString()} ${line}\n`); };

/** 응답 어디에 있든 base64 그림을 찾는다 (inlineData / inline_data / image.data) */
function findImage(o) {
  if (!o || typeof o !== 'object') return null;
  for (const k of ['inlineData', 'inline_data', 'image']) {
    const v = o[k];
    if (v && typeof v.data === 'string' && v.data.length > 1000) return { data: v.data, mime: v.mimeType ?? v.mime_type ?? 'image/png' };
  }
  for (const v of Array.isArray(o) ? o : Object.values(o)) { const f = findImage(v); if (f) return f; }
  return null;
}
function findText(o, acc = []) {
  if (!o || typeof o !== 'object') return acc;
  if (typeof o.text === 'string') acc.push(o.text);
  for (const v of Array.isArray(o) ? o : Object.values(o)) findText(v, acc);
  return acc;
}

async function generate(key, job) {
  const model = job.model ?? manifest.model ?? 'gemini-3.1-flash-image';
  const parts = [];
  for (const r of job.refs ?? []) {
    const p = refPath(r);
    if (!existsSync(p)) throw new Error(`참고 그림 없음: ${p} (job ${r} 을 먼저 받아야 한다)`);
    parts.push({ inlineData: { mimeType: mimeOf(p), data: readFileSync(p).toString('base64') } });
  }
  parts.push({ text: job.prompt });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: job.aspect ?? manifest.aspect ?? '2:3', imageSize: job.size ?? manifest.size ?? '1K' } },
  };
  let lastText = '', noImage = 0;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || [5000, 15000, 45000, 90000, 90000, 90000][attempt - 1];
      log(`  ${res.status} — ${Math.round(wait / 1000)}s 뒤 다시 (${attempt}/6)`);
      await sleep(wait); continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 400)}`);
    const img = findImage(json);
    if (img) return img;
    lastText = findText(json).join(' ').slice(0, 300) || JSON.stringify(json).slice(0, 300);
    log(`  그림이 안 왔다: ${lastText}`);
    if (++noImage >= 2) break;      // 거절이 두 번이면 프롬프트 문제 — 그만
  }
  throw new Error(`그림 없음 — ${lastText}`);
}

const jobs = manifest.jobs.filter(j => !only || only.includes(j.name));
console.log(`${jobs.length} jobs → ${OUT}${DRY ? ' (dry)' : ''}`);
const key = DRY ? 'dry' : apiKey();
if (!key) { console.error('GEMINI_API_KEY 가 없다 — 환경변수나 frontend/.env.local 에 넣는다'); process.exit(1); }

let done = 0, skipped = 0, failed = 0;
for (const job of jobs) {
  const out = outPath(job.name);
  if (existsSync(out) && !FORCE) { skipped++; console.log(`· ${job.name} (있음)`); continue; }
  const refs = (job.refs ?? []).map(refPath).join(', ');
  if (DRY) { console.log(`→ ${job.name}${refs ? `  ← ${refs}` : ''}\n    ${job.prompt.slice(0, 110)}…`); continue; }
  try {
    log(`→ ${job.name}${refs ? `  ← ${refs}` : ''}`);
    const img = await generate(key, job);
    const file = img.mime === 'image/jpeg' ? out.replace(/\.png$/, '.jpg') : out;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(img.data, 'base64'));
    log(`  저장 ${file} (${img.mime})`);
    done++;
    await sleep(1200);
  } catch (e) {
    failed++;
    log(`  실패 ${job.name}: ${e.message}`);
  }
}
console.log(`받음 ${done} · 건너뜀 ${skipped} · 실패 ${failed}`);
process.exit(failed ? 1 : 0);
