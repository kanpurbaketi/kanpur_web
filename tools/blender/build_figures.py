"""
Still figures for the places where people sit or stand and never walk (the kavi sammelan's poets and audience, the gallery
of the maut ka kuan, the riders on its wall, the children in the inflatable): each rigged character of the crowd, posed,
cut down to a few thousand triangles and baked to a plain mesh. One file per character, one mesh per pose, no texture:
the game puts the character's own texture, or any of its looks (tools/people/make_variants.py), on them.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_figures.py -- [--char NAME] [--preview DIR]

Input: public/models/<name>_rig.glb (tools/blender/build_ramu_rig.py). Output: public/models/figures/<name>.glb.
Blender: Z up, the character faces -Y (glTF +Z). Every pose stands or sits on z = 0, centred on the hips.
"""
import bpy, math, os, sys
from mathutils import Vector, Quaternion

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(ROOT, 'public', 'models')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
CHARS = ['uncle', 'aunty', 'college_girl', 'college_boy']
if '--char' in argv:
    CHARS = [argv[argv.index('--char') + 1]]
TRIS = 7000            # per figure: there are hundreds of them in view at the stage
if '--tris' in argv:
    TRIS = int(argv[argv.index('--tris') + 1])
# Ramu himself (--char ramu --tris 40000): only the poses he takes on a vehicle, at full detail, for the player's camera
RAMU_POSES = ('ride', 'drive')

SIDE = Vector((1, 0, 0))      # the character's left-right axis
FWD = Vector((0, -1, 0))      # the way they face
UP = Vector((0, 0, 1))


def build(char):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, char + '_rig.glb'))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    mesh = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))     # not the importer's bone shapes
    bpy.context.view_layer.objects.active = mesh
    # fewer triangles first (the skin weights survive it), then pose
    n = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    dec = mesh.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, TRIS / n)
    bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
    bpy.ops.object.modifier_apply(modifier='dec')
    print('FIG', char, n, '->', sum(len(p.vertices) - 2 for p in mesh.data.polygons), 'triangles')

    P = arm.pose.bones
    name_of = {b.name.split(':')[-1].replace('mixamorig', ''): b.name for b in P}
    REST = {k: P[v].bone.matrix_local.to_quaternion() for k, v in name_of.items()}
    for b in P:
        b.rotation_mode = 'QUATERNION'

    def clear():
        arm.animation_data_clear()
        for b in P:
            b.rotation_quaternion = (1, 0, 0, 0)
            b.location = (0, 0, 0)
            b.scale = (1, 1, 1)

    def rot(name, *parts):
        """Turn a bone about armature-space axes, in order (each turn is passed on down the chain, as in a real skeleton)."""
        if name not in REST:
            return
        q = Quaternion((1, 0, 0, 0))
        for axis, deg in parts:
            q = Quaternion(axis, math.radians(deg)) @ q
        r = REST[name]
        P[name_of[name]].rotation_quaternion = r.inverted() @ q @ r

    def clip(action, at):
        """The pose of a clip, `at` 0..1 of the way through it."""
        clear()
        act = bpy.data.actions[action]
        ad = arm.animation_data_create()
        ad.action = act
        if hasattr(ad, 'action_slot') and ad.action_slot is None and len(act.slots):
            ad.action_slot = act.slots[0]
        lo, hi = act.frame_range
        bpy.context.scene.frame_set(int(lo + (hi - lo) * at))

    def pose_sit():
        # cross-legged on the floor, hands in the lap
        clear()
        for side, sg in (('Left', 1), ('Right', -1)):
            rot(side + 'UpLeg', (UP, sg * 70), (SIDE, -84), (UP, sg * 52))
            rot(side + 'Leg', (SIDE, 138))
            rot(side + 'Foot', (SIDE, 25))
            rot(side + 'Arm', (FWD, sg * -68), (SIDE, -30))
            rot(side + 'ForeArm', (SIDE, -40))
        rot('Spine', (SIDE, 6))
        rot('Spine1', (SIDE, 5))
        rot('Head', (SIDE, -6))

    def pose_chair():
        # on a bench or a seat (a wheel's cabin, a swing's chair, a boat's thwart): thighs level, hands on the knees
        clear()
        for side, sg in (('Left', 1), ('Right', -1)):
            rot(side + 'UpLeg', (SIDE, -84), (UP, sg * 6))
            rot(side + 'Leg', (SIDE, 86))
            rot(side + 'Arm', (FWD, sg * -74), (SIDE, -34))
            rot(side + 'ForeArm', (SIDE, -30))
        rot('Spine', (SIDE, 3))
        rot('Head', (SIDE, -4))

    def pose_ride():
        # on a motorbike: leaning to the bars, knees gripping the tank, feet on the pegs
        clear()
        for side, sg in (('Left', 1), ('Right', -1)):
            rot(side + 'UpLeg', (SIDE, -68), (UP, sg * 18))
            rot(side + 'Leg', (SIDE, 86))
            rot(side + 'Arm', (FWD, sg * -78), (SIDE, -58), (UP, sg * -6))
            rot(side + 'ForeArm', (SIDE, -14))
        rot('Spine', (SIDE, 16))
        rot('Spine1', (SIDE, 10))
        rot('Spine2', (SIDE, 6))
        rot('Neck', (SIDE, -14))
        rot('Head', (SIDE, -12))

    def pose_drive():
        # at the wheel: seated, thighs level, both hands forward on the steering wheel / handlebar
        clear()
        for side, sg in (('Left', 1), ('Right', -1)):
            rot(side + 'UpLeg', (SIDE, -82), (UP, sg * 8))
            rot(side + 'Leg', (SIDE, 80))
            rot(side + 'Arm', (FWD, sg * -72), (SIDE, -62), (UP, sg * -10))
            rot(side + 'ForeArm', (SIDE, -26))
        rot('Spine', (SIDE, 4))
        rot('Head', (SIDE, -4))

    poses = {
        'stand': lambda: clip('idle', 0.1),
        'stand_b': lambda: clip('look_around', 0.3),
        'stand_c': lambda: clip('look_around', 0.7),
        'talk': lambda: clip('argue', 0.22),
        'talk_b': lambda: clip('argue', 0.6),
        'hop': lambda: clip('jump', 0.5),
        'sit': pose_sit,
        'ride': pose_ride,
        'chair': pose_chair,
        'drive': pose_drive,
    }
    if char == 'ramu':
        poses = {k: v for k, v in poses.items() if k in RAMU_POSES}
    else:
        poses.pop('drive')
    made = []
    for pose, set_pose in poses.items():
        set_pose()
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
        me.transform(mesh.matrix_world)
        hips = (arm.matrix_world @ P[name_of['Hips']].matrix).translation
        lo = min(v.co.z for v in me.vertices)
        print('FIG', char, pose, 'hips', round(hips.z - lo, 2), 'm above the lowest point')
        for v in me.vertices:                       # on the ground, the hips over the origin
            v.co.x -= hips.x
            v.co.y -= hips.y
            v.co.z -= lo
        me.materials.clear()
        ob = bpy.data.objects.new(pose, me)
        me.name = pose
        bpy.context.scene.collection.objects.link(ob)
        for p in me.polygons:
            p.use_smooth = True
        made.append(ob)
    if PREVIEW:
        preview(char, made, mesh)
    for o in list(bpy.data.objects):
        if o not in made:
            bpy.data.objects.remove(o, do_unlink=True)
    os.makedirs(os.path.join(MODELS, 'figures'), exist_ok=True)
    path = os.path.join(MODELS, 'figures', char + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_skins=False,
                              export_animations=False, export_materials='NONE', export_draco_mesh_compression_enable=False)
    print('FIG exported', os.path.relpath(path, ROOT), round(os.path.getsize(path) / 1e3), 'kB')


def preview(char, made, mesh):
    """Every pose in a row, textured, from the front and from the side."""
    os.makedirs(PREVIEW, exist_ok=True)
    mat = mesh.data.materials[0]
    for i, ob in enumerate(made):
        ob.data.materials.append(mat)
        ob.location.x = (i - (len(made) - 1) / 2) * 1.3
    mesh.hide_render = True
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.8, 0.8, 0.8)
    sc.render.resolution_x, sc.render.resolution_y = 1800, 420
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 12.4
    sc.camera = cam
    for tag, turn in (('front', 0.0), ('side', 1.1)):
        for ob in made:
            ob.rotation_euler.z = turn
        cam.location = (0, -8, 0.85)
        cam.rotation_euler = (math.pi / 2, 0, 0)
        sc.render.filepath = os.path.join(PREVIEW, f'fig_{char}_{tag}.png')
        bpy.ops.render.render(write_still=True)
    for ob in made:
        ob.rotation_euler.z = 0
        ob.location.x = 0
        ob.data.materials.clear()
    bpy.data.objects.remove(cam, do_unlink=True)


for c in CHARS:
    build(c)
