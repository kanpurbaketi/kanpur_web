"""
The ride operator's lever (assets/common_assets/lever.zip: source/Lever.fbx) -> public/models/lever.glb.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_lever.py -- path/to/Lever.fbx

The model comes from 3ds Max with Arnold/OSL shaders Blender can't read (they import blank), and 5 cm tall. Here:
  base    the slotted body and its screws, dark painted iron
  arm     the toothed quadrant and the stick, steel, with the red knob; its origin is on the pivot, so turning `arm`
          about its local x pulls the lever (the game: mela.ts)
scaled so the knob stands 0.95 m above the floor, on y = 0, the stick upright, pushed toward -z.
"""
import bpy, bmesh, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src = sys.argv[sys.argv.index('--') + 1]
OUT = os.path.join(ROOT, 'public', 'models', 'lever.glb')
KNOB_H = 0.95

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
for o in objs.values():
    o.parent = None
bpy.context.view_layer.update()


def mat(name, rgb, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    return m


IRON = mat('iron', (0.09, 0.12, 0.1), 0.4, 0.6)
STEEL = mat('steel', (0.55, 0.55, 0.56), 0.85, 0.35)
RED = mat('knob', (0.62, 0.05, 0.03), 0.0, 0.45)


def bake(o, m):
    """apply the object's transform into its mesh and give it one material"""
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix()
    o.data.materials.clear()
    o.data.materials.append(m)


bake(objs['Body'], IRON)
for n in ('1Screw', '2Screw1', '2Screw2'):
    bake(objs[n], STEEL)
bake(objs['Cog1'], STEEL)
bake(objs['Object001'], RED)

# which way is up: from the cog's middle to the knob
cog = objs['Cog1']
pts = [v.co for v in cog.data.vertices]
knob = sum((v.co for v in objs['Object001'].data.vertices), Vector()) / len(objs['Object001'].data.vertices)
# the pivot: the middle of the body's slot, at the cog's lowest third (the quadrant turns about the body's long axis' normal)
body = objs['Body']
bpts = [v.co for v in body.data.vertices]
bmin = Vector([min(p[i] for p in bpts) for i in range(3)])
bmax = Vector([max(p[i] for p in bpts) for i in range(3)])
cmin = Vector([min(p[i] for p in pts) for i in range(3)])
cmax = Vector([max(p[i] for p in pts) for i in range(3)])
print('BODY', bmin, bmax)
print('COG', cmin, cmax)
print('KNOB', knob)


def join(names, name):
    bpy.ops.object.select_all(action='DESELECT')
    for n in names:
        objs[n].select_set(True)
    bpy.context.view_layer.objects.active = objs[names[0]]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    return o


base = join(['Body', '1Screw', '2Screw1', '2Screw2'], 'base')
arm = join(['Cog1', 'Object001'], 'arm')

# the body's long axis (its slot runs along it) and its thin axis (its thickness); the stick leans in the plane of the long
# axis and up, so it turns about the remaining one
ext = bmax - bmin
axes = sorted(range(3), key=lambda i: ext[i])          # thin .. long
long_ax = axes[2]
# up is the direction from the body's centre to the knob, with the long-axis part taken out
bc = (bmin + bmax) / 2
up = knob - bc
up[long_ax] = 0
up_ax = max(range(3), key=lambda i: abs(up[i]))
sgn = 1 if up[up_ax] > 0 else -1
print('LONG', long_ax, 'UP', up_ax, sgn)

# frame: game y = up axis, game z = long axis (the lever swings along z), x = the third
side = 3 - long_ax - up_ax
R = Matrix.Identity(4)
cols = {0: side, 1: up_ax, 2: long_ax}
for gi, si in cols.items():
    for k in range(3):
        R[gi][k] = 0
    R[gi][si] = sgn if gi == 1 else 1
# keep it right-handed
if R.to_3x3().determinant() < 0:
    for k in range(3):
        R[0][k] = -R[0][k]
# Blender's export turns its z-up into glTF y-up: build in Blender axes (x, y=-gameZ, z=gameY)
G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
M = G2B @ R
for o in (base, arm):
    o.data.transform(M)
bpy.context.view_layer.update()

# scale: the knob's top at KNOB_H, the base's bottom on the floor, centred on the slot
allv = [base.matrix_world @ v.co for v in base.data.vertices] + [arm.matrix_world @ v.co for v in arm.data.vertices]
zmin = min(p.z for p in allv)
zmax = max(p.z for p in allv)
s = KNOB_H / (zmax - zmin)
bv = [v.co for v in base.data.vertices]
cx = (min(p.x for p in bv) + max(p.x for p in bv)) / 2
cy = (min(p.y for p in bv) + max(p.y for p in bv)) / 2
T = Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -zmin))
for o in (base, arm):
    o.data.transform(T)
# the arm's pivot: the middle of the cog wheel. Its lower half (below the body's top) is a half-wheel: as wide as the wheel,
# its middle on the wheel's middle, its lowest point one radius below the centre
bz = max(v.co.z for v in base.data.vertices)
low = [v.co for v in arm.data.vertices if v.co.z < bz]
y0, y1 = min(p.y for p in low), max(p.y for p in low)
piv = Vector((0, (y0 + y1) / 2, min(p.z for p in low) + (y1 - y0) / 2))
arm.data.transform(Matrix.Translation(-piv))
arm.location = piv
top = max(v.co.z for v in arm.data.vertices) + piv.z
print('SCALE', s, 'PIVOT', piv, 'TOP', top, 'BASE_TOP', bz)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_animations=False, export_materials='EXPORT')
print('wrote', OUT, os.path.getsize(OUT))
