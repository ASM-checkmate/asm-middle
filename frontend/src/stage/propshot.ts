// ─── dev 훅: 코드 소품(props3d)을 3/4 각도에서 그늘지게 그려 PNG로 (ADR-0014 개정 8) ────────────────────
// 2D 소품 그림은 시점이 뒤섞여(상판은 위에서, 다리는 옆에서) 이미지→3D 생성 모델을 헷갈리게 한다. 코드 도형을 부드러운 조명으로
// 3/4 뷰에서 렌더한 그림은 원근·음영 단서가 일관돼 생성 입력으로 더 낫다. scripts/export-props.mjs가 `window.__stage.propShot`으로 부른다.
import * as THREE from 'three';
import { build3dProps } from './props3d';
import { sceneSet } from './textures';
import { getRenderer, ensureSize } from './render';
import type { SceneType } from '../scenes';
import type { PropSprite } from './textures';

export interface PropShotOptions {
  /** 카메라가 도는 각 (°, 오른쪽에서 보면 +). 기본 35 */
  yaw?: number;
  /** 내려다보는 각 (°). 기본 22 */
  pitch?: number;
  /** 결과 한 변 (px). 기본 512 */
  size?: number;
  /** 잉크 외곽선 껍질을 남길지. 기본 true */
  ink?: boolean;
}

/** 장소의 소품 번호 하나를 3/4 뷰로 렌더해 캔버스로. 코드 도형이 없는 소품이면 null */
export async function propShot(scene: SceneType, index: number, o: PropShotOptions = {}): Promise<HTMLCanvasElement | null> {
  const r = getRenderer();
  if (!r) return null;
  const set = await sceneSet(scene);
  const only = set.props.map((p, i) => (i === index ? p : undefined)) as PropSprite[];
  const built = build3dProps(scene, only);
  if (!built || !built.handled.has(index)) return null;
  const group = built.built.group;
  // 톤 재질 → 부드러운 램버트 (같은 색), 껍질은 선택
  group.traverse(obj => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material & { color?: THREE.Color };
    if (mat.side === THREE.BackSide) { m.visible = o.ink !== false; return; }
    if (mat.color) m.material = new THREE.MeshLambertMaterial({ color: mat.color });
  });
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const size = o.size ?? 512;
  const yaw = (o.yaw ?? 35) * Math.PI / 180, pitch = (o.pitch ?? 22) * Math.PI / 180;
  const cam = new THREE.PerspectiveCamera(30, 1, radius * 0.1, radius * 20);
  const d = radius / Math.sin(cam.fov / 2 * Math.PI / 180) * 1.05;
  cam.position.set(c.x + d * Math.sin(yaw) * Math.cos(pitch), c.y + d * Math.sin(pitch), c.z + d * Math.cos(yaw) * Math.cos(pitch));
  cam.lookAt(c);
  const sc = new THREE.Scene();
  sc.add(group, new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(c.x + radius * 2, c.y + radius * 3, c.z + radius * 2.5);
  sc.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(c.x - radius * 3, c.y + radius, c.z + radius);
  sc.add(fill);
  const gl = ensureSize(size, size);
  r.setViewport(0, gl.h - size, size, size);
  r.setScissor(0, gl.h - size, size, size);
  r.setScissorTest(true);
  r.clear(true, true, true);
  r.render(sc, cam);
  r.setScissorTest(false);
  const out = document.createElement('canvas');
  out.width = size; out.height = size;
  out.getContext('2d')!.drawImage(r.domElement, 0, 0, size, size, 0, 0, size, size);
  built.built.disposables.forEach(x => x.dispose());
  return out;
}
