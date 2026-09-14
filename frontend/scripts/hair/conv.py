import bpy, sys, glob, os
src, out = sys.argv[sys.argv.index('--') + 1:][:2]
for p in sorted(glob.glob(os.path.join(src, '*.usda'))):
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.wm.usd_import(filepath=p)
    name = os.path.splitext(os.path.basename(p))[0].replace('S_Hair', '').lower()
    ms = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in ms: o.data.materials.clear(); m = bpy.data.materials.new('hair'); o.data.materials.append(m)
    import numpy as np
    vs = np.array([o.matrix_world @ v.co for o in ms for v in o.data.vertices]); print('HAIR', name, len(vs), 'min', np.round(vs.min(0), 2), 'max', np.round(vs.max(0), 2))
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, f'{name}.glb'), export_yup=True, export_materials='EXPORT', export_image_format='NONE')
print('DONE')
