// ─── ICT FaceKit 머리 조립 모듈: 얼굴 랩과 방 랩이 같이 쓴다 ────────────────────────────────────────
// head.glb(재질 skin·sclera·iris·lips·cornea, 셰이프 키 36) + weights.json(사진 피팅: 축·표정·색·눈썹) + hair-<style>.glb(두피 껍질, 같은 셰이프 키)
// → 색 꽂기, 홍채 정점 색, 눈썹 데칼, 머리카락 동기화까지 끝난 THREE.Group (ICT 단위 cm, 앞 +Z). 몸에 얹을 때는 호출자가 스케일·위치를 맞춘다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { Brows } from '../character/shapes';
import { SKIN, HAIR } from '../character/look';
import type { Look } from '../sim/types';

export const IRIS: Record<string, string> = { 'dark-brown': '#3B2A20', brown: '#6B4A2B', hazel: '#8A6A3A', blue: '#5B8FC7', green: '#5E8A5A', gray: '#8E9AA0' };
export const LIPS: Record<string, string> = { rose: '#D98C86', coral: '#E07A6B', plum: '#B25F72', nude: '#C99A8A', brown: '#8E5A48' };
export type IctColor = { skin: string; iris: string; lips: string; hairColor: string; browColor: string; brow: { kind: string; thick: number; angle: number } };
export type IctWeights = Record<string, { identity: Record<string, number>; expression: Record<string, number>; residual: number; yaw: number; color?: IctColor }>;
export type IctHead = { group: THREE.Group; skin: THREE.Mesh; meshes: THREE.Mesh[]; box: THREE.Box3; chinY: number; skinHex: string };

const cache = new Map<string, Promise<unknown>>();
const loadGltf = (url: string) => (cache.get(url) ?? (cache.set(url, new GLTFLoader().loadAsync(url)), cache.get(url)!)) as Promise<{ scene: THREE.Group }>;
export const loadWeights = () => (cache.get('/dev-look3d/ict/weights.json') ?? (cache.set('/dev-look3d/ict/weights.json', fetch('/dev-look3d/ict/weights.json').then(r => r.json())), cache.get('/dev-look3d/ict/weights.json')!)) as Promise<IctWeights>;
const loadLandmarks = () => (cache.get('lm') ?? (cache.set('lm', fetch('/dev-look3d/ict/landmarks.json').then(r => r.json())), cache.get('lm')!)) as Promise<Record<string, number[][]>>;

export function toonRamp(): THREE.DataTexture {
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 240, 240, 240, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

/** 홍채 정점 색: 반지름별 동공(검정)·홍채(색)·테두리(어둡게)·좌상단 하이라이트 */
export function paintIris(m: THREE.Mesh, hex: string) {
  const g = m.geometry; const pos = g.attributes.position; const n = pos.count; const v = new THREE.Vector3();
  const c = new THREE.Vector3(); for (let i = 0; i < n; i++) c.add(v.fromBufferAttribute(pos, i)); c.multiplyScalar(1 / n);
  const cs: [THREE.Vector3, number][] = [[new THREE.Vector3(), 0], [new THREE.Vector3(), 0]];
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); const k = v.x < c.x ? 0 : 1; cs[k][0].add(v); cs[k][1]++; }
  for (const e of cs) if (e[1]) e[0].multiplyScalar(1 / e[1]);
  const base = new THREE.Color(hex), rim = base.clone().multiplyScalar(0.55), pupil = new THREE.Color('#141010'), white = new THREE.Color('#ffffff');
  const rmax = [0, 0]; for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); const k = v.x < c.x ? 0 : 1; rmax[k] = Math.max(rmax[k], Math.hypot(v.x - cs[k][0].x, v.y - cs[k][0].y)); }
  const colors = new Float32Array(n * 3); const out = new THREE.Color();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i); const k = v.x < c.x ? 0 : 1; const dx = (v.x - cs[k][0].x) / (rmax[k] || 1), dy = (v.y - cs[k][0].y) / (rmax[k] || 1); const r = Math.hypot(dx, dy);
    out.copy(r < 0.38 ? pupil : r > 0.82 ? rim : base); if (Math.hypot(dx + 0.33, dy - 0.33) < 0.2) out.copy(white);
    colors[i * 3] = out.r; colors[i * 3 + 1] = out.g; colors[i * 3 + 2] = out.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = m.material as THREE.MeshToonMaterial; mat.vertexColors = true; mat.color.set('#ffffff'); mat.needsUpdate = true;
}

function browTexture(kind: Look['brows'], color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 768; cv.height = 256; const g = cv.getContext('2d')!;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const svg = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" viewBox="-45 -21 90 30" width={768} height={256}><Brows kind={kind ?? 'thin'} dx={0} /></svg>).replaceAll('#2A1E1A', color).replaceAll('#2a1e1a', color);
  const img = new Image(); img.onload = () => { g.drawImage(img, 0, 0, 768, 256); t.needsUpdate = true; }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return t;
}

export interface BuildOpts { variant?: 'head' | 'head-chibi'; who: string; expr?: boolean; hair?: string; ramp: THREE.DataTexture; overrides?: Record<string, number>; outline?: boolean }

/** 사람 하나의 머리를 조립한다. who 가 weights 에 없으면 기본형 */
export async function buildIctHead(o: BuildOpts): Promise<IctHead> {
  const variant = o.variant ?? 'head';
  const [g, weights, lmAll] = await Promise.all([loadGltf(`/dev-look3d/ict/${variant}.glb`), loadWeights(), loadLandmarks()]);
  const w = weights[o.who]; const col = w?.color; const group = new THREE.Group();
  const meshes: THREE.Mesh[] = []; g.scene.traverse(x => { if ((x as THREE.Mesh).isMesh) meshes.push(x as THREE.Mesh); });
  const clones = meshes.map(src => { const m = new THREE.Mesh(src.geometry.clone(), new THREE.MeshToonMaterial({ gradientMap: o.ramp })); m.material.name = (src.material as THREE.Material).name; m.morphTargetDictionary = { ...(src.morphTargetDictionary ?? {}) }; m.morphTargetInfluences = new Array(src.morphTargetInfluences?.length ?? 0).fill(0); return m; });
  const skin = clones.find(m => m.material.name === 'skin') ?? clones[0];
  // 축·표정
  for (const m of clones) {
    const dict = m.morphTargetDictionary!, inf = m.morphTargetInfluences!;
    if (w) { for (const [k, v] of Object.entries(w.identity)) if (k in dict) inf[dict[k]] = v; if (o.expr !== false) for (const [k, v] of Object.entries(w.expression)) if (k in dict) inf[dict[k]] = k.startsWith('eyeBlink') ? Math.min(v, 0.15) : v; }
    for (const [k, v] of Object.entries(o.overrides ?? {})) if (k in dict) inf[dict[k]] = v;
  }
  // 색
  const skinHex = col ? SKIN[col.skin as Look['skin']] : '#FFD9B8';
  for (const m of clones) {
    const n = m.material.name; const mat = m.material as THREE.MeshToonMaterial;
    mat.color.set(n === 'sclera' ? '#FFFFFF' : n === 'lips' ? (col ? LIPS[col.lips] : '#D98C86') : skinHex);
    if (n === 'lips') mat.color.lerp(new THREE.Color(skinHex), 0.35);
    if (n === 'cornea') m.visible = false;
    if (n === 'iris') paintIris(m, col ? IRIS[col.iris] : '#3B2A20');
    group.add(m);
  }
  if (o.outline !== false) { const hull = new THREE.Mesh(skin.geometry, new THREE.MeshBasicMaterial({ color: 0x2a1e1a, side: THREE.BackSide })); hull.scale.setScalar(1.012); hull.morphTargetInfluences = skin.morphTargetInfluences; hull.morphTargetDictionary = skin.morphTargetDictionary; group.add(hull); }
  // 모프 뒤 스냅샷 (눈썹 데칼·상자)
  const pos = skin.geometry.attributes.position; const snap = new Float32Array(pos.count * 3); const v = new THREE.Vector3(); const box = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) { skin.getVertexPosition(i, v); snap[i * 3] = v.x; snap[i * 3 + 1] = v.y; snap[i * 3 + 2] = v.z; box.expandByPoint(v); }
  const lmPts = (lmAll[variant] ?? []).map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const lmIdx = lmPts.map(p => { let bi = 0, bd = Infinity; const q = new THREE.Vector3(); for (let i = 0; i < pos.count; i++) { q.fromBufferAttribute(pos, i); const d = q.distanceToSquared(p); if (d < bd) { bd = d; bi = i; } } return bi; });
  const at = (k: number) => { const i = lmIdx[k] ?? 0; return new THREE.Vector3(snap[i * 3], snap[i * 3 + 1], snap[i * 3 + 2]); };
  const chinY = lmIdx.length >= 68 ? at(8).y : box.min.y;
  if (lmIdx.length >= 68) {
    const bl = at(17), br = at(26); const ctr = new THREE.Vector3(); for (let k = 17; k <= 26; k++) ctr.add(at(k)); ctr.multiplyScalar(0.1);
    const width = bl.distanceTo(br) * 1.25; const snapGeo = new THREE.BufferGeometry(); snapGeo.setAttribute('position', new THREE.BufferAttribute(snap, 3)); if (skin.geometry.index) snapGeo.setIndex(skin.geometry.index); snapGeo.computeVertexNormals();
    const tmp = new THREE.Mesh(snapGeo); tmp.matrixAutoUpdate = false; tmp.matrixWorld.identity();
    const geo = new DecalGeometry(tmp, new THREE.Vector3(ctr.x, ctr.y + width * 0.02, ctr.z + width * 0.02), new THREE.Euler(0, 0, 0), new THREE.Vector3(width, width / 3.6, width * 0.5));
    const brow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: browTexture((col?.brow.kind ?? 'thin') as Look['brows'], col ? HAIR[col.browColor as Look['hairColor']] : '#2A1E1A'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    group.add(brow);
  }
  // 머리카락(두피 껍질): 같은 셰이프 키 이름으로 값 복사
  const hairStyle = o.hair && o.hair !== 'none' ? o.hair : '';
  if (hairStyle.startsWith('hair-')) {
    const hg = await loadGltf(`/dev-look3d/hair/${hairStyle}.glb`); let src: THREE.Mesh | null = null; hg.scene.traverse(x => { if ((x as THREE.Mesh).isMesh) src = x as THREE.Mesh; });
    if (src) {
      const s = src as THREE.Mesh; const h = new THREE.Mesh(s.geometry.clone(), new THREE.MeshToonMaterial({ color: new THREE.Color(col ? HAIR[col.hairColor as Look['hairColor']] : '#3A2A22'), gradientMap: o.ramp }));
      h.morphTargetDictionary = { ...(s.morphTargetDictionary ?? {}) }; h.morphTargetInfluences = new Array(s.morphTargetInfluences?.length ?? 0).fill(0);
      const sd = skin.morphTargetDictionary!, si = skin.morphTargetInfluences!; for (const [k, i] of Object.entries(h.morphTargetDictionary)) h.morphTargetInfluences[i] = k in sd ? si[sd[k]] : 0;
      if (o.outline !== false) { const hull = new THREE.Mesh(h.geometry, new THREE.MeshBasicMaterial({ color: 0x2a1e1a, side: THREE.BackSide })); hull.scale.setScalar(1.012); hull.morphTargetInfluences = h.morphTargetInfluences; hull.morphTargetDictionary = h.morphTargetDictionary; h.add(hull); }
      group.add(h);
    }
  }
  return { group, skin, meshes: clones, box, chinY, skinHex };
}
