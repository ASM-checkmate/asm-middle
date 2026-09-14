// ─── 방 (public/rooms/<방>/room.json, scripts/room-build.py) ────────────────────────────────
// 방은 그림 한 장이고, 사람은 늘 그 위에 그려진다. 가구 뒤로 들어갈 일이 없으니 소품을 떼어 앞뒤를 정할 필요가 없다 —
// 대신 **걸을 수 있는 바닥(walk)** 밖으로는 못 나가게 막고, 바닥 위의 **트리거존(zones)** 에 들어서면 그 자리의 동작이 걸린다.
export type Pt = [number, number];

/** 존에 들어서면 트는 장면. 프레임은 '그 물건 + 사람'이 함께 그려진 방 전체 그림이라 배경째 갈아 끼운다 */
export interface RoomScene { ko: string; frames: string[]; interval: number }
/** 바닥 위의 칸: 여기 들어서면 scene 이 걸린다. stand 는 그때 사람이 서는 자리(장면 중엔 사람을 안 그리니 표시용) */
export interface RoomZone { id: string; ko: string; scene: string; rect: [number, number, number, number]; stand: Pt }

export interface RoomJson {
  id: string; w: number; h: number;
  back: string;
  /** 원근: 사람 크기는 발 y 가 vanishY 에서 멀수록 커진다 */
  vanishY: number;
  /** 걸을 수 있는 바닥 (다각형). 밖을 누르면 가장 가까운 가장자리로 간다 */
  walk: Pt[];
  /** 방에 들어와 서는 자리 */
  home: Pt;
  zones: RoomZone[];
  scenes: Record<string, RoomScene>;
}

/** 방 안의 발 y 에서의 사람 크기 배율 — 원근을 살짝만 준다 (뒷벽 쪽 MIN_SCALE … 맨 앞 1). 크게 줄이면 이동할 때 확 작아져 어색하다 */
export const MIN_SCALE = 0.88;
export const scaleAt = (room: RoomJson, y: number) => {
  const t = Math.min(1, Math.max(0, (y - room.vanishY) / (room.h - room.vanishY)));
  return MIN_SCALE + (1 - MIN_SCALE) * t;
};

export const inRect = (z: RoomZone, x: number, y: number) => x >= z.rect[0] && x <= z.rect[2] && y >= z.rect[1] && y <= z.rect[3];
export const zoneAt = (room: RoomJson, x: number, y: number) => room.zones.find(z => inRect(z, x, y));

/** 점이 다각형 안인가 (ray casting) */
export function inside(poly: Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 다각형 밖이면 가장 가까운 가장자리 위의 점으로 끌어들인다 (바닥 밖으로는 못 걷게) */
export function clamp(poly: Pt[], x: number, y: number): Pt {
  if (inside(poly, x, y)) return [x, y];
  let best: Pt = poly[0], bd = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i];
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
    const px = x1 + t * dx, py = y1 + t * dy;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = [px, py]; }
  }
  return best;
}
