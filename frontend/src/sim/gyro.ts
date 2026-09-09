// ─── 자이로 → 카메라 각도 (ADR-0014) ─────────────────────────────────────────
// 순수 함수뿐이다: DeviceOrientation의 (alpha, beta, gamma)를 회전 행렬로 만들고, 카메라를 연 순간의 자세를 0점 삼아
// 그 뒤의 상대 회전에서 "폰을 옆으로 돌린 각(yaw, 기기 y축)"과 "앞뒤로 젖힌 각(pitch, 기기 x축)"만 뽑는다.
// 오일러 각을 그대로 빼면 폰을 세웠을 때(beta≈90°) alpha·gamma가 짐벌락으로 튀지만, 행렬끼리의 상대 회전은 멀쩡하다.
// 화면 배선(권한·리스너·rAF)은 screens/useGyro.ts, 각도의 쓰임은 screens/camera.css(.cam-stage .sc-*)와 character.css.

/** 3×3 행렬, 행 우선 9칸 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
/** 도(°). yaw: 오른쪽으로 돌리면 + (카메라가 캐릭터의 오른쪽에서 본다) · pitch: 위를 보게 젖히면 + */
export interface Angles { yaw: number; pitch: number }

const RAD = Math.PI / 180;

/** W3C DeviceOrientation의 Z-X'-Y'' 회전 행렬 (기기 좌표 → 지구 좌표). */
export function rotationMatrix(alpha: number, beta: number, gamma: number): Mat3 {
  const cZ = Math.cos(alpha * RAD), sZ = Math.sin(alpha * RAD);
  const cX = Math.cos(beta * RAD), sX = Math.sin(beta * RAD);
  const cY = Math.cos(gamma * RAD), sY = Math.sin(gamma * RAD);
  return [
    cZ * cY - sZ * sX * sY, -cX * sZ, cY * sZ * sX + cZ * sY,
    cY * sZ + cZ * sX * sY, cZ * cX, sZ * sY - cZ * cY * sX,
    -cX * sY, sX, cX * cY,
  ];
}

/** A·B */
export function mul(a: Mat3, b: Mat3): Mat3 {
  const m = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return m as Mat3;
}

/** Aᵀ·B — 0점 자세 A의 기기 좌표계에서 본 지금 자세 B (열 = 지금 기기 축). */
export function relative(a: Mat3, b: Mat3): Mat3 {
  const m = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = a[i] * b[j] + a[3 + i] * b[3 + j] + a[6 + i] * b[6 + j];
  return m as Mat3;
}

/** 상대 회전에서 yaw·pitch(°). 지금 기기 z축(화면 법선)이 0점 좌표계에서 어디를 보는지로 읽는다 — 셋째 열. */
export function anglesOf(rel: Mat3): Angles {
  const zx = rel[2], zy = rel[5], zz = rel[8];
  return { yaw: Math.atan2(zx, zz) / RAD, pitch: Math.atan2(-zy, zz) / RAD };
}

export interface GyroFilterOpts {
  /** 이 안의 흔들림은 0으로 (°, 부드러운 데드존 — 넘어선 만큼만 센다) */
  dead: number;
  /** 로우패스 계수 0..1 (1 = 필터 없음) */
  alpha: number;
  /** 카메라 방향 상한 (°) — 종이 층이라 큰 각은 들통난다 */
  yawMax: number;
  /** 카메라 각도 상한 (°) */
  pitchMax: number;
}
export const GYRO_DEFAULTS: GyroFilterOpts = { dead: 0.8, alpha: 0.25, yawMax: 12, pitchMax: 14 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const soften = (v: number, dead: number) => (Math.abs(v) < dead ? 0 : v - Math.sign(v) * dead);
const stepTo = (v: number, q: number) => Math.round(v / q) * q;

/** 데드존 → 상한 → 로우패스. 결과는 슬라이더 눈금(yaw 0.5° · pitch 1°)에 맞춰 반올림한다 — 같은 값이면 화면이 다시 안 그린다. */
export function createFilter(o: GyroFilterOpts = GYRO_DEFAULTS) {
  let y = 0, p = 0;
  return {
    push(a: Angles): Angles {
      const ty = clamp(soften(a.yaw, o.dead), -o.yawMax, o.yawMax);
      const tp = clamp(soften(a.pitch, o.dead), -o.pitchMax, o.pitchMax);
      y += (ty - y) * o.alpha;
      p += (tp - p) * o.alpha;
      return { yaw: stepTo(y, 0.5) + 0, pitch: stepTo(p, 1) + 0 };   // +0: -0을 0으로
    },
    reset() { y = 0; p = 0; },
  };
}
