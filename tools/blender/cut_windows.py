"""
See-through windows for the photo-built vehicles, so the people inside them show (src/world/props.ts seats).

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/cut_windows.py -- NAME [NAME ...]

The photo-built models (tools/triposr, import_vehicle.py) are one textured shell: their windows are painted on (the
Bolero's are open already). This finds them: the faces in the window band (WINDOWS: heights, and how far along the
vehicle) facing out to the side, front or back (not the roof), whose picture is dark and hardly coloured (the paint,
even a dark red, is more coloured); or inside a box of PANES; or a side's mirrored from the other's. They become their own mesh, `glass`, with the tinted
see-through material the modelled cars' glass has (the game draws it so: vehicleModels.ts, props.ts). A few faces
that are not dark but have glass all round them go too (a reflection, a sticker), and lone dark faces stay (a shadow
on a door).

Works on the finished public/models/<name>.glb (after split_wheels.py) and writes it back; run make_lod.py after it.
Run it once on that glb (a second run stops: the glass's pictures are gone).

Frame of the table: the game's, x to the vehicle's LEFT, y up, z FORWARD, metres (Blender: x, -z, y).
"""
import bpy, bmesh, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
argv = sys.argv[sys.argv.index('--') + 1:]

# name: (y from, y to), (z from, z to), darkest-enough (luminance, 0..1)[, mirror]. mirror: one side's windows caught
# the sky (bright): they are the other side's (+1: the left's, -1: the right's) mirrored, the vehicle being symmetric
WINDOWS = {
    'maruti': ((0.82, 1.3), (-1.45, 1.0), 0.3),
    'maruti_red': ((0.82, 1.3), (-1.45, 1.0), 0.3),
    'maruti_green': ((0.82, 1.3), (-1.45, 1.0), 0.3, 1),
    'bus': ((1.55, 2.75), (-4.7, 4.75), 0.3),
    'bus_green': ((1.55, 2.75), (-4.7, 4.75), 0.2),
    'truck': ((1.5, 2.45), (1.35, 2.8), 0.2),
}
# where a model's windows are not dark (the photo caught the sky in them), the panes as boxes: (x from, x to, y from,
# y to, z from, z to); a face whose middle is in one, and that faces out of it (not up), is glass whatever its colour
PANES = {
    # the truck's windows are as bright as its paint: the cab's two door windows and the windscreen (measured on side / front renders of the model)
    'truck': [(0.8, 2.0, 1.75, 2.4, 1.62, 2.45), (-2.0, -0.8, 1.75, 2.4, 1.62, 2.45), (-1.0, 1.0, 1.75, 2.45, 2.5, 3.2)],
}
GLASS = (0.05, 0.07, 0.09, 0.42)


def pixels(mat):
    """the base colour's picture (not the normal or roughness map)"""
    def up(sock, depth=0):
        for l in sock.links:
            n = l.from_node
            if n.type == 'TEX_IMAGE' and n.image:
                return n.image
            for i in n.inputs:
                if depth < 4 and (im := up(i, depth + 1)):
                    return im
        return None
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    im = up(bsdf.inputs['Base Color'])
    if not im:
        raise RuntimeError(f'{mat.name}: no picture')
    w, h = im.size
    return np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3]


def glass_material():
    m = bpy.data.materials.get('glass') or bpy.data.materials.new('glass')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*GLASS[:3], 1)
    b.inputs['Alpha'].default_value = GLASS[3]
    b.inputs['Roughness'].default_value = 0.06
    b.inputs['Metallic'].default_value = 0.3
    m.surface_render_method = 'BLENDED'
    m.use_backface_culling = False
    return m


def run(name):
    (y0, y1), (z0, z1), dark, *mirror = WINDOWS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(ROOT, 'public', 'models', name + '.glb')
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if any(m and m.name == 'glass' for o in meshes for m in o.data.materials):
        sys.exit(f'{name}: it has glass already (an earlier run): start again from split_wheels.py\'s glb (git)')
    body = max((o for o in meshes if not o.name.startswith('wheel_')), key=lambda o: len(o.data.polygons))
    photo = body.data.materials[0]
    mw = body.matrix_world.copy()
    body.parent = None
    body.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    px = pixels(photo)
    H, W, _ = px.shape

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active

    def look(f):
        """the face's picture: mean luminance and how coloured it is, over its corners and middle"""
        pts = [l[uv].uv for l in f.loops]
        pts.append(sum((p for p in pts), pts[0] * 0) / len(pts))
        cs = []
        for p in pts:
            u, v = p.x % 1.0, p.y % 1.0
            cs.append(px[min(H - 1, int(v * H)), min(W - 1, int(u * W))])
        c = np.mean(cs, 0)
        lum = float(c @ np.array([0.2126, 0.7152, 0.0722]))
        chroma = float(c.max() - c.min())     # how coloured (absolute: near black, any tint is a large share)
        return lum, chroma

    cand = set()
    for f in bm.faces:
        c = f.calc_center_median()
        gy, gz = c.z, -c.y                 # the game's y and z
        if not (y0 < gy < y1 and z0 < gz < z1):
            continue
        if abs(f.normal.z) > 0.75:          # the roof, a ledge
            continue
        lum, colour = look(f)
        if lum < dark and colour < 0.24:
            cand.add(f)
    for f in bm.faces:
        c = f.calc_center_median()
        g = (c.x, c.z, -c.y)
        if abs(f.normal.z) < 0.75 and any(all(b[2 * k] < g[k] < b[2 * k + 1] for k in range(3)) for b in PANES.get(name, ())):
            cand.add(f)
    # tidy: a face mostly ringed by glass is glass; a dark face with hardly any glass about it is not
    for _ in range(2):
        add, drop = set(), set()
        for f in bm.faces:
            c = f.calc_center_median()
            if not (y0 < c.z < y1 and z0 < -c.y < z1) or abs(f.normal.z) > 0.75:
                continue
            ring = {g for e in f.edges for g in e.link_faces if g is not f}
            if not ring:
                continue
            share = len(ring & cand) / len(ring)
            if f not in cand and share >= 0.67:
                add.add(f)
            elif f in cand and share < 0.2:
                drop.add(f)
        cand = (cand | add) - drop
    if mirror:
        from mathutils import kdtree
        src = mirror[0]
        band = [f for f in bm.faces if y0 < f.calc_center_median().z < y1 and z0 < -f.calc_center_median().y < z1
                and abs(f.normal.z) < 0.75]
        there = [f for f in band if f.calc_center_median().x * src > 0.1]
        kd = kdtree.KDTree(len(there))
        for i, f in enumerate(there):
            c = f.calc_center_median()
            kd.insert((0, c.y, c.z), i)
        kd.balance()
        for f in band:
            c = f.calc_center_median()
            if c.x * src < -0.1:
                cand.discard(f)
                if there[kd.find((0, c.y, c.z))[1]] in cand:
                    cand.add(f)
    print('WINDOWS', name, len(cand), 'of', len(bm.faces), 'faces')
    if os.environ.get('STATS'):              # what each side's band looks like, by length (to set WINDOWS)
        for side in (1, -1):
            print('  side', 'left' if side > 0 else 'right', '(luminance / colour)')
            for zb in np.arange(z0, z1, 0.25):
                row = []
                for yb in np.arange(y0, y1, 0.12):
                    fs = [f for f in bm.faces if zb < -f.calc_center_median().y < zb + 0.25 and yb < f.calc_center_median().z < yb + 0.12
                          and f.calc_center_median().x * side > 0.2 and abs(f.normal.z) < 0.75]
                    row.append('%4.2f/%4.2f' % tuple(np.median([look(f) for f in fs], 0)) if fs else '    -    ')
                print('  z %5.2f' % zb, ' '.join(row))

    # the panes into a mesh of their own, with the glass
    for f in bm.faces:
        f.select = f in cand
    bm.to_mesh(body.data)
    bm.free()
    gm = glass_material()
    body.data.materials.append(gm)
    for p in body.data.polygons:
        if p.select:
            p.material_index = len(body.data.materials) - 1
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    pane = next(o for o in bpy.context.selected_objects if o is not body)
    pane.name = pane.data.name = 'glass'
    pane.data.materials.clear()
    pane.data.materials.append(gm)
    body.data.materials.pop(index=len(body.data.materials) - 1)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_animations=False,
                              export_extras=True, export_image_format='AUTO', export_materials='EXPORT')
    print('  wrote', path, round(os.path.getsize(path) / 1e6, 2), 'MB')


for n in argv:
    run(n)
