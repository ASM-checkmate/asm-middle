// 설렘 축 (AFFECTION_SPEC §1~§5, ADR-0023) — 숫자(crush.v)를 단계로 읽는 유일한 곳이자 숫자를 올리고 내리는 유일한 곳. SNS 고민 줄·채팅 프롬프트
// (situation.crush)·계획 카드 훅·사진의 돌아본 얼굴이 전부 여기를 본다 — 소비자마다 문턱을 두면 "잘 보이고 싶은 상대"와 "요즘 좋다"가 다른 사람이 된다.
// 순수·결정적(난수 없음): 재료는 전부 내 폰에 있고(마주침·동행·취향), 어느 기기에서 봐도 같은 마음이다. 주인에겐 숫자·단계가 절대 보이지 않는다 (§4).
import type { Friend, Gender, Memory } from './types';
import { DAY_MS } from './tz';

/** 서버가 받는 세 값 (CONTRACT §2.4 `situation.crush.stage`). 없음은 crush 자체가 null */
export type CrushStage = 'interest' | 'like' | 'love';
/** memory.friends[id].crush — `at`은 마지막 갱신(사건 또는 감쇠가 소비한 날). "마지막으로 본 날"이 아니다 */
export type Crush = NonNullable<Friend['crush']>;

/** 띠의 아래 문턱 (AFFECTION_SPEC §1 오너 결정): 관심 0.2 · 좋아함 0.5 · 많이 좋아함 0.8 */
export const CRUSH_INTEREST_MIN = 0.2;
export const CRUSH_LIKE_MIN = 0.5;
export const CRUSH_LOVE_MIN = 0.8;
/** "좋아함 이상"의 문턱 — SNS §9 고민 줄·§4 먼저 좋아요·계획 카드 훅 (agentPosts는 `crush.v ≥ 0.5`로 읽는다) */
export const CRUSH_ASK = CRUSH_LIKE_MIN;

// ─── 재료의 크기 (§3) ────────────────────────────────────────────────────────
/** 우연한 마주침 — 계획된 동행의 2배 (§3 그대로). 말을 텄든 보기만 했든 같다 — 말을 튼 상대에게 더 얹으면 첫 대화가 곧 관심(0.2)이 되고,
 *  친구는 겹칠 때마다 `again`이라 두 번 겹치면 좋아함이 된다. 또 정산이 `talked`에 안 매이니 켜 두고 본 날과 몰아서 정산한 날의 마음이 같다 */
export const CRUSH_CHANCE = 0.12;
/** 계획된 동행 (같이 놀기) */
export const CRUSH_PLANNED = 0.06;
/** 취향 근접: 같은 likes 하나당, 마주침·동행에 얹는다 (상한 CRUSH_TASTE_CAP) */
export const CRUSH_TASTE_PER_LIKE = 0.02;
export const CRUSH_TASTE_CAP = 0.06;
/** 상대가 내 글에 좋아요 */
export const CRUSH_LIKED = 0.04;
/** 2주 넘게 안 봄 — 그 뒤 하루마다. 관심(0.2) 아래로는 안 떨어진다 */
export const CRUSH_DECAY_PER_DAY = 0.03;
export const CRUSH_DECAY_AFTER_DAYS = 14;

/** crush.v → 단계. 없음(0.2 아래·없음)은 null */
export function crushStage(v: number | undefined): CrushStage | null {
  if (v === undefined || !(v >= CRUSH_INTEREST_MIN)) return null;
  return v >= CRUSH_LOVE_MIN ? 'love' : v >= CRUSH_LIKE_MIN ? 'like' : 'interest';
}

/** "좋아함 이상" (AFFECTION_SPEC §4 — 계획 카드 훅·SNS §9 고민 줄의 문턱) */
export const likesOrMore = (v: number | undefined): boolean => (v ?? 0) >= CRUSH_LIKE_MIN;

/** 설렘은 이성에게만 (§2) — 양쪽 성별이 있고 서로 달라야. 한쪽이라도 모르면 아무 일도 없다 (추정하지 않는다) */
export const eligible = (me: { gender?: Gender }, other: { gender?: Gender }): boolean => !!me.gender && !!other.gender && me.gender !== other.gender;

/**
 * 설렘 대상 한 사람 — `v`가 가장 큰 친구, 같으면 id 오름차순 (결정적). `min` 단계 아래는 안 본다 (기본: 관심부터).
 * 채팅 프롬프트는 한 사람만 받으므로 여기서 고른다.
 */
export function crushTarget(memory: Memory, min: CrushStage = 'interest'): { friend: Friend; stage: CrushStage } | null {
  const floor = min === 'love' ? CRUSH_LOVE_MIN : min === 'like' ? CRUSH_LIKE_MIN : CRUSH_INTEREST_MIN;
  const best = memory.friends
    .filter(f => (f.crush?.v ?? 0) >= floor)
    .sort((a, b) => (b.crush?.v ?? 0) - (a.crush?.v ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  const stage = best && crushStage(best.crush?.v);
  return best && stage ? { friend: best, stage } : null;
}

/** 채팅 프롬프트·규칙 답장이 받는 모양 (CONTRACT §2.4 situation.crush) — 관심부터. 없으면 null */
export const topCrush = (memory: Memory): { id: string; name: string; stage: CrushStage } | null => {
  const t = crushTarget(memory);
  return t ? { id: t.friend.id, name: t.friend.name, stage: t.stage } : null;
};

// ─── 사건 (§3) — 각각 새 crush를 돌려준다. 0~1로 자르고 소수 셋째 자리에서 반올림 (부동소수 찌꺼기가 문턱 비교를 흔들지 않게) ───
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const bump = (cur: Crush | undefined, delta: number, at: number): Crush => ({ v: round3(clamp01((cur?.v ?? 0) + delta)), at });

/** 취향 근접 보너스 — 같은 likes 하나당 +0.02, 최대 +0.06 (마주침·동행에만 얹는다) */
export const tasteBonus = (shared: number): number => Math.min(CRUSH_TASTE_CAP, Math.max(0, shared) * CRUSH_TASTE_PER_LIKE);
/** 우연한 마주침 (+0.12) + 취향 근접 — 굴림 상대든 같은 공간에 있기만 했든 */
export const chanceEncounter = (cur: Crush | undefined, at: number, shared = 0): Crush => bump(cur, CRUSH_CHANCE + tasteBonus(shared), at);
/** 계획된 동행 (+0.06) + 취향 근접 */
export const plannedTogether = (cur: Crush | undefined, at: number, shared = 0): Crush => bump(cur, CRUSH_PLANNED + tasteBonus(shared), at);
/** 상대가 내 글에 좋아요 (+0.04). 아직 부르는 곳이 없다 — 앱이 "누가 좋아요를 눌렀나"를 알게 되면(서버 알림) 그때 (ADR-0023 미룬 것) */
export const likedMyPost = (cur: Crush | undefined, at: number): Crush => bump(cur, CRUSH_LIKED, at);
// §3 "대화 롤 연속 실패 ↓"는 1차에 재료가 없다: 굴림은 친구가 아닌 상대에게만 돌고(친구는 겹치면 늘 `again`, ADR-0022) crush는 친구에게만 있다.
// 켜 둔 채로는 한 번도 닿지 않고 몰아서 정산할 때만 닿는 길을 두면 기기마다 마음이 달라지므로 두지 않는다 (ADR-0023 미룬 것)
/**
 * 시간 감쇠 — `at`에서 14일이 지난 뒤 하루마다 −0.03. 소비한 날만큼 `at`을 앞으로 옮겨 두 번 적용해도 겹쳐 깎이지 않고(멱등), 며칠 껐다 켜도 밀린
 * 날수만큼 한 번에 깎인다. 관심(0.2)에 닿은 마음은 그 아래로 안 떨어진다 (§3) — 관심 아래였으면 0까지. 깎을 게 없으면 같은 객체
 */
export function decay(cur: Crush, nowMs: number): Crush {
  const days = Math.floor((nowMs - cur.at) / DAY_MS) - CRUSH_DECAY_AFTER_DAYS;
  if (days <= 0) return cur;
  const floor = cur.v >= CRUSH_INTEREST_MIN ? CRUSH_INTEREST_MIN : 0;
  const v = round3(Math.max(floor, cur.v - CRUSH_DECAY_PER_DAY * days));
  return { ...cur, v, at: cur.at + days * DAY_MS };
}
/** 날이 바뀔 때 모든 친구의 설렘을 감쇠한다 — 바뀐 게 없으면 같은 memory */
export function decayAll(memory: Memory, nowMs: number): Memory {
  let changed = false;
  const friends = memory.friends.map(f => {
    if (!f.crush) return f;
    const c = decay(f.crush, nowMs);
    if (c === f.crush) return f;
    changed = true;
    return { ...f, crush: c };
  });
  return changed ? { ...memory, friends } : memory;
}

// ─── 활동 정산 훅 (store.settle) ─────────────────────────────────────────────
/** 상대에 대해 알아야 하는 것 — 성별(친구 칸에 없으면 풀·서버 프로필에서)과 취향 */
export interface OtherInfo { gender?: Gender; likes: string[] }
/**
 * 활동 하나가 끝난 뒤 친구들의 설렘. 사다리 작업 뒤(말을 튼 상대는 이미 친구다)에 부른다. 내 성별이 없거나 상대가 이성이 아니면 아무 일도 없다 (§2).
 * 동행 → 계획된 동행. 굴림 상대(말을 텄든 아니든)·같은 공간에 있기만 한 사람 → 이미 친구일 때만 우연한 마주침 (서로 봤다 — 친구가 아니면 §6 표대로
 * 아무 관계도 아니다). `talked`를 안 보므로 친구 사이가 된 뒤의 시간표를 다시 짓지 않은 몰아서 정산(부팅·날 바뀜)도 켜 두고 본 것과 같은 값이다.
 * 취향 근접은 마주침·동행에 얹는다. 결정적, 난수 없음.
 */
export function crushAfterActivity(
  memory: Memory,
  act: { companions: string[]; presentNearby?: string[]; encounter?: { agentId: string }; endAt: number },
  otherOf: (id: string) => OtherInfo | null,
): Memory {
  if (!memory.gender) return memory;
  const e = act.encounter;
  let changed = false;
  const friends = memory.friends.map(f => {
    const other = otherOf(f.id);
    if (!eligible(memory, { gender: f.gender ?? other?.gender })) return f;
    const shared = other ? memory.likes.filter(l => other.likes.includes(l)).length : 0;
    let next: Crush | undefined;
    if (act.companions.includes(f.id)) next = plannedTogether(f.crush, act.endAt, shared);
    else if (e?.agentId === f.id || act.presentNearby?.includes(f.id)) next = chanceEncounter(f.crush, act.endAt, shared);
    if (!next) return f;
    changed = true;
    return { ...f, crush: next };
  });
  return changed ? { ...memory, friends } : memory;
}

// ─── 먼저 좋아요 (§4) ───────────────────────────────────────────────────────
/** 에이전트가 먼저 누른 좋아요의 기록 (world 저장본): 누른 글 id(최근 100), 오늘(dayKey)과 오늘 누른 수 (하루 3) */
export interface AgentLikes { ids: string[]; day: string; count: number }
export const AGENT_LIKES_CAP = 100;
export const AGENT_LIKES_PER_DAY = 3;
export const emptyAgentLikes = (): AgentLikes => ({ ids: [], day: '', count: 0 });
/** 저장본 검증 — 모양이 틀리면 빈 값 */
export function validAgentLikes(raw: unknown): AgentLikes {
  const out = emptyAgentLikes();
  if (!raw || typeof raw !== 'object') return out;
  const a = raw as Partial<AgentLikes>;
  if (Array.isArray(a.ids)) out.ids = a.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(-AGENT_LIKES_CAP);
  if (typeof a.day === 'string') out.day = a.day;
  if (typeof a.count === 'number' && Number.isFinite(a.count)) out.count = Math.max(0, Math.floor(a.count));
  return out;
}
/** 피드의 글 하나 — 좋아요 후보 판단에 필요한 세 칸 */
export interface LikeCandidate { id: string; authorId: string; likedByMe: boolean }
/**
 * 좋아함 이상인 사람의 글에 에이전트가 먼저 좋아요 (§4 "주인이 안 눌러도"). 이미 주인이 눌렀거나 에이전트가 눌렀던 글은 건너뛰고, 하루 3개까지.
 * 순수: 새 기록과 누를 글 id들을 돌려준다 (누르는 건 스토어가 sns에 시킨다)
 */
export function pickAutoLikes(memory: Memory, items: readonly LikeCandidate[], state: AgentLikes, today: string): { state: AgentLikes; picked: string[] } {
  const crushes = new Set(memory.friends.filter(f => likesOrMore(f.crush?.v)).map(f => f.id));
  if (!crushes.size) return { state, picked: [] };
  let { count } = state;
  if (state.day !== today) count = 0;
  const ids = [...state.ids];
  const picked: string[] = [];
  for (const it of items) {
    if (count >= AGENT_LIKES_PER_DAY) break;
    if (!crushes.has(it.authorId) || it.likedByMe || ids.includes(it.id)) continue;
    ids.push(it.id); picked.push(it.id); count++;
  }
  return picked.length ? { state: { ids: ids.slice(-AGENT_LIKES_CAP), day: today, count }, picked } : { state, picked };
}
