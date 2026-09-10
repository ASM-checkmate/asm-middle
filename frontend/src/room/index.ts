// ─── 2.5D 방 (ADR-0015): 장소 유형별로 방이 있으면 활동 화면이 정면 무대 대신 이걸 쓴다 ────────────
import type { SceneType } from '../scenes';
import { CAFE } from './cafe';
import { HOME } from './home';
import { RESTAURANT } from './restaurant';
import { LIBRARY } from './library';
import { GYM } from './gym';
import { MALL } from './mall';
import { MUSEUM } from './museum';
import { PARK } from './park';
import { RIVER } from './river';
import { BEACH } from './beach';
import type { RoomSpec } from './Room';

export { RoomStage } from './RoomStage';
export type { RoomSpec } from './Room';

/** 장면 종류마다 기본 방 하나 (ADR-0015 개정 3) — 장소 유형은 scenes/index.tsx의 MAP으로 장면 종류에 묶인다 */
const ROOMS: Record<SceneType, RoomSpec> = { cafe: CAFE, home: HOME, restaurant: RESTAURANT, library: LIBRARY, gym: GYM, mall: MALL, museum: MUSEUM, park: PARK, river: RIVER, beach: BEACH };

/** 그 장소의 방. 지금은 모든 장면 종류에 방이 있다 — undefined는 없지만 화면의 폴백(정면 무대) 분기는 남겨 둔다 */
export const roomFor = (type: SceneType): RoomSpec | undefined => ROOMS[type];
