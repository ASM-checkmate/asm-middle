// ─── 코드로 만든 로우폴리 소품 (ADR-0014 개정 3) ─────────────────────────────
// 모델 파일 없이 기본 도형(원기둥·상자·타원체)을 조합하고 셀 셰이딩(3단 그라디언트) + 잉크 외곽선(법선 방향으로 밀어낸 뒷면 껍질)을
// 입힌다. 자리와 크기는 2D 그림의 소품 상자·바닥 접점(PropSprite)에서 그대로 가져와 기본 각도에서 그림과 같은 자리에 선다.
// 장소별 빌더가 맡은 소품 번호(P 순서)를 돌려주면 render.ts는 그 소품의 종이 카드를 생략한다. 눕는 것(러그·돗자리·불가사리·공 그림자)은 카드 그대로.
import * as THREE from 'three';
import { CAM_DIST, STAGE_W, frameOfCol, frameOfRow, hitGround, hitVertical, rayFromFrame } from '../sim/stage';
import type { Vec3 } from '../sim/stage';
import type { PropSprite } from './textures';
import type { SceneType } from '../scenes';

/** 덱 토큰 색 (tokens.css) — scenes.css의 color-mix 파생색은 미리 섞어 둔 값 */
const C = {
  ink: 0x2A2118, ink2: 0x6B5B4B, ink3: 0xA08C76, paper: 0xFFF6E6, paper2: 0xFFEBCB, card: 0xFFFFFF, line: 0xE8D6B6, skin: 0xFFD9B8,
  coral: 0xFF6A48, coral2: 0xFFD2C4, sun: 0xFFC64D, sun2: 0xFFE9B3, mint: 0x5FC9A6, mint2: 0xCDEFE3, sky: 0xA9DCF5, sky2: 0xE3F3FC,
  leaf: 0x8FD37E, night2: 0x3A4270, wood: 0xCDA862, wood2: 0xA6864C, grass: 0xB9E0A9, cream: 0xFFF0CF, stone: 0xE2D6C4, sand: 0xFFEEC7,
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
  cone(r: number, h: number, color: number, at: Vec3, rot: [number, number, number] = [0, 0, 0]): THREE.Mesh {
    return this.part(new THREE.CylinderGeometry(0, r, h, 20), color, at, rot);
  }
  /** 반구 (파라솔·갓) */
  dome(r: number, color: number, at: Vec3): THREE.Mesh {
    return this.part(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), color, at);
  }
  /** 점들을 잇는 관 (밧줄·손잡이) */
  tube(points: Vec3[], r: number, color: number): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return this.part(new THREE.TubeGeometry(curve, 24, r, 8, false), color, [0, 0, 0]);
  }
}

/** 소품의 앵커: 그림 좌표(col, row)를 월드로. X는 상자 가운데 열 기준, Y는 바닥 접점 행 기준(위가 +), Z는 발의 깊이(카메라 쪽이 +) */
interface Anchor { X: (col: number) => number; Y: (row: number) => number; Z: (d?: number) => number; s: number }
function anchorOf(p: PropSprite): Anchor | null {
  const f = footOf(p);
  if (!f) return null;
  const mid = (p.x0 + p.x1) / 2;
  return { X: col => f.x + (col - mid) * f.s, Y: row => (p.base - row) * f.s, Z: (d = 0) => f.z + d * f.s, s: f.s };
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

type Build = (props: PropSprite[]) => { built: Built; handled: Set<number> };
/** 빌더 뼈대: 소품 번호마다 앵커를 주고 그리게 한다 */
function scene(parts: Record<number, (a: Anchor, b: Builder, p: PropSprite) => void>): Build {
  return props => {
    const b = new Builder();
    const handled = new Set<number>();
    for (const [k, draw] of Object.entries(parts)) {
      const i = Number(k), p = props[i];
      const a = p && anchorOf(p);
      if (!a) continue;
      draw(a, b, p);
      handled.add(i);
    }
    return { built: { group: b.group, disposables: b.disposables }, handled };
  };
}
/** 매달린 것: 그림의 열·행을 세운 평면 위의 점으로 (바닥 접점의 깊이) */
const hang = (a: Anchor, col: number, row: number): Vec3 => { const z = a.Z(); const v = onPlane(col, row, z); return [v[0], v[1], z]; };

/** 나무: 기둥 + 잎 덩어리 셋 + 밝은 점 둘 (Tree: 기둥 -9..9×-40..10, 잎 (0,-70 r46) (-26,-52 r28) (28,-56 r30)) */
function tree(a: Anchor, b: Builder, tx: number, ty: number, k: number) {
  const s = a.s * k, X = (c: number) => a.X(tx + c * k), Y = (r: number) => a.Y(ty + r * k);
  b.cylinder(8 * s, 10 * s, 50 * s, C.wood2, [X(0), Y(-15), a.Z()]);
  b.ellipsoid(46 * s, 44 * s, 40 * s, C.leaf, [X(0), Y(-70), a.Z()]);
  b.ellipsoid(28 * s, 27 * s, 26 * s, C.leaf, [X(-26), Y(-52), a.Z(8)]);
  b.ellipsoid(30 * s, 29 * s, 27 * s, C.leaf, [X(28), Y(-56), a.Z(6)]);
  b.ellipsoid(16 * s, 15 * s, 12 * s, C.grass, [X(-8), Y(-84), a.Z(30)]);
  b.ellipsoid(8 * s, 8 * s, 6 * s, C.grass, [X(22), Y(-64), a.Z(30)]);
}
/** 화분: 화분 + 테 + 줄기 + 잎 셋 (Plant: 화분 -22..22×0..34, 테 -26..26×-6..6, 잎 (-14,-60) (42,-46) (16,-72)) */
function plant(a: Anchor, b: Builder, tx: number, ty: number, k: number, pot: number) {
  const s = a.s * k, X = (c: number) => a.X(tx + c * k), Y = (r: number) => a.Y(ty + r * k);
  b.cylinder(22 * s, 16 * s, 34 * s, pot, [X(0), Y(17), a.Z()]);
  b.cylinder(26 * s, 26 * s, 12 * s, pot, [X(0), Y(0), a.Z()]);
  b.cylinder(2 * s, 2.5 * s, 60 * s, C.ink3, [X(4), Y(-34), a.Z()]);
  b.ellipsoid(12 * s, 20 * s, 6 * s, C.leaf, [X(-14), Y(-60), a.Z(4)], [0, 0, 0.5]);
  b.ellipsoid(11 * s, 18 * s, 6 * s, C.leaf, [X(42), Y(-46), a.Z(-2)], [0, 0.4, -0.9]);
  b.ellipsoid(11 * s, 20 * s, 6 * s, C.leaf, [X(16), Y(-72), a.Z()], [0, -0.3, -0.15]);
}
/** 컵 (Cup: -16..16×0..24 사다리꼴) */
function cup(a: Anchor, b: Builder, col: number, row: number, color: number, d = 0) {
  const s = a.s;
  b.cylinder(15 * s, 12 * s, 24 * s, color, [a.X(col), a.Y(row + 12), a.Z(d)]);
}

// ── 식당: 0 초롱 · 1 화분 · 2 식탁 ──
const restaurant = scene({
  0: (a, b) => {
    const s = a.s, top = hang(a, 304, 0), mid = hang(a, 304, 92);
    b.cylinder(1.2 * s, 1.2 * s, top[1] - mid[1], C.ink, [top[0], (top[1] + mid[1]) / 2, a.Z()]);
    b.ellipsoid(30 * s, 34 * s, 30 * s, C.coral, mid);
    b.box(16 * s, 8 * s, 16 * s, C.sun, [mid[0], mid[1] - 36 * s, a.Z()]);
  },
  1: (a, b) => plant(a, b, 352, 430, 0.85, C.mint),
  2: (a, b) => {
    const s = a.s, X = (c: number) => a.X(195 + c), Y = (r: number) => a.Y(520 + r);
    b.box(100 * s, 12 * s, 40 * s, C.wood2, [X(0), Y(90), a.Z()]);
    b.cylinder(8 * s, 8 * s, 90 * s, C.wood2, [X(0), Y(45), a.Z()]);
    b.cylinder(110 * s, 110 * s, 8 * s, C.wood, [X(0), Y(0), a.Z()]);
    b.cylinder(92 * s, 92 * s, 2 * s, C.card, [X(0), Y(-5), a.Z()]);
    b.cylinder(26 * s, 20 * s, 22 * s, C.card, [X(-30), Y(-12 - 11), a.Z(6)]);
    b.cylinder(26 * s, 26 * s, 6 * s, C.card, [X(46), Y(-6 - 3), a.Z(-4)]);
    b.ellipsoid(6 * s, 5 * s, 6 * s, C.leaf, [X(40), Y(-10), a.Z(-4)]);
    b.ellipsoid(5 * s, 4 * s, 5 * s, C.coral, [X(54), Y(-9), a.Z(-2)]);
    b.cylinder(1.5 * s, 1.5 * s, 26 * s, C.ink, [X(-77), Y(-17), a.Z(4)], 6);
    b.cylinder(1.5 * s, 1.5 * s, 26 * s, C.ink, [X(-71), Y(-17), a.Z(6)], 6);
  },
});

// ── 공원: 0·1 나무 · 2 벤치 · 3~7 꽃 ──
const flower = (x: number, y: number, color: number) => (a: Anchor, b: Builder) => {
  const s = a.s;
  b.cylinder(1.2 * s, 1.2 * s, 18 * s, C.ink2, [a.X(x), a.Y(y - 9), a.Z()], 6);
  b.ellipsoid(7 * s, 7 * s, 5 * s, color, [a.X(x), a.Y(y - 22), a.Z()]);
  b.ellipsoid(2.6 * s, 2.6 * s, 2 * s, C.paper, [a.X(x), a.Y(y - 22), a.Z(5)]);
};
const park = scene({
  0: (a, b) => tree(a, b, 58, 430, 1),
  1: (a, b) => tree(a, b, 352, 430, 0.85),
  2: (a, b) => {
    const s = a.s, X = (c: number) => a.X(195 + c), Y = (r: number) => a.Y(540 + r);
    b.box(180 * s, 14 * s, 44 * s, C.wood, [X(0), Y(5), a.Z()]);
    b.box(180 * s, 12 * s, 8 * s, C.wood, [X(0), Y(-24), a.Z(-20)]);
    for (const c of [-74, 74]) {
      b.cylinder(3 * s, 3 * s, 40 * s, C.ink, [X(c), Y(32), a.Z(14)], 8);
      b.cylinder(3 * s, 3 * s, 40 * s, C.ink, [X(c), Y(32), a.Z(-14)], 8);
      b.cylinder(3 * s, 3 * s, 12 * s, C.ink, [X(c), Y(-24), a.Z(-20)], 8);
    }
  },
  3: flower(40, 640, C.coral), 4: flower(96, 690, C.sun), 5: flower(300, 660, C.sky), 6: flower(352, 620, C.coral), 7: flower(250, 720, C.sun),
});

// ── 강변: 0 오리 · 1 갈대 · 2 돗자리(카드) · 3 바구니 ──
const river = scene({
  0: (a, b) => {
    const s = a.s, X = (c: number) => a.X(322 + c), Y = (r: number) => a.Y(388 + r);
    b.ellipsoid(18 * s, 11 * s, 12 * s, C.paper, [X(0), Y(0), a.Z()]);
    b.ellipsoid(9 * s, 9 * s, 9 * s, C.paper, [X(12), Y(-12), a.Z()]);
    b.cone(4 * s, 10 * s, C.sun, [X(25), Y(-11), a.Z()], [0, 0, -Math.PI / 2]);
  },
  1: (a, b) => {
    const s = a.s, X = (c: number) => a.X(46 + c), Y = (r: number) => a.Y(436 + r);
    for (const [c, h, tilt] of [[0, 80, 0.06], [10, 72, 0.14], [-10, 66, -0.12]]) b.cylinder(1.4 * s, 2 * s, h! * s, C.mint, [X(c! + h! * tilt! * 0.5), Y(-h! / 2), a.Z()], 6).rotation.z = -tilt!;
    b.ellipsoid(5 * s, 12 * s, 5 * s, C.wood2, [X(6), Y(-78), a.Z()]);
  },
  3: (a, b) => {
    const s = a.s, X = (c: number) => a.X(190 + c), Y = (r: number) => a.Y(560 + r);
    b.box(44 * s, 30 * s, 26 * s, C.wood, [X(0), Y(7), a.Z()]);
    b.tube([[X(-14), Y(-8), a.Z()], [X(-8), Y(-19), a.Z()], [X(8), Y(-19), a.Z()], [X(14), Y(-8), a.Z()]], 1.8 * s, C.ink);
  },
});

// ── 해변: 0 파라솔 · 1 비치볼 · 2 불가사리(카드) · 3 조개 · 4 모래성 ──
const beach = scene({
  0: (a, b) => {
    const s = a.s, X = (c: number) => a.X(66 + c), Y = (r: number) => a.Y(250 + r);
    b.cylinder(2.4 * s, 2.4 * s, 260 * s, C.ink, [X(0), Y(130), a.Z()], 8);
    b.dome(70 * s, C.coral, [X(0), Y(10), a.Z()]);
    b.ellipsoid(4 * s, 4 * s, 4 * s, C.paper, [X(0), Y(-62), a.Z()]);
  },
  1: (a, b) => {
    const s = a.s;
    b.ellipsoid(30 * s, 30 * s, 30 * s, C.paper, [a.X(320), a.Y(600), a.Z()]);
    b.ellipsoid(10 * s, 30.6 * s, 30.6 * s, C.coral, [a.X(320), a.Y(600), a.Z()]);
    b.ellipsoid(30.6 * s, 30.6 * s, 10 * s, C.sky, [a.X(320), a.Y(600), a.Z()]);
  },
  3: (a, b) => b.dome(14 * a.s, C.paper, [a.X(178), a.Y(618), a.Z()]),
  4: (a, b) => {
    const s = a.s, X = (c: number) => a.X(300 + c), Y = (r: number) => a.Y(720 + r);
    b.cylinder(26 * s, 28 * s, 8 * s, C.cream, [X(0), Y(0), a.Z()]);
    b.box(28 * s, 24 * s, 28 * s, C.sun, [X(0), Y(-18), a.Z()]);
    b.box(40 * s, 12 * s, 40 * s, C.sun, [X(0), Y(-34), a.Z()]);
    b.cone(6 * s, 12 * s, C.coral, [X(0), Y(-46), a.Z()]);
  },
});

// ── 헬스장: 0 덤벨 랙 · 1 공 그림자(카드) · 2 짐볼 · 3 물병+수건 ──
const gym = scene({
  0: (a, b) => {
    const s = a.s, X = (c: number) => a.X(262 + c), Y = (r: number) => a.Y(500 + r);
    for (const r of [6, 56]) b.box(120 * s, 12 * s, 30 * s, C.ink, [X(60), Y(r), a.Z()]);
    for (const c of [8, 112]) b.cylinder(3 * s, 3 * s, 102 * s, C.ink, [X(c), Y(51), a.Z(-12)], 8);
    const rows: [number, number[]][] = [[-8, [C.coral, C.sun, C.sky]], [42, [C.mint, C.coral, C.sun]]];
    for (const [r, cols] of rows) [22, 60, 98].forEach((c, i) => {
      b.cylinder(1.6 * s, 1.6 * s, 22 * s, C.ink, [X(c), Y(r + 2), a.Z(6)], 8).rotation.z = Math.PI / 2;
      for (const dx of [-9, 9]) b.cylinder(8 * s, 8 * s, 10 * s, cols[i]!, [X(c + dx), Y(r + 2), a.Z(6)]).rotation.z = Math.PI / 2;
    });
  },
  2: (a, b) => b.ellipsoid(44 * a.s, 44 * a.s, 44 * a.s, C.mint, [a.X(84), a.Y(610), a.Z()]),
  3: (a, b) => {
    const s = a.s, X = (c: number) => a.X(170 + c), Y = (r: number) => a.Y(620 + r);
    b.cylinder(8 * s, 8 * s, 44 * s, C.sky, [X(0), Y(-18), a.Z()]);
    b.cylinder(5 * s, 5 * s, 10 * s, C.coral, [X(0), Y(-43), a.Z()]);
    b.box(60 * s, 12 * s, 30 * s, C.card, [X(50), Y(-2), a.Z()]);
  },
});

// ── 도서관: 0 책상(+램프·펼친 책·책 더미) ──
const library = scene({
  0: (a, b) => {
    const s = a.s, X = (c: number) => a.X(195 + c), Y = (r: number) => a.Y(528 + r);
    b.box(220 * s, 16 * s, 70 * s, C.wood, [X(0), Y(4), a.Z()]);
    for (const c of [-92, 92]) for (const d of [-24, 24]) b.cylinder(4 * s, 4 * s, 90 * s, C.ink, [X(c), Y(57), a.Z(d)], 8);
    b.cylinder(18 * s, 18 * s, 6 * s, C.ink, [X(60), Y(-7), a.Z()]);
    b.cylinder(4 * s, 4 * s, 40 * s, C.ink, [X(60), Y(-24), a.Z()], 8);
    b.cylinder(22 * s, 30 * s, 22 * s, C.mint, [X(60), Y(-51), a.Z()]);
    b.box(36 * s, 3 * s, 26 * s, C.card, [X(-68), Y(-10), a.Z(4)]).rotation.z = 0.12;
    b.box(36 * s, 3 * s, 26 * s, C.card, [X(-32), Y(-10), a.Z(4)]).rotation.z = -0.12;
    const stack: [number, number, number][] = [[-78, -9, C.coral], [-76, -19, C.sky], [-79, -29, C.sun]];
    for (const [c, r, col] of stack) b.box(44 * s, 10 * s, 30 * s, col, [X(c), Y(r), a.Z(-6)]);
  },
});

// ── 쇼핑몰: 0 풍선 스탠드 · 1 벤치+가방 ──
const mall = scene({
  0: (a, b) => {
    const s = a.s, X = (c: number) => a.X(58 + c), Y = (r: number) => a.Y(470 + r);
    b.cylinder(16 * s, 18 * s, 10 * s, C.ink, [X(0), Y(5), a.Z()]);
    b.cylinder(1.6 * s, 1.6 * s, 180 * s, C.ink2, [X(0), Y(-90), a.Z()], 8);
    const balloons: [number, number, number][] = [[-22, -210, C.coral], [14, -236, C.sun], [26, -192, C.sky]];
    for (const [c, r, col] of balloons) {
      b.ellipsoid(20 * s, 24 * s, 20 * s, col, [X(c), Y(r), a.Z(c > 0 ? 10 : -10)]);
      b.cone(4 * s, 6 * s, col, [X(c), Y(r + 26), a.Z(c > 0 ? 10 : -10)], [Math.PI, 0, 0]);
      b.cylinder(0.8 * s, 0.8 * s, Math.hypot(c, r + 180 + 26) * s, C.ink2, [X(c / 2), Y((r + 26 - 180) / 2), a.Z(c > 0 ? 5 : -5)], 6).rotation.z = Math.atan2(-c, r + 180 + 26);
    }
  },
  1: (a, b) => {
    const s = a.s, X = (c: number) => a.X(300 + c), Y = (r: number) => a.Y(560 + r);
    b.box(140 * s, 14 * s, 44 * s, C.mint, [X(0), Y(7), a.Z()]);
    for (const c of [-56, 56]) for (const d of [-14, 14]) b.cylinder(3 * s, 3 * s, 34 * s, C.ink, [X(c), Y(31), a.Z(d)], 8);
    b.box(40 * s, 42 * s, 22 * s, C.coral, [X(-30), Y(-40 + 21), a.Z()]);
    b.tube([[X(-40), Y(-40), a.Z()], [X(-36), Y(-52), a.Z()], [X(-24), Y(-52), a.Z()], [X(-20), Y(-40), a.Z()]], 1.8 * s, C.ink);
    b.ellipsoid(6 * s, 6 * s, 2 * s, C.paper, [X(-30), Y(-20), a.Z(12)]);
  },
});

// ── 박물관: 0 좌대+화병 · 1 로프 기둥 ──
const museum = scene({
  0: (a, b) => {
    const s = a.s, X = (c: number) => a.X(86 + c), Y = (r: number) => a.Y(520 + r);
    b.box(80 * s, 110 * s, 60 * s, C.card, [X(0), Y(55), a.Z()]);
    b.box(92 * s, 12 * s, 72 * s, C.card, [X(0), Y(-2), a.Z()]);
    b.cylinder(10 * s, 8 * s, 14 * s, C.coral, [X(0), Y(-15), a.Z()]);
    b.ellipsoid(18 * s, 20 * s, 18 * s, C.coral, [X(0), Y(-38), a.Z()]);
    b.cylinder(8 * s, 12 * s, 10 * s, C.coral, [X(0), Y(-58), a.Z()]);
  },
  1: (a, b) => {
    const s = a.s, X = (c: number) => a.X(240 + c), Y = (r: number) => a.Y(560 + r);
    for (const c of [0, 140]) {
      b.cylinder(22 * s, 24 * s, 6 * s, C.sun, [X(c), Y(67), a.Z()]);
      b.cylinder(5 * s, 5 * s, 70 * s, C.sun, [X(c), Y(31), a.Z()], 10);
      b.ellipsoid(8 * s, 8 * s, 8 * s, C.sun, [X(c), Y(0), a.Z()]);
    }
    b.tube([[X(0), Y(0), a.Z()], [X(35), Y(20), a.Z(6)], [X(70), Y(26), a.Z(8)], [X(105), Y(20), a.Z(6)], [X(140), Y(0), a.Z()]], 2.5 * s, C.coral);
  },
});

// ── 집: 0 화분 · 1 러그(카드) · 2 소파+고양이 · 3 협탁(+컵·램프) ──
const home = scene({
  0: (a, b) => plant(a, b, 40, 430, 0.8, C.sky),
  2: (a, b) => {
    const s = a.s, X = (c: number) => a.X(320 + c), Y = (r: number) => a.Y(520 + r);
    b.box(140 * s, 70 * s, 60 * s, C.mint, [X(0), Y(5), a.Z()]);
    for (const c of [-65, 65]) b.box(18 * s, 80 * s, 64 * s, C.mint, [X(c), Y(0), a.Z()]);
    b.box(112 * s, 24 * s, 44 * s, C.mint2, [X(0), Y(12), a.Z(12)]);
    b.ellipsoid(24 * s, 13 * s, 14 * s, C.ink3, [X(-6), Y(-12), a.Z(14)]);
    b.ellipsoid(12 * s, 12 * s, 12 * s, C.ink3, [X(-24), Y(-22), a.Z(18)]);
    b.cone(4 * s, 9 * s, C.ink3, [X(-32), Y(-36), a.Z(18)]);
    b.cone(4 * s, 9 * s, C.ink3, [X(-16), Y(-36), a.Z(18)]);
    b.tube([[X(12), Y(-6), a.Z(6)], [X(24), Y(-14), a.Z(4)], [X(30), Y(-28), a.Z(2)]], 3 * s, C.ink3);
  },
  3: (a, b) => {
    const s = a.s, X = (c: number) => a.X(76 + c), Y = (r: number) => a.Y(560 + r);
    b.box(88 * s, 12 * s, 44 * s, C.wood2, [X(0), Y(6), a.Z()]);
    for (const c of [-32, 32]) for (const d of [-14, 14]) b.cylinder(3 * s, 3 * s, 70 * s, C.ink, [X(c), Y(47), a.Z(d)], 8);
    cup(a, b, 64, 536, C.sky, 6);
    b.cylinder(3 * s, 3 * s, 30 * s, C.ink, [X(22), Y(-23), a.Z(-6)], 8);
    b.cylinder(14 * s, 20 * s, 22 * s, C.sun, [X(22), Y(-49), a.Z(-6)]);
  },
});

const BUILDERS: Partial<Record<SceneType, Build>> = { cafe, restaurant, park, river, beach, gym, library, mall, museum, home };

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
