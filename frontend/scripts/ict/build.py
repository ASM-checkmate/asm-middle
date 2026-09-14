# ICT FaceKit(MIT) 머리: 중립 obj + (identity/expression obj − 중립) 차이값을 셰이프 키로 → head.glb.  치비 변형 f 를 기본형과 타깃 양쪽에 적용해 차이값을 자동 변환 → head-chibi.glb
import bpy, json, sys, os, math
import numpy as np
D = sys.argv[sys.argv.index('--') + 1]; OUT = sys.argv[sys.argv.index('--') + 2]
IDS = [f'identity{i:03d}' for i in range(20)]
EXS = ['eyeBlink_L', 'eyeBlink_R', 'mouthSmile_L', 'mouthSmile_R', 'jawOpen', 'browInnerUp_L', 'browInnerUp_R', 'browDown_L', 'browDown_R', 'eyeWide_L', 'eyeWide_R', 'mouthFrown_L', 'mouthFrown_R', 'mouthPucker', 'cheekPuff_L', 'cheekPuff_R']
def read_obj(p, faces=False):
    vs = []; fs = []
    for line in open(p):
        if line.startswith('v '): vs.append([float(x) for x in line.split()[1:4]])
        elif faces and line.startswith('f '): fs.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
    return np.array(vs, dtype=np.float64), fs
neutral, faces = read_obj(f'{D}/generic_neutral_mesh.obj', True)
YUP = lambda V: np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)   # OBJ(Y-up, 앞 +Z) → Blender(Z-up, 앞 -Y)
neutral = YUP(neutral)
keep = np.zeros(len(neutral), bool); keep[0:11248] = True; keep[21451:24591] = True   # 얼굴 + 머리·목 + 눈알
remap = -np.ones(len(neutral), int); remap[keep] = np.arange(keep.sum())
orig = [(pi, f) for pi, f in enumerate(faces) if all(keep[i] for i in f)]
faces = [[remap[i] for i in f] for _, f in orig]; forig = [pi for pi, _ in orig]
lm = json.load(open(f'{D}/vertex_indices.json'))['idx_to_landmark_verts']   # dlib 68 순서
# 목 자르기: 턱(dlib 8) 아래로 머리 높이의 28% 이하는 버린다 (몸에 끼울 목 토막만 남김)
_top = neutral[:11248, 2].max(); _brow = neutral[lm[17:27], 2].mean(); _chin = neutral[lm[8], 2]; _hh = _top - _brow; CUT = _chin - 0.10 * _hh
# 목 토막 좁히기: 턱 아래로 갈수록 목 중심축 쪽으로 눌러 옷깃 안에 숨긴다 (기본형·타깃 모두 같은 규칙)
_neck = neutral[:11248][(neutral[:11248, 2] < _chin) & (neutral[:11248, 2] > CUT)]; _nc = _neck[:, :2].mean(0) if len(_neck) else neutral[lm[8], :2]
def neck_taper(V):
    V = V.copy(); t = np.clip((_chin - V[:, 2]) / (0.12 * _hh), 0, 1); k = (1 - 0.5 * t)[:, None]
    V[:, :2] = _nc + (V[:, :2] - _nc) * k; return V
neutral = neck_taper(neutral)
orig = [(pi, f) for pi, f in orig if not all(neutral[i, 2] < CUT for i in f)]
faces = [[remap[i] for i in f] for _, f in orig]; forig = [pi for pi, _ in orig]
targets = {n: neck_taper(YUP(read_obj(f'{D}/{n}.obj')[0])) for n in IDS + EXS}
print('loaded', len(targets), 'verts', keep.sum(), 'faces', len(faces), flush=True)
# ── 치비 변형: 둥글게 + 눈 크게 + 코·입 작게 + 아래턱 작게 (토폴로지 유지)
P = neutral
c = P[0:11248].mean(0); R = np.linalg.norm(P[0:11248] - c, axis=1).mean()
eyeL = P[lm[42:48]].mean(0); eyeR = P[lm[36:42]].mean(0); nose = P[lm[30]]; mouth = P[lm[48:68]].mean(0); chin = P[lm[8]]
eye_r = np.linalg.norm(eyeL - eyeR) * 0.42
def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
def f(V):
    V = V.copy()
    d = V - c; n = np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    V = V + 0.33 * ((c + R * d / n) - V)                                   # 구 쪽으로 33%
    for e in (eyeL, eyeR):                                                 # 눈 주변 1.35배
        w = smooth(1 - np.linalg.norm(V - e, axis=1) / (eye_r * 1.6))[:, None]; V = V + w * 0.35 * (V - e)
    w = smooth(1 - np.linalg.norm(V - nose, axis=1) / (eye_r * 1.3))[:, None]; V = V - w * 0.3 * (V - nose)   # 코 0.7
    w = smooth(1 - np.linalg.norm(V - mouth, axis=1) / (eye_r * 1.8))[:, None]; V = V - w * 0.18 * (V - mouth) # 입 0.82
    w = smooth((mouth[2] - V[:, 2]) / (mouth[2] - chin[2] + 1e-9))[:, None]; V = V - w * 0.22 * (V - np.array([[c[0], c[1], mouth[2]]])) # 턱 안으로
    return V
def in_poly(pt, poly):
    x, y = pt; inside = False; n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: inside = not inside
    return inside
def mat_index(V):
    # 재질: 0 skin · 1 sclera · 2 iris · 3 lips  (눈알은 문서의 폴리곤 범위, 입술은 입술 랜드마크 다각형(정면 투영) 안 + 얼굴 앞쪽)
    lipc = V[lm[48:60]].mean(0); poly = [((V[i] - lipc) * 1.02 + lipc)[[0, 2]] for i in lm[48:60]]
    front = V[lm[30]][1]   # 코끝 깊이(-Y 가 앞)
    out = []
    eyeL_c = V[21451:22221].mean(0); irisL_c = V[22221:23021].mean(0); eyeR_c = V[23021:23791].mean(0); irisR_c = V[23791:24591].mean(0)
    def cap(ctr, ec, ic):
        a = ctr - ec; b = ic - ec; return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)) > 0.72   # 홍채 방향 ±44° 안이면 각막
    for pi, f in zip(forig, faces):
        if 22296 <= pi <= 23093 or 23894 <= pi <= 24691: out.append(2)
        elif 21496 <= pi <= 22295: out.append(4 if cap(base_full[f].mean(0), eyeL_c, irisL_c) else 1)
        elif 23094 <= pi <= 23893: out.append(4 if cap(base_full[f].mean(0), eyeR_c, irisR_c) else 1)
        else:
            ctr = base_full[f].mean(0)
            out.append(3 if (ctr[1] < front + 0.35 * R and in_poly(ctr[[0, 2]], poly)) else 0)
    return out
def build(name, xf):
    global base_full
    bpy.ops.wm.read_factory_settings(use_empty=True)
    Vfull = xf(neutral); base = Vfull[keep]; base_full = base
    LMOUT[name] = [[float(v[0]), float(v[2]), float(-v[1])] for v in Vfull[lm]]   # Blender (x,y,z) → glTF (x, z, -y)
    me = bpy.data.meshes.new(name); me.from_pydata(base.tolist(), [], faces); me.update()
    mi = mat_index(Vfull)
    for p, m in zip(me.polygons, mi): p.use_smooth = True; p.material_index = m
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    ob.shape_key_add(name='Basis', from_mix=False)
    for n in IDS + EXS:
        kb = ob.shape_key_add(name=n, from_mix=False); tgt = xf(targets[n])[keep]
        kb.data.foreach_set('co', tgt.ravel()); kb.slider_min = -3; kb.slider_max = 3
    for nm, col in (('skin', (1.0, 0.85, 0.72, 1)), ('sclera', (1, 1, 1, 1)), ('iris', (0.25, 0.16, 0.12, 1)), ('lips', (0.85, 0.55, 0.52, 1)), ('cornea', (1, 1, 1, 0.1))):
        mat = bpy.data.materials.new(nm); mat.diffuse_color = col; me.materials.append(mat)
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}.glb', use_selection=True, export_morph=True, export_morph_normal=False, export_yup=True, export_materials='EXPORT')
    return ob
def render(ob, tag, poses):
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'; sc.display.shading.show_cavity = True
    sc.render.resolution_x = sc.render.resolution_y = 320; sc.render.film_transparent = False; sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.95, 0.9, 0.85)
    cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    vs = np.array([v.co for v in ob.data.vertices]); ctr = (vs.min(0) + vs.max(0)) / 2; size = (vs.max(0) - vs.min(0)).max()
    cam.ortho_scale = size * 1.15; co.location = (ctr[0], ctr[1] - size * 3, ctr[2]); co.rotation_euler = (math.radians(90), 0, 0)
    for label, vals in poses:
        for k in ob.data.shape_keys.key_blocks: k.value = 0.0
        for n, v in vals.items(): ob.data.shape_keys.key_blocks[n].value = v
        sc.render.filepath = f'{OUT}/r-{tag}-{label}.png'; bpy.ops.render.render(write_still=True)
POSES = [('neutral', {}), ('id0+', {'identity000': 2}), ('id0-', {'identity000': -2}), ('id1+', {'identity001': 2}), ('id2+', {'identity002': 2}), ('id3+', {'identity003': 2}),
         ('blink', {'eyeBlink_L': 1, 'eyeBlink_R': 1}), ('smile', {'mouthSmile_L': 1, 'mouthSmile_R': 1}), ('jaw', {'jawOpen': 0.6}), ('brow', {'browInnerUp_L': 1, 'browInnerUp_R': 1}), ('frown', {'browDown_L': 1, 'browDown_R': 1, 'mouthFrown_L': 1, 'mouthFrown_R': 1})]
LMOUT = {}
ob = build('head', lambda V: V); render(ob, 'real', POSES)
ob = build('head-chibi', f); render(ob, 'chibi', POSES)
json.dump(LMOUT, open(f'{OUT}/landmarks.json', 'w'))
print('DONE', flush=True)
