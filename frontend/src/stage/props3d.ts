// ─── 코드로 만든 로우폴리 소품 (ADR-0014 개정 3 프로토타입) ──────────────────
// 모델 파일 없이 기본 도형(원기둥·상자·타원체)을 조합하고 셀 셰이딩(3단 그라디언트) + 잉크 외곽선(법선 방향으로 밀어낸 뒷면 껍질)을
// 입힌다. 자리와 크기는 2D 그림의 소품 상자·바닥 접점(PropSprite)에서 그대로 가져와 기본 각도에서 그림과 같은 자리에 선다.
// 장소별 빌더가 맡은 소품 번호(P 순서)를 돌려주면 render.ts는 그 소품의 종이 카드를 생략한다. 아직 카페뿐이다.
import * as THREE from 'three';
import { CAM_DIST, STAGE_W, frameOfCol, frameOfRow, hitGround, hitVertical, rayFromFrame } from '../sim/stage';
import type { Vec3 } from '../sim/stage';
import type { PropSprite } from './textures';
import type { SceneType } from '../scenes';

/** 덱 토큰 색 (tokens.css) — scenes.css의 color-mix 파생색은 미리 섞어 둔 값 */
const C = {
  ink: 0x2A2118, paper: 0xFFF6E6, paper2: 0xFFEBCB, card: 0xFFFFFF, coral: 0xFF6A48, sun: 0xFFC64D, mint: 0x5FC9A6, leaf: 0x8FD37E,
  wood: 0xCDA862, wood2: 0xA6864C, ink3: 0xA08C76,
} as const;

let gradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
const inkMat = () => new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });

/** 외곽선 껍질: 꼭짓점을 법선 방향으로 w만큼 밀어낸 같은 도형을 뒷면만 잉크색으로 */
function hull(geo: THREE.BufferGeometry, w: number): THREE.BufferGeometry {
  const g = geo.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * w, p.getY(i) + n.getY(i) * w, p.getZ(i) + n.getZ(i) * w);
  p.needsUpdate = true;
  return g;
}

export interface Built { group: THREE.Group; disposables: { dispose(): void }[] }

class Builder {
  group = new THREE.Group();
  disposables: { dispose(): void }[] = [];
  /** 외곽선 두께 (W 단위) — 2D의 3px 잉크선 ≈ 390분의 3 */
  line = 3.2 / STAGE_W;

  /** 도형 하나 + 외곽선. 위치는 월드, 회전은 라디안 */
  part(geo: THREE.BufferGeometry, color: number, at: Vec3, rot: [number, number, number] = [0, 0, 0]): THREE.Mesh {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(...at);
    m.rotation.set(...rot);
    const h = new THREE.Mesh(hull(geo, this.line), inkMat());
    h.position.copy(m.position);
    h.rotation.copy(m.rotation);
    this.group.add(m, h);
    this.disposables.push(geo, m.material as THREE.Material, h.geometry, h.material as THREE.Material);
    return m;
  }
  cylinder(rTop: number, rBottom: number, h: number, color: number, at: Vec3, seg = 24): THREE.Mesh {
    return this.part(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, at);
  }
  box(w: number, h: number, d: number, color: number, at: Vec3): THREE.Mesh {
    return this.part(new THREE.BoxGeometry(w, h, d), color, at);
  }
  ellipsoid(rx: number, ry: number, rz: number, color: number, at: Vec3, rot: [number, number, number] = [0, 0, 0]): THREE.Mesh {
    const g = new THREE.SphereGeometry(1, 20, 14);
    g.scale(rx, ry, rz);
    return this.part(g, color, at, rot);
  }
}

/** 소품 상자의 바닥 접점을 월드로: 자리(x, z)와 그 깊이의 축척(그림 1열 = 몇 W) */
function footOf(p: PropSprite): { x: number; z: number; s: number } | null {
  const g = hitGround(rayFromFrame(frameOfCol((p.x0 + p.x1) / 2), frameOfRow(p.base)));
  if (!g) return null;
  return { x: g[0], z: g[2], s: (CAM_DIST - g[2]) / CAM_DIST / STAGE_W };
}
/** 세운 평면 z 위의 그림 점 → 월드 (매달린 것) */
const onPlane = (col: number, row: number, z: number): Vec3 => hitVertical(rayFromFrame(frameOfCol(col), frameOfRow(row)), z);

// ── 카페: P 순서 = 0 램프 · 1 화분 · 2 카운터 · 3 러그(눕는다, 그대로) · 4 테이블 · 5 스툴 ──
function cafe(props: PropSprite[]): { built: Built; handled: Set<number> } {
  const b = new Builder();
  const handled = new Set<number>();
  const f = (i: number) => { const p = props[i]; return p ? footOf(p) : null; };

  // 램프: 천장에서 늘어진 줄 + 원뿔 갓 + 전구 (그림: translate(304 0), 줄 0..104, 갓 102..132)
  const lamp = props[0] && footOf(props[0]);
  if (lamp) {
    const z = lamp.z, s = lamp.s;
    const top = onPlane(304, 0, z), shade = onPlane(304, 117, z);
    b.cylinder(1.2 * s, 1.2 * s, top[1] - shade[1] + 15 * s, C.ink, [top[0], (top[1] + shade[1]) / 2 + 7 * s, z]);
    b.cylinder(8 * s, 26 * s, 30 * s, C.coral, [shade[0], shade[1], z]);
    b.ellipsoid(9 * s, 9 * s, 9 * s, C.sun, [shade[0], shade[1] - 14 * s, z]);
    handled.add(0);
  }
  // 화분: 화분(윗면이 넓은 원기둥) + 테 + 잎 세 장 (그림: translate(40 420) scale .9)
  const plant = f(1);
  if (plant) {
    const { x, z, s } = plant, k = 0.9 * s;
    b.cylinder(22 * k, 16 * k, 34 * k, C.coral, [x, 17 * k, z]);
    b.cylinder(26 * k, 26 * k, 12 * k, C.coral, [x, 34 * k + 4 * k, z]);
    const stem = 40 * k;
    b.cylinder(2 * k, 2.5 * k, 60 * k, C.ink3, [x, stem + 24 * k, z]);
    b.ellipsoid(12 * k, 20 * k, 6 * k, C.leaf, [x - 14 * k, stem + 60 * k, z + 4 * k], [0, 0, 0.5]);
    b.ellipsoid(11 * k, 18 * k, 6 * k, C.leaf, [x + 40 * k, stem + 46 * k, z - 2 * k], [0, 0.4, -0.9]);
    b.ellipsoid(11 * k, 20 * k, 6 * k, C.leaf, [x + 16 * k, stem + 72 * k, z], [0, -0.3, -0.15]);
    handled.add(1);
  }
  // 카운터: 몸통 상자 + 윗판 + 커피머신 + 컵 (그림: translate(246 466), 판 -4..146×0..20, 몸통 4..138×20..140)
  const counter = f(2);
  if (counter) {
    const { x, z, s } = counter;
    const depth = 64 * s, h = 120 * s, w = 134 * s;
    b.box(w, h, depth, C.card, [x, h / 2, z]);
    b.box(150 * s, 20 * s, depth + 12 * s, C.wood2, [x, h + 10 * s, z]);
    b.box(48 * s, 50 * s, 40 * s, C.ink, [x + 29 * s, h + 20 * s + 25 * s, z - 6 * s]);
    b.box(32 * s, 12 * s, 6 * s, C.paper, [x + 29 * s, h + 20 * s + 36 * s, z + 15 * s]);
    b.cylinder(14 * s, 11 * s, 24 * s, C.paper, [x - 31 * s, h + 20 * s + 12 * s, z + 4 * s]);
    handled.add(2);
  }
  // 테이블: 윗판 원판 + 기둥 + 받침 + 컵 + 폰 (그림: translate(182 536), 판 rx 64, 기둥 80, 받침 76, 컵 (-12,-24))
  const table = f(4);
  if (table) {
    const { x, z, s } = table;
    const top = 86 * s;
    b.cylinder(38 * s, 38 * s, 10 * s, C.wood2, [x, 5 * s, z]);
    b.cylinder(6 * s, 6 * s, top, C.wood2, [x, top / 2, z]);
    b.cylinder(64 * s, 64 * s, 8 * s, C.wood, [x, top + 4 * s, z]);
    b.cylinder(15 * s, 12 * s, 24 * s, C.coral, [x - 12 * s, top + 8 * s + 12 * s, z + 6 * s]);
    b.box(30 * s, 4 * s, 16 * s, C.mint, [x + 31 * s, top + 10 * s, z - 4 * s]);
    handled.add(4);
  }
  // 스툴: 코랄 방석 + 나무 판 + 다리 셋 (그림: translate(66 566), 방석 rx 28, 다리 56)
  const stool = f(5);
  if (stool) {
    const { x, z, s } = stool;
    const h = 56 * s;
    for (const a of [0, 2.1, 4.2]) b.cylinder(2.6 * s, 2.6 * s, h, C.ink, [x + Math.cos(a) * 18 * s, h / 2, z + Math.sin(a) * 18 * s]);
    b.cylinder(28 * s, 28 * s, 8 * s, C.wood2, [x, h + 4 * s, z]);
    b.cylinder(28 * s, 26 * s, 10 * s, C.coral, [x, h + 13 * s, z]);
    handled.add(5);
  }
  return { built: { group: b.group, disposables: b.disposables }, handled };
}

const BUILDERS: Partial<Record<SceneType, (props: PropSprite[]) => { built: Built; handled: Set<number> }>> = { cafe };

/** 장소에 3D 소품이 있으면 만든다. 없으면 null (종이 카드 그대로) */
export function build3dProps(type: SceneType, props: PropSprite[]): { built: Built; handled: Set<number> } | null {
  const b = BUILDERS[type];
  return b ? b(props) : null;
}

/** 셀 셰이딩용 조명 (MeshBasicMaterial의 텍스처 면에는 영향이 없다) */
export function toonLights(): THREE.Object3D[] {
  const hemi = new THREE.HemisphereLight(0xfff8ec, 0xd9c8a0, 2.2);
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-1.2, 2.4, 1.6);
  return [hemi, key];
}
