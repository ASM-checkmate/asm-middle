import type { ActivityOption, Category, CityInfo, Memory, Phase, Place, WorryKey } from './types';
import { placeById } from './places';
import type { Status } from './status';
import { pickupRule } from './call';
import { hhmmIn } from './tz';
import { LATE_WHY, whereOf, type ChatMsg } from './chat';

// ─── LLM 관문 (docs/adr/0006-backend-and-llm.md) ─────────────────────────────
// 백엔드(backend/)에 "이 묶음에 뭐라고 답할지"만 묻는다. **언제 읽고 언제 답할지는 여전히 sim/chat.ts의 규칙**이고,
// 여기서는 그 답장의 말만 갈아끼운다. 서버가 없거나 늦으면 규칙 기반 답장이 그대로 남는다 — 앱은 백엔드 없이도 돈다.

export type LlmTier = 'off' | 'small' | 'good';
const TIER_KEY = 'theworld.llm.v1';

/** 지금 고른 단계. 기본은 off — 백엔드가 없는 사람도 앱이 그대로 돌아야 한다. */
export function getTier(): LlmTier {
  try { const v = localStorage.getItem(TIER_KEY); return v === 'small' || v === 'good' ? v : 'off'; } catch { return 'off'; }
}
export function setTier(t: LlmTier) { try { localStorage.setItem(TIER_KEY, t); } catch { /* ignore */ } }

/** 백엔드 계약 (docs/CONTRACT.md의 ReplyRequest). backend/src/contract.ts와 같은 모양을 복사해 둔다. */
export interface ReplyRequest {
  tier: Exclude<LlmTier, 'off'>;
  agent: { name: string; traits: string[]; likes: string[]; dislikes: string[] };
  situation: { where: string; doing: string; hhmm: string; lateWhy: string | null; mood: number; fatigue: number; worry: Exclude<WorryKey, 'none'> | null };
  recent: { from: 'me' | 'agent'; text: string }[];
  texts: string[];
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
  };
}

/**
 * 백엔드에 답장을 묻는다. 실패(서버 없음·502·제한 시간)는 **null** — 호출자는 규칙 기반 답장을 그대로 둔다.
 *
 * @param req 요청
 * @param timeoutMs 이보다 늦으면 포기한다 (규칙 답장이 화면에 뜨기 전에 결정을 내려야 한다)
 */
export async function fetchReply(req: ReplyRequest, timeoutMs = 30_000, signal?: AbortSignal): Promise<ReplyResponse | null> {
  try {
    const res = await fetch('/api/chat/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = (await res.json()) as ReplyResponse;
    if (typeof j.callMe !== 'boolean' || !(j.text === null || typeof j.text === 'string')) return null;
    return { ...j, trip: typeof j.trip === 'string' && j.trip.trim() ? j.trip.trim() : null };
  } catch {
    return null;
  }
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
export async function fetchSketchRead(req: SketchReadRequest, timeoutMs = 40_000): Promise<SketchReadResponse | null> {
  try {
    const res = await fetch('/api/sketch/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = (await res.json()) as SketchReadResponse;
    return (j.optionId === null || typeof j.optionId === 'string') && typeof j.seen === 'string' && (j.category === null || typeof j.category === 'string') ? j : null;
  } catch {
    return null;
  }
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
export async function fetchTripPlan(req: TripPlanRequest, timeoutMs = 120_000): Promise<TripPlanResponse | null> {
  try {
    const res = await fetch('/api/trip/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = (await res.json()) as TripPlanResponse;
    return j && j.city && typeof j.city.key === 'string' && Array.isArray(j.places) ? j : null;
  } catch {
    return null;
  }
}
