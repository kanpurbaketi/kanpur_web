import * as THREE from 'three';
import { gltfLoader } from './gltf';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NIGHT } from './night';

/*
 Detailed vehicles built by tools/blender/build_vehicles.py (public/models/<name>.glb): real PBR materials, not vertex colours.
   paint       white clear-coat, tinted per car
   glass       see-through; lamp_* lens materials glow at night
*/

const LAMP: Record<string, [string, number]> = { lamp_head: ['#fff1c8', 3.0], lamp_tail: ['#ff2a1a', 1.5], lamp_amber: ['#ffa030', 0.4] };

/** `wheel`: the part belongs to that wheel (tools/blender/split_wheels.py) */
export interface PBRPart { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; wheel?: string }

/**
 * A wheel the game turns: its hub in the vehicle's frame, radius and width (m), whether it steers, and its parts with
 * their geometry about the hub (axle along x). `made`: a modelled wheel (the photo-built vehicles), not the model's own.
 */
export interface Wheel { name: string; hub: THREE.Vector3; r: number; w: number; steer: boolean; made: boolean; parts: PBRPart[]; far: PBRPart[] }

interface Loaded { parts: PBRPart[]; wheels: Wheel[] }
const cache = new Map<string, Promise<Loaded>>();

/**
 * The wheels every vehicle is drawn with: a car's (the cars, autos, the bus and truck, the e-rickshaw) and a motorbike's
 * (tools/blender/build_wheels.py), and the cycle's own spoked one (its front: for the cycle's two and the cycle-rickshaw's
 * three, its tyre all rubber: the model paints only stretches of it black); null keeps the model's own. The model's wheel meshes are dropped and these put at its hubs, scaled to each wheel's radius
 * and width.
 */
type WheelKind = 'car' | 'bike' | 'cycle';
const WHEEL_KIND: Record<string, WheelKind | null> = { pulsar: 'bike', enfield: 'bike', enfield_black: 'bike', cycle: 'cycle', rickshaw: 'cycle' };
interface Template { near: PBRPart[]; far: PBRPart[]; tw: number }
const templates = new Map<string, Promise<Template>>();
function template(kind: WheelKind): Promise<Template> {
  let p = templates.get(kind);
  if (!p) {
    p = kind === 'cycle' ? cycleWheel() : gltfLoader().loadAsync(`models/wheel_${kind}.glb`).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const t: Template = { near: [], far: [], tw: 1 };
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        let at: THREE.Object3D | null = m;
        while (at && at.name !== 'near' && at.name !== 'far') at = at.parent;
        if (!at) return;
        t.tw = (at.userData as { tw?: number }).tw ?? t.tw;
        (at.name === 'near' ? t.near : t.far).push({ geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat: m.material as THREE.MeshStandardMaterial });
      });
      return t;
    });
    templates.set(kind, p);
  }
  return p;
}

/** the cycle's front wheel as a template: about its hub, radius 1 */
function cycleWheel(): Promise<Template> {
  return gltfLoader().loadAsync('models/cycle.glb').then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const t: Template = { near: [], far: [], tw: 1 };
    const node = gltf.scene.getObjectByName('wheel_f');
    if (!node) return t;
    const u = node.userData as { r?: number; w?: number };
    const r = u.r ?? 0.355;
    t.tw = (u.w ?? 0.07) / r;
    const to = new THREE.Matrix4().makeScale(1 / r, 1 / r, 1 / r).multiply(node.matrixWorld.clone().invert());
    node.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      // its own spokes and hub; its rim and tyre (one coarse ring, painted black only in stretches) made anew
      const [, rest] = splitTyre(m.geometry.clone().applyMatrix4(to.clone().multiply(m.matrixWorld)), 0.835);
      t.near.push({ geo: rest, mat: m.material as THREE.MeshStandardMaterial });
    });
    // across, in these units (radius 1): the tyre about 5 cm on a 0.355 m wheel
    const ring = (major: number, minor: number, flat: number, seg: number) =>
      new THREE.TorusGeometry(major, minor, 8, seg).rotateY(Math.PI / 2).scale(flat, 1, 1);
    t.near.push({ geo: ring(0.93, 0.07, 1, 48), mat: TYRE }, { geo: ring(0.85, 0.022, 1.6, 48), mat: RIM });
    t.tw = 0.14;
    return t;
  });
}

/** a wheel's geometry (radius 1, axle along x) in two: the triangles out beyond `from` (the tyre), and the rest */
function splitTyre(g: THREE.BufferGeometry, from: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const out: number[][] = [[], []];
  for (let t = 0; t < pos.count; t += 3) {
    let y = 0, z = 0;
    for (let k = 0; k < 3; k++) { y += pos.getY(t + k); z += pos.getZ(t + k); }
    out[Math.hypot(y / 3, z / 3) > from ? 0 : 1].push(t);
  }
  return out.map((tris) => {
    const geo = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes)) {
      const at = a as THREE.BufferAttribute, n = at.itemSize, arr = new (at.array.constructor as Float32ArrayConstructor)(tris.length * 3 * n);
      tris.forEach((t, i) => { for (let k = 0; k < 3 * n; k++) arr[i * 3 * n + k] = at.array[t * n + k]; });
      geo.setAttribute(name, new THREE.BufferAttribute(arr, n, at.normalized));
    }
    return geo;
  }) as [THREE.BufferGeometry, THREE.BufferGeometry];
}

/** a template's parts for one wheel: radius r, width w (m), its face outward (a right wheel turned round) */
function fitWheel(parts: PBRPart[], t: Template, r: number, w: number, right: boolean, name: string): PBRPart[] {
  const m = new THREE.Matrix4().makeScale(w / t.tw, r, r);
  if (right) m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
  return parts.map((q) => ({ geo: q.geo.clone().applyMatrix4(m), mat: q.mat, wheel: name }));
}

/** Every mesh of the model with its transform baked into the geometry, and its (shared) material; the wheels in place. */
export function loadPBR(name: string): Promise<PBRPart[]> {
  return load(name).then((l) => l.parts);
}

/** The wheels of a model, for turning them. */
export function loadWheels(name: string): Promise<Wheel[]> {
  return load(name).then((l) => l.wheels);
}

function load(name: string): Promise<Loaded> {
  let p = cache.get(name);
  if (!p) {
    const kind = name in WHEEL_KIND ? WHEEL_KIND[name] : 'car';
    p = Promise.all([gltfLoader().loadAsync(`models/${name}.glb`), kind ? template(kind) : null]).then(([gltf, tpl]) => {
      gltf.scene.updateMatrixWorld(true);
      const out: PBRPart[] = [];
      const wheels: Wheel[] = [];
      gltf.scene.traverse((o) => {
        if (!o.name.startsWith('wheel_') || o.parent?.name.startsWith('wheel_')) return;
        const u = o.userData as { r?: number; w?: number; steer?: number; make?: number };
        const hub = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const r = u.r ?? 0.3, w = u.w ?? 0.2, right = hub.x < 0;     // r 0: a handlebar (split_wheels.py BARS)
        const wheel: Wheel = { name: o.name, hub, r, w, steer: !!u.steer, made: !!u.make, parts: [], far: [] };
        if (wheel.made) {
          wheel.parts = madeWheel(r, w, right, 20);
          wheel.far = madeWheel(r, w, right, 8);
        } else {
          const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
          o.traverse((c) => {
            const m = c as THREE.Mesh;
            if (m.isMesh) wheel.parts.push({ geo: m.geometry.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld)), mat: m.material as THREE.MeshStandardMaterial, wheel: o.name });
          });
        }
        wheels.push(wheel);
      });
      // the wheels it is drawn with (not the model's own, nor the made ones): near, and (for a made one) far
      const swapped = new Set<string>();
      if (tpl) for (const w of wheels) {
        if (w.r <= 0) continue;                                      // the handlebar
        const right = w.hub.x < -0.05;
        // a motorbike's tyres fat (the model's own were cut as thin as a cycle's): at least 0.55 of the radius across
        const wide = kind === 'bike' ? Math.max(w.w, w.r * 0.55) : w.w;
        w.parts = fitWheel(tpl.near, tpl, w.r, wide, right, w.name);
        if (w.made) w.far = fitWheel(tpl.far, tpl, w.r, wide, right, w.name);
        w.made = true;
        swapped.add(w.name);
      }
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        let wheel: string | undefined;
        for (let q: THREE.Object3D | null = m; q; q = q.parent) if (q.name.startsWith('wheel_')) wheel = q.name;
        if (wheel && swapped.has(wheel)) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        const lamp = LAMP[mat.name];
        if (lamp) {
          mat.emissive.set(lamp[0]);
          mat.emissiveIntensity = NIGHT ? lamp[1] : 0;
        }
        if (mat.name === 'glass') {
          mat.transparent = true;
          mat.depthWrite = false;
        }
        out.push({ geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat, wheel });
      });
      // the modelled wheels, in place, for whatever shows the vehicle standing still
      for (const w of wheels) if (w.made) for (const q of w.parts) out.push({ geo: q.geo.clone().translate(w.hub.x, w.hub.y, w.hub.z), mat: q.mat, wheel: w.name });
      return { parts: out, wheels };
    });
    cache.set(name, p);
  }
  return p;
}

const TYRE = new THREE.MeshStandardMaterial({ name: 'tyre', color: '#1c1c1d', roughness: 0.92, metalness: 0 });
const RIM = new THREE.MeshStandardMaterial({ name: 'rim', color: '#9a9ca0', roughness: 0.42, metalness: 0.6 });

/**
 * A modelled wheel about its hub, the axle along x, the rim's face outward (to +x on the left, to -x on the right):
 * a rounded tyre with a tread, a dished rim, five spokes and a hub cap (so its turning shows). `seg`: round the circle.
 */
function madeWheel(r: number, w: number, right: boolean, seg: number): PBRPart[] {
  const rr = r * 0.64, e = Math.min(0.035, w * 0.25);
  // the tyre's cross-section, revolved round the axle
  const prof = [[rr, -w / 2], [r - e, -w / 2], [r - e * 0.3, -w / 2 + e * 0.3], [r, -w / 2 + e], [r, w / 2 - e],
    [r - e * 0.3, w / 2 - e * 0.3], [r - e, w / 2], [rr, w / 2]].map(([a, b]) => new THREE.Vector2(a, b));
  const tyre = new THREE.LatheGeometry(prof, seg * 2);
  // tread: every other band of the tread a little deeper (rows of blocks)
  const pos = tyre.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z);
    if (d > r - 0.002 && Math.round((Math.atan2(z, x) / (Math.PI * 2)) * seg * 4) % 2) pos.setXYZ(i, x * (1 - 0.012), pos.getY(i), z * (1 - 0.012));
  }
  tyre.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [];
  const dish = new THREE.LatheGeometry([[0.001, w * 0.22], [rr * 0.3, w * 0.24], [rr * 0.95, w * 0.12], [rr, -w * 0.3]].map(([a, b]) => new THREE.Vector2(a, b)), seg);
  parts.push(dish);
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.BoxGeometry(rr * 0.2, w * 0.1, rr * 0.9).translate(0, w * 0.26, rr * 0.45).rotateY((k / 5) * Math.PI * 2);
    parts.push(sp);
  }
  parts.push(new THREE.CylinderGeometry(rr * 0.22, rr * 0.26, w * 0.12, seg).translate(0, w * 0.3, 0));
  const rim = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  // the lathe's axis is y: turn it to x, the face toward +x (left); a right wheel faces -x
  const turn = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
  if (right) turn.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
  tyre.applyMatrix4(turn);
  rim.applyMatrix4(turn);
  return [{ geo: tyre, mat: TYRE }, { geo: rim, mat: RIM }];
}

/** One car as a group of meshes; the paint material is copied so each car can have its own colour. */
export function cloneCar(parts: PBRPart[], paint: string): THREE.Group {
  const g = new THREE.Group();
  for (const { geo, mat } of parts) {
    let m = mat;
    if (mat.name === 'paint') {
      m = mat.clone();
      m.color.set(paint);
    } else if (mat.map) {
      m = mat.clone();                       // a photo-textured model: tint it lightly toward the colour asked for
      m.color.set(paint).lerp(new THREE.Color('#ffffff'), 0.55);
    }
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = mat.name !== 'glass';
    if (mat.name === 'glass') mesh.renderOrder = 1;
    g.add(mesh);
  }
  return g;
}
