// ─── 밖에서 만든 3D 모델(glb) 불러오기 (ADR-0014 개정 7) ─────────────────────
// public/assets/models/ 아래의 glb를 매니페스트(assets.json)로 찾아 GLTFLoader로 읽고 톤 패스(tone.ts)를 거친 뒤,
// 2D 그림의 소품 상자·바닥 접점에 맞춰 놓는다(placeInBox). 매니페스트에 없는 소품은 코드 도형(props3d)이 그대로 맡는다 —
// 그래서 glb는 하나씩 들어와도 된다. 캐릭터 glb는 애니메이션 클립이 있으면 첫 클립을 돌린다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyTone } from './tone';
import type { SceneType } from '../scenes';
import manifest from './assets.json';

export interface AssetEntry {
  /** public/ 기준 경로, 예: /assets/models/cafe-table.glb */
  url: string;
  /** 외곽선 두께 (모델 정규화 뒤, 200단위 기준). 기본 2.6 */
  line?: number;
  /** 면 수 줄이기 비율 0..1 (예: 0.6 = 60 % 덜어낸다). 기본 0 */
  simplify?: number;
  /** 모델의 앞이 +z가 아니면 y축 회전(°) — rotate 뒤에 적용 */
  yaw?: number;
  /** 정규화 전 축 보정 (x·y·z 회전, °, 그 순서). 예: TripoSR은 z가 위·x가 앞이라 [-90, 0, 90] */
  rotate?: [number, number, number];
}
interface Manifest {
  /** 장소별 소품: P 순서 번호 → glb */
  props: Partial<Record<SceneType, Record<string, AssetEntry>>>;
  /** 캐릭터: me · friend */
  character: Partial<Record<'me' | 'friend', AssetEntry>>;
  vehicles?: Partial<Record<string, AssetEntry>>;
}
const MANIFEST = manifest as unknown as Manifest;   // JSON의 number[]는 rotate 튜플로 못 좁힌다

export const propAsset = (scene: SceneType, index: number): AssetEntry | undefined => MANIFEST.props[scene]?.[String(index)];
export const characterAsset = (variant: 'me' | 'friend'): AssetEntry | undefined => MANIFEST.character[variant];

export interface LoadedModel {
  /** 200단위 상자에 정규화된 원본 (복제해서 쓴다) */
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  /** 정규화 전 크기 (모델 단위) */
  size: THREE.Vector3;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModel>>();

/** glb를 읽어 톤을 입히고, 바닥 중심이 원점·높이가 200단위가 되게 정규화한다 */
export function loadModel(entry: AssetEntry): Promise<LoadedModel> {
  let p = cache.get(entry.url);
  if (!p) {
    p = loader.loadAsync(entry.url).then(gltf => {
      const root = gltf.scene;
      if (entry.rotate) {
        // 축 보정은 상자를 재기 전에 — 세워진 뒤의 높이로 정규화하고, 바닥 접점도 세워진 뒤의 바닥이어야 한다
        const [rx, ry, rz] = entry.rotate;
        root.rotation.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180);
        root.updateMatrixWorld(true);
      }
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const k = 200 / Math.max(size.y, 1e-6);
      // 바닥 가운데를 원점으로, 200단위 높이로
      const wrap = new THREE.Group();
      const inner = new THREE.Group();   // 회전된 root를 그 회전 그대로 옮긴다
      inner.position.set(-center.x, -box.min.y, -center.z);
      inner.add(root);
      wrap.add(inner);
      wrap.scale.setScalar(k);
      if (entry.yaw) wrap.rotation.y = entry.yaw * Math.PI / 180;
      applyTone(root, { line: (entry.line ?? 2.6) / k, simplify: entry.simplify });
      return { root: wrap, clips: gltf.animations, size };
    });
    cache.set(entry.url, p);
    p.catch(() => cache.delete(entry.url));
  }
  return p;
}

/** 정규화된 모델을 상자(너비 w·높이 h, 월드)에 맞춰 놓는다: 비율을 지키며 상자 안에 들어가게, 바닥 가운데가 feet */
export function placeInBox(model: LoadedModel, feet: THREE.Vector3 | [number, number, number], w: number, h: number): THREE.Group {
  const g = model.root.clone(true);
  const aspect = model.size.x / Math.max(model.size.y, 1e-6);   // 너비/높이
  const modelW = 200 * aspect;
  const k = Math.min(w / modelW, h / 200);
  g.scale.multiplyScalar(k);
  const f = Array.isArray(feet) ? feet : [feet.x, feet.y, feet.z];
  g.position.set(f[0]!, f[1]!, f[2]!);
  return g;
}

/** glb 캐릭터를 character3d의 모델처럼: 첫 애니메이션 클립을 돌리고, 없으면 정지 */
export async function loadCharacterModel(entry: AssetEntry): Promise<{ group: THREE.Group; animate(t: number): void; dispose(): void }> {
  const m = await loadModel(entry);
  const group = m.root.clone(true);
  const mixer = m.clips.length ? new THREE.AnimationMixer(group) : null;
  if (mixer && m.clips[0]) mixer.clipAction(m.clips[0]).play();
  let last = 0;
  return {
    group,
    animate(t) { if (mixer) { mixer.update(Math.max(0, t - last)); last = t; } },
    dispose() { mixer?.stopAllAction(); },
  };
}
