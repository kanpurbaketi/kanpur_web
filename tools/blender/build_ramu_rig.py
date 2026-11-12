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
SKIN_LIFT = 0.86       # <1 lightens the skin (gamma on skin pixels); 1 = as generated
BODY_LIFT = 0.92       # <1 lightens everything a little
ANIMS = os.path.join(ROOT, 'assets', 'ramu_teen', 'anims')   # Mixamo FBX clips go here (see import_mixamo_clips)

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
img.colorspace_settings.name = 'Non-Color'          # edit the stored (sRGB-encoded) values as they are
import numpy as np
W0, H0 = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H0, W0, 4)
f = max(1, W0 // TEX)                                # box-filter down to TEX x TEX
px = px.reshape(H0 // f, f, W0 // f, f, 4).mean(axis=(1, 3)).reshape(-1, 4)
r, g, b = px[:, 0], px[:, 1], px[:, 2]
# skin: warm orange-brown (green about 0.55-0.8 of red, blue clearly lower); the khaki satchel is yellower, the shirt bluer
skin = np.clip((r - b - 0.05) / 0.12, 0, 1) * np.clip((0.82 - g / np.maximum(r, 1e-3)) / 0.08, 0, 1) * (r > g) * (g > b)
rgb = px[:, :3].copy()
lifted = np.power(rgb, BODY_LIFT)
fair = np.power(rgb, SKIN_LIFT) * np.array([1.06, 1.02, 0.97])      # lighter and a touch warmer
px[:, :3] = np.clip(lifted * (1 - skin[:, None]) + fair * skin[:, None], 0, 1)
w = skin > 0.5
print('RIG skin pixels', int(w.sum()), 'mean before', rgb[w].mean(axis=0).round(3), 'after', px[w, :3].mean(axis=0).round(3))
# write the edited pixels to a file and load that: the exporter re-reads images from their files
import tempfile
edited = bpy.data.images.new('ramu_tex_edit', TEX, TEX, alpha=False)
edited.colorspace_settings.name = 'Non-Color'
edited.pixels.foreach_set(px.ravel())
tmp = os.path.join(tempfile.gettempdir(), 'ramu_tex_edit.png')
edited.filepath_raw = tmp
edited.file_format = 'PNG'
edited.save()
img = bpy.data.images.load(tmp)
img.name = 'ramu_tex'
img.colorspace_settings.name = 'sRGB'
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
make_action('run', 15, run)
make_action('jump', 36, jump)
bpy.ops.object.mode_set(mode='OBJECT')
arm.animation_data.action = bpy.data.actions['idle']

# ---- Mixamo clips: bake any FBX in assets/ramu_teen/anims onto this skeleton ----------------------------------
def clip_name(stem):
    s = stem.lower()
    has = lambda *w: any(x in s for x in w)
    if has('crouch', 'sneak'):
        return 'crouch_walk' if has('walk', 'move') else 'crouch'
    for key, name in (('punch', 'punch'), ('jump', 'jump'), ('run', 'run'), ('walk', 'walk'), ('idle', 'idle'), ('kick', 'kick')):
        if key in s:
            return name
    return ''.join(ch if ch.isalnum() else '_' for ch in s).strip('_')


def import_mixamo_clips():
    import glob
    files = sorted(glob.glob(os.path.join(ANIMS, '*.fbx')))
    if not files:
        print('RIG no Mixamo clips in', ANIMS, '(procedural clips only)')
        return
    ours_hips = arm.data.bones['mixamorig:Hips'].head_local.length
    sc = bpy.context.scene
    for f in files:
        name = clip_name(os.path.splitext(os.path.basename(f))[0])
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=f)
        new = set(bpy.data.objects) - before
        src = next((o for o in new if o.type == 'ARMATURE'), None)
        if src is None or not src.animation_data or not src.animation_data.action:
            print('RIG skip (no armature/action):', f)
            for o in new: bpy.data.objects.remove(o, do_unlink=True)
            continue
        act = src.animation_data.action
        # bones may come as "mixamorig:X", "mixamorig1:X" or bare "X": match on the part after the colon
        mp = {b.name.split(':')[-1]: b.name for b in src.pose.bones}
        theirs_hips = next(b for b in src.data.bones if b.name.endswith('Hips')).head_local.length
        ratio = ours_hips / max(theirs_hips, 1e-6)
        f0, f1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
        old = bpy.data.actions.get(name)
        if old: bpy.data.actions.remove(old)
        new_act = bpy.data.actions.new(name)
        new_act.use_fake_user = True
        arm.animation_data.action = new_act
        samples = []
        for fr in range(f0, f1 + 1):
            sc.frame_set(fr)
            samples.append({b.name.split(':')[-1]: b.matrix_basis.copy() for b in src.pose.bones})
        # root motion: if the clip travels (not "in place"), keep only the vertical part of the hips movement
        hips_rest = REST_M['Hips'].to_3x3()
        drift = 0.0
        if samples:
            ds = [hips_rest @ (m['Hips'].translation * ratio) for m in samples]
            drift = max(max(d.x for d in ds) - min(d.x for d in ds), max(d.y for d in ds) - min(d.y for d in ds))
        for i, m in enumerate(samples):
            for pb in P:
                short = pb.name.split(':')[-1]
                if short not in m:
                    continue
                mb = m[short]
                pb.rotation_quaternion = mb.to_quaternion()
                if short == 'Hips':
                    loc = mb.translation * ratio
                    if drift > 0.25:
                        d = hips_rest @ loc
                        loc = hips_rest.inverted() @ Vector((0, 0, d.z))
                    pb.location = loc
                else:
                    pb.location = (0, 0, 0)
            key_all(1 + i)
        new_act.frame_range = (1, 1 + max(1, f1 - f0))
        print(f'RIG clip {name}: {f1 - f0 + 1} frames from {os.path.basename(f)}' + (' (root motion removed)' if drift > 0.25 else ''))
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        for a in list(bpy.data.actions):
            if '|' in a.name:                       # the importer's own action, already baked into `name`
                bpy.data.actions.remove(a)


bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
import_mixamo_clips()
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='OBJECT')
arm.animation_data.action = bpy.data.actions['idle']
sc0 = bpy.context.scene
sc0.frame_set(1)

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
    for act in sorted(bpy.data.actions, key=lambda a: a.name):
        name = act.name
        lo, hi = int(act.frame_range[0]), int(act.frame_range[1])
        frames = sorted({lo, lo + (hi - lo) // 3, lo + 2 * (hi - lo) // 3, hi})
        arm.animation_data.action = act
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
