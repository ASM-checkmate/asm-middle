# ICT 두피에서 머리카락 껍질을 만든다: 헤어라인 규칙(스타일별)로 두피 정점을 고르고 Solidify 로 두께 → hair-<style>.glb (생김새·표정 셰이프 키 그대로 따라옴)
import bpy, json, sys, math
import numpy as np
D = sys.argv[sys.argv.index('--') + 1]; OUT = sys.argv[sys.argv.index('--') + 2]
IDS = [f'identity{i:03d}' for i in range(20)]
EXS = ['eyeBlink_L', 'eyeBlink_R', 'mouthSmile_L', 'mouthSmile_R', 'jawOpen', 'browInnerUp_L', 'browInnerUp_R', 'browDown_L', 'browDown_R', 'eyeWide_L', 'eyeWide_R', 'mouthFrown_L', 'mouthFrown_R', 'mouthPucker', 'cheekPuff_L', 'cheekPuff_R']
def read_obj(p, faces=False):
    vs = []; fs = []
    for line in open(p):
        if line.startswith('v '): vs.append([float(x) for x in line.split()[1:4]])
        elif faces and line.startswith('f '): fs.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
    return np.array(vs), fs
YUP = lambda V: np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)
neutral, faces = read_obj(f'{D}/generic_neutral_mesh.obj', True); neutral = YUP(neutral)
lm = json.load(open(f'{D}/vertex_indices.json'))['idx_to_landmark_verts']
targets = {n: YUP(read_obj(f'{D}/{n}.obj')[0]) for n in IDS + EXS}
HEAD = 11248
P = neutral
c = P[:HEAD].mean(0); top = P[:HEAD, 2].max(); brow = P[lm[17:27], 2].mean(); nose = P[lm[30]]
ear = (abs(P[lm[0], 0]) + abs(P[lm[16], 0])) / 2
# 두피 좌표: 높이 e (눈썹 0 → 정수리 1), 방위 θ (앞 0, 옆 ±90°, 뒤 180°)
def coords(V):
    e = (V[:, 2] - brow) / (top - brow)
    th = np.degrees(np.arctan2(V[:, 0] - c[0], -(V[:, 1] - c[1])))   # -Y 가 앞
    return e, th
def hairline(style, th):
    a = np.abs(th)
    if style == 'buzz' or style == 'short':
        return np.where(a < 60, 0.52 - 0.12 * np.cos(np.radians(a) * 1.5), np.where(a < 130, 0.28, 0.12))
    if style == 'bowl':
        return np.where(a < 70, 0.30, np.where(a < 130, 0.22, 0.10))
    if style == 'bangs':
        return np.where(a < 55, 0.26, np.where(a < 130, 0.30, 0.12))
    if style == 'sidepart':   # 오른쪽(+x)은 이마 드러남, 왼쪽은 앞머리 내려옴
        front = 0.30 + 0.28 * (1 / (1 + np.exp(-th / 12)))
        return np.where(a < 70, front, np.where(a < 130, 0.26, 0.12))
    return np.full_like(th, 0.5)
THICK = {'buzz': 0.35, 'short': 0.9, 'bowl': 1.4, 'bangs': 1.3, 'sidepart': 1.2}
def ear_mask(V):
    # 귀 영역 제외: 옆으로 많이 나온 정점 중 낮은 것
    e, th = coords(V); return (np.abs(V[:, 0]) > ear * 0.8) & (e < 0.45) & (np.abs(th) > 60) & (np.abs(th) < 125)
def scalp_faces(style):
    e, th = coords(P); inside = (e > hairline(style, th)) & ~ear_mask(P); inside[HEAD:] = False
    return [f for f in faces if all(i < HEAD and inside[i] for i in f)]
def solidified(V, fs, thick):
    """정점 V(전체), 면 fs(전체 번호) → Solidify 적용된 정점 배열 (같은 입력 토폴로지면 같은 순서)"""
    used = sorted({i for f in fs for i in f}); remap = {v: k for k, v in enumerate(used)}
    me = bpy.data.meshes.new('h'); me.from_pydata(V[used].tolist(), [], [[remap[i] for i in f] for f in fs]); me.update()
    ob = bpy.data.objects.new('h', me); bpy.context.scene.collection.objects.link(ob); bpy.context.view_layer.objects.active = ob
    m = ob.modifiers.new('s', 'SOLIDIFY'); m.thickness = thick; m.offset = 1.0; m.use_rim = True; m.use_even_offset = True
    bpy.ops.object.modifier_apply(modifier='s')
    out = np.array([v.co for v in ob.data.vertices]); fac = [list(p.vertices) for p in ob.data.polygons]
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return out, fac
for style, thick in THICK.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fs = scalp_faces(style)
    base, fac = solidified(P, fs, thick)
    me = bpy.data.meshes.new(f'hair-{style}'); me.from_pydata(base.tolist(), [], fac); me.update()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(f'hair-{style}', me); bpy.context.scene.collection.objects.link(ob); bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    ob.shape_key_add(name='Basis', from_mix=False)
    for n in IDS + EXS:
        tv, _ = solidified(targets[n], fs, thick)
        kb = ob.shape_key_add(name=n, from_mix=False); kb.data.foreach_set('co', tv.ravel()); kb.slider_min = -3; kb.slider_max = 3
    mat = bpy.data.materials.new('hair'); me.materials.append(mat)
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/hair-{style}.glb', use_selection=True, export_morph=True, export_morph_normal=False, export_yup=True, export_materials='EXPORT')
    print('HAIR', style, 'faces', len(fs), 'verts', len(base), flush=True)
print('DONE', flush=True)
