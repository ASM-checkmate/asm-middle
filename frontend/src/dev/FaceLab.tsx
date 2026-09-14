// ─── 얼굴 랩 (dev page, `?lab=face`) — ICT FaceKit(MIT) 머리 + 셰이프 키 + 색 + 눈썹 데칼 + 머리카락 래핑 ─────────────
// 한 기본형 위의 생김새 축(identity000~019)과 ARKit 표정 16개. 사진에서 피팅한 축 값·표정·색·눈썹(weights.json)을 프리셋으로 꽂는다.
// 재질 슬롯(skin·sclera·iris·lips)에 팔레트 색, 눈썹은 2D SVG를 눈썹 랜드마크 자리에 데칼로, 머리카락은 파츠를 두피 정점에 래핑.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { Brows } from '../character/shapes';
import { SKIN, HAIR } from '../character/look';
import type { Look } from '../sim/types';

const CSS = `
.flab{box-sizing:border-box;min-height:100%;background:#1B1715;color:#F4EDE6;padding:18px 14px 40px;font-family:var(--body);display:grid;justify-items:center;gap:12px}
.flab h1{font-family:var(--display);font-size:22px;margin:0}
.flab .sub{font-family:var(--mono);font-size:11px;color:#A69C93;letter-spacing:.08em;text-align:center}
.flab .fstage{width:362px;height:420px;border-radius:18px;overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.45);background:#f7dfd0;position:relative;cursor:grab}
.flab canvas{display:block}
.flab .rows{width:362px;display:grid;gap:8px}
.flab .row{display:grid;grid-template-columns:56px 1fr;align-items:center;gap:8px}
.flab .row b{font-family:var(--display);font-weight:400;font-size:13px;color:#CFC4BA}
.flab .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.flab .chip{min-height:32px;padding:0 12px;border-radius:999px;border:1px solid #4A403A;background:#2A2422;color:#EDE4DC;font-size:13px;font-family:var(--display)}
.flab .chip.on{background:#F2B233;color:#1B1715;border-color:#F2B233}
.flab .sl{display:grid;grid-template-columns:110px 1fr 36px;gap:8px;align-items:center;font-family:var(--mono);font-size:11px;color:#CFC4BA}
.flab input[type=range]{width:100%}
.flab .note{position:absolute;left:10px;top:10px;font-family:var(--mono);font-size:11px;color:#1B1715;background:rgba(255,255,255,.6);padding:4px 8px;border-radius:8px}
`;
const IRIS: Record<string, string> = { 'dark-brown': '#3B2A20', brown: '#6B4A2B', hazel: '#8A6A3A', blue: '#5B8FC7', green: '#5E8A5A', gray: '#8E9AA0' };
const LIPS: Record<string, string> = { rose: '#D98C86', coral: '#E07A6B', plum: '#B25F72', nude: '#C99A8A', brown: '#8E5A48' };
type Color = { skin: string; iris: string; lips: string; hairColor: string; browColor: string; brow: { kind: string; thick: number; angle: number } };
type Weights = Record<string, { identity: Record<string, number>; expression: Record<string, number>; residual: number; yaw: number; color?: Color }>;
const PEOPLE: Record<string, { name: string; hair: string; hairScale?: number }> = { trump: { name: '트럼프', hair: 'hair-bangs' }, obama: { name: '오바마', hair: 'hair-buzz' }, ljm: { name: '이재명', hair: 'hair-sidepart' }, lmb: { name: '이명박', hair: 'hair-sidepart' } };
const HAIRS = ['none', 'hair-buzz', 'hair-short', 'hair-bowl', 'hair-bangs', 'hair-sidepart', 'buzzed', 'simpleparted', 'long', 'buns', 'q-suit', 'q-casual_2'];
const SLIDERS = ['identity000', 'identity001', 'identity002', 'identity003', 'mouthSmile_L', 'mouthSmile_R', 'jawOpen', 'eyeBlink_L', 'eyeBlink_R', 'browInnerUp_L', 'browDown_L'];

/** 2D 눈썹 SVG → 텍스처 (두 눈썹이 한 장, 가로 90 × 세로 30 단위) */
function browTexture(kind: Look['brows'], color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 768; cv.height = 256; const g = cv.getContext('2d')!;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const svg = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" viewBox="-45 -21 90 30" width={768} height={256}><g style={{ color }}><Brows kind={kind ?? 'thin'} dx={0} /></g></svg>).replaceAll('#2A1E1A', color).replaceAll('#2a1e1a', color);
  const img = new Image(); img.onload = () => { g.drawImage(img, 0, 0, 768, 256); t.needsUpdate = true; }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return t;
}

/** 홍채 정점 색: 홍채 중심을 향한 축을 기준으로 반지름별 동공(검정)·홍채(색)·테두리(어둡게)·좌상단 하이라이트(흰색) */
function paintIris(m: THREE.Mesh, hex: string) {
  const g = m.geometry; const pos = g.attributes.position; const n = pos.count;
  const c = new THREE.Vector3(); for (let i = 0; i < n; i++) c.add(new THREE.Vector3().fromBufferAttribute(pos, i)); c.multiplyScalar(1 / n);
  // 홍채는 왼·오 두 덩어리가 한 프리미티브에 있을 수 있어 x 부호로 나눠 중심을 따로 잡는다
  const cs: [THREE.Vector3, number][] = [[new THREE.Vector3(), 0], [new THREE.Vector3(), 0]]; const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); const k = v.x < c.x ? 0 : 1; cs[k][0].add(v); cs[k][1]++; }
  for (const e of cs) if (e[1]) e[0].multiplyScalar(1 / e[1]);
  const base = new THREE.Color(hex), rim = base.clone().multiplyScalar(0.55), pupil = new THREE.Color('#141010'), white = new THREE.Color('#ffffff');
  let rmax = [0, 0]; for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); const k = v.x < c.x ? 0 : 1; rmax[k] = Math.max(rmax[k], Math.hypot(v.x - cs[k][0].x, v.y - cs[k][0].y)); }
  const colors = new Float32Array(n * 3); const out = new THREE.Color();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i); const k = v.x < c.x ? 0 : 1; const dx = (v.x - cs[k][0].x) / (rmax[k] || 1), dy = (v.y - cs[k][0].y) / (rmax[k] || 1); const r = Math.hypot(dx, dy);
    out.copy(r < 0.38 ? pupil : r > 0.82 ? rim : base);
    if (Math.hypot(dx + 0.33, dy - 0.33) < 0.2) out.copy(white);   // 하이라이트
    colors[i * 3] = out.r; colors[i * 3 + 1] = out.g; colors[i * 3 + 2] = out.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = m.material as THREE.MeshToonMaterial; mat.vertexColors = true; mat.color.set('#ffffff'); mat.needsUpdate = true;
}

export function FaceLab() {
  const host = useRef<HTMLDivElement>(null);
  const Q = new URLSearchParams(location.search);   // 스크린샷용 초기값: &who=lmb&variant=head-chibi&hair=auto
  const [variant, setVariant] = useState<'head' | 'head-chibi'>((Q.get('variant') as 'head' | 'head-chibi') || 'head');
  const [who, setWho] = useState<string>(Q.get('who') || 'neutral');
  const [expr, setExpr] = useState(Q.get('expr') !== '0');
  const [hair, setHair] = useState<string>(Q.get('hair') || 'auto');
  const [vals, setVals] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('여는 중…');
  const R = useRef<{ meshes: THREE.Mesh[]; skin: THREE.Mesh | null; lm: THREE.Vector3[]; weights: Weights | null; group: THREE.Group | null; ramp: THREE.DataTexture | null; hairMesh: THREE.Mesh | null; hairWrap: { idx: Int32Array; off: Float32Array } | null; brow: THREE.Mesh | null; apply: () => void; load: (v: string) => void }>({ meshes: [], skin: null, lm: [], weights: null, group: null, ramp: null, hairMesh: null, hairWrap: null, brow: null, apply: () => {}, load: () => {} });

  useEffect(() => {
    const el = host.current; if (!el) return;
    const W = 362, H = 420;
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.SRGBColorSpace; el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf7dfd0);
    const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(-2, 3, 4); scene.add(sun, new THREE.HemisphereLight(0xdfeeff, 0xa07850, 1.2));
    const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 240, 240, 240, 255, 255, 255, 255, 255]); const ramp = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat); ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
    const group = new THREE.Group(); scene.add(group); R.current.group = group; R.current.ramp = ramp;
    let disposed = false; let rotY = 0, dragging = false, lastX = 0;
    const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; }; const onMove = (e: PointerEvent) => { if (dragging) { rotY += (e.clientX - lastX) * 0.01; lastX = e.clientX; } }; const onUp = () => (dragging = false);
    renderer.domElement.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    const lmAll: Record<string, number[][]> = {};
    const load = (v: string) => Promise.all([new GLTFLoader().loadAsync(`/dev-look3d/ict/${v}.glb`), Object.keys(lmAll).length ? Promise.resolve(lmAll) : fetch('/dev-look3d/ict/landmarks.json').then(r => r.json())]).then(([g, lmj]) => {
      if (disposed) return; Object.assign(lmAll, lmj);
      group.clear(); const meshes: THREE.Mesh[] = []; g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      if (!meshes.length) throw new Error('no mesh');
      for (const m of meshes) { const nm = (m.material as THREE.Material).name; m.material = new THREE.MeshToonMaterial({ color: new THREE.Color('#FFD9B8'), gradientMap: ramp }); m.material.name = nm; group.add(m); }   // 재질 이름은 색 슬롯 식별자라 보존
      const skin = meshes.find(m => (m.material as THREE.Material).name === 'skin' || m.name.includes('skin')) ?? meshes[0];
      // 윤곽선: 피부 메시만
      const hull = new THREE.Mesh(skin.geometry, new THREE.MeshBasicMaterial({ color: 0x2a1e1a, side: THREE.BackSide })); hull.scale.setScalar(1.012); hull.morphTargetInfluences = skin.morphTargetInfluences; hull.morphTargetDictionary = skin.morphTargetDictionary; group.add(hull);
      const box = new THREE.Box3().setFromObject(skin); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length();
      group.position.set(-c.x, -c.y, -c.z); const zoom = new URLSearchParams(location.search).get('zoom') === 'eyes';
      if (zoom) { camera.position.set(0, s * 0.12, s * 0.5); camera.lookAt(0, s * 0.1, 0); } else { camera.position.set(0, s * 0.05, s * 1.25); camera.lookAt(0, 0, 0); }
      // 랜드마크(중립 위치) → 피부 메시에서 가장 가까운 정점 번호 (모프 뒤 위치는 getVertexPosition 으로)
      const pos = skin.geometry.attributes.position; const pts = (lmAll[v] ?? []).map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const lmIdx = pts.map(p => { let bi = 0, bd = Infinity; const q = new THREE.Vector3(); for (let i = 0; i < pos.count; i++) { q.fromBufferAttribute(pos, i); const d = q.distanceToSquared(p); if (d < bd) { bd = d; bi = i; } } return bi; });
      R.current.meshes = meshes; R.current.skin = skin; R.current.lm = lmIdx.map(i => new THREE.Vector3(i, 0, 0)); R.current.hairMesh = null; R.current.hairWrap = null; R.current.brow = null;
      R.current.apply();
      setStatus(`${v} · 재질 ${meshes.map(m => (m.material as THREE.Material).name || '?').join('·')} · 셰이프 키 ${Object.keys(skin.morphTargetDictionary ?? {}).length}`);
    }).catch(e => setStatus('못 읽음: ' + String(e)));
    R.current.load = load;
    fetch('/dev-look3d/ict/weights.json').then(r => r.json()).then((w: Weights) => { R.current.weights = w; R.current.apply(); });
    load(variant);
    let raf = 0; const tick = () => { raf = requestAnimationFrame(tick); group.rotation.y = rotY; renderer.render(scene, camera); }; tick();
    (window as unknown as { __face?: unknown }).__face = { ready: () => R.current.meshes.length > 0 };
    return () => { disposed = true; cancelAnimationFrame(raf); renderer.domElement.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, []);

  // 값 적용: 축·표정 → 색 → 눈썹 데칼 → 머리카락 래핑 (모프가 바뀌면 눈썹·머리카락도 다시 놓는다)
  R.current.apply = () => {
    const { meshes, skin, group, ramp } = R.current; if (!skin || !group || !ramp) return;
    const w = R.current.weights?.[who];
    for (const m of meshes) {
      const dict = m.morphTargetDictionary, inf = m.morphTargetInfluences; if (!dict || !inf) continue; inf.fill(0);
      if (w) { for (const [k, v] of Object.entries(w.identity)) if (k in dict) inf[dict[k]] = v; if (expr) for (const [k, v] of Object.entries(w.expression)) if (k in dict) inf[dict[k]] = k.startsWith('eyeBlink') ? Math.min(v, 0.15) : v; }
      for (const [k, v] of Object.entries(vals)) if (k in dict) inf[dict[k]] = v;
    }
    // 색
    const col = w?.color; const skinHex = col ? SKIN[col.skin as Look['skin']] : '#FFD9B8';
    for (const m of meshes) {
      const n = (m.material as THREE.Material).name; const mat = m.material as THREE.MeshToonMaterial;
      mat.color.set(n === 'sclera' ? '#FFFFFF' : n === 'iris' ? (col ? IRIS[col.iris] : '#3B2A20') : n === 'lips' ? (col ? LIPS[col.lips] : '#D98C86') : skinHex);
      if (n === 'lips') mat.color.lerp(new THREE.Color(skinHex), 0.35);   // 입술은 피부에 살짝 섞어 튀지 않게
      // 눈: 각막은 투명(안 그림), 홍채는 정점 색으로 동공·홍채·테두리·하이라이트를 칠한다 — 사용자당 텍스처 없이 색 값 하나
      if (n === 'cornea') m.visible = false;
      if (n === 'iris') paintIris(m, col ? IRIS[col.iris] : '#3B2A20');
    }
    // 모프 적용 뒤 정점 위치 스냅샷 (눈썹 데칼 투영과 머리카락 래핑용)
    const pos = skin.geometry.attributes.position; const snap = new Float32Array(pos.count * 3); const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { skin.getVertexPosition(i, v); snap[i * 3] = v.x; snap[i * 3 + 1] = v.y; snap[i * 3 + 2] = v.z; }
    const at = (i: number) => new THREE.Vector3(snap[i * 3], snap[i * 3 + 1], snap[i * 3 + 2]);
    const L = (k: number) => at(R.current.lm[k]?.x ?? 0);
    // 눈썹 데칼: dlib 17~26 (오른눈썹 바깥→안, 왼눈썹 안→바깥)
    if (R.current.brow) { group.remove(R.current.brow); R.current.brow = null; }
    if (R.current.lm.length >= 68) {
      const bl = L(17), br = L(26); const ctr = new THREE.Vector3(); for (let k = 17; k <= 26; k++) ctr.add(L(k)); ctr.multiplyScalar(0.1);
      const width = bl.distanceTo(br) * 1.25; const snapGeo = new THREE.BufferGeometry(); snapGeo.setAttribute('position', new THREE.BufferAttribute(snap, 3)); if (skin.geometry.index) snapGeo.setIndex(skin.geometry.index); snapGeo.computeVertexNormals();
      const tmp = new THREE.Mesh(snapGeo); tmp.matrixAutoUpdate = false; tmp.matrixWorld.identity();
      const geo = new DecalGeometry(tmp, new THREE.Vector3(ctr.x, ctr.y + width * 0.02, ctr.z + width * 0.02), new THREE.Euler(0, 0, 0), new THREE.Vector3(width, width / 3.6, width * 0.5));
      const kind = (col?.brow.kind ?? 'thin') as Look['brows']; const bcol = col ? HAIR[col.browColor as Look['hairColor']] : '#2A1E1A';
      const brow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: browTexture(kind, bcol), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      group.add(brow); R.current.brow = brow;
    }
    // 머리카락: 파츠를 머리 상자에 맞춰 놓고, 정점마다 가장 가까운 두피 정점 + 오프셋으로 래핑
    const want = hair === 'auto' ? (who !== 'neutral' ? PEOPLE[who]?.hair ?? 'none' : 'none') : hair;
    const hairScale = hair === 'auto' && who !== 'neutral' ? PEOPLE[who]?.hairScale ?? 1 : 1;
    const placeHair = (hm: THREE.Mesh, wrap: { idx: Int32Array; off: Float32Array }) => {
      const hp = hm.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < hp.count; i++) { const j = wrap.idx[i]; hp.setXYZ(i, snap[j * 3] + wrap.off[i * 3], snap[j * 3 + 1] + wrap.off[i * 3 + 1], snap[j * 3 + 2] + wrap.off[i * 3 + 2]); }
      hp.needsUpdate = true; hm.geometry.computeVertexNormals();
    };
    const hairColorHex = col ? HAIR[col.hairColor as Look['hairColor']] : '#3A2A22';
    const syncMorph = (hm: THREE.Mesh) => { const d = hm.morphTargetDictionary, inf = hm.morphTargetInfluences, sd = skin.morphTargetDictionary, si = skin.morphTargetInfluences; if (!d || !inf || !sd || !si) return; for (const [k, i] of Object.entries(d)) inf[i] = k in sd ? si[sd[k]] : 0; };
    const cur = R.current.hairMesh;
    if (want.startsWith('hair-')) {
      // 두피 껍질 머리카락 (hair.py): 머리와 같은 셰이프 키를 가지니 값만 맞추면 어떤 생김새에도 붙는다. 자동 치비 머리에는 아직 없음
      if (cur && cur.userData.style === want) { syncMorph(cur); (cur.material as THREE.MeshToonMaterial).color.set(hairColorHex); }
      else {
        if (cur) { group.remove(cur); R.current.hairMesh = null; R.current.hairWrap = null; }
        new GLTFLoader().loadAsync(`/dev-look3d/hair/${want}.glb`).then(g => {
          if (R.current.skin !== skin) return; let hm: THREE.Mesh | null = null; g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) hm = o as THREE.Mesh; }); if (!hm) return; const h = hm as THREE.Mesh;
          h.material = new THREE.MeshToonMaterial({ color: new THREE.Color(hairColorHex), gradientMap: ramp }); h.userData.style = want;
          const hull = new THREE.Mesh(h.geometry, new THREE.MeshBasicMaterial({ color: 0x2a1e1a, side: THREE.BackSide })); hull.scale.setScalar(1.012); hull.morphTargetInfluences = h.morphTargetInfluences; hull.morphTargetDictionary = h.morphTargetDictionary; h.add(hull);
          group.add(h); R.current.hairMesh = h; syncMorph(h);
        }).catch(e => setStatus('머리카락 못 읽음: ' + String(e)));
      }
    }
    else if (cur && cur.userData.style === want && cur.userData.scale === hairScale && R.current.hairWrap) { placeHair(cur, R.current.hairWrap); (cur.material as THREE.MeshToonMaterial).color.set(col ? HAIR[col.hairColor as Look['hairColor']] : '#3A2A22'); }
    else {
      if (cur) { group.remove(cur); R.current.hairMesh = null; R.current.hairWrap = null; }
      if (want !== 'none') new GLTFLoader().loadAsync(`/dev-look3d/hair/${want}.glb`).then(g => {
        if (R.current.skin !== skin) return;
        const src: THREE.Mesh[] = []; g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) src.push(o as THREE.Mesh); });
        // 조각 여러 개면 하나로 (위치 변환 적용)
        const geos = src.map(m => { m.updateWorldMatrix(true, false); const gg = m.geometry.clone().applyMatrix4(m.matrixWorld); return gg.index ? gg.toNonIndexed() : gg; });
        const merged = geos.length === 1 ? geos[0] : (() => { const n = geos.reduce((a, gg) => a + gg.attributes.position.count, 0); const arr = new Float32Array(n * 3); let o = 0; for (const gg of geos) { arr.set(gg.attributes.position.array as Float32Array, o); o += gg.attributes.position.count * 3; } const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(arr, 3)); return m; })();
        // 머리 상자(눈 위)와 머리카락 상자를 맞춘다: 폭 기준 균일 스케일, 정수리 높이·좌우·앞뒤 중심 정렬
        const eyeY = (L(36).y + L(45).y) / 2; const hb = new THREE.Box3(); for (let i = 0; i < pos.count; i++) { const y = snap[i * 3 + 1]; if (y > eyeY) hb.expandByPoint(new THREE.Vector3(snap[i * 3], y, snap[i * 3 + 2])); }
        merged.computeBoundingBox(); const bb = merged.boundingBox!; const hs = bb.getSize(new THREE.Vector3()); const hsz = hb.getSize(new THREE.Vector3());
        const k = (hsz.x * 1.04 / hs.x) * hairScale; merged.scale(k, k, k); merged.computeBoundingBox(); const b2 = merged.boundingBox!;
        const hc = hb.getCenter(new THREE.Vector3()); const c2 = b2.getCenter(new THREE.Vector3());
        merged.translate(hc.x - c2.x, (hb.max.y + hsz.y * 0.03) - b2.max.y, hc.z - c2.z + hsz.z * 0.02);
        // 래핑
        const hp = merged.attributes.position; const idx = new Int32Array(hp.count); const off = new Float32Array(hp.count * 3); const q = new THREE.Vector3();
        for (let i = 0; i < hp.count; i++) { q.fromBufferAttribute(hp, i); let bi = 0, bd = Infinity; for (let j = 0; j < pos.count; j++) { const dx = snap[j * 3] - q.x, dy = snap[j * 3 + 1] - q.y, dz = snap[j * 3 + 2] - q.z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bi = j; } } idx[i] = bi; off[i * 3] = q.x - snap[bi * 3]; off[i * 3 + 1] = q.y - snap[bi * 3 + 1]; off[i * 3 + 2] = q.z - snap[bi * 3 + 2]; }
        const hm = new THREE.Mesh(merged, new THREE.MeshToonMaterial({ color: new THREE.Color(col ? HAIR[col.hairColor as Look['hairColor']] : '#3A2A22'), gradientMap: ramp })); hm.userData.style = want; hm.userData.scale = hairScale;
        const hull = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: 0x2a1e1a, side: THREE.BackSide })); hull.scale.setScalar(1.015); hm.add(hull);
        group.add(hm); R.current.hairMesh = hm; R.current.hairWrap = { idx, off }; placeHair(hm, { idx, off });
      }).catch(e => setStatus('머리카락 못 읽음: ' + String(e)));
    }
  };
  useEffect(() => { R.current.apply(); }, [who, expr, vals, hair]);
  useEffect(() => { setVals({}); R.current.load(variant); }, [variant]);

  return (
    <div className="flab">
      <style>{CSS}</style>
      <h1>얼굴 랩</h1>
      <div className="sub">FACE LAB · ICT FaceKit(MIT) 기본형 하나 · 생김새 축 20 + ARKit 표정 16 · 색·눈썹·머리카락은 사진에서 · 드래그로 돌리기</div>
      <div className="fstage" ref={host}><div className="note">{status}</div></div>
      <div className="rows">
        <div className="row"><b>머리</b><div className="chips">
          <button className={`chip${variant === 'head' ? ' on' : ''}`} onClick={() => setVariant('head')}>사실</button>
          <button className={`chip${variant === 'head-chibi' ? ' on' : ''}`} onClick={() => setVariant('head-chibi')}>치비(자동)</button>
        </div></div>
        <div className="row"><b>사람</b><div className="chips">
          <button className={`chip${who === 'neutral' ? ' on' : ''}`} onClick={() => { setWho('neutral'); setVals({}); }}>기본형</button>
          {Object.entries(PEOPLE).map(([k, p]) => <button key={k} className={`chip${who === k ? ' on' : ''}`} onClick={() => { setWho(k); setVals({}); }}>{p.name}</button>)}
          <button className={`chip${expr ? ' on' : ''}`} onClick={() => setExpr(e => !e)}>사진 표정</button>
        </div></div>
        <div className="row"><b>머리카락</b><div className="chips">
          <button className={`chip${hair === 'auto' ? ' on' : ''}`} onClick={() => setHair('auto')}>자동</button>
          {HAIRS.map(h => <button key={h} className={`chip${hair === h ? ' on' : ''}`} onClick={() => setHair(h)}>{h}</button>)}
        </div></div>
        {SLIDERS.map(k => (
          <div className="sl" key={k}><span>{k}</span>
            <input type="range" min={k.startsWith('identity') ? -3 : 0} max={k.startsWith('identity') ? 3 : 1} step={0.05} value={vals[k] ?? 0} onChange={e => setVals(v => ({ ...v, [k]: +e.target.value }))} />
            <span>{(vals[k] ?? 0).toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="sub">피팅·색은 사진 → MediaPipe (ict/fit.py · colors.py). 머리카락은 Quaternius Universal Base(CC0) 조각을 두피에 래핑한 자리 채움</div>
    </div>
  );
}
