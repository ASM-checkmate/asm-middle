// ─── PNG 레이어 방 (scripts/cut-room.py 가 쓰는 public/rooms/<id>/room.json) ───────────────────
// 기존 RoomSpec(src/room/Room.tsx)과 같은 생각 — 뒤 그림 + 바닥 접점(base)으로 앞뒤가 정해지는 소품 + 자리(spot) — 인데 그림이 PNG 다.
export interface RoomProp { id: string; src: string; x: number; y: number; w: number; h: number; /** 바닥 접점 행 — 인물의 발 y 와 비교해 앞뒤를 정한다 */ base: number; /** 평소엔 안 그리는 조각 (닫힌 문 등) — 화면이 켜서 쓴다 */ hidden?: boolean }
export type SpotPose = 'idle' | 'lie' | 'sit' | 'scene';
/** z: 앞뒤를 발 y 대신 이 값으로 (침대 위에 누우면 침대 틀(380)보다 앞, 이불(386)보다 뒤) */
export interface RoomSpot { x: number; y: number; pose: SpotPose; z?: number; /** 그 자세 그림의 높이(px) — 없으면 원근 배율로 */ size?: number; /** pose 'scene': 도착하면 트는 장면 */ scene?: string }
/** 제자리 동작: 갈아 끼우는 소품(replaces)을 숨기고 frames(hidden 소품 id)를 interval 마다 바꿔 튼다. 사람은 안 그린다 */
export interface RoomScene { frames: string[]; replaces: string[]; interval: number }
export interface RoomJson {
  id: string; w: number; h: number;
  back: string;
  /** 소실점 y — 인물 크기는 (y − vanishY)/(h − vanishY) 에 비례 (앞에서 1, 뒷벽 쪽으로 갈수록 작게) */
  vanishY: number;
  props: RoomProp[];
  spots: Record<string, RoomSpot>;
  scenes?: Record<string, RoomScene>;
}

/** 방 안의 발 y 에서의 인물 크기 배율 — 원근을 살짝만 준다 (뒷벽 쪽 MIN_SCALE … 맨 앞 1). 크게 줄이면 이동할 때 캐릭터가 확 작아져 어색하다 */
export const MIN_SCALE = 0.88;
export const scaleAt = (room: RoomJson, y: number) => {
  const t = Math.min(1, Math.max(0, (y - room.vanishY) / (room.h - room.vanishY)));
  return MIN_SCALE + (1 - MIN_SCALE) * t;
};
