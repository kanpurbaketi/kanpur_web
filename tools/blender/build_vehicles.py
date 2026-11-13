"""
Detailed, PBR-material street vehicles built from code (no downloaded assets).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_vehicles.py -- [maruti] [--preview DIR]

Output: public/models/<name>.glb. Unlike build_models.py (flat vertex colours) these keep real materials:
  paint        white, metallic clear-coat: the game tints it per car (material.color)
  glass        see-through tinted glass; glass_dark behind the windscreen pillars
  lamp_head / lamp_tail / lamp_amber   lens materials the game can make glow at night (emissive)
  rubber, steel, chrome, plastic, interior, seat   the rest
Model space (Blender): metres, Z up, front toward -Y, driver on the right (-X). The glTF export turns that into +Z forward, Y up.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'models')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
WANT = [a for a in argv if not a.startswith('--') and a != PREVIEW]


def lin(h):
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


MATS = {}


def material(name, color, metal=0.0, rough=0.5, alpha=1.0, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(color), alpha)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    b.inputs['Alpha'].default_value = alpha
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(emit), 1)
        b.inputs['Emission Strength'].default_value = 0.0
    if alpha < 1:
        m.surface_render_method = 'BLENDED'
    m.use_backface_culling = False
    MATS[name] = m
    return m


def make_materials():
    material('paint', '#ffffff', 0.55, 0.32)
    material('glass', '#8fa6b4', 0.0, 0.05, 0.28)
    material('rubber', '#141414', 0.0, 0.92)
    material('steel', '#9aa0a6', 0.85, 0.42)
    material('chrome', '#d8dce0', 1.0, 0.12)
    material('plastic', '#1d1d20', 0.0, 0.6)
    material('trim', '#2a2b2e', 0.0, 0.75)
    material('interior', '#3a3a3e', 0.0, 0.85)
    material('seat', '#4a4f5a', 0.0, 0.9)
    material('lamp_head', '#f4f1e6', 0.2, 0.08, 1.0, emit='#fff1c8')
    material('lamp_tail', '#9a1010', 0.1, 0.12, 1.0, emit='#ff2a1a')
    material('lamp_amber', '#d9801a', 0.1, 0.12, 1.0, emit='#ffa030')
    material('plate', '#e8e6dc', 0.0, 0.5)
    material('dark', '#050505', 0.0, 0.95)


# ---------------------------------------------------------------------------------------------
class Car:
    """Collects bmeshes per material, then turns them into one object per material."""

    def __init__(self):
        self.bms = {}

    def bm(self, mat):
        if mat not in self.bms:
            self.bms[mat] = bmesh.new()
        return self.bms[mat]

    def add(self, mat, tmp, xf=None):
        """Merge a temporary bmesh into the material's bmesh."""
        bm = self.bm(mat)
        if xf is not None:
            bmesh.ops.transform(tmp, matrix=xf, verts=tmp.verts)
        me = bpy.data.meshes.new('t')
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def box(self, mat, x0, x1, y0, y1, z0, z1, bevel=0.0, seg=2):
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1)
        bmesh.ops.scale(t, vec=(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), verts=t.verts)
        bmesh.ops.translate(t, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=t.verts)
        if bevel:
            bmesh.ops.bevel(t, geom=t.verts[:] + t.edges[:] + t.faces[:], offset=bevel, segments=seg, affect='EDGES')
        self.add(mat, t)

    def cyl(self, mat, c, r, depth, axis='X', segs=16, r2=None):
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
        rot = {'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X'), 'Z': Matrix.Identity(4)}[axis]
        self.add(mat, t, Matrix.Translation(c) @ rot)

    def rod(self, mat, a, b, r, segs=8):
        a, b = Vector(a), Vector(b)
        d = b - a
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=d.length)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        self.add(mat, t, Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4())

    def lathe(self, mat, prof, center, segs=36, axis='X'):
        """Surface of revolution: prof = [(radius, along-axis), ...] spun about `axis` through `center`."""
        t = bmesh.new()
        vs = [t.verts.new((p[1], p[0], 0)) for p in prof]   # along-axis = x, radius = y
        es = [t.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
        bmesh.ops.spin(t, geom=vs + es, angle=math.tau, steps=segs, axis=(1, 0, 0), cent=(0, 0, 0))
        bmesh.ops.remove_doubles(t, verts=t.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(t, faces=t.faces)
        rot = {'X': Matrix.Identity(4), 'Y': Matrix.Rotation(math.pi / 2, 4, 'Z'), 'Z': Matrix.Rotation(-math.pi / 2, 4, 'Y')}[axis]
        self.add(mat, t, Matrix.Translation(center) @ rot)

    def mesh_from(self, name, mat, bm, smooth):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(MATS[mat])
        for p in me.polygons:
            p.use_smooth = smooth
        return ob

    def objects(self, smooth_mats):
        out = []
        for mat, bm in self.bms.items():
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            out.append(self.mesh_from(mat, mat, bm, mat in smooth_mats))
        return out


def loft(rings, cap=True):
    """Close a stack of equal-size rings into a tube."""
    bm = bmesh.new()
    rv = [[bm.verts.new(p) for p in r] for r in rings]
    m = len(rv[0])
    for i in range(len(rv) - 1):
        for k in range(m):
            bm.faces.new((rv[i][k], rv[i][(k + 1) % m], rv[i + 1][(k + 1) % m], rv[i + 1][k]))
    if cap:
        bm.faces.new(rv[0][::-1])
        bm.faces.new(rv[-1])
    return bm


def squircle(y, w, z0, z1, m=36, n=3.4, tume=0.0, zc_shift=0.0):
    pts = []
    zc, hh = (z0 + z1) / 2 + zc_shift, (z1 - z0) / 2
    for k in range(m):
        t = math.tau * k / m
        c, s = math.cos(t), math.sin(t)
        x = w * math.copysign(abs(c) ** (2 / n), c)
        z = zc + hh * math.copysign(abs(s) ** (2 / n), s)
        x *= 1 - tume * (z - z0) / max(1e-6, (z1 - z0))
        pts.append((x, y, z))
    return pts


def smooth(a, passes=3):
    a = np.array(a, float)
    for _ in range(passes):
        b = a.copy()
        b[1:-1] = (a[:-2] + 2 * a[1:-1] + a[2:]) / 4
        a = b
    return a


def profile(pts, ys):
    px, pz = zip(*pts)
    return smooth(np.interp(ys, px, pz), 4)


def endround(y, L, r):
    d = abs(y) - (L - r)
    return 1.0 if d <= 0 else math.sqrt(max(0.0, 1 - (d / r) ** 2))


# =====================================================================================
# Maruti 800 (SS80), 1983-2000: 3.34 m x 1.40 m x 1.41 m, wheelbase 2.175 m, 12" steel wheels, rectangular lamps.
def maruti():
    car = Car()
    L = 1.69
    ys = np.linspace(-L, L, 72)

    # ---- lower body: a lofted shell; top = bonnet / shoulder / boot line, narrowed and rounded at both ends
    top_pts = [(-1.69, 0.50), (-1.64, 0.62), (-1.35, 0.70), (-0.95, 0.77), (-0.68, 0.83), (-0.5, 0.84), (1.2, 0.86), (1.45, 0.92), (1.64, 0.93), (1.69, 0.70)]
    wid_pts = [(-1.69, 0.60), (-1.5, 0.66), (-1.2, 0.69), (-0.6, 0.705), (1.2, 0.705), (1.5, 0.68), (1.69, 0.64)]
    zt = profile(top_pts, ys)
    wd = profile(wid_pts, ys)
    rings = []
    for y, z1, w in zip(ys, zt, wd):
        e = endround(y, L, 0.16)
        z0 = 0.20 + 0.06 * (1 - e)
        rings.append(squircle(y, max(0.02, w * e), z0, max(z0 + 0.04, z1 * (0.6 + 0.4 * e)), n=3.6))
    body = loft(rings)

    # wheel arches: boolean-cut the shell (done below on the mesh object)

    # ---- cabin (greenhouse): paint pillars + roof, see-through glass panes, dark liner inside
    cab_pts = [(-0.66, 0.84), (-0.55, 0.97), (-0.30, 1.20), (-0.08, 1.38), (0.10, 1.405), (0.90, 1.405), (1.05, 1.38), (1.25, 1.18), (1.42, 1.02), (1.53, 0.94)]
    cys = np.linspace(-0.66, 1.53, 70)
    ct = profile(cab_pts, cys)
    cab_w = 0.635
    cab_rings = [squircle(y, max(0.02, cab_w * min(1, 1.0 - max(0, 0.04 - (z - 0.80)) * 4)), 0.80, max(0.84, z), m=48, n=3.2, tume=0.15) for y, z in zip(cys, ct)]
    cab = loft(cab_rings, cap=False)
    bmesh.ops.recalc_face_normals(cab, faces=cab.faces)
    car.add('paint', body)

    def y_front(z):   # windscreen base to roof, along the A-pillar
        return -0.66 + (z - 0.84) * 0.93

    def y_rear(z):    # hatch glass, along the C-pillar
        return 1.53 - (z - 0.94) * 1.19

    def prism(poly, axis, a0, a1):
        """Closed cutter: a polygon in (y, z) [axis 'x'] or (x, z) [axis 'y'], extruded from a0 to a1 along the axis."""
        bm = bmesh.new()
        co = (lambda q, t: (t, q[0], q[1])) if axis == 'x' else (lambda q, t: (q[0], t, q[1]))
        lo = [bm.verts.new(co(q, a0)) for q in poly]
        hi = [bm.verts.new(co(q, a1)) for q in poly]
        bm.faces.new(lo)
        bm.faces.new(hi[::-1])
        for i in range(len(poly)):
            j = (i + 1) % len(poly)
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return bm

    # the cabin as a thin double skin (paint outside, interior grey inside), then boolean the windows out of it
    me = bpy.data.meshes.new('cabin')
    cab.to_mesh(me)
    cab.free()
    cab_ob = bpy.data.objects.new('cabin', me)
    bpy.context.scene.collection.objects.link(cab_ob)
    for mname in ('paint', 'interior'):
        me.materials.append(MATS[mname])
    for pgn in me.polygons:
        pgn.use_smooth = True
    sd = cab_ob.modifiers.new('skin', 'SOLIDIFY')
    sd.thickness, sd.offset, sd.material_offset = 0.014, -1.0, 1
    bpy.context.view_layer.objects.active = cab_ob
    bpy.ops.object.modifier_apply(modifier=sd.name)

    cutters = bmesh.new()
    parts = []
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.50, sx * 0.80))
        zf0, zf1, zr0, zr1 = 0.93, 1.33, 0.93, 1.33
        parts.append(prism([(y_front(zf0) + 0.10, zf0), (0.50, zf0), (0.50, zf1), (y_front(zf1) + 0.10, zf1)], 'x', x0, x1))   # door glass
        parts.append(prism([(0.60, zr0), (y_rear(zr0) - 0.10, zr0), (y_rear(zr1) - 0.10, zr1), (0.60, zr1)], 'x', x0, x1))     # rear quarter glass
    parts.append(prism([(-0.50, 0.90), (0.50, 0.90), (0.43, 1.35), (-0.43, 1.35)], 'y', -0.72, 0.0))                       # windscreen
    parts.append(prism([(-0.50, 1.00), (0.50, 1.00), (0.44, 1.34), (-0.44, 1.34)], 'y', 0.98, 1.60))                       # rear hatch glass
    for pb in parts:
        me2 = bpy.data.meshes.new('t')
        pb.to_mesh(me2)
        pb.free()
        cutters.from_mesh(me2)
        bpy.data.meshes.remove(me2)
    cut_me = bpy.data.meshes.new('cutters')
    cutters.to_mesh(cut_me)
    cutters.free()
    cut_ob = bpy.data.objects.new('cutters', cut_me)
    bpy.context.scene.collection.objects.link(cut_ob)
    cut_me.materials.append(MATS['paint'])

    glass_ob = cab_ob.copy()
    glass_ob.data = cab_ob.data.copy()
    glass_ob.name = 'glass'
    bpy.context.scene.collection.objects.link(glass_ob)
    for ob, op in ((cab_ob, 'DIFFERENCE'), (glass_ob, 'INTERSECT')):
        md = ob.modifiers.new('win', 'BOOLEAN')
        md.operation, md.object, md.solver = op, cut_ob, 'EXACT'
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=md.name)
    glass_ob.data.materials.clear()
    glass_ob.data.materials.append(MATS['glass'])
    for pgn in glass_ob.data.polygons:
        pgn.material_index = 0
        pgn.use_smooth = True
    bpy.data.objects.remove(cut_ob, do_unlink=True)
    cab_ob.name = 'cabin'
    extra_objs = [cab_ob, glass_ob]

    # ---- bumpers, fascia, lamps
    car.box('plastic', -0.70, 0.70, -1.755, -1.60, 0.27, 0.47, bevel=0.045, seg=3)
    car.box('plastic', -0.69, 0.69, 1.60, 1.745, 0.27, 0.48, bevel=0.045, seg=3)
    car.box('chrome', -0.62, 0.62, -1.765, -1.752, 0.40, 0.425, bevel=0.004)      # bumper strip
    car.box('trim', -0.30, 0.30, -1.68, -1.655, 0.50, 0.62, bevel=0.006)          # grille
    for k in range(4):
        car.box('chrome', -0.28, 0.28, -1.684, -1.676, 0.515 + k * 0.026, 0.525 + k * 0.026)
    for s in (-1, 1):
        car.box('chrome', s * 0.40, s * 0.55, -1.672, -1.655, 0.585, 0.725, bevel=0.012)   # lamp housing
        car.box('lamp_head', s * 0.405, s * 0.545, -1.684, -1.668, 0.59, 0.72, bevel=0.012)
        car.box('lamp_amber', s * 0.56, s * 0.66, -1.66, -1.646, 0.60, 0.66, bevel=0.01)
        car.box('lamp_tail', s * 0.42, s * 0.58, 1.60, 1.636, 0.64, 0.88, bevel=0.012)
        car.box('lamp_amber', s * 0.42, s * 0.56, 1.612, 1.64, 0.52, 0.58, bevel=0.006)
    car.box('plate', -0.17, 0.17, -1.775, -1.762, 0.30, 0.40)
    car.box('plate', -0.17, 0.17, 1.752, 1.765, 0.52, 0.62)
    car.box('chrome', -0.03, 0.03, 1.68, 1.70, 0.94, 0.97, bevel=0.005)     # hatch handle

    # ---- doors: shut lines, handles, mirrors, wipers
    for s in (-1, 1):
        for y in (-0.56, 0.52):
            car.box('dark', s * 0.700, s * 0.706, y - 0.003, y + 0.003, 0.30, 0.83)
        car.box('dark', s * 0.700, s * 0.706, -0.56, 0.52, 0.30, 0.303)
        car.box('chrome', s * 0.700, s * 0.725, 0.34, 0.46, 0.94, 0.96, bevel=0.004)
        car.box('plastic', s * 0.70, s * 0.77, -0.46, -0.37, 0.98, 1.07, bevel=0.025, seg=3)       # mirror
        car.rod('plastic', (s * 0.66, -0.47, 0.90), (s * 0.72, -0.45, 0.99), 0.012)
    for x0, x1, zq in ((-0.45, 0.02, 0.0), (-0.02, 0.38, 0.0)):
        z0 = 0.90
        y0 = float(np.interp(z0, [0.84, 0.97, 1.20], [-0.66, -0.55, -0.30])) - 0.012
        z1 = 1.12
        y1 = float(np.interp(z1, [0.84, 0.97, 1.20], [-0.66, -0.55, -0.30])) - 0.012
        car.rod('trim', (x0, y0, z0), (x1, y1 - 0.01, z1), 0.006, 5)

    # ---- inside: seats, dashboard, wheel
    for s, x in ((0, -0.33), (1, 0.33)):
        car.box('seat', x - 0.2, x + 0.2, 0.00, 0.42, 0.40, 0.50, bevel=0.03, seg=3)
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1)
        bmesh.ops.scale(t, vec=(0.40, 0.10, 0.52), verts=t.verts)
        bmesh.ops.bevel(t, geom=t.verts[:] + t.edges[:] + t.faces[:], offset=0.03, segments=3, affect='EDGES')
        car.add('seat', t, Matrix.Translation((x, 0.44, 0.76)) @ Matrix.Rotation(0.22, 4, 'X'))
        car.box('seat', x - 0.12, x + 0.12, 0.44, 0.50, 0.98, 1.10, bevel=0.025, seg=2)         # headrest
    car.box('seat', -0.55, 0.55, 0.88, 1.2, 0.40, 0.50, bevel=0.03, seg=3)
    car.box('seat', -0.55, 0.55, 1.2, 1.3, 0.50, 0.98, bevel=0.03, seg=3)
    car.box('interior', -0.56, 0.56, -0.50, -0.28, 0.72, 0.90, bevel=0.04, seg=3)                # dashboard
    car.box('trim', -0.56, 0.56, -0.50, -0.30, 0.72, 0.76)
    t = bmesh.new()
    bmesh.ops.create_circle(t, cap_ends=False, segments=24, radius=0.19)
    car.add('rubber', t, Matrix.Translation((-0.33, -0.22, 0.99)) @ Matrix.Rotation(1.0, 4, 'X'))
    car.rod('rubber', (-0.33, -0.22, 0.99), (-0.33, -0.40, 0.86), 0.018)
    car.box('interior', -0.20, 0.20, -0.42, -0.30, 0.70, 0.74)                                    # gear tunnel
    car.rod('plastic', (0.0, 0.0, 0.5), (0.0, -0.05, 0.62), 0.012)

    # ---- under: wheel wells + exhaust
    arches = []
    for ax in (-1.11, 1.065):
        for sx in (-1, 1):
            arches.append((sx * 0.64, ax))

    # ---- wheels: 145/70 R12 (outer radius 0.254 m), pressed-steel rim, four nuts
    def wheel(x, y):
        sgn = 1 if x > 0 else -1
        z = 0.254
        tire = [(0.153, 0.068), (0.185, 0.074), (0.222, 0.068), (0.243, 0.052), (0.251, 0.034), (0.2535, 0.012), (0.2535, -0.012), (0.251, -0.034), (0.243, -0.052), (0.222, -0.068), (0.185, -0.074), (0.153, -0.068)]
        car.lathe('rubber', [(r, a * sgn) for r, a in tire], (x, y, z), segs=28)
        rim = [(0.0, 0.050), (0.060, 0.050), (0.085, 0.040), (0.150, 0.060), (0.156, 0.072), (0.150, 0.064), (0.140, 0.0)]
        car.lathe('steel', [(r, a * sgn) for r, a in rim], (x, y, z), segs=36)
        car.lathe('chrome', [(0.0, 0.066 * sgn), (0.04, 0.060 * sgn), (0.048, 0.048 * sgn)], (x, y, z), segs=20)
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            car.cyl('chrome', (x + sgn * 0.058, y + 0.075 * math.cos(a), z + 0.075 * math.sin(a)), 0.011, 0.014, 'X', 6)
        car.cyl('trim', (x - sgn * 0.02, y, z), 0.04, 0.05, 'X', 12)

    for x, y in ((-0.60, -1.11), (0.60, -1.11), (-0.60, 1.065), (0.60, 1.065)):
        wheel(x, y)
    for sx in (-1, 1):
        for ay in (-1.11, 1.065):
            car.cyl('dark', (sx * 0.505, ay, 0.268), 0.32, 0.02, 'X', 24)           # inner wall of each arch
    car.rod('chrome', (0.40, 1.52, 0.23), (0.40, 1.74, 0.23), 0.025, 10)           # exhaust tail pipe
    car.rod('trim', (-0.55, -1.5, 0.21), (-0.55, 1.5, 0.21), 0.03, 6)

    objs = car.objects(smooth_mats={'paint', 'rubber', 'glass', 'steel', 'interior', 'seat'})
    # cut the arches out of the painted shell
    paint_ob = next(o for o in objs if o.name == 'paint')
    for sx, ay in arches:
        cut = bpy.data.objects.new('cut', bpy.data.meshes.new('cut'))
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=36, radius1=0.312, radius2=0.312, depth=0.34)
        bm.to_mesh(cut.data)
        bm.free()
        cut.rotation_euler = (0, math.pi / 2, 0)
        cut.location = (sx, ay, 0.268)
        bpy.context.scene.collection.objects.link(cut)
        md = paint_ob.modifiers.new('arch', 'BOOLEAN')
        md.operation, md.object, md.solver = 'DIFFERENCE', cut, 'EXACT'
        bpy.context.view_layer.objects.active = paint_ob
        bpy.ops.object.modifier_apply(modifier=md.name)
        bpy.data.objects.remove(cut, do_unlink=True)
    return objs + extra_objs


# =====================================================================================
def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def preview(name, objs):
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = 1100, 700
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs['Strength'].default_value = 1.1
    # ground, sun, tinted paint for the preview
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    gm = bpy.data.materials.new('gnd')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.16, 0.17, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    bpy.context.object.data.materials.append(gm)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sc.collection.objects.link(sun)
    MATS['paint'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lin('#a72a2a'), 1)
    for tag, loc, tgt in (('front', (3.4, -4.2, 1.6), (0, 0, 0.7)), ('rear', (-3.4, 4.2, 1.6), (0, 0, 0.7)),
                          ('side', (5.2, 0.0, 1.1), (0, 0, 0.7)), ('cabin', (0.8, 1.6, 2.6), (0, 0.2, 0.9))):
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = 40
        sc.camera = cam
        sc.render.filepath = os.path.join(PREVIEW, f'{name}_{tag}.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)


os.makedirs(OUT, exist_ok=True)
make_materials()
BUILDS = {'maruti': maruti}
for name in (WANT or list(BUILDS)):
    clear()
    objs = BUILDS[name]()
    tris = sum(len(p.vertices) - 2 for ob in objs for p in ob.data.polygons)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob in objs)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_normals=True, export_materials='EXPORT', export_animations=False)
    print(f'MODEL {name}: {tris} triangles, {os.path.getsize(path) / 1024:.0f} KB')
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        preview(name, objs)
