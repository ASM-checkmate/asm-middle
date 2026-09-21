// 생성 컷을 오프라인으로 — 서버 ShotGenService.promptByText(ADR-0029 결정 6)를 그대로 옮겼다. 데모 영상용(서버 없이 dropPhoto에 끼울 그림).
//   node scripts/shot-gen.mjs --bg <배경.webp|png> --me <나.png> [--friend <동행.png>] --place "삼진포차" --spot "앞 테이블" [--sit]
//        --me-pos 37,92,0.5 [--friend-pos 63,92,0.5] [--me-pose sit] [--friend-pose sit] [--extra "…한 문장"] [--ref <참고 그림.png>]… --out <out.png>
// 그림 순서는 서버와 같다: 첫 그림 = 배경, 둘째 = 나, 셋째 = 동행(있을 때), 그 뒤 --ref 그림들(제품 참고 등 — 프롬프트가 "the next image"로 가리킨다).
// 키: GEMINI_API_KEY 또는 frontend/.env.local. 모델·크기는 nano-banana.mjs와 같다(gemini-3.1-flash-image, 2:3, 1K).
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const opts = k => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
const flag = k => args.includes(`--${k}`);
const need = k => { const v = opt(k); if (!v) { console.error(`--${k}가 필요하다`); process.exit(1); } return v; };

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const f of ['.env.local', '../.env.local']) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\n]+)"?\s*$/m);
    if (m) return m[1].trim();
  }
  return null;
}
const mimeOf = p => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[extname(p).toLowerCase()] ?? 'image/png';
const pic = p => ({ inlineData: { mimeType: mimeOf(p), data: readFileSync(p).toString('base64') } });
const fig = s => { const [x, y, scale] = s.split(',').map(Number); return { x, y, scale }; };

// ── 서버와 같은 문구 (backend/.../photo/ShotGenService.java) ──
const POSE_EN = { idle: 'standing relaxed', sit: 'sitting', wave: 'waving one hand', happy: 'cheering with both arms up', eat: 'eating with chopsticks', read: 'reading a book', think: 'thinking with a hand on the chin', draw: 'drawing in a sketchbook', walk: 'walking', sing: 'singing into a handheld microphone' };
const figureText = f => `feet touching the ground at about ${Math.round(f.x)}% from the left edge and ${Math.round(f.y)}% down from the top of the frame, about ${Math.round(f.scale * 100)}% of the frame width wide`;
function promptByText({ place, spot, sit, mePose, friendPose, mePos, friendPos, friend, extra, refs }) {
  const me = POSE_EN[mePose ?? 'idle'] ?? 'standing relaxed', fr = POSE_EN[friendPose ?? 'wave'] ?? 'waving one hand';
  const where = place + (spot ? ` (${spot})` : '');
  let s = `The first image is a painted background of ${where}. The second image is a flat vector mascot character`;
  if (friend) s += ', the third image is her friend';
  s += `. Paint ${friend ? 'both of them' : 'this character'} INTO the background, ${sit ? 'SITTING on the seat, bench or stool that is there' : 'standing'}, facing the camera. `;
  s += `Main character: ${figureText(mePos)}; ${me}. `;
  if (friend) s += `Friend: ${friendPos ? figureText(friendPos) : 'right next to her'}; ${fr}. `;
  s += 'The positions are approximate — fix anything physically awkward (sit properly on the seat, correct depth so a table or counter in front partly covers the lap, feet hidden by foreground objects, consistent scale, natural contact shadows). ';
  if (extra) s += extra.trim() + (/[.!]$/.test(extra.trim()) ? ' ' : '. ');
  if (refs.length) s += `The ${friend ? 'fourth' : 'third'} image${refs.length > 1 ? 's are' : ' is'} a product reference — copy its look faithfully. `;
  s += `Keep ${friend ? 'both' : 'her'} recognizable as the mascot reference: round head, bowl haircut with the little sprout on top, big dot eyes with white highlights, pink cheeks, tiny arms and feet, chibi proportions with a very big head, the same clothes and colors${friend ? ' (the friend keeps her own hair, scarf and shirt colors from the third image)' : ''}. `;
  s += `Render ${friend ? 'them' : 'her'} in the same semi-realistic anime painting style as the background — soft painted shading, lighting and color grading that match the scene. `;
  s += 'Keep the background exactly as it is. No text, no watermark, no signature.';
  return s;
}

const bg = need('bg'), me = need('me'), out = need('out');
const friend = opt('friend');
const refs = opts('ref');
const prompt = promptByText({ place: need('place'), spot: opt('spot'), sit: flag('sit'), mePose: opt('me-pose'), friendPose: opt('friend-pose'), mePos: fig(opt('me-pos') ?? '50,85,0.5'), friendPos: opt('friend-pos') ? fig(opt('friend-pos')) : undefined, friend: !!friend, extra: opt('extra'), refs });
console.log('prompt:\n' + prompt + '\n');
if (flag('dry')) process.exit(0);
const key = apiKey(); if (!key) { console.error('GEMINI_API_KEY 가 없다'); process.exit(1); }
const parts = [pic(bg), pic(me), ...(friend ? [pic(friend)] : []), ...refs.map(pic), { text: prompt }];
const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: opt('aspect') ?? '2:3', imageSize: '1K' } } };
const ENDPOINT = process.env.GEMINI_ENDPOINT ?? 'https://generativelanguage.googleapis.com/v1beta/models';
const model = opt('model') ?? 'gemini-3.1-flash-image';
const findImage = o => { if (!o || typeof o !== 'object') return null; for (const k of ['inlineData', 'inline_data']) { const v = o[k]; if (v && typeof v.data === 'string' && v.data.length > 1000) return { data: v.data, mime: v.mimeType ?? v.mime_type ?? 'image/png' }; } for (const v of Array.isArray(o) ? o : Object.values(o)) { const f = findImage(v); if (f) return f; } return null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let img = null, last = '';
for (let attempt = 1; attempt <= 4 && !img; attempt++) {
  const res = await fetch(`${ENDPOINT}/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 429 || res.status >= 500) { console.log(`  ${res.status} — 다시 (${attempt})`); await sleep([5000, 15000, 45000, 60000][attempt - 1]); continue; }
  if (!res.ok) { console.error(`${res.status} ${JSON.stringify(json).slice(0, 400)}`); process.exit(1); }
  img = findImage(json);
  if (!img) { last = JSON.stringify(json).slice(0, 400); console.log('  그림이 안 왔다: ' + last); if (attempt >= 2) break; }
}
if (!img) { console.error('그림 없음 — ' + last); process.exit(1); }
const file = img.mime === 'image/jpeg' ? out.replace(/\.png$/, '.jpg') : out;
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, Buffer.from(img.data, 'base64'));
appendFileSync('art/backdrops/gen/_log.txt', `${new Date().toISOString()} shot-gen → ${file}\n  ${prompt}\n`);
console.log('저장', file, img.mime);
