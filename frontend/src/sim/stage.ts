// ─── 3D 무대의 기하 (ADR-0014 개정 2: 디오라마) ─────────────────────────────
// 순수 함수뿐이다. 무대는 "카메라 투영 매핑"이다: 기본 카메라(정면, 살짝 내려다봄)에서 2D 그림이 픽셀 그대로 보이도록
// 세트(뒷막·바닥·소품 카드·인물 카드)의 꼭짓점을 그림의 점을 세트 표면에 되쏘아(unproject) 놓는다. 카메라가 움직여야 비로소
// 세트의 입체가 드러난다. 단위는 프레임 너비 W = 1. 프레임은 W × 1.08W, 발(캐릭터 발·바닥 접점)은 위에서 78 %.
// 좌표: 바닥이 y = 0, 캐릭터 발이 원점, 카메라는 +z 쪽에서 -z를 본다. 화면 배선(three.js)은 stage/render.ts.

export const FRAME_ASPECT = 1.08;
/** 캐릭터 발 높이 (프레임 위에서부터, 비율) — 회전·확대의 중심이자 카메라가 도는 축 */
export const ANCHOR_Y = 0.78;
/** 기본 카메라 ↔ 캐릭터 평면 거리 (W 단위). 시야각 ≈ 45° */
export const CAM_DIST = 1.3;
/** 기본 카메라가 내려다보는 각 (°). 눈높이는 발이 78 %에 오도록 여기서 정해진다 */
export const CAM_PITCH = 10;
/** 뒷막(벽·하늘)의 거리 상한·하한 (D 배수). 그림의 바닥 경계선 높이에서 정해지되 이 안으로 */
export const WALL_K_MIN = 1.6;
export const WALL_K_MAX = 4;
/** 무대 그림: viewBox 390×844, 넓은 텍스처는 x -195..585. 프레임은 가운데 절반(행 211..633), 가로 0..390 */
export const STAGE_W = 390;
export const STAGE_H = 844;
export const TEX_LEFT = -195;
export const TEX_W = 780;
/** 인물의 깊이 — 2D의 z-index(ghost < friend < me < met)를 앞뒤로 (캐릭터 평면 = 1) */
export const CAST_DEPTH = { ghost: 1.25, friend: 1.06, me: 1.0, met: 0.94 } as const;
export type CastName = keyof typeof CAST_DEPTH;

export interface StageCrop { scale: number; x: number; y: number; rot: number; pitch?: number; yaw?: number }
export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const rotY = (v: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
const rotX = (v: Vec3, a: number): Vec3 => { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; };
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rotAxis = (v: Vec3, k: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
};

/** 그림 좌표 → 프레임 비율 (fx: 오른쪽 +, W 단위 · fy: 아래 +, H 단위). 프레임 중심 = (col 195, row 422) */
export const frameOfCol = (col: number): number => (col - STAGE_W / 2) / STAGE_W;
export const frameOfRow = (row: number): number => (row - STAGE_H / 2) / (STAGE_H / 2);
export const colOfFrame = (fx: number): number => STAGE_W / 2 + fx * STAGE_W;
export const rowOfFrame = (fy: number): number => STAGE_H / 2 + fy * (STAGE_H / 2);

/** 기본 카메라의 눈높이: 발(fx 0, fy 0.28)로 가는 광선이 원점을 지나도록 */
export function eyeHeight(dist = CAM_DIST, pitchDeg = CAM_PITCH): number {
  const d = rayDir(0, ANCHOR_Y - 0.5, pitchDeg, dist);
  const t = -dist / d[2];          // z: dist → 0
  return -t * d[1];                // y: h → 0 이 되는 h
}

/** 기본 카메라에서 프레임 점 (fx, fy)로 나가는 광선 방향 (정규화 안 함). 카메라 공간 (fx·W, -fy·H, -D)를 pitch만큼 숙인다 */
export function rayDir(fx: number, fy: number, pitchDeg = CAM_PITCH, dist = CAM_DIST): Vec3 {
  return rotX([fx, -fy * FRAME_ASPECT, -dist], -pitchDeg * RAD);
}

export interface Ray { o: Vec3; d: Vec3 }
export function rayFromFrame(fx: number, fy: number, dist = CAM_DIST, pitchDeg = CAM_PITCH): Ray {
  return { o: [0, eyeHeight(dist, pitchDeg), dist], d: rayDir(fx, fy, pitchDeg, dist) };
}
/** 바닥(y = 0)과 만나는 점 — 지평선 위면 null */
export function hitGround(r: Ray): Vec3 | null {
  if (r.d[1] >= -1e-9) return null;
  const t = -r.o[1] / r.d[1];
  return add(r.o, scale(r.d, t));
}
/** 세운 평면 z = z0과 만나는 점 */
export function hitVertical(r: Ray, z0: number): Vec3 {
  const t = (z0 - r.o[2]) / r.d[2];
  return add(r.o, scale(r.d, t));
}

/** 그림의 바닥 경계선(벽과 바닥이 만나는 행)에서 뒷막의 거리(D 배수). 광선이 바닥에 안 닿으면(지평선 위) 상한 */
export function wallDepth(junctionRow: number): number {
  const p = hitGround(rayFromFrame(0, frameOfRow(junctionRow)));
  if (!p) return WALL_K_MAX;
  const k = (CAM_DIST - p[2]) / CAM_DIST;
  return Math.min(WALL_K_MAX, Math.max(WALL_K_MIN, k));
}
/** 뒷막 평면의 z (k = D 배수) */
export const wallZ = (k: number): number => CAM_DIST * (1 - k);
/** 뒷막 발치가 화면에 보이는 행 — 그 위는 뒷막에, 아래는 바닥에 그린다 */
export function wallFootRow(k: number): number {
  const h = eyeHeight();
  const z = wallZ(k);
  // 발치 점 (0, 0, z)로 가는 방향을 카메라 공간으로 되돌려 fy를 얻는다
  const v = rotX([0, -h, z - CAM_DIST], CAM_PITCH * RAD);   // pitch 되돌림
  const fy = (v[1] / v[2]) * (CAM_DIST / FRAME_ASPECT);       // -y/-z · D/H
  return rowOfFrame(fy);
}

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
/** 인물 상자를 그림 좌표(행·열)로: 정사각 카드, 아래 끝이 bottom·H */
export function castRect(who: CastName, hasFriend: boolean, hasMet: boolean): { x0: number; y0: number; x1: number; y1: number } {
  const b = castBox(who, hasFriend, hasMet);
  const side = b.w * STAGE_W;
  const y1 = rowOfFrame(b.bottom - 0.5);
  const cx = colOfFrame(b.cx - 0.5);
  return { x0: cx - side / 2, y0: y1 - side, x1: cx + side / 2, y1 };
}

export interface StagePose {
  pos: Vec3;
  target: Vec3;
  up: Vec3;
  zoom: number;
  /** 화면 이동 (W, H 비율, 아래가 +): 확대·기울임을 발 기준으로 만들고 끌기(x/y)를 더한 것 */
  offset: [number, number];
}

/**
 * ShotCrop → 카메라 자세. 기본 카메라(0, h, D)가 CAM_PITCH만큼 숙인 채 발(원점)을 축으로 yaw(오른쪽에서 보면 +)·pitch(위에서 보면 +)만큼
 * 돈다 — 뒤의 세트는 카메라 쪽으로, 앞의 세트는 반대로 밀리고 원근이 실제로 계산된다. rot(화면 시계 방향 +)은 롤, scale은 줌.
 * 2D에서 확대·기울임의 중심이 발(transform-origin 50 % 78 %)이었으므로 화면 이동(offset)으로 발이 제자리에 남게 보정하고 끌기를 더한다.
 * 활동 화면(full)은 같은 카메라로 무대 전체를 본다: zoom 0.5(세로 844행 = 프레임 두 배), 보정 없음 — 기본 각도에서 2D 무대 그대로.
 */
export function stagePose(c: StageCrop, dist = CAM_DIST, full = false): StagePose {
  const H = FRAME_ASPECT;
  const yaw = (c.yaw ?? 0) * RAD, pitch = (c.pitch ?? 0) * RAD, tilt = -CAM_PITCH * RAD;
  const orbit = (v: Vec3): Vec3 => rotY(rotX(v, -pitch), yaw);
  const pos = orbit([0, eyeHeight(dist), dist]);
  const fwd = orbit(rotX([0, 0, -1], tilt));
  let up = orbit(rotX([0, 1, 0], tilt));
  const target = add(pos, fwd);
  // 롤: 시선 축 둘레로. 축이 보는 방향이면 + 회전이 화면에서 시계 방향인데, 카메라가 돌면 세상은 반대로 도니 -rot
  up = norm(rotAxis(up, norm(fwd), -c.rot * RAD));
  // 화면 이동 (W 단위, 아래가 +): o = p − S·R·p + S·R·t, p = 발 − 중심, t = 끌기
  const s = c.scale, a = c.rot * RAD, cr = Math.cos(a), sr = Math.sin(a);
  const R = (v: [number, number]): [number, number] => [v[0] * cr - v[1] * sr, v[0] * sr + v[1] * cr];
  // full: 무대 전체(390×844)를 보는 활동 화면 — 확대·기울임의 중심이 화면 가운데라 발 기준 보정이 없다
  const p: [number, number] = full ? [0, 0] : [0, (ANCHOR_Y - 0.5) * H];
  const t: [number, number] = [c.x / 100, (c.y / 100) * H];
  const Rp = R(p), Rt = R(t);
  const o: [number, number] = [p[0] - s * Rp[0] + s * Rt[0], p[1] - s * Rp[1] + s * Rt[1]];
  return { pos, target, up, zoom: s, offset: [o[0], o[1] / H] };
}

/** 카메라 세로 시야각(°): 깊이 D의 평면이 프레임 높이와 딱 맞게 */
export const stageFov = (dist = CAM_DIST): number => (2 * Math.atan(FRAME_ASPECT / 2 / dist)) / RAD;
