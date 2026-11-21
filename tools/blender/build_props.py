"""
Stage props from downloaded models (assets/common_assets) into the game's form:

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_props.py -- [--preview DIR] [--only sofas|mic|carousel]

public/models/sofas.glb   from sofa_set.glb (a SketchUp living-room set, in inches): the three-seater, the two-seater and
                          one armchair, each its own object ('sofa3', 'sofa2', 'chair'), facing forward, standing on the
                          ground, centred, in metres. The side tables, lamps and the glass table are left out.
public/models/mic.glb     from boom-mic.zip (an FBX mic on a boom stand, 2K PBR maps): one object 'mic', 1.6 m tall,
                          its base at the origin, the boom reaching forward; the textures cut to 512.
public/models/carousel.glb from wip-cgma-merry-go-round-carousel.zip (an FBX carousel standing in a little garden
                          diorama, 132k triangles, 2K maps): the garden, its fence, bollards and flowers left out; what
                          is left in three parts, so the game can turn it and move the horses:
                            'base'        the fixed plinth and its steps
                            'spin'        what turns: the platform, the poles, the canopy and roof, the bulbs
                            'horse_white', 'horse_black'   one horse of each colour at the origin (their own frame), and
                            'slot_<colour>_<i>'            an empty per horse on the ride: where that horse stands
                          The ground at y = 0, the axis at the origin. Maps cut to 1024 (canopy) and 512 (horses), JPEG.

Both are cut down to a triangle budget. The game's props face +z (Blender: -y) and stand on y = 0.
"""
import bpy, bmesh, math, os, sys, zipfile, tempfile
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, 'assets', 'common_assets')
OUT = os.path.join(ROOT, 'public', 'models')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
ONLY = argv[argv.index('--only') + 1] if '--only' in argv else None
def want(name): return ONLY is None or ONLY == name

SOFA_TRIS = {'sofa3': 1600, 'sofa2': 1200, 'chair': 900}
MIC_TRIS = 1400
CAROUSEL_TRIS = {'spin': 9000, 'base': 400, 'horse': 1100}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def bake_transforms():
    for o in bpy.context.scene.objects: o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = meshes()[0]
    # parents (the importers' empties) carry the units and the axis turn: keep them in the mesh
    for o in meshes():
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH': bpy.data.objects.remove(o)


def box(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def cut(o, budget):
    """planar dissolve first (SketchUp meshes are full of coplanar triangles), then collapse to the budget"""
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.scene.objects: x.select_set(x == o)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.dissolve_limited(angle_limit=math.radians(2), delimit={'MATERIAL', 'UV'})
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode='OBJECT')
    n = tris(o)
    if n > budget:
        m = o.modifiers.new('cut', 'DECIMATE')
        m.ratio = budget / n
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='cut')
    return tris(o)


def ground_centre(o):
    """origin at the middle of its footprint, on the ground"""
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    mn = Vector([min(v[i] for v in vs) for i in range(3)]); mx = Vector([max(v[i] for v in vs) for i in range(3)])
    o.data.transform(Matrix.Translation(Vector(((mn.x + mx.x) / -2, (mn.y + mx.y) / -2, -mn.z))))
    o.matrix_world = Matrix.Identity(4)
    return mx - mn


def export(objs, name, images='AUTO'):
    for x in bpy.context.scene.objects: x.select_set(x in objs)
    path = os.path.join(OUT, name)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_animations=False, export_image_format=images, export_jpeg_quality=85)
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')


def preview(objs, name):
    if not PREVIEW: return
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = 900; sc.render.resolution_y = 500
    for x in sc.objects: x.hide_render = x.type == 'MESH' and x not in objs
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    mn = Vector([min(v[i] for v in pts) for i in range(3)]); mx = Vector([max(v[i] for v in pts) for i in range(3)])
    c, size = (mn + mx) / 2, (mx - mn).length
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
    d = Vector((0.45, -1, 0.45)).normalized()          # from the front (-y), a little to the side and above
    cam.location = c + d * size * 2.0
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = os.path.join(PREVIEW, name + '.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


# ---- the sofas -------------------------------------------------------------------------------------------------------
def build_sofas():
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, 'sofa_set.glb'))
    bake_transforms()
    for o in meshes():                                       # inches to metres
        o.data.transform(Matrix.Scale(0.0254, 4))
    # one mesh; its faces sorted into pieces of furniture by footprint: every face marks the 1 cm cells under it, and the
    # cells that touch make one piece (a lamp stands on its table: the two are one piece)
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.join()
    whole = bpy.context.view_layer.objects.active
    me = whole.data
    vs = [v.co.copy() for v in me.vertices]
    G = 0.01
    x0 = min(v.x for v in vs); y0 = min(v.y for v in vs)
    NX = int((max(v.x for v in vs) - x0) / G) + 2; NY = int((max(v.y for v in vs) - y0) / G) + 2
    cell = bytearray(NX * NY)
    for p in me.polygons:
        px = [vs[i].x for i in p.vertices]; py = [vs[i].y for i in p.vertices]
        for i in range(int((min(px) - x0) / G), int((max(px) - x0) / G) + 1):
            for j in range(int((min(py) - y0) / G), int((max(py) - y0) / G) + 1):
                cell[i * NY + j] = 1
    label = [0] * (NX * NY)
    n = 0
    for k in range(NX * NY):
        if not cell[k] or label[k]: continue
        n += 1; stack = [k]; label[k] = n
        while stack:
            c = stack.pop(); i, j = divmod(c, NY)
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ii, jj = i + di, j + dj
                if 0 <= ii < NX and 0 <= jj < NY:
                    q = ii * NY + jj
                    if cell[q] and not label[q]: label[q] = n; stack.append(q)
    face_piece = []
    for p in me.polygons:
        c = p.center
        face_piece.append(label[int((c.x - x0) / G) * NY + int((c.y - y0) / G)])
    pieces = []
    for lab in sorted(set(face_piece)):
        fs = [i for i, l in enumerate(face_piece) if l == lab]
        pv = [vs[v] for i in fs for v in me.polygons[i].vertices]
        mn = Vector([min(v[k] for v in pv) for k in range(3)]); mx = Vector([max(v[k] for v in pv) for k in range(3)])
        mats = {me.materials[me.polygons[i].material_index].name for i in fs if me.materials[me.polygons[i].material_index]}
        pieces.append(dict(lab=lab, faces=set(fs), mn=mn, mx=mx, mats=mats, size=mx - mn, c=(mn + mx) / 2))
        print('piece', len(fs), [round(v, 2) for v in (mx - mn)], sorted(mats))


    def take(p, name):
        """a copy of the mesh with only this piece's faces"""
        o = whole.copy(); o.data = whole.data.copy(); o.name = o.data.name = name
        bpy.context.scene.collection.objects.link(o)
        bm = bmesh.new(); bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in p['faces']], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(o.data); bm.free()
        return o


    table = next(p for p in pieces if any('Glass' in m for m in p['mats']) and p['size'].z < 0.6)
    seats = sorted([p for p in pieces if any('Carpet' in m for m in p['mats'])], key=lambda p: -max(p['size'].x, p['size'].y))
    keep = {'sofa3': seats[0], 'sofa2': seats[1], 'chair': seats[2]}
    out = []
    for name, p in keep.items():
        o = take(p, name)
        # turn it to face forward (-y): it faces the coffee table
        d = table['c'] - p['c']
        a = math.atan2(d.x, -d.y)                            # angle of its facing from -y
        a = round(a / (math.pi / 2)) * (math.pi / 2)
        o.data.transform(Matrix.Translation(p['c']) @ Matrix.Rotation(-a, 4, 'Z') @ Matrix.Translation(-p['c']))
        n0 = tris(o)
        n = cut(o, SOFA_TRIS[name])
        s = ground_centre(o)
        print(name, 'tris', n0, '->', n, 'size', [round(v, 2) for v in s])
        out.append(o)
    for x in meshes():
        if x not in out: bpy.data.objects.remove(x)
    export(out, 'sofas.glb')
    for i, o in enumerate(out): o.location.x = i * 2.6
    preview(out, 'sofas')


# ---- the mic -----------------------------------------------------------------------------------------------------------
def build_mic():
    reset()
    tmp = tempfile.mkdtemp()
    zipfile.ZipFile(os.path.join(ASSETS, 'boom-mic.zip')).extractall(tmp)
    bpy.ops.import_scene.fbx(filepath=os.path.join(tmp, 'source', 'BoomMic_Joined.fbx'))
    bake_transforms()
    o = meshes()[0]
    o.name = o.data.name = 'mic'
    n0 = tris(o)
    size = ground_centre(o)
    o.data.transform(Matrix.Scale(1.6 / size.z, 4))
    size = ground_centre(o)
    # the stand's foot at the origin (the boom overhangs): centre on the lowest vertices
    foot = [v.co for v in o.data.vertices if v.co.z < 0.05]
    fx, fy = sum(v.x for v in foot) / len(foot), sum(v.y for v in foot) / len(foot)
    o.data.transform(Matrix.Translation(Vector((-fx, -fy, 0))))
    # the boom reaches forward (-y): the head is the far end from the foot at the top
    top = [v.co for v in o.data.vertices if v.co.z > size.z * 0.6]
    hx, hy = sum(v.x for v in top) / len(top), sum(v.y for v in top) / len(top)
    o.data.transform(Matrix.Rotation(-math.atan2(hx, -hy), 4, 'Z'))
    # its maps, linked by name (the FBX loses them) and cut to 512
    TEX = os.path.join(tmp, 'textures')
    mat = bpy.data.materials.new('mic'); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    def img(file, colour=True):
        im = bpy.data.images.load(os.path.join(TEX, file)); im.scale(512, 512)
        im.filepath_raw = os.path.join(tmp, 'small_' + file); im.file_format = 'PNG'; im.save()     # the exporter writes the file's own bytes
        if not colour: im.colorspace_settings.name = 'Non-Color'
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
        return t
    nt.links.new(img('main_material_Base_Color.png').outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(img('main_material_Roughness.png', False).outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(img('main_material_Metallic.png', False).outputs['Color'], bsdf.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(img('main_material_Normal_OpenGL.png', False).outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    o.data.materials.clear(); o.data.materials.append(mat)
    n = cut(o, MIC_TRIS)
    print('mic tris', n0, '->', n, 'size', [round(v, 2) for v in box(o)[1] - box(o)[0]])
    export([o], 'mic.glb')
    preview([o], 'mic')


# ---- the carousel ------------------------------------------------------------------------------------------------------
def build_carousel():
    reset()
    tmp = tempfile.mkdtemp()
    zipfile.ZipFile(os.path.join(ASSETS, 'wip-cgma-merry-go-round-carousel.zip')).extractall(tmp)
    bpy.ops.import_scene.fbx(filepath=os.path.join(tmp, 'source', 'skethcf_test.fbx'))
    sc = bpy.context.scene
    sc.frame_set(1)                                      # its take moves the horses round: the first frame has them on their poles
    bpy.context.view_layer.update()

    def under(o, name):
        for p in iter(lambda: o.parent, None):
            if p.name == name: return True
            o = p
        return False
    # the diorama: the garden floor, its fence, bollards and lamps (group5), the grass and flowers, a stray lamp
    for o in [o for o in sc.objects if o.type == 'MESH' and (under(o, 'group5') or o.name.startswith(('grass_', 'extracted_'))
                                                            or o.name == 'pCylinder118')]:
        bpy.data.objects.remove(o)
    G = Matrix.Translation(Vector((0, 0, -0.71)))        # its plinth stands at 0.71: on the ground
    kind = lambda o: o.data.materials[0].name if o.data.materials and o.data.materials[0] else ''
    world = {o.name: G @ o.matrix_world for o in sc.objects if o.type == 'MESH'}
    base_names = {o.name for o in sc.objects if o.type == 'MESH' and under(o, 'Static_base')}
    for o in sc.objects: o.animation_data_clear()
    for o in meshes():
        o.parent = None
        o.matrix_world = world[o.name]

    # the horses: one of each colour kept (they are the same model) and a slot per horse
    horses = [o for o in meshes() if kind(o) in ('horse_white', 'Horse_black')]
    tmpl = {}
    slots = []
    for i, o in enumerate(sorted(horses, key=lambda o: o.name)):
        col = 'white' if kind(o) == 'horse_white' else 'black'
        e = bpy.data.objects.new(f'slot_{col}_{i}', None); sc.collection.objects.link(e)
        e.matrix_world = o.matrix_world.copy()
        slots.append(e)
        if col not in tmpl:
            tmpl[col] = o
            o.name = o.data.name = 'horse_' + col
            o.matrix_world = Matrix.Identity(4)
        else:
            bpy.data.objects.remove(o)
    for o in [o for o in sc.objects if o.type not in ('MESH',) and not o.name.startswith('slot_')]:
        bpy.data.objects.remove(o)

    def join(objs, name):
        for x in sc.objects: x.select_set(x in objs)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = o.data.name = name
        return o
    parts = [o for o in meshes() if o not in tmpl.values()]
    fixed, turning = [o for o in parts if o.name in base_names], [o for o in parts if o.name not in base_names]
    base = join(fixed, 'base')
    spin = join(turning, 'spin')

    # its maps, linked by name (the FBX's paths point at the author's disk), cut down, JPEG on export
    TEX = os.path.join(tmp, 'textures')
    def material(name, colour, size, emission=None):
        mat = bpy.data.materials.new(name); mat.use_nodes = True
        nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
        def img(file):
            im = bpy.data.images.load(os.path.join(TEX, file)); im.scale(size, size)
            im.filepath_raw = os.path.join(tmp, 'small_' + file); im.file_format = 'PNG'; im.save()
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
            return t
        nt.links.new(img(colour).outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.55
        bsdf.inputs['Metallic'].default_value = 0.0
        if emission:
            nt.links.new(img(emission).outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 1.0
        return mat
    tent = material('carousel', 'Tent_Basecolor.png', 1024, 'Tent_emission.png')
    for o in (base, spin):
        o.data.materials.clear(); o.data.materials.append(tent)
    for col, o in tmpl.items():
        o.data.materials.clear()
        o.data.materials.append(material('horse_' + col, 'Horse_texture.png' if col == 'white' else 'Horse_texture_black.png', 512))

    for o, budget in ((spin, CAROUSEL_TRIS['spin']), (base, CAROUSEL_TRIS['base']), *((h, CAROUSEL_TRIS['horse']) for h in tmpl.values())):
        n0 = tris(o)
        print(o.name, 'tris', n0, '->', cut(o, budget), 'box', [[round(v, 2) for v in b] for b in box(o)])
    for e in slots:
        print(e.name, [round(v, 2) for v in e.matrix_world.translation], round(e.matrix_world.to_euler().z, 2))
    export([base, spin, *tmpl.values(), *slots], 'carousel.glb', images='JPEG')
    if PREVIEW:                                          # the horses put on their slots, for the picture
        for e in slots:
            h = tmpl['white' if '_white_' in e.name else 'black'].copy(); sc.collection.objects.link(h)
            h.matrix_world = e.matrix_world.copy()
        preview([o for o in meshes()], 'carousel')


# ---- the hand mic --------------------------------------------------------------------------------------------------------
def build_handmic():
    reset()
    tmp = tempfile.mkdtemp()
    zipfile.ZipFile(os.path.join(ASSETS, 'microphone.zip')).extractall(tmp)
    bpy.ops.import_scene.fbx(filepath=os.path.join(tmp, 'source', 'Microphone.fbx.fbx'))
    bake_transforms()
    for x in meshes(): x.select_set(True)
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = 'handmic'
    if o.data.shape_keys: o.shape_key_clear()           # its basis key would keep the old coordinates in the export
    # it lies on its side, along a diagonal: the grille ('Weave') at one end, the plug's pins at the other. Stand it up, the
    # plug end at the origin, the grille up (+z), 19 cm long
    vs = [v.co.copy() for v in o.data.vertices]
    c = sum(vs, Vector()) / len(vs)
    # the axis: the line through the farthest pair of ends, found from the two extreme projections on the diagonal
    d0 = Vector((1, -1, 0)).normalized()
    hi = max(vs, key=lambda v: v.dot(d0)); lo = min(vs, key=lambda v: v.dot(d0))
    axis = (hi - lo); axis.z = 0; axis.normalize()                   # toward the grille (Weave sits at +x, -y)
    rotq = axis.rotation_difference(Vector((0, 0, 1)))
    o.data.transform(Matrix.Translation(-c))
    o.data.transform(rotq.to_matrix().to_4x4())
    vs = [v.co for v in o.data.vertices]
    zlo, zhi = min(v.z for v in vs), max(v.z for v in vs)
    xs = sum(v.x for v in vs) / len(vs); ys = sum(v.y for v in vs) / len(vs)
    o.data.transform(Matrix.Scale(0.19 / (zhi - zlo), 4) @ Matrix.Translation(Vector((-xs, -ys, -zlo))))
    # the grille (the wide end) on top: turn it over if the bottom is the wider
    vs = [v.co for v in o.data.vertices]
    wide = lambda sel: max((v.x * v.x + v.y * v.y) ** 0.5 for v in sel)
    if wide([v for v in vs if v.z < 0.03]) > wide([v for v in vs if v.z > 0.16]):
        o.data.transform(Matrix.Translation(Vector((0, 0, 0.19))) @ Matrix.Rotation(math.pi, 4, 'X'))
    TEX = os.path.join(tmp, 'textures')
    mat = bpy.data.materials.new('handmic'); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    def img(file, colour=True):
        im = bpy.data.images.load(os.path.join(TEX, file)); im.scale(256, 256)
        im.filepath_raw = os.path.join(tmp, 'small_' + file); im.file_format = 'PNG'; im.save()
        if not colour: im.colorspace_settings.name = 'Non-Color'
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
        return t
    P_ = 'Microphone_low02_Microphone_'
    nt.links.new(img(P_ + 'BaseColor.png').outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(img(P_ + 'Roughness.png', False).outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(img(P_ + 'Metallic.png', False).outputs['Color'], bsdf.inputs['Metallic'])
    o.data.materials.clear(); o.data.materials.append(mat)
    s = box(o)
    print('handmic tris', tris(o), 'size', [round(v, 3) for v in s[1] - s[0]])
    export([o], 'handmic.glb', images='JPEG')
    preview([o], 'handmic')


# ---- grass ---------------------------------------------------------------------------------------------------------------
GRASS_KEEP = {'tuft': 0.32, 'sprig': 0.45}       # the share of its blades each keeps


def build_grass():
    """grass.zip (Grass.fbx: three clumps of blade cards, each blade's picture and its cut-out separate): 'tuft', a knee-low
    clump (Grass1), and 'sprig', a little dry one (GrassAutumn3), each on its own origin on the ground, thinned out; the
    lawn piece (70k faces) is left out. Each blade map gets its cut-out as alpha (PNG)."""
    reset()
    tmp = tempfile.mkdtemp()
    zipfile.ZipFile(os.path.join(ASSETS, 'grass.zip')).extractall(tmp)
    bpy.ops.import_scene.fbx(filepath=os.path.join(tmp, 'source', 'Grass.fbx'))
    bake_transforms()
    names = {'Grass1': 'tuft', 'GrassAutumn3': 'sprig'}
    out = []
    import random
    rng = random.Random(7)
    for o in list(meshes()):
        if o.name not in names:
            bpy.data.objects.remove(o); continue
        name = names[o.name]
        o.name = o.data.name = name
        n0 = tris(o)
        # thin it: drop whole blades (the mesh's loose parts) at random
        bm = bmesh.new(); bm.from_mesh(o.data)
        seen, drop = set(), []
        for f in bm.faces:
            if f in seen: continue
            part, stack = [], [f]
            seen.add(f)
            while stack:
                g = stack.pop(); part.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h not in seen: seen.add(h); stack.append(h)
            if rng.random() > GRASS_KEEP[name]: drop += part
        bmesh.ops.delete(bm, geom=drop, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(o.data); bm.free()
        size = ground_centre(o)
        print(name, 'tris', n0, '->', tris(o), 'size', [round(v, 2) for v in size])
        out.append(o)
    TEX = os.path.join(tmp, 'textures')
    done = {}
    for o in out:
        for i, m in enumerate(o.data.materials):
            base = m.name.split('_')[0]                          # Grass2_Mat3 -> Grass2
            if base not in done:
                col = bpy.data.images.load(os.path.join(TEX, base + '.png'))
                al = bpy.data.images.load(os.path.join(TEX, base + '_Opacity.png'))
                w, h = col.size[0] // 4, col.size[1] // 4            # tall strips of blades (~280 x 4000): a quarter is plenty
                col.scale(w, h); al.scale(w, h)
                cp, ap = list(col.pixels), list(al.pixels)
                px = [0.0] * (w * h * 4)
                for k in range(w * h):
                    px[k * 4:k * 4 + 3] = cp[k * 4:k * 4 + 3]
                    px[k * 4 + 3] = ap[k * 4]
                im = bpy.data.images.new('grass_' + base, w, h, alpha=True)
                im.pixels = px
                im.filepath_raw = os.path.join(tmp, base + '_rgba.png'); im.file_format = 'PNG'; im.save()
                mat = bpy.data.materials.new('grass_' + base); mat.use_nodes = True
                nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
                t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
                nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
                nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
                bsdf.inputs['Roughness'].default_value = 0.85
                bsdf.inputs['Metallic'].default_value = 0.0
                done[base] = mat
            o.data.materials[i] = done[base]
    export(out, 'grass.glb', images='AUTO')
    for i, o in enumerate(out): o.location.x = i * 0.9
    preview(out, 'grass')


if want('sofas'): build_sofas()
if want('mic'): build_mic()
if want('carousel'): build_carousel()
if want('handmic'): build_handmic()
if want('grass'): build_grass()
