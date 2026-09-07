import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WORRY_KEYS, type ModelsResponse, type ReplyRequest, type SketchReadRequest, type Tier, type TripPlanRequest } from './contract.ts';
import { configFromEnv, installedModels } from './ollama.ts';
import { replyFor } from './reply.ts';
import { readSketch } from './sketch.ts';
import { ThinPlanError, planTrip } from './trip.ts';
import { NoApiKeyError } from './search.ts';
import { planBlocks } from './plan.ts';
import { callTurn } from './call.ts';
import { PLAN_BLOCKS, PLAN_CATEGORIES, TRIP_PLACE_TYPES, type CallTurnRequest, type PlanRequest } from './contract.ts';

// ─── theworld 백엔드 (docs/adr/0006-backend-and-llm.md) ──────────────────────
// 지금은 LLM 관문 하나다. 시뮬레이션은 아직 프론트에 있고, 여기는 "말을 짓는" 일만 받는다.
// 의존성 0 — node:http와 fetch만 쓴다. Node 24가 .ts를 그대로 돌린다.

const PORT = Number(process.env.PORT ?? 8787);
const MODELS: Record<Tier, string> = {
  small: process.env.MODEL_SMALL ?? 'qwen3.5:9b',
  good: process.env.MODEL_GOOD ?? 'qwen3.8:27b',
};
const cfg = configFromEnv();
/** 여행지 추출 (ADR-0009). 모델은 요청의 tier를 따르되 TRIP_MODEL이 있으면 그것으로 고정한다. */
const tripConfig = (tier: Tier) => ({ model: process.env.TRIP_MODEL || MODELS[tier], modelTimeoutMs: Number(process.env.TRIP_MODEL_TIMEOUT_MS ?? 90_000) });
/** 하루 계획 (ADR-0010): 블록 하나·하루 전체의 제한 시간. */
const PLAN_ONE_TIMEOUT_MS = Number(process.env.PLAN_ONE_TIMEOUT_MS ?? 20_000);
const PLAN_DAY_TIMEOUT_MS = Number(process.env.PLAN_DAY_TIMEOUT_MS ?? 120_000);
/** 허용 origin. 기본 `*`는 편의용 — 검색 키를 서버가 쓰므로 아무 탭이나 한도를 쓸 수 있다. 개발 서버 주소로 좁히는 걸 권한다. */
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
const MAX_BODY = 512 * 1024;   // 240px PNG dataURL이 실린다

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': CORS_ORIGIN, 'access-control-allow-headers': 'content-type' });
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

/** 여행지 요청이 계약대로인지. */
function validateTrip(b: unknown): TripPlanRequest | string {
  if (!b || typeof b !== 'object') return 'body must be an object';
  const o = b as Record<string, unknown>;
  if (o.tier !== 'small' && o.tier !== 'good') return 'tier must be small|good';
  const city = typeof o.city === 'string' ? o.city.normalize('NFC').trim() : '';
  if (!city || city.length > 40) return 'city must be 1-40 chars';
  return { tier: o.tier, city };
}

/** 계획 요청이 계약대로인지. 크기 상한(장소 120·블록 6)을 넘는 건 자른다. */
function validatePlan(b: unknown): PlanRequest | string {
  if (!b || typeof b !== 'object') return 'body must be an object';
  const o = b as Record<string, unknown>;
  if (o.tier !== 'small' && o.tier !== 'good') return 'tier must be small|good';
  const a = o.agent as Record<string, unknown> | undefined;
  if (!a || typeof a.name !== 'string') return 'agent.name required';
  const strs = (v: unknown, cap = 12) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(s => s.slice(0, 40)).slice(0, cap) : []);
  const day = o.day as Record<string, unknown> | undefined;
  if (!day || typeof day.dateKey !== 'string' || typeof day.weekday !== 'string') return 'day.dateKey/weekday required';
  const city = o.city as Record<string, unknown> | undefined;
  if (!city || typeof city.key !== 'string' || typeof city.nameKo !== 'string') return 'city.key/nameKo required';
  const st = o.status as Record<string, unknown> | undefined;
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fb);
  const places = (Array.isArray(o.places) ? o.places : []).map(p => p as Record<string, unknown>)
    .filter(p => typeof p.id === 'string' && typeof p.name === 'string' && (TRIP_PLACE_TYPES as readonly string[]).concat('home', 'friend_home', 'office', 'school').includes(p.type as string))
    .slice(0, 120)
    .map(p => ({ id: p.id as string, name: (p.name as string).slice(0, 40), type: p.type as PlanRequest['places'][number]['type'], area: typeof p.area === 'string' ? p.area.slice(0, 20) : '' }));
  if (!places.length) return 'places must be a non-empty array';
  const ids = new Set(places.map(p => p.id));
  const blocks = (Array.isArray(o.blocks) ? o.blocks : []).map(x => x as Record<string, unknown>)
    .filter(x => (PLAN_BLOCKS as readonly string[]).includes(x.id as string))
    .slice(0, 6)
    .map(x => ({
      id: x.id as PlanRequest['blocks'][number]['id'],
      category: (PLAN_CATEGORIES as readonly string[]).includes(x.category as string) ? (x.category as PlanRequest['blocks'][number]['category']) : null,
      from: typeof x.from === 'string' ? x.from.slice(0, 40) : '',
      avoid: strs(x.avoid, 12).filter(id => ids.has(id)),
      ...(Array.isArray(x.previous) ? { previous: strs(x.previous, 6) } : {}),
    }));
  if (!blocks.length) return 'blocks must have 1-6 known block ids';
  return {
    tier: o.tier,
    agent: { name: a.name.slice(0, 20), traits: strs(a.traits), likes: strs(a.likes), dislikes: strs(a.dislikes) },
    day: { dateKey: day.dateKey.slice(0, 10), weekday: day.weekday.slice(0, 4) },
    city: { key: city.key.slice(0, 40), nameKo: city.nameKo.slice(0, 20), home: city.home === true },
    status: { money: num(st?.money, 0), fatigue: Math.max(0, Math.min(100, num(st?.fatigue, 30))), mood: Math.max(0, Math.min(100, num(st?.mood, 60))) },
    worry: typeof o.worry === 'string' && (WORRY_KEYS as readonly string[]).includes(o.worry) ? (o.worry as PlanRequest['worry']) : null,
    visited: strs(o.visited, 10),
    places,
    blocks,
  };
}

/** 통화 턴 요청이 계약대로인지. */
function validateCall(b: unknown): CallTurnRequest | string {
  if (!b || typeof b !== 'object') return 'body must be an object';
  const o = b as Record<string, unknown>;
  if (o.tier !== 'small' && o.tier !== 'good') return 'tier must be small|good';
  const a = o.agent as Record<string, unknown> | undefined;
  if (!a || typeof a.name !== 'string') return 'agent.name required';
  const s = o.situation as Record<string, unknown> | undefined;
  if (!s || typeof s.where !== 'string' || typeof s.doing !== 'string' || typeof s.hhmm !== 'string') return 'situation.where/doing/hhmm required';
  if (!['worry', 'ask', 'friction', 'out'].includes(o.why as string)) return 'why must be worry|ask|friction|out';
  if (o.user !== null && typeof o.user !== 'string') return 'user must be string|null';
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fb);
  const transcript = Array.isArray(o.transcript)
    ? o.transcript.filter((m): m is { from: 'me' | 'agent'; text: string } => !!m && (m.from === 'me' || m.from === 'agent') && typeof m.text === 'string').slice(-20).map(m => ({ from: m.from, text: m.text.slice(0, 200) }))
    : [];
  return {
    tier: o.tier,
    agent: { name: a.name.slice(0, 20), traits: strs(a.traits), likes: strs(a.likes), dislikes: strs(a.dislikes) },
    situation: { where: s.where.slice(0, 40), doing: s.doing.slice(0, 40), hhmm: s.hhmm.slice(0, 5), mood: num(s.mood, 60), fatigue: num(s.fatigue, 30) },
    why: o.why as CallTurnRequest['why'],
    worry: typeof o.worry === 'string' && (WORRY_KEYS as readonly string[]).includes(o.worry) ? (o.worry as CallTurnRequest['worry']) : null,
    transcript,
    user: o.user === null ? null : (o.user as string).slice(0, 200),
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
      console.log(`[reply] ${out.model} ${out.ms}ms ${JSON.stringify(v.texts)} → ${JSON.stringify(out.text)}${out.worry ? ` worry=${out.worry}` : ''}${out.callMe ? ' callMe' : ''}${out.trip ? ` trip=${out.trip}` : ''}`);
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
  if (req.method === 'POST' && url.pathname === '/api/call/turn') {
    let parsed: unknown;
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: `bad json: ${(e as Error).message}` }); }
    const v = validateCall(parsed);
    if (typeof v === 'string') return json(res, 400, { error: v });
    // ndjson 스트림 — 문장이 완성될 때마다 한 줄. 사용자가 말을 끊으면 프론트가 연결을 닫고, 그 신호로 Ollama 생성도 멈춘다
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'access-control-allow-origin': CORS_ORIGIN, 'access-control-allow-headers': 'content-type' });
    const ctl = new AbortController();
    req.on('close', () => ctl.abort());
    const t0 = Date.now();
    try {
      const lines = await callTurn(v, MODELS[v.tier], cfg, s => res.write(JSON.stringify({ s }) + '\n'), ctl.signal);
      res.end(JSON.stringify({ done: true, model: MODELS[v.tier], ms: Date.now() - t0 }) + '\n');
      console.log(`[call] ${MODELS[v.tier]} ${Date.now() - t0}ms ${v.why} ${JSON.stringify(v.user)} → ${JSON.stringify(lines)}`);
    } catch (e) {
      if (!ctl.signal.aborted) console.warn(`[call] failed: ${(e as Error).message}`);
      try { res.end(JSON.stringify({ error: (e as Error).message }) + '\n'); } catch { /* 닫힘 */ }
    }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/plan/options') {
    let parsed: unknown;
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: `bad json: ${(e as Error).message}` }); }
    const v = validatePlan(parsed);
    if (typeof v === 'string') return json(res, 400, { error: v });
    try {
      // 블록 하나면 카드 고르는 몇 초, 하루면 넉넉히 — 프론트의 기다림도 그에 맞춘다 (docs/CONTRACT.md)
      const out = await planBlocks(v, MODELS[v.tier], cfg, v.blocks.length === 1 ? PLAN_ONE_TIMEOUT_MS : PLAN_DAY_TIMEOUT_MS);
      console.log(`[plan] ${out.model} ${out.ms}ms ${v.city.key} ${v.blocks.map(b => `${b.id}:${b.category ?? '?'}`).join(',')} → ${out.blocks.map(b => `${b.id}:${b.category}[${b.options.map(o => o.title).join(' | ')}]`).join(' ; ') || 'nothing'}`);
      return json(res, 200, out);
    } catch (e) {
      console.warn(`[plan] failed: ${(e as Error).message}`);
      return json(res, 502, { error: (e as Error).message });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/trip/plan') {
    let parsed: unknown;
    try { parsed = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: `bad json: ${(e as Error).message}` }); }
    const v = validateTrip(parsed);
    if (typeof v === 'string') return json(res, 400, { error: v });
    try {
      const out = await planTrip(v, cfg, tripConfig(v.tier));
      console.log(`[trip] ${v.city} → ${out.city.key} ${out.places.length} places ${out.ms}ms${out.cached ? ' cached' : ` ${out.model}`}`);
      return json(res, 200, out);
    } catch (e) {
      const err = e as Error;
      console.warn(`[trip] ${v.city} failed: ${err.message}`);
      const status = err instanceof NoApiKeyError ? 503 : err instanceof ThinPlanError ? 422 : 502;
      return json(res, status, { error: err.message });
    }
  }
  return json(res, 404, { error: 'not found' });
}

createServer((req, res) => { handle(req, res).catch(e => json(res, 500, { error: (e as Error).message })); })
  .listen(PORT, () => console.log(`theworld backend on http://localhost:${PORT}  (ollama ${cfg.url}; small=${MODELS.small} good=${MODELS.good})`));
