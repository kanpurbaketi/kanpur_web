"""
Brings a downloaded vehicle model (FBX / OBJ / GLB / .blend, e.g. from Sketchfab) into the game's form:
public/models/<name>.glb, a few thousand triangles with ONE material, so a kind of vehicle is drawn in one call
(two with its glass).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/import_vehicle.py -- NAME [--preview DIR]

NAME is an entry of VEHICLES below (the source file, the real length, which way it faces, what its materials need).

What it does: imports, finds textures the file lost track of (by file name, anywhere in the model's folder), sets the
glass apart, cuts the mesh down to the triangle budget, scales it to the real length, stands it on the ground facing
forward, then bakes every material's colour and roughness (and normal detail, where asked) into one new texture atlas.
The game's vehicles stand on y = 0, centred, with the front toward +z (Blender: on z = 0, the front toward -y), in metres.
"""
import bpy, bmesh, math, os, re, sys
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, 'assets', 'common_assets')
argv = sys.argv[sys.argv.index('--') + 1:]
NAME = argv[0]
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

# src: the model file, under assets/common_assets.  length: metres, nose to tail.  yaw: degrees about the vertical to bring
# the front to face forward.  tris: triangle budget.  tex: atlas size.  normal: bake a normal map too.
# maps: {material name: {'base' | 'rough' | 'normal' | 'metal': texture file name}} for materials whose textures the file
# does not link.  glass: material names (regular expression) that are see-through.  drop: object names to leave out.
# colour: {material name (regular expression): (r, g, b)}: its colour (a base texture it has is multiplied by it).
# paint: material names (regular expression) that are the body paint: they become a material called 'paint', which the game
# tints car by car.
# cut: slice this share of the height off the bottom (a scan's ground).  align: turn the longest side to lie fore-and-aft.
# loose: drop loose scraps of fewer faces than this (a scan's debris).
# whole: False to never cut the joined mesh as a whole.  floor: parts of fewer triangles than this are not cut (300).
# roll: degrees about the fore-and-aft axis, to stand a leaning bike upright.
# weights: {object name (regular expression): n}: a bigger share of the triangle budget for what shows most.
VEHICLES = {
    'autorickshaw': dict(src='auto-rickshaw/source/Auto.fbx', length=2.65, tris=9000, tex=1024, normal=True,
                         maps={'.*': dict(base='Auto_textures.png', rough='auto_roughness.png', normal='auto_normals.png')}),
    # its "base colour" texture is only the shading in the creases: the colours are given here (the paint is white, so the
    # game can tint each car)
    'swift': dict(src='2024-suzuki-swift-hybrid-plus/inner/FINAL_MODEL_24.fbx', length=3.86, tris=16000, tex=2048, normal=True,
                  glass=r'glass|reflection', paint=r'Exterior(\.\d+)?|exterior-roof',
                  weights={r'^exterior|^roof|^base': 5, r'interior|plastic|grill|brand': 0.35},
                  colour={r'Exterior(\.\d+)?|exterior-roof': (0.86, 0.86, 0.86), 'rubber': (0.015, 0.015, 0.015), 'Ext_Plaastic': (0.03, 0.03, 0.035),
                          'chrome': (0.78, 0.78, 0.8), 'dark-chrome': (0.16, 0.16, 0.17), 'Red_Emis': (0.55, 0.02, 0.02), 'Lpas_Light': (0.92, 0.92, 0.86),
                          'lights-beam': (0.95, 0.95, 0.9), 'Chrome_Light': (0.7, 0.7, 0.72), 'chrome-blue': (0.05, 0.1, 0.4), 'mirrored-glass': (0.5, 0.52, 0.55)}),
    # its body is many thin separate panels: cut part by part only (a cut of the whole tears the panels away; a smaller
    # budget spikes the bumpers). The game draws it in full only near the player (tools/blender/make_lod.py)
    'bolero': dict(src='bolero-car-modified-with-alloy-wheel/source/Bolero Car.fbx', length=4.0, tris=40000, tex=4096, normal=True, whole=False),
    'ambassador': dict(src='hindustan-ambassador/source/ambassador.fbx', length=4.32, yaw=-90, tris=9000, tex=2048, normal=True, glass=r'blinn2',
                       maps={'blinn1': dict(base='Ambassador_Base_Color.png', rough='Ambassador_Roughness.png', normal='Ambassador_Normal_OpenGL.png', metal='Ambassador_Metallic.png')}),
    # a photo scan of a parked bike on a slab of mud: the slab is cut away, the bike turned to face forward and stood upright
    'enfield': dict(src='bike-royal-enfield/source/Bike_RE.fbx', length=2.15, tris=12000, tex=2048, cut=0.125, align=True, loose=400),
    'pulsar': dict(src='pulsar-135-ls-2/source/pulsar 135 ls 2.blend', length=2.0, yaw=180, tris=9000, tex=1024, glass=r'^glass'),
    'cycle': dict(src='cycle-bike-lowpoly/source/cycle.fbx', length=1.85, tris=4000, tex=1024, maps={'.*': dict(base='cycle.png')}),
    'truck': dict(src='tata-truck/source/tripo_refine_5aa22d95-f484-4906-90c2-1aa75a99fa38.glb', length=5.6, yaw=-90, tris=10000, tex=2048),
    'rickshaw': dict(src='rickshaw/source/Rickshaw.fbx', length=2.5, tris=14000, tex=2048, normal=True, yaw=-90,
                     weights={r'chain|folt|nail|bolt|spike|teeth': 0.25, r'hood|seat|wood|frame|guard': 3}),
}
V = VEHICLES[NAME]
V.update({k: (float(argv[argv.index('--' + k) + 1]) if k in ('yaw', 'length') else argv[argv.index('--' + k) + 1]) for k in ('yaw', 'length', 'up') if '--' + k in argv})
SRC = os.path.join(ASSETS, V['src'])
FOLDER = os.path.join(ASSETS, V['src'].split('/')[0])
TEX = V.get('tex', 2048)

# ---- import ---------------------------------------------------------------------------------------------------
ext = SRC.lower().rsplit('.', 1)[-1]
if ext == 'blend':
    bpy.ops.wm.open_mainfile(filepath=SRC)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == 'fbx':
        bpy.ops.import_scene.fbx(filepath=SRC)
    elif ext == 'obj':
        bpy.ops.wm.obj_import(filepath=SRC)
    else:
        bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
for o in list(bpy.data.objects):
    if o.type != 'MESH' or any(re.search(p, o.name, re.I) for p in V.get('drop', [])) or not len(o.data.polygons):
        bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects:                       # everything in one collection of this scene, visible
    for c in list(o.users_collection):
        c.objects.unlink(o)
    sc.collection.objects.link(o)
    o.hide_set(False); o.hide_viewport = False; o.hide_render = False
meshes = list(bpy.data.objects)
tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
total = sum(tri(o) for o in meshes)
print('VEH', NAME, len(meshes), 'objects,', total, 'triangles')

# ---- textures the file lost: by name, anywhere in the model's folder --------------------------------------------
files = {}
for d, _, fs in os.walk(FOLDER):
    for f in fs:
        if f.lower().rsplit('.', 1)[-1] in ('png', 'jpg', 'jpeg', 'tga'):
            files[re.sub(r'\W', '', f.rsplit('.', 1)[0].lower())] = os.path.join(d, f)
for img in bpy.data.images:
    if img.source == 'FILE' and not img.has_data and not os.path.exists(bpy.path.abspath(img.filepath)):
        key = re.sub(r'\W', '', os.path.basename(img.filepath or img.name).rsplit('.', 1)[0].lower())
        hit = files.get(key) or next((p for k, p in files.items() if key and (key in k or k in key)), None)
        if hit:
            img.filepath = hit
            img.reload()
            print('VEH found texture', os.path.basename(hit))


def load(file, colour):
    img = bpy.data.images.load(files[re.sub(r'\W', '', file.rsplit('.', 1)[0].lower())])
    if not colour:
        img.colorspace_settings.name = 'Non-Color'
    return img


# ---- materials: every one a Principled node tree, its textures on the mesh's own UV map ('src') ------------------
GLASS = V.get('glass', r'glass|window')
is_glass = lambda m: bool(re.search(GLASS, m.name, re.I))
for o in meshes:
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name='src')
    (me.uv_layers.active or me.uv_layers[0]).name = 'src'
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(next(l for l in me.uv_layers if l.name != 'src'))
    if not me.materials:
        me.materials.append(bpy.data.materials.get('plain') or bpy.data.materials.new('plain'))
for m in bpy.data.materials:
    flat = tuple(m.diffuse_color)
    if not m.use_nodes:
        m.use_nodes = True
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        nt.nodes.clear()
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(b.outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs[0])
        b.inputs['Base Color'].default_value = flat
        b.inputs['Roughness'].default_value = 0.55
    for pat, c in V.get('colour', {}).items():
        if not re.fullmatch(pat, m.name):
            continue
        links = list(b.inputs['Base Color'].links)
        if links:                                   # a texture is plugged in: keep it as shading over the colour
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs[0].default_value = 1
            mix.inputs[7].default_value = (*c, 1)
            nt.links.new(links[0].from_socket, mix.inputs[6])
            nt.links.remove(links[0])
            nt.links.new(mix.outputs[2], b.inputs['Base Color'])
        else:
            b.inputs['Base Color'].default_value = (*c, 1)
    for pat, mp in V.get('maps', {}).items():
        if not re.fullmatch(pat, m.name):
            continue
        for kind, sock in (('base', 'Base Color'), ('rough', 'Roughness'), ('metal', 'Metallic')):
            if kind in mp:
                t = nt.nodes.new('ShaderNodeTexImage')
                t.image = load(mp[kind], kind == 'base')
                for l in list(b.inputs[sock].links):
                    nt.links.remove(l)
                nt.links.new(t.outputs['Color'], b.inputs[sock])
        if 'normal' in mp:
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = load(mp['normal'], False)
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nt.links.new(t.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'src'
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE' and not n.inputs['Vector'].is_linked:
            nt.links.new(uv.outputs['UV'], n.inputs['Vector'])
        if n.type == 'NORMAL_MAP':
            n.uv_map = 'src'

# ---- fewer triangles, object by object (small parts are left alone), then one mesh ---------------------------------
weight = lambda o: next((w for pat, w in V.get('weights', {}).items() if re.search(pat, o.name, re.I)), 1)
ratio = min(1.0, V['tris'] / sum(tri(o) * weight(o) for o in meshes))
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    bpy.context.view_layer.objects.active = o
    if o.data.users > 1:
        o.data = o.data.copy()
    r = ratio * weight(o)
    floor = V.get('floor', 300)
    if r < 1 and tri(o) > floor:
        bm = bmesh.new()                        # weld the seams first, or the mesh tears apart as it is cut down
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5 * max(o.dimensions))
        bm.to_mesh(o.data)
        bm.free()
        d = o.modifiers.new('dec', 'DECIMATE')
        d.ratio = max(r, floor / tri(o))
        bpy.ops.object.modifier_apply(modifier='dec')
    for md in list(o.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=md.name)
        except RuntimeError:
            o.modifiers.remove(md)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
# lots of small parts (each kept at 300 triangles or more) can leave it well over the budget: cut the whole down to it
if V.get('whole', True) and tri(ob) > V['tris'] * 1.1:
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4 * max(ob.dimensions))
    bm.to_mesh(me)
    bm.free()
    d = ob.modifiers.new('dec', 'DECIMATE')
    d.ratio = V['tris'] / tri(ob)
    bpy.ops.object.modifier_apply(modifier='dec')
print('VEH cut to', tri(ob), 'triangles')

# ---- turn, scale to the real length, stand on the ground, centre ---------------------------------------------------
if V.get('up') == 'Y':
    me.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
if V.get('cut'):
    z0 = min(v.co.z for v in me.vertices); z1 = max(v.co.z for v in me.vertices)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z0 + (z1 - z0) * V['cut']), plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(me)
    bm.free()
if V.get('loose'):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    seen, kill = set(), []
    for f0 in bm.faces:
        if f0 in seen:
            continue
        isle, stack = [], [f0]
        seen.add(f0)
        while stack:
            f1 = stack.pop()
            isle.append(f1)
            for e in f1.edges:
                for f2 in e.link_faces:
                    if f2 not in seen:
                        seen.add(f2)
                        stack.append(f2)
        if len(isle) < V['loose']:
            kill += isle
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
if V.get('align'):
    import numpy as np
    xy = np.array([(v.co.x, v.co.y) for v in me.vertices])
    w, vec = np.linalg.eigh(np.cov((xy - xy.mean(axis=0)).T))
    ax = vec[:, 1]                               # the long axis
    me.transform(Matrix.Rotation(math.atan2(ax[0], ax[1]), 4, 'Z'))
me.transform(Matrix.Rotation(math.radians(V.get('yaw', 0)), 4, 'Z'))
if V.get('roll'):
    me.transform(Matrix.Rotation(math.radians(V['roll']), 4, 'Y'))
lo = Vector((min(v.co[i] for v in me.vertices) for i in range(3)))
hi = Vector((max(v.co[i] for v in me.vertices) for i in range(3)))
k = V['length'] / (hi.y - lo.y)
me.transform(Matrix.Translation((-(lo.x + hi.x) / 2 * k, -(lo.y + hi.y) / 2 * k, -lo.z * k)) @ Matrix.Scale(k, 4))
print('VEH size in the game (width, length, height)', [round((hi[i] - lo[i]) * k, 2) for i in range(3)])
bpy.ops.object.shade_auto_smooth(angle=math.radians(38))       # smooth panels, crisp edges
for md in list(ob.modifiers):
    bpy.ops.object.modifier_apply(modifier=md.name)

# ---- the glass apart: its own object and a plain see-through material ----------------------------------------------
glass_ob = None
gl = [i for i, m in enumerate(me.materials) if m and is_glass(m)]
if gl and len(gl) < len(me.materials):
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in me.polygons:
        p.select = p.material_index in gl
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    glass_ob = next(o for o in bpy.context.selected_objects if o is not ob)
    gm = bpy.data.materials.new('glass')
    gm.use_nodes = True
    gb = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    gb.inputs['Base Color'].default_value = (0.05, 0.07, 0.09, 1)
    gb.inputs['Alpha'].default_value = 0.42
    gb.inputs['Roughness'].default_value = 0.06
    gm.blend_method = 'BLEND'
    glass_ob.data.materials.clear()
    glass_ob.data.materials.append(gm)
    glass_ob.name = 'glass'
    while glass_ob.data.uv_layers:
        glass_ob.data.uv_layers.remove(glass_ob.data.uv_layers[0])
    print('VEH glass', tri(glass_ob), 'triangles')
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob

# ---- bake every material into one atlas ------------------------------------------------------------------------------
atlas = me.uv_layers.new(name='atlas')
me.uv_layers.active = atlas
atlas.active_render = True
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 4
sc.render.bake.margin = 6
sc.render.bake.use_selected_to_active = False
want_normal = V.get('normal', False)
mats = [m for m in me.materials if m]
paint_slots = {i for i, m in enumerate(me.materials) if m and V.get('paint') and re.fullmatch(V['paint'], m.name)}
paint_faces = [p.index for p in me.polygons if p.material_index in paint_slots]
metal = {}
for m in mats:
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    metal[m.name] = b.inputs['Metallic'].default_value
    for l in list(b.inputs['Metallic'].links):       # a metal has no diffuse colour to bake: bake it as a plain surface
        m.node_tree.links.remove(l)
    b.inputs['Metallic'].default_value = 0


def bake(kind, colour, size):
    img = bpy.data.images.new(f'{NAME}_{kind}', size, size, alpha=False)
    if not colour:
        img.colorspace_settings.name = 'Non-Color'
    for m in mats:
        nt = m.node_tree
        t = nt.nodes.get('bake') or nt.nodes.new('ShaderNodeTexImage')
        t.name = 'bake'
        t.image = img
        for n in nt.nodes:
            n.select = False
        t.select = True
        nt.nodes.active = t
    if kind == 'base':
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
    elif kind == 'rough':
        bpy.ops.object.bake(type='ROUGHNESS')
    else:
        bpy.ops.object.bake(type='NORMAL')
    path = os.path.join(bpy.app.tempdir, f'{NAME}_{kind}.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    out = bpy.data.images.load(path)
    if not colour:
        out.colorspace_settings.name = 'Non-Color'
    out.pack()
    print('VEH baked', kind, size)
    return out


base = bake('base', True, TEX)
rough = bake('rough', False, TEX // 2)
normal = bake('normal', False, TEX // 2) if want_normal else None
# how much of the vehicle is metal, by area: one factor for the whole material (chrome trim is a small share of a car)
area = {i: 0.0 for i in range(len(me.materials))}
for p in me.polygons:
    area[p.material_index] += p.area
share = sum(area[i] * metal.get(m.name, 0) for i, m in enumerate(me.materials) if m) / max(sum(area.values()), 1e-9)

body = bpy.data.materials.new(NAME)
body.use_nodes = True
nt = body.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
t = nt.nodes.new('ShaderNodeTexImage'); t.image = base
nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
t = nt.nodes.new('ShaderNodeTexImage'); t.image = rough
nt.links.new(t.outputs['Color'], bsdf.inputs['Roughness'])
if normal:
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = normal
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(t.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Metallic'].default_value = min(0.35, share)
me.materials.clear()
me.materials.append(body)
if paint_faces:
    pm = body.copy()
    pm.name = 'paint'
    me.materials.append(pm)
    for i in paint_faces:
        me.polygons[i].material_index = 1
    print('VEH paint', len(paint_faces), 'faces')
me.uv_layers.remove(me.uv_layers['src'])
ob.name = NAME

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.8, 0.8, 0.8)
    sc.render.resolution_x, sc.render.resolution_y = 640, 480
    sc.render.resolution_percentage = 100
    sc.render.use_border = False
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o, do_unlink=True)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = V['length'] * 1.5
    sc.camera = cam
    h = (hi.z - lo.z) * k / 2
    # front = seen from ahead of it; left = from its left side; top; and a three-quarter view
    for tag, loc, rot in (('front', (0, -30, h), (math.pi / 2, 0, 0)), ('left', (30, 0, h), (math.pi / 2, 0, math.pi / 2)),
                          ('top', (0, 0, 30), (0, 0, 0)), ('q', (18, -21, 12 + h), (math.radians(65), 0, math.radians(40)))):
        cam.location, cam.rotation_euler = loc, rot
        sc.render.filepath = os.path.join(PREVIEW, f'veh_{NAME}_{tag}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)

for o in list(bpy.data.objects):
    if o is not ob and o is not glass_ob:
        bpy.data.objects.remove(o, do_unlink=True)
path = os.path.join(ROOT, 'public', 'models', NAME + '.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_animations=False,
                          export_image_format='JPEG', export_jpeg_quality=86, export_materials='EXPORT')
print('VEH exported', os.path.relpath(path, ROOT), round(os.path.getsize(path) / 1e3), 'kB')
