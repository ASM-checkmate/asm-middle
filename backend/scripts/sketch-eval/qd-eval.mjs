// 렌더한 스케치를 비전 모델에게 보여 주고 20개 보기 중 하나를 고르게 한다. 정확도·시간을 모델별로 잰다.
// Usage: node qd-eval.mjs <pngDir> <model...>   (env LIMIT=개수, OPEN=1이면 보기 없이 자유 답)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, ...models] = process.argv.slice(2);
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const labels = [...new Set(index.map(i => i.word))];
const limit = Number(process.env.LIMIT ?? index.length);
const items = index.slice(0, limit);
const schema = { type: 'object', properties: { label: { type: 'string', enum: [...labels, 'unknown'] } }, required: ['label'] };
const prompt = process.env.PROMPT === 'ko' ? `이 그림은 한 가지 색 붓으로 대충 그린 낙서다. 다음 중 무엇을 그린 것인가? 하나만 고른다: ${labels.join(', ')}. 정말 모르겠으면 "unknown". JSON으로만 답한다: {"label": "..."}` : `This is a quick doodle drawn with a single-color brush. Which ONE of these does it depict? ${labels.join(', ')}. If you really cannot tell, answer "unknown". Reply as JSON: {"label": "..."}`;
for (const model of models) {
  let ok = 0, unk = 0, t = 0; const wrong = [];
  for (const it of items) {
    const img = readFileSync(join(dir, it.id + '.png')).toString('base64');
    const t0 = Date.now();
    let label = 'ERR';
    try {
      const res = await fetch('http://localhost:11434/api/chat', { method: 'POST', body: JSON.stringify({ model, stream: false, think: false, format: schema, keep_alive: '10m', options: { temperature: 0, num_predict: 40 }, messages: [{ role: 'user', content: prompt, images: [img] }] }) });
      const j = await res.json();
      label = JSON.parse(j.message?.content ?? '{}').label ?? 'ERR';
    } catch (e) { label = 'ERR:' + e.message.slice(0, 40); }
    t += Date.now() - t0;
    if (label === it.word) ok++; else if (label === 'unknown') unk++; else wrong.push(`${it.word}→${label}`);
  }
  console.log(`${model.padEnd(14)} acc ${(100 * ok / items.length).toFixed(0).padStart(3)}%  unknown ${unk}  avg ${(t / items.length / 1000).toFixed(2)}s/img   wrong: ${wrong.slice(0, 8).join(', ')}${wrong.length > 8 ? ' …' : ''}`);
}
