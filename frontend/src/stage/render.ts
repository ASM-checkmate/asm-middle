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
import { onSceneEvict, sceneSet, shadowSprite } from './textures';
import { buildCharacter, characterCamera, characterLights, ghostify, placeCharacter } from './character3d';
import type { Character3DModel, CharacterSpec } from './character3d';
import { build3dProps, toonLights } from './props3d';
import { characterAsset, loadCharacterModel, loadModel, placeInBox, propAsset } from './assets';
import type { LoadedModel } from './assets';
import { sceneTypeFor } from '../scenes';
import type { SceneType } from '../scenes';
import type { PropSprite } from './textures';
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
/** 공용 렌더러의 캔버스를 적어도 w×h로 (키우기만 한다) — 바깥 뷰(RiderView)가 쓴다 */
export function ensureSize(w: number, h: number): { w: number; h: number } {
  const r = getRenderer();
  if (r && (w > glW || h > glH)) { glW = Math.max(glW, w); glH = Math.max(glH, h); r.setSize(glW, glH, false); }
  return { w: glW, h: glH };
}

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
  // 잘라낸 가장자리(alphaTest)는 MSAA로 부드럽게(alphaToCoverage) — 카메라가 돌 때 가장자리가 지글거리지 않는다
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, alphaToCoverage: true, depthWrite: true, side: THREE.DoubleSide, ...mat });
  return new THREE.Mesh(geo, material);
}

/** 넓은 무대 텍스처(x -195..585, 0..844)의 uv */
const stageUv = (col: number, row: number): [number, number] => [(col - TEX_LEFT) / TEX_W, 1 - row / STAGE_H];
/** 되쏜 광선이 바닥에 안 닿으면(지평선 위) 아주 먼 세운 평면으로 */
const groundOrFar = (fx: number, fy: number): Vec3 => hitGround(rayFromFrame(fx, fy)) ?? hitVertical(rayFromFrame(fx, fy), wallZ(8));

export interface StageSpec {
  type: PlaceType | SceneType;
  pose: CharacterSpec['pose'];
  friendColor?: string;
  metColor?: string;
  seenColor?: string;
  /** 시간표 화면: 말풍선 아래 소품(.sc-top)을 뺀다 */
  hush?: boolean;
}

/** 무대 하나: 세트 + 카메라. 텍스처는 캐시에서 공유하고, 지오메트리·머티리얼만 자기 것이다 */
export class StageView {
  private bg = new THREE.Scene();
  private fg = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private own: { dispose(): void }[] = [];

  private cast: Character3DModel[] = [];

  private constructor(type: PlaceType | SceneType, set: { floorY: number; backdrop: HTMLCanvasElement; ground: HTMLCanvasElement; props: PropSprite[] }, cast: { who: CastName; spec: CharacterSpec; model?: Character3DModel }[], hasFriend: boolean, hasMet: boolean, hush: boolean, assets: Map<number, LoadedModel>) {
    // near·far를 세트 크기(수 W)에 맞춰 좁힌다 — 깊이 정밀도가 좋아져 겹친 면이 깜빡이지 않는다
    this.camera = new THREE.PerspectiveCamera(stageFov(), 1 / FRAME_ASPECT, 0.15, 16);
    const k = wallDepth(set.floorY);
    const zWall = wallZ(k);
    const foot = wallFootRow(k);
    const X0 = TEX_LEFT - 390, X1 = TEX_LEFT + TEX_W + 390;   // 3 W: 그 밖은 거울 반복
    // 뒷막: 벽 발치 위쪽 전부 (바닥 경계선이 발치보다 높으면 그 사이의 바닥 그림도 뒷막에 — 먼 물·먼 풀밭처럼 읽힌다)
    // 그림 위아래 너머(행 <0, >844)는 텍스처 끝 행이 늘어난다(wrapT clamp) — 활동 화면의 흔들림·위아래 각도에서 종이색이 안 드러나게
    // 뒷막은 발치보다 조금 아래(+6행)까지 내려와 바닥과 겹치고, 바닥은 polygonOffset으로 겹친 곳에서 진다 — 이음새가 깜빡이지 않는다
    const backdrop = projected(textureOf(set.backdrop, true), X0, -400, X1, foot + 6, 24, 20, (fx, fy) => hitVertical(rayFromFrame(fx, fy), zWall), stageUv, { alphaTest: 0.02, alphaToCoverage: false });
    backdrop.renderOrder = -3;
    this.add(this.bg, backdrop);
    // 바닥: 벽 발치부터 그림 끝(프레임 아래 한 프레임)과 그 너머까지, 눕힌 평면에
    const ground = projected(textureOf(set.ground, true), X0, foot, X1, STAGE_H + 160, 24, 36, groundOrFar, stageUv, { alphaTest: 0.02, alphaToCoverage: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    ground.renderOrder = -2;
    this.add(this.bg, ground);
    // 3D 소품(props3d.ts)이 있는 장소는 그 소품의 종이 카드를 생략한다 (그림자는 남긴다)
    // hush(시간표)면 말풍선 아래 소품은 빈자리로, glb가 있는 소품도 코드 빌더에 넘기지 않는다 — 빌더는 없는 번호를 건너뛴다
    const visible = set.props.map((p, i) => (hush && p.top) || assets.has(i) ? undefined : p) as PropSprite[];
    if (assets.size) this.bg.add(...toonLights());
    // glb 소품 (assets.json): 톤 패스를 거친 모델을 2D 상자의 자리·크기에
    for (const [i, model] of assets) {
      const p = set.props[i]!;
      if (hush && p.top) continue;
      const base = hitGround(rayFromFrame(frameOfCol((p.x0 + p.x1) / 2), frameOfRow(p.base)));
      if (!base) continue;
      const s = (CAM_DIST - base[2]) / CAM_DIST / 390;   // 그림 1열 = 몇 W (그 깊이에서)
      const g = placeInBox(model, [base[0], 0, base[2]], (p.x1 - p.x0) * s, (p.base - p.y0) * s);
      this.bg.add(g);
      this.shadow(this.bg, base, ((p.x1 - p.x0) / 390) * ((CAM_DIST - base[2]) / CAM_DIST) * 0.5);
    }
    const built = build3dProps(sceneTypeFor(type), visible);
    if (built) {
      this.bg.add(built.built.group, ...toonLights());
      this.own.push(...built.built.disposables);
    }
    // 소품: 서는 카드는 바닥 접점의 깊이에 세운 평면, 눕는 것은 바닥에
    set.props.forEach((p, i) => {
      if ((hush && p.top) || assets.has(i)) return;
      if (built?.handled.has(i)) {
        const g = hitGround(rayFromFrame(frameOfCol((p.x0 + p.x1) / 2), frameOfRow(p.base)));
        if (g) this.shadow(this.bg, g, (p.x1 - p.x0) / 390 * (CAM_DIST - g[2]) / CAM_DIST * 0.5);
        return;
      }
      const tex = textureOf(p.canvas, false);
      const uv = (col: number, row: number): [number, number] => [(col - p.x0) / (p.x1 - p.x0), 1 - (row - p.y0) / (p.y1 - p.y0)];
      if (p.lie) {
        // 눕는 것은 바닥과 같은 높이라 깊이 검사 없이 바닥 바로 다음에 그린다 (z-fighting 없음). 서는 것은 그 뒤에 깊이로 겹친다
        const lying = projected(tex, p.x0, p.y0, p.x1, p.y1, 6, 6, groundOrFar, uv, { depthWrite: false, depthTest: false, alphaTest: 0.05 });
        lying.renderOrder = -1;
        this.add(this.bg, lying);
        return;
      }
      const base = hitGround(rayFromFrame(frameOfCol((p.x0 + p.x1) / 2), frameOfRow(p.base)));
      const z = base ? base[2] : zWall + 0.01;
      this.add(this.bg, projected(tex, p.x0, p.y0, p.x1, p.y1, 4, 4, (fx, fy) => hitVertical(rayFromFrame(fx, fy), z), uv));
      if (base) this.shadow(this.bg, base, (p.x1 - p.x0) / 390 * (CAM_DIST - z) / CAM_DIST * 0.5);
    });
    // 인물: 3D 캐릭터(character3d)를 2D 상자의 발 자리·너비에 (깊이는 CAST_DEPTH, me = 캐릭터 평면 z 0). 활동 화면은 인물을 DOM으로 얹으니 비어 있다
    if (cast.length) this.fg.add(...characterLights());
    for (const { who, spec, model: loaded } of cast) {
      const r = castRect(who, hasFriend, hasMet);
      const z = CAM_DIST * (1 - CAST_DEPTH[who]);
      const feet = hitVertical(rayFromFrame(frameOfCol((r.x0 + r.x1) / 2), frameOfRow(r.y1 - 0.09 * (r.x1 - r.x0))), z);
      const width = ((r.x1 - r.x0) / 390) * ((CAM_DIST - z) / CAM_DIST);
      const model = loaded ?? buildCharacter(spec);
      if (who === 'ghost') ghostify(model);
      placeCharacter(model, [feet[0], 0, feet[2]], width);
      model.animate(0);
      this.fg.add(model.group);
      this.cast.push(model);
      if (who !== 'ghost') this.shadow(this.bg, [feet[0], 0, feet[2]], ((r.x1 - r.x0) / 390) * 0.42);
    }
  }

  private add(scene: THREE.Scene, mesh: THREE.Mesh): void {
    scene.add(mesh);
    this.own.push(mesh.geometry, mesh.material as THREE.Material);
  }

  /** 발밑 그림자: 바닥에 눕힌 타원 (텍스처는 공유) */
  private shadow(scene: THREE.Scene, at: Vec3, w: number): void {
    const geo = new THREE.PlaneGeometry(w, w * 0.5);
    // 바닥과 같은 높이: 깊이 검사 없이 바닥 다음에 (z-fighting 없음)
    const mat = new THREE.MeshBasicMaterial({ map: textureOf(shadowSprite(), false), transparent: true, opacity: 0.32, depthWrite: false, depthTest: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(at[0], 0.002, at[2]);
    m.renderOrder = -1;
    scene.add(m);
    this.own.push(geo, mat);
  }

  /** 텍스처를 구운 뒤 만든다 (장소·인물별 캐시라 두 번째부터는 바로) */
  static async create(spec: StageSpec, withCast = true): Promise<StageView> {
    const hasFriend = !!spec.friendColor, hasMet = !!spec.metColor;
    const wanted: { who: CastName; spec: CharacterSpec }[] = [];
    if (withCast) {
      if (spec.seenColor) wanted.push({ who: 'ghost', spec: { pose: 'idle', variant: 'friend', color: spec.seenColor } });
      if (spec.friendColor) wanted.push({ who: 'friend', spec: { pose: 'wave', variant: 'friend', color: spec.friendColor } });
      wanted.push({ who: 'me', spec: { pose: spec.pose, variant: 'me' } });
      if (spec.metColor) wanted.push({ who: 'met', spec: { pose: 'wave', variant: 'friend', color: spec.metColor } });
    }
    const scene = sceneTypeFor(spec.type);
    const set = await sceneSet(spec.type, !!spec.hush);
    // glb 소품·캐릭터가 매니페스트에 있으면 미리 읽는다 (캐시라 두 번째부터는 즉시)
    const assets = new Map<number, LoadedModel>();
    await Promise.all(set.props.map(async (_, i) => { const e = propAsset(scene, i); if (e) { try { assets.set(i, await loadModel(e)); } catch { /* 못 읽으면 코드 도형 */ } } }));
    const castWithModels = await Promise.all(wanted.map(async w => {
      const e = characterAsset(w.spec.variant);
      if (!e) return w;
      try { return { ...w, model: await loadCharacterModel(e) as Character3DModel }; } catch { return w; }
    }));
    return new StageView(spec.type, set, castWithModels, hasFriend, hasMet, !!spec.hush, assets);
  }

  /** 비트맵 w×h로 그려 bg·fg 캔버스에 복사한다(fg가 없으면 세트만). full = 무대 전체를 보는 활동 화면. 렌더러가 없으면 아무것도 안 한다 */
  render(crop: StageCrop, bg: HTMLCanvasElement, fg: HTMLCanvasElement | null, w: number, h: number, full = false): void {
    const r = getRenderer();
    if (!r || w < 2 || h < 2) return;
    if (w > glW || h > glH) { glW = Math.max(glW, w); glH = Math.max(glH, h); r.setSize(glW, glH, false); }
    const pose = stagePose(crop, CAM_DIST, full);
    this.size = [w, h];
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
    if (!fg) return;
    r.clear(true, false, false);   // 색만 지우고 깊이는 남긴다 — 앞의 소품이 인물을 가린다
    r.render(this.fg, cam);
    blit(fg);
  }

  private size: [number, number] = [0, 0];
  /** 마지막 render의 카메라로 월드 점을 캔버스 픽셀로 (DOM 인물을 세트에 맞춰 옮길 때). 카메라 뒤면 null */
  project(p: Vec3): [number, number] | null {
    const v = new THREE.Vector3(...p).project(this.camera);
    if (v.z > 1) return null;
    return [((v.x + 1) / 2) * this.size[0], ((1 - v.y) / 2) * this.size[1]];
  }

  dispose(): void {
    for (const o of this.own) o.dispose();
    for (const m of this.cast) m.dispose();
    this.own = []; this.cast = [];
  }
}

/** 캐릭터 한 명의 화면 (Character3D): 자기 장면·카메라, 공용 렌더러로 정사각 캔버스에 그린다 */
export class CharacterView {
  private scene = new THREE.Scene();
  private camera = characterCamera();
  private model: Character3DModel;
  private constructor(model: Character3DModel) {
    this.model = model;
    this.scene.add(this.model.group, ...characterLights());
  }
  /** 매니페스트에 glb 캐릭터가 있으면 그것(톤 패스 거침), 없으면 코드 캐릭터 */
  static async create(spec: CharacterSpec): Promise<CharacterView> {
    const e = characterAsset(spec.variant);
    if (e) { try { return new CharacterView(await loadCharacterModel(e) as Character3DModel); } catch { /* 코드 캐릭터로 */ } }
    return new CharacterView(buildCharacter(spec));
  }
  render(canvas: HTMLCanvasElement, px: number, t: number): void {
    const r = getRenderer();
    if (!r || px < 2) return;
    if (px > glW || px > glH) { glW = Math.max(glW, px); glH = Math.max(glH, px); r.setSize(glW, glH, false); }
    this.model.animate(t);
    r.setViewport(0, 0, px, px);
    r.setScissor(0, 0, px, px);
    r.setScissorTest(true);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(r.domElement, 0, glH - px, px, px, 0, 0, px, px);
  }
  dispose(): void { this.model.dispose(); }
}
