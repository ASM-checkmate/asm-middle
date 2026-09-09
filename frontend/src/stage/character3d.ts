// ─── 코드로 만든 로우폴리 3D 캐릭터 (ADR-0014 개정 6) ────────────────────────
// 2D 캐릭터(character/shapes.tsx · Character.tsx)의 치수를 그대로 입체로: 큰 머리(타원체)·바가지 머리(모자꼴 캡)·정수리 곱슬·코랄 셔츠·
// 짧은 팔·발. 얼굴(눈·볼·입)은 2D의 좌표대로 캔버스에 그려 머리 앞면의 구면 조각에 입힌다(동물의 숲식 얼굴 판). 포즈는 2D의 팔 각도·
// 머리 기울기 표(ARM·HEAD_TILT·FACE)를 그대로 쓰고, 소품(스케치북·연필·책·주먹밥)은 상자·원기둥으로. 셀 셰이딩 + 잉크 외곽선(props3d).
// 좌표: 2D viewBox 200×200(y 아래)을 바닥 y=0(2D의 189행)·위가 +로 뒤집은 "캐릭터 단위". 카드 너비 = 200단위. 쓰는 쪽이 group을 축척한다.
// 움직임은 animate(t): 숨쉬기·깜빡임·걷기·손 흔들기·폴짝 — 화면(Character3D)과 활동 무대가 매 프레임 부른다.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Builder, C } from './props3d';
import type { Vec3 } from '../sim/stage';
import type { Pose } from '../character/Character';
import type { Face, Variant } from '../character/shapes';

/** 2D 표 그대로 (Character.tsx) */
const FACE: Record<Pose, Face> = {
  idle: 'default', walk: 'default', sit: 'default', sleep: 'sleep', wave: 'happy',
  draw: 'down', happy: 'happy', eat: 'default', read: 'down', think: 'up',
};
const ARM: Record<Pose, [number, number]> = {
  idle: [22, -22], walk: [22, -22], sit: [-12, 12], sleep: [34, -34], wave: [22, -138],
  draw: [-44, 58], happy: [150, -150], eat: [-112, 112], read: [-36, 36], think: [22, 100],
};
const HEAD_TILT: Partial<Record<Pose, number>> = { sleep: -12, think: -5, sit: 3 };
const ROOT_TILT: Partial<Record<Pose, number>> = { sleep: 6 };

const RAD = Math.PI / 180;
/** 2D 행(y 아래) → 캐릭터 단위 높이 (바닥 = 2D 189) */
const up = (row: number) => 189 - row;
const HAIR = 0x3A2A22, SKIN = 0xFFD9B8, CORAL = 0xFF6A48, SUN = 0xFFC64D, PAPER = 0xFFF6E6, SKY = 0xA9DCF5, NIGHT = 0x1E2440;
const FRIEND_DEFAULT = '#5FC9A6';

// ── 얼굴 판: 2D shapes.tsx Head의 좌표를 캔버스에 (머리 타원 rx 62 ry 56, 중심 0,0) ──
const FACE_PHI = 1.7;                       // 가로 ±0.85 rad
const FACE_THETA0 = Math.PI / 2 - 0.35;     // 위 0.35 rad
const FACE_THETA_LEN = 1.25;                // 아래 0.9 rad
const FACE_TEX = 512;
const faceCache = new Map<string, THREE.CanvasTexture>();
/** 얼굴 텍스처 (face · 깜빡임 · 3/4 dx 없음). 캔버스 좌표: 2D 얼굴 좌표를 구면 조각의 u·v로 */
function faceTexture(face: Face, blink: boolean, mouthOpen = false): THREE.CanvasTexture {
  const key = `${face}|${blink ? 'b' : ''}|${mouthOpen ? 'o' : ''}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = FACE_TEX; c.height = FACE_TEX;
  const ctx = c.getContext('2d')!;
  // 2D (x, y) → 캔버스 픽셀: u = 0.5 + asin(x/62)/FACE_PHI, v = (asin(y/56) + 0.35)/FACE_THETA_LEN (v는 위에서부터)
  const U = (x: number) => (0.5 + Math.asin(Math.max(-1, Math.min(1, x / 62))) / FACE_PHI) * FACE_TEX;
  const V = (y: number) => ((Math.asin(Math.max(-1, Math.min(1, y / 56))) + 0.35) / FACE_THETA_LEN) * FACE_TEX;
  const S = FACE_TEX / (62 * FACE_PHI);   // 1 단위 ≈ 픽셀 (가로 기준)
  const ink = '#2A2118', coral = '#FF6A48', white = '#fff';
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, alpha = 1) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(U(x), V(y), rx * S, ry * S * 1.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  };
  const stroke = (w: number) => { ctx.strokeStyle = ink; ctx.lineWidth = w * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; };
  const arc = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) => { ctx.beginPath(); ctx.moveTo(U(x0), V(y0)); ctx.quadraticCurveTo(U(cx), V(cy), U(x1), V(y1)); ctx.stroke(); };
  // 볼
  ellipse(-38, 26, 10, 6, coral, 0.38); ellipse(38, 26, 10, 6, coral, 0.38);
  const eyeShift = face === 'down' ? 4 : face === 'up' ? -3 : 0, eyeDx = face === 'up' ? 3 : 0;
  stroke(4);
  if (face === 'sleep' || blink) {
    arc(-28 + eyeDx, 12 + eyeShift, -20 + eyeDx, 19 + eyeShift, -12 + eyeDx, 12 + eyeShift);
    arc(12 + eyeDx, 12 + eyeShift, 20 + eyeDx, 19 + eyeShift, 28 + eyeDx, 12 + eyeShift);
  } else if (face === 'happy') {
    arc(-28, 15, -20, 4, -12, 15);
    arc(12, 15, 20, 4, 28, 15);
  } else {
    ellipse(-20 + eyeDx, 12 + eyeShift, 7.5, 7.5, ink); ellipse(20 + eyeDx, 12 + eyeShift, 7.5, 7.5, ink);
    ellipse(-17.4 + eyeDx, 9.4 + eyeShift, 2.6, 2.6, white); ellipse(22.6 + eyeDx, 9.4 + eyeShift, 2.6, 2.6, white);
    ellipse(-23 + eyeDx, 15.5 + eyeShift, 1.3, 1.3, white); ellipse(17 + eyeDx, 15.5 + eyeShift, 1.3, 1.3, white);
  }
  // 입
  if (face === 'happy') {
    ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(U(-9), V(25)); ctx.quadraticCurveTo(U(0), V(41), U(9), V(25)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = coral; ctx.beginPath(); ctx.moveTo(U(-4.5), V(31)); ctx.quadraticCurveTo(U(0), V(36), U(4.5), V(31)); ctx.closePath(); ctx.fill();
  } else if (face === 'sleep') {
    ellipse(0, 31, 3, 3, ink);
  } else if (face === 'up') {
    stroke(3); arc(-5, 29, -2.5, 32.5, 0, 29); arc(0, 29, 2.5, 32.5, 5, 29);
  } else if (mouthOpen) {
    ellipse(0, 30, 5, 6, ink);
  } else {
    stroke(4); arc(-6, 28, 0, 34, 6, 28);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  faceCache.set(key, t);
  return t;
}

export interface CharacterSpec { pose: Pose; variant: Variant; color?: string }
export interface Character3DModel {
  group: THREE.Group;
  /** t: 초. 숨쉬기·깜빡임·포즈 루프 */
  animate(t: number): void;
  dispose(): void;
}

/** 캐릭터 한 명 (캐릭터 단위, 발 원점, 정면이 +z) */
export function buildCharacter(spec: CharacterSpec): Character3DModel {
  const b = new Builder(2.6);   // 2D의 4단위 잉크선 ≈ 껍질 2.6
  const root = b.group;
  const pose = spec.pose, face = FACE[pose];
  const friend = spec.variant === 'friend';
  const accent = spec.color ?? FRIEND_DEFAULT;
  const sit = pose === 'sit';

  // 몸통: 둥근 상자 (2D 68..132 × 142..180 → 64 × 38, 두께 34)
  const body = new THREE.Group();
  root.add(body);
  b.part(new RoundedBoxGeometry(64, 38, 34, 4, 13), CORAL, [0, up(161), 0], [0, 0, 0], body);
  // 발 (2D 86/114, 182 · rx 13 ry 7; 앉으면 84/116, 184 · 15 × 9)
  const feet: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const f = new THREE.Group();
    f.position.set(sx * (sit ? 16 : 14), up(sit ? 184 : 182), 4);
    b.ellipsoid(sit ? 15 : 13, sit ? 9 : 7, 11, SKIN, [0, 0, 0], [0, 0, 0], f);
    root.add(f);
    feet.push(f);
  }
  // 팔: 어깨 축 (2D 66/134, 150), 각도는 2D ARM 그대로 (y가 뒤집혀 부호 반대)
  const arms: THREE.Group[] = [];
  const [al, ar] = ARM[pose];
  for (const [sx, deg] of [[-1, al], [1, ar]] as [number, number][]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 34, up(150), 2);
    pivot.rotation.z = -deg * RAD;
    b.ellipsoid(8, 15, 8, SKIN, [0, -15, 0], [0, 0, 0], pivot);
    root.add(pivot);
    arms.push(pivot);
  }
  // 머리: 타원체 (rx 62 ry 56, 중심 2D 96) + 바가지 캡 + 곱슬 + 얼굴 판
  const headPivot = new THREE.Group();
  headPivot.position.set(0, up(96), 0);
  headPivot.rotation.z = -(HEAD_TILT[pose] ?? 0) * RAD;
  root.add(headPivot);
  const head = new THREE.Group();
  headPivot.add(head);
  b.ellipsoid(62, 56, 58, SKIN, [0, 0, 0], [0, 0, 0], head);
  // 캡: 정수리에서 2D의 앞머리 끝(y -6 → 중심 위 6)까지. 친구는 더 둥근 단발(볼까지, y 14)
  const capEnd = friend ? 14 : -6;
  const theta = Math.acos(-capEnd / 56);
  const cap = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, theta);
  cap.scale(63.5, 57.5, 59.5);
  b.part(cap, HAIR, [0, 0, 0], [0, 0, 0], head);
  if (friend) {
    // 옆머리 한 줌 + 머리핀
    b.ellipsoid(7, 16, 7, HAIR, [24, -14, 46], [0, 0, -0.3], head);
    b.part(new RoundedBoxGeometry(18, 6, 3, 2, 3), accent, [23, 31, 52], [0, 0, 16 * RAD], head);
  } else {
    // 정수리 곱슬 (2D: M1 -55 q-6 -14 11 -12)
    const curl = new THREE.TorusGeometry(6, 2.2, 8, 14, Math.PI * 1.2);
    b.part(curl, HAIR, [4, 60, 4], [0.3, 0, 0.6], head);
  }
  // 얼굴 판: 앞면 구면 조각 (머리보다 0.8 크게)
  const faceGeo = new THREE.SphereGeometry(1, 32, 24, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_THETA0, FACE_THETA_LEN);
  faceGeo.scale(62.8, 56.8, 58.8);
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture(face, false, false), transparent: true, depthWrite: false });
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.renderOrder = 2;
  head.add(faceMesh);
  b.disposables.push(faceGeo, faceMat);
  // 친구: 목도리 (2D: 목 아래 띠 + 늘어진 자락)
  if (friend) {
    b.part(new THREE.TorusGeometry(30, 9, 10, 24), accent, [0, up(150), 0], [Math.PI / 2, 0, 0]);
    b.part(new RoundedBoxGeometry(12, 26, 8, 3, 4), accent, [22, up(164), 26], [0, 0, -0.15]);
  }
  // 소품
  if (pose === 'draw') {
    const l = arms[0]!, r = arms[1]!;
    b.part(new RoundedBoxGeometry(42, 30, 3, 1, 3), PAPER, [8, -26, 8], [0, 0, -40 * RAD], l);
    b.part(new THREE.CylinderGeometry(3.2, 3.2, 30, 10), SUN, [2, -28, 8], [0, 0, -24 * RAD], r);
    b.part(new THREE.ConeGeometry(3.2, 8, 10), SKIN, [2 - 19 * Math.sin(24 * RAD), -28 - 19 * Math.cos(24 * RAD), 8], [0, 0, Math.PI - 24 * RAD], r);
  }
  if (pose === 'read') {
    const book = new THREE.Group();
    book.position.set(0, up(166), 26);
    b.part(new RoundedBoxGeometry(28, 32, 3, 1, 3), PAPER, [-14, 0, 0], [0, 0.55, 0], book);
    b.part(new RoundedBoxGeometry(28, 32, 3, 1, 3), PAPER, [14, 0, 0], [0, -0.55, 0], book);
    b.part(new RoundedBoxGeometry(30, 34, 2, 1, 3), SKY, [-15, 0, -3], [0, 0.55, 0], book);
    b.part(new RoundedBoxGeometry(30, 34, 2, 1, 3), SKY, [15, 0, -3], [0, -0.55, 0], book);
    root.add(book);
  }
  if (pose === 'eat') {
    const rice = new THREE.ConeGeometry(20, 30, 3);
    b.part(rice, PAPER, [0, up(136), 30], [0, Math.PI / 6, 0]);
    b.part(new RoundedBoxGeometry(16, 9, 22, 1, 2), NIGHT, [0, up(146), 30]);
  }
  // 발밑 그림자 (독립 화면용 — 무대는 자기 그림자를 깐다)
  const shadowGeo = new THREE.CircleGeometry(48, 32);
  const shadowMat = new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.12, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 0.3, 1);   // 회전 뒤 local y = 세계 z: 납작한 타원
  shadow.position.set(0, 0.5, 4);
  shadow.name = 'shadow';
  root.add(shadow);
  b.disposables.push(shadowGeo, shadowMat);
  // 자는 자세: 2D의 root rotate(6)
  if (ROOT_TILT[pose]) root.rotation.z = -ROOT_TILT[pose]! * RAD;

  let blinkT = -1;
  const setFace = (blink: boolean, open = false) => { faceMat.map = faceTexture(face, blink, open); faceMat.needsUpdate = true; };
  return {
    group: root,
    animate(t) {
      const breathe = Math.sin(t * Math.PI * 2 / 2.6);
      body.scale.set(1, 1 + 0.015 * breathe, 1);
      head.position.y = 1.5 * breathe;
      // 깜빡임: 4.4초마다 120ms (자거나 웃는 얼굴은 안 감는다)
      if (face !== 'sleep' && face !== 'happy') {
        const cyc = t % 4.4;
        const closed = cyc < 0.12;
        if (closed !== (blinkT > 0)) { blinkT = closed ? 1 : -1; setFace(closed, pose === 'eat' && Math.sin(t * Math.PI * 2 / 0.9) > 0); }
        else if (pose === 'eat') setFace(closed, Math.sin(t * Math.PI * 2 / 0.9) > 0);
      }
      switch (pose) {
        case 'walk': {
          const s = Math.sin(t * Math.PI * 2 / 0.56);
          feet[0]!.position.z = 4 + 7 * s; feet[1]!.position.z = 4 - 7 * s;
          feet[0]!.position.y = up(182) + Math.max(0, 5 * s); feet[1]!.position.y = up(182) + Math.max(0, -5 * s);
          arms[0]!.rotation.x = 0.35 * s; arms[1]!.rotation.x = -0.35 * s;
          root.position.y = 1.5 * Math.abs(s);
          break;
        }
        case 'wave': arms[1]!.rotation.z = (138 + 22 * Math.sin(t * Math.PI * 2 / 0.56)) * RAD; root.rotation.z = 0.03 * Math.sin(t * Math.PI * 2 / 1.2); break;
        case 'happy': { const h = Math.abs(Math.sin(t * Math.PI / 0.9)); root.position.y = 14 * h; (root.getObjectByName('shadow') as THREE.Mesh).scale.x = 1 - 0.12 * h; break; }
        case 'draw': arms[1]!.rotation.z = (-58 + 4 * Math.sin(t * Math.PI * 2 / 0.34)) * RAD; break;
        case 'think': headPivot.rotation.z = (5 + 2 * Math.sin(t * Math.PI * 2 / 3)) * RAD; break;
        case 'sleep': body.scale.set(1, 1 + 0.02 * Math.sin(t * Math.PI * 2 / 3.6), 1); headPivot.rotation.z = (12 + 1.5 * Math.sin(t * Math.PI * 2 / 3.6)) * RAD; break;
        case 'idle': arms[0]!.rotation.z = (-22 + 3 * breathe) * RAD; arms[1]!.rotation.z = (22 - 3 * breathe) * RAD; break;
        default: break;
      }
    },
    dispose() { for (const d of b.disposables) d.dispose(); },
  };
}

/** 셀 셰이딩 조명 (캐릭터 화면용) */
export function characterLights(): THREE.Object3D[] {
  const hemi = new THREE.HemisphereLight(0xfff8ec, 0xd9c8a0, 2.4);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-120, 260, 300);
  return [hemi, key];
}

/** 캐릭터 화면의 기본 카메라: 2D viewBox 200×200을 정면에서 (살짝 위) — 발 원점, 머리 꼭대기 ≈ 165 */
export function characterCamera(aspect = 1): THREE.PerspectiveCamera {
  const dist = 700;
  const cam = new THREE.PerspectiveCamera((2 * Math.atan(100 / dist)) / RAD, aspect, 10, 3000);
  cam.position.set(0, 100 + 30, dist);
  cam.lookAt(0, 100 - 6, 0);
  return cam;
}

/** 캐릭터 단위 → 월드: 카드(200단위)가 width(W)이고 발이 feet에, 정면이 카메라(+z) 쪽 */
export function placeCharacter(model: Character3DModel, feet: Vec3, width: number, yawRad = 0): void {
  const k = width / 200;
  model.group.scale.setScalar(k);
  model.group.position.set(feet[0], feet[1], feet[2]);
  model.group.rotation.y = yawRad;
}

/** 실루엣(못 걸어본 사람): 회색·반투명 */
export function ghostify(model: Character3DModel): void {
  model.group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.Material).clone() as THREE.MeshToonMaterial | THREE.MeshBasicMaterial;
    if ('color' in mat && !(mat as THREE.MeshBasicMaterial).map) mat.color.set(0x8a7f74);
    mat.transparent = true; mat.opacity = 0.35; mat.depthWrite = false;
    m.material = mat;
  });
}
