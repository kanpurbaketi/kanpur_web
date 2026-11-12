"""
Prepares the rigged Ramu (assets/ramu_teen/ramu_rigged.fbx: a Mixamo skeleton on the generated mesh) for the game
and bakes procedural idle / walk / jog / run / jump animations onto it. Output: public/models/ramu_rig.glb.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_ramu_rig.py -- [--preview DIR]

Steps: import the FBX, bring it to metres and to a 1.52 m teenager, bake the transforms into the mesh and bones,
make a plain single-texture material (2048 px JPEG), key the animations in armature space (so they do not depend on the
bones' odd local axes), export a GLB with the skin and every action.
Blender: Z up, the character faces -Y (glTF +Z).
"""
import bpy, math, os, sys
from mathutils import Matrix, Vector, Quaternion, Euler

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'assets', 'ramu_teen', 'ramu_rigged.fbx')
OUT = os.path.join(ROOT, 'public', 'models')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
HEIGHT = 1.52
TEX = 2048
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

# ---- units: bake object transforms, scale to the target height ---------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
vs = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
h = max(v.z for v in vs) - min(v.z for v in vs)
k = HEIGHT / h
for ob in (mesh, arm):
    ob.scale = ob.scale * k
    ob.location = ob.location * k
for ob in (mesh, arm):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mesh.parent = arm
mesh.matrix_parent_inverse = arm.matrix_world.inverted()
vs = [v.co for v in mesh.data.vertices]
lo = min(v.z for v in vs)
print('RIG height', round(max(v.z for v in vs) - lo, 3), 'feet z', round(lo, 3))

# ---- material: one base-colour texture ---------------------------------------------------------------------
img = bpy.data.images[0]
img.scale(TEX, TEX)
img.pack()
mat = mesh.data.materials[0]
mat.use_nodes = True
nt = mat.node_tree
for n in list(nt.nodes):
    if n.type == 'NORMAL_MAP':
        nt.nodes.remove(n)
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Roughness'].default_value = 0.8
bsdf.inputs['Metallic'].default_value = 0.0
for n in nt.nodes:
    if n.type == 'TEX_IMAGE':
        n.image = img
        nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
mat.name = 'ramu'

# ---- animation helpers -------------------------------------------------------------------------------------
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
P = arm.pose.bones
REST = {b.name.split(':')[-1]: b.bone.matrix_local.to_quaternion() for b in P}        # armature-space rest orientation of each bone
REST_M = {b.name.split(':')[-1]: b.bone.matrix_local.copy() for b in P}
for b in P:
    b.rotation_mode = 'QUATERNION'
SIDE = Vector((1, 0, 0))      # armature x: the character's left-right axis (sagittal rotations are about it)
FWD = Vector((0, -1, 0))      # the way he faces
UP = Vector((0, 0, 1))


def rot(name, axis, deg):
    """Rotate a bone by `deg` about an armature-space axis (accumulates down the chain like a real skeleton)."""
    q = Quaternion(axis, math.radians(deg))
    r = REST[name]
    P['mixamorig:' + name].rotation_quaternion = r.inverted() @ q @ r


def rot_multi(name, parts):
    q = Quaternion((1, 0, 0, 0))
    for axis, deg in parts:
        q = Quaternion(axis, math.radians(deg)) @ q
    r = REST[name]
    P['mixamorig:' + name].rotation_quaternion = r.inverted() @ q @ r


def hips_offset(dx, dy, dz):
    """Move the root in armature space (x side, y forward-back, z up), in metres."""
    b = P['mixamorig:Hips']
    d = REST_M['Hips'].to_3x3().inverted() @ Vector((dx, dy, dz))
    b.location = d


def pose_rest():
    for b in P:
        b.rotation_quaternion = (1, 0, 0, 0)
        b.location = (0, 0, 0)


def arms_down(amount=1.0):
    # T-pose arms hang: left arm (+x side) rotates about the forward axis so the hand goes down
    rot_multi('LeftArm', [(FWD, -72 * amount)])
    rot_multi('RightArm', [(FWD, 72 * amount)])
    rot_multi('LeftShoulder', [(FWD, -6 * amount)])
    rot_multi('RightShoulder', [(FWD, 6 * amount)])


def finger_curl(amount):
    for side in ('Left', 'Right'):
        for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb'):
            for i in (1, 2, 3):
                n = f'{side}Hand{f}{i}'
                if 'mixamorig:' + n in P:
                    # curl about the bone-local x of the rest pose, a little per joint
                    P['mixamorig:' + n].rotation_quaternion = Quaternion((1, 0, 0), math.radians(amount * (18 + 6 * i)))


def key_all(frame):
    for b in P:
        b.keyframe_insert('rotation_quaternion', frame=frame)
        b.keyframe_insert('location', frame=frame)


def make_action(name, frames, pose_fn, loop=True):
    pose_rest()
    arm.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    for f in range(frames + 1):
        t = f / frames
        pose_rest()
        pose_fn(t)
        key_all(1 + f)
    if hasattr(act, 'fcurves'):
        pass
    act.frame_range = (1, 1 + frames)
    return act


S = lambda x: math.sin(x * math.tau)
C = lambda x: math.cos(x * math.tau)


def gait(t, hip_swing, knee, arm_swing, lean, bob, elbow, torso_twist=4, spread=0.0, stride_h=0.0):
    """Cyclic walk/run pose at phase t in [0,1]: left leg leads at t=0."""
    for side, ph, sg in (('Left', 0.0, 1), ('Right', 0.5, -1)):
        a = S(t + ph)                                        # thigh angle: + forward
        b = C(t + ph)                                        # its velocity
        rot_multi(f'{side}UpLeg', [(SIDE, -hip_swing * a - lean * 0.3), (FWD, sg * spread)])
        k = knee * max(0.0, -b) ** 1.0 + 6 * max(0.0, a)    # knee flexes as the leg swings through
        rot(f'{side}Leg', SIDE, k)
        rot(f'{side}Foot', SIDE, -0.5 * k + 8 * max(0.0, -b) * (hip_swing / 40) - 6 * a)
        rot(f'{side}ToeBase', SIDE, 10 * max(0.0, b))
        # arms opposite to the legs
        arot = arm_swing * a * -1
        arms = {'Left': -72, 'Right': 72}
        rot_multi(f'{side}Arm', [(FWD, arms[side]), (SIDE, arot)])
        rot(f'{side}ForeArm', SIDE, -(elbow + 0.4 * arm_swing * max(0.0, -a)) )
    rot('Spine', SIDE, lean)
    rot('Spine1', SIDE, lean * 0.5)
    rot('Spine2', UP, torso_twist * S(t))
    rot('Neck', SIDE, -lean * 0.7)
    rot('Head', SIDE, -lean * 0.4)
    hips_offset(0.012 * S(t), 0.0, bob * (abs(S(t * 2 + 0.25)) - 0.5) - stride_h)
    rot('Hips', UP, -torso_twist * 0.8 * S(t))
    finger_curl(0.6)


def idle(t):
    arms_down(1.0)
    rot('Spine', SIDE, 1.2 * S(t))
    rot('Spine1', SIDE, 1.0 * S(t))
    rot('Spine2', SIDE, 1.0 * S(t))
    rot('Head', SIDE, -1.5 * S(t))
    rot('Neck', SIDE, -1.0 * S(t))
    rot('LeftShoulder', FWD, -6 - 1.5 * S(t))
    rot('RightShoulder', FWD, 6 + 1.5 * S(t))
    rot('LeftForeArm', SIDE, -10)
    rot('RightForeArm', SIDE, -10)
    rot('LeftUpLeg', SIDE, 0)
    hips_offset(0, 0, 0.004 * S(t))
    finger_curl(0.8)


def walk(t): gait(t, hip_swing=24, knee=42, arm_swing=22, lean=2, bob=0.03, elbow=12)
def jog(t): gait(t, hip_swing=38, knee=75, arm_swing=36, lean=7, bob=0.045, elbow=48, torso_twist=6)
def run(t): gait(t, hip_swing=52, knee=105, arm_swing=52, lean=14, bob=0.06, elbow=78, torso_twist=8, stride_h=0.0)


def jump(t):
    # 0..0.25 crouch, 0.25..0.7 airborne (legs tucked, arms up), 0.7..1 land and recover
    def smooth(a, b, x): x = min(1, max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x)
    crouch = smooth(0.0, 0.2, t) * (1 - smooth(0.2, 0.3, t)) + smooth(0.72, 0.82, t) * (1 - smooth(0.82, 1.0, t))
    air = smooth(0.25, 0.4, t) * (1 - smooth(0.62, 0.78, t))
    for side, sg in (('Left', 1), ('Right', -1)):
        rot(f'{side}UpLeg', SIDE, -(55 * crouch + 35 * air))
        rot(f'{side}Leg', SIDE, 80 * crouch + 60 * air)
        rot(f'{side}Foot', SIDE, -25 * crouch + 20 * air)
        rot_multi(f'{side}Arm', [(FWD, sg * (-72 + 60 * air - 20 * crouch)), (SIDE, -40 * crouch + 25 * air)])
        rot(f'{side}ForeArm', SIDE, -(20 + 30 * air + 25 * crouch))
    rot('Spine', SIDE, 14 * crouch)
    rot('Spine1', SIDE, 8 * crouch)
    rot('Head', SIDE, -8 * crouch)
    hips_offset(0, 0.02 * crouch, -0.2 * crouch)
    finger_curl(0.5)


make_action('idle', 90, idle)
make_action('walk', 30, walk)
make_action('jog', 21, jog)
make_action('run', 15, run)
make_action('jump', 36, jump)
bpy.ops.object.mode_set(mode='OBJECT')
arm.animation_data.action = bpy.data.actions['idle']

# ---- preview renders (side view and front view of a few frames) --------------------------------------------
def preview():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'
    if sc.world is None: sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.8, 0.8, 0.8)
    sc.render.resolution_x, sc.render.resolution_y = 520, 640
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0
    sc.camera = cam
    jobs = [('idle', [1]), ('walk', [1, 8, 16, 23]), ('jog', [1, 6, 11, 16]), ('run', [1, 5, 9, 13]), ('jump', [1, 8, 16, 26])]
    for name, frames in jobs:
        arm.animation_data.action = bpy.data.actions[name]
        for f in frames:
            sc.frame_set(f)
            for tag, loc, rot_ in (('s', (6, 0, 0.8), (math.pi / 2, 0, math.pi / 2)), ('f', (0, -6, 0.8), (math.pi / 2, 0, 0))):
                cam.location = loc
                cam.rotation_euler = rot_
                sc.render.filepath = os.path.join(PREVIEW, f'{name}_{f:02d}_{tag}.png')
                bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    preview()

# ---- export ------------------------------------------------------------------------------------------------
os.makedirs(OUT, exist_ok=True)
for ob in bpy.context.scene.objects:
    ob.select_set(True)
path = os.path.join(OUT, 'ramu_rig.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
                          export_skins=True, export_animations=True, export_animation_mode='ACTIONS',
                          export_image_format='JPEG', export_jpeg_quality=88, export_materials='EXPORT')
print('RIG exported', round(os.path.getsize(path) / 1e6, 2), 'MB')
