// ─── 2.5D 방 (ADR-0015): 장소 유형별로 방이 있으면 활동 화면이 정면 무대 대신 이걸 쓴다 ────────────
import type { SceneType } from '../scenes';
import { CAFE } from './cafe';
import type { RoomSpec } from './Room';

export { RoomStage } from './RoomStage';
export type { RoomSpec } from './Room';

const ROOMS: Partial<Record<SceneType, RoomSpec>> = { cafe: CAFE };

/** 그 장소의 방. 아직 없으면 undefined — 화면은 옛 정면 무대로 */
export const roomFor = (type: SceneType): RoomSpec | undefined => ROOMS[type];
