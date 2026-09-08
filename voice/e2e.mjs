// 음성 서비스 E2E (브라우저 없이): wav를 마이크처럼 흘려 VAD·STT를 보고, 문장을 넣어 TTS 조각이 오는지 본다.
// Usage: node e2e.mjs ws://localhost:8790 sample16k.wav "여보세요, 나야."
import { readFileSync } from 'node:fs';
const [url = 'ws://localhost:8790', wav = 'sample16k.wav', text = '여보세요, 나야. 아까 힘들다고 했잖아.'] = process.argv.slice(2);

// wav(16k mono int16) → PCM 바이트. 헤더 44바이트 가정 (soundfile이 쓴 PCM_16)
const buf = readFileSync(wav);
const dataAt = buf.indexOf('data') + 8;
const pcm = buf.subarray(dataAt);
const sr = buf.readUInt32LE(24);
if (sr !== 16000) { console.error('wav must be 16k'); process.exit(1); }

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';
const t0 = Date.now();
const log = (...a) => console.log(String(Date.now() - t0).padStart(6), ...a);
let audioBytes = 0, audioFrames = 0, firstAudio = null, sayAt = 0, pendingMeta = null;
ws.onopen = () => log('open');
ws.onmessage = async e => {
  if (typeof e.data !== 'string') { audioBytes += e.data.byteLength; audioFrames++; if (firstAudio === null) { firstAudio = Date.now() - sayAt; log('first audio', firstAudio, 'ms', pendingMeta); } return; }
  const m = JSON.parse(e.data);
  if (m.type === 'audio') { pendingMeta = m; if (m.last) { log('audio done', { frames: audioFrames, sec: (audioBytes / 2 / m.sr).toFixed(2), total: Date.now() - sayAt }); setTimeout(() => { ws.send(JSON.stringify({ type: 'stop' })); ws.close(); process.exit(0); }, 200); } return; }
  log(m.type, m.text ?? m.ms ?? '');
  if (m.type === 'ready') {
    ws.send(JSON.stringify({ type: 'start' }));
    // 마이크처럼: 64ms(2048 bytes)씩 실시간 속도로, 앞뒤에 침묵 0.6초
    const chunk = 2048; const silence = Buffer.alloc(chunk);
    const frames = [];
    for (let i = 0; i < 10; i++) frames.push(silence);
    for (let i = 0; i < pcm.length; i += chunk) frames.push(pcm.subarray(i, i + chunk));
    for (let i = 0; i < 15; i++) frames.push(silence);
    let k = 0;
    const iv = setInterval(() => { if (k >= frames.length) { clearInterval(iv); return; } ws.send(frames[k++]); }, 64);
  }
  if (m.type === 'transcript') {
    sayAt = Date.now();
    ws.send(JSON.stringify({ type: 'say', turn: 1, seq: 0, text }));
  }
};
ws.onerror = () => { console.error('ws error'); process.exit(1); };
setTimeout(() => { console.error('timeout'); process.exit(1); }, 60_000);
