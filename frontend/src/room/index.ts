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
import { SAMJIN } from './places/samjin';
import { JOSAEHO } from './places/josaeho';
import { PNU } from './places/pnu';
import { sceneTypeFor } from '../scenes';
import type { Place } from '../sim/types';
import type { RoomSpec } from './Room';

export { RoomStage } from './RoomStage';
export type { RoomSpec } from './Room';

/** 장면 종류마다 기본 방 하나 (ADR-0015 개정 3) — 장소 유형은 scenes/index.tsx의 MAP으로 장면 종류에 묶인다 */
const ROOMS: Record<SceneType, RoomSpec> = { cafe: CAFE, home: HOME, restaurant: RESTAURANT, library: LIBRARY, gym: GYM, mall: MALL, museum: MUSEUM, park: PARK, river: RIVER, beach: BEACH };

/** 그 장소의 방. 지금은 모든 장면 종류에 방이 있다 — undefined는 없지만 화면의 폴백(정면 무대) 분기는 남겨 둔다 */
export const roomFor = (type: SceneType): RoomSpec | undefined => ROOMS[type];

/** 장소별 방 (ADR-0015 개정 4): 그 가게처럼 그린 방이 있으면 그것 — 카메라 배경(sim/backdrops)의 자리와 같은 존을 가진다. 지금은 부산 데모 셋 */
const PLACE_ROOMS: Record<string, RoomSpec> = { 'samjin-pocha': SAMJIN, josaeho: JOSAEHO, pnu: PNU };

/** 그 장소의 방: 장소별 방 → 장면 종류의 기본 방 */
export const roomForPlace = (place: Pick<Place, 'id' | 'type'>): RoomSpec | undefined => PLACE_ROOMS[place.id] ?? roomFor(sceneTypeFor(place.type));
