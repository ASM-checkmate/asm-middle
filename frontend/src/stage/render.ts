// ─── 3D 무대 렌더러 (ADR-0014 개정 2: 디오라마) ─────────────────────────────
// three.js 렌더러는 앱에 하나다 (iOS의 WebGL 컨텍스트 수 제한 · 지도가 이미 하나 쓴다). 무대 하나(StageView)는 세트 — 뒷막(벽·하늘),
// 눕힌 바닥, 소품 카드(서거나 눕는다), 인물 카드, 발밑 그림자 — 와 카메라를 들고 있다.
// 모든 면은 "카메라 투영 매핑"이다: 그림의 점을 기본 카메라(sim/stage.ts)에서 세트 표면으로 되쏘아 꼭짓점을 놓고 그 그림 조각을 입힌다.
// 그래서 기본 각도에서는 2D 그림 그대로이고, 카메라가 돌아야 바닥이 펼쳐지고 소품이 앞뒤로 갈린다.
// 그릴 때는 공용 렌더러의 캔버스에 세트를 그려 배경 캔버스로, 깊이 버퍼를 남긴 채 인물만 다시 그려 인물 캔버스로 복사한다 —
// 두 장인 이유는 심도 흐림·조도가 camera.css의 CSS filter 그대로 각각에 붙기 때문이고, 깊이를 남기니 앞의 소품이 인물을 가린다.
// 이 모듈은 카메라를 열 때 동적으로 불러온다(번들 ≈135 KB gz).
import * as THREE from 'three';
import {
  CAM_DIST, CAST_DEPTH, FRAME_ASPECT, STAGE_H, TEX_LEFT, TEX_W,
  castRect, frameOfCol, frameOfRow, hitGround, hitVertical, rayFromFrame, stageFov, stagePose, wallDepth, wallFootRow, wallZ,
} from '../sim/stage';
import type { CastName, StageCrop, Vec3 } from '../sim/stage';
import { castSprite, onSceneEvict, sceneSet, shadowSprite } from './textures';
import { build3dProps, toonLights } from './props3d';
import { sceneTypeFor } from '../scenes';
import type { CastSpec, PropSprite } from './textures';
import type { PlaceType } from '../sim/types';

let renderer: THREE.WebGLRenderer | null | undefined;
let glW = 0, glH = 0;

/** 공용 렌더러 — 못 만들면(WebGL 없음) null. 처음 부를 때 만든다 */
export function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer !== undefined) return renderer;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
  } catch {
    renderer = null;
  }
  return renderer;
}
export const stage3dSupported = (): boolean => getRenderer() !== null;

const texCache = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
onSceneEvict(canvases => { for (const c of canvases) { texCache.get(c)?.dispose(); texCache.delete(c); } });
function textureOf(canvas: HTMLCanvasElement, mirrorX: boolean): THREE.CanvasTexture {
  let t = texCache.get(canvas);
  if (!t) {
    t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    // 뒷막·바닥은 ±1 W로 넓다(textures.ts). 그 밖은 거울 반복 — 극단의 끌기·회전에서만 보인다
    if (mirrorX) t.wrapS = THREE.MirroredRepeatWrapping;
    texCache.set(canvas, t);
  }
  return t;
}

/** 그림 좌표의 직사각형을 표면에 되쏘아 만든 격자 메시. uv는 텍스처 안의 좌표를 돌려주는 함수 */
function projected(
  tex: THREE.Texture, x0: number, y0: number, x1: number, y1: number, nx: number, ny: number,
  surface: (fx: number, fy: number) => Vec3, uv: (col: number, row: number) => [number, number], mat: Partial<THREE.MeshBasicMaterialParameters> = {},
): THREE.Mesh {
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    const row = y0 + ((y1 - y0) * j) / ny;
    for (let i = 0; i <= nx; i++) {
      const col = x0 + ((x1 - x0) * i) / nx;
      const p = surface(frameOfCol(col), frameOfRow(row));
      pos.push(p[0], p[1], p[2]);
      const [u, v] = uv(col, row);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, depthWrite: true, side: THREE.DoubleSide, ...mat });
  return new THREE.Mesh(geo, material);
}

/** 넓은 무대 텍스처(x -195..585, 0..844)의 uv */
const stageUv = (col: number, row: number): [number, number] => [(col - TEX_LEFT) / TEX_W, 1 - row / STAGE_H];
/** 되쏜 광선이 바닥에 안 닿으면(지평선 위) 아주 먼 세운 평면으로 */
const groundOrFar = (fx: number, fy: number): Vec3 => hitGround(rayFromFrame(fx, fy)) ?? hitVertical(rayFromFrame(fx, fy), wallZ(8));

export interface StageSpec {
  type: PlaceType;
  pose: CastSpec['pose'];
  friendColor?: string;
  metColor?: string;
  seenColor?: string;
}

/** 무대 하나: 세트 + 카메라. 텍스처는 캐시에서 공유하고, 지오메트리·머티리얼만 자기 것이다 */
export class StageView {
  private bg = new THREE.Scene();
  private fg = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private own: { dispose(): void }[] = [];

  private constructor(type: PlaceType, set: { floorY: number; backdrop: HTMLCanvasElement; ground: HTMLCanvasElement; props: PropSprite[] }, cast: { who: CastName; canvas: HTMLCanvasElement }[], hasFriend: boolean, hasMet: boolean) {
    this.camera = new THREE.PerspectiveCamera(stageFov(), 1 / FRAME_ASPECT, 0.05, 30);
    const k = wallDepth(set.floorY);
    const zWall = wallZ(k);
    const foot = wallFootRow(k);
    const X0 = TEX_LEFT - 390, X1 = TEX_LEFT + TEX_W + 390;   // 3 W: 그 밖은 거울 반복
    // 뒷막: 벽 발치 위쪽 전부 (바닥 경계선이 발치보다 높으면 그 사이의 바닥 그림도 뒷막에 — 먼 물·먼 풀밭처럼 읽힌다)
    this.add(this.bg, projected(textureOf(set.backdrop, true), X0, 0, X1, foot, 24, 16, (fx, fy) => hitVertical(rayFromFrame(fx, fy), zWall), stageUv, { alphaTest: 0.02 }));
    // 바닥: 벽 발치부터 그림 끝(프레임 아래 한 프레임)까지, 눕힌 평면에
    this.add(this.bg, projected(textureOf(set.ground, true), X0, foot, X1, STAGE_H, 24, 32, groundOrFar, stageUv, { alphaTest: 0.02 }));
    // 3D 소품(props3d.ts)이 있는 장소는 그 소품의 종이 카드를 생략한다 (프로토타입: 카페)
    const built = build3dProps(sceneTypeFor(type), set.props);
    if (built) {
      this.bg.add(built.built.group, ...toonLights());
      this.own.push(...built.built.disposables);
    }
    // 소품: 서는 카드는 바닥 접점의 깊이에 세운 평면, 눕는 것은 바닥에
    set.props.forEach((p, i) => {
      if (built?.handled.has(i)) return;
      const tex = textureOf(p.canvas, false);
      const uv = (col: number, row: number): [number, number] => [(col - p.x0) / (p.x1 - p.x0), 1 - (row - p.y0) / (p.y1 - p.y0)];
      if (p.lie) {
        this.add(this.bg, projected(tex, p.x0, p.y0, p.x1, p.y1, 6, 6, groundOrFar, uv, { depthWrite: false, alphaTest: 0.05 }));
        return;
      }
      const base = hitGround(rayFromFrame(frameOfCol((p.x0 + p.x1) / 2), frameOfRow(p.base)));
      const z = base ? base[2] : zWall + 0.01;
      this.add(this.bg, projected(tex, p.x0, p.y0, p.x1, p.y1, 4, 4, (fx, fy) => hitVertical(rayFromFrame(fx, fy), z), uv));
      if (base) this.shadow(this.bg, base, (p.x1 - p.x0) / 390 * (CAM_DIST - z) / CAM_DIST * 0.5);
    });
    // 인물: 2D 상자 그대로 세운 카드, 깊이는 CAST_DEPTH (me = 캐릭터 평면 z 0)
    for (const { who, canvas } of cast) {
      const r = castRect(who, hasFriend, hasMet);
      const z = CAM_DIST * (1 - CAST_DEPTH[who]);
      const uv = (col: number, row: number): [number, number] => [(col - r.x0) / (r.x1 - r.x0), 1 - (row - r.y0) / (r.y1 - r.y0)];
      this.add(this.fg, projected(textureOf(canvas, false), r.x0, r.y0, r.x1, r.y1, 4, 4, (fx, fy) => hitVertical(rayFromFrame(fx, fy), z), uv));
      if (who !== 'ghost') {
        const feet = hitVertical(rayFromFrame(frameOfCol((r.x0 + r.x1) / 2), frameOfRow(r.y1 - 0.09 * (r.x1 - r.x0))), z);
        this.shadow(this.bg, [feet[0], 0, feet[2]], (r.x1 - r.x0) / 390 * 0.42);
      }
    }
  }

  private add(scene: THREE.Scene, mesh: THREE.Mesh): void {
    scene.add(mesh);
    this.own.push(mesh.geometry, mesh.material as THREE.Material);
  }

  /** 발밑 그림자: 바닥에 눕힌 타원 (텍스처는 공유) */
  private shadow(scene: THREE.Scene, at: Vec3, w: number): void {
    const geo = new THREE.PlaneGeometry(w, w * 0.5);
    const mat = new THREE.MeshBasicMaterial({ map: textureOf(shadowSprite(), false), transparent: true, opacity: 0.32, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(at[0], 0.002, at[2]);
    m.renderOrder = -1;
    scene.add(m);
    this.own.push(geo, mat);
  }

  /** 텍스처를 구운 뒤 만든다 (장소·인물별 캐시라 두 번째부터는 바로) */
  static async create(spec: StageSpec): Promise<StageView> {
    const hasFriend = !!spec.friendColor, hasMet = !!spec.metColor;
    const wanted: { who: CastName; spec: CastSpec }[] = [];
    if (spec.seenColor) wanted.push({ who: 'ghost', spec: { pose: 'idle', variant: 'friend', color: spec.seenColor, ghost: true } });
    if (spec.friendColor) wanted.push({ who: 'friend', spec: { pose: 'wave', variant: 'friend', color: spec.friendColor } });
    wanted.push({ who: 'me', spec: { pose: spec.pose, variant: 'me' } });
    if (spec.metColor) wanted.push({ who: 'met', spec: { pose: 'wave', variant: 'friend', color: spec.metColor } });
    const [set, sprites] = await Promise.all([sceneSet(spec.type), Promise.all(wanted.map(w => castSprite(w.spec)))]);
    return new StageView(spec.type, set, wanted.map((w, i) => ({ who: w.who, canvas: sprites[i]! })), hasFriend, hasMet);
  }

  /** 비트맵 w×h로 그려 bg·fg 캔버스에 복사한다. 렌더러가 없으면 아무것도 안 한다 */
  render(crop: StageCrop, bg: HTMLCanvasElement, fg: HTMLCanvasElement, w: number, h: number): void {
    const r = getRenderer();
    if (!r || w < 2 || h < 2) return;
    if (w > glW || h > glH) { glW = Math.max(glW, w); glH = Math.max(glH, h); r.setSize(glW, glH, false); }
    const pose = stagePose(crop);
    const cam = this.camera;
    cam.aspect = w / h;
    cam.position.set(...pose.pos);
    cam.up.set(...pose.up);
    cam.lookAt(...pose.target);
    cam.zoom = pose.zoom;
    cam.setViewOffset(w, h, -pose.offset[0] * w, -pose.offset[1] * h, w, h);
    cam.updateProjectionMatrix();
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    r.setScissorTest(true);
    const gl = r.domElement;
    const blit = (target: HTMLCanvasElement) => {
      const ctx = target.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(gl, 0, glH - h, w, h, 0, 0, w, h);
    };
    r.clear(true, true, true);
    r.render(this.bg, cam);
    blit(bg);
    r.clear(true, false, false);   // 색만 지우고 깊이는 남긴다 — 앞의 소품이 인물을 가린다
    r.render(this.fg, cam);
    blit(fg);
  }

  dispose(): void {
    for (const o of this.own) o.dispose();
    this.own = [];
  }
}
