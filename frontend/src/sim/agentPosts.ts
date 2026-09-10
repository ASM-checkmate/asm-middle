// ─── 에이전트 발행 엔진 (ADR-0021 결정 5·6 · SNS_SPEC §8·§9) ─────────────────────────────────────────
// 하루 1글. 에이전트가 "여유 있는 창"(카페·집에서 쉼·20분 이상 이동·자기 전 대기)에 그때까지의 컷으로 초안을 만들어 올린다.
// 기본은 묻지 않고 올리고 채팅에 "올렸어 · 보러 가기" 한 줄. **고민이 있을 때만**(§9의 여섯 조건, 주 2회 상한) 채팅으로 묻고,
// 답이 없으면 15분 뒤 그냥 올린다. 자기 전 대기창에서는 고민이 있어도 묻지 않고 올린다 (§8). 주인이 초안을 버린 날은 건너뛴다.
// 가상 친구(NPC)의 글은 내 폰이 만든다 — 걔들의 하루(agentDayPlan) 중 한 활동이 끝나는 시각에 컷을 굽고 `kind: 'npc'`로 올린다.
//
// 이 모듈은 순수 논리 + 굽기·저장이 주입되는 작은 드라이버다. 브라우저 API·.tsx를 직접 import하지 않는다 — node 하네스
// (scripts/sim-agentpost.test.mjs)가 그대로 돌린다. 스토어(sim/store.ts)가 tick마다 decidePost·tryPost를 굴리고 상태를 world에 적는다.
// 캡션·고민 문장은 규칙 기반이다 — TODO(ADR-0021 §영향): 모델 한 줄("왜 지금 올리는지")은 뒤로 미룬다. LLM은 여기서 부르지 않는다.
import type { Comic, DayKey, Friend, Look, Memory, Phase, PlaceType, ScheduledActivity, ShotCrop, ShotWin, UserShot } from './types';
import { DEFAULT_LOOK, LOOK_HAIR_STYLES, splitDayKey } from './types';
import type { FeedItem, PostCut, PostDraft, PostIn } from './posts';
import { MAX_CAPTION, MAX_CUTS, validPostCut } from './posts';
import { POST_CHOICES, type AgentRequest } from './requests';
import { AGENTS, agentById, agentDayPlan, agentNames, type Agent, type AgentActivity } from './agents';
import { crushTarget } from './affection';
import type { Encounters } from './timeline';
import { placeById, tzOf } from './places';
import { rng } from './rng';
import { DAY_MS } from './tz';
import { isShotId, newShotId } from '../photo/geometry';
import { poseFor, shortTitle } from '../screens/util';
import type { Pose } from '../character';

// ─── 상수 ──────────────────────────────────────────────────────────────────────
/** 물은 뒤 답이 없으면 그냥 올리기까지 (SNS_SPEC §8) */
export const ASK_DUE_MS = 15 * 60_000;
/** 한 주에 묻는 횟수 상한 (§9) */
export const ASKS_PER_WEEK = 2;
/** 초안에 넣는 컷 수 (§8 "3~4장") */
export const MAX_DRAFT_CUTS = 4;
/** 캡션 상한 — 글의 캡션(300자)보다 훨씬 짧게, 한 줄 */
export const MAX_DRAFT_CAPTION = 60;
/** "관심 있는 사람": 최근 7일 안에 그 사람 글에 좋아요 2번 이상 (§9 첫 줄) */
const LIKE_WINDOW_MS = 7 * DAY_MS;
const LIKE_MIN = 2;
const LIKES_KEPT = 20;
/** "막 친구 된 사람": 친구 된 지 24시간 안 */
const NEW_FRIEND_MS = DAY_MS;
/** "평소랑 다른 하루": 최근 14일의 만화에서 상위 3 범주에 오늘 범주가 없을 때 — 역사가 이만큼은 있어야 뜻이 있다 */
const UNUSUAL_LOOKBACK_MS = 14 * DAY_MS;
const UNUSUAL_MIN_HISTORY = 4;
/** 올리기 실패 뒤 다시 시도하기까지 (sim ms): 60s → 2m → … ≤ 15m */
export const POST_RETRY_BASE_MS = 60_000;
export const POST_RETRY_MAX_MS = 15 * 60_000;
/** 자기 전 창에서 안 올라간 컷을 기다려 주는 마지막 여유 — 이보다 하루 끝이 가까우면 올라간 컷만으로 올린다(없으면 건너뛴다) */
export const BEDTIME_GRACE_MS = 5 * 60_000;
/** 가상 친구 글의 로컬 문서 상한 (sns.ts가 같은 수를 쓴다) */
export const LOCAL_POSTS_CAP = 30;

// ─── 여유 있는 창 (§8) ────────────────────────────────────────────────────────────
export type RelaxedWindow = 'cafe' | 'home-rest' | 'transit' | 'bedtime';

/**
 * 지금이 글을 올려도 되는 여유 있는 창인가. 카페에 있을 때 · 집(숙소)에서 쉴 때 · 20분 넘는 이동 중 · 밤 블록의 대기(자기 전).
 * 아니면 null — 만화 보는 중·자는 중·바쁜 활동 중엔 올리지 않는다.
 */
export function relaxedWindow(phase: Phase): RelaxedWindow | null {
  switch (phase.kind) {
    case 'active': {
      const t = phase.act.place.type;
      if (t === 'cafe') return 'cafe';
      if ((t === 'home' || t === 'hotel') && phase.act.option.category === 'rest') return 'home-rest';
      return null;
    }
    case 'moving': return phase.act.journey.totalMin >= 20 ? 'transit' : null;
    case 'waiting': return phase.currentBlockId === 'night' ? 'bedtime' : null;
    default: return null;
  }
}

// ─── 상태 (world.agentPost) ───────────────────────────────────────────────────────
/** 오늘 올리려고 쥔 초안. `asked`면 채팅으로 물은 것(AgentRequest kind 'post', refId = draftId), 아니면 올리기를 기다리는 중 */
export interface PendingPost { draftId: string; dueAt: number; asked: boolean; draft: PostDraft }
export interface AgentPostState {
  /** 마지막으로 올린 날 — 오늘과 같으면 오늘은 끝 */
  lastPostDay?: DayKey;
  /** 마지막으로 올린 시각 — 다음 초안은 이 뒤의 컷으로 */
  lastPostAt?: number;
  pending?: PendingPost;
  /** 이번 주(월요일 dateKey) 물은 횟수 — 주 2회 상한 */
  asks: { week: string; count: number };
  /** 주인이 초안을 버린 날 — 그날은 건너뛴다 (§8) */
  skippedDay?: DayKey;
  /** 주인이 좋아요 누른 작성자 → 누른 시각들 (최근 7일 창으로 "관심 있는 사람"을 본다). sns.likeToggle → store.noteLike */
  likedAuthors: Record<string, number[]>;
}
export const emptyAgentPost = (): AgentPostState => ({ asks: { week: '', count: 0 }, likedAuthors: {} });

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** 저장본의 초안 검증 — 컷이 하나라도 틀리면 초안을 버린다 (posts.validPost와 같은 결) */
export function validDraft(raw: unknown): PostDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<PostDraft>;
  if (!str(d.id, 120) || !Array.isArray(d.cuts) || d.cuts.length < 1 || d.cuts.length > MAX_CUTS) return null;
  const cuts: PostCut[] = [];
  for (const c of d.cuts) { const v = validPostCut(c); if (!v) return null; cuts.push(v); }
  if (typeof d.caption !== 'string' || typeof d.place !== 'string' || typeof d.area !== 'string' || typeof d.city !== 'string' || !str(d.dateKey, 120)) return null;
  const out: PostDraft = {
    id: d.id, cuts, caption: d.caption.slice(0, MAX_CAPTION), place: d.place, area: d.area, city: d.city, dateKey: d.dateKey,
    companions: Array.isArray(d.companions) ? d.companions.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 16) : [],
  };
  if (str(d.category, 12)) out.category = d.category;
  if (str(d.reason, 200)) out.reason = d.reason;
  if (finite(d.dueAt)) out.dueAt = d.dueAt;
  return out;
}

/** 저장본 검증 — 모양이 틀린 칸은 빈 값으로 (store가 부팅 때 validShots처럼 부른다) */
export function validAgentPost(raw: unknown): AgentPostState {
  const out = emptyAgentPost();
  if (!raw || typeof raw !== 'object') return out;
  const a = raw as Partial<AgentPostState>;
  if (str(a.lastPostDay, 80)) out.lastPostDay = a.lastPostDay;
  if (finite(a.lastPostAt)) out.lastPostAt = a.lastPostAt;
  if (str(a.skippedDay, 80)) out.skippedDay = a.skippedDay;
  if (a.asks && typeof a.asks === 'object' && typeof a.asks.week === 'string' && finite(a.asks.count)) out.asks = { week: a.asks.week, count: Math.max(0, Math.floor(a.asks.count)) };
  if (a.likedAuthors && typeof a.likedAuthors === 'object') {
    for (const [id, v] of Object.entries(a.likedAuthors as Record<string, unknown>)) {
      if (!Array.isArray(v) || !str(id, 80)) continue;
      const ts = v.filter(finite).slice(-LIKES_KEPT);
      if (ts.length) out.likedAuthors[id] = ts;
    }
  }
  const p = a.pending;
  if (p && typeof p === 'object' && str(p.draftId, 120) && finite(p.dueAt) && typeof p.asked === 'boolean') {
    const draft = validDraft(p.draft);
    if (draft && draft.id === p.draftId) out.pending = { draftId: p.draftId, dueAt: p.dueAt, asked: p.asked, draft };
  }
  return out;
}

/** 주인이 그 사람 글에 좋아요를 눌렀다 — 시각을 적고 7일 지난 것은 버린다. 순수 함수 */
export function noteLikeIn(state: AgentPostState, authorId: string, now: number): AgentPostState {
  const kept = (state.likedAuthors[authorId] ?? []).filter(t => now - t < LIKE_WINDOW_MS);
  return { ...state, likedAuthors: { ...state.likedAuthors, [authorId]: [...kept, now].slice(-LIKES_KEPT) } };
}

/** ISO 주의 키 — 그 날이 든 주의 월요일 dateKey (책의 '주' 묶기와 같은 규칙, BookOverlay.weekStartOf) */
export function weekKeyOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const ms = Date.UTC(y, (m || 1) - 1, d || 1);
  const wd = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - wd * DAY_MS).toISOString().slice(0, 10);
}
/** 이번 주에 더 물어도 되나 (주 2회 상한) */
export const underAskCap = (state: AgentPostState, today: DayKey): boolean =>
  state.asks.week !== weekKeyOf(splitDayKey(today).dateKey) || state.asks.count < ASKS_PER_WEEK;

// ─── 초안 (§8) ────────────────────────────────────────────────────────────────────
export interface PostCtx {
  today: DayKey;
  now: number;
  timeline: ScheduledActivity[];
  book: Comic[];
  shots: UserShot[];
  memory: Memory;
  encounters: Encounters;
  isUploaded: (id: string) => boolean;
  agentPost: AgentPostState;
}

interface Candidate { cut: PostCut; t: number; comic: Comic; act: ScheduledActivity }

/** 오늘 끝난 활동(마지막 글 뒤)의 만화에서 픽셀이 있는 컷들 — 찍힌 시각 순. 사용자 컷은 만화가 shotId를 들고 있고(settle), 에이전트 컷은 열람 때 구워진다 */
function candidatesOf(ctx: PostCtx): Candidate[] {
  const since = ctx.agentPost.lastPostAt ?? Number.NEGATIVE_INFINITY;
  const out: Candidate[] = [];
  for (const a of ctx.timeline) {
    if (a.dayKey !== ctx.today || a.endAt > ctx.now || a.endAt <= since || a.option.category === 'sleep') continue;
    const comic = ctx.book.find(c => c.id === `c:${a.key}`);
    if (!comic) continue;
    comic.panels.forEach((p, i) => {
      if (i > 3) return;
      const win = i as ShotWin;
      // 만화에 없으면 샷 목록에서 (settle 뒤에 굽기가 끝난 사용자 컷)
      const shotId = p.shotId ?? (p.by === 'user' ? ctx.shots.find(s => s.actKey === a.key && s.win === win)?.shotId : undefined);
      if (!isShotId(shotId)) return;
      out.push({ cut: { shotId, actKey: a.key, win, by: p.by ?? 'agent' }, t: p.t, comic, act: a });
    });
  }
  return out.sort((x, y) => x.t - y.t);
}

// ─── 이름 지우기 (캡션에 NPC·친구 이름을 남기지 않는다 — store.stripNames와 같은 뜻, 캡션용으로 조사가 더 넓다) ──
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PARTICLES = '(?:이랑|랑|이가|가|이는|는|은|이도|도|와|과|네|한테|에게|의|을|를|하고|이)?';
/** 이름이 확실한 조사 — '하나'는 NPC 이름이자 낱말이라("쿠키 하나", "풍선 하나가") 문장 중간에서는 이것이 붙을 때만 이름으로 본다 */
const SURE_PARTICLES = '(?:이랑|랑|와|과|네|한테|에게)';
/**
 * 이름을 지운다. 그 만화에 같이 있던 사람(`withNames`)의 이름은 어디서든(조사 있든 없든), 그 밖의 NPC·친구 이름은 문장 머리(만화의
 * twist 줄은 "{friend}가 …"·"{friend}: …"로 시작한다 — 카메오도)거나 확실한 조사가 붙었을 때만. 낱말과 겹치는 이름을 문장 중간에서 뜯어내지 않기 위해서다.
 */
export function stripAgentNames(text: string, memory: Memory, withNames: string[] = []): string {
  const names = [...new Set([...agentNames(), ...memory.friends.map(f => f.name)])].filter(n => n.length >= 2);
  const sure = new Set(withNames);
  let out = text;
  for (const n of names) {
    const e = escapeRe(n);
    out = sure.has(n)
      ? out.replace(new RegExp(`${e}${PARTICLES}\\s*:?\\s*`, 'g'), '')
      : out.replace(new RegExp(`^\\s*${e}${PARTICLES}\\s*:?\\s*`), '').replace(new RegExp(`${e}${SURE_PARTICLES}\\s*`, 'g'), '');
  }
  return out.replace(/^[\s,.:·]+/, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * 캡션 한 줄 — 만화의 요약("카페 X에서 그림 그리기, 고양이 그린 건데 강아지냐고 물어봤다.")에서 고른다. 60자 이내, 이름 없음.
 * 머리와 twist를 따로 지운다 — 합친 뒤엔 twist의 이름이 문장 머리가 아니라서.
 * TODO(ADR-0021 §영향): 모델이 짓는 캡션은 뒤로 — 지금은 규칙.
 */
export function captionOf(comic: Comic, memory: Memory): string {
  const summary = comic.summary.replace(/[.\s]+$/, '');
  const i = summary.indexOf(', ');
  const withNames = comic.withNames ?? [];
  const head = stripAgentNames(i < 0 ? summary : summary.slice(0, i), memory, withNames);
  const twist = i < 0 ? '' : stripAgentNames(summary.slice(i + 2), memory, withNames);
  const r = rng(`caption:${comic.id}`);
  const options = [twist, twist && head ? `${head}. ${twist}` : '', head].filter(s => s.length >= 4 && s.length <= MAX_DRAFT_CAPTION);
  const picked = options.length ? r.pick(options) : stripAgentNames(comic.title, memory, withNames) || comic.title;
  return picked.slice(0, MAX_DRAFT_CAPTION);
}

// ─── 고민 (§9) ────────────────────────────────────────────────────────────────────
const hasBatchim = (s: string) => { const c = s.charCodeAt(s.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; };
/** "하늘이한테" / "민수한테" */
const hante = (n: string) => (hasBatchim(n) ? `${n}이한테` : `${n}한테`);
/** "하늘이랑" / "민수랑" */
const irang = (n: string) => (hasBatchim(n) ? `${n}이랑` : `${n}랑`);
/** "하늘이가" / "민수가" */
const iga = (n: string) => (hasBatchim(n) ? `${n}이가` : `${n}가`);

const nameOf = (id: string, memory: Memory): string | null => memory.friends.find(f => f.id === id)?.name ?? agentById(id)?.name ?? null;

/**
 * 여섯 조건을 이 순서로 본다 — 관심 있는 사람 · 잘 보이고 싶은 상대(설렘) · 남이 나옴(동행) · 낙서 · 평소랑 다른 하루(범주·처음 간 곳) ·
 * 막 친구 된 사람. 걸리는 첫 것의 한 줄을 돌려준다 (이름을 채워서). 없으면 undefined. 상한은 여기서 보지 않는다 (underAskCap).
 * TODO(ADR-0021 §영향): 문장은 규칙 — 모델 한 줄은 뒤로.
 */
export function worryLine(ctx: PostCtx, draft: PostDraft, comics: Comic[], acts: ScheduledActivity[]): string | undefined {
  const { memory, now } = ctx;
  // 1. 주인이 관심 있는 사람이 볼 것 같음 — 최근 7일에 그 사람 글에 좋아요 2번 이상 (가장 최근에 누른 사람부터)
  const liked = Object.entries(ctx.agentPost.likedAuthors)
    .map(([id, ts]) => ({ id, ts: ts.filter(t => t <= now && now - t < LIKE_WINDOW_MS) }))
    .filter(x => x.ts.length >= LIKE_MIN)
    .sort((a, b) => Math.max(...b.ts) - Math.max(...a.ts));
  for (const x of liked) { const n = nameOf(x.id, memory); if (n) return `${n} 이거 볼 텐데, 이 컷 괜찮아?`; }
  // 2. 에이전트가 잘 보이고 싶은 상대 — 설렘 좋아함 이상 (AFFECTION_SPEC §1 띠, sim/affection.ts가 한 사람을 고른다; M5가 채운다, 여기서는 읽기만)
  const crush = crushTarget(memory, 'like');
  if (crush) return `${hante(crush.friend.name)} 좀 멋있게 나온 걸로 올리고 싶은데 골라줄래?`;
  // 3. 남이 나옴 — 컷에 동행
  for (const id of draft.companions) { const n = nameOf(id, memory); if (n) return `${irang(n)} 같이 찍힌 건데 올려도 돼?`; }
  // 4. 주인이 그린 낙서
  if (comics.some(c => !!c.sketch)) return '네가 그린 거 올려도 돼?';
  // 5. 평소랑 다른 하루 — 처음 간 곳 / 오늘 범주가 최근 14일의 상위 3에 없다
  const first = acts[0];
  if (first && first.place.type !== 'home' && !memory.visited.some(v => v.placeId === first.place.id && v.at < first.arriveAt)) return '오늘 처음 간 데인데 이거 올릴까?';
  if (draft.category) {
    const { dateKey } = splitDayKey(ctx.today);
    const todayMs = Date.parse(`${dateKey}T00:00:00Z`);
    const counts = new Map<string, number>();
    let history = 0;
    for (const c of ctx.book) {
      if (!c.category || c.dateKey === dateKey) continue;
      const ms = Date.parse(`${c.dateKey}T00:00:00Z`);
      if (!Number.isFinite(ms) || ms >= todayMs || todayMs - ms > UNUSUAL_LOOKBACK_MS) continue;
      history++;
      counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([k]) => k);
    if (history >= UNUSUAL_MIN_HISTORY && !top.includes(draft.category)) return '오늘은 평소랑 좀 다른 하루였는데, 올릴까?';
  }
  // 6. 막 친구 된 사람 — 친구 된 뒤 **첫** 글 (그 뒤로 이미 올렸으면 아니다)
  const { lastPostAt } = ctx.agentPost;
  const fresh = memory.friends.find(f => f.metAt !== undefined && f.metAt <= now && now - f.metAt < NEW_FRIEND_MS && (lastPostAt === undefined || lastPostAt < f.metAt));
  if (fresh) return `${iga(fresh.name)} 처음 보는 글이야, 괜찮아?`;
  return undefined;
}

/**
 * 초안 — 오늘 끝난 활동(마지막 글 뒤)의 컷 중 픽셀이 있는 것으로. 사용자 컷 먼저, 모자라면 에이전트 컷, 찍힌 순서로 최대 4장.
 * 동행은 그 컷들의 활동의 companions 합집합, 장소·동네·도시·범주·날짜는 첫 컷의 만화에서. `reason`은 고민이 있고 이번 주 상한 안일 때만.
 * 컷이 하나도 없으면 null (다음 tick에 다시 본다).
 */
export function buildDraft(ctx: PostCtx): PostDraft | null {
  const cands = candidatesOf(ctx);
  if (!cands.length) return null;
  const users = cands.filter(c => c.cut.by === 'user');
  const agents = cands.filter(c => c.cut.by !== 'user');
  const chosen = [...users.slice(0, MAX_DRAFT_CUTS), ...agents.slice(0, Math.max(0, MAX_DRAFT_CUTS - users.length))].sort((x, y) => x.t - y.t);
  const first = chosen[0];
  const acts: ScheduledActivity[] = [];
  for (const c of chosen) if (!acts.includes(c.act)) acts.push(c.act);
  const comics: Comic[] = [];
  for (const c of chosen) if (!comics.includes(c.comic)) comics.push(c.comic);
  const companions = [...new Set(acts.flatMap(a => a.companions))];
  const { dateKey } = splitDayKey(ctx.today);
  const draft: PostDraft = {
    id: `d:${dateKey}:${Math.round(ctx.now)}`,
    cuts: chosen.map(c => c.cut),
    caption: captionOf(first.comic, ctx.memory),
    place: first.comic.placeName || first.act.place.name,
    area: first.comic.area ?? first.act.place.area,
    city: first.comic.city ?? first.act.place.city,
    dateKey: first.comic.dateKey || dateKey,
    companions,
  };
  const category = first.comic.category ?? first.act.option.category;
  if (category) draft.category = category;
  if (underAskCap(ctx.agentPost, ctx.today)) {
    const reason = worryLine(ctx, draft, comics, acts);
    if (reason) draft.reason = reason;
  }
  return draft;
}

/** 초안 → POST /api/posts 본문. `cuts`를 주면 그 부분집합으로 (자기 전에 올라간 컷만 올릴 때) */
export const postInOf = (draft: PostDraft, cuts: PostCut[] = draft.cuts): PostIn => ({
  cuts, caption: draft.caption.slice(0, MAX_CAPTION), place: draft.place, area: draft.area, city: draft.city,
  ...(draft.category ? { category: draft.category } : {}), dateKey: draft.dateKey, companions: draft.companions, editedByOwner: false,
});

// ─── 결정 (tick마다) ───────────────────────────────────────────────────────────────
/** 채팅으로 묻는 쪽지 — 이유 + 캡션, `그대로 올려`(기본) / `컷 고치기`, 15분 마감. refId = 초안 id */
export const askRequest = (draft: PostDraft, now: number): AgentRequest => ({
  id: `post:${draft.id}`, kind: 'post', at: now, dueAt: now + ASK_DUE_MS,
  line: `${draft.reason ?? '이거 올릴까?'} — "${draft.caption}"`, choices: POST_CHOICES, refId: draft.id,
});

export type PostDecision =
  | { kind: 'none' }
  | { kind: 'ask'; draft: PostDraft; request: AgentRequest }
  | { kind: 'post'; draft: PostDraft };

/**
 * 오늘 아직 안 올렸고, 쥔 초안이 없고, 버린 날이 아니고, 여유 있는 창이면 초안을 만든다. 자기 전 창은 고민이 있어도 그냥 올린다(§8),
 * 다른 창에서 고민이 있으면(상한 안) 묻는다, 아니면 올린다. 초안이 없으면(컷 없음) 아무것도 안 한다 — 다음 tick에 다시.
 */
export function decidePost(ctx: PostCtx, phase: Phase): PostDecision {
  const ap = ctx.agentPost;
  if (ap.pending || ap.lastPostDay === ctx.today || ap.skippedDay === ctx.today) return { kind: 'none' };
  const win = relaxedWindow(phase);
  if (!win) return { kind: 'none' };
  const draft = buildDraft(ctx);
  if (!draft) return { kind: 'none' };
  if (win !== 'bedtime' && draft.reason) return { kind: 'ask', draft, request: askRequest(draft, ctx.now) };
  return { kind: 'post', draft };
}

// ─── 가상 친구의 글 (ADR-0021 결정 6) ─────────────────────────────────────────────────
/** 굽기에 필요한 것 — 장면 종류는 장소 타입으로(sceneTypeFor는 .tsx라 부르는 쪽이 옮긴다), 주인공은 NPC의 겉모습 */
export interface NpcBakeInput { placeType: PlaceType; pose: Pose; crop: ShotCrop; look: Look; color: string }
export type NpcBaker = (input: NpcBakeInput) => Promise<{ blob: Blob; mime: string }>;
export interface NpcPostDeps { bake: NpcBaker; putLocal: (id: string, blob: Blob, kind: 'npc') => Promise<void> }
export interface NpcDue { friend: Friend; agent: Agent; act: AgentActivity; at: number; postId: string; dayKey: DayKey }

/** 가상 친구 글의 id — 하루에 하나 (`l:` 접두는 서버 글의 32자 hex와 겹치지 않는다) */
export const npcPostId = (npcId: string, dateKey: string) => `l:${npcId}:${dateKey}`;

/**
 * 오늘 글을 올릴 때가 된 가상 친구들 — memory.friends 중 NPC 풀(AGENTS)의 친구만(진짜 사람의 글은 서버 피드가 준다). 그 친구의 하루에서
 * 집이 아닌 활동 하나를 시드로 골라, 그 활동이 끝나는 시각이 지났고 아직 안 만들었으면. 결정적이다 (친구·날짜당 같은 활동).
 */
export function npcPostsDue(memory: Memory, today: DayKey, now: number, have: (postId: string) => boolean): NpcDue[] {
  const out: NpcDue[] = [];
  const { dateKey } = splitDayKey(today);
  for (const friend of memory.friends) {
    const agent = AGENTS.find(a => a.id === friend.id);
    if (!agent) continue;
    let tz: string;
    try { tz = tzOf(placeById(agent.homePlaceId)); } catch { continue; }
    const plan = agentDayPlan(agent, today, tz).filter(a => a.placeId !== agent.homePlaceId);
    if (!plan.length) continue;
    const act = rng(`npcpost:${friend.id}:${today}`).pick(plan);
    if (act.endAt > now) continue;
    const postId = npcPostId(friend.id, dateKey);
    if (have(postId)) continue;
    out.push({ friend, agent, act, at: act.endAt, postId, dayKey: today });
  }
  return out;
}

/** 토큰 색 → 옷 색 (Look.top). NPC의 색(칩 테두리·소품)을 옷으로 옮긴다 — 겉모습 여섯 칸엔 소품 색이 없다 */
const TOP_OF_COLOR: Record<string, Look['top']> = { '#5FC9A6': 'mint', '#A9DCF5': 'sky', '#F6C445': 'sun', '#FF9A8B': 'coral', '#8FD694': 'leaf', '#6B7BB5': 'night', '#FFC64D': 'sun', '#FF6A48': 'coral', '#8FD37E': 'leaf', '#1E2440': 'night' };
const isHairStyle = (v: unknown): v is Look['hairStyle'] => (LOOK_HAIR_STYLES as readonly unknown[]).includes(v);
/** NPC의 겉모습 — 기본 모모에 풀의 머리 모양과 색만 얹는다 */
export const npcLook = (agent: Agent): Look => ({
  ...DEFAULT_LOOK,
  hairStyle: isHairStyle(agent.hairStyle) ? agent.hairStyle : DEFAULT_LOOK.hairStyle,
  top: TOP_OF_COLOR[agent.color.toUpperCase()] ?? DEFAULT_LOOK.top,
});

/** 창별 고정 프레이밍 (dev/preview.ts의 fakeShots와 같은 값) — 컷마다 화각이 달라야 사진으로 읽힌다 */
const NPC_CROPS: ShotCrop[] = [
  { scale: 1.15, x: -8, y: 4, rot: -5, pitch: 8, light: 1.15, dof: 0.6, focus: 'near' },
  { scale: 1.6, x: 6, y: -6, rot: 3, pitch: -10, light: 0.75, dof: 0.7, focus: 'far' },
  { scale: 2.0, x: 0, y: 8, rot: -2, pitch: 0, light: 1.3, dof: 1, focus: 'near' },
  { scale: 1.3, x: -4, y: 0, rot: 9, pitch: 12, light: 0.6, dof: 0.35, focus: 'far' },
];

/** 활동 제목에서 캡션 한 줄 — 규칙 (TODO ADR-0021 §영향: 모델은 뒤로) */
export function npcCaptionOf(act: AgentActivity, placeName: string, area: string, seed: string): string {
  const stem = shortTitle(act.option.title).replace(/하기$/, '').trim() || act.option.title;
  const r = rng(`npccaption:${seed}`);
  return r.pick([`오늘은 ${stem}`, `${placeName}에서 ${stem}`, `${stem}. 좋았다`, `${area}, ${stem}`]).slice(0, MAX_DRAFT_CAPTION);
}

/**
 * 가상 친구의 글 하나를 만든다 — 컷 2~3장을 굽고(NPC의 겉모습·색, 그 활동의 포즈, 시드로 고른 프레이밍) `kind: 'npc'`로 내 저장소에 넣는다.
 * 굽기·저장이 하나라도 실패하면 던진다 — 부르는 쪽이 오늘은 건너뛴다(다음 날 다시).
 */
export async function makeNpcPost(due: NpcDue, deps: NpcPostDeps): Promise<FeedItem> {
  const r = rng(`npccuts:${due.postId}`);
  const place = placeById(due.act.placeId);
  const look = npcLook(due.agent);
  const pose = poseFor(due.act.option);
  const wins = r.shuffle([0, 1, 2, 3] as ShotWin[]).slice(0, r.int(2, 3)).sort((a, b) => a - b);
  const likes = r.int(0, 12);
  const cuts: PostCut[] = [];
  for (const win of wins) {
    const id = newShotId();
    const { blob } = await deps.bake({ placeType: place.type, pose, crop: NPC_CROPS[win], look, color: due.agent.color });
    await deps.putLocal(id, blob, 'npc');
    cuts.push({ shotId: id, actKey: `${due.dayKey}:${due.act.blockId}`, win, by: 'agent' });
  }
  const { dateKey } = splitDayKey(due.dayKey);
  return {
    post: {
      id: due.postId, authorId: due.agent.id, createdAt: due.at, cuts,
      caption: npcCaptionOf(due.act, place.name, place.area, due.postId),
      place: place.name, area: place.area, city: place.city, category: due.act.option.category, dateKey,
      companions: [], editedByOwner: false, likes, likedByMe: false,
    },
    author: { ...due.agent, home: placeById(due.agent.homePlaceId), visibility: 'public' },
  };
}
