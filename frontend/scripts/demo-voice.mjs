// 데모 대사를 일레븐랩스 TTS로 만들어 MOMO_TTS_DIR/NARR_TTS_DIR 형식(01.mp3, 02.mp3 …)으로 저장한다 — record.mjs가 그대로 섞는다.
// Usage: ELEVENLABS_API_KEY=… node scripts/demo-voice.mjs <voiceId|목소리 이름> <outDir> [--who c|n] [steps.json]   (c=모모 기본, n=나레이터)
//        ELEVENLABS_API_KEY=… node scripts/demo-voice.mjs --list        # 계정의 목소리 목록
// 순서는 record.mjs와 같다: 모모는 intro → say[1]이 있는 스텝 순, 나레이터는 say[0]이 있는 스텝 순. 이모지·기호는 뺀다. 이미 있는 번호는 건너뛴다(다시 만들려면 파일을 지운다).
// 모델·설정은 MODEL(기본 eleven_multilingual_v2)·STABILITY·SIMILARITY·STYLE 환경변수로 바꾼다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY가 필요하다'); process.exit(1); }
const API = 'https://api.elevenlabs.io/v1';
const headers = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };

const argv = process.argv.slice(2);
const whoI = argv.indexOf('--who'); const who = whoI >= 0 ? argv.splice(whoI, 2)[1] : 'c';
const [arg, outDir = who === 'n' ? '../design/voice/narr' : '../design/voice/momo', stepsFile = 'scripts/demo-busan.json'] = argv;

const voices = async () => { const r = await fetch(`${API}/voices`, { headers }); if (!r.ok) throw new Error(`voices ${r.status}: ${await r.text()}`); return (await r.json()).voices; };

if (arg === '--list' || !arg) {
  for (const v of await voices()) console.log(`${v.voice_id}  ${v.name}${v.labels ? '  ' + Object.values(v.labels).filter(Boolean).join(' · ') : ''}`);
  process.exit(0);
}

// 목소리: id를 그대로 주거나 이름으로 찾는다
let voiceId = arg;
if (!/^[A-Za-z0-9]{15,}$/.test(arg)) {
  const v = (await voices()).find(x => x.name.toLowerCase() === arg.toLowerCase());
  if (!v) { console.error(`목소리 "${arg}"를 못 찾았다 — --list로 확인`); process.exit(1); }
  voiceId = v.voice_id; console.log(`voice: ${v.name} (${voiceId})`);
}

const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const lines = [];
for (const s of steps) { if (who === 'c') { if (s.intro) lines.push(s.intro); if (s.say && s.say[1]) lines.push(s.say[1]); } else if (s.say && s.say[0]) lines.push(s.say[0]); }
// 대사 속 `|`는 0.3초 쉼(SSML break) — 자막엔 안 보인다(record.mjs가 뗀다). "모모야! | 오늘 내 하루를…" (오너 2026-09-17)
const speakable = t => t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s*\|\s*/g, ' <break time="0.3s" /> ').replace(/\s+/g, ' ').trim();
mkdirSync(outDir, { recursive: true });

const body = text => JSON.stringify({
  text, model_id: process.env.MODEL || 'eleven_multilingual_v2',
  voice_settings: { stability: Number(process.env.STABILITY ?? 0.45), similarity_boost: Number(process.env.SIMILARITY ?? 0.8), style: Number(process.env.STYLE ?? 0.35), use_speaker_boost: true },
});
for (let i = 0; i < lines.length; i++) {
  const n = String(i + 1).padStart(2, '0');
  const file = join(outDir, `${n}.mp3`);
  const text = speakable(lines[i]);
  if (existsSync(file)) { console.log(`${n}  (있음)  ${text}`); continue; }
  const r = await fetch(`${API}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { method: 'POST', headers, body: body(text) });
  if (!r.ok) { console.error(`${n}  실패 ${r.status}: ${await r.text()}`); process.exit(1); }
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log(`${n}  ${text}`);
}
console.log(`\n${lines.length}줄 → ${outDir}. 녹화: ${who === 'n' ? 'NARR' : 'MOMO'}_TTS_DIR=${outDir} node scripts/record.mjs /tmp/rec ${stepsFile}`);
