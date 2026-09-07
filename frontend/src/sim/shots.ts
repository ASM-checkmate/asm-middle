import type { ShotWin, UserShot } from './types';

// ─── 카메라 장면 창 (ADR-0004 오너 결정 7) ────────────────────────────────────
// 활동 시간(arriveAt~endAt)을 4등분한 창이 곧 만화의 4컷이다. "지금" 창만 촬영/재촬영할 수 있고,
// 지난 창은 잠겨서 에이전트가 채우고(sim/comic.ts의 열화 컷), 미래 창은 비활성이다.
// 여기는 순수 함수뿐이다 — 저장은 store.ts(shots/addShot), 화면은 CameraOverlay가 맡는다.

/** 창 이름 (필름 칸 칩) — 인덱스가 ShotWin */
export const WIN_LABEL: readonly string[] = ['도착', '하는 중', '한창', '마무리'];

/** progress(0..1) → 지금 창 */
export const winAt = (progress: number): ShotWin => Math.min(3, Math.max(0, Math.floor(progress * 4))) as ShotWin;

/** 활동의 창 경계 시각 4개 [arriveAt, +25%, +50%, +75%] */
export function winStarts(act: { arriveAt: number; endAt: number }): [number, number, number, number] {
  const span = Math.max(1, act.endAt - act.arriveAt);
  return [act.arriveAt, act.arriveAt + span * 0.25, act.arriveAt + span * 0.5, act.arriveAt + span * 0.75];
}

/** 이 활동의 샷을 창별로 (같은 창은 뒤 항목이 이긴다 — 재촬영). */
export function shotsFor(shots: UserShot[], actKey: string): Partial<Record<ShotWin, UserShot>> {
  const out: Partial<Record<ShotWin, UserShot>> = {};
  for (const s of shots) if (s.actKey === actKey) out[s.win] = s;
  return out;
}

/** 최근 것만 남긴다 (anchor 뒤로 사라진 활동의 샷은 만화가 이미 앨범에 있으니 버린다). requests/calls의 trim과 같은 꼴. */
export const trimShots = (shots: UserShot[], before: number): UserShot[] => shots.filter(s => s.at >= before).slice(-120);

/** 창 i가 잠겼나(지남)/지금/미래 */
export type WinState = 'past' | 'now' | 'future';
export const winState = (i: ShotWin, now: ShotWin): WinState => (i < now ? 'past' : i === now ? 'now' : 'future');
