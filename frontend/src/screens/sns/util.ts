// ─── SNS 화면의 순수 계산 (SNS_SPEC §4·§5·§7) ──────────────────────────────────────────────────────
// React 없음 — node가 그대로 읽어 검사한다 (scripts/sns-util.test.mjs). 피드 합치기·상대 시각·조사·컷 뽑기.
import type { FeedItem, Post, PostCut, PostDraft, PostIn } from '../../sim/posts';
import type { Comic, Friend, ShotWin } from '../../sim/types';
import { localParts } from '../../sim/tz';
import { seedFrom } from '../../sim/rng';

/** 서버 userId는 32자 hex — 아니면 내 폰의 가상 친구(NPC) id다 */
export const isUserId = (id: string): boolean => /^[0-9a-f]{32}$/.test(id);

/** 문자열 시드로 32자 hex — 프리뷰 픽스처의 컷·글 id (같은 시드면 같은 id라 다시 그려도 캐시를 그대로 쓴다) */
export const hex32 = (seed: string): string =>
  [0, 1, 2, 3].map(k => seedFrom(`${seed}:${k}`).toString(16).padStart(8, '0')).join('');

/**
 * 피드 한 줄기 (SNS_SPEC §4): 친구 글(서버의 why 없는 항목 ∪ 내 폰의 가상 친구 글, createdAt 내림차순) → 추천(서버 순서 그대로).
 * `dividerAt`은 구분선 "새로운 사람들"이 들어갈 index (추천이 없으면 -1). 같은 글은 한 번만.
 */
export function mergeFeed(server: readonly FeedItem[], local: readonly FeedItem[]): { items: FeedItem[]; dividerAt: number } {
  const seen = new Set<string>();
  const friends: FeedItem[] = [];
  const recs: FeedItem[] = [];
  for (const i of [...server.filter(i => i.why === undefined), ...local]) {
    if (seen.has(i.post.id)) continue;
    seen.add(i.post.id);
    friends.push(i);
  }
  friends.sort((a, b) => b.post.createdAt - a.post.createdAt || (a.post.id < b.post.id ? 1 : -1));
  for (const i of server) {
    if (i.why === undefined || seen.has(i.post.id)) continue;
    seen.add(i.post.id);
    recs.push(i);
  }
  return { items: [...friends, ...recs], dividerAt: recs.length ? friends.length : -1 };
}

/** 상대 시각 — 캐릭터 시간대로 (§4 카드의 "장소 · 시각"). 방금 / n분 전 / n시간 전(같은 날) / 어제 / M월 D일 */
export function relTime(at: number, now: number, tz: string): string {
  const d = now - at;
  if (d < 60_000) return '방금';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}분 전`;
  const a = localParts(at, tz), n = localParts(now, tz);
  const sameDay = a.y === n.y && a.m === n.m && a.d === n.d;
  if (sameDay) return `${Math.floor(d / 3_600_000)}시간 전`;
  const y = localParts(now - 86_400_000, tz);
  if (a.y === y.y && a.m === y.m && a.d === y.d) return '어제';
  return `${a.m}월 ${a.d}일`;
}

/** 받침이 있으면 '과', 없으면 '와' ("윤관과 함께", "하나와 함께") — 한글이 아니면 '과' */
export function withParticle(name: string): string {
  const c = name.charCodeAt(name.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return `${name}과`;
  return `${name}${(c - 0xac00) % 28 === 0 ? '와' : '과'}`;
}

/** 주격 조사 — 받침이 있으면 '이', 없으면 '가' ("하늘이 태그됨", "민수가 태그됨") */
export function withSubject(name: string): string {
  const c = name.charCodeAt(name.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return `${name}이`;
  return `${name}${(c - 0xac00) % 28 === 0 ? '가' : '이'}`;
}

/** "하나와 함께" · "하나, 민수와 함께" — 이름을 모르는 id는 뺀다. 아무도 없으면 '' */
export function companionsLine(ids: readonly string[], nameOf: (id: string) => string | null): string {
  const names = ids.map(nameOf).filter((n): n is string => !!n);
  if (!names.length) return '';
  return `${withParticle(names.join(', '))} 함께`;
}

/** 책의 만화 id(`c:${actKey}`) → 글의 actKey. 프리뷰 만화(`c:…:0`)도 그대로 */
export const actKeyOfComic = (comicId: string): string => (comicId.startsWith('c:') ? comicId.slice(2) : comicId);

/** 만화의 그 컷을 글의 컷으로 — 구운 픽셀(shotId)이 없으면 못 싣는다 (null) */
export function cutOfPanel(comic: Comic, i: number): PostCut | null {
  const p = comic.panels[i];
  if (!p?.shotId || i < 0 || i > 3) return null;
  return { shotId: p.shotId, actKey: actKeyOfComic(comic.id), win: i as ShotWin, by: p.by ?? 'agent' };
}

/** 그 컷이 실린 만화 (글쓰기의 면 — 장소·동네·도시·범주·날짜는 첫 컷의 만화에서) */
export const comicOfCut = (book: readonly Comic[], cut: PostCut | undefined): Comic | null =>
  cut ? book.find(c => c.panels.some(p => p.shotId === cut.shotId)) ?? book.find(c => actKeyOfComic(c.id) === cut.actKey) ?? null : null;

/** 관계 배지 (FRIENDS_SPEC §6 사다리) — 같이 논 횟수 3부터 친한 친구. bond는 나중 단계(M4)가 채우니 없으면 0 */
export const CLOSE_BOND = 3;
export const relationOf = (f: Pick<Friend, 'bond'> | null | undefined): '친한 친구' | 'SNS 친구' | '스친 사이' =>
  !f ? '스친 사이' : (f.bond ?? 0) >= CLOSE_BOND ? '친한 친구' : 'SNS 친구';

/**
 * 그 사람의 대표컷 (SNS_SPEC §5): 본인이 핀한 것(RemoteAgent.repShotId) → 없으면 최근 글의 첫 컷 → 없으면 null (이름만).
 * 얼굴을 우리가 그리지 않는다 — 본인이 올린 픽셀만.
 */
export function repShotOf(pinned: string | undefined, posts: readonly Post[]): string | null {
  if (pinned) return pinned;
  const latest = [...posts].sort((a, b) => b.createdAt - a.createdAt)[0];
  return latest?.cuts[0]?.shotId ?? null;
}

/** 순서 바꾸기 — i번째를 dir만큼 옮긴 새 배열 (끝이면 그대로) */
export function moveCut<T>(arr: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return [...arr];
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** 초안 → POST /api/posts 본문. 에이전트가 쓴 그대로 올리는 것이라 editedByOwner는 false */
export const draftToPostIn = (d: PostDraft): PostIn => ({
  cuts: d.cuts, caption: d.caption, place: d.place, area: d.area, city: d.city, ...(d.category ? { category: d.category } : {}), dateKey: d.dateKey, companions: d.companions, editedByOwner: false,
});
