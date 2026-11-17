import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
for i, path in enumerate(argv[1:]):
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob, do_unlink=True)
    bpy.ops.wm.obj_import(filepath=path, forward_axis='Y', up_axis='Z')
    ob = bpy.context.selected_objects[0]
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x, sc.render.resolution_y = 520, 400
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    c = sum(bb, Vector()) / 8; size = max((b - c).length for b in bb)
    for tag, d in (('a', Vector((1, -0.9, 0.45))), ('b', Vector((1, 0.9, 0.45))), ('c', Vector((-1, 0.9, 0.45))), ('d', Vector((-1, -0.9, 0.45)))):
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
        cam.location = c + d.normalized() * size * 2.6
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = cam
        sc.render.filepath = os.path.join(out, f'{i}_{tag}.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)
    print('TRIS', path, sum(len(p.vertices) - 2 for p in ob.data.polygons))
