"""
A far-away version of a vehicle: public/models/<name>.glb cut down to a few thousand triangles, written as
public/models/<name>_lod.glb with the same material names but no textures (the game draws it with the near model's
materials, so nothing is downloaded twice).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/make_lod.py -- NAME TRIS
"""
import bpy, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index('--') + 1:]
NAME, TRIS = argv[0], int(argv[1])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'public', 'models', NAME + '.glb'), merge_vertices=True)
# the wheels (split_wheels.py) go back into the body: far away they need not turn
for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
solid = [o for o in meshes if not any(m and m.name == 'glass' for m in o.data.materials)]
for o in solid:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
if len(solid) > 1:
    bpy.ops.object.select_all(action='DESELECT')
    for o in solid:
        o.select_set(True)
    bpy.context.view_layer.objects.active = solid[0]
    bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


# glass is a few big panes: leave it; the rest shares the budget
body = [o for o in meshes if not any(m and m.name == 'glass' for m in o.data.materials)]
total = sum(tris(o) for o in body)
ratio = min(1.0, max(0.02, (TRIS - sum(tris(o) for o in meshes if o not in body)) / max(1, total)))
for o in body:
    d = o.modifiers.new('dec', 'DECIMATE')
    d.decimate_type = 'COLLAPSE'
    d.ratio = ratio
    d.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='dec')

# keep the materials (by name) but none of their pictures
for m in bpy.data.materials:
    if m.node_tree:
        for n in list(m.node_tree.nodes):
            if n.type == 'TEX_IMAGE':
                m.node_tree.nodes.remove(n)
for im in list(bpy.data.images):
    bpy.data.images.remove(im)

out = os.path.join(ROOT, 'public', 'models', NAME + '_lod.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_animations=False,
                          export_materials='EXPORT', export_normals=True, export_texcoords=True)
print('LOD', NAME, total, '->', sum(tris(o) for o in meshes), 'tris', round(os.path.getsize(out) / 1e3), 'kB')
