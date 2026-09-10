// ─── 진짜 사람 에이전트 — 순수 도우미 (BACKEND-CONTRACT §3.4, FRIENDS_SPEC §4) ───────────────────────────
// 서버(§2.3)가 준 것을 검증해 world의 `remote` 캐시로 만들고, 내 확정 일정을 발행 모양으로 뽑고, 다음에 무엇을 물을지
// 고른다. 이 모듈은 types·blocks·tz만 import한다 — places.ts가 sync.ts를 import하므로(ADR-0009 places 문서) sync.ts가
// 여기를 import해도 순환이 없다. 장소 등록·모듈 캐시는 agents.ts(setRemoteCache)가 한다.
import type { Category, DayKey, Friend, Memory, Place, PublishedActivity, RemoteAgent, RemoteCache, RemoteHit, RemotePlace, ScheduledActivity } from './types';
import { PLACE_TYPES, splitDayKey } from './types';
import { BLOCK_ORDER, CATEGORIES } from './blocks';
import { dayEndOfKey, isValidTz } from './tz';
import { seedFrom } from './rng';

/** 모든 범주 (CATEGORIES에는 sleep이 없다) — 발행된 활동의 category 검증용 */
const ALL_CATEGORIES: ReadonlySet<string> = new Set<string>(['sleep', ...CATEGORIES.map(c => c.id)]);
const BLOCK_IDS: ReadonlySet<string> = new Set<string>(BLOCK_ORDER);
/** 서버 제한(§2.3)과 같다 — 넘치는 것은 프런트에서 먼저 자른다 */
export const MAX_PUBLISH = 64;
export const MAX_SLOTS_PER_ASK = 16;
const MAX_TITLE = 120;

const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown, maxItems = 16, maxLen = 80): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= maxLen).slice(0, maxItems) : []);

// ─── 검증 (모양이 틀리면 null — 저장본·응답 어느 쪽이든) ─────────────────────────

/**
 * 서버 장소 → Place. `force`가 있으면 그 값으로 덮는다 (집: `home:<userId>` · friend_home · ownerFriendId = userId — 서버도
 * 같은 것을 강제하지만 저장본이 손댔을 수 있다).
 */
export function validRemotePlace(raw: unknown, force?: { id?: string; type?: Place['type']; ownerFriendId?: string }): Place | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<RemotePlace>;
  const id = force?.id ?? p.id;
  const type = force?.type ?? p.type;
  if (!str(id, 80) || !str(p.name, 80) || !str(type, 24) || !(PLACE_TYPES as readonly string[]).includes(type)) return null;
  if (!finite(p.lng) || !finite(p.lat)) return null;
  const place: Place = {
    id, name: p.name.normalize('NFC'), type: type as Place['type'], lng: p.lng, lat: p.lat,
    area: typeof p.area === 'string' ? p.area : '', city: typeof p.city === 'string' ? p.city : '', country: typeof p.country === 'string' ? p.country : '',
    emoji: typeof p.emoji === 'string' && p.emoji ? p.emoji : '📍',
  };
  if (p.reachBy === 'boat' || p.reachBy === 'plane' || p.reachBy === 'train') place.reachBy = p.reachBy;
  const owner = force?.ownerFriendId ?? p.ownerFriendId;
  if (typeof owner === 'string' && owner) place.ownerFriendId = owner;
  return place;
}

/** 미디어 id 모양 (§2.5 — 클라이언트가 만드는 32자 hex) */
const MEDIA_ID_RE = /^[0-9a-f]{32}$/;

/**
 * 서버 에이전트 → RemoteAgent. 집이 없거나 틀리면 통째로 버린다 (placeById가 throw하지 않아야 한다).
 * SNS 세 칸(gender·visibility·repShotId)은 값이 허용 밖이면 **그 칸만** 뺀다 — 에이전트는 남긴다.
 */
export function validRemoteAgent(raw: unknown): RemoteAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<RemoteAgent>;
  if (!str(a.id, 80) || !str(a.name, 40) || !str(a.color, 16) || !str(a.emoji, 8)) return null;
  const home = validRemotePlace(a.home, { type: 'friend_home', ownerFriendId: a.id });
  if (!home) return null;
  const out: RemoteAgent = {
    id: a.id, name: a.name.normalize('NFC'), homePlaceId: home.id, color: a.color, emoji: a.emoji,
    likes: strings(a.likes, 12, 30), traits: strings(a.traits, 12, 30), home,
  };
  if (str(a.hairStyle, 24)) out.hairStyle = a.hairStyle;
  if (a.gender === 'female' || a.gender === 'male') out.gender = a.gender;
  if (a.visibility === 'public' || a.visibility === 'private') out.visibility = a.visibility;
  if (typeof a.repShotId === 'string' && MEDIA_ID_RE.test(a.repShotId)) out.repShotId = a.repShotId;
  return out;
}

/** 발행된 활동 검증. `agentId`가 주어지면 그 값으로 덮는다 (서버도 userId로 덮는다 §2.3). */
export function validPublished(raw: unknown, agentId?: string): PublishedActivity | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PublishedActivity>;
  const who = agentId ?? p.agentId;
  if (!str(p.key, 120) || !str(who, 80) || !str(p.dayKey, 60) || !p.dayKey.includes('@') || !isValidTz(splitDayKey(p.dayKey).tz)) return null;
  if (!str(p.blockId, 12) || !BLOCK_IDS.has(p.blockId) || !str(p.placeId, 80) || !str(p.category, 12) || !ALL_CATEGORIES.has(p.category)) return null;
  if (typeof p.title !== 'string' || p.title.length > MAX_TITLE || !finite(p.arriveAt) || !finite(p.endAt) || p.arriveAt >= p.endAt || !isValidTz(p.tz)) return null;
  const out: PublishedActivity = {
    key: p.key, agentId: who, dayKey: p.dayKey, blockId: p.blockId as PublishedActivity['blockId'], placeId: p.placeId,
    category: p.category as Category, title: p.title.normalize('NFC'), emoji: typeof p.emoji === 'string' ? p.emoji : '',
    arriveAt: p.arriveAt, endAt: p.endAt, tz: p.tz, companions: strings(p.companions, 16, 80),
  };
  const place = p.place === undefined || p.place === null ? null : validRemotePlace(p.place);
  if (place && place.id === out.placeId) out.place = place;
  return out;
}

/** hit 하나 (캐시 모양 `{agentId, overlapMs, activity}`). */
const validHit = (raw: unknown): RemoteHit | null => {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Partial<RemoteHit>;
  if (!str(h.agentId, 80) || !finite(h.overlapMs)) return null;
  const activity = validPublished(h.activity, h.agentId);
  return activity ? { agentId: h.agentId, overlapMs: h.overlapMs, activity } : null;
};

export const emptyRemote = (): RemoteCache => ({ fetchedAt: 0, agents: {}, slots: {}, days: {}, friendsAt: 0 });

/**
 * 저장본의 remote 캐시 검증 (§3.4 "로드 시 검증, 모양이 틀리면 버린다"). 항목 단위로 거른다 — 에이전트 하나가 틀렸다고
 * 슬롯 전부를 잃진 않는다. 프로필 없는 에이전트를 가리키는 hit·day는 버린다.
 */
export function validRemote(raw: unknown): RemoteCache | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RemoteCache>;
  const agents: Record<string, RemoteAgent> = {};
  if (r.agents && typeof r.agents === 'object') for (const v of Object.values(r.agents as Record<string, unknown>)) { const a = validRemoteAgent(v); if (a) agents[a.id] = a; }
  const slots: Record<string, RemoteHit[]> = {};
  if (r.slots && typeof r.slots === 'object') {
    for (const [k, v] of Object.entries(r.slots as Record<string, unknown>)) {
      if (!str(k, 120) || !Array.isArray(v)) continue;
      slots[k] = v.map(validHit).filter((h): h is RemoteHit => !!h && h.agentId in agents).sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
    }
  }
  const days: Record<string, PublishedActivity[]> = {};
  if (r.days && typeof r.days === 'object') {
    for (const [id, v] of Object.entries(r.days as Record<string, unknown>)) {
      if (!(id in agents) || !Array.isArray(v)) continue;
      days[id] = v.map(x => validPublished(x, id)).filter((p): p is PublishedActivity => !!p).sort((a, b) => a.arriveAt - b.arriveAt);
    }
  }
  return { fetchedAt: finite(r.fetchedAt) ? r.fetchedAt : 0, agents, slots, days, friendsAt: finite(r.friendsAt) ? r.friendsAt : 0 };
}

// ─── 캐시 정리·병합 ──────────────────────────────────────────────────────────

/** 활동 key `${dayKey}:${blockId}` → dayKey (IANA 시간대에는 ':'가 없다) */
export const dayKeyOfActKey = (key: string): DayKey => key.slice(0, key.lastIndexOf(':'));

/**
 * anchor 이전 날의 슬롯·활동을 버린다 (그 날들은 이미 anchor에 접혔다). 프로필은 슬롯·하루가 가리키거나 `keep`(내 친구)에
 * 있는 것만 남긴다. 아무것도 안 바뀌면 같은 객체를 돌려준다.
 */
export function pruneRemote(cache: RemoteCache, anchorT: number, keep: ReadonlySet<string>): RemoteCache {
  const slots: Record<string, RemoteHit[]> = {};
  let changed = false;
  for (const [k, v] of Object.entries(cache.slots)) {
    const dk = dayKeyOfActKey(k);
    let end: number;
    try { end = dayEndOfKey(dk); } catch { end = 0; }
    if (!dk.includes('@') || end <= anchorT) { changed = true; continue; }
    slots[k] = v;
  }
  const days: Record<string, PublishedActivity[]> = {};
  for (const [id, v] of Object.entries(cache.days)) {
    const kept = v.filter(p => p.endAt > anchorT);
    if (kept.length !== v.length) changed = true;
    if (kept.length) days[id] = kept; else if (v.length) changed = true;
  }
  const used = new Set<string>(keep);
  for (const v of Object.values(slots)) for (const h of v) used.add(h.agentId);
  for (const id of Object.keys(days)) used.add(id);
  const agents: Record<string, RemoteAgent> = {};
  for (const [id, a] of Object.entries(cache.agents)) { if (used.has(id)) agents[id] = a; else changed = true; }
  return changed ? { ...cache, agents, slots, days } : cache;
}

/** 서버에서 한 번 받아 온 것 (sync.refreshRemote의 결과). `friends`는 물었을 때만. */
export interface RemoteFetch {
  agents: Record<string, RemoteAgent>;
  slots: Record<string, RemoteHit[]>;
  friends: { agent: RemoteAgent; metAt: number | null; metPlaceId: string | null; now: PublishedActivity | null }[] | null;
  days: Record<string, PublishedActivity[]>;
}

/**
 * 받아 온 것을 캐시에 얹는다. 슬롯은 **이미 있는 key는 그대로**(한 번만 채운다), 도착이 지난 key(`arrivedKeys`)는 빈 목록으로
 * 굳힌다 — 응답이 늦게 와서 진행 중인 활동의 실루엣이 바뀌면 안 된다. 하루는 에이전트별로 통째로 바꾼다.
 */
export function mergeRemote(base: RemoteCache, got: RemoteFetch, opts: { now: number; arrivedKeys: ReadonlySet<string>; friendsAt?: number }): RemoteCache {
  const agents = { ...base.agents, ...got.agents };
  for (const f of got.friends ?? []) agents[f.agent.id] = f.agent;
  const slots = { ...base.slots };
  for (const [k, hits] of Object.entries(got.slots)) {
    if (k in slots) continue;
    slots[k] = opts.arrivedKeys.has(k) ? [] : hits.filter(h => h.agentId in agents);
  }
  const days = { ...base.days };
  for (const [id, acts] of Object.entries(got.days)) if (id in agents) days[id] = [...acts].sort((a, b) => a.arriveAt - b.arriveAt);
  // 친구 목록의 '지금'은 하루를 못 받았을 때의 대비 — 하루가 오면 그 안에 들어 있다
  for (const f of got.friends ?? []) if (f.now && !(f.agent.id in got.days)) { const cur = days[f.agent.id] ?? []; if (!cur.some(p => p.key === f.now!.key)) days[f.agent.id] = [...cur, f.now].sort((a, b) => a.arriveAt - b.arriveAt); }
  return { fetchedAt: opts.now, agents, slots, days, friendsAt: opts.friendsAt ?? base.friendsAt };
}

// ─── 내 확정 일정 → 발행 (§3.4 a) ────────────────────────────────────────────

/** 내 집의 발행 id — 상대 카탈로그의 'home'은 **상대의** 집이라 그대로 보내면 같은 장소로 읽힌다 */
export const remoteHomeId = (userId: string) => `home:${userId}`;

/**
 * ScheduledActivity 하나를 발행 모양으로. placeId는 우회 반영된 실제 장소(`a.place`), 내 집이면 `home:<me>`로 바꿔 싣는다.
 * 제목은 `stripTitle`(store의 stripNames)을 지나 친구 이름을 뺀다 (FRIENDS_SPEC 동행 표시 규칙).
 */
export function publishedOf(a: ScheduledActivity, meId: string, myName: string, stripTitle: (title: string, keepPlaceName: boolean) => string): PublishedActivity {
  const mine = a.place.type === 'home';
  const place: Place = mine
    ? { ...a.place, id: remoteHomeId(meId), name: `${myName}네 집`, type: 'friend_home', ownerFriendId: meId }
    : a.place;
  return {
    key: a.key, agentId: meId, dayKey: a.dayKey, blockId: a.blockIds[0], placeId: place.id, place,
    category: a.option.category, title: stripTitle(a.option.title, place.type === 'friend_home').slice(0, MAX_TITLE), emoji: a.option.emoji,
    arriveAt: a.arriveAt, endAt: a.endAt, tz: a.tz, companions: a.companions,
  };
}

/** `[from, to)` 창(anchor ~ now+36h)에 도착하는 활동들 — 서버가 그 창을 통째로 바꾼다. 64개까지(뒤쪽 우선). */
export function publishWindow(timeline: ScheduledActivity[], from: number, to: number, meId: string, myName: string, stripTitle: (title: string, keepPlaceName: boolean) => string): PublishedActivity[] {
  return timeline.filter(a => a.arriveAt >= from && a.arriveAt < to).slice(-MAX_PUBLISH).map(a => publishedOf(a, meId, myName, stripTitle));
}

/** 시간표가 발행 관점에서 바뀌었나 — 이 서명이 같으면 다시 올리지 않는다 */
export const timelineSig = (timeline: ScheduledActivity[]): string =>
  timeline.map(a => `${a.key}|${a.place.id}|${a.arriveAt}|${a.endAt}|${a.companions.join(',')}`).join(';');

// ─── 다음에 물을 것 (§3.4 c) ─────────────────────────────────────────────────

export interface SlotReq { key: string; placeId: string; from: number; to: number }

/**
 * 오늘·내일 활동 중 **아직 도착하지 않았고** 슬롯에 없는 key. 도착한 뒤엔 실루엣이 이미 보였으니 묻지 않는다 (마주침 결정성).
 * 계약은 departAt으로 적었지만 에이전트가 블록 시작에 정한 활동은 departAt이 곧 지금이라 한 번도 못 묻는다 — 실루엣이
 * 보이는 순간은 도착이므로 arriveAt으로 자른다 (이동 화면은 마주침을 그리지 않는다).
 * 내 집(type home)은 묻지 않는다 — 발행 때 `home:<me>`가 되고 아무도 'home'으로 발행하지 않으니 16개 예산만 쓴다.
 */
export function pendingSlots(timeline: ScheduledActivity[], cache: RemoteCache | null, now: number, dayKeys: readonly DayKey[]): SlotReq[] {
  const out: SlotReq[] = [];
  for (const a of timeline) {
    if (a.arriveAt <= now || a.place.type === 'home' || !dayKeys.includes(a.dayKey) || (cache && a.key in cache.slots)) continue;
    out.push({ key: a.key, placeId: a.place.id, from: a.arriveAt, to: a.endAt });
    if (out.length >= MAX_SLOTS_PER_ASK) break;
  }
  return out;
}

/** 시간표에서 이미 도착한 활동의 key들 (응답을 얹을 때 굳힐 것) */
export const arrivedKeys = (timeline: ScheduledActivity[], now: number): Set<string> => new Set(timeline.filter(a => a.arriveAt <= now).map(a => a.key));

/** 내 친구 중 진짜 사람 (캐시에 프로필이 있는 id) */
export const remoteFriendIds = (memory: Memory, cache: RemoteCache | null): string[] => (cache ? memory.friends.filter(f => f.id in cache.agents).map(f => f.id) : []);

// ─── 친구 목록의 '지금' (§3.5 FriendsOverlay) ────────────────────────────────

/** 발행된 활동 중 `arriveAt <= now < endAt`인 것 — 시차 있는 친구도 내 블록이 아니라 그 순간으로 본다 */
export const remoteNowOf = (acts: readonly PublishedActivity[] | undefined, now: number): PublishedActivity | null =>
  acts?.find(p => p.arriveAt <= now && now < p.endAt) ?? null;

/** 서버 친구 목록의 한 줄 → 내 메모리의 Friend (§3.4 c: memory.friends에 없는 remote 친구는 추가) */
export function friendOfRemote(agent: RemoteAgent, metAt: number | null, metPlaceId: string | null): Friend {
  const f: Friend = { id: agent.id, name: agent.name, homePlaceId: agent.homePlaceId, color: agent.color, emoji: agent.emoji };
  if (metAt !== null && Number.isFinite(metAt)) f.metAt = metAt;
  if (metPlaceId) f.metPlaceId = metPlaceId;
  if (agent.gender) f.gender = agent.gender;   // 설렘은 이성에게만 (AFFECTION_SPEC §2) — 서버 프로필의 성별을 친구 칸에
  return f;
}

// ─── 내 모습 (PUT /api/me/agent) ─────────────────────────────────────────────
// 메모리에는 색·이모지가 없다 (내 캐릭터는 늘 '나'다). 상대 화면에서는 친구 칩 색과 이모지가 필요하므로 userId로 정해
// 어느 기기에서 봐도 같은 모습이다. 팔레트는 NPC 풀(agents.ts)과 같은 토큰 색.
const COLORS = ['#5FC9A6', '#A9DCF5', '#F6C445', '#FF9A8B', '#8FD694', '#6B7BB5'];
const EMOJIS = ['🐥', '🐰', '🐤', '🦊', '🐧', '🐱', '🐢', '🐶', '🐨', '🐼'];
const HAIR = ['short', 'bob', 'curly', 'long'];
export function appearanceOf(userId: string): { color: string; emoji: string; hairStyle: string } {
  const h = seedFrom(`me:${userId}`);
  return { color: COLORS[h % COLORS.length], emoji: EMOJIS[(h >>> 8) % EMOJIS.length], hairStyle: HAIR[(h >>> 16) % HAIR.length] };
}
