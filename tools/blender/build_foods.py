"""
Food and its leftovers for the mela (assets/common_assets/foods-2.zip: source/Foods_2.rar -> Foods/Models/Foods.fbx and
Foods/Textures) -> public/models/foods.glb.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_foods.py -- path/to/Foods/Models/Foods.fbx

A pack of ~250 items laid out on a floor; a few are picked here, each brought to its real size, stood on its own origin
(the middle of its underside) and exported as a mesh of that name:
  for the poets' table on the kavi sammelan stage (mela.ts): fruit, bottles of water, biscuit packets
  litter for the ground (mela.ts): chip packets, a can, empty bottles, a popcorn box, wrappers, a juice carton
The pack's textures (Foods*.jpg, next to the models) come in with the materials that use them.
"""
import bpy, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src = sys.argv[sys.argv.index('--') + 1]
OUT = os.path.join(ROOT, 'public', 'models', 'foods.glb')

# exported name: (the pack's object, scale to real size)
PICK = {
    'banana': ('Banana', 0.85), 'apple': ('Apple.001', 0.6), 'orange': ('Orange', 0.65), 'grapes': ('Grape', 0.7),
    'mango': ('Mango', 0.75), 'water': ('Water_02', 0.8), 'water_small': ('Water', 0.8), 'biscuits': ('Cookies_03', 0.6),
    'biscuits_b': ('Cookies_10', 0.6), 'popcorn': ('Popcorn', 0.55), 'coconut': ('Coconut_02', 0.7),
    # litter
    'chips': ('Frying', 0.62), 'chips_b': ('Frying_05', 0.62), 'chips_c': ('Frying_14', 0.62), 'flat_bag': ('potato_chips_01', 0.8),
    'wrapper': ('Fast_food_09', 0.55), 'wrapper_b': ('Fast_food_10', 0.55), 'can': ('Canned_food_08', 1.25),
    'carton': ('Milk_03', 0.5), 'cookie_pack': ('Cookies_05', 0.6),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
keep = {}
for name, (obj, s) in PICK.items():
    o = bpy.data.objects.get(obj)
    if o is None:
        sys.exit(f'no {obj} in the pack')
    o.parent = None
    bpy.context.view_layer.update()
    m = o.data.copy()
    m.transform(o.matrix_world)
    vs = [v.co for v in m.vertices]
    lo = Vector([min(p[i] for p in vs) for i in range(3)])
    hi = Vector([max(p[i] for p in vs) for i in range(3)])
    m.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    n = bpy.data.objects.new(name, m)
    bpy.context.scene.collection.objects.link(n)
    keep[name] = n
    d = (hi - lo) * s
    print(f'FOOD {name}: {d.x:.3f} x {d.y:.3f} x {d.z:.3f} m, {len(m.polygons)} faces')
for o in list(bpy.data.objects):
    if o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
TEX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(src))), 'Textures')
for m in bpy.data.materials:
    if m.node_tree:
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if b:
            # the FBX names no files: each material's picture is Textures/<material>.jpg
            path = os.path.join(TEX, m.name + '.jpg')
            if os.path.exists(path):
                for n in [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']:
                    m.node_tree.nodes.remove(n)
                t = m.node_tree.nodes.new('ShaderNodeTexImage')
                t.image = bpy.data.images.load(path)
                m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
            else:
                print('FOOD no picture for', m.name)
            b.inputs['Roughness'].default_value = 0.6
            b.inputs['Metallic'].default_value = 0.0
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_animations=False,
                          export_image_format='JPEG', export_jpeg_quality=85, export_materials='EXPORT')
print('wrote', OUT, round(os.path.getsize(OUT) / 1e6, 2), 'MB')
