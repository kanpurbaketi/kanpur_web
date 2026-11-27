"""
A generated character (Hunyuan 3D's .fbx or .glb) made ready for Mixamo's upload, which refuses big files: its meshes
joined and their transforms applied (standing up, +Y up), only the colour texture kept, at 2048 px (the metal /
roughness / normal maps dropped: Mixamo only needs the look to place the joints), and written out twice:
  <out>.zip   the mesh as OBJ + MTL + texture.jpg (Mixamo takes a zip of these)
  <out>.fbx   the same mesh as a lean FBX, its texture embedded
  <out>_texture.png   the colour texture at its full size, for putting back on what Mixamo returns
Upload the .zip first; the .fbx if Mixamo will not take that. Mixamo often drops an OBJ's texture: put it back on the
rigged download with tools/blender/mixamo_retexture.py (the UVs come back unchanged).

  Blender -b -P tools/blender/mixamo_prep.py -- ~/Downloads/ramu_adult.fbx [out without extension]
"""
import bpy, os, sys, zipfile, tempfile

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = os.path.expanduser(args[0])
out = os.path.expanduser(args[1]) if len(args) > 1 else os.path.splitext(src)[0] + '_mixamo'
TEX = 2048

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith(('.glb', '.gltf')):
    bpy.ops.import_scene.gltf(filepath=src)
else:
    bpy.ops.import_scene.fbx(filepath=src)

# no rig of its own (Mixamo makes one): armatures and empties go, their meshes kept where they stand
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    o.matrix_world = o.matrix_world.copy()
    o.parent = None
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
    for m in list(o.modifiers):
        o.modifiers.remove(m)
    o.vertex_groups.clear()
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# standing on the ground, centred, about 1.75 m tall (Blender is Z up; the exports turn it to Y up)
lo = min((body.matrix_world @ v.co).z for v in body.data.vertices)
hi = max((body.matrix_world @ v.co).z for v in body.data.vertices)
k = 1.75 / max(hi - lo, 1e-6)
xs = [v.co.x for v in body.data.vertices]; ys = [v.co.y for v in body.data.vertices]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
for v in body.data.vertices:
    v.co.x = (v.co.x - cx) * k
    v.co.y = (v.co.y - cy) * k
    v.co.z = (v.co.z - lo) * k
print(f'mesh: {len(body.data.vertices)} verts, {len(body.data.polygons)} faces; height scaled x{k:.3f} to 1.75 m')

# the colour texture: the image feeding Base Color (else the biggest one that is not a normal / metal / roughness map)
colour = None
for slot in body.material_slots:
    mat = slot.material
    if not (mat and mat.use_nodes):
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf and bsdf.inputs['Base Color'].is_linked:
        n = bsdf.inputs['Base Color'].links[0].from_node
        while n and n.type != 'TEX_IMAGE' and n.inputs and any(i.is_linked for i in n.inputs):
            n = next(i for i in n.inputs if i.is_linked).links[0].from_node
        if n and n.type == 'TEX_IMAGE':
            colour = n.image
            break
if colour is None:
    imgs = [i for i in bpy.data.images if i.size[0] and not any(w in i.name.lower() for w in ('normal', 'metal', 'rough'))]
    colour = max(imgs, key=lambda i: i.size[0] * i.size[1], default=None)
if colour is None:
    sys.exit('no colour texture found')
print('colour texture:', colour.name, tuple(colour.size))

work = tempfile.mkdtemp()
full = colour.copy()
full.filepath_raw = out + '_texture.png'
full.file_format = 'PNG'
full.save()
tex_path = os.path.join(work, 'texture.jpg')
small = colour.copy()
if max(small.size) > TEX:
    small.scale(TEX, TEX)
small.filepath_raw = tex_path
small.file_format = 'JPEG'
bpy.context.scene.render.image_settings.quality = 90
small.save()

# one plain material with just that texture
mat = bpy.data.materials.new('body')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
tn = mat.node_tree.nodes.new('ShaderNodeTexImage')
tn.image = bpy.data.images.load(tex_path)
mat.node_tree.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
body.data.materials.clear()
body.data.materials.append(mat)
body.name = body.data.name = 'body'

# the zip: OBJ + MTL + texture.jpg
obj_path = os.path.join(work, 'body.obj')
bpy.ops.wm.obj_export(filepath=obj_path, export_selected_objects=False, forward_axis='NEGATIVE_Z', up_axis='Y',
                      export_materials=True, path_mode='STRIP', export_normals=True, export_uv=True)
with zipfile.ZipFile(out + '.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in ('body.obj', 'body.mtl', 'texture.jpg'):
        z.write(os.path.join(work, f), f)

# the lean FBX, its texture embedded
bpy.ops.export_scene.fbx(filepath=out + '.fbx', use_selection=False, object_types={'MESH'}, path_mode='COPY',
                         embed_textures=True, axis_forward='-Z', axis_up='Y', apply_scale_options='FBX_SCALE_ALL')
for f in (out + '.zip', out + '.fbx', out + '_texture.png'):
    print(f'wrote {f}: {os.path.getsize(f) / 1e6:.1f} MB')
