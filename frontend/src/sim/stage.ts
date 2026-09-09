// ─── 3D 무대의 기하 (ADR-0014 개정) ─────────────────────────────────────────
// 순수 함수뿐이다: 프레임 비율·발 높이·깊이 표, 2D 카메라(ShotCrop)를 3D 카메라 자세로 옮기는 식, 캐릭터 상자.
// 단위는 프레임 너비 W = 1. 프레임은 W × 1.08W(만화 컷 비율), 캐릭터 발이 위에서 78 %(camera.css .cam-me와 같다).
// 기본 카메라(yaw·pitch 0)는 원점을 보고 원점 평면(깊이 D)이 프레임과 정확히 겹친다 — 그래서 2D 구도가 그대로 재현된다.
// 화면 배선(three.js)은 stage/render.ts.

export const FRAME_ASPECT = 1.08;
/** 캐릭터 발 높이 (프레임 위에서부터, 비율) — 회전·확대의 중심이자 카메라가 도는 축 */
export const ANCHOR_Y = 0.78;
/** 카메라 ↔ 캐릭터 평면 거리 (W 단위). 시야각 ≈ 45°. 같은 각도에서 시차는 D에 비례해 커진다 */
export const CAM_DIST = 1.3;
/** 무대 그림(390×844)의 세로/가로 */
export const SCENE_TEX_ASPECT = 844 / 390;
/** 층의 깊이 (캐릭터 평면 = 1). far·mid·floor는 뒤, front는 앞 */
export const LAYER_DEPTH = { far: 2.0, mid: 1.45, floor: 1.2, front: 0.75 } as const;
export type LayerName = keyof typeof LAYER_DEPTH;
export const LAYERS: readonly LayerName[] = ['far', 'mid', 'floor', 'front'];
/** 인물의 깊이 — 2D의 z-index(ghost < friend < me < met)를 앞뒤로 */
export const CAST_DEPTH = { ghost: 1.25, friend: 1.06, me: 1.0, met: 0.94 } as const;
export type CastName = keyof typeof CAST_DEPTH;

export interface StageCrop { scale: number; x: number; y: number; rot: number; pitch?: number; yaw?: number }

/** 인물 상자 — camera.css의 .cam-me/.cam-friend/.cam-met/.cam-ghost 그대로. cx·w는 W 비율, bottom은 위에서부터 H 비율 */
export function castBox(who: CastName, hasFriend: boolean, hasMet: boolean): { cx: number; w: number; bottom: number } {
  switch (who) {
    case 'me': {
      const w = 0.84;
      const cx = hasFriend && hasMet ? 0.44 : hasFriend || hasMet ? 0.39 : 0.5;
      return { cx, w, bottom: 0.78 + (0.09 * w) / FRAME_ASPECT };
    }
    case 'friend': return { cx: 0.56 + 0.31, w: 0.62, bottom: 0.80 + (0.09 * 0.62) / FRAME_ASPECT };
    case 'met': return hasFriend
      ? { cx: 0.53 + 0.265, w: 0.53, bottom: 0.84 + (0.09 * 0.53) / FRAME_ASPECT }
      : { cx: 0.60 + 0.265, w: 0.53, bottom: 0.82 + (0.09 * 0.53) / FRAME_ASPECT };
    case 'ghost': return { cx: 0.49 + 0.265, w: 0.53, bottom: 0.70 };
  }
}

export type Vec3 = [number, number, number];
export interface StagePose {
  pos: Vec3;
  target: Vec3;
  up: Vec3;
  zoom: number;
  /** 화면 이동 (W, H 비율, 아래가 +): 확대·기울임을 발 기준으로 만들고 끌기(x/y)를 더한 것 */
  offset: [number, number];
}

const RAD = Math.PI / 180;
const rotY = (v: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
const rotX = (v: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** 로드리게스: v를 축 k(단위) 둘레로 a만큼 */
const rotAxis = (v: Vec3, k: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
};

/**
 * ShotCrop → 카메라 자세.
 * yaw(오른쪽에서 보면 +)·pitch(위에서 보면 +)는 발 축(원점 평면의 78 % 지점)을 중심으로 카메라를 돌린다 — 뒤의 층은 카메라 쪽으로,
 * 앞의 층은 반대로 밀리고 원근이 실제로 계산된다. rot(기울임, 화면 시계 방향 +)은 카메라 롤, scale은 카메라 줌.
 * 2D에서 확대·기울임의 중심이 발이었으므로(transform-origin 50 % 78 %) 화면 이동(offset)으로 발이 제자리에 남게 보정하고 끌기를 더한다.
 */
export function stagePose(c: StageCrop, dist = CAM_DIST): StagePose {
  const H = FRAME_ASPECT;
  const pivot: Vec3 = [0, (0.5 - ANCHOR_Y) * H, 0];
  const yaw = (c.yaw ?? 0) * RAD, pitch = (c.pitch ?? 0) * RAD;
  const orbit = (v: Vec3): Vec3 => add(pivot, rotY(rotX(sub(v, pivot), -pitch), yaw));
  const pos = orbit([0, 0, dist]);
  const target = orbit([0, 0, 0]);
  let up = rotY(rotX([0, 1, 0], -pitch), yaw);
  // 롤: 시선 축 둘레로. 축이 보는 방향(멀어지는 쪽)이면 + 회전이 화면에서 시계 방향으로 보이는데, 카메라가 돌면 세상은 반대로 도니 -rot
  const dir = norm(sub(target, pos));
  up = norm(rotAxis(up, dir, -c.rot * RAD));
  // 화면 이동 (W 단위, 아래가 +): o = p − S·R·p + S·R·t, p = 발 − 중심, t = 끌기
  const s = c.scale, a = c.rot * RAD, cr = Math.cos(a), sr = Math.sin(a);
  const R = (v: [number, number]): [number, number] => [v[0] * cr - v[1] * sr, v[0] * sr + v[1] * cr];
  const p: [number, number] = [0, (ANCHOR_Y - 0.5) * H];
  const t: [number, number] = [c.x / 100, (c.y / 100) * H];
  const Rp = R(p), Rt = R(t);
  const o: [number, number] = [p[0] - s * Rp[0] + s * Rt[0], p[1] - s * Rp[1] + s * Rt[1]];
  return { pos, target, up, zoom: s, offset: [o[0], o[1] / H] };
}

/** 카메라 세로 시야각(°): 깊이 D의 평면이 프레임 높이와 딱 맞게 */
export const stageFov = (dist = CAM_DIST): number => (2 * Math.atan(FRAME_ASPECT / 2 / dist)) / RAD;
