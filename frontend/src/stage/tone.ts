// ─── 톤 패스 (ADR-0014 개정 7) ─────────────────────────────────────────────
// 밖에서 만든 3D 모델(glb — 이미지→3D 생성, 블렌더)이 어디서 왔든 우리 톤으로 눌러 앉힌다:
//   1. 텍스처·색을 덱 팔레트 12색 중 가장 가까운 색으로 양자화 (구워진 그림자·잡색이 사라지고 단색 면이 된다)
//   2. PBR 재질을 버리고 셀 셰이딩(3단 그라디언트)
//   3. 잉크 외곽선 (법선 방향으로 밀어낸 뒷면 껍질 — props3d와 같은 것)
//   4. 선택: 면 수 줄이기 (SimplifyModifier) — 생성 메시의 울퉁불퉁함이 각진 로우폴리 덩어리가 된다
// 모양은 생성에 맡기고 톤은 여기서 강제한다는 원칙. 자세한 배경은 docs/adr/0014-3d-stage.md 개정 7.
import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { hull, inkMat, toon } from './props3d';

/** 덱 팔레트 (tokens.css) + scenes.css 파생색 — 양자화의 목표 색 */
export const PALETTE: number[] = [
  0xFFF6E6, 0xFFEBCB, 0xFFFFFF, 0x2A2118, 0x6B5B4B, 0xA08C76, 0xE8D6B6, 0xFFD9B8,
  0xFF6A48, 0xFFD2C4, 0xFFF1EC, 0xFFC64D, 0xFFE9B3, 0x5FC9A6, 0xCDEFE3, 0xA9DCF5, 0xE3F3FC, 0x8FD37E, 0x1E2440, 0x3A4270,
  0xCDA862, 0xA6864C, 0xB9E0A9, 0xFFF0CF, 0xE2D6C4, 0xFFEEC7, 0x3A2A22,
];
const PAL_RGB = PALETTE.map(c => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const);

/** 가장 가까운 팔레트 색 (sRGB 거리, 밝기에 가중) */
export function nearestPalette(r: number, g: number, b: number): [number, number, number] {
  let best = 0, bd = Infinity;
  for (let i = 0; i < PAL_RGB.length; i++) {
    const p = PAL_RGB[i]!;
    const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bd) { bd = d; best = i; }
  }
  const p = PAL_RGB[best]!;
  return [p[0], p[1], p[2]];
}

const quantCache = new WeakMap<object, THREE.CanvasTexture>();
/** 텍스처의 모든 픽셀을 팔레트로 (긴 변 1024까지 줄여서). 같은 이미지는 한 번만 */
export function quantizeTexture(tex: THREE.Texture): THREE.CanvasTexture {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const hit = quantCache.get(img);
  if (hit) return hit;
  const k = Math.min(1, 1024 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  const memo = new Map<number, [number, number, number]>();
  for (let i = 0; i < d.length; i += 4) {
    // 5비트로 묶어 메모 — 픽셀 수백만 개를 팔레트 27색과 일일이 견주지 않는다
    const key = ((d[i]! >> 3) << 10) | ((d[i + 1]! >> 3) << 5) | (d[i + 2]! >> 3);
    let q = memo.get(key);
    if (!q) { q = nearestPalette(d[i]!, d[i + 1]!, d[i + 2]!); memo.set(key, q); }
    d[i] = q[0]; d[i + 1] = q[1]; d[i + 2] = q[2];
  }
  ctx.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.colorSpace = THREE.SRGBColorSpace;
  out.flipY = tex.flipY;
  out.wrapS = tex.wrapS; out.wrapT = tex.wrapT;
  out.repeat.copy(tex.repeat); out.offset.copy(tex.offset);
  quantCache.set(img, out);
  return out;
}

/** 팔레트를 GLSL 상수로 — sRGB(비교용)와 선형(출력용) 둘 다 */
const PAL_GLSL = (() => {
  const c = new THREE.Color();
  const srgb = PAL_RGB.map(p => `vec3(${(p[0] / 255).toFixed(4)}, ${(p[1] / 255).toFixed(4)}, ${(p[2] / 255).toFixed(4)})`);
  const lin = PAL_RGB.map(p => { c.setRGB(p[0] / 255, p[1] / 255, p[2] / 255, THREE.SRGBColorSpace); return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`; });
  return { n: PAL_RGB.length, srgb, lin };
})();

/**
 * 정점색을 프래그먼트에서 팔레트로 스냅한다 — 정점마다 양자화하면 삼각형 안에서 두 색이 섞여 얼룩덜룩해지는데, 픽셀마다 스냅하면
 * 단색 면과 또렷한 색 경계가 된다. glTF의 COLOR_0는 선형이 규격이지만 TripoSR(trimesh)은 sRGB 바이트를 그대로 쓰니 sRGB로
 * 견주고(nearestPalette와 같은 가중치) 선형으로 낸다. 안 그러면 갈색 상판이 크림색으로 뜬다.
 */
export function snapVertexColorsToPalette(mat: THREE.MeshToonMaterial): void {
  mat.vertexColors = true;
  mat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
const int PAL_N = ${PAL_GLSL.n};
vec3 palSnap(vec3 c) {
  vec3 pal[PAL_N] = vec3[](${PAL_GLSL.srgb.join(', ')});
  vec3 lin[PAL_N] = vec3[](${PAL_GLSL.lin.join(', ')});
  float bd = 1e9; vec3 best = lin[0];
  for (int i = 0; i < PAL_N; i++) { vec3 d = pal[i] - c; float dd = dot(d * d, vec3(0.3, 0.59, 0.11)); if (dd < bd) { bd = dd; best = lin[i]; } }
  return best;
}`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= palSnap(vColor.rgb);');
  };
  mat.customProgramCacheKey = () => 'palSnap';
}

export interface ToneOptions {
  /** 외곽선 두께 (모델 단위) */
  line: number;
  /** 면 수 목표 비율 (0..1, 1 = 그대로). 삼각형 2000개 넘는 메시에만 */
  simplify?: number;
}

/** 모델 전체에 톤을 입힌다. 돌려주는 것은 나중에 dispose할 것들 */
export function applyTone(root: THREE.Object3D, o: ToneOptions): { dispose(): void }[] {
  const own: { dispose(): void }[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse(obj => { if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh); });
  const simplifier = o.simplify && o.simplify < 1 ? new SimplifyModifier() : null;
  for (const m of meshes) {
    let geo = m.geometry;
    const tris = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
    if (simplifier && tris > 2000) {
      try {
        const target = Math.floor(geo.getAttribute('position').count * (1 - o.simplify!));
        const g2 = simplifier.modify(geo, target);
        g2.computeVertexNormals();
        geo = g2; m.geometry = g2; own.push(g2);
      } catch { /* 단순화 실패(비다양체) — 원본 그대로 */ }
    }
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const map = src.map ? quantizeTexture(src.map) : null;
    // 정점색(TripoSR 등 생성 메시의 COLOR_0)은 셰이더에서 픽셀마다 팔레트로 — 재질을 갈아 끼우니 vertexColors를 다시 켜야 한다
    const vc = !map && geo.getAttribute('color');
    let color: THREE.ColorRepresentation = 0xffffff;
    if (!map && !vc) {
      const c = src.color ?? new THREE.Color(0xffffff);
      const q = nearestPalette(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255));
      color = (q[0] << 16) | (q[1] << 8) | q[2];
    }
    const mat = toon(color);
    if (map) mat.map = map;
    else if (vc) snapVertexColorsToPalette(mat);
    m.material = mat;
    own.push(mat);
    if (map) own.push(map);
    // 외곽선 껍질 — 같은 변환을 물려받도록 자식으로
    const h = new THREE.Mesh(hull(geo, o.line), inkMat());
    m.add(h);
    own.push(h.geometry, h.material as THREE.Material);
  }
  return own;
}
