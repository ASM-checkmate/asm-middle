// ─── 친구 줄의 글 (FriendsTab·ProfileView가 같이 쓴다) — 옛 FriendsOverlay의 nowLine·homeArea ──────────────────────────
import type { DayKey, Friend } from '../../sim/types';
import { friendNow } from '../../sim/agents';
import { blockDef } from '../../sim/blocks';
import { placeById } from '../../sim/places';

/** 친구의 '지금' — NPC는 내 블록·내 하루로, 진짜 사람은 발행된 활동으로 (sim/agents.ts friendNow) */
export const nowLineOf = (f: Friend, now: number, tz: string, today: DayKey): string => {
  const n = friendNow(f, now, tz, today);
  if (n.kind === 'sleep') return '자는 중';
  if (n.kind === 'home') return '집에서 쉬는 중';
  return `${blockDef(n.blockId).label} · ${n.title}`;
};
/** 집을 모르는 친구(캐시가 아직 안 온 진짜 사람)라도 목록이 깨지면 안 된다 */
export const homeAreaOf = (homePlaceId: string): string => { try { return placeById(homePlaceId).area; } catch { return '어딘가'; } };
