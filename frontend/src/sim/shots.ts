import type { UserShot } from './types';

// ─── 사진 (ADR-0029: 활동 중 아무 때나, 최대 3장) ──────────────────────────────
// 옛 4창(활동 시간 4등분 = 만화 4컷, ADR-0004)은 없어졌다. 샷은 찍은 순서대로 쌓이고 앨범은 그 순서로 싣는다.
// 여기는 순수 함수뿐이다 — 저장은 store.ts(shots/addShot/removeShot), 화면은 CameraOverlay가 맡는다.

/** 활동당 최대 장수 — 셔터는 여기서 잠기고, 한 장을 지워야 다시 찍는다 */
export const MAX_SHOTS = 3;

/** 이 활동의 샷을 찍은 순서로 (같은 shotId는 뒤 항목이 이긴다 — 교체) */
export function shotsFor(shots: UserShot[], actKey: string): UserShot[] {
  const byId = new Map<string, UserShot>();
  const noId: UserShot[] = [];
  for (const s of shots) {
    if (s.actKey !== actKey) continue;
    if (s.shotId) byId.set(s.shotId, s); else noId.push(s);
  }
  return [...byId.values(), ...noId].sort((a, b) => a.at - b.at);
}

/** 최근 것만 남긴다 (anchor 뒤로 사라진 활동의 샷은 앨범이 이미 갖고 있으니 버린다). requests/calls의 trim과 같은 꼴. */
export const trimShots = (shots: UserShot[], before: number): UserShot[] => shots.filter(s => s.at >= before).slice(-120);
