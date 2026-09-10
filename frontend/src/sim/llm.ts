import type { ActivityOption, BlockId, Category, CityInfo, Memory, Phase, Place, WorryKey, Look } from './types';
import { isLook } from './types';
import { PLACES, cityNameKo, placeById } from './places';
import type { Status } from './status';
import { pickupRule } from './call';
import { hhmmIn, weekdayKoIn } from './tz';
import { LATE_WHY, whereOf, type ChatMsg } from './chat';
import { api, authHeaders } from './api';

// ─── LLM 관문 (docs/adr/0006-backend-and-llm.md · BACKEND-CONTRACT §3.2) ─────────────────────────────
// 백엔드(backend/)에 "이 묶음에 뭐라고 답할지"만 묻는다. **언제 읽고 언제 답할지는 여전히 sim/chat.ts의 규칙**이고,
// 여기서는 그 답장의 말만 갈아끼운다. 서버가 없거나 늦으면 규칙 기반 답장이 그대로 남는다 — 앱은 백엔드 없이도 돈다.
// 세 요청은 sim/api.ts의 공통 관문을 지난다 (베이스 URL·Bearer 토큰·제한 시간을 한 곳에서).

/** 답장 제한 시간 — 서버의 Ollama 25s보다 넉넉히 */
export const REPLY_TIMEOUT_MS = 30_000;
/** 그림 읽기 제한 시간 */
export const SKETCH_TIMEOUT_MS = 40_000;
/** 여행지 찾기 제한 시간 — 검색·모델·지오코딩(서버 데드라인 100s) */
export const TRIP_TIMEOUT_MS = 120_000;

/**
 * 세 관문의 공통: POST 한 번, 실패(서버 없음·4xx/5xx·제한 시간·모양 불일치)는 전부 **null** — 호출부 계약 유지.
 *
 * @param valid 응답 모양 검증 (통과 못 하면 null)
 */
async function ask<T>(path: string, body: unknown, timeoutMs: number, valid: (j: T) => boolean, signal?: AbortSignal): Promise<T | null> {
  try {
    const j = await api<T>(path, { method: 'POST', body, timeoutMs, signal });
    return j && valid(j) ? j : null;
  } catch {
    return null;
  }
}

/** `GET /api/models` (docs/CONTRACT.md의 ModelsResponse) — 어느 단계의 모델이 깔려 있나. 개발 패널이 본다 */
export interface ModelsResponse { tiers: Record<Exclude<LlmTier, 'off'>, { model: string; installed: boolean }>; ollama: boolean }
/** 실패는 null (서버 없음). */
export async function fetchModels(timeoutMs = 4_000): Promise<ModelsResponse | null> {
  try {
    const j = await api<ModelsResponse>('/api/models', { auth: false, timeoutMs });
    return j && j.tiers && typeof j.tiers.small?.model === 'string' && typeof j.tiers.good?.model === 'string' ? j : null;
  } catch {
    return null;
  }
}

export type LlmTier = 'off' | 'small' | 'good';
const TIER_KEY = 'theworld.llm.v1';

/** 지금 고른 단계. 기본은 off — 백엔드가 없는 사람도 앱이 그대로 돌아야 한다. */
export function getTier(): LlmTier {
  try { const v = localStorage.getItem(TIER_KEY); return v === 'small' || v === 'good' ? v : 'off'; } catch { return 'off'; }
}
export function setTier(t: LlmTier) { try { localStorage.setItem(TIER_KEY, t); } catch { /* ignore */ } }

/** 백엔드 계약 (docs/CONTRACT.md의 ReplyRequest). 옛 Node 백엔드 contract.ts(커밋 0298e8d)와 같은 모양을 복사해 둔다. */
export interface ReplyRequest {
  tier: Exclude<LlmTier, 'off'>;
  agent: { name: string; traits: string[]; likes: string[]; dislikes: string[] };
  situation: { where: string; doing: string; hhmm: string; lateWhy: string | null; mood: number; fatigue: number; worry: Exclude<WorryKey, 'none'> | null };
  recent: { from: 'me' | 'agent'; text: string }[];
  texts: string[];
  /** 묶음 id — 서버는 같은 (사용자, batch)의 진행 중 호출을 새 호출이 오면 취소한다 (BACKEND-CONTRACT §2.4) */
  batch?: string;
}
export interface ReplyResponse {
  text: string | null;
  worry: Exclude<WorryKey, 'none'> | null;
  callMe: boolean;
  /** 사용자가 가자고 한 여행지 (한국어 도시 이름). 여행 얘기가 아니면 null (ADR-0009) */
  trip: string | null;
  model: string;
  ms: number;
}

/** 며칠 안의 고민만 넘긴다 (메모리의 worry가 이보다 오래됐으면 잊은 걸로). */
const WORRY_FRESH_MS = 3 * 24 * 3600_000;
/** 프롬프트에 넣는 최근 대화 줄 수. */
const RECENT_N = 10;

/**
 * 스토어 상태에서 요청 하나를 만든다. 순수 함수.
 *
 * @param texts 이번 묶음의 내 말들
 * @param s 지금 상태 (phase·status·memory·messages·now)
 * @param tier 쓸 단계
 * @param batch 이번 묶음 id — 그 묶음의 말은 `recent`에서 뺀다
 */
export function requestOf(texts: string[], s: { phase: Phase; status: Status; memory: Memory; messages: ChatMsg[]; now: number }, tier: Exclude<LlmTier, 'off'>, batch: string): ReplyRequest {
  const { where, doing } = whereOf(s.phase);
  const { ok, block } = pickupRule(s.phase);
  const worry = s.memory.worry && s.memory.worry.key !== 'none' && s.now - s.memory.worry.at < WORRY_FRESH_MS ? s.memory.worry.key : null;
  const recent = s.messages
    .filter(m => m.at <= s.now && m.batch !== batch && m.id !== `${batch}:r`)
    .slice(-RECENT_N)
    .map(m => ({ from: m.from, text: m.text }));
  return {
    tier,
    agent: { name: s.memory.name, traits: s.memory.traits, likes: s.memory.likes, dislikes: s.memory.dislikes },
    situation: { where, doing, hhmm: hhmmIn(s.now, s.phase.tz), lateWhy: ok ? null : LATE_WHY[block ?? 'quiet'], mood: Math.round(s.status.mood), fatigue: Math.round(s.status.fatigue), worry },
    recent,
    texts,
    batch,
  };
}

/**
 * 백엔드에 답장을 묻는다. 실패(서버 없음·502·제한 시간)는 **null** — 호출자는 규칙 기반 답장을 그대로 둔다.
 *
 * @param req 요청
 * @param timeoutMs 이보다 늦으면 포기한다 (규칙 답장이 화면에 뜨기 전에 결정을 내려야 한다)
 */
export async function fetchReply(req: ReplyRequest, timeoutMs = REPLY_TIMEOUT_MS, signal?: AbortSignal): Promise<ReplyResponse | null> {
  const j = await ask<ReplyResponse>('/api/chat/reply', req, timeoutMs, r => typeof r.callMe === 'boolean' && (r.text === null || typeof r.text === 'string'), signal);
  return j ? { ...j, trip: typeof j.trip === 'string' && j.trip.trim() ? j.trip.trim() : null } : null;
}

/** 연달아 보내는 동안 기다리는 시간 (실제 ms). 세 줄을 치는 사이마다 모델을 부르면 27B가 세 번 돈다. */
const DEBOUNCE_MS = 1_500;
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; ctl: AbortController }>();

/**
 * 묶음 하나에 대한 요청을 예약한다. 같은 묶음에 앞서 예약·진행 중인 요청은 취소한다 — 답은 마지막 묶음에만
 * 필요하다 (Ollama는 연결이 끊기면 생성을 멈춘다).
 *
 * @param batch 묶음 id
 * @param req 요청
 * @param budgetMs 규칙 답장이 뜨기 전까지의 여유 (실제 ms)
 * @param onResult 답이 오면 (실패·취소면 부르지 않는다)
 */
export function scheduleReply(batch: string, req: ReplyRequest, budgetMs: number, onResult: (r: ReplyResponse) => void) {
  const prev = pending.get(batch);
  if (prev) { clearTimeout(prev.timer); prev.ctl.abort(); }
  const ctl = new AbortController();
  const timer = setTimeout(() => {
    void fetchReply(req, Math.max(2_000, budgetMs - DEBOUNCE_MS), ctl.signal).then(r => {
      if (pending.get(batch)?.ctl === ctl) pending.delete(batch);
      if (r && !ctl.signal.aborted) onResult(r);
    });
  }, DEBOUNCE_MS);
  pending.set(batch, { timer, ctl });
}

// ─── 사진 → 겉모습 (ADR-0019) ──────────────────────────────────────────────────

/** docs/CONTRACT.md의 POST /api/character/look 응답 */
export interface LookResponse { look: Look; seen: string; model: string; ms: number }
const LOOK_TIMEOUT_MS = 60_000;
/**
 * 사진 하나를 보내 캐릭터 옵션 여섯 개를 받는다. 실패는 null. 작은 모델은 피부색을 자주 틀리므로 tier는 good이 기본이다 (계약 참고).
 * @param photo 512px 안쪽으로 줄인 JPEG dataURL (본문 상한 1.5 MB)
 */
export async function fetchLook(photo: string, tier: Exclude<LlmTier, 'off'> = 'good', timeoutMs = LOOK_TIMEOUT_MS): Promise<LookResponse | null> {
  return ask<LookResponse>('/api/character/look', { tier, photo }, timeoutMs, j => isLook(j.look) && typeof j.seen === 'string');
}

// ─── 그림 읽기 (ADR-0007) ─────────────────────────────────────────────────────

/** 백엔드 계약 (docs/CONTRACT.md의 SketchReadRequest). */
export interface SketchReadRequest {
  tier: Exclude<LlmTier, 'off'>;
  sketch: string;
  category: string;
  options: { id: string; title: string; placeName: string; placeType: string }[];
}
export interface SketchReadResponse { optionId: string | null; seen: string; category: Exclude<Category, 'sleep'> | null; model: string; ms: number }

/** 그 블록의 카드들로 요청을 만든다. 순수 함수. */
export function sketchRequestOf(sketch: string, category: string, options: ActivityOption[], tier: Exclude<LlmTier, 'off'>): SketchReadRequest {
  return {
    tier, sketch, category,
    options: options.map(o => { const pl = placeById(o.placeId); return { id: o.id, title: o.title, placeName: pl.name, placeType: pl.type }; }),
  };
}

/**
 * 백엔드에 그림을 읽어 달라고 한다. 실패는 null — 호출자는 못 읽은 것으로 두고 시드로 고른다.
 * 그림을 넘긴 직후에 부른다 (블록 시작은 동기라 그때 기다릴 수 없다).
 */
export async function fetchSketchRead(req: SketchReadRequest, timeoutMs = SKETCH_TIMEOUT_MS): Promise<SketchReadResponse | null> {
  return ask<SketchReadResponse>('/api/sketch/read', req, timeoutMs, j => (j.optionId === null || typeof j.optionId === 'string') && typeof j.seen === 'string' && (j.category === null || typeof j.category === 'string'));
}

/** 모델을 미리 올려 둔다 (ADR-0011). 벨이 울릴 때·대화 실을 열 때 — 첫마디가 모델 로드를 기다리지 않게. 실패는 조용히. */
export function warmModel(tier: Exclude<LlmTier, 'off'>) {
  void fetch('/api/warm', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ tier }), signal: AbortSignal.timeout(60_000) }).catch(() => {});
}

// ─── 여행지 찾기 (ADR-0009) ───────────────────────────────────────────────────
// "교토 가자"라고 하면 백엔드가 웹에서 그 도시의 장소를 찾아 "도시 팩"으로 돌려준다. 프론트는 그것을
// places.ts에 등록할 뿐이고, 여행 카드·이동·도착지의 하루는 규칙 엔진이 그대로 만든다.

/** 백엔드 계약 (docs/CONTRACT.md의 TripPlanRequest/Response). */
export interface TripPlanRequest { tier: Exclude<LlmTier, 'off'>; city: string }
export interface TripPlanResponse {
  city: CityInfo;
  places: Place[];
  /** 근거가 된 검색 결과 URL들 */
  sources: string[];
  cached: boolean;
  model: string;
  ms: number;
}

/**
 * 백엔드에 도시 팩을 부탁한다. 검색·모델·지오코딩을 거치므로 1~2분 걸린다 (캐시되면 즉시).
 * 실패(서버 없음·키 없음·얇은 팩·제한 시간)는 **null** — 호출자는 "잘 안 됐어" 한 줄을 남긴다.
 *
 * @param req 요청
 * @param timeoutMs 이보다 늦으면 포기한다
 */
export async function fetchTripPlan(req: TripPlanRequest, timeoutMs = TRIP_TIMEOUT_MS): Promise<TripPlanResponse | null> {
  return ask<TripPlanResponse>('/api/trip/plan', req, timeoutMs, j => !!j.city && typeof j.city.key === 'string' && Array.isArray(j.places));
}

// ─── 하루 계획 (ADR-0010) ─────────────────────────────────────────────────────
// 블록마다 "무엇을 할지" 카드 3장을 백엔드의 모델이 짓는다. 언제 시작하고 어디를 거쳐 가는지, 돈·피로에 막히는지는
// 여전히 규칙(review·timeline)이 본다. 서버가 없거나 늦으면 규칙 카드 — 앱은 백엔드 없이도 돈다.

/** 백엔드 계약 (docs/CONTRACT.md의 PlanRequest/Response). backend/src/contract.ts와 같은 모양을 복사해 둔다. */
export type PlanCategory = Exclude<Category, 'sleep' | 'travel'>;
export interface PlanBlockRequest { id: BlockId; category: PlanCategory | null; from: string; avoid: string[]; previous?: string[] }
export interface PlanRequest {
  tier: Exclude<LlmTier, 'off'>;
  agent: { name: string; traits: string[]; likes: string[]; dislikes: string[] };
  day: { dateKey: string; weekday: string };
  city: { key: string; nameKo: string; home: boolean };
  status: { money: number; fatigue: number; mood: number };
  worry: Exclude<WorryKey, 'none'> | null;
  visited: string[];
  places: { id: string; name: string; type: Place['type']; area: string }[];
  blocks: PlanBlockRequest[];
}
export interface PlanOption { placeId: string; title: string; reason: string; emoji: string }
export interface PlanBlock { id: BlockId; category: PlanCategory; options: PlanOption[] }
export interface PlanResponse { blocks: PlanBlock[]; model: string; ms: number }

/** 카탈로그에 넣을 최대 장소 수 — 프롬프트 한 장에 들어갈 만큼. */
const PLACES_CAP = 120;
/** 카탈로그에서 뺄 유형 — 이동의 허브지 활동 장소가 아니다. 친구 집은 동행 규칙(FRIENDS_SPEC)이 맡는다. */
const NOT_ACTIVITY: ReadonlySet<Place['type']> = new Set(['station', 'airport', 'port', 'friend_home']);

/**
 * 스토어 상태에서 계획 요청 하나를 만든다. 순수 함수. 카탈로그는 `city`의 장소들이다.
 *
 * @param blocks 지어 달라는 블록들 (범주가 정해졌으면 그 범주, 아니면 null)
 * @param s 지금 상태
 * @param tier 쓸 단계
 * @param city 블록들이 시작하는 도시 키
 */
export function planRequestOf(blocks: PlanBlockRequest[], s: { memory: Memory; status: Status; now: number; tz: string; dateKey: string }, tier: Exclude<LlmTier, 'off'>, city: string): PlanRequest {
  const homeCity = placeById(s.memory.homePlaceId).city;
  const places = PLACES.filter(p => p.city === city && !NOT_ACTIVITY.has(p.type)).slice(0, PLACES_CAP).map(p => ({ id: p.id, name: p.name, type: p.type, area: p.area }));
  const worry = s.memory.worry && s.memory.worry.key !== 'none' && s.now - s.memory.worry.at < WORRY_FRESH_MS ? s.memory.worry.key : null;
  const visited = s.memory.visited.slice(-6).map(v => { try { return placeById(v.placeId).name; } catch { return ''; } }).filter(Boolean);
  return {
    tier,
    agent: { name: s.memory.name, traits: s.memory.traits, likes: s.memory.likes, dislikes: s.memory.dislikes },
    day: { dateKey: s.dateKey, weekday: weekdayKoIn(s.now, s.tz) },
    city: { key: city, nameKo: cityNameKo(city), home: city === homeCity },
    status: { money: Math.round(s.status.money), fatigue: Math.round(s.status.fatigue), mood: Math.round(s.status.mood) },
    worry, visited, places, blocks,
  };
}

/**
 * 백엔드에 카드를 지어 달라고 한다. 실패(서버 없음·502·제한 시간)는 **null** — 호출자는 규칙 카드를 쓴다.
 *
 * @param req 요청
 * @param timeoutMs 이보다 늦으면 포기한다 (블록 하나는 짧게, 하루는 길게)
 */
export async function fetchPlan(req: PlanRequest, timeoutMs: number, signal?: AbortSignal): Promise<PlanResponse | null> {
  try {
    const res = await fetch('/api/plan/options', { method: 'POST', headers: authHeaders(), body: JSON.stringify(req), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = (await res.json()) as PlanResponse;
    return Array.isArray(j.blocks) ? j : null;
  } catch {
    return null;
  }
}
