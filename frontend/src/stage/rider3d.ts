// ─── 지도 위 탈것 (ADR-0014 개정 6) — 코드 로우폴리 3D ─────────────────────────
// 2D 코스튬(character/costumes.tsx)의 상자(viewBox: walk 200×200 · car/boat 240×200 · subway 280×200 · train 288×200 · plane 256×160)를
// "탈것 단위"로 그대로 쓴다: 바닥 y=0, 진행 방향 +x(화면 오른쪽), 카메라는 옆에서 살짝 앞·위로 돌아(3/4) 본다.
// 캐릭터는 character3d의 모델을 태우고(머리가 창 위로 나온다 — 2D의 선루프처럼), 바퀴는 돌고 몸은 흔들린다. 뒤집기(facing)와 비행기
// 기울임은 지도가 예전처럼 CSS(.mv-flip/.mv-tilt)로 한다 — 캔버스도 같은 DOM 자리에 있다.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Builder, C } from './props3d';
import { buildCharacter, characterLights, placeCharacter } from './character3d';
import type { Character3DModel } from './character3d';
import type { TransportMode } from '../sim/types';

export const RIDER_VIEW: Record<TransportMode, [number, number]> = {
  walk: [200, 200], car: [240, 200], boat: [240, 200], subway: [280, 200], train: [288, 200], plane: [256, 160],
};

export interface RiderSpec { mode: TransportMode; friend: boolean; night: boolean; sleeping: boolean; lineColor?: string; friendColor?: string }

interface Vehicle { group: THREE.Group; wheels: THREE.Object3D[]; bob: number; dispose(): void }

function wheel(b: Builder, x: number, r: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = b.part(new THREE.CylinderGeometry(r, r, 10, 18), C.ink, [x, r, z], [Math.PI / 2, 0, 0], parent);
  b.part(new THREE.CylinderGeometry(r * 0.42, r * 0.42, 11, 12), C.paper, [x, r, z], [Math.PI / 2, 0, 0], parent);
  return m;
}

/** 탈것 하나 (캐릭터 자리는 seat: [x, y, z, 축척]) */
function buildVehicle(spec: RiderSpec): Vehicle & { seat: [number, number, number, number]; seat2?: [number, number, number, number] } {
  const b = new Builder(2.4);
  const g = b.group;
  const wheels: THREE.Object3D[] = [];
  const line = spec.lineColor ?? '#FF6A48';
  let seat: [number, number, number, number] = [0, 0, 0, 1], seat2: [number, number, number, number] | undefined;
  switch (spec.mode) {
    case 'walk':
      seat = [10, 0, 0, 0.9];
      if (spec.friend) seat2 = [-52, 0, -18, 0.78];
      break;
    case 'car': {
      b.part(new RoundedBoxGeometry(160, 46, 74, 4, 10), C.coral, [0, 45, 0]);
      b.part(new RoundedBoxGeometry(92, 40, 66, 4, 12), C.coral, [-6, 86, 0]);
      b.part(new RoundedBoxGeometry(80, 26, 68, 2, 6), C.sky, [-6, 90, 0]);   // 창 띠
      wheels.push(wheel(b, 52, 20, 40, g), wheel(b, -52, 20, 40, g), wheel(b, 52, 20, -40, g), wheel(b, -52, 20, -40, g));
      const lamp = b.ellipsoid(6, 6, 6, C.sun, [82, 44, 24]);
      if (spec.night) { const glow = new THREE.Mesh(new THREE.SphereGeometry(16, 12, 8), new THREE.MeshBasicMaterial({ color: C.sun, transparent: true, opacity: 0.35 })); glow.position.copy(lamp.position); g.add(glow); b.disposables.push(glow.geometry, glow.material as THREE.Material); }
      seat = [-6, 60, 0, 0.5];
      if (spec.friend) seat2 = [-40, 60, 0, 0.44];
      break;
    }
    case 'boat': {
      b.part(new RoundedBoxGeometry(170, 36, 70, 3, 10), C.paper, [0, 18, 0]);
      b.part(new THREE.ConeGeometry(35, 40, 4), C.paper, [104, 18, 0], [0, Math.PI / 4, -Math.PI / 2]);
      b.part(new RoundedBoxGeometry(60, 34, 50, 3, 8), C.sky, [-30, 52, 0]);
      b.part(new THREE.CylinderGeometry(2.5, 2.5, 90, 8), C.ink, [30, 80, 0]);
      b.part(new RoundedBoxGeometry(34, 22, 2, 1, 3), C.coral, [47, 112, 0]);
      seat = [10, 36, 0, 0.5];
      if (spec.friend) seat2 = [-40, 70, 0, 0.42];
      break;
    }
    case 'plane': {
      b.part(new THREE.CylinderGeometry(22, 22, 170, 16), C.paper, [0, 60, 0], [0, 0, Math.PI / 2]);
      b.part(new THREE.ConeGeometry(22, 40, 16), C.coral, [105, 60, 0], [0, 0, -Math.PI / 2]);
      b.part(new THREE.SphereGeometry(22, 16, 12), C.paper, [-85, 60, 0]);
      b.part(new RoundedBoxGeometry(34, 4, 200, 1, 4), C.coral, [10, 56, 0]);           // 날개
      b.part(new RoundedBoxGeometry(30, 40, 4, 1, 4), C.coral, [-78, 90, 0]);           // 꼬리
      b.part(new RoundedBoxGeometry(20, 4, 70, 1, 4), C.coral, [-78, 66, 0]);
      b.part(new THREE.CylinderGeometry(7, 7, 6, 12), C.sky, [30, 68, 22], [Math.PI / 2, 0, 0]);  // 창
      seat = [20, 72, 0, 0.38];
      if (spec.friend) seat2 = [-20, 72, 0, 0.34];
      break;
    }
    case 'train':
    case 'subway': {
      const w = spec.mode === 'train' ? 240 : 230;
      const color = spec.mode === 'train' ? C.mint : C.paper;
      b.part(new RoundedBoxGeometry(w, 74, 74, 4, 12), color, [0, 52, 0]);
      b.part(new RoundedBoxGeometry(w - 10, 10, 78, 2, 6), spec.mode === 'train' ? C.ink3 : line, [0, 92, 0]);
      b.part(new RoundedBoxGeometry(w - 24, 26, 78, 2, 6), C.sky, [0, 60, 0]);            // 창 띠
      if (spec.mode === 'subway') b.part(new RoundedBoxGeometry(w - 20, 8, 78, 2, 4), line, [0, 34, 0]);
      for (const x of [w / 2 - 40, -(w / 2 - 40), 30, -30]) wheels.push(wheel(b, x, 12, 34, g), wheel(b, x, 12, -34, g));
      if (spec.mode === 'train') b.part(new RoundedBoxGeometry(24, 40, 40, 3, 6), C.coral, [w / 2 - 14, 52, 0]);
      seat = [20, 42, 0, 0.42];
      if (spec.friend) seat2 = [-50, 42, 0, 0.4];
      break;
    }
  }
  const bob = spec.mode === 'boat' ? 4 : spec.mode === 'plane' ? 3 : spec.mode === 'walk' ? 0 : 1.5;
  return { group: g, wheels, bob, seat, seat2, dispose: () => b.disposables.forEach(d => d.dispose()) };
}

/** 탈것 + 인물의 화면: 공용 렌더러로 마커 캔버스에 그린다 */
export class RiderView {
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private vehicle: ReturnType<typeof buildVehicle>;
  private cast: Character3DModel[] = [];
  private shadow: THREE.Mesh;
  readonly mode: TransportMode;

  constructor(spec: RiderSpec) {
    this.mode = spec.mode;
    const [vw, vh] = RIDER_VIEW[spec.mode];
    this.vehicle = buildVehicle(spec);
    this.scene.add(this.vehicle.group, ...characterLights());
    const pose = spec.mode === 'walk' ? 'walk' : spec.sleeping ? 'sleep' : 'sit';
    const me = buildCharacter({ pose, variant: 'me' });
    placeCharacter(me, [this.vehicle.seat[0], this.vehicle.seat[1], this.vehicle.seat[2]], 200 * this.vehicle.seat[3], -0.6);
    this.scene.add(me.group);
    this.cast.push(me);
    if (spec.friend && this.vehicle.seat2) {
      const f = buildCharacter({ pose: spec.mode === 'walk' ? 'walk' : 'sit', variant: 'friend', color: spec.friendColor });
      placeCharacter(f, [this.vehicle.seat2[0], this.vehicle.seat2[1], this.vehicle.seat2[2]], 200 * this.vehicle.seat2[3], -0.6);
      this.scene.add(f.group);
      this.cast.push(f);
    }
    // 그림자 (배·비행기는 없음 — MOVEMENT_SPEC §3.4)
    const sg = new THREE.CircleGeometry(vw * 0.3, 24);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.14, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.scale.set(1, 0.3, 1); this.shadow.position.y = 0.5;
    this.shadow.visible = spec.mode !== 'boat' && spec.mode !== 'plane';
    this.scene.add(this.shadow);
    // 카메라: 옆(+z)에서 살짝 앞·위로 돈 3/4 — 상자 vw×vh가 딱 맞는 직교
    this.camera = new THREE.OrthographicCamera(-vw / 2, vw / 2, vh - 18, -18, 1, 4000);
    const yaw = 0.42, pitch = 0.22, d = 1200;
    this.camera.position.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d + 40, Math.cos(yaw) * Math.cos(pitch) * d);
    this.camera.lookAt(0, 40, 0);
  }

  render(canvas: HTMLCanvasElement, w: number, h: number, t: number, moving: boolean, r: THREE.WebGLRenderer, glH: number): void {
    const v = this.vehicle;
    const tt = moving ? t : 0;
    for (const wh of v.wheels) wh.rotation.z = -tt * 6;
    v.group.position.y = v.bob * Math.sin(tt * Math.PI * 2 / (this.mode === 'boat' ? 2.4 : 0.9));
    v.group.rotation.z = this.mode === 'boat' ? 0.04 * Math.sin(tt * Math.PI * 2 / 2.4) : 0;
    for (const c of this.cast) { c.animate(tt); if (this.mode !== 'walk') c.group.position.y += v.group.position.y; }
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    r.setScissorTest(true);
    r.clear(true, true, true);
    r.render(this.scene, this.camera);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(r.domElement, 0, glH - h, w, h, 0, 0, w, h);
    if (this.mode !== 'walk') for (const c of this.cast) c.group.position.y -= v.group.position.y;
  }

  dispose(): void { this.vehicle.dispose(); this.cast.forEach(c => c.dispose()); this.shadow.geometry.dispose(); (this.shadow.material as THREE.Material).dispose(); }
}
