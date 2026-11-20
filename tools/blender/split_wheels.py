"""
Makes a vehicle's wheels separate, so the game can turn them (rolling, and steering the front ones).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/split_wheels.py -- NAME [NAME ...] [--preview DIR]

Works on the finished public/models/<name>.glb (after import_vehicle.py / build_vehicles.py) and writes it back. It can
be run again: the wheels are merged back in first.

Each wheel of WHEELS is a cylinder across the vehicle (hub, radius, width):
  'cut'      the faces inside it become their own mesh, `wheel_<label>`, its origin at the hub (models with real wheels)
  'replace'  the faces inside it are deleted and an empty `wheel_<label>` marks the hub: the game draws a modelled wheel
             there (the photo-built models, whose "wheels" are lumps of the body)
Every wheel node carries extras the game reads: r (m), w (m), steer (1: a front wheel that steers), make (1: modelled).

BARS: a two-wheeler's handlebar (with its mirrors and levers), the faces inside a box, cut into `wheel_bars` with its
origin at the steering pivot (r = 0: it turns with the steering, it does not roll), so the rider's hands and the bars
turn together.

Frame of the table: the game's, x to the vehicle's LEFT, y up, z FORWARD, metres (Blender: x, -z, y).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index('--') + 1:]
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
NAMES = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--preview')]


def four(x, zf, zr, r, w, mode='cut', rr=None, wr=None):
    """a car's four wheels: front at z = zf (steering), rear at zr; x the track's half"""
    return [('fl', x, zf, r, w, True, mode), ('fr', -x, zf, r, w, True, mode),
            ('rl', x, zr, rr or r, wr or w, False, mode), ('rr', -x, zr, rr or r, wr or w, False, mode)]


# how far out of the wheel's radius its faces may reach: a car's tyre bulges; a cycle's mudguard hugs the tyre
CUT = {'rickshaw': 1.012, 'cycle': 1.012, 'pulsar': 1.03}

# label, x, z, radius, width, steers, mode. Hubs from where the tyres touch the ground, radii measured on side renders.
WHEELS = {
    'swift': four(0.77, 1.175, -1.345, 0.32, 0.27),
    'ambassador': four(0.77, 1.45, -1.075, 0.32, 0.30),
    'bolero': four(0.78, 1.436, -1.04, 0.35, 0.28),
    'autorickshaw': [('f', 0.0, 1.094, 0.21, 0.16, True, 'cut'), ('rl', 0.61, -0.908, 0.21, 0.16, False, 'cut'),
                     ('rr', -0.61, -0.908, 0.21, 0.16, False, 'cut')],
    'rickshaw': [('f', 0.0, 0.884, 0.37, 0.09, True, 'cut'), ('rl', 0.50, -0.80, 0.37, 0.09, False, 'cut'),
                 ('rr', -0.50, -0.80, 0.37, 0.09, False, 'cut')],
    'cycle': [('f', 0.01, 0.54, 0.355, 0.07, True, 'cut'), ('r', 0.01, -0.527, 0.355, 0.07, False, 'cut')],
    'pulsar': [('f', 0.0, 0.70, 0.30, 0.12, True, 'cut'), ('r', 0.0, -0.635, 0.30, 0.12, False, 'cut')],
    # photo-built: modelled wheels in place of the lumps
    'truck': four(0.92, 1.66, -1.64, 0.47, 0.30, 'replace'),
    'tirri': [('f', 0.22, 1.13, 0.25, 0.14, True, 'replace'), ('rl', 0.40, -0.94, 0.25, 0.14, False, 'replace'),
              ('rr', -0.40, -0.94, 0.25, 0.14, False, 'replace')],
    'bus': four(0.98, 2.30, -2.35, 0.50, 0.30, 'replace'),
    'bus_green': four(0.98, 2.30, -2.35, 0.50, 0.30, 'replace'),
    'maruti': four(0.62, 0.98, -1.09, 0.26, 0.17, 'replace'),
    'maruti_red': four(0.62, 0.98, -1.09, 0.26, 0.17, 'replace'),
    'maruti_green': four(0.62, 0.98, -1.09, 0.26, 0.17, 'replace'),
}

# box (game frame: x half-width, y from..to, z from..to) and the steering pivot (x, y, z)
BARS = {
    'pulsar': ((0.62, 0.97, 1.55, 0.1, 0.5), (0.0, 1.0, 0.42)),
    'cycle': ((0.36, 0.985, 1.2, 0.14, 0.46), (0.0, 1.05, 0.39)),
    'rickshaw': ((0.3, 0.95, 1.14, 0.42, 0.72), (0.0, 1.0, 0.61)),
}


# models whose wheels are cut by pieces (the mesh's connected parts) rather than face by face: a piece mostly inside
# the wheel goes with it whole (all of the tyre, not 280 degrees of it with the rest left standing on the frame), and a
# piece from the axle out past the hub that does not go round (a fork blade, a stay) stays with the frame
WHOLE = {'cycle', 'rickshaw'}


def whole_pieces(bm, inside, hub, r, w):
    ids = {f.index for f in inside}
    seen, out = set(), []
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        piece, stack = [], [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            piece.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        n_in = sum(1 for f in piece if f.index in ids)
        if n_in == 0:
            continue
        vs = {v for f in piece for v in f.verts}
        rs = [math.hypot(v.co.y - hub.y, v.co.z - hub.z) for v in vs]
        xs = [abs(v.co.x - hub.x) for v in vs]
        angles = {int((math.atan2(v.co.z - hub.z, v.co.y - hub.y) + math.pi) / (2 * math.pi) * 36) for v in vs}
        if n_in * 2 < len(piece) or max(rs) > r * 1.15 or max(xs) > w / 2 + 0.03:
            out += [f for f in piece if f.index in ids]          # mostly outside: only its faces inside, as before
            continue
        if min(rs) < r * 0.09 and max(rs) > r * 0.4 and len(angles) * 10 < 120:
            continue                                             # from the axle outward, not round: the frame's
        out += piece
    return out


def B(x, y, z):
    """game frame -> Blender"""
    return Vector((x, -z, y))


def run(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(ROOT, 'public', 'models', name + '.glb')
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.data.objects):            # wheel markers of an earlier run
        if o.type == 'EMPTY' and o.name.startswith('wheel_'):
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    glass = [o for o in meshes if all(m and m.name == 'glass' for m in o.data.materials)]
    solid = [o for o in meshes if o not in glass]
    for o in meshes:                             # every mesh in the vehicle's frame, no parents
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT')
    for o in solid:
        o.select_set(True)
    bpy.context.view_layer.objects.active = solid[0]
    if len(solid) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    body.name = name
    body.data.name = name
    made = []
    for label, x, z, r, w, steer, mode in WHEELS[name]:
        bm = bmesh.new()
        bm.from_mesh(body.data)
        bm.faces.ensure_lookup_table()
        hub = B(x, r, z)                          # standing on the ground: the hub is as high as the wheel's radius
        # a face is the wheel's when all of it is inside the cylinder (a body panel reaching in is not)
        R2 = (r * CUT.get(name, 1.06)) ** 2
        if mode == 'cut':
            inside = [f for f in bm.faces if all(abs(v.co.x - hub.x) < w / 2 and (v.co.y - hub.y) ** 2 + (v.co.z - hub.z) ** 2 < R2 for v in f.verts)]
            if name in WHOLE:
                inside = whole_pieces(bm, inside, hub, r, w)
        else:       # the lump goes: every face centred in (a little more than) the wheel; the modelled wheel fills the place
            def gone(f):
                c = f.calc_center_median()
                return abs(c.x - hub.x) < w / 2 + 0.04 and (c.y - hub.y) ** 2 + (c.z - hub.z) ** 2 < (r * 1.1) ** 2
            inside = [f for f in bm.faces if gone(f)]
        wname = f'wheel_{label}'
        if mode == 'cut' and inside:
            keep = bmesh.new()
            # copy the wheel's faces into a mesh of their own (all the body's materials, same UVs)
            wb = bm.copy()
            wb.faces.ensure_lookup_table()
            ids = {f.index for f in inside}
            bmesh.ops.delete(wb, geom=[f for f in wb.faces if f.index not in ids], context='FACES')
            bmesh.ops.translate(wb, vec=-hub, verts=wb.verts)
            me = bpy.data.meshes.new(wname)
            wb.to_mesh(me)
            wb.free()
            keep.free()
            for m in body.data.materials:
                me.materials.append(m)
            ob = bpy.data.objects.new(wname, me)
            bpy.context.scene.collection.objects.link(ob)
            ob.location = hub
        else:
            ob = bpy.data.objects.new(wname, None)
            bpy.context.scene.collection.objects.link(ob)
            ob.location = hub
        bmesh.ops.delete(bm, geom=inside, context='FACES')
        bm.to_mesh(body.data)
        bm.free()
        ob['r'] = r
        ob['w'] = w
        ob['steer'] = 1 if steer else 0
        ob['make'] = 1 if mode == 'replace' or not inside else 0
        made.append(ob)
        print('WHEEL', name, label, mode, len(inside), 'faces', 'make' if ob['make'] else '')
    if name in BARS:
        (hw, y0, y1, z0, z1), piv = BARS[name]
        bm = bmesh.new()
        bm.from_mesh(body.data)
        bm.faces.ensure_lookup_table()
        # Blender: x, y = -z, z = y
        inside = [f for f in bm.faces if all(abs(v.co.x) < hw and y0 < v.co.z < y1 and z0 < -v.co.y < z1 for v in f.verts)]
        # the fork (and what it carries: a mudguard, a lamp): whole pieces of the mesh between the steering head and
        # the front wheel, that turn with the bars (the game turns the front wheel about the bars' pivot too)
        fw = next(((x, z, r) for label, x, z, r, w, steer, mode in WHEELS[name] if steer), None)
        if fw:
            ids = {f.index for f in inside}
            fx, fz, fr = fw
            seen = set(ids)
            for f0 in bm.faces:
                if f0.index in seen:
                    continue
                piece, stack = [], [f0]
                seen.add(f0.index)
                while stack:
                    f = stack.pop()
                    piece.append(f)
                    for e in f.edges:
                        for g in e.link_faces:
                            if g.index not in seen:
                                seen.add(g.index)
                                stack.append(g)
                # in front of the steering line (the pivot down to the hub), less a margin; not behind it (the engine)
                zline = lambda y: piv[2] + (fz - piv[2]) * (piv[1] - y) / (piv[1] - fr)
                if all(abs(v.co.x - fx) < 0.12 and zline(v.co.z) - 0.12 < -v.co.y < fz + fr * 1.15 and v.co.z < piv[1] + 0.02
                       for f in piece for v in f.verts):
                    inside += piece
        pv = B(*piv)
        wb = bm.copy()
        wb.faces.ensure_lookup_table()
        ids = {f.index for f in inside}
        bmesh.ops.delete(wb, geom=[f for f in wb.faces if f.index not in ids], context='FACES')
        bmesh.ops.translate(wb, vec=-pv, verts=wb.verts)
        me = bpy.data.meshes.new('wheel_bars')
        wb.to_mesh(me)
        wb.free()
        for m in body.data.materials:
            me.materials.append(m)
        ob = bpy.data.objects.new('wheel_bars', me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = pv
        bmesh.ops.delete(bm, geom=inside, context='FACES')
        bm.to_mesh(body.data)
        bm.free()
        ob['r'] = 0
        ob['w'] = 0
        ob['steer'] = 1
        ob['make'] = 0
        made.append(ob)
        print('WHEEL', name, 'bars', len(inside), 'faces')
    if PREVIEW:
        preview(name, body, made)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_animations=False,
                              export_extras=True, export_image_format='AUTO', export_materials='EXPORT')
    print('WHEEL exported', name, round(os.path.getsize(path) / 1e3), 'kB')


def preview(name, body, made):
    """side and three-quarter views; the wheels turned 35 degrees (an off-centre hub shows as a wobble), the markers as rings"""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.85, 0.85, 0.85)
    sc.render.resolution_x, sc.render.resolution_y = 900, 500
    rings = []
    for ob in made:
        if ob.name == 'wheel_bars':
            ob.rotation_euler.z = math.radians(30)
            continue
        ob.rotation_euler.x = math.radians(35)
        bpy.ops.mesh.primitive_torus_add(major_radius=ob['r'], minor_radius=0.012, location=ob.location, rotation=(0, math.pi / 2, 0))
        rings.append(bpy.context.object)
    L = max(abs(v.co.y) for v in body.data.vertices) + 0.4
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    sc.camera = cam
    for tag, loc, rot, s in (('side', (30, 0, 0.8), (math.pi / 2, 0, math.pi / 2), 2 * L),
                             ('q', (14, -16, 9), (math.radians(62), 0, math.radians(41)), 2 * L),
                             ('top', (0, 0, 12), (0, 0, math.pi), 2 * L)):
        cam.location, cam.rotation_euler, cam.data.ortho_scale = loc, rot, s
        sc.render.filepath = os.path.join(PREVIEW, f'wheels_{name}_{tag}.png')
        bpy.ops.render.render(write_still=True)
    for ob in made:
        ob.rotation_euler.x = ob.rotation_euler.z = 0
    for r in rings:
        bpy.data.objects.remove(r, do_unlink=True)
    bpy.data.objects.remove(cam, do_unlink=True)


for n in NAMES:
    run(n)
