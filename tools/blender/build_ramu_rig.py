"""
Prepares the rigged Ramu (assets/ramu_teen/ramu_rigged.fbx: a Mixamo skeleton on the generated mesh) for the game
and bakes procedural idle / walk / jog / run / jump animations onto it. Output: public/models/ramu_rig.glb.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_ramu_rig.py -- [--char NAME] [--preview DIR]

--char picks the character (default ramu): the same steps and the same clips make the people of the crowd
(uncle -> uncle_rig.glb, security -> security_rig.glb, college_girl -> college_girl_rig.glb, college_boy -> college_boy_rig.glb, aunty -> aunty_rig.glb), so they move exactly as Ramu does.

Steps: import the FBX, bring it to metres and to a 1.52 m teenager, bake the transforms into the mesh and bones,
make a plain single-texture material (2048 px JPEG), key the animations in armature space (so they do not depend on the
bones' odd local axes), export a GLB with the skin and every action.
Blender: Z up, the character faces -Y (glTF +Z).
"""
import bpy, math, os, sys
from mathutils import Matrix, Vector, Quaternion, Euler

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'models')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
ONLY = set(argv[argv.index('--only') + 1].split(',')) if '--only' in argv else None   # preview just these clips
# character -> (rigged FBX, output file, height in metres, texture size)
CHARS = {
    'ramu': ('ramu_teen/ramu_rigged.fbx', 'ramu_rig.glb', 1.52, 2048),
    'uncle': ('uncle/uncle_rigged.fbx', 'uncle_rig.glb', 1.66, 1024),
    'security': ('security/security_fat_rigged.fbx', 'security_rig.glb', 1.72, 1024),
    'college_girl': ('college_girl/college_girl_rigged.fbx', 'college_girl_rig.glb', 1.58, 1024),
    'college_boy': ('college_boy/college_boy_rigged.fbx', 'college_boy_rig.glb', 1.70, 1024),
    'aunty': ('aunty/aunty_rigged.fbx', 'aunty_rig.glb', 1.56, 1024),
}
CHAR = argv[argv.index('--char') + 1] if '--char' in argv else 'ramu'
SRC, OUT_NAME, HEIGHT, TEX = CHARS[CHAR]
SRC = os.path.join(ROOT, 'assets', SRC)
FPS = 30
SKIN_LIFT = 1.0        # skin is left as generated: the game's Settings > Skin tone slider lightens / darkens it live
BODY_LIFT = 0.92       # <1 lightens everything a little
ANIMS = os.path.join(ROOT, 'assets', 'anims')   # Mixamo FBX clips, shared by every character (see import_mixamo_clips)
KEEP_ROOT = {'fall', 'fall2', 'get_up'}
# clips in the folder that nothing plays yet (every clip baked goes into every character's file): left out until used
UNUSED = {'falling', 'gunplay', 'sweep fall', 'throw object'}    # clips that keep their travel: a man knocked out ends up lying where the fall takes him

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
fair = np.power(rgb, SKIN_LIFT)
px[:, :3] = np.clip(lifted * (1 - skin[:, None]) + fair * skin[:, None], 0, 1)
w = skin > 0.5
print('RIG skin pixels', int(w.sum()), 'mean before', rgb[w].mean(axis=0).round(3), 'after', px[w, :3].mean(axis=0).round(3))
# write the edited pixels to a file and load that: the exporter re-reads images from their files
import tempfile
edited = bpy.data.images.new('ramu_tex_edit', TEX, TEX, alpha=False)
edited.colorspace_settings.name = 'Non-Color'
edited.pixels.foreach_set(px.ravel())
tmp = os.path.join(tempfile.gettempdir(), CHAR + '_tex_edit.png')
edited.filepath_raw = tmp
edited.file_format = 'PNG'
edited.save()
img = bpy.data.images.load(tmp)
img.name = CHAR + '_tex'
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
mat.name = CHAR
mat.blend_method = 'OPAQUE'        # the FBX comes in as alpha-hashed; the texture has no real transparency

# ---- the face: a mouth that opens, eyes that close, and a scowl (three shape keys), for talking, blinking, anger --
# The faces are one painted skin with no jaw or lids, so both are made by moving the skin: the lower lip and chin drop,
# the upper lid slides down over the painted eye. Where they are was read off a front view of each head (600 px across
# 0.3 m, centred on the head: tools: a front ortho render, x = cx + (px - 300) / 2000, z = top - 0.13 - (py - 300) / 2000):
# the eyes' centres and width, the line where the lips meet and its width. The game darkens the parted lips
# (src/world/face.ts) from the same landmarks, exported on the mesh.
FACE = {
    'ramu': dict(eyes=[(228, 362), (370, 362)], ew=52, mouth=(293, 490), mw=110),
    'uncle': dict(eyes=[(228, 292), (360, 292)], ew=52, mouth=(300, 421), mw=125, lid=0.6),       # his brows sit low
    'security': dict(eyes=[(222, 325), (365, 325)], ew=52, mouth=(298, 470), mw=100, lid=0.7),
    'college_girl': dict(eyes=[(265, 283), (400, 283)], ew=48, mouth=(332, 412), mw=95),
    'college_boy': dict(eyes=[(232, 298), (355, 298)], ew=50, mouth=(295, 428), mw=110),
    'aunty': dict(eyes=[(198, 256), (322, 256)], ew=50, mouth=(262, 382), mw=110),
}


def build_face():
    import bmesh
    lm = FACE.get(CHAR)
    if not lm:
        return
    me = mesh.data
    top = max(v.co.z for v in me.vertices)
    head = [v.co for v in me.vertices if v.co.z > top - 0.26 and abs(v.co.x) < 0.13]
    cx = (min(v.x for v in head) + max(v.x for v in head)) / 2
    cy = (min(v.y for v in head) + max(v.y for v in head)) / 2          # the head's middle, front to back
    P2 = lambda p: (cx + (p[0] - 300) / 2000, top - 0.13 - (p[1] - 300) / 2000)
    eyes = [P2(e) for e in lm['eyes']]
    ehw = lm['ew'] / 2000 / 2
    mx, mz = P2(lm['mouth'])
    mhw = lm['mw'] / 2000 / 2
    front = lambda co: co.y < cy - 0.02                                 # the face, not the back of the head

    # more skin to move round the eyes and the mouth: their faces cut in three each way (weights and UVs carry over)
    bm = bmesh.new(); bm.from_mesh(me)
    near = lambda c: front(c) and (any(abs(c.x - ex) < ehw * 1.8 and abs(c.z - ez) < ehw * 1.3 for ex, ez in eyes)
                                   or (abs(c.x - mx) < mhw * 1.5 and mz - 0.085 < c.z < mz + 0.025))
    faces = [f for f in bm.faces if near(f.calc_center_median())]
    edges = list({e for f in faces for e in f.edges})
    n0 = len(bm.verts)
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=2, use_grid_fill=True)
    bm.to_mesh(me); bm.free()
    print(f'RIG face: {len(faces)} faces round the eyes and mouth cut finer, {n0} -> {len(me.vertices)} vertices')

    smooth = lambda a, b, x: 0.0 if x <= a else 1.0 if x >= b else (lambda t: t * t * (3 - 2 * t))((x - a) / (b - a))
    mesh.shape_key_add(name='Basis', from_mix=False)
    mouth = mesh.shape_key_add(name='mouth_open', from_mix=False)
    blink = mesh.shape_key_add(name='blink', from_mix=False)
    angry = mesh.shape_key_add(name='angry', from_mix=False)             # after the others: the game's shader reads key 0
    D = 0.008                                                            # the lower lip drops this much, wide open
    moved = [0, 0, 0]
    for i, v in enumerate(me.vertices):
        c = v.co
        if not front(c):
            continue
        # mouth: the lower lip and the chin under it down (and a little back), the upper lip a touch up
        lat = 1 - smooth(mhw * 0.15, mhw * 1.05, abs(c.x - mx))      # open in the middle, the corners stay shut
        if lat > 0:
            t = mz - c.z
            if 0 < t < 0.085:
                d = D * (1 - smooth(0.03, 0.085, t)) * lat
                mouth.data[i].co = c + Vector((0, d * 0.25, -d)); moved[0] += 1
            elif -0.016 < t <= 0:
                d = 0.25 * D * (1 - smooth(0.004, 0.016, -t)) * lat
                mouth.data[i].co = c + Vector((0, 0, d)); moved[0] += 1
        # blink: what lies between the lower lid's line and the crease above folds down onto that line, the painted eye
        # pressed thin under the upper lid's skin
        for ex, ez in eyes:
            lat = 1 - smooth(ehw * 1.0, ehw * 1.55, abs(c.x - ex))
            eb, et, lt = ez - ehw * 0.55, ez + ehw * 0.42, ez + ehw * lm.get('lid', 0.9)
            if lat <= 0 or not eb < c.z < lt:
                continue
            z2 = eb + (c.z - eb) * 0.08 if c.z <= et else eb + (et - eb) * 0.08 + (c.z - et) * (lt - eb - (et - eb) * 0.08) / (lt - et)
            blink.data[i].co = c + Vector((0, -0.0015 * lat, (z2 - c.z) * lat)); moved[1] += 1
        # angry: the brows down and drawn together (the inner ends most), the lids narrowed (a third of a blink, the lower
        # lid up a little), the corners of the mouth pressed down
        a = Vector((0, 0, 0))
        for ex, ez in eyes:
            inward = 1 if mx > ex else -1
            u = (c.x - ex) / ehw * inward                                # across the eye: -1 outer corner .. +1 inner
            lat = 1 - smooth(ehw * 1.5, ehw * 2.1, abs(c.x - ex)) if u < 1.5 else 1 - smooth(1.5, 2.3, u)
            if lat <= 0:
                continue
            h = (c.z - ez) / ehw                                         # up from the eye's middle, in half-widths
            brow = smooth(0.4, 1.3, h) * (1 - smooth(2.6, 3.8, h))       # the band of the brow, above the lid's crease
            k = lat * brow * (0.35 + 0.65 * smooth(-1.0, 1.2, u))
            a += Vector((0.0016 * inward * k, -0.0008 * k, -0.0042 * k))
            eb, et, lt = ez - ehw * 0.55, ez + ehw * 0.42, ez + ehw * lm.get('lid', 0.9)
            lat2 = 1 - smooth(ehw * 1.0, ehw * 1.55, abs(c.x - ex))
            if lat2 > 0 and eb < c.z < lt:                              # a third of the blink
                z2 = eb + (c.z - eb) * 0.08 if c.z <= et else eb + (et - eb) * 0.08 + (c.z - et) * (lt - eb - (et - eb) * 0.08) / (lt - et)
                a.z += (z2 - c.z) * lat2 * 0.3
            if lat2 > 0 and ez - ehw * 1.3 < c.z <= eb:                 # the lower lid up
                a.z += 0.0011 * lat2 * smooth(ez - ehw * 1.3, eb, c.z)
        corner = abs(c.x - mx) / mhw                                     # the mouth's corners at about 1
        if 0.45 < corner < 1.7 and abs(c.z - mz) < 0.016:
            k = math.exp(-((corner - 1.0) / 0.32) ** 2) * (1 - smooth(0.004, 0.016, abs(c.z - mz)))
            a.z -= 0.0026 * k
        if a.length > 1e-6:
            angry.data[i].co = c + a; moved[2] += 1
    print(f'RIG face: mouth moves {moved[0]} vertices, blink {moved[1]}, angry {moved[2]}')
    # where they are, in the glTF's frame (x, y up, z forward = -Blender y), for the game's shader
    mesh['face'] = {'mouth': [mx, mz, -(cy - 0.02)], 'mhw': mhw, 'eyes': [[ex, ez] for ex, ez in eyes], 'ehw': ehw}


build_face()
if '--face-preview' in argv:          # renders of the head with the mouth and eyes shut and open, then stop (no export)
    FP = argv[argv.index('--face-preview') + 1]
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = sc.render.resolution_y = 600
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 0.3
    top = max(v.co.z for v in mesh.data.vertices)
    head = [v.co for v in mesh.data.vertices if v.co.z > top - 0.26 and abs(v.co.x) < 0.13]
    cam.location = ((min(v.x for v in head) + max(v.x for v in head)) / 2, -3, top - 0.13); cam.rotation_euler = (1.5708, 0, 0)
    sc.camera = cam
    keys = mesh.data.shape_keys.key_blocks
    for tag, m, b, g in (('rest', 0, 0, 0), ('talk', 1, 0, 0), ('blink', 0, 1, 0), ('angry', 0, 0, 1), ('angry_talk', 0.6, 0, 1)):
        keys['mouth_open'].value = m; keys['blink'].value = b; keys['angry'].value = g
        sc.render.filepath = os.path.join(FP, f'{CHAR}_{tag}.png')
        bpy.ops.render.render(write_still=True)
    sys.exit(0)

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
    if name not in REST:              # a lighter rig (no toes / fingers): nothing to turn
        return
    q = Quaternion(axis, math.radians(deg))
    r = REST[name]
    P['mixamorig:' + name].rotation_quaternion = r.inverted() @ q @ r


def rot_multi(name, parts):
    if name not in REST:
        return
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
# file name (lower case) contains ... -> clip name in the game. First match wins, so the particular come before the general
# ("Fighting Idle" is not the idle, "Taking Punch" is not the punch, "Shove Reaction" is not a hit).
CLIP_RULES = (
    (('stomach',), 'stomach_hit'),
    (('crouch', 'walk'), 'crouch_walk'), (('crouched',), 'crouch_walk'), (('crouch',), 'crouch'), (('sneak',), 'crouch'),
    (('fighting idle',), 'fight_idle'), (('fight idle',), 'fight_idle'), (('boxing idle',), 'fight_idle'),
    (('shove',), 'shove'), (('stumble',), 'shove'),
    (('block',), 'block'),
    (('getting up',), 'get_up'), (('get up',), 'get_up'), (('stand up',), 'get_up'),
    (('forward', 'death'), 'fall2'), (('falling forward',), 'fall2'),
    (('knocked',), 'fall'), (('death',), 'fall'), (('dying',), 'fall'), (('falling',), 'fall'),
    (('taking punch',), 'hit'), (('hit to body',), 'hit2'), (('body hit',), 'hit2'), (('reaction',), 'hit'), (('hit',), 'hit'),
    (('kick',), 'kick'), (('punch',), 'punch'), (('jump',), 'jump'), (('run',), 'run'), (('walk',), 'walk'),
    (('looking around',), 'look_around'), (('arguing',), 'argue'), (('phone',), 'phone'),
    (('pocket',), 'pockets'), (('shaking head',), 'head_no'), (('angry point',), 'angry_point'),
    (('disappointed',), 'disappointed'), (('sitting', 'talking'), 'sitting_talking'), (('talking',), 'talk'), (('push',), 'push'),
    (('idle',), 'idle'),
)


def clip_name(stem):
    s = stem.lower()
    for words, name in CLIP_RULES:
        if all(w in s for w in words):
            return name
    return ''.join(ch if ch.isalnum() else '_' for ch in s).strip('_')


def import_mixamo_clips():
    import glob
    files = sorted(f for f in glob.glob(os.path.join(ANIMS, '*.fbx')) if os.path.splitext(os.path.basename(f))[0].lower() not in UNUSED)
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
        keep = name in KEEP_ROOT
        for i, m in enumerate(samples):
            pose_rest()                             # bones the clip does not have (fingers, on a lighter rig) stay at rest
            for pb in P:
                short = pb.name.split(':')[-1]
                if short not in m:
                    continue
                mb = m[short]
                pb.rotation_quaternion = mb.to_quaternion()
                if short == 'Hips':
                    loc = mb.translation * ratio
                    if drift > 0.25 and not keep:
                        d = hips_rest @ loc
                        loc = hips_rest.inverted() @ Vector((0, 0, d.z))
                    pb.location = loc
                else:
                    pb.location = (0, 0, 0)
            key_all(1 + i)
        new_act.frame_range = (1, 1 + max(1, f1 - f0))
        print(f'RIG clip {name}: {f1 - f0 + 1} frames from {os.path.basename(f)}' + (' (root motion removed)' if drift > 0.25 and not keep else f' (travels {drift:.2f} m)' if drift > 0.25 else ''))
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        for a in list(bpy.data.actions):
            if '|' in a.name:                       # the importer's own action, already baked into `name`
                bpy.data.actions.remove(a)


bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
import_mixamo_clips()


# ---- clips made here by reaching: a hand on the stomach, a one-hand push ------------------------------------
# The body is posed as usual (base(t)); the right wrist is pulled by IK toward target(t) (armature space, metres) with a
# weight, the elbow kept out and back by a pole; the result is read back as plain rotations and keyed like any clip.

def smooth(a, b, x):
    x = min(1.0, max(0.0, (x - a) / (b - a)))
    return x * x * (3 - 2 * x)


def body_front(z, half_w=0.06):
    # y of the front of the body at height z (armature space; the front is -y)
    inv = arm.matrix_world.inverted() @ mesh.matrix_world
    ys = [p.y for p in (inv @ v.co for v in mesh.data.vertices) if abs(p.z - z) < 0.025 and abs(p.x) < half_w]
    return min(ys) if ys else -0.12


def reach_clip(name, frames, base, target, pole, hand=None):
    sc = bpy.context.scene
    arm.animation_data.action = None
    tgt = bpy.data.objects.new(name + '_ik', None); sc.collection.objects.link(tgt)
    pol = bpy.data.objects.new(name + '_pole', None); sc.collection.objects.link(pol)
    pol.location = arm.matrix_world @ Vector(pole)
    fore = P['mixamorig:RightForeArm']
    c = fore.constraints.new('IK')
    c.target, c.pole_target, c.chain_count, c.pole_angle = tgt, pol, 2, math.radians(POLE_ANGLE)
    chain = [P['mixamorig:RightArm'], fore]
    got = []
    for f in range(frames + 1):
        t = f / frames
        pose_rest(); base(t)
        pos, w = target(t)
        tgt.location = arm.matrix_world @ Vector(pos)
        c.influence = w
        bpy.context.view_layer.update()
        got.append([b.matrix.copy() for b in chain])
    fore.constraints.remove(c)
    bpy.data.objects.remove(tgt, do_unlink=True); bpy.data.objects.remove(pol, do_unlink=True)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    for f in range(frames + 1):
        t = f / frames
        pose_rest(); base(t)
        bpy.context.view_layer.update()
        for b, m in zip(chain, got[f]):
            b.matrix = m
            bpy.context.view_layer.update()
        if hand: hand(t)
        key_all(1 + f)
    act.frame_range = (1, 1 + frames)
    print(f'RIG clip {name}: {frames + 1} frames (made here)')


POLE_ANGLE = float(argv[argv.index('--pole') + 1]) if '--pole' in argv else -90
_arg = lambda k, d: float(argv[argv.index(k) + 1]) if k in argv else d
HAND_TWIST, HAND_BEND, PUSH_BEND = _arg('--twist', 80), _arg('--bend', -40), _arg('--pbend', 60)
SH = REST_M['RightArm'].translation.copy()          # the right shoulder (his right is -x)
BELLY_Z = REST_M['Spine1'].translation.z - 0.02
CHEST_Z = REST_M['Spine2'].translation.z


def env_stomach(t): return smooth(0.0, 0.22, t) * (1 - smooth(0.8, 1.0, t))


def stomach_base(t):
    # idle, bending a little over the stomach while the hand is on it
    on = env_stomach(t)
    idle(0.0)
    rot('Spine', SIDE, 5 * on); rot('Spine1', SIDE, 4 * on)
    rot('Neck', SIDE, 4 * on); rot('Head', SIDE, 7 * on)


def stomach_target(t):
    on = env_stomach(t)
    rub = smooth(0.2, 0.3, t) * (1 - smooth(0.72, 0.8, t))
    a = (t - 0.25) * 3 * math.tau                   # three slow circles
    y = body_front(BELLY_Z, 0.1) + 0.02
    return (SH.x * 0.4 + 0.025 * rub * math.cos(a), y, BELLY_Z + 0.02 * rub * math.sin(a)), on


def stomach_hand(t):
    on = env_stomach(t)
    rot_multi('RightHand', [(SIDE, HAND_TWIST * on), (UP, HAND_BEND * on)])    # turned palm-in, fingers across the belly
    finger_curl(0.8 - 0.65 * on)


def push_parts(t):
    w = smooth(0.0, 0.18, t) * (1 - smooth(0.7, 1.0, t))
    wind = smooth(0.0, 0.22, t) * (1 - smooth(0.24, 0.36, t))
    shove = smooth(0.24, 0.36, t) * (1 - smooth(0.62, 0.95, t))
    return w, wind, shove


def push_base(t):
    # a step of weight into it: the trunk turns toward the pushing arm and leans in
    w, wind, shove = push_parts(t)
    idle(0.0)
    rot('Spine', SIDE, 6 * shove - 2 * wind)
    rot('Spine1', UP, 10 * wind - 14 * shove)
    rot('Spine2', UP, 6 * wind - 8 * shove)
    rot('Head', UP, -6 * wind + 8 * shove)
    hips_offset(0, -0.04 * shove, 0)


def push_target(t):
    w, wind, shove = push_parts(t)
    front = body_front(CHEST_Z, 0.12)
    back = Vector((SH.x * 0.95, front - 0.06, SH.z - 0.2))       # the hand drawn back by the chest
    out = Vector((SH.x * 0.8, front - 0.62, SH.z - 0.42))        # the arm out, at a shorter man's chest (Ramu's)
    return tuple(back.lerp(out, shove)), w


def push_hand(t):
    w, wind, shove = push_parts(t)
    rot('RightHand', FWD, PUSH_BEND * shove)          # wrist back: the palm leads, fingers up
    finger_curl(0.7 - 0.6 * w)


reach_clip('stomach', 105, stomach_base, stomach_target, (SH.x - 0.45, 0.25, SH.z - 0.3), stomach_hand)
reach_clip('push_one', 42, push_base, push_target, (SH.x - 0.5, 0.35, SH.z - 0.35), push_hand)
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
        if ONLY and name not in ONLY:
            continue
        lo, hi = int(act.frame_range[0]), int(act.frame_range[1])
        n = 9 if name in ('hit', 'fall', 'punch', 'hit2', 'fall2', 'get_up', 'kick', 'shove', 'block', 'stomach', 'push_one') else 3
        frames = sorted({lo + (hi - lo) * k // n for k in range(n + 1)})
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
if mesh.data.shape_keys:                  # the face at rest in the file (its keys' values become the glTF's default weights)
    for kb in mesh.data.shape_keys.key_blocks:
        kb.value = 0.0
for ob in bpy.context.scene.objects:
    ob.select_set(True)
path = os.path.join(OUT, OUT_NAME)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
                          export_skins=True, export_animations=True, export_animation_mode='ACTIONS',
                          export_image_format='JPEG', export_jpeg_quality=88, export_materials='EXPORT',
                          export_extras=True, export_morph=True, export_morph_normal=False)
print('RIG exported', round(os.path.getsize(path) / 1e6, 2), 'MB')
