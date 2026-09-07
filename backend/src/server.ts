import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WORRY_KEYS, type ModelsResponse, type ReplyRequest, type SketchReadRequest, type Tier } from './contract.ts';
import { configFromEnv, installedModels } from './ollama.ts';
import { replyFor } from './reply.ts';
import { readSketch } from './sketch.ts';

// ─── theworld 백엔드 (docs/adr/0006-backend-and-llm.md) ──────────────────────
// 지금은 LLM 관문 하나다. 시뮬레이션은 아직 프론트에 있고, 여기는 "말을 짓는" 일만 받는다.
// 의존성 0 — node:http와 fetch만 쓴다. Node 24가 .ts를 그대로 돌린다.

const PORT = Number(process.env.PORT ?? 8787);
const MODELS: Record<Tier, string> = {
  small: process.env.MODEL_SMALL ?? 'qwen3.5:9b',
  good: process.env.MODEL_GOOD ?? 'qwen3.8:27b',
};
const cfg = configFromEnv();
const MAX_BODY = 512 * 1024;   // 240px PNG dataURL이 실린다

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
  let s = '';
  req.on('data', (c: Buffer) => { s += c; if (s.length > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => resolve(s));
  req.on('error', reject);
});

/** 요청이 계약대로인지. 틀리면 이유 한 줄. */
function validate(b: unknown): ReplyRequest | string {
  if (!b || typeof b !== 'object') return 'body must be an object';
  const o = b as Record<string, unknown>;
  if (o.tier !== 'small' && o.tier !== 'good') return 'tier must be small|good';
  const a = o.agent as Record<string, unknown> | undefined;
  if (!a || typeof a.name !== 'string') return 'agent.name required';
  const s = o.situation as Record<string, unknown> | undefined;
  if (!s || typeof s.where !== 'string' || typeof s.doing !== 'string' || typeof s.hhmm !== 'string') return 'situation.where/doing/hhmm required';
  if (!Array.isArray(o.texts) || !o.texts.length || !o.texts.every(t => typeof t === 'string')) return 'texts must be a non-empty string[]';
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fb);
  const recent = Array.isArray(o.recent)
    ? o.recent.filter((m): m is { from: 'me' | 'agent'; text: string } => !!m && (m.from === 'me' || m.from === 'agent') && typeof m.text === 'string').slice(-12)
    : [];
  return {
    tier: o.tier,
    agent: { name: a.name, traits: strs(a.traits), likes: strs(a.likes), dislikes: strs(a.dislikes) },
    situation: {
      where: s.where, doing: s.doing, hhmm: s.hhmm,
      lateWhy: typeof s.lateWhy === 'string' ? s.lateWhy : null,
      mood: num(s.mood, 60), fatigue: num(s.fatigue, 30),
      worry: typeof s.worry === 'string' && (WORRY_KEYS as readonly string[]).includes(s.worry) ? (s.worry as ReplyRequest['situation']['worry']) : null,
    },
    recent,
    texts: (o.texts as string[]).slice(-8).map(t => t.slice(0, 200)),
  };
}

/** 그림 요청이 계약대로인지. */
function validateSketch(b: unknown): SketchReadRequest | string {
  if (!b || typeof b !== 'object') return 'body must be an object';
  const o = b as Record<string, unknown>;
  if (o.tier !== 'small' && o.tier !== 'good') return 'tier must be small|good';
  if (typeof o.sketch !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(o.sketch)) return 'sketch must be an image dataURL';
  if (typeof o.category !== 'string') return 'category required';
  if (!Array.isArray(o.options) || !o.options.length || o.options.length > 8) return 'options must have 1-8 items';
  const options = o.options.map(x => x as Record<string, unknown>);
  if (!options.every(x => typeof x.id === 'string' && typeof x.title === 'string')) return 'option.id/title required';
  return {
    tier: o.tier, sketch: o.sketch, category: o.category,
    options: options.map(x => ({ id: x.id as string, title: (x.title as string).slice(0, 80), placeName: typeof x.placeName === 'string' ? x.placeName.slice(0, 40) : '', placeType: typeof x.placeType === 'string' ? x.placeType : '' })),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (req.method === 'OPTIONS') return json(res, 204, null);
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/api/models') {
    const have = await installedModels(cfg);
    const body: ModelsResponse = {
      ollama: have !== null,
      tiers: { small: { model: MODELS.small, installed: have?.has(MODELS.small) ?? false }, good: { model: MODELS.good, installed: have?.has(MODELS.good) ?? false } },
    };
    return json(res, 200, body);
  }
  if (req.method === 'POST' && url.pathname === '/api/chat/reply') {
    let parsed: unknown;
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: `bad json: ${(e as Error).message}` }); }
    const v = validate(parsed);
    if (typeof v === 'string') return json(res, 400, { error: v });
    try {
      const out = await replyFor(v, MODELS[v.tier], cfg);
      console.log(`[reply] ${out.model} ${out.ms}ms ${JSON.stringify(v.texts)} → ${JSON.stringify(out.text)}${out.worry ? ` worry=${out.worry}` : ''}${out.callMe ? ' callMe' : ''}`);
      return json(res, 200, out);
    } catch (e) {
      console.warn(`[reply] failed: ${(e as Error).message}`);
      return json(res, 502, { error: (e as Error).message });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/sketch/read') {
    let parsed: unknown;
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: `bad json: ${(e as Error).message}` }); }
    const v = validateSketch(parsed);
    if (typeof v === 'string') return json(res, 400, { error: v });
    try {
      const out = await readSketch(v, MODELS[v.tier], cfg);
      console.log(`[sketch] ${out.model} ${out.ms}ms seen=${JSON.stringify(out.seen)} cat=${out.category ?? 'null'} → ${out.optionId ?? 'null'} of [${v.options.map(o => o.title).join(' | ')}]`);
      return json(res, 200, out);
    } catch (e) {
      console.warn(`[sketch] failed: ${(e as Error).message}`);
      return json(res, 502, { error: (e as Error).message });
    }
  }
  return json(res, 404, { error: 'not found' });
}

createServer((req, res) => { handle(req, res).catch(e => json(res, 500, { error: (e as Error).message })); })
  .listen(PORT, () => console.log(`theworld backend on http://localhost:${PORT}  (ollama ${cfg.url}; small=${MODELS.small} good=${MODELS.good})`));
