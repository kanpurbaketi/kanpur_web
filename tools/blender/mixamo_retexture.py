"""
A character rigged by Mixamo given back its colour texture (Mixamo often drops the texture of an uploaded OBJ zip, but
keeps its UVs): every mesh gets one material with that image as its base colour, and the rigged FBX is written again
with the image embedded, skeleton and skin as they were. build_ramu_rig.py reads the texture from there.

  Blender -b -P tools/blender/mixamo_retexture.py -- <rigged.fbx from Mixamo> <texture.png> [out.fbx]
    (out: <rigged>_tex.fbx; the texture: the <name>_mixamo_texture.png that mixamo_prep.py wrote)
"""
import bpy, os, sys

args = [os.path.expanduser(a) for a in sys.argv[sys.argv.index('--') + 1:]]
src, tex = args[0], args[1]
out = args[2] if len(args) > 2 else os.path.splitext(src)[0] + '_tex.fbx'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False)
img = bpy.data.images.load(tex)
mat = bpy.data.materials.new('body')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
tn = mat.node_tree.nodes.new('ShaderNodeTexImage')
tn.image = img
mat.node_tree.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.8
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    if not o.data.uv_layers:
        print('warning: no UVs on', o.name)
    o.data.materials.clear()
    o.data.materials.append(mat)
for im in list(bpy.data.images):
    if im != img:
        bpy.data.images.remove(im)
bpy.ops.export_scene.fbx(filepath=out, use_selection=False, object_types={'ARMATURE', 'MESH'}, path_mode='COPY',
                         embed_textures=True, add_leaf_bones=False, bake_anim=False)
print(f'wrote {out}: {os.path.getsize(out) / 1e6:.1f} MB ({len(meshes)} meshes, texture {tuple(img.size)})')
