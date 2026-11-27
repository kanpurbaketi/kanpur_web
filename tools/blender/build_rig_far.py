"""
The far body of a rigged person: models/<name>_rig_lite.glb cut down again to FAR_TRIS triangles, as
models/<name>_rig_far.glb (the same skeleton and bone names, so actors.ts binds it to the full body's bones like the lite one).
Worn past about 40 m, where a person is a few dozen pixels high.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_rig_far.py -- public/models/uncle_rig_lite.glb ...
"""
import os
import sys

import bpy

FAR_TRIS = 2400

for src in sys.argv[sys.argv.index('--') + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    for m in meshes:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = m
        m.select_set(True)
        tris = sum(len(p.vertices) - 2 for p in m.data.polygons)
        dec = m.modifiers.new('decimate', 'DECIMATE')
        dec.ratio = min(1.0, FAR_TRIS / tris)
        dec.use_collapse_triangulate = True
        bpy.ops.object.modifier_move_to_index(modifier='decimate', index=0)
        bpy.ops.object.modifier_apply(modifier='decimate')
    for o in bpy.context.scene.objects:
        o.select_set(o in meshes or o in arms)
    out = src.replace('_rig_lite.glb', '_rig_far.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_skins=True, export_animations=False, export_materials='NONE', export_texcoords=True,
                              export_extras=True, export_morph=False)
    print('FAR', os.path.basename(out), sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes), 'triangles,',
          round(os.path.getsize(out) / 1e6, 2), 'MB')
