"""
The wheels every vehicle is drawn with (src/world/vehicleModels.ts): a car's and a motorbike's, from downloaded models
(assets/common_assets/mazda-rx7--wheel.zip, motorcycle-wheel.zip), cut down to a few triangles.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_wheels.py -- WORKDIR

WORKDIR: where the zips are unpacked (car/, bike/; made if missing). Writes public/models/wheel_car.glb and
wheel_bike.glb, each with two meshes: `near` (about NEAR triangles) and `far` (about FAR), sharing one material
(base colour, normal, roughness / metal at TEX px).
Each is centred on its hub, the axle along x, its outer face (the rim's, a car's hub cap) toward +x, radius 1 (the
tyre's outside). Extras: `tw`, the tyre's width in those units (the game scales across by the vehicle's wheel width).
Frame: the game's (x across, y up, z forward); Blender: x, -z... written by the glTF exporter (+Y up).
"""
import bpy, bmesh, math, os, sys, zipfile
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index('--') + 1:]
WORK = argv[0]
TEX = 512

WHEELS = {
    # name: zip, fbx inside it, textures (base, normal, roughness, metallic) inside it, triangles near / far,
    # flip: turn it round so its outer face is toward +x
    'car': ('mazda-rx7--wheel.zip', 'source/MAZDA_RX7_Wheel.fbx',
            ('textures/Tire_BaseColor.png', 'textures/Tire_Normal.png', 'textures/Tire_Roughness.png', 'textures/Tire_Metallic.png'),
            1500, 320, False),
    'bike': ('motorcycle-wheel.zip', 'source/motorcycle wheel.fbx',
             ('textures/wheel_albedo.jpg', 'textures/wheel_normal.png', 'textures/wheel_roughness.jpg', 'textures/wheel_metallic.jpg'),
             1800, 360, False),
}


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def image(path, name, data):
    img = bpy.data.images.load(path)
    img.name = name
    if max(img.size) > TEX:
        img.scale(TEX, TEX)
    if name.endswith('base'):
        greyed(img)
    # saved small (the exporter takes the file, not what is in memory): JPEG, but PNG for the normal map
    small = os.path.join(WORK, f'{name}.{"png" if name.endswith("normal") else "jpg"}')
    img.filepath_raw = small
    img.file_format = 'PNG' if small.endswith('png') else 'JPEG'
    bpy.context.scene.render.image_settings.quality = 88
    img.save()
    img = bpy.data.images.load(small)
    img.name = name
    if data:
        img.colorspace_settings.name = 'Non-Color'
    return img


def greyed(img):
    """the car wheel's brake calipers are a sports car's purple (and any other strong colour): dark grey, as on an
    everyday car's (the tyre and rim are grey already)"""
    import colorsys
    px = list(img.pixels)
    for i in range(0, len(px), 4):
        r, g, b = px[i], px[i + 1], px[i + 2]
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        if s > 0.25:
            grey = v * 0.38
            px[i] = px[i + 1] = px[i + 2] = grey
    img.pixels[:] = px


def material(name, d, tex):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    base, nrm, rough, metal = (os.path.join(d, t) for t in tex)

    def tnode(path, nm, data):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = image(path, f'{name}_{nm}', data)
        return n

    nt.links.new(tnode(base, 'base', False).outputs['Color'], bsdf.inputs['Base Color'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tnode(nrm, 'normal', True).outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(tnode(rough, 'rough', True).outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(tnode(metal, 'metal', True).outputs['Color'], bsdf.inputs['Metallic'])
    return m


def build(name):
    zname, fbx, tex, near, far, flip = WHEELS[name]
    d = os.path.join(WORK, name)
    if not os.path.isdir(d):
        zipfile.ZipFile(os.path.join(ROOT, 'assets', 'common_assets', zname)).extractall(d)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(d, fbx))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for e in [x for x in bpy.context.scene.objects if x != o]:
        bpy.data.objects.remove(e)
    me = o.data
    # the axle: the bounding box's thinnest side; turn it to x
    vs = [v.co.copy() for v in me.vertices]
    mn = Vector([min(v[i] for v in vs) for i in range(3)])
    mx = Vector([max(v[i] for v in vs) for i in range(3)])
    size = mx - mn
    ax = min(range(3), key=lambda i: size[i])
    # the hub: the middle of the round (the two other sides' box), and of the tyre across
    others = [i for i in range(3) if i != ax]
    centre = (mn + mx) / 2
    rad = max(size[others[0]], size[others[1]]) / 2
    # the tyre across: the vertices out at the rim
    outer = [v[ax] for v in vs if math.hypot(v[others[0]] - centre[others[0]], v[others[1]] - centre[others[1]]) > rad * 0.9]
    t0, t1 = min(outer), max(outer)
    centre[ax] = (t0 + t1) / 2
    tw = (t1 - t0) / rad
    # which way the wheel's face looks: the side with more of it beyond the tyre's middle, inside the rim
    inner = [v[ax] - centre[ax] for v in vs if math.hypot(v[others[0]] - centre[others[0]], v[others[1]] - centre[others[1]]) < rad * 0.55]
    face = 1 if sum(inner) / max(1, len(inner)) > 0 else -1
    if flip:
        face = -face
    # to x along the axle, centred, radius 1; the outer face toward +x
    rot = {0: Matrix.Identity(4), 1: Matrix.Rotation(-math.pi / 2, 4, 'Z'), 2: Matrix.Rotation(math.pi / 2, 4, 'Y')}[ax]
    m = rot @ Matrix.Scale(1 / rad, 4) @ Matrix.Translation(-centre)
    me.transform(m)
    probe = (rot @ Vector((1 if ax == 0 else 0, 1 if ax == 1 else 0, 1 if ax == 2 else 0)))
    if probe.x * face < 0:
        me.transform(Matrix.Rotation(math.pi, 4, 'Z'))
    me.update()
    o.name = 'near'
    mat = material(f'wheel_{name}', d, tex)
    me.materials.clear()
    me.materials.append(mat)
    # merge what is split for no reason, then cut it down
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    print(name, 'from', tris(o), 'triangles, axle', 'xyz'[ax], 'radius', round(rad, 3), 'tyre width', round(tw, 3), 'face', face)
    f = o.copy()
    f.data = o.data.copy()
    f.name = 'far'
    bpy.context.scene.collection.objects.link(f)
    for ob, want in ((o, near), (f, far)):
        dm = ob.modifiers.new('cut', 'DECIMATE')
        dm.ratio = min(1, want / tris(ob))
        dm.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier='cut')
        for p in ob.data.polygons:
            p.use_smooth = True
        print(' ', ob.name, tris(ob), 'triangles')
    for ob in (o, f):
        ob['tw'] = round(tw, 4)
    out = os.path.join(ROOT, 'public', 'models', f'wheel_{name}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_extras=True,
                              export_image_format='AUTO', export_yup=True, export_apply=True)
    print('  wrote', out, round(os.path.getsize(out) / 1e6, 2), 'MB')


for n in (argv[1:] or WHEELS):
    build(n)
