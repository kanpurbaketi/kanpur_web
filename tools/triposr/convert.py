"""
Turns a TripoSR result (mesh.obj + texture.png) into a game model.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/triposr/convert.py -- <dir with mesh.obj, texture.png> <out.glb>
      --size W L H        real width, length, height in metres (the mesh is stretched to this box: TripoSR guesses depth badly)
      [--rear]            the photo showed the back of the thing (default: the side facing the camera is the front)
      [--level]           stand it level (for cars, buses: anything box-like photographed from above)
      [--yaw DEG]         extra turn about the vertical, if the automatic alignment is off
      [--tris N]          triangle budget (default 12000)
      [--preview DIR]     render four views there

TripoSR's frame: Z up, the photo was taken from +X. The output is metres, on the ground, front toward -Y in Blender
(the glTF export turns that into +Z forward, Y up, like the other models in public/models).
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]


def opt(name, n=1, default=None):
    if name not in argv:
        return default
    i = argv.index(name)
    return argv[i + 1:i + 1 + n]


W, L, H = [float(v) for v in opt('--size', 3)]
REAR = '--rear' in argv
YAW = float((opt('--yaw') or [0])[0])
TRIS = int((opt('--tris') or [12000])[0])
PREVIEW = (opt('--preview') or [None])[0]

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
bpy.ops.wm.obj_import(filepath=os.path.join(src, 'mesh.obj'), forward_axis='Y', up_axis='Z')
ob = bpy.context.selected_objects[0]
bpy.context.view_layer.objects.active = ob
me = ob.data

# drop small floating bits (TripoSR leaves crumbs around the object)
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
seen, islands = set(), []
for v in bm.verts:
    if v in seen:
        continue
    stack, isl = [v], []
    seen.add(v)
    while stack:
        a = stack.pop()
        isl.append(a)
        for e in a.link_edges:
            b = e.other_vert(a)
            if b not in seen:
                seen.add(b)
                stack.append(b)
    islands.append(isl)
big = max(len(i) for i in islands)
junk = [v for i in islands if len(i) < big * 0.02 for v in i]
bmesh.ops.delete(bm, geom=junk, context='VERTS')
bm.to_mesh(me)
bm.free()

# level it: a photo taken from above leaves the model pitched; a box-like thing stands lowest when it is level
if '--level' in argv:
    co = np.array([v.co[:] for v in me.vertices])
    sub = co[np.random.default_rng(0).choice(len(co), min(len(co), 6000), replace=False)]

    def height(rx, ry):
        R = np.array((Matrix.Rotation(math.radians(rx), 3, 'X') @ Matrix.Rotation(math.radians(ry), 3, 'Y')))
        z = sub @ R[2]
        return np.percentile(z, 99.5) - np.percentile(z, 0.5)

    grid = [(height(rx, ry), rx, ry) for rx in range(-24, 25, 3) for ry in range(-24, 25, 3)]
    _, bx, by = min(grid)
    fine = [(height(bx + dx * 0.5, by + dy * 0.5), bx + dx * 0.5, by + dy * 0.5) for dx in range(-5, 6) for dy in range(-5, 6)]
    _, bx, by = min(fine)
    me.transform((Matrix.Rotation(math.radians(bx), 4, 'X') @ Matrix.Rotation(math.radians(by), 4, 'Y')))
    print(f'levelled by {bx:.1f}, {by:.1f} degrees')

# align: the long horizontal axis becomes the length; the end that faced the camera (+X) is the front
co = np.array([v.co[:] for v in me.vertices])
xy = co[:, :2] - co[:, :2].mean(0)
# long axis from the footprint's bounding rectangle of least area (steadier than PCA on a lumpy mesh)
best = None
for deg in np.arange(0, 180, 1.0):
    a = math.radians(deg)
    d = np.array([math.cos(a), math.sin(a)]); n = np.array([-d[1], d[0]])
    le, wi = np.ptp(xy @ d), np.ptp(xy @ n)
    if best is None or le * wi < best[0]:
        best = (le * wi, a if le >= wi else a + math.pi / 2)
a = best[1]
d = np.array([math.cos(a), math.sin(a)])
if (d[0] < 0) != REAR:
    a += math.pi
# turn so that the front (direction a) points to -Y
rot = Matrix.Rotation(-math.pi / 2 - a + math.radians(YAW), 4, 'Z')
me.transform(rot)
co = np.array([v.co[:] for v in me.vertices])
lo, hi = co.min(0), co.max(0)
sc = Matrix.Diagonal((W / (hi[0] - lo[0]), L / (hi[1] - lo[1]), H / (hi[2] - lo[2]), 1))
me.transform(sc @ Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))
me.update()

tris = sum(len(p.vertices) - 2 for p in me.polygons)
if tris > TRIS:
    md = ob.modifiers.new('dec', 'DECIMATE')
    md.ratio = TRIS / tris
    bpy.ops.object.modifier_apply(modifier=md.name)
for p in me.polygons:
    p.use_smooth = True

mat = bpy.data.materials.new('photo')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = bpy.data.images.load(os.path.join(src, 'texture.png'))
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.55
bsdf.inputs['Metallic'].default_value = 0.1
me.materials.clear()
me.materials.append(mat)
ob.name = 'body'

for o in bpy.context.scene.objects:
    o.select_set(o is ob)
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_normals=True, export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=85,
                          export_animations=False)
print(f'MODEL {os.path.basename(out)}: {sum(len(p.vertices) - 2 for p in me.polygons)} triangles, {os.path.getsize(out) / 1024:.0f} KB')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x, scn.render.resolution_y = 640, 440
    w = bpy.data.worlds.new('w')
    scn.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.65, 0.72, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.2
    bpy.ops.mesh.primitive_plane_add(size=60)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scn.collection.objects.link(sun)
    r = max(W, L, H)
    name = os.path.splitext(os.path.basename(out))[0]
    for tag, dv in (('front', (0.75, -1, 0.4)), ('side', (1, 0.05, 0.25)), ('rear', (-0.75, 1, 0.4)), ('off', (-1, -0.7, 0.35))):
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        scn.collection.objects.link(cam)
        tgt = Vector((0, 0, H * 0.45))
        cam.location = tgt + Vector(dv).normalized() * r * 2.3
        cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scn.camera = cam
        scn.render.filepath = os.path.join(PREVIEW, f'{name}_{tag}.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)
