# Human Base Meshes(CC0) 의 스타일라이즈드 남성 몸 → 치비 비례 + 열세 칸용 셰이프 키 → GLB (morph targets)
import bpy, json, math, sys
from mathutils import Vector
OUT = sys.argv[sys.argv.index('--') + 1]
body = bpy.data.objects['GEO-body_male_stylized']
eyes = [bpy.data.objects['GEO-body_male_stylized.eye.L'], bpy.data.objects['GEO-body_male_stylized.eye.R']]
# 1) 몸과 눈알을 한 메시로 (셰이프 키가 눈까지 같이 움직이게). 재질 슬롯: skin / eye
skin = bpy.data.materials.new('skin'); eye = bpy.data.materials.new('eye')
body.data.materials.append(skin)
for e in eyes: e.data.materials.append(eye)
bpy.ops.object.select_all(action='DESELECT')
for o in [body] + eyes: o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
me = body.data
# 2) 가운데로 (x 중심 0), 치비: 목 위는 1.8배, 목 아래는 세로 0.8배
xs = [v.co.x for v in me.vertices]; cx = (min(xs) + max(xs)) / 2
NECK = 1.46; HEAD = 1.8; BODY = 0.8
head_ys = [v.co.y for v in me.vertices if v.co.z > NECK + 0.05]; yc = (min(head_ys) + max(head_ys)) / 2
def smooth(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
for v in me.vertices:
    x, y, z = v.co.x - cx, v.co.y, v.co.z
    w = smooth((z - (NECK - 0.04)) / 0.08)
    s = 1 + (HEAD - 1) * w; zs = BODY + (HEAD - BODY) * w
    v.co = Vector((x * s, yc + (y - yc) * s, NECK * BODY + (z - NECK) * zs))
neck = NECK * BODY
zs_ = [v.co.z for v in me.vertices]; top = max(zs_)
hc = (neck + top) / 2
eyeL = [v.co for v in me.vertices if v.co.x > 0 and me.polygons[0]]  # placeholder
# 눈 위치: eye 재질 슬롯의 정점 평균
eye_idx = [p.vertices for p in me.polygons if me.materials[p.material_index].name == 'eye']
eye_vs = set(i for poly in eye_idx for i in poly)
L = [me.vertices[i].co for i in eye_vs if me.vertices[i].co.x > 0]; R = [me.vertices[i].co for i in eye_vs if me.vertices[i].co.x <= 0]
avg = lambda vs: [sum(v[k] for v in vs) / len(vs) for k in range(3)]
eL, eR = avg(L), avg(R)
eye_r = (max(v.x for v in L) - min(v.x for v in L)) / 2
eye_z = eL[2]
front = min(v.co.y for v in me.vertices if v.co.z > neck)   # 얼굴 앞 (Blender -Y 가 앞)
hips = 0.85 * BODY; shoulders = 1.43 * BODY
# 옷: 높이로 재질 슬롯을 나눈다 — 머리·손은 skin, 허리~목 top, 허리 아래 pants, 발 shoes (몸통 파츠가 생기기 전의 임시 색칠)
for nm in ['top', 'pants', 'shoes']: me.materials.append(bpy.data.materials.new(nm))
slot = {m.name: i for i, m in enumerate(me.materials)}
for p in me.polygons:
    if me.materials[p.material_index].name == 'eye': continue
    z = sum(me.vertices[i].co.z for i in p.vertices) / len(p.vertices)
    xabs = max(abs(me.vertices[i].co.x) for i in p.vertices)
    if z >= neck - 0.02: p.material_index = slot['skin']
    elif xabs > 0.37: p.material_index = slot['skin']        # 손
    elif z >= hips - 0.02: p.material_index = slot['top']
    elif z < 0.07: p.material_index = slot['shoes']
    else: p.material_index = slot['pants']
# 3) 셰이프 키
g = lambda p: [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]   # glTF 좌표: (x, y, z)_blender → (x, z, -y)
bpy.ops.object.shape_key_add(from_mix=False)  # Basis
base = [v.co.copy() for v in me.vertices]
def key(name, f):
    k = bpy.ops.object.shape_key_add(from_mix=False); kb = me.shape_keys.key_blocks[-1]; kb.name = name
    for i, v in enumerate(base):
        kb.data[i].co = f(v)
def head_w(v): return smooth((v.z - (neck - 0.05)) / 0.1)
def lower_t(v): return max(0.0, min(1.0, (eye_z - v.z) / (eye_z - neck)))
key('face_long', lambda v: Vector((v.x * (1 - 0.06 * head_w(v)), v.y, hc + (v.z - hc) * (1 + 0.15 * head_w(v)))))
key('face_square', lambda v: Vector((v.x * (1 + 0.22 * lower_t(v) * head_w(v)), v.y, v.z + 0.05 * lower_t(v) ** 2 * head_w(v))))
key('face_heart', lambda v: Vector((v.x * (1 - 0.28 * lower_t(v) ** 2 * head_w(v)), v.y, v.z - 0.03 * lower_t(v) ** 2 * head_w(v))))
def torso_w(v): return smooth((v.z - (hips - 0.06)) / 0.08) * (1 - smooth((v.z - (shoulders + 0.02)) / 0.08))
key('build_slim', lambda v: Vector((v.x * (1 - 0.14 * torso_w(v)), yc + (v.y - yc) * (1 - 0.1 * torso_w(v)), v.z)))
key('build_wide', lambda v: Vector((v.x * (1 + 0.28 * torso_w(v)), yc + (v.y - yc) * (1 + 0.18 * torso_w(v)), v.z)))
# 코: 얼굴 앞 정중앙, 눈 아래 띠에서 가장 앞에 있는 점을 코끝으로
cand = [v.co for v in me.vertices if abs(v.co.x) < 0.02 and eye_z - 0.16 < v.co.z < eye_z - 0.02]
tip = min(cand, key=lambda c: c.y)
def nose(v):
    d = (v - tip).length; r = 0.07
    if d > r: return v
    k = (1 - d / r) ** 2; return Vector((v.x, v.y - 0.03 * k, v.z))
key('nose_big', nose)
# 입: 코끝 아래 앞쪽 띠. smile = 입꼬리 올림, wide = 옆으로 벌림
mz = tip.z - 0.065
def mouth_w(v):
    dx = abs(v.x) / 0.075; dz = abs(v.z - mz) / 0.035; dy = (v.y - (tip.y + 0.02)) / 0.06   # 앞쪽만
    if dx > 1 or dz > 1 or dy > 1: return 0.0
    return (1 - dx * dx) * (1 - dz * dz) * max(0.0, 1 - max(0.0, dy))
key('mouth_smile', lambda v: Vector((v.x * (1 + 0.15 * mouth_w(v)), v.y, v.z + 0.022 * (abs(v.x) / 0.075) ** 1.5 * mouth_w(v))))
key('mouth_wide', lambda v: Vector((v.x * (1 + 0.45 * mouth_w(v)), v.y, v.z + 0.012 * (abs(v.x) / 0.075) * mouth_w(v))))
# 눈꺼풀: 눈알 주변 피부의 윗눈꺼풀을 내려 반쯤 감은 눈 (narrow)
eyec = [Vector(eL), Vector(eR)]
def lid(v):
    for e in eyec:
        d = (Vector((v.x, v.y, v.z)) - e).length
        if d < 0.11 and v.z > e.z - 0.005 and v.y < e.y + 0.03:
            k = max(0.0, 1 - d / 0.11)
            return Vector((v.x, v.y, v.z - min(0.045, (v.z - e.z + 0.005) * 0.75) * k ** 0.5))
    return v
key('eyes_narrow', lid)
# 머리 상자 (머리카락·안경 맞추기용)
hv = [v for v in base if v.z > neck]
headBox = { 'min': g((min(v.x for v in hv), min(v.y for v in hv), min(v.z for v in hv))), 'max': g((max(v.x for v in hv), max(v.y for v in hv), max(v.z for v in hv))) }
# 4) 내보내기
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=OUT + '/base.glb', use_selection=True, export_morph=True, export_morph_normal=False, export_apply=True, export_yup=True, export_materials='EXPORT', export_image_format='NONE')
# glTF 좌표: (x, y, z)_blender → (x, z, -y)
meta = { 'neck': round(neck, 4), 'top': round(top, 4), 'headCenter': g((0, yc, hc)), 'eyeL': g(eL), 'eyeR': g(eR), 'eyeR_': round(eye_r, 4), 'faceFront': round(-front, 4), 'noseTip': g(tip), 'hips': round(hips, 4), 'shoulders': round(shoulders, 4), 'height': round(top, 4), 'verts': len(me.vertices), 'headBox': headBox, 'keys': [k.name for k in me.shape_keys.key_blocks] }
json.dump(meta, open(OUT + '/base.json', 'w'), indent=1); print('META', json.dumps(meta))
