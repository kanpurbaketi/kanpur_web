"""
Builds the low-poly street props (city bus, CNG auto, e-rickshaw, panipuri stall) and exports them as GLB.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_models.py -- [--preview DIR]

Output: public/models/<name>.glb, each with a "body" mesh and (for vehicles) a "glass" mesh.
Colours are stored per vertex (no textures), so the game draws each model with one shared material.
Model space: metres, Z up, front toward -Y (glTF export turns that into +Z forward, Y up).
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'models')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None


def lin(hexcol):
    """sRGB hex -> linear RGBA (vertex colours are linear)."""
    h = hexcol.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


class Model:
    def __init__(self):
        self.parts = {'body': bmesh.new(), 'glass': bmesh.new()}
        self.layers = {k: bm.loops.layers.float_color.new('Col') for k, bm in self.parts.items()}

    def emit(self, tmp, col, tgt='body', mat=None):
        """Copy a temporary bmesh into the model with one colour (or a colour per face via a callable)."""
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        bm, layer = self.parts[tgt], self.layers[tgt]
        vmap = {}
        for v in tmp.verts:
            vmap[v] = bm.verts.new(mat @ v.co if mat else v.co)
        for i, f in enumerate(tmp.faces):
            nf = bm.faces.new([vmap[v] for v in f.verts])
            c = lin(col(i) if callable(col) else col)
            for l in nf.loops:
                l[layer] = c
        tmp.free()

    # ---- primitives ----
    def box(self, col, x0, x1, y0, y1, z0, z1, bevel=0.0, tgt='body', rot=None):
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1)
        bmesh.ops.scale(t, vec=(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), verts=t.verts)
        if bevel:
            bmesh.ops.bevel(t, geom=t.edges[:], offset=bevel, segments=2, affect='EDGES', profile=0.5)
        m = Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
        if rot:
            m = m @ rot
        self.emit(t, col, tgt, m)

    def cyl(self, col, c, r, depth, axis='X', segs=12, r2=None, tgt='body', caps=True):
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=caps, cap_tris=False, segments=segs, radius1=r,
                              radius2=r if r2 is None else r2, depth=depth)
        rot = {'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X'), 'Z': Matrix()}[axis]
        self.emit(t, col, tgt, Matrix.Translation(c) @ rot)

    def rod(self, col, a, b, r, segs=6):
        """Thin cylinder from point a to point b."""
        a, b = Vector(a), Vector(b)
        d = b - a
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r, depth=d.length)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        self.emit(t, col, 'body', Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4())

    def prism(self, col, profile, x0, x1, bevel=0.0, tgt='body'):
        """Extrude a (y, z) outline across the vehicle from x0 to x1."""
        t = bmesh.new()
        a = [t.verts.new((x0, y, z)) for y, z in profile]
        b = [t.verts.new((x1, y, z)) for y, z in profile]
        n = len(profile)
        t.faces.new(a)
        t.faces.new(b[::-1])
        for i in range(n):
            j = (i + 1) % n
            t.faces.new([a[i], b[i], b[j], a[j]])
        if bevel:
            bmesh.ops.bevel(t, geom=t.edges[:], offset=bevel, segments=1, affect='EDGES')
        self.emit(t, col, tgt)

    def wheel(self, x, y, r, w, hub='#b9bcc0', segs=14):
        self.cyl('#161618', (x, y, r), r, w, 'X', segs)
        self.cyl('#101012', (x, y, r), r * 0.72, w + 0.012, 'X', segs)     # sidewall step
        self.cyl(hub, (x, y, r), r * 0.5, w + 0.03, 'X', 10)
        self.cyl('#55585c', (x, y, r), r * 0.16, w + 0.05, 'X', 6)

    # ---- output ----
    def objects(self, name):
        objs = []
        for key, bm in self.parts.items():
            if not bm.faces:
                continue
            me = bpy.data.meshes.new(f'{name}_{key}')
            bm.to_mesh(me)
            for p in me.polygons:
                p.use_smooth = True
            me.set_sharp_from_angle(angle=math.radians(38))
            me.color_attributes.active_color = me.color_attributes['Col']
            me.color_attributes.render_color_index = 0
            ob = bpy.data.objects.new(key, me)
            bpy.context.scene.collection.objects.link(ob)
            objs.append(ob)
        return objs


# =====================================================================================
GLASS = '#1d2a33'
DARK = '#1b1b1e'


def bus():
    m = Model()
    white, purple, deep = '#eceae4', '#8d7fc6', '#6a5ca6'
    L = 4.7
    m.box('#19191b', -1.1, 1.1, -4.4, 4.4, 0.28, 0.52)                       # underbody
    m.box(white, -1.25, 1.25, -L, L, 0.5, 3.0, bevel=0.1)                    # shell
    m.box(purple, -1.265, 1.265, -L - 0.015, L + 0.015, 0.44, 1.06, bevel=0.03)   # lower band
    m.box(purple, -1.27, 1.27, -L + 0.3, L - 0.3, 1.4, 1.48)                 # stripe under the windows
    m.box('#dddbd3', -1.08, 1.08, -4.3, 4.3, 2.97, 3.04, bevel=0.02)         # roof panel
    for y in (-2.2, 1.6):
        m.box('#c8c6be', -0.42, 0.42, y - 0.45, y + 0.45, 3.03, 3.1, bevel=0.02)  # roof hatches
    # front
    m.box(purple, -1.2, 1.2, -L - 0.035, -L + 0.1, 1.0, 1.4, bevel=0.02)
    m.box('#34304a', -0.62, 0.62, -L - 0.05, -L, 1.06, 1.32)                 # grille
    m.box(GLASS, -1.13, 1.13, -L - 0.03, -L + 0.1, 1.46, 2.62, bevel=0.02, tgt='glass')
    m.box(white, -0.03, 0.03, -L - 0.045, -L, 1.46, 2.62)                    # windscreen divider
    m.box('#1c1c20', -0.92, 0.92, -L - 0.035, -L + 0.1, 2.68, 2.93)          # destination board
    m.box('#f08a1c', -0.72, 0.72, -L - 0.045, -L - 0.03, 2.74, 2.87)
    m.box(deep, -1.3, 1.3, -L - 0.1, -L + 0.15, 0.42, 0.64, bevel=0.03)      # bumpers
    m.box(deep, -1.3, 1.3, L - 0.15, L + 0.1, 0.42, 0.64, bevel=0.03)
    m.box('#e8c832', -0.3, 0.3, -L - 0.115, -L - 0.09, 0.47, 0.6)            # number plate (blank)
    for s in (-1, 1):
        m.box('#f6f1d6', s * 0.72, s * 1.06, -L - 0.05, -L, 0.74, 0.96, bevel=0.02)   # headlights
        m.box('#f29a2e', s * 1.08, s * 1.2, -L - 0.05, -L, 0.78, 0.92)                # indicators
        m.box('#c8211e', s * 0.85, s * 1.15, L, L + 0.04, 0.9, 1.2)                   # tail lights
        m.box(DARK, s * 1.26, s * 1.52, -4.56, -4.5, 2.05, 2.42, bevel=0.015)         # mirrors
        m.rod(DARK, (s * 1.2, -4.53, 2.5), (s * 1.4, -4.53, 2.35), 0.015)
    m.box(GLASS, -1.0, 1.0, L - 0.1, L + 0.03, 1.6, 2.5, bevel=0.02, tgt='glass')     # rear window
    # sides: window bands with pillars; the door is on the left (+X) at the front
    for s in (-1, 1):
        y0 = -3.3 if s > 0 else -4.3
        m.box(GLASS, s * 1.2, s * 1.262, y0, 4.3, 1.56, 2.42, tgt='glass')
        y = y0
        while y <= 4.31:
            m.box(white, s * 1.2, s * 1.272, y - 0.045, y + 0.045, 1.52, 2.46)
            y += (4.3 - y0) / (7 if s > 0 else 8)
        m.box(white, s * 1.2, s * 1.272, y0, 4.3, 2.42, 2.5)
        for wy in (-2.7, 2.7):                                              # wheel arches
            m.prism('#1a1a1e', [(wy - 0.66, 0.42), (wy - 0.6, 0.86), (wy - 0.36, 1.04), (wy + 0.36, 1.04),
                                (wy + 0.6, 0.86), (wy + 0.66, 0.42)], s * 1.2, s * 1.274)
            m.wheel(s * 1.1, wy, 0.48, 0.3, hub='#9a9ca0')
    m.box('#232328', 1.2, 1.268, -4.38, -3.42, 0.56, 2.56)                   # door opening
    m.box('#3a3a40', 1.2, 1.275, -3.92, -3.88, 0.56, 2.56)                   # folding door split
    m.box('#55504a', 1.2, 1.27, -4.38, -3.42, 0.5, 0.58)                     # step
    return m


def auto():
    m = Model()
    green, yellow, seat = '#1f8a4c', '#f0c419', '#7a2f25'
    m.box('#1c1c1e', -0.6, 0.6, -0.9, 1.25, 0.24, 0.36)                                    # floor / chassis
    # front cowl (narrow nose), mudguard, headlight, handlebar
    m.prism(green, [(-1.34, 0.36), (-1.36, 0.74), (-1.1, 1.0), (-0.86, 1.0), (-0.86, 0.3), (-1.2, 0.3)], -0.42, 0.42, bevel=0.03)
    m.prism(yellow, [(-1.365, 0.56), (-1.37, 0.66), (-1.34, 0.72), (-1.335, 0.56)], -0.43, 0.43)   # yellow band on the nose
    m.prism(green, [(-1.52, 0.3), (-1.46, 0.44), (-1.3, 0.48), (-1.14, 0.44), (-1.1, 0.3)], -0.09, 0.09)
    m.cyl('#f4f0d8', (0, -1.34, 0.86), 0.075, 0.06, 'Y', 10)
    m.cyl('#c9ccd0', (0, -1.32, 0.86), 0.09, 0.03, 'Y', 10)
    m.rod(DARK, (-0.3, -0.92, 1.04), (0.3, -0.92, 1.04), 0.018)
    m.rod(DARK, (0, -0.92, 1.04), (0, -1.05, 0.9), 0.02)
    m.wheel(0, -1.3, 0.2, 0.1)
    # windscreen and its frame
    m.prism(GLASS, [(-1.1, 1.0), (-1.07, 1.0), (-0.83, 1.62), (-0.86, 1.62)], -0.5, 0.5, tgt='glass')
    for s in (-1, 1):
        m.prism(DARK, [(-1.12, 0.98), (-1.06, 0.98), (-0.82, 1.64), (-0.88, 1.64)], s * 0.5, s * 0.55)
    m.rod(DARK, (0.25, -1.0, 1.25), (-0.2, -1.05, 1.08), 0.008)                             # wiper
    # driver seat and the partition behind it
    m.box(seat, -0.3, 0.3, -0.5, -0.12, 0.36, 0.7, bevel=0.03)
    m.box(green, -0.62, 0.62, -0.1, -0.04, 0.36, 1.0)
    m.box(DARK, -0.62, 0.62, -0.1, -0.04, 1.0, 1.04)
    # passenger tub (green) with the yellow hood behind it
    m.box(green, -0.65, 0.65, 0.3, 1.32, 0.3, 1.0, bevel=0.04)
    m.box(yellow, -0.655, 0.655, 0.3, 1.33, 0.86, 0.94)                                     # yellow waist stripe
    m.box(seat, -0.56, 0.56, 0.42, 0.94, 0.62, 0.78, bevel=0.03)                             # bench
    m.box(seat, -0.56, 0.56, 0.9, 1.0, 0.74, 1.3, bevel=0.03)                                # backrest
    m.prism(yellow, [(0.98, 1.0), (1.32, 1.0), (1.34, 1.3), (1.06, 1.7), (0.98, 1.7)], -0.65, 0.65, bevel=0.03)
    m.box(GLASS, -0.3, 0.3, 1.2, 1.36, 1.3, 1.46, tgt='glass',
          rot=Matrix.Rotation(math.radians(-35), 4, 'X'))                                    # small rear window
    for s in (-1, 1):
        m.box(GLASS, s * 0.64, s * 0.662, 1.04, 1.22, 1.2, 1.42, tgt='glass')                # oval side windows
        m.rod(DARK, (s * 0.62, -0.07, 1.0), (s * 0.62, -0.07, 1.66), 0.018)                  # roof posts
        m.box('#c8211e', s * 0.4, s * 0.58, 1.32, 1.345, 0.62, 0.72)                         # tail lights
        m.prism(green, [(0.62, 0.3), (0.68, 0.46), (0.9, 0.5), (1.12, 0.46), (1.18, 0.3)], s * 0.6, s * 0.72)  # mudguards
        m.wheel(s * 0.62, 0.9, 0.2, 0.1)
    # canopy: one shell from the windscreen top back over the hood
    m.prism(yellow, [(-0.9, 1.6), (-0.62, 1.74), (1.02, 1.74), (1.1, 1.7), (1.0, 1.66), (-0.6, 1.66), (-0.84, 1.56)],
            -0.67, 0.67, bevel=0.012)
    m.box('#e8c832', -0.22, 0.22, 1.335, 1.35, 0.4, 0.5)                                     # number plate (blank)
    return m


def tirri():
    m = Model()
    red, cream, frame = '#d6271f', '#efe2c4', '#1a1a1c'
    m.box('#2a2a2d', -0.46, 0.46, -0.62, 1.3, 0.3, 0.37)                                     # floor
    # front: fork, handlebar, headlight, leg shield, wheel with mudguard
    for s in (-1, 1):
        m.rod('#2f6b3a', (s * 0.07, -1.3, 0.32), (s * 0.07, -1.0, 0.98), 0.02)               # green fork springs
        m.rod(frame, (s * 0.07, -1.0, 0.98), (0, -0.92, 1.08), 0.02)
    m.rod(frame, (-0.3, -0.9, 1.1), (0.3, -0.9, 1.1), 0.018)
    m.cyl('#e9e6da', (0, -1.06, 1.0), 0.07, 0.07, 'Y', 10)
    m.box(frame, -0.1, 0.1, -1.0, -0.9, 0.9, 1.06, bevel=0.015)
    m.box(red, -0.26, 0.26, -0.84, -0.8, 0.37, 0.98, bevel=0.012, rot=Matrix.Rotation(math.radians(-10), 4, 'X'))
    m.prism('#c9ccd0', [(-1.62, 0.34), (-1.54, 0.56), (-1.3, 0.64), (-1.06, 0.56), (-0.98, 0.34), (-1.04, 0.34),
                        (-1.1, 0.52), (-1.3, 0.58), (-1.5, 0.52), (-1.56, 0.34)], -0.06, 0.06)
    m.wheel(0, -1.3, 0.3, 0.08, hub='#c9ccd0')
    m.rod(frame, (0, -0.86, 0.5), (0, -0.62, 0.34), 0.03)                                     # frame to the floor
    # driver box with cushion
    m.box(red, -0.42, 0.42, -0.58, -0.16, 0.37, 0.8, bevel=0.03)
    m.box(cream, -0.4, 0.4, -0.56, -0.18, 0.8, 0.88, bevel=0.025)
    # front passenger bench (faces backwards) with side rails
    m.box(red, -0.44, 0.44, -0.14, 0.24, 0.37, 0.72, bevel=0.03)
    m.box(cream, -0.42, 0.42, -0.12, 0.22, 0.72, 0.8, bevel=0.025)
    # rear body and bench with backrest
    m.prism(red, [(0.62, 0.37), (0.74, 0.74), (1.34, 0.74), (1.38, 0.5), (1.3, 0.37)], -0.5, 0.5, bevel=0.025)
    m.box(cream, -0.44, 0.44, 0.82, 1.2, 0.74, 0.82, bevel=0.025)
    m.box(cream, -0.44, 0.44, 1.2, 1.28, 0.84, 1.3, bevel=0.025)
    for s in (-1, 1):
        m.prism(red, [(0.52, 0.4), (0.62, 0.68), (0.95, 0.76), (1.28, 0.68), (1.38, 0.4)], s * 0.5, s * 0.62, bevel=0.015)  # fenders
        m.wheel(s * 0.56, 0.95, 0.3, 0.1, hub='#c9ccd0')
        # canopy posts and seat rails
        for y in (-0.15, 1.3):
            m.rod(frame, (s * 0.47, y, 0.37), (s * 0.47, y, 1.64), 0.018)
        m.rod(frame, (s * 0.47, -0.15, 1.0), (s * 0.47, 0.24, 1.0), 0.014)
        m.rod(frame, (s * 0.47, 0.24, 1.0), (s * 0.47, 0.24, 0.72), 0.014)
        m.rod(frame, (s * 0.47, 0.84, 1.02), (s * 0.47, 1.3, 1.02), 0.014)
        m.rod(frame, (s * 0.47, 0.84, 1.02), (s * 0.47, 0.84, 0.76), 0.014)
        m.box('#c8211e', s * 0.3, s * 0.44, 1.375, 1.39, 0.52, 0.6)                          # tail lights
    # roof: red shell with a cream lining, overhanging the driver
    m.box(red, -0.6, 0.6, -1.05, 1.48, 1.64, 1.73, bevel=0.035)
    m.box(cream, -0.56, 0.56, -1.0, 1.44, 1.615, 1.645)
    return m


def stall():
    m = Model()
    cloth, steel = '#c8252b', '#b8bcc0'
    # table with a red cloth to the ground
    m.box(cloth, -0.55, 0.55, -0.36, 0.36, 0.06, 0.8, bevel=0.02)
    m.box('#8e1a1f', -0.56, 0.56, -0.37, 0.37, 0.02, 0.12)
    m.box('#d9d2c0', -0.57, 0.57, -0.38, 0.38, 0.8, 0.83)                                    # steel top
    # heap of puris in a tall jar, pots of water and filling, plates
    m.cyl('#d9a441', (-0.3, 0.05, 1.12), 0.21, 0.58, 'Z', 10, r2=0.17)
    m.cyl('#e6b655', (-0.3, 0.05, 1.45), 0.17, 0.1, 'Z', 10, r2=0.06)
    m.cyl(steel, (0.12, 0.08, 0.96), 0.15, 0.26, 'Z', 12, r2=0.17)                           # big pot
    m.cyl('#3f5a2a', (0.12, 0.08, 1.085), 0.15, 0.012, 'Z', 12)                              # pani
    m.cyl(steel, (0.4, 0.12, 0.92), 0.1, 0.18, 'Z', 10)
    m.cyl('#caa24a', (0.4, 0.12, 1.012), 0.09, 0.01, 'Z', 10)
    m.cyl(steel, (0.36, -0.16, 0.89), 0.085, 0.12, 'Z', 10)
    m.cyl('#8a3a1c', (0.36, -0.16, 0.952), 0.075, 0.008, 'Z', 10)
    for i in range(3):
        m.cyl('#e8e4d6', (-0.02 + i * 0.03, -0.24, 0.84 + i * 0.012), 0.075, 0.01, 'Z', 10)   # leaf plates
    # umbrella: pole through a stand behind the table, eight coloured panels
    m.cyl('#3a3a3c', (0, 0.5, 0.06), 0.16, 0.12, 'Z', 10)
    m.rod('#9a8f7c', (0, 0.5, 0.1), (0, 0.42, 2.52), 0.022)
    cols = ['#2f5fb5', '#3f9a4a', '#f2c81e', '#6a3f9a', '#d8322a', '#2f5fb5', '#f2c81e', '#3f9a4a']
    top, R, zr = Vector((0, 0.42, 2.52)), 1.3, 2.12
    t = bmesh.new()
    apex = t.verts.new(top)
    rim = [t.verts.new((top.x + R * math.cos(a), top.y + R * math.sin(a), zr))
           for a in [i * math.tau / 8 + 0.2 for i in range(8)]]
    # each panel sags a little between the ribs
    for i in range(8):
        a, b = rim[i], rim[(i + 1) % 8]
        mid = t.verts.new(((a.co.x + b.co.x) / 2 * 0.97 + top.x * 0.03, (a.co.y + b.co.y) / 2 * 0.97 + top.y * 0.03, zr - 0.07))
        t.faces.new([apex, a, mid])
        t.faces.new([apex, mid, b])
    order = [f for f in t.faces]
    m.emit(t, lambda i: cols[(i // 2) % 8], 'body')
    for i in range(8):                                                                         # ribs
        a = i * math.tau / 8 + 0.2
        m.rod('#7a7a7e', top - Vector((0, 0, 0.02)), (top.x + R * math.cos(a), top.y + R * math.sin(a), zr - 0.015), 0.008, 4)
    # plastic stool beside the table
    m.box('#2f6fb5', 0.78, 1.1, 0.0, 0.32, 0.4, 0.45, bevel=0.015)
    for sx in (0.81, 1.07):
        for sy in (0.03, 0.29):
            m.rod('#2f6fb5', (sx, sy, 0), (sx, sy, 0.4), 0.02, 4)
    return m


# =====================================================================================
def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def preview(name, objs):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_cavity = True
    sh.show_shadows = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 640
    sc.render.film_transparent = False
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for ob in objs:
        for v in ob.data.vertices:
            for i in range(3):
                lo[i], hi[i] = min(lo[i], v.co[i]), max(hi[i], v.co[i])
    c, size = (lo + hi) / 2, (hi - lo).length
    for tag, d in (('a', Vector((1.0, -1.25, 0.55))), ('b', Vector((-1.1, 1.2, 0.5)))):
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
        cam.location = c + d.normalized() * size * 1.25
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = 50
        sc.camera = cam
        sc.render.filepath = os.path.join(PREVIEW, f'{name}_{tag}.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)


os.makedirs(OUT, exist_ok=True)
for name, build in (('bus', bus), ('auto', auto), ('tirri', tirri), ('stall', stall)):
    clear()
    objs = build().objects(name)
    tris = sum(len(p.vertices) - 2 for ob in objs for p in ob.data.polygons)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob in objs)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_normals=True, export_texcoords=False,
                              export_materials='NONE', export_vertex_color='ACTIVE', export_animations=False)
    print(f'MODEL {name}: {tris} triangles, {os.path.getsize(path) / 1024:.0f} KB')
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        preview(name, objs)
