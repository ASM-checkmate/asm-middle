// ─── 3D 무대 렌더러 (ADR-0014 개정) ──────────────────────────────────────────
// three.js 렌더러는 앱에 하나다 (iOS의 WebGL 컨텍스트 수 제한 · 지도가 이미 하나 쓴다). 무대 하나(StageView)는 층 4장의 평면과
// 인물 빌보드를 들고 있고, 그릴 때 공용 렌더러의 캔버스에 그린 뒤 자기 2D 캔버스 둘(배경·인물)로 복사한다 — 두 장인 이유는
// 심도 흐림·조도가 camera.css의 CSS filter 그대로 각각에 붙기 때문이다. 이 모듈은 카메라를 열 때 동적으로 불러온다(번들 ≈150 KB gz).
import * as THREE from 'three';
import { CAM_DIST, CAST_DEPTH, FRAME_ASPECT, LAYERS, LAYER_DEPTH, SCENE_TEX_ASPECT, castBox, stageFov, stagePose } from '../sim/stage';
import type { CastName, StageCrop } from '../sim/stage';
import { castSprite, onSceneEvict, sceneLayers } from './textures';
import type { CastSpec } from './textures';
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
    renderer.autoClear = true;
  } catch {
    renderer = null;
  }
  return renderer;
}
export const stage3dSupported = (): boolean => getRenderer() !== null;

const texCache = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
onSceneEvict(canvases => { for (const c of canvases) { texCache.get(c)?.dispose(); texCache.delete(c); } });
/** 무대 텍스처의 너비 (W 단위): viewBox 780/390 */
const SCENE_TEX_W_UNITS = 2;
function textureOf(canvas: HTMLCanvasElement, mirrorX: boolean): THREE.CanvasTexture {
  let t = texCache.get(canvas);
  if (!t) {
    t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (mirrorX) {
      // 텍스처는 이미 ±1 W로 넓다(textures.ts). 그 밖은 거울 반복 3칸: u ∈ [-1, 2), 가운데 칸만 원본 — 극단의 끌기·회전에서만 보인다
      t.wrapS = THREE.MirroredRepeatWrapping;
      t.repeat.set(3, 1);
      t.offset.set(-1, 0);
    }
    texCache.set(canvas, t);
  }
  return t;
}

export interface StageSpec {
  type: PlaceType;
  pose: CastSpec['pose'];
  friendColor?: string;
  metColor?: string;
  seenColor?: string;
}

/** 무대 하나: 층 평면 + 인물 빌보드 + 카메라. 텍스처는 캐시에서 공유하고, 지오메트리·머티리얼만 자기 것이다 */
export class StageView {
  private bg = new THREE.Scene();
  private fg = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private cast: THREE.Mesh[] = [];
  private own: { dispose(): void }[] = [];

  private constructor(layers: HTMLCanvasElement[], cast: { who: CastName; canvas: HTMLCanvasElement }[], hasFriend: boolean, hasMet: boolean) {
    this.camera = new THREE.PerspectiveCamera(stageFov(), 1 / FRAME_ASPECT, 0.05, 20);
    const H = FRAME_ASPECT;
    LAYERS.forEach((name, i) => {
      const r = LAYER_DEPTH[name];
      const geo = new THREE.PlaneGeometry(3 * SCENE_TEX_W_UNITS * r, SCENE_TEX_ASPECT * r);
      const mat = new THREE.MeshBasicMaterial({ map: textureOf(layers[i]!, true), transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, CAM_DIST * (1 - r));
      mesh.renderOrder = i;
      this.bg.add(mesh);
      this.own.push(geo, mat);
    });
    for (const { who, canvas } of cast) {
      const r = CAST_DEPTH[who];
      const box = castBox(who, hasFriend, hasMet);
      const geo = new THREE.PlaneGeometry(box.w * r, box.w * r);
      const mat = new THREE.MeshBasicMaterial({ map: textureOf(canvas, false), transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      // 상자의 가운데: x는 W 비율, 아래 끝이 위에서 bottom·H — 깊이만큼 키워 기본 카메라에선 2D와 똑같이 보인다
      mesh.position.set((box.cx - 0.5) * r, ((0.5 - box.bottom) * H + box.w / 2) * r, CAM_DIST * (1 - r));
      mesh.renderOrder = Math.round((2 - r) * 100);
      this.fg.add(mesh);
      this.cast.push(mesh);
      this.own.push(geo, mat);
    }
  }

  /** 텍스처를 구운 뒤 만든다 (장소·인물별 캐시라 두 번째부터는 바로) */
  static async create(spec: StageSpec): Promise<StageView> {
    const hasFriend = !!spec.friendColor, hasMet = !!spec.metColor;
    const wanted: { who: CastName; spec: CastSpec }[] = [];
    if (spec.seenColor) wanted.push({ who: 'ghost', spec: { pose: 'idle', variant: 'friend', color: spec.seenColor, ghost: true } });
    if (spec.friendColor) wanted.push({ who: 'friend', spec: { pose: 'wave', variant: 'friend', color: spec.friendColor } });
    wanted.push({ who: 'me', spec: { pose: spec.pose, variant: 'me' } });
    if (spec.metColor) wanted.push({ who: 'met', spec: { pose: 'wave', variant: 'friend', color: spec.metColor } });
    const [layers, sprites] = await Promise.all([sceneLayers(spec.type), Promise.all(wanted.map(w => castSprite(w.spec)))]);
    return new StageView(layers, wanted.map((w, i) => ({ who: w.who, canvas: sprites[i]! })), hasFriend, hasMet);
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
    for (const m of this.cast) m.quaternion.copy(cam.quaternion);   // 빌보드: 인물은 늘 카메라를 본다
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
    r.render(this.bg, cam);
    blit(bg);
    r.render(this.fg, cam);
    blit(fg);
  }

  dispose(): void {
    for (const o of this.own) o.dispose();
    this.own = [];
  }
}
