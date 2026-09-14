// ─── VRM 랩 (dev page, `?lab=vrm`) — "야숨 느낌" 스파이크 ─────────────────────────────────────
// PNG 프레임(character 브랜치) 대신 3D 아바타(VRM, MToon 툰 셰이딩)를 툰 셰이딩 방 안에 세운다.
// 보려는 것: 진짜 그림자·조명이 붙은 애니 화풍이 나오는지, 걸음이 바닥을 잡는지(보폭 = 이동 거리), 머리카락(스프링 본)이 흔들리는지.
// 바닥을 누르면 걸어간다. window.__vrm 으로 스크립트가 움직인다 (scripts/shot.mjs).
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { PEOPLE, buildCharacter } from './Look3dLab';
import { SKIN, TOP, HAIR } from '../character/look';
import { buildIctHead, loadWeights } from './ictHead';
import { Eyes, Brows, Nose, Mouth, C as PAL } from '../character/shapes';
import { renderToStaticMarkup } from 'react-dom/server';

const CSS = `
.vlab{box-sizing:border-box;min-height:100%;background:#1B1715;color:#F4EDE6;padding:18px 14px 40px;font-family:var(--body);display:grid;justify-items:center;gap:14px}
.vlab h1{font-family:var(--display);font-size:22px;margin:0}
.vlab .sub{font-family:var(--mono);font-size:11px;color:#A69C93;letter-spacing:.08em;text-align:center}
.vlab .stage{width:362px;height:600px;border-radius:18px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.45);cursor:crosshair;position:relative;background:#2a2422}
.vlab canvas{display:block}
.vlab .rows{width:390px;display:grid;gap:10px}
.vlab .row{display:grid;grid-template-columns:52px 1fr;align-items:center;gap:8px}
.vlab .row b{font-family:var(--display);font-weight:400;font-size:13px;color:#CFC4BA}
.vlab .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.vlab .chip{min-height:34px;padding:0 12px;border-radius:999px;border:1px solid #4A403A;background:#2A2422;color:#EDE4DC;font-size:13px;font-family:var(--display)}
.vlab .chip.on{background:#F2B233;color:#1B1715;border-color:#F2B233}
.vlab .hint{font-family:var(--mono);font-size:11px;color:#8C817A;width:390px;line-height:1.5}
.vlab .note{position:absolute;left:10px;top:10px;font-family:var(--mono);font-size:11px;color:#F4EDE6;background:rgba(27,23,21,.6);padding:4px 8px;border-radius:8px}
`;

const W = 362, H = 600;
/** 방 안의 자리 (m). 바닥은 4×4, 뒷벽 z=-2, 왼벽 x=-2 */
const SPOTS: Record<string, [number, number]> = { door: [1.0, 1.1], center: [0.3, 0.55], bedside: [-0.05, -0.85], dresser: [1.2, -1.05] };
const WALK_SPEED = 0.9;      // m/s
const STRIDE = 0.62;         // 한 걸음(한 발) 거리 m — 걸음 주기를 이동 거리에 묶는다 (미끄러지지 않게)

/** 열세 칸 → 얼굴 텍스처. 2D 캐릭터(shapes.tsx)의 눈·눈썹·코·입 SVG를 그대로 래스터라이즈해 머리 앞면에 데칼로 입힌다 — 팀이 그린 표정이 3D에서도 같다.
 *  좌표는 2D 머리 기준(눈 중심 ±20,12 · 입 28 · 머리 타원 62×56). 그림이 비동기로 뜨면 텍스처를 갱신한다. 수염은 2D에 없어 캔버스로 덧그린다 */
function faceTexture(look: Look): THREE.CanvasTexture {
  const S = 512; const cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d')!;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const hair = HAIR[look.hairColor];
  const svg = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-62 -44 124 124" width={S} height={S}>
      <ellipse cx="-36" cy="24" rx="9" ry="5.5" fill="#FFB3A7" opacity="0.85" /><ellipse cx="36" cy="24" rx="9" ry="5.5" fill="#FFB3A7" opacity="0.85" />
      {look.beard === 'full' && <path d="M-40 18 q0 46 40 46 q40 0 40 -46 q-6 30 -40 30 q-34 0 -40 -30 Z" fill={hair} />}
      {look.beard === 'stubble' && <path d="M-36 20 q0 34 36 34 q36 0 36 -34 q-6 22 -36 22 q-30 0 -36 -22 Z" fill={PAL.ink} opacity="0.18" />}
      <Eyes kind={look.eyes ?? 'dot'} dx={0} />
      <Brows kind={look.brows ?? 'none'} dx={0} />
      <Nose kind={look.nose ?? 'none'} dx={0} fy={0} />
      <Mouth kind={look.mouth ?? 'smile'} dx={0} fy={0} />
      {look.beard === 'mustache' && <path d="M-14 24 q14 -8 28 0 q-14 5 -28 0 Z" fill={hair} />}
    </svg>
  );
  const img = new Image();
  img.onload = () => { g.clearRect(0, 0, S, S); g.drawImage(img, 0, 0, S, S); t.needsUpdate = true; };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return t;
}

/** 3단 툰 그라데이션 — 야숨처럼 빛을 끊어 칠한다 */
function toonRamp() {
  const data = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 235, 235, 235, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

interface KK { root: THREE.Object3D; mixer: THREE.AnimationMixer; clips: Record<string, THREE.AnimationAction>; cur: string; boneScale: { bone: THREE.Object3D; s: THREE.Vector3 }[]; follow?: { obj: THREE.Object3D; bone: THREE.Object3D; offset: THREE.Matrix4 }[] }
interface QB { bone: THREE.Object3D; rest: THREE.Quaternion; inv: THREE.Quaternion }   // 뼈 + 바인드 회전 + 바인드 세계회전의 역 (세계축 기준으로 돌리기 위해)
interface QA { root: THREE.Object3D; b: Record<string, QB>; scale: Record<string, THREE.Vector3> }
interface Rig { vrm: VRM; kk: KK | null; q: QA | null; pos: THREE.Vector3; target: THREE.Vector3 | null; heading: number; phase: number; walkT: number; pose: string }
/** `?char=kaykit&who=Knight|Rogue|Mage|Barbarian` — KayKit Adventurers(CC0, 리깅+애니메이션 76개) 캐릭터. 기본은 VRM Seed-san */
const CHAR = new URLSearchParams(location.search).get('char') ?? 'seed';
const WHO = new URLSearchParams(location.search).get('who') ?? 'Knight';
/** `&look=lmb|ljm|obama|trump` — Look3dLab 의 열세 칸을 KayKit 몸에 꽂는다: 파츠별 단색 + 머리 뼈에 얼굴 파츠 + 뼈 스케일로 얼굴형·체형 */
const LOOK = PEOPLE.find(p => p.id === new URLSearchParams(location.search).get('look'))?.look ?? null;
/** `&face=<id>` — 사진에서 생성한 얼굴 초상(public/dev-look3d/face/<id>.png, 초록 뺀 RGBA)을 데칼로. 머리카락까지 그림에 있으니 3D 머리카락 파츠는 숨긴다 */
const FACE = new URLSearchParams(location.search).get('face');
/** `&head=ict` — Quaternius 머리 파츠를 숨기고 ICT 머리(사진 피팅 축·표정·색·눈썹·눈·두피 머리카락)를 머리 뼈에 매단다. `&look=` 의 사람 id 로 weights.json 을 찾는다 */
const ICT = new URLSearchParams(location.search).get('head') === 'ict';
const ICT_HAIR: Record<string, string> = { trump: 'hair-bangs', obama: 'hair-buzz', ljm: 'hair-sidepart', lmb: 'hair-sidepart' };

export function VrmLab() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('아바타 여는 중…');
  const [outline, setOutline] = useState(true);
  const [night, setNight] = useState(false);
  const api = useRef<{ go: (x: number, z: number, pose?: string) => void; setOutline: (b: boolean) => void; setNight: (b: boolean) => void } | null>(null);

  useEffect(() => {
    const el = host.current; if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7dfd0);
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 50);
    camera.position.set(0.25, 2.1, 4.9); camera.lookAt(0.05, 0.65, -0.6);   // 낮은 3/4 시점 — 얼굴이 보이게

    // ── 조명: 창문 쪽에서 오는 따뜻한 햇빛 + 하늘/바닥 반사. 밤은 파란 달빛 + 스탠드
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
    sun.position.set(-2.2, 4.2, 1.2); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 12;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -3.2; sun.shadow.camera.right = sun.shadow.camera.top = 3.2;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    const hemi = new THREE.HemisphereLight(0xdfeeff, 0xa07850, 1.1);
    const lamp = new THREE.PointLight(0xffb060, 0, 4, 1.5); lamp.position.set(-1.85, 0.75, -1.4);
    scene.add(sun, hemi, lamp);

    // ── 방: 툰 재질 상자들 + 뒤집힌 껍질 윤곽선
    const ramp = toonRamp();
    const outlines: THREE.Mesh[] = [];
    const mat = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: ramp });
    const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, edge = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
      m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m);
      if (edge) {
        const o = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ color: 0x3a2a24, side: THREE.BackSide }));
        o.position.copy(m.position); o.scale.set(1 + 0.02 / w, 1 + 0.02 / h, 1 + 0.02 / d); scene.add(o); outlines.push(o);
      }
      return m;
    };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), mat(0xd9a877)); floor.rotation.x = -Math.PI / 2; floor.position.z = 1; floor.receiveShadow = true; scene.add(floor);
    // 마루 널 줄
    for (let i = -1.75; i < 2; i += 0.5) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 6), new THREE.MeshBasicMaterial({ color: 0xb98a5c })); l.rotation.x = -Math.PI / 2; l.position.set(i, 0.002, 1); scene.add(l); }
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), mat(0xc9ccd8)); rug.rotation.x = -Math.PI / 2; rug.position.set(0.2, 0.004, 0.2); rug.receiveShadow = true; scene.add(rug);
    box(4, 2.6, 0.1, 0xf3d9cc, 0, 1.3, -2.05, false);             // 뒷벽
    box(0.1, 2.6, 4, 0xf3d9cc, -2.05, 1.3, 0, false);             // 왼벽
    box(4, 0.1, 0.02, 0xe8c3b3, 0, 0.05, -1.99, false);           // 걸레받이
    // 창문 (뒷벽) — 하늘색 판 + 틀
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.0), new THREE.MeshBasicMaterial({ color: 0x8fd0ff })); sky.position.set(-0.3, 1.65, -1.995); scene.add(sky);
    box(1.3, 0.06, 0.06, 0xfaf3ea, -0.3, 2.18, -1.98); box(1.3, 0.06, 0.06, 0xfaf3ea, -0.3, 1.12, -1.98);
    box(0.06, 1.1, 0.06, 0xfaf3ea, -0.95, 1.65, -1.98); box(0.06, 1.1, 0.06, 0xfaf3ea, 0.35, 1.65, -1.98); box(0.05, 1.05, 0.04, 0xfaf3ea, -0.3, 1.65, -1.98);
    // 침대: 틀·매트리스·이불·베개·헤드보드
    box(1.5, 0.28, 2.0, 0x5b6470, -1.15, 0.14, -0.95);
    box(1.42, 0.16, 1.9, 0xf2c6c6, -1.15, 0.36, -0.9);
    box(1.44, 0.12, 1.2, 0xe9a3a8, -1.15, 0.5, -0.55);
    box(0.5, 0.12, 0.35, 0xfff6f2, -1.45, 0.5, -1.65); box(0.5, 0.12, 0.35, 0xfff6f2, -0.85, 0.5, -1.65);
    box(1.5, 0.9, 0.1, 0x5b6470, -1.15, 0.6, -1.98);
    // 협탁 + 스탠드
    box(0.45, 0.55, 0.45, 0xb07a4a, -1.85, 0.275, -1.45); box(0.16, 0.3, 0.16, 0xfff3d6, -1.85, 0.75, -1.45);
    // 서랍장 + 거울
    box(1.1, 0.85, 0.5, 0xb07a4a, 1.25, 0.425, -1.75);
    box(0.9, 0.9, 0.04, 0xbfe3f5, 1.25, 1.4, -1.99);
    box(0.5, 0.08, 0.04, 0xb07a4a, 1.25, 0.6, -1.49, false); box(0.5, 0.08, 0.04, 0xb07a4a, 1.25, 0.35, -1.49, false);
    box(0.12, 0.28, 0.12, 0xffffff, 0.85, 0.99, -1.75); box(0.12, 0.28, 0.12, 0xffffff, 1.65, 0.99, -1.75);

    // ── 아바타
    const rig: Rig = { vrm: null as unknown as VRM, kk: null, q: null, pos: new THREE.Vector3(SPOTS.door[0], 0, SPOTS.door[1]), target: null, heading: 0, phase: 0, walkT: 0, pose: 'idle' };
    /** Quaternius 계열 휴머노이드 리그 공통 마무리: 뼈 잡기, 얼굴형·체형 뼈 스케일, 머리 상자, 파츠(머리카락·안경·수염) 매달기, 얼굴 데칼 */
    const setupHumanRig = (root: THREE.Object3D, skinM: THREE.SkinnedMesh | null, label: string) => {
      const b: Record<string, QB> = {};
      for (const n of ['Hips', 'Abdomen', 'Torso', 'Neck', 'Head', 'UpperArm_L', 'LowerArm_L', 'UpperArm_R', 'LowerArm_R', 'UpperLeg_L', 'LowerLeg_L', 'UpperLeg_R', 'LowerLeg_R']) {
        const bone = root.getObjectByName(n); if (!bone) continue;
        b[n] = { bone, rest: bone.quaternion.clone(), inv: bone.getWorldQuaternion(new THREE.Quaternion()).invert() };
      }
      const scale: Record<string, THREE.Vector3> = {};
      if (LOOK && b.Head && !ICT) {
        // 얼굴 파츠: 머리 상자는 뼈 랜드마크로 잰다 (목 뼈 ~ 정수리 뼈). 스킨 정점은 바인드 공간이라 세계 좌표로 바로 못 쓴다
        const neckY = b.Neck.bone.getWorldPosition(new THREE.Vector3()).y;
        const topO = root.getObjectByName('Head_end'); const topY = topO ? topO.getWorldPosition(new THREE.Vector3()).y : neckY + 0.26;
        const headP = b.Head.bone.getWorldPosition(new THREE.Vector3());
        const hh = (topY - neckY) / 2; const c = new THREE.Vector3(headP.x, (topY + neckY) / 2 + 0.01, headP.z); const sz = new THREE.Vector3(hh * 1.5, hh * 2, hh * 1.5);
        const f = buildCharacter(LOOK, ramp, 'parts'); const holder = new THREE.Group(); b.Head.bone.add(holder);
        holder.position.copy(b.Head.bone.worldToLocal(c.clone())); holder.quaternion.copy(b.Head.inv);
        const ws = b.Head.bone.getWorldScale(new THREE.Vector3()); holder.scale.set(sz.x / 2 / ws.x, sz.y / 2 / ws.y, sz.z / 2 / ws.z); holder.add(f);
        const hg = f.getObjectByName('hair'); if (hg) { hg.position.y = 0.16; hg.scale.set(1.02, 0.98, 1.04); }
        const face = LOOK.face ?? 'round', build = LOOK.build ?? 'normal';
        const hs = face === 'long' ? [0.94, 1.15, 0.96] : face === 'square' ? [1.1, 1, 1.02] : face === 'heart' ? [1.02, 1.05, 1] : [1, 1, 1];
        const bw = build === 'wide' ? 1.25 : build === 'slim' ? 0.86 : 1;
        const BIG = 1.75;   // 치비 비례 (2D 캐릭터의 '머리가 키의 절반' 쪽으로)   // 머리를 키워 치비 쪽으로 — 실사 비례보다 방 안에서 얼굴이 읽힌다
        scale.Abdomen = new THREE.Vector3(bw, 1, bw); scale.Head = new THREE.Vector3(BIG * hs[0] / bw, BIG * hs[1], BIG * hs[2] / bw);
        root.updateMatrixWorld(true);
        // 머리 정점 상자와 얼굴 데칼용 스냅샷: 지금 자세로 스킨된 정점을 세계 좌표로 뽑는다 (bindMatrix 유무·노드 변환과 무관하게 맞다)
        const bb = new THREE.Box3(); const v = new THREE.Vector3(); let snap: THREE.BufferGeometry | null = null;
        if (skinM) {
          const sm = skinM as THREE.SkinnedMesh; sm.skeleton.update(); const pos = sm.geometry.attributes.position; const arr = new Float32Array(pos.count * 3);
          for (let i = 0; i < pos.count; i++) { sm.getVertexPosition(i, v); sm.localToWorld(v); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; if (v.y > neckY + 0.02) bb.expandByPoint(v); }
          snap = new THREE.BufferGeometry(); snap.setAttribute('position', new THREE.BufferAttribute(arr, 3)); if (sm.geometry.index) snap.setIndex(sm.geometry.index); snap.computeVertexNormals();
        }
        const bs = bb.getSize(new THREE.Vector3()), bc = bb.getCenter(new THREE.Vector3());
        if (!bb.isEmpty()) { holder.position.copy(b.Head.bone.worldToLocal(bc.clone())); holder.scale.set(bs.x / 2 / ws.x, bs.y / 2 / ws.y, bs.z / 2 / ws.z); }
        // 얼굴 데칼: 열세 칸을 그린 텍스처를 머리 앞면에 투영하고 머리 뼈에 붙인다
        if (snap && !bb.isEmpty()) {
          const tmp = new THREE.Mesh(snap); tmp.matrixAutoUpdate = false; tmp.matrixWorld.identity();
          const pos = FACE ? new THREE.Vector3(bc.x, bc.y + bs.y * 0.05, bb.max.z - bs.z * 0.1) : new THREE.Vector3(bc.x, bc.y - bs.y * 0.12, bb.max.z - bs.z * 0.05);
          const size = FACE ? new THREE.Vector3(bs.x * 1.35, bs.y * 1.35, bs.z * 0.9) : new THREE.Vector3(bs.x * 1.1, bs.y * 0.95, bs.z * 0.6);
          const geo = new DecalGeometry(tmp, pos, new THREE.Euler(0, 0, 0), size);
          const map = FACE ? new THREE.TextureLoader().load(`/dev-look3d/face/${FACE}.png`, tx => { tx.colorSpace = THREE.SRGBColorSpace; tx.needsUpdate = true; }) : faceTexture(LOOK);
          const decal = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
          if (FACE) { const hg = f.getObjectByName('hair'); if (hg) hg.visible = false; }
          scene.add(decal); decal.updateMatrixWorld(true); b.Head.bone.attach(decal);
        }
        setStatus(`${label} · 머리 ${bs.x.toFixed(2)}×${bs.y.toFixed(2)}×${bs.z.toFixed(2)}m · 뼈 ${Object.keys(b).length}`);
      } else setStatus(`${label} · 뼈 ${Object.keys(b).length}`);
      scene.add(root);
      return { b, scale };
    };
    const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));
    let disposed = false;
    if (CHAR === 'kaykit') new GLTFLoader().load(`/kaykit/${WHO}.glb`, gltf => {
      if (disposed) return;
      const root = gltf.scene;
      // 방에서는 무기·방패를 들지 않는다 — 이름으로 숨긴다
      root.traverse(o => { if (/Sword|Shield|Offhand|Staff|Dagger|Crossbow|Axe|Wand|Knife|Bow/i.test(o.name)) o.visible = false; });
      const box = new THREE.Box3().setFromObject(root); const h = box.max.y - box.min.y; const k = 1.5 / h;
      root.scale.setScalar(k);
      root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; const old = m.material as THREE.MeshStandardMaterial; m.material = new THREE.MeshToonMaterial({ map: old.map, color: old.color, gradientMap: ramp }); } });
      const boneScale: { bone: THREE.Object3D; s: THREE.Vector3 }[] = [];
      if (LOOK) {
        // 겉모습 모드: 망토·모자·후드는 벗고, 파츠를 단색으로 (머리 = 피부, 몸·팔 = 상의, 다리 = 바지). 얼굴 텍스처가 빠지니 눈·입은 파츠로 얹는다
        root.traverse(o => { if (/Cape|Hat|Helmet|Hood/i.test(o.name)) o.visible = false; });
        root.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const c = /Head/.test(m.name) ? SKIN[LOOK.skin] : /Leg/.test(m.name) ? '#3a3f55' : TOP[LOOK.top]; m.material = new THREE.MeshToonMaterial({ color: new THREE.Color(c), gradientMap: ramp }); });
        const headBone = root.getObjectByName('head'); const headMesh = root.getObjectByProperty('name', `${WHO}_Head`) as THREE.Mesh | undefined;
        if (headBone && headMesh) {
          root.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(headMesh); const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
          // 얼굴 파츠를 머리 뼈의 자식으로: 위치는 머리 메시의 중심, 방향은 바인드 포즈에서 세계축과 같게, 크기는 머리 반폭
          const f = buildCharacter(LOOK, ramp, 'kaykit');
          const holder = new THREE.Group(); headBone.add(holder);
          holder.position.copy(headBone.worldToLocal(c.clone()));
          const q = headBone.getWorldQuaternion(new THREE.Quaternion()).invert(); holder.quaternion.copy(q);
          const ws = headBone.getWorldScale(new THREE.Vector3());
          holder.scale.set(sz.x / 2 / ws.x, sz.y / 2 / ws.y, sz.z / 2 / ws.z);
          holder.add(f);
          const hg = f.getObjectByName('hair'); if (hg) { hg.position.y = 0.14; hg.scale.set(1, 0.96, 1.02); }   // 상자 머리에서는 캡을 조금 올려 눈썹을 드러낸다
          // 얼굴형·체형은 뼈 스케일로 (클립이 매 프레임 scale 을 쓰면 update 뒤에 다시 덮는다)
          const face = LOOK.face ?? 'round', build = LOOK.build ?? 'normal';
          const hs = face === 'long' ? [0.94, 1.15, 0.96] : face === 'square' ? [1.1, 1, 1.02] : face === 'heart' ? [1.02, 1.05, 1] : [1, 1, 1];
          const bw = build === 'wide' ? 1.25 : build === 'slim' ? 0.86 : 1;
          const spine = root.getObjectByName('spine');
          if (spine) boneScale.push({ bone: spine, s: new THREE.Vector3(bw, 1, bw) });
          boneScale.push({ bone: headBone, s: new THREE.Vector3(hs[0] / bw, hs[1], hs[2] / bw) });
        }
      }
      const mixer = new THREE.AnimationMixer(root); const clips: Record<string, THREE.AnimationAction> = {};
      for (const c of gltf.animations) clips[c.name] = mixer.clipAction(c);
      clips.Idle?.play();
      rig.kk = { root, mixer, clips, cur: 'Idle', boneScale }; scene.add(root);
      setStatus(`KayKit ${WHO} · CC0 · 키 ${h.toFixed(2)}→1.50m · 클립 ${gltf.animations.length}`);
    }, undefined, e => setStatus('KayKit 못 읽음: ' + String(e)));
    else if (CHAR === 'quat') new GLTFLoader().load('/quat/male-casual.glb', gltf => {
      // Quaternius Ultimate Animated Character(CC0)의 평상복 남성 — usda 미러엔 클립이 없어 뼈를 절차적으로 돌린다. 재질 슬롯: Skin·Eyes·Hair·Shirt·Pants·Socks
      if (disposed) return;
      const root = gltf.scene;
      const box0 = new THREE.Box3().setFromObject(root); const h = box0.max.y - box0.min.y; root.scale.setScalar(1.5 / h);
      root.updateMatrixWorld(true);
      const color: Record<string, string | number | null> = LOOK ? { Skin: SKIN[LOOK.skin], Eyes: null, Hair: null, Shirt: TOP[LOOK.top], Pants: 0x3a3f55, Socks: 0x2a1e1a } : {};
      let skinM: THREE.SkinnedMesh | null = null;
      root.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
        const old = m.material as THREE.MeshStandardMaterial; const c = color[old.name]; if (old.name === 'Skin' && (m as THREE.SkinnedMesh).isSkinnedMesh) skinM = m as THREE.SkinnedMesh;
        if (c === null) { m.visible = false; return; }   // 눈·머리카락 조각은 우리 파츠로 대신한다
        m.material = new THREE.MeshToonMaterial({ color: c !== undefined ? new THREE.Color(c) : old.color, gradientMap: ramp }); });
      const { b: qb, scale: qs } = setupHumanRig(root, skinM, `Quaternius casual · 키 ${h.toFixed(2)}→1.50m`); rig.q = { root, b: qb, scale: qs };
    }, undefined, e => setStatus('Quaternius 못 읽음: ' + String(e)));
    else if (CHAR === 'mod') {
      // Quaternius Ultimate Modular Men Pack(원본, CC0): 캐릭터 glTF 하나에 <Name>_Head/Body/Legs/Feet 파츠 + 뼈대(62) + 클립 24개.
      // `&outfit=suit|casual2|hoodie|worker|farmer|punk|beach|adventurer|king|swat|spacesuit`, `&top=…&legs=…&feet=…` 로 다른 캐릭터 파츠를 바꿔 끼운다
      const NAMES: Record<string, string> = { suit: 'Suit', casual2: 'Casual_2', hoodie: 'Casual_Hoodie', worker: 'Worker', farmer: 'Farmer', punk: 'Punk', beach: 'Beach', adventurer: 'Adventurer', king: 'King', swat: 'Swat', spacesuit: 'Spacesuit' };
      const qs = new URLSearchParams(location.search);
      const base = NAMES[qs.get('outfit') ?? 'suit'] ?? 'Suit';
      const swaps: [('Body' | 'Legs' | 'Feet'), string][] = [];
      for (const [k, part] of [['top', 'Body'], ['legs', 'Legs'], ['feet', 'Feet']] as const) { const v = qs.get(k); if (v && NAMES[v] && NAMES[v] !== base) swaps.push([part, NAMES[v]]); }
      const url = (n: string) => `/quat/Ultimate%20Modular%20Men-%20Feb%202022/Individual%20Characters/glTF/${n}.gltf`;
      const L = new GLTFLoader();
      const slotOf = (o: THREE.Object3D): 'head' | 'body' | 'legs' | 'feet' | 'other' => { let p: THREE.Object3D | null = o; while (p) { if (/_Head$/.test(p.name)) return 'head'; if (/_Body$/.test(p.name)) return 'body'; if (/_Legs$/.test(p.name)) return 'legs'; if (/_Feet$/.test(p.name)) return 'feet'; p = p.parent; } return 'other'; };
      const KEEP = new Set(['White', 'Tie', 'Black', 'Grey', 'Brown', 'Brown2', 'Red_Dark', 'Gold', 'DarkBrown']);
      const paint = (m: THREE.Mesh, slot: ReturnType<typeof slotOf>) => {
        const old = m.material as THREE.MeshStandardMaterial; const n = old.name;
        if (slot === 'other') { m.visible = false; return; }                       // 권총 같은 소품
        if (slot === 'head' && n !== 'Skin') { m.visible = false; return; }        // 눈·눈썹·머리카락 조각 → 데칼·파츠
        let c: THREE.Color = old.color;
        if (n === 'Skin') c = new THREE.Color(LOOK ? SKIN[LOOK.skin] : '#ffd9b8');
        else if (slot === 'body' && LOOK && !KEEP.has(n)) c = new THREE.Color(TOP[LOOK.top]);
        else if (slot === 'legs' && LOOK && !KEEP.has(n)) c = new THREE.Color(0x3a3f55);
        m.material = new THREE.MeshToonMaterial({ color: c, gradientMap: ramp }); m.material.name = n; m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
      };
      Promise.all([L.loadAsync(url(base)), ...swaps.map(([, n]) => L.loadAsync(url(n)))]).then(([main, ...extras]) => {
        if (disposed) return;
        const root = main.scene;
        let headSkin: THREE.SkinnedMesh | null = null;
        root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && slotOf(m) === 'head' && (m.material as THREE.Material).name === 'Skin') headSkin = m; });
        if (!headSkin) throw new Error('no head skin');
        const hs = headSkin as THREE.SkinnedMesh; const master = hs.skeleton; const byName: Record<string, THREE.Bone> = {}; master.bones.forEach(bn => (byName[bn.name] = bn));
        // 바꿔 끼울 슬롯은 기본 캐릭터의 파츠를 숨기고, 다른 캐릭터의 파츠를 마스터 뼈대에 다시 바인드한다
        const swapped = new Set(swaps.map(([part]) => part.toLowerCase()));
        root.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const slot = slotOf(m); if (swapped.has(slot) || (ICT && slot === 'head')) { m.visible = false; return; } paint(m, slot); });
        extras.forEach((g, i) => {
          const want = swaps[i][0].toLowerCase(); const list: THREE.SkinnedMesh[] = [];
          g.scene.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && slotOf(m) === want) list.push(m); });
          for (const m of list) {
            const bones = m.skeleton.bones.map(bn => byName[bn.name]); if (bones.some(x => !x)) throw new Error('bone mismatch ' + want);
            const sk = new THREE.Skeleton(bones, m.skeleton.boneInverses); paint(m, want as 'body');
            m.position.copy(hs.position); m.quaternion.copy(hs.quaternion); m.scale.copy(hs.scale); hs.parent!.add(m); m.bind(sk, hs.bindMatrix);
          }
        });
        root.updateMatrixWorld(true);
        const box0 = new THREE.Box3().setFromObject(root); const h = box0.max.y - box0.min.y; root.scale.setScalar(1.5 / h); root.updateMatrixWorld(true);
        const { scale } = setupHumanRig(root, hs, `Modular ${base}${swaps.length ? ' + ' + swaps.map(([p, n]) => `${n} ${p}`).join(', ') : ''} · 클립 ${main.animations.length}`);
        if (ICT) {
          // ICT 머리를 머리 뼈에: 바인드 포즈에서 세계축 정렬, Quaternius 머리 상자 높이 × BIG 만큼 크기, 턱이 목 위에 오게
          const headBone = root.getObjectByName('Head'); const who = new URLSearchParams(location.search).get('look') ?? 'neutral';
          if (headBone) {
            for (const o of headBone.children.slice()) if (o.name === 'ict-holder') headBone.remove(o);
            buildIctHead({ who, hair: ICT_HAIR[who] ?? 'hair-short', ramp, expr: true }).then(h => {
              // 머리 상자·목 높이는 매다는 순간(몸이 이미 자리로 이동한 뒤)에 같은 시점으로 잰다
              root.updateMatrixWorld(true); hs.skeleton.update();
              const qb = new THREE.Box3(); const qv = new THREE.Vector3(); const qpos = hs.geometry.attributes.position;
              const neckY = root.getObjectByName('Neck')!.getWorldPosition(new THREE.Vector3()).y;
              for (let i = 0; i < qpos.count; i++) { hs.getVertexPosition(i, qv); hs.localToWorld(qv); if (qv.y > neckY + 0.02) qb.expandByPoint(qv); }
              const qsz = qb.getSize(new THREE.Vector3()); const qc = qb.getCenter(new THREE.Vector3());
              const headH = h.box.max.y - h.chinY;
              const k = (qsz.y * 1.6) / headH;                                     // 뼈 스케일 BIG 대신 머리 자체를 키운다
              for (const b of scale.Head ? [scale.Head] : []) b.set(1, 1, 1);
              // 머리 뼈를 매 프레임 따라가는 객체: world = bone.matrixWorld × offset (뼈 계층에 넣지 않는다)
              const hc = h.box.getCenter(new THREE.Vector3());
              const target = new THREE.Vector3(qc.x, neckY + qsz.y * 0.04, qc.z + qsz.z * 0.05);   // 턱이 옷깃 바로 위에, x·z 는 Quaternius 머리 중심
              const holder = new THREE.Group(); holder.name = 'ict-holder'; holder.matrixAutoUpdate = false;
              h.group.position.set(-hc.x, -h.chinY, -hc.z); holder.add(h.group);
              const desired = new THREE.Matrix4().compose(target, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rig.heading), new THREE.Vector3(k, k, k));
              const offset = headBone.matrixWorld.clone().invert().multiply(desired);
              scene.add(holder); holder.matrix.copy(headBone.matrixWorld).multiply(offset); holder.updateMatrixWorld(true);
              if (rig.kk) (rig.kk.follow ??= []).push({ obj: holder, bone: headBone, offset });
              // 몸 피부색을 머리와 맞춘다
              root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).name === 'skin') (m.material as THREE.MeshToonMaterial).color.set(h.skinHex); });
              setStatus(`Modular ${base} + ICT 머리(${who}) · 축 20·표정 16·색·눈썹·눈·두피 머리카락 · 클립 ${main.animations.length}`);
            }).catch(e => setStatus('ICT 머리 못 읽음: ' + String(e)));
          }
        }
        // 절차 걷기 대신 팩의 클립: Idle / Walk / Interact / Wave
        const mixer = new THREE.AnimationMixer(root); const clips: Record<string, THREE.AnimationAction> = {};
        for (const c of main.animations) clips[c.name] = mixer.clipAction(c);
        clips.Idle?.play();
        rig.q = null; rig.kk = { root, mixer, clips, cur: 'Idle', boneScale: Object.entries(scale).map(([n, v]) => ({ bone: root.getObjectByName(n)!, s: v })).filter(x => x.bone) };
      }).catch(e => setStatus('Modular 못 읽음: ' + String(e)));
    }
    else loader.load('/vrm/seed.vrm', gltf => {
      if (disposed) return;
      const vrm = gltf.userData.vrm as VRM;
      VRMUtils.removeUnnecessaryVertices(gltf.scene); VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
      rig.vrm = vrm; scene.add(vrm.scene);
      const box3 = new THREE.Box3().setFromObject(vrm.scene); const hgt = box3.max.y - box3.min.y;
      setStatus(`${vrm.meta.metaVersion === '1' ? (vrm.meta as { name?: string }).name ?? 'VRM' : 'VRM'} · 키 ${hgt.toFixed(2)}m · 스프링본 ${vrm.springBoneManager?.joints.size ?? 0}`);
    }, undefined, e => setStatus('VRM 못 읽음: ' + String(e)));

    // ── 걷기: 정규화 본을 절차적으로 흔든다. phase 는 이동 거리로만 는다 → 발이 바닥을 잡는다
    const bone = (n: Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]) => rig.vrm?.humanoid.getNormalizedBoneNode(n);
    const pose = (walk: number, t: number) => {
      // walk: 0(서 있기) … 1(걷기) 섞기, t: 시간(s) — 서 있을 때 숨쉬기
      const p = rig.phase * Math.PI * 2;
      const s = Math.sin(p), c = Math.cos(p);
      const set = (n: Parameters<typeof bone>[0], x: number, y = 0, z = 0) => { const b = bone(n); if (b) b.rotation.set(x, y, z); };
      const leg = 0.4 * walk, knee = 0.5 * walk, arm = 0.35 * walk;
      set('leftUpperLeg', -leg * s); set('rightUpperLeg', leg * s);
      set('leftLowerLeg', knee * Math.max(0, c) * 0.9 + 0.05 * walk); set('rightLowerLeg', knee * Math.max(0, -c) * 0.9 + 0.05 * walk);
      set('leftUpperArm', arm * s * 0.8, 0, -1.25 + 0.05 * walk); set('rightUpperArm', -arm * s * 0.8, 0, 1.25 - 0.05 * walk);
      set('leftLowerArm', 0, -0.35 - 0.2 * walk, 0); set('rightLowerArm', 0, 0.35 + 0.2 * walk, 0);
      set('spine', 0.04 * walk + 0.012 * Math.sin(t * 1.6), 0.08 * s * walk, 0);
      set('chest', 0.02 * Math.sin(t * 1.6) * (1 - walk), 0, 0);
      set('neck', -0.03 * walk, 0, 0); set('head', 0.04 * Math.sin(t * 0.7) * (1 - walk), 0.08 * Math.sin(t * 0.45) * (1 - walk), 0);
      const hips = bone('hips'); if (hips) { hips.position.y = hips.position.y; hips.rotation.set(0, 0.06 * s * walk, 0); }
      rig.vrm.scene.position.set(rig.pos.x, 0.028 * Math.abs(c) * walk, rig.pos.z);
      // 눈 깜빡임
      const ex = rig.vrm.expressionManager; if (ex) { const b = (t % 3.7); ex.setValue('blink', b < 0.12 ? Math.sin((b / 0.12) * Math.PI) : 0); }
    };

    // ── Quaternius 뼈대 절차 걷기: 뼈마다 "바인드 회전 × (세계축 회전을 그 뼈의 로컬로 옮긴 것)". 리그의 축 관례를 몰라도 된다
    const _ax = new THREE.Vector3(), _q = new THREE.Quaternion();
    const rotW = (qb: QB | undefined, turns: [THREE.Vector3, number][]) => {
      if (!qb) return; qb.bone.quaternion.copy(qb.rest);
      for (const [axisW, ang] of turns) { _ax.copy(axisW).applyQuaternion(qb.inv).normalize(); _q.setFromAxisAngle(_ax, ang); qb.bone.quaternion.multiply(_q); }
    };
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    const poseQ = (q: QA, walk: number, t: number) => {
      const p = rig.phase * Math.PI * 2, s = Math.sin(p), c = Math.cos(p);
      const leg = 0.45 * walk, knee = 0.6 * walk, arm = 0.35 * walk;
      rotW(q.b.UpperLeg_L, [[X, -leg * s]]); rotW(q.b.UpperLeg_R, [[X, leg * s]]);
      rotW(q.b.LowerLeg_L, [[X, knee * Math.max(0, c) + 0.05 * walk]]); rotW(q.b.LowerLeg_R, [[X, knee * Math.max(0, -c) + 0.05 * walk]]);
      rotW(q.b.UpperArm_L, [[Z, -1.25], [X, arm * s]]); rotW(q.b.UpperArm_R, [[Z, 1.25], [X, -arm * s]]);
      rotW(q.b.LowerArm_L, [[Y, -0.35 - 0.2 * walk]]); rotW(q.b.LowerArm_R, [[Y, 0.35 + 0.2 * walk]]);
      rotW(q.b.Abdomen, [[X, 0.04 * walk + 0.012 * Math.sin(t * 1.6)], [Y, 0.08 * s * walk]]);
      rotW(q.b.Head, [[X, 0.04 * Math.sin(t * 0.7) * (1 - walk)], [Y, 0.08 * Math.sin(t * 0.45) * (1 - walk)]]);
      for (const [n, sc] of Object.entries(q.scale)) q.b[n]?.bone.scale.copy(sc);
      q.root.position.set(rig.pos.x, 0.02 * Math.abs(c) * walk, rig.pos.z); q.root.rotation.y = rig.heading;
      if (rig.pose === 'lie' && !walk) { q.root.rotation.x = -Math.PI / 2; q.root.position.y = 0.55; } else q.root.rotation.x = 0;
    };
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    const go = (x: number, z: number, pose = 'idle') => { rig.target = new THREE.Vector3(Math.max(-1.8, Math.min(1.8, x)), 0, Math.max(-1.6, Math.min(1.8, z))); rig.pose = pose; };
    const onClick = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera); const hit = ray.intersectObject(floor)[0]; if (hit) go(hit.point.x, hit.point.z);
    };
    renderer.domElement.addEventListener('click', onClick);

    api.current = {
      go: (x: number, z: number, pose = 'idle') => go(x, z, pose),
      setOutline: b => outlines.forEach(o => (o.visible = b)),
      setNight: b => { sun.intensity = b ? 0.35 : 3.2; sun.color.set(b ? 0x9fb8ff : 0xfff0d8); hemi.intensity = b ? 0.35 : 1.1; hemi.color.set(b ? 0x2a3a66 : 0xdfeeff); lamp.intensity = b ? 6 : 0; scene.background = new THREE.Color(b ? 0x2a2a44 : 0xf7dfd0); sky.material.color.set(b ? 0x1c2450 : 0x8fd0ff); },
    };
    (window as unknown as { __vrm?: unknown }).__vrm = { go, ready: () => !!rig.vrm || !!rig.kk || !!rig.q, night: (b: boolean) => api.current?.setNight(b) };

    const timer = new THREE.Timer(); let raf = 0;
    const tmp = new THREE.Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      timer.update(); const dt = Math.min(0.05, timer.getDelta()); const t = timer.getElapsed();
      const kk = rig.kk; const qa = rig.q;
      if (rig.vrm || kk || qa) {
        let moving = 0;
        if (rig.target) {
          tmp.subVectors(rig.target, rig.pos); const d = tmp.length();
          if (d < 0.02) { rig.target = null; }
          else {
            const step = Math.min(d, WALK_SPEED * dt); tmp.normalize();
            const want = Math.atan2(tmp.x, tmp.z); let dh = want - rig.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
            rig.heading += Math.sign(dh) * Math.min(Math.abs(dh), 9 * dt);
            rig.pos.addScaledVector(tmp, step); rig.phase = (rig.phase + step / (STRIDE * 2)) % 1; moving = 1;
          }
        }
        rig.walkT += ((moving ? 1 : 0) - rig.walkT) * Math.min(1, dt * 10);
        if (!moving) rig.phase += (0 - rig.phase) * Math.min(1, dt * 6);    // 멈추면 발을 모은다
        if (kk) {
          // 클립 전환: 걷는 중 Walking_A, 멈추면 자리의 자세(Idle / Sit_Chair_Idle / Lie_Idle / Use_Item)
          const has = (n: string) => !!kk.clips[n];
          const want = moving ? (has('Walking_A') ? 'Walking_A' : 'Walk') : rig.pose === 'sit' && has('Sit_Chair_Idle') ? 'Sit_Chair_Idle' : rig.pose === 'lie' && has('Lie_Idle') ? 'Lie_Idle' : rig.pose === 'use' ? (has('Use_Item') ? 'Use_Item' : 'Interact') : 'Idle';
          if (want !== kk.cur && kk.clips[want]) { const from = kk.clips[kk.cur], to = kk.clips[want]; to.reset().play(); if (from) from.crossFadeTo(to, 0.25, false); kk.cur = want; }
          kk.mixer.update(dt);
          for (const b of kk.boneScale) b.bone.scale.copy(b.s);
          if (kk.follow) { kk.root.updateMatrixWorld(true); for (const f of kk.follow) { f.obj.matrix.copy(f.bone.matrixWorld).multiply(f.offset); f.obj.updateMatrixWorld(true); } }
          kk.root.rotation.y = rig.heading;   // KayKit 도 VRM 처럼 +Z 를 본다
          kk.root.position.set(rig.pos.x, rig.pose === 'lie' && !moving ? 0.42 : 0, rig.pos.z);
        } else if (qa) {
          poseQ(qa, rig.walkT, t);
        } else {
          rig.vrm.scene.rotation.y = rig.heading;
          pose(rig.walkT, t);
          rig.vrm.update(dt);
        }
      }
      renderer.render(scene, camera);
    };
    tick();
    return () => { disposed = true; cancelAnimationFrame(raf); renderer.domElement.removeEventListener('click', onClick); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, []);

  useEffect(() => { api.current?.setOutline(outline); }, [outline]);
  useEffect(() => { api.current?.setNight(night); }, [night]);

  return (
    <div className="vlab">
      <style>{CSS}</style>
      <h1>VRM 랩</h1>
      <div className="sub">VRM LAB · 툰 셰이딩 3D 방 + MToon 아바타 · 바닥을 누르면 걸어간다</div>
      <div className="stage" ref={host}><div className="note">{status}</div></div>
      <div className="rows">
        <div className="row"><b>자리</b><div className="chips">{Object.entries(SPOTS).map(([k, [x, z]]) => <button key={k} className="chip" onClick={() => api.current?.go(x, z, SPOT_POSE[k] ?? 'idle')}>{k}</button>)}</div></div>
        <div className="row"><b>보기</b><div className="chips">
          <button className={`chip${outline ? ' on' : ''}`} onClick={() => setOutline(o => !o)}>윤곽선</button>
          <button className={`chip${night ? ' on' : ''}`} onClick={() => setNight(n => !n)}>밤</button>
        </div></div>
      </div>
      <div className="hint">아바타는 VRM 컨소시엄 샘플(Seed-san, public/vrm/seed.vrm). 걷기는 절차적(정규화 본), 걸음 주기는 이동 거리에 묶여 있어 발이 안 미끄러진다. 방은 MeshToon 상자 + 뒤집힌 껍질 윤곽선.</div>
    </div>
  );
}
