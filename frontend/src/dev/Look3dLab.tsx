// ─── 3D 겉모습 랩 (dev page, `?lab=look3d`) — 카탈로그+파라메트릭 스파이크 ─────────────────────────
// ADR-0020의 열세 칸(비전 모델이 사진에서 고른 값)을 SVG 대신 3D 기본 도형으로 조립한다. 아티스트 몸·블렌드셰이프가 생기기 전에
// "사진 → 열세 칸 → 코드가 3D로 그림" 파이프라인이 사람을 구별하는지 본다. 도형은 나중에 메시·블렌드셰이프로 갈아 끼우면 되고 열세 칸은 그대로다.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Look } from '../sim/types';
import { SKIN, HAIR, TOP } from '../character/look';

const CSS = `
.l3{box-sizing:border-box;min-height:100%;background:#1B1715;color:#F4EDE6;padding:18px 14px 40px;font-family:var(--body);display:grid;justify-items:center;gap:12px}
.l3 h1{font-family:var(--display);font-size:22px;margin:0}
.l3 .sub{font-family:var(--mono);font-size:11px;color:#A69C93;letter-spacing:.08em;text-align:center}
.l3 .photos{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;width:var(--w)}
.l3 .photos figure{margin:0;display:grid;justify-items:center;gap:6px}
.l3 .photos img{width:100%;aspect-ratio:1;object-fit:cover;object-position:50% 20%;border-radius:12px;border:2px solid #4A403A}
.l3 .photos figcaption{font-family:var(--display);font-size:13px;color:#EDE4DC}
.l3 .photos small{font-family:var(--mono);font-size:9.5px;color:#8C817A;text-align:center;line-height:1.35}
.l3 .l3stage{width:var(--w);border-radius:18px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.45);background:#2a2422}
.l3 canvas{display:block}
`;

/** 2026-09-14 POST /api/character/look (qwen3.8:27b, tier good) 이 공개 초상(Wikimedia Commons)에서 고른 열세 칸 — 손대지 않은 그대로 */
export const PEOPLE: { id: string; name: string; look: Look }[] = [
  { id: 'trump', name: '트럼프', look: { skin: 'light', hairColor: 'blond', hairStyle: 'wavy', glasses: 'none', beard: 'none', top: 'night', face: 'long', eyes: 'narrow', brows: 'thin', nose: 'big', mouth: 'flat', ears: 'out', build: 'wide' } },
  { id: 'obama', name: '오바마', look: { skin: 'dark', hairColor: 'black', hairStyle: 'short', glasses: 'none', beard: 'none', top: 'night', face: 'long', eyes: 'dot', brows: 'thick', nose: 'small', mouth: 'wide', ears: 'out', build: 'normal' } },
  { id: 'ljm', name: '이재명', look: { skin: 'light', hairColor: 'black', hairStyle: 'side-part', glasses: 'round', beard: 'none', top: 'night', face: 'round', eyes: 'narrow', brows: 'thin', nose: 'big', mouth: 'smile', ears: 'out', build: 'normal' } },
  { id: 'lmb', name: '이명박', look: { skin: 'light', hairColor: 'black', hairStyle: 'side-part', glasses: 'none', beard: 'none', top: 'night', face: 'long', eyes: 'narrow', brows: 'thin', nose: 'small', mouth: 'wide', ears: 'out', build: 'normal' } },
];

const W = 900, H = 520;

function toonRamp() {
  const data = new Uint8Array([80, 80, 80, 255, 160, 160, 160, 255, 235, 235, 235, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

/** 열세 칸 → 도형 묶음. 머리 반지름 1 을 기준으로 잰다 (머리가 키의 절반 — 2D 캐릭터와 같은 비례) */
export type BodyMode = 'prim' | 'mesh' | 'kaykit' | 'parts';
export function buildCharacter(look: Look, ramp: THREE.DataTexture, mode: BodyMode = 'prim'): THREE.Group {
  const g = new THREE.Group();
  const hairG = new THREE.Group(); hairG.name = 'hair'; g.add(hairG);
  let parent: THREE.Object3D = g;
  const NOFACE = mode === 'parts';   // 얼굴은 데칼 텍스처가 그린다 — 머리카락·안경·수염만
  const K = mode === 'kaykit' || mode === 'parts'; // KayKit 몸: 얼굴 텍스처를 뺀 민얼굴 위에 눈·눈썹·입·머리카락·안경·수염을 얹는다 (머리는 상자에 가까워 앞면 z≈1)
  const M = mode === 'mesh' || K;   // 조각된 몸(base.glb) 위에 얹는 것만 만든다: 눈동자·눈썹·입·머리카락·안경·수염
  const OUT = new THREE.MeshBasicMaterial({ color: 0x2a1e1a, side: THREE.BackSide });
  const mat = (hex: string | number) => new THREE.MeshToonMaterial({ color: new THREE.Color(hex), gradientMap: ramp });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, o: { s?: [number, number, number]; r?: [number, number, number]; edge?: number } = {}) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z);
    if (o.s) mesh.scale.set(...o.s); if (o.r) mesh.rotation.set(...o.r);
    mesh.castShadow = true; mesh.receiveShadow = false; parent.add(mesh);   // 얼굴에 머리카락 그림자가 얼룩지지 않게 — 바닥만 그림자를 받는다 (툰 렌더의 관례)
    const e = o.edge ?? 0.05;
    if (e > 0) { const k = new THREE.Mesh(geo, OUT); k.position.copy(mesh.position); k.rotation.copy(mesh.rotation); k.scale.copy(mesh.scale).multiplyScalar(1 + e); parent.add(k); }
    return mesh;
  };
  const skin = mat(SKIN[look.skin]), hair = mat(HAIR[look.hairColor]), top = mat(TOP[look.top]);
  const ink = mat(0x2a1e1a), pants = mat(0x3a3f55);
  const face = look.face ?? 'round', eyes = look.eyes ?? 'dot', brows = look.brows ?? 'none', nose = look.nose ?? 'none', mouth = look.mouth ?? 'smile', ears = look.ears ?? 'hidden', build = look.build ?? 'normal';

  // ── 머리(얼굴형): 위 반쪽은 같은 구, 턱만 다르다 — 머리 모양 15종이 전부 그대로 맞는다 (ADR-0020 §3)
  const headScale: [number, number, number] = face === 'long' ? [0.94, 1.14, 0.96] : face === 'square' ? [1.0, 1.0, 1.0] : face === 'heart' ? [1.02, 1.04, 1.0] : [1, 1, 1];
  if (!M) add(new THREE.SphereGeometry(1, 40, 28), skin, 0, 0, 0, { s: headScale });
  if (!M && face === 'square') add(new THREE.BoxGeometry(1.7, 0.9, 1.5), skin, 0, -0.5, 0, { s: [1, 1, 1] });      // 각진 턱
  if (!M && face === 'heart') add(new THREE.ConeGeometry(0.75, 1.1, 24), skin, 0, -0.78, 0.05, { r: [Math.PI, 0, 0] });   // 뾰족한 턱
  const chinY = face === 'long' ? -1.14 : face === 'square' ? -0.95 : face === 'heart' ? -1.3 : -1.0;

  // ── 눈
  // 조각 머리에서는 눈알이 메시에 있으니 눈동자만 그 앞에 붙인다 (base.json 의 눈 위치를 단위 머리 좌표로 옮긴 값)
  const ey = K ? 0.08 : 0.02, ez = K ? 0.9 : M ? 0.64 : 0.86, ex = K ? 0.3 : M ? 0.3 : 0.36;
  for (const sx of NOFACE ? [] : [-1, 1]) {
    if (eyes === 'dot') add(new THREE.SphereGeometry(K ? 0.09 : M ? 0.12 : 0.075, 16, 12), ink, sx * ex, ey, ez + 0.08, { edge: 0 });
    if (eyes === 'big') { if (!M || K) add(new THREE.SphereGeometry(0.17, 20, 14), mat(0xffffff), sx * ex, ey, ez, { edge: 0.03 }); add(new THREE.SphereGeometry(M ? 0.14 : 0.095, 16, 12), ink, sx * ex, ey - 0.01, ez + 0.11, { edge: 0 }); }
    if (eyes === 'narrow') { if (M && !K) add(new THREE.SphereGeometry(0.1, 14, 10), ink, sx * ex, ey - 0.04, ez + 0.08, { s: [1.2, 0.5, 1], edge: 0 }); else add(new THREE.BoxGeometry(0.26, 0.055, 0.06), ink, sx * ex, ey, ez + 0.1, { edge: 0 }); }
    if (eyes === 'sharp') { if (M && !K) add(new THREE.SphereGeometry(0.08, 14, 10), ink, sx * ex, ey, ez + 0.08, { s: [1.2, 0.7, 1], r: [0, 0, sx * 0.3], edge: 0 }); else add(new THREE.BoxGeometry(0.28, 0.06, 0.06), ink, sx * ex, ey, ez + 0.1, { r: [0, 0, sx * 0.35], edge: 0 }); }
  }
  // ── 눈썹
  for (const sx of NOFACE ? [] : [-1, 1]) {
    const bz = K ? 0.98 : M ? 0.84 : ez + 0.02, by = K ? 0.36 : M ? 0.2 : 0.32;
    if (brows === 'thin') add(new THREE.BoxGeometry(0.34, M ? 0.07 : 0.045, 0.06), M ? ink : hair, sx * ex, by, bz, { edge: 0 });
    if (brows === 'thick') add(new THREE.BoxGeometry(0.38, M ? 0.13 : 0.11, 0.08), M ? ink : hair, sx * ex, by + 0.02, bz, { edge: 0 });
    if (brows === 'angled') add(new THREE.BoxGeometry(0.34, 0.06, 0.06), hair, sx * ex, by, bz, { r: [0, 0, -sx * 0.4], edge: 0 });
  }
  // ── 코
  if (!NOFACE && (!M || K) && nose === 'small') add(new THREE.SphereGeometry(0.1, 16, 12), skin, 0, -0.16, 0.98, { edge: 0.06 });
  if (!NOFACE && (!M || K) && nose === 'big') add(new THREE.SphereGeometry(0.18, 16, 12), skin, 0, -0.2, 1.0, { s: [0.9, 1.15, 1], edge: 0.05 });
  // ── 입
  const my = K ? -0.36 : M ? -0.47 : -0.48, mz = K ? 0.98 : M ? 0.93 : 0.84;
  if (!NOFACE && mouth === 'smile') add(new THREE.TorusGeometry(M ? 0.14 : 0.2, M ? 0.025 : 0.035, 8, 24, Math.PI), ink, 0, my + (M ? 0.03 : 0.05), mz, { r: [0, 0, Math.PI], edge: 0 });
  if (!NOFACE && mouth === 'wide') { add(new THREE.TorusGeometry(M ? 0.22 : 0.32, M ? 0.03 : 0.04, 8, 28, Math.PI), ink, 0, my + (M ? 0.05 : 0.08), mz, { r: [0, 0, Math.PI], edge: 0 }); add(new THREE.BoxGeometry(M ? 0.34 : 0.5, M ? 0.07 : 0.09, 0.05), mat(0xffffff), 0, my + (M ? 0.02 : 0.03), mz + (M ? 0.02 : 0.06), { edge: 0 }); }
  if (!NOFACE && mouth === 'flat') add(new THREE.BoxGeometry(M ? 0.24 : 0.34, M ? 0.035 : 0.05, 0.06), ink, 0, my, mz + (M ? 0 : 0.05), { edge: 0 });
  // ── 귀
  if (!M && ears === 'out') for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.17, 16, 12), skin, sx * 0.98 * headScale[0], -0.02, 0, { s: [0.6, 1, 0.8] });

  // ── 머리카락 (15): 두피 캡 + 스타일별 덩어리. 캡은 얼굴형과 무관하게 같은 구 위에 얹는다
  parent = hairG;
  const cap = (theta: number, s = K ? 1.08 : M ? 1.0 : 1.04) => add(new THREE.SphereGeometry(1, 40, 28, 0, Math.PI * 2, 0, theta * Math.PI), hair, 0, 0, 0, { s: [s * headScale[0], s * headScale[1], s * headScale[2]] });
  const bangs = (h = 0.34) => add(new THREE.BoxGeometry(1.5, h, 0.42), hair, 0, 0.62, 0.72, { r: [0.25, 0, 0] });
  const hs = look.hairStyle;
  if (hs === 'bowl') { cap(0.52); bangs(0.42); }
  if (hs === 'short') cap(0.44);
  if (hs === 'buzz') cap(0.42, 1.015);
  if (hs === 'bob') { cap(0.66, 1.06); bangs(0.36); }
  if (hs === 'long') { cap(0.5, 1.05); for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.34, 1.5, 6, 14), hair, sx * 0.86, -0.75, -0.25); add(new THREE.BoxGeometry(1.7, 1.9, 0.5), hair, 0, -0.55, -0.75); }
  if (hs === 'curly') { cap(0.5, 1.1); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(new THREE.SphereGeometry(0.33, 14, 10), hair, Math.cos(a) * 0.95, 0.45 + Math.sin(i * 2.1) * 0.25, Math.sin(a) * 0.95); } }
  if (hs === 'side-part') { cap(0.45); add(new THREE.SphereGeometry(1, 24, 16), hair, 0.12, 0.7, 0.5, { s: [0.85, 0.32, 0.62], r: [0.35, 0, -0.2] }); }
  if (hs === 'bangs') { cap(0.5); bangs(0.4); }
  if (hs === 'ponytail') { cap(0.47); add(new THREE.CapsuleGeometry(0.22, 1.1, 6, 14), hair, 0, -0.35, -1.0, { r: [0.35, 0, 0] }); add(new THREE.SphereGeometry(0.3, 14, 10), hair, 0, 0.3, -0.95); }
  if (hs === 'bun') { cap(0.47); add(new THREE.SphereGeometry(0.4, 18, 12), hair, 0, 1.0, -0.45); }
  if (hs === 'afro') add(new THREE.SphereGeometry(1.5, 40, 28), hair, 0, 0.3, -0.08, { s: [1, 0.95, 1] });
  if (hs === 'spiky') { cap(0.45); for (let i = -2; i <= 2; i++) add(new THREE.ConeGeometry(0.22, 0.75, 10), hair, i * 0.36, 1.15, -0.1 + Math.abs(i) * 0.05, { r: [0, 0, -i * 0.28] }); }
  if (hs === 'pigtails') { cap(0.47); for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.22, 0.9, 6, 14), hair, sx * 1.12, -0.35, -0.15, { r: [0, 0, sx * 0.25] }); }
  if (hs === 'wavy') { cap(0.5, 1.12); add(new THREE.SphereGeometry(1, 24, 16), hair, 0.05, 0.72, 0.5, { s: [0.95, 0.42, 0.75], r: [0.35, 0, -0.12] }); for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.36, 14, 10), hair, sx * 0.98, 0.15, -0.1, { s: [0.7, 1.1, 1] }); }

  parent = g;
  // ── 안경
  if (look.glasses !== 'none') {
    const frame = mat(0x2a1e1a);
    for (const sx of [-1, 1]) add(look.glasses === 'round' ? new THREE.TorusGeometry(0.27, 0.035, 8, 28) : new THREE.TorusGeometry(0.27, 0.035, 8, 4), frame, sx * ex, ey, ez + 0.14, { r: [0, 0, look.glasses === 'square' ? Math.PI / 4 : 0], edge: 0 });
    add(new THREE.BoxGeometry(0.2, 0.035, 0.035), frame, 0, ey + 0.02, ez + 0.14, { edge: 0 });
  }
  // ── 수염
  if (!NOFACE && look.beard === 'mustache') add(new THREE.BoxGeometry(0.55, 0.1, 0.12), hair, 0, -0.32, 0.92, { edge: 0 });
  if (!M && look.beard === 'stubble') add(new THREE.SphereGeometry(1, 40, 28, 0, Math.PI * 2, 0.62 * Math.PI, 0.38 * Math.PI), mat(new THREE.Color(SKIN[look.skin]).multiplyScalar(0.8)), 0, 0, 0, { s: [1.005 * headScale[0], 1.005 * headScale[1], 1.005 * headScale[2]], edge: 0 });
  if (!NOFACE && look.beard === 'full') add(new THREE.SphereGeometry(1, 40, 28, 0, Math.PI * 2, 0.58 * Math.PI, 0.42 * Math.PI), hair, 0, 0, 0, { s: [1.06 * headScale[0], 1.06 * headScale[1], 1.06 * headScale[2]] });

  // ── 몸(체형): 몸통 반폭만 바뀐다 — 포즈·탈것 공통 (ADR-0020 §3)
  const bw = build === 'slim' ? 0.82 : build === 'wide' ? 1.28 : 1.0;
  const neckY = chinY - 0.05;
  if (M) { g.userData.footY = 0; return g; }
  add(new THREE.CylinderGeometry(0.28, 0.32, 0.4, 16), skin, 0, neckY - 0.1, 0);
  add(new THREE.CapsuleGeometry(0.72, 0.8, 8, 20), top, 0, neckY - 1.05, 0, { s: [bw, 1, 0.8 * bw] });
  for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.2, 0.95, 6, 14), top, sx * (0.78 * bw + 0.18), neckY - 1.05, 0, { r: [0, 0, sx * 0.12] });
  for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.2, 14, 10), skin, sx * (0.78 * bw + 0.26), neckY - 1.72, 0);
  for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.26, 0.75, 6, 14), pants, sx * 0.36 * bw, neckY - 2.25, 0);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.22, 0.75), ink, sx * 0.36 * bw, neckY - 2.85, 0.12);
  g.userData.footY = neckY - 2.96;
  return g;
}

export function Look3dLab() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf7dfd0);
    const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100); camera.position.set(0, 3.6, 17.5); camera.lookAt(0, 2.35, 0);
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.0); sun.position.set(-5, 12, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -12; sun.shadow.camera.right = sun.shadow.camera.top = 12; sun.shadow.camera.far = 40; sun.shadow.normalBias = 0.06; sun.shadow.bias = -0.0008;
    scene.add(sun, new THREE.HemisphereLight(0xdfeeff, 0xa07850, 1.1));
    const ramp = toonRamp();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshToonMaterial({ color: 0xd9a877, gradientMap: ramp })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const MODE: BodyMode = new URLSearchParams(location.search).get('base') === 'prim' ? 'prim' : 'mesh';
    const chars: THREE.Group[] = [];
    if (MODE === 'prim') {
      PEOPLE.forEach((p, i) => { const c = buildCharacter(p.look, ramp, 'prim'); c.position.set((i - (PEOPLE.length - 1) / 2) * 3.6, -c.userData.footY, 0); scene.add(c); chars.push(c); });
    } else {
      // 조각된 기본 몸(CC0 Human Base Meshes → scripts/make-base.py 로 치비화 + 셰이프 키) 한 벌을 사람마다 복제하고, 열세 칸을 셰이프 키 값·재질 색·얹는 파츠로 꽂는다
      camera.position.set(0, 1.45, 5.9); camera.lookAt(0, 0.95, 0);
      sun.shadow.camera.left = sun.shadow.camera.bottom = -4; sun.shadow.camera.right = sun.shadow.camera.top = 4;
      Promise.all([new GLTFLoader().loadAsync('/dev-look3d/base.glb'), fetch('/dev-look3d/base.json').then(r => r.json())]).then(([gltf, meta]) => {
        // glTF 는 재질마다 프리미티브(Mesh)를 나눈다 — 전부 복제해서 재질 이름으로 색을 꽂는다
        const prims: THREE.Mesh[] = []; gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) prims.push(o as THREE.Mesh); });
        if (!prims.length) throw new Error('base.glb has no mesh');
        const hc = meta.headCenter as [number, number, number]; const rx = 0.25, ry = (meta.top - meta.neck) / 2, rz = 0.25;
        PEOPLE.forEach((p, i) => {
          const c = new THREE.Group();
          const color: Record<string, string | number> = { skin: SKIN[p.look.skin], eye: 0xffffff, top: TOP[p.look.top], pants: 0x3a3f55, shoes: 0x2a1e1a };
          for (const src of prims) {
            const body = src.clone(); body.castShadow = true; body.receiveShadow = false;
            const name = (src.material as THREE.Material).name;
            body.material = new THREE.MeshToonMaterial({ color: new THREE.Color(color[name] ?? 0xff00ff), gradientMap: ramp });
            const dict = body.morphTargetDictionary ?? {}; const inf = body.morphTargetInfluences ?? [];
            const set = (k: string, v: number) => { if (k in dict) inf[dict[k]] = v; };
            set('face_long', p.look.face === 'long' ? 1 : 0); set('face_square', p.look.face === 'square' ? 1 : 0); set('face_heart', p.look.face === 'heart' ? 1 : 0);
            set('build_slim', p.look.build === 'slim' ? 1 : 0); set('build_wide', p.look.build === 'wide' ? 1 : 0); set('nose_big', p.look.nose === 'big' ? 1 : 0);
            set('mouth_smile', p.look.mouth === 'smile' ? 1 : 0); set('mouth_wide', p.look.mouth === 'wide' ? 1 : 0); set('eyes_narrow', p.look.eyes === 'narrow' ? 1 : 0);
            c.add(body);
            if (name !== 'eye') { const hull = new THREE.Mesh(body.geometry, new THREE.MeshBasicMaterial({ color: 0x2a1e1a, side: THREE.BackSide })); hull.morphTargetInfluences = inf; hull.morphTargetDictionary = dict; hull.scale.setScalar(1.008); c.add(hull); }
          }
          const f = buildCharacter(p.look, ramp, 'mesh');
          f.position.set(hc[0], hc[1], hc[2]); f.scale.set(rx * (p.look.face === 'long' ? 0.94 : 1), ry * (p.look.face === 'long' ? 1.15 : 1), rz);
          const hg = f.getObjectByName('hair'); if (hg) { hg.scale.set(0.94, 1.02, 1.12); hg.position.set(0, 0.04, -0.06); }   // 두개골은 머리 상자보다 좁고 뒤로 치우쳐 있다
          c.add(f);
          c.position.set((i - (PEOPLE.length - 1) / 2) * 1.35, 0, 0); c.userData.footY = 0; scene.add(c); chars.push(c);
        });
      }).catch(e => console.error(e));
    }
    let raf = 0; const t0 = performance.now();
    const tick = () => { raf = requestAnimationFrame(tick); const t = (performance.now() - t0) / 1000; chars.forEach((c, i) => { c.rotation.y = Math.sin(t * 0.5 + i) * 0.06; c.position.y = -c.userData.footY + Math.sin(t * 1.4 + i) * 0.02; }); renderer.render(scene, camera); };
    tick();
    (window as unknown as { __look3d?: unknown }).__look3d = { ready: () => true };
    return () => { cancelAnimationFrame(raf); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, []);
  const picks = (l: Look) => [l.face, l.eyes, l.brows, l.nose, l.mouth, l.ears, l.build].join(' · ');
  return (
    <div className="l3" style={{ ['--w' as string]: `${W}px` }}>
      <style>{CSS}</style>
      <h1>3D 겉모습 랩</h1>
      <div className="sub">LOOK 3D · 사진 → 비전 모델이 열세 칸 → 코드가 조립 · 기본 몸은 CC0 Human Base Meshes를 Blender 스크립트로 치비화 + 셰이프 키 9개 (&base=prim 이면 도형 조립)</div>
      <div className="photos">
        {PEOPLE.map(p => (
          <figure key={p.id}>
            <img src={`/dev-look3d/${p.id}.jpg`} alt="" />
            <figcaption>{p.name}</figcaption>
            <small>{p.look.skin} · {p.look.hairColor} · {p.look.hairStyle} · {p.look.glasses} · {p.look.beard}<br />{picks(p.look)}</small>
          </figure>
        ))}
      </div>
      <div className="l3stage" ref={host} />
    </div>
  );
}
