"""
Builds Ramu from the reference render assets/ramu-3d.png and exports public/models/ramu.glb + ramu_atlas.png.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_ramu.py -- [--preview DIR]

How it matches the picture: the body is modelled to the proportions measured off the reference (all
measurements below are in reference pixels, converted with S), and the reference itself is the texture,
projected straight onto the model from the front (and from the back, with the print and satchel cleaned up).
So the shirt print, pockets, shoes, face and dirt come from the picture, not from flat colours.

Atlas: left half = front picture, right half = back picture. A face picks its half by which way it points.
Nodes (for the game): body, thigh_L > shin_L, thigh_R > shin_R, arm_L > fore_L, arm_R > fore_R. Model faces -Y
in Blender (glTF +Z); L / R mean world -x / +x in Blender.
"""
import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = os.path.join(ROOT, 'assets', 'ramu-3d.png')
OUT = os.path.join(ROOT, 'public', 'models')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

# ---- reference picture geometry ------------------------------------------------------------------
S = 1.46 / 708          # metres per reference pixel (head top y = 52, soles y = 760 -> 1.46 m boy)
CX = 707.5              # body centre line
FLOOR = 760.0
CROP = (360, 1060, 40, 768)   # atlas crop x0, x1, y0, y1
CW, CH = CROP[1] - CROP[0], CROP[3] - CROP[2]


def X(px): return (px - CX) * S
def Z(py): return (FLOOR - py) * S


# ---- texture atlas -------------------------------------------------------------------------------
def make_atlas():
    img = bpy.data.images.load(REF)
    img.colorspace_settings.name = 'Non-Color'
    H, W = img.size[1], img.size[0]
    a = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[::-1, :, :3].copy()   # row 0 = top
    fg = (1 - a.min(axis=2)) > 0.08
    bg = ~fg
    # background = white pixels connected to the border; keep white inside the body (teeth, eyes)
    reach = np.zeros_like(bg)
    reach[0, :] = bg[0, :]; reach[-1, :] = bg[-1, :]; reach[:, 0] = bg[:, 0]; reach[:, -1] = bg[:, -1]
    for _ in range(900):
        n = reach.copy()
        n[1:] |= reach[:-1]; n[:-1] |= reach[1:]; n[:, 1:] |= reach[:, :-1]; n[:, :-1] |= reach[:, 1:]
        n &= bg
        if (n == reach).all():
            break
        reach = n
    outside = reach
    # anti-aliased fringe: also treat 2px around the outside as unknown
    unk = outside.copy()
    for _ in range(2):
        n = unk.copy()
        n[1:] |= unk[:-1]; n[:-1] |= unk[1:]; n[:, 1:] |= unk[:, :-1]; n[:, :-1] |= unk[:, 1:]
        unk = n
    known = ~unk
    img_f = a.copy()
    img_f[unk] = 0
    # bleed the colour outwards so projection past the silhouette smears the edge colour, not white
    for _ in range(90):
        if known.all():
            break
        acc = np.zeros_like(img_f); cnt = np.zeros(known.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = np.roll(known, (dy, dx), (0, 1)); v = np.roll(img_f, (dy, dx), (0, 1))
            acc += v * k[..., None]; cnt += k
        fill = (~known) & (cnt > 0)
        img_f[fill] = acc[fill] / cnt[fill][..., None]
        known |= fill
    front = img_f.copy()
    # back view: no print on the shirt (the satchel strap stays), no satchel needed here either
    back = front.copy()
    rng = np.random.default_rng(3)
    ys, xs = np.mgrid[248:390, 640:780]
    sy = rng.integers(398, 462, ys.shape); sx = rng.integers(640, 735, xs.shape)
    patch = front[sy, sx]
    # box blur 3x3 to keep the dirt but lose the pixel noise
    pad = np.pad(patch, ((1, 1), (1, 1), (0, 0)), mode='edge')
    patch = sum(pad[i:i + patch.shape[0], j:j + patch.shape[1]] for i in range(3) for j in range(3)) / 9
    back[248:390, 640:780] = patch
    # strap: copy the strap pixels from the front over the cleaned patch
    A, B = np.array([663.0, 196.0]), np.array([782.0, 398.0])
    d = (B - A) / np.linalg.norm(B - A)
    px = np.stack([xs, ys], -1).astype(np.float32) - A
    along = (px * d).sum(-1)
    perp = np.abs(px[..., 0] * d[1] - px[..., 1] * d[0])
    strap = (perp < 8) & (along > 0)
    sub = back[248:390, 640:780]
    sub[strap] = front[248:390, 640:780][strap]
    sy = rng.integers(520, 585, (24, 40)); sx = rng.integers(700, 745, (24, 40))
    for img_ in (front, back):
        img_[468:492, 748:788] = front[sy, sx]
    x0, x1, y0, y1 = CROP
    atlas = np.concatenate([front[y0:y1, x0:x1], back[y0:y1, x0:x1]], axis=1)
    out = np.ones((CH, CW * 2, 4), np.float32)
    out[..., :3] = atlas
    out = out[::-1]                                        # Blender wants row 0 at the bottom
    path = os.path.join(OUT, 'ramu_atlas.png')
    im = bpy.data.images.new('ramu_atlas', CW * 2, CH, alpha=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(out.ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    return path, front


def uv_of(px, py, back):
    return ((px - CROP[0]) / CW * 0.5 + (0.5 if back else 0.0), (CROP[3] - py) / CH)


# ---- mesh helpers --------------------------------------------------------------------------------
def ring_pts(r, segs, axis):
    """r = (cx, cy, cz, r1, r2) in metres; returns the points of one elliptical ring."""
    cx, cy, cz, r1, r2 = r
    pts = []
    for i in range(segs):
        t = i / segs * math.tau
        c, s = math.cos(t), math.sin(t)
        if axis == 'z': pts.append((cx + r1 * c, cy + r2 * s, cz))
        elif axis == 'x': pts.append((cx, cy + r1 * c, cz + r2 * s))
        else: pts.append((cx + r1 * c, cy, cz + r2 * s))
    return pts


def loft(bm, rings, segs=16, axis='z', caps=True):
    rows = []
    for r in rings:
        rows.append([bm.verts.new(p) for p in ring_pts(r, segs, axis)])
    for i in range(len(rows) - 1):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new([rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]])
    if caps:
        bm.faces.new(rows[0])
        bm.faces.new(rows[-1][::-1])
    return rows


def ellipsoid(bm, c, rx, ry, rz, segs=10, rings=6):
    t = bmesh.new()
    bmesh.ops.create_uvsphere(t, u_segments=segs, v_segments=rings, radius=1)
    bmesh.ops.rotate(t, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / segs, 3, 'Z'), verts=t.verts)   # no vertex seam on the centre line
    bmesh.ops.scale(t, vec=(rx, ry, rz), verts=t.verts)
    bmesh.ops.translate(t, vec=c, verts=t.verts)
    merge(bm, t)


def merge(bm, t):
    m = {}
    for v in t.verts: m[v] = bm.verts.new(v.co)
    for f in t.faces: bm.faces.new([m[v] for v in f.verts])
    t.free()


def cone(bm, base, d, length, r, segs=5):
    d = Vector(d).normalized()
    t = bmesh.new()
    bmesh.ops.create_cone(t, cap_ends=True, cap_tris=True, segments=segs, radius1=r, radius2=r * 0.12, depth=length)
    q = Vector((0, 0, 1)).rotation_difference(d)
    bmesh.ops.transform(t, matrix=Matrix.Translation(Vector(base) + d * length / 2) @ q.to_matrix().to_4x4(), verts=t.verts)
    merge(bm, t)


def interp(table, y):
    """table rows (y, a, b, ...) ascending in y; linear interpolation."""
    if y <= table[0][0]: return table[0][1:]
    for i in range(len(table) - 1):
        if y <= table[i + 1][0]:
            t = (y - table[i][0]) / (table[i + 1][0] - table[i][0])
            return tuple(a + (b - a) * t for a, b in zip(table[i][1:], table[i + 1][1:]))
    return table[-1][1:]


def finish(bm, name, origin=(0, 0, 0), xform=None, fixed_uv=None, parent=None):
    """Project the picture onto the mesh (before any posing), then pose it and make an object."""
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        back = f.normal.y > 0
        if fixed_uv == 'hair':   # a random bit of the hair in the picture per face: light and dark strands
            hx, hy = random.choice(HAIR_PIXELS)
            u0 = uv_of(hx + 0.5, hy + 0.5, False)
            for l in f.loops: l[uvl].uv = u0
            continue
        for l in f.loops:
            if fixed_uv == 'hair':
                pass
            elif fixed_uv:
                l[uvl].uv = uv_of(*fixed_uv, back=False)
            else:
                p = l.vert.co
                l[uvl].uv = uv_of(CX + p.x / S, FLOOR - p.z / S, back)
    if xform is not None:
        bmesh.ops.transform(bm, matrix=xform, verts=bm.verts)
    bmesh.ops.translate(bm, vec=-Vector(origin), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(48))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is None:
        ob.location = Vector(origin)
    else:
        ob.parent = parent
        ob.location = Vector(origin) - parent.location   # parents are never rotated
    return ob


# ---- the model -----------------------------------------------------------------------------------
def head_tables():
    # (py, half width px, half depth px, depth-centre shift px: negative = forward)
    return [(62, 14, 16, 4), (70, 26, 29, 4), (82, 35, 40, 3), (100, 39, 45, 3), (125, 40, 46, 3),
            (146, 38, 44, 1), (160, 33, 39, -2), (170, 26, 31, -5), (178, 17, 21, -6), (183, 9, 12, -6)]


def build_body():
    bm = bmesh.new()
    # tee: (py, half width, half depth)
    tee = [(468, 80, 50), (440, 78, 52), (400, 76, 52), (340, 74, 53), (290, 74, 52), (250, 76, 47), (222, 80, 40),
           (207, 78, 34), (200, 58, 29), (196, 34, 26), (192, 29, 25)]
    loft(bm, [(0, 0, Z(y), hw * S, hz * S) for y, hw, hz in tee], 28)
    # pelvis in shorts, under the tee hem
    loft(bm, [(0, 0, Z(y), hw * S, hz * S) for y, hw, hz in ((455, 77, 49), (490, 77, 50), (520, 74, 49), (532, 60, 42))], 24)
    # neck
    loft(bm, [(0, 0.002, Z(y), hw * S, hz * S) for y, hw, hz in ((206, 26, 27), (192, 24, 25), (178, 22, 24))], 14)
    # head
    H = head_tables()
    loft(bm, [(0, cy * S, Z(y), hw * S, hz * S) for y, hw, hz, cy in H], 28)
    for s in (-1, 1):
        ellipsoid(bm, (s * 40 * S, 2 * S, Z(140)), 4.5 * S, 8 * S, 14 * S, 8, 6)                       # ears
    # satchel at the left hip (picture right), hanging in front of the arm
    t = bmesh.new()
    bmesh.ops.create_cube(t, size=1)
    bmesh.ops.scale(t, vec=(60 * S, 38 * S, 124 * S), verts=t.verts)
    bmesh.ops.bevel(t, geom=t.edges[:], offset=0.02, segments=2, affect='EDGES')
    bmesh.ops.translate(t, vec=(X(768), -0.07, Z(425)), verts=t.verts)
    merge(bm, t)
    body = finish(bm, 'body')

    # hair, in its own mesh object (all one dark texel) so it can be tuned alone
    hb = bmesh.new()
    rnd = random.Random(7)
    grow = 1.06

    def hairline(py_unused, ty, tx):
        # ty: -1 front .. +1 back, tx: |x| / hw
        return 98 + (ty + 1) / 2 * 56 + tx * 20

    shell = bmesh.new()
    rows_ = [(y,) + tuple(interp([(a, b, c, d) for a, b, c, d in H], y)) for y in range(60, 164, 5)]
    loft(shell, [(0, (cy + 1) * S, Z(y), hw * S * grow + 0.002, hz * S * grow + 0.002) for y, hw, hz, cy in rows_], 44)
    for f in list(shell.faces):
        c = f.calc_center_median()
        ty = (c.y - 0.0) / (46 * S)
        tx = abs(c.x) / (40 * S)
        if FLOOR - c.z / S > hairline(0, max(-1, min(1, ty)), tx):
            shell.faces.remove(f)
    merge(hb, shell)

    def skull(py, th, g=grow):
        hw, hz, cy = interp([(y, w, d, c) for y, w, d, c in H], py)
        return Vector((math.cos(th) * hw * S * g, (cy * S + math.sin(th) * hz * S * g), Z(py)))

    for i in range(260):        # crown and sides: short, dense, messy
        py = 54 + rnd.random() ** 0.7 * 100
        th = rnd.random() * math.tau
        p = skull(py, th, 1.04)
        ty = math.sin(th)
        low = FLOOR - p.z / S > hairline(0, max(-1, min(1, ty)), abs(math.cos(th))) - 4
        if low:
            continue
        n = Vector((math.cos(th), math.sin(th), 0.7 if py < 85 else 0.1)).normalized()
        droop = -0.55 if py > 100 else 0.0
        d = n + Vector((rnd.uniform(-.45, .45), rnd.uniform(0.0, 0.35), rnd.uniform(0.1, 0.5) + droop))
        cone(hb, p - n * 0.008, d, rnd.uniform(9, 19) * S, rnd.uniform(4, 6.5) * S)
    for i in range(22):         # fringe over the forehead and temples
        th = math.tau * 0.75 + rnd.uniform(-1.0, 1.0)
        py = 92 + rnd.random() * 12
        p = skull(py, th, 1.05)
        d = Vector((math.cos(th) * 0.6, -0.6, -0.6 + rnd.uniform(-0.1, 0.3)))
        cone(hb, p, d, rnd.uniform(11, 20) * S, rnd.uniform(3.5, 5.5) * S)
    # sample a dark hair pixel for the colour
    hair = finish(hb, 'hair_tmp', fixed_uv='hair')
    return body, hair


def pose_about(pivot, deg, axis='Y'):
    return Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-pivot)


def build_leg(side):
    """side -1: world -x (picture left), +1: picture right."""
    sx = CX + side * 41.5
    hip = Vector((X(sx), 0, Z(505)))
    knee = Vector((X(CX + side * 43), 0, Z(612)))
    # shorts leg, rolled cuff at the knee
    th = bmesh.new()
    rows = [(505, 37, 36), (540, 35.5, 35), (580, 32, 31), (598, 31, 30), (606, 31.5, 30.5), (607, 21, 20), (614, 19, 18)]
    loft(th, [(X(sx + side * 0.8 * (y - 505) / 100), 0.004, Z(y), hw * S, hz * S) for y, hw, hz in rows], 18)
    thigh = finish(th, f'thigh_{"L" if side < 0 else "R"}', origin=hip)
    # shin + shoe
    sh = bmesh.new()
    rows = [(606, 19, 18), (625, 18.5, 17.5), (650, 15.5, 15), (680, 12.5, 12.5), (708, 13, 13)]
    loft(sh, [(X(CX + side * 43.5), 0.002, Z(y), hw * S, hz * S) for y, hw, hz in rows], 14)
    # sneaker, toes splayed outwards
    ax = X(CX + side * 44)
    secs = [(-0.058, 0.030, 0.035, 0.032), (-0.022, 0.035, 0.055, 0.052), (0.035, 0.037, 0.034, 0.034),
            (0.095, 0.037, 0.026, 0.026), (0.148, 0.029, 0.021, 0.021), (0.176, 0.016, 0.016, 0.014)]
    shoe = bmesh.new()
    loft(shoe, [(0, l, zc, rx, rz) for l, rx, zc, rz in secs], 14, axis='y')
    bmesh.ops.rotate(shoe, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(side * 14) + math.pi, 3, 'Z'), verts=shoe.verts)
    bmesh.ops.translate(shoe, vec=(ax, -0.0, 0), verts=shoe.verts)
    merge(sh, shoe)
    shin = finish(sh, f'shin_{"L" if side < 0 else "R"}', origin=knee, parent=thigh)
    return thigh, shin


def build_arm(side):
    """T-pose in the picture; modelled there, projected there, then hung down by the side."""
    tag = 'L' if side < 0 else 'R'
    mirror = lambda p: p if side < 0 else 2 * CX - p
    sh = Vector((X(mirror(648)), 0, Z(235)))
    el = Vector((X(mirror(490)), 0, Z(239)))
    # (px from the left arm's perspective, half height, half depth)
    upper = [(652, 27, 25), (610, 26.5, 24), (575, 25, 23), (559, 24, 22), (558, 16, 14.5), (520, 14.5, 13.5), (490, 13.5, 12.5)]
    fore = [(490, 13.5, 12.5), (460, 12, 11), (432, 11, 10), (424, 10.5, 8)]
    hand = [(424, 10.5, 6.5), (412, 11.5, 6), (398, 11, 5.5), (386, 8.5, 4.5), (376, 4, 3)]
    yc = lambda px: 235 + (640 - px) / 265 * 8
    def ring(px, hh, hd):
        return (X(mirror(px)), 0.0, Z(yc(px)), hd * S, hh * S)      # axis 'x': r1 along y (depth), r2 along z
    hang = Matrix.Rotation(math.radians(84 * side), 4, 'Y')
    xf = Matrix.Translation(sh) @ hang @ Matrix.Translation(-sh)
    ua = bmesh.new()
    loft(ua, [ring(*r) for r in upper], 16, axis='x')
    arm = finish(ua, f'arm_{tag}', origin=sh, xform=xf)
    fa = bmesh.new()
    loft(fa, [ring(*r) for r in fore], 14, axis='x', caps=False)
    loft(fa, [ring(*r) for r in hand], 12, axis='x')
    # thumb
    ellipsoid(fa, (X(mirror(405)), -0.004, Z(yc(405) + 11)), 9 * S, 3.5 * S, 4 * S, 6, 4)
    forearm = finish(fa, f'fore_{tag}', origin=xf @ el, xform=xf, parent=arm)
    return arm, forearm


def clear():
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes): bpy.data.meshes.remove(me)


def preview(objs, atlas):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_cavity = False
    mat = bpy.data.materials.new('m'); mat.use_nodes = True
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    im = bpy.data.images.load(atlas); im.colorspace_settings.name = 'sRGB'
    tex.image = im
    mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    mat.node_tree.nodes.active = tex
    for ob in objs: ob.data.materials.append(mat)
    if sc.world is None: sc.world = bpy.data.worlds.new('w')
    sc.world.color = (1, 1, 1)
    sc.render.film_transparent = False
    views = {
        'front': (Vector((0, -5, Z(384))), (math.pi / 2, 0, 0), 1408 * S, (1408, 768)),
        'back': (Vector((0, 5, Z(384))), (math.pi / 2, 0, math.pi), 1408 * S, (1408, 768)),
        'side': (Vector((5, 0, 0.8)), (math.pi / 2, 0, math.pi / 2), 1.8, (700, 900)),
        'q3': (Vector((2.2, -2.6, 1.3)), None, 0, (800, 900)),
        'face': (Vector((0.5, -1.4, Z(140))), None, 0, (800, 800)),
    }
    for tag, (loc, rot, ortho, res) in views.items():
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
        cam.location = loc
        if ortho:
            cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho; cam.rotation_euler = rot
        else:
            tgt = Vector((0, 0, 0.78)) if tag == 'q3' else Vector((0, 0, Z(140)))
            cam.data.lens = 55 if tag == 'q3' else 85
            cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.filepath = os.path.join(PREVIEW, f'ramu_{tag}.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)


os.makedirs(OUT, exist_ok=True)
clear()
atlas, front_img = make_atlas()
_ys, _xs = np.mgrid[62:96, 672:746]
_dark = front_img[62:96, 672:746].mean(axis=2) < 0.16
HAIR_PIXELS = list(zip(_xs[_dark].tolist(), _ys[_dark].tolist()))
body, hair = build_body()
legs = [build_leg(-1), build_leg(1)]
arms = [build_arm(-1), build_arm(1)]
objs = [body, hair] + [o for pair in legs + arms for o in pair]
hair.name = 'hair'
for ob in bpy.context.scene.objects: ob.select_set(True)
bpy.context.view_layer.objects.active = body
path = os.path.join(OUT, 'ramu.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=True, export_normals=True, export_texcoords=True,
                          export_materials='NONE', export_vertex_color='NONE', export_animations=False)
tris = sum(len(p.vertices) - 2 for ob in objs for p in ob.data.polygons)
print(f'RAMU: {tris} triangles, {os.path.getsize(path) / 1024:.0f} KB')
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    preview(objs, atlas)
