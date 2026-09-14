# Quaternius 모듈러 남성 머리에서 머리카락 재질 폴리곤만 떼어 glb 로
import bpy, sys, os, bmesh
src, out = sys.argv[sys.argv.index('--') + 1:][:2]
JOBS = {'Adventurer': ['Hair'], 'Beach': ['Hair'], 'Casual_2': ['Hair'], 'Casual_Hoodie': ['Hair'], 'Suit': ['Hair'], 'King': ['Hair_White'], 'Punk': ['Red']}
for name, mats in JOBS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, f'{name}.gltf'))
    keep = []
    for o in list(bpy.data.objects):
        if o.type != 'MESH': continue
        p = o; is_head = False
        while p: 
            if p.name.endswith('_Head'): is_head = True
            p = p.parent
        if not is_head or not any(m and m.name in mats for m in o.data.materials): bpy.data.objects.remove(o); continue
        # 머리카락 재질이 아닌 폴리곤 삭제
        idx = {i for i, m in enumerate(o.data.materials) if m and m.name in mats}
        bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in idx], context='FACES'); bm.to_mesh(o.data); bm.free()
        o.data.materials.clear(); o.data.materials.append(bpy.data.materials.new('hair')); keep.append(o)
    for o in list(bpy.data.objects):
        if o.type != 'MESH': bpy.data.objects.remove(o)
    for o in keep: o.select_set(True); bpy.context.view_layer.objects.active = o
    # 뼈대 없이 정적 메시로 (팔 위치와 무관, 머리 바인드 포즈 그대로)
    for o in keep:
        for m in list(o.modifiers): o.modifiers.remove(m)
        o.parent = None
    print('HAIR', name, [len(o.data.polygons) for o in keep], flush=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, f'q-{name.lower()}.glb'), use_selection=True, export_yup=True, export_materials='EXPORT', export_image_format='NONE', export_skins=False, export_animations=False)
print('DONE')
