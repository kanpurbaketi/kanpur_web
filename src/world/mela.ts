import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gltfLoader } from './gltf';
import { Actor, makeActors, RigName } from './actors';
import { HandProp } from './handProp';
import { Person } from './person';
import { lota, LOTA_NECK } from './storyProps';
import { addFoods, FoodName, FoodSpot } from './foods';
import { addGrass, grassWind, GrassSpot } from './grass';
import { groundDecals } from './roadDirt';
import { LightPool } from './night';
import { banner, BULB, Bulbs, bannerMat, FEST, Geo, litMat, rnd } from './geo';
import { MELA_MIX, Pedestrians } from './pedestrians';
import { figurePosts, ONLOOKER, someone, Spot } from './figures';
import { AUDIENCE, CAROUSEL, CHAIR_SWING, COLUMBUS, DX, DZ, GATE, HINDOLA, inMela, INFLATABLE, KUAN, MELA, Rect, SAMMELAN, SAMMELAN_GATES, STAGE, STAGE_ENTRY, STAGE_STAIRS, STALL_BLOCKS, TEAR, WALL_LOOP, WHEEL } from './melaSite';
import { buildInflatable } from './inflatable';
import { buildMautKuan } from './mautKuan';
import { MapData } from './types';

/** a sitting clip's body set on a sofa cushion: how much to lift it and move it forward (tuned by eye: the shins hang in front of the seat's frame, not through it) */
const SIT_Y = 0, SIT_Z = 0.05;
/** the lota on the stage's floor: how far in front of the poets' seats (the table's near edge is at ~0.9) */
const LOTA_Z = 0.72;
/** the top of the dari sheets under the audience, and of the mela's dirt and its packed aisle from the gate (Ramu stands on them) */
const DARI_Y = 0.11, DIRT_Y = 0.05, AISLE_Y = 0.08;

/*
 The Moti Jheel mela, a night fair on the open ground of Tulsi Upvan:
   rides      giant wheel, Columbus boat, chair swing (chakri), carousel (ghoda jhoola), wooden hindola,
              maut ka kuan (mautKuan.ts: bikes and cars on the wall, the crowd on the gallery)
   stage      kavi sammelan: poets on white gaddis, banner, speakers, marigold, a seated audience
   stalls     toys and balloons, chaat / jalebi, bangles, cotton candy, under strings of coloured bulbs
   crowd      people strolling the aisles (Pedestrians on a small private street graph) + the seated audience
 Everything is procedural: vertex-coloured merged geometry for the solid parts, emissive octahedra plus additive
 glow sprites for the bulbs, and a handful of real point lights (LightPool) that follow the camera.
*/

const C = (h: string) => new THREE.Color(h);

// ---- rides ----------------------------------------------------------------------------------------

interface Ride {
  group: THREE.Group; update(t: number, dt: number): void; post: [number, number, number, number?, number?][]; light: [number, number, number, string];
  rails?: { ring: [number, number][]; h: number; camH?: number }[]; floor?: (x: number, z: number) => number | null;
}

/** collision outlines for rides (the ride's own frame): a box round its footing, a circle round a round one */
const boxRing = (hx: number, hz: number): [number, number][] => [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
const roundRing = (r: number, n = 24): [number, number][] => Array.from({ length: n }, (_, k) => [Math.cos((k / n) * Math.PI * 2) * r, Math.sin((k / n) * Math.PI * 2) * r] as [number, number]);
const solid = (ring: [number, number][]) => ({ ring, h: 10 });

/** The giant wheel's controls, for the story (stage 1, part 3: Ramu hangs from a cabin; the operator stops it dead) */
export interface GiantWheel {
  /** turning speed, rad/s (it turns at 0.22; 0: stopped) */
  speed: number;
  /** the cabins (each hangs from its pivot on the rim; its floor is 1.35 m below it) */
  cabins: THREE.Group[];
  /** the hub, world */
  hub: THREE.Vector3;
  R: number;
}

/** Giant wheel: legs, two rims with chasing bulbs, 16 hanging cabins that stay upright. Wheel plane = the z-y plane. */
function giantWheel(ctl: GiantWheel): Ride {
  const R = 11, HUB = 13.2, N = 16, group = new THREE.Group();
  const frame = new Geo();
  for (const sx of [-1.7, 1.7]) {
    for (const sz of [-7.5, 7.5]) frame.rod(new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, HUB, 0), 0.24, '#d8d8d8');
    frame.rod(new THREE.Vector3(sx, 0.3, -7.5), new THREE.Vector3(sx, 0.3, 7.5), 0.12, '#bbbbbb');
    frame.rod(new THREE.Vector3(sx, 5.2, -3.2), new THREE.Vector3(sx, 5.2, 3.2), 0.1, '#bbbbbb');
  }
  frame.cyl(0, HUB - 0.35, 0, 0.45, 0, '#999999');
  frame.rod(new THREE.Vector3(-2.1, HUB, 0), new THREE.Vector3(2.1, HUB, 0), 0.3, '#888888');
  frame.box(0, 0.12, 0, 5, 0.24, 18, '#55504a');   // concrete footing
  group.add(new THREE.Mesh(frame.build(), litMat()));

  const wheel = new THREE.Group();
  wheel.position.y = HUB;
  const rim = new Geo(), bulbs = new Bulbs();
  const SEG = 40;
  for (const x of [-1.0, 1.0]) {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
      const p0 = new THREE.Vector3(x, Math.cos(a0) * R, Math.sin(a0) * R), p1 = new THREE.Vector3(x, Math.cos(a1) * R, Math.sin(a1) * R);
      rim.rod(p0, p1, 0.1, i % 2 ? '#e8e8e8' : '#d03030');
      bulbs.add(x, Math.cos(a0) * (R + 0.18), Math.sin(a0) * (R + 0.18), BULB[i % BULB.length], (i % 8) / 8, 1.4);
      const r2 = R * 0.52;
      if (i % 2 === 0) rim.rod(new THREE.Vector3(x, Math.cos(a0) * r2, Math.sin(a0) * r2), new THREE.Vector3(x, Math.cos(a1 + 0.16) * r2, Math.sin(a1 + 0.16) * r2), 0.05, '#cccccc');
    }
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      rim.rod(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, c * R, s * R), 0.055, '#dddddd');
      for (let j = 1; j <= 4; j++) bulbs.add(x, c * R * (0.2 + j * 0.2), s * R * (0.2 + j * 0.2), BULB[(k + j) % BULB.length], ((k + j * 2) % 8) / 8, 1.0);
    }
  }
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    rim.rod(new THREE.Vector3(-1, Math.cos(a) * R, Math.sin(a) * R), new THREE.Vector3(1, Math.cos(a) * R, Math.sin(a) * R), 0.07, '#cccccc');
  }
  for (let j = 0; j < 12; j++) bulbs.add(0, Math.cos(j * 0.5236) * 1.6, Math.sin(j * 0.5236) * 1.6, BULB[j % 6], j / 12, 1.3);   // hub star
  wheel.add(new THREE.Mesh(rim.build(), litMat()), bulbs.object(0.8));
  group.add(wheel);

  // cabin: open bench seat with a canopy; colour variants share geometry
  const cabinGeo = (canopy: string) => {
    const g = new Geo();
    g.box(0, -1.35, 0, 1.9, 0.1, 1.2, '#3a3a3c');
    g.box(0, -1.0, -0.55, 1.9, 0.7, 0.08, canopy);
    g.box(0, -0.93, 0.45, 1.7, 0.1, 0.4, '#8a5a2a');           // the bench
    g.box(-0.93, -0.95, 0, 0.06, 0.8, 1.2, canopy);
    g.box(0.93, -0.95, 0, 0.06, 0.8, 1.2, canopy);
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.55, 0.55]) g.rod(new THREE.Vector3(sx, -1.3, sz), new THREE.Vector3(sx, -0.1, sz), 0.03, '#dddddd');
    g.box(0, -0.06, 0, 2.1, 0.08, 1.4, canopy);
    g.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.1, 0), 0.04, '#aaaaaa');
    g.rod(new THREE.Vector3(-0.9, -0.06, 0), new THREE.Vector3(0, 0.55, 0), 0.03, '#cccccc');
    g.rod(new THREE.Vector3(0.9, -0.06, 0), new THREE.Vector3(0, 0.55, 0), 0.03, '#cccccc');
    return g.build();
  };
  const variants = ['#d62828', '#f77f00', '#2a9d8f', '#3a86ff'].map(cabinGeo);
  const cabinBulb = new Bulbs();
  for (const dx of [-0.7, 0, 0.7]) cabinBulb.add(dx, -0.14, 0, '#ffd47a', -1, 1.1);
  const cabinGlow = cabinBulb.object(0.5);
  const cabins: THREE.Group[] = [];
  const cm = litMat();
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
    g.add(new THREE.Mesh(variants[k % 4], cm));
    g.add(cabinGlow.clone());
    for (const sx of [-0.42, 0.42]) {            // riders on the bench (figures.ts); a few seats are empty
      if (rnd(k * 7 + sx * 3 + 1) < 0.25) continue;
      const p = someone(k * 5 + sx * 9 + 40, 'chair', 0.9);
      p.position.set(sx, -1.3, 0.38);
      g.add(p);
    }
    wheel.add(g);
    cabins.push(g);
  }
  ctl.cabins = cabins;
  ctl.R = R;
  ctl.hub.set(0, HUB, 0);
  return {
    group, post: [], rails: [solid(boxRing(2.5, 9.0))], light: [0, 4, 0, '#ffb060'],      // the footing: the low cabins swing down to it
    update: (t, dt) => {
      wheel.rotation.x += dt * ctl.speed;
      for (const c of cabins) c.rotation.x = -wheel.rotation.x;
    },
  };
}

/** Columbus boat: a big pendulum with a painted boat full of benches. Swings in the y-z plane. */
function columbus(): Ride {
  const group = new THREE.Group(), PIV = 8.8, L = 7.4;
  const frame = new Geo();
  for (const sx of [-3.4, 3.4]) {
    for (const sz of [-5.2, 5.2]) frame.rod(new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, PIV, 0), 0.22, '#e8c84a');
    frame.rod(new THREE.Vector3(sx, 2.5, -2.7), new THREE.Vector3(sx, 2.5, 2.7), 0.1, '#c9a93a');
  }
  frame.rod(new THREE.Vector3(-3.6, PIV, 0), new THREE.Vector3(3.6, PIV, 0), 0.28, '#777777');
  frame.box(0, 0.1, 0, 8, 0.2, 12, '#4a463f');
  group.add(new THREE.Mesh(frame.build(), litMat()));
  const fb = new Bulbs();
  for (let i = 0; i <= 10; i++) { fb.add(-3.4, 0.4 + i * 0.85, 0.0 + (5.2 - i * 0.52) * 1, BULB[i % 6], i / 10); fb.add(3.4, 0.4 + i * 0.85, (5.2 - i * 0.52), BULB[(i + 2) % 6], i / 10); }
  group.add(fb.object(0.7));

  const pend = new THREE.Group();
  pend.position.y = PIV;
  const arm = new Geo();
  for (const sx of [-2.4, 2.4]) arm.rod(new THREE.Vector3(sx, 0, 0), new THREE.Vector3(sx, -L, 0), 0.1, '#cccccc');
  arm.rod(new THREE.Vector3(-2.4, -L * 0.5, 0), new THREE.Vector3(2.4, -L * 0.5, 0), 0.06, '#cccccc');
  // boat
  const y0 = -L - 0.4;
  arm.box(0, y0, 0, 3.4, 0.5, 8.4, '#b3261e');
  arm.box(0, y0 + 0.5, 0, 3.0, 0.5, 8.0, '#f2c21b');
  for (const sz of [-1, 1]) {
    arm.box(0, y0 + 0.55, sz * 4.5, 2.4, 0.9, 1.6, '#b3261e', 0);
    arm.box(0, y0 + 1.2, sz * 5.1, 1.8, 0.8, 0.9, '#f2c21b', 0);
  }
  for (const sx of [-1.75, 1.75]) arm.box(sx, y0 + 1.0, 0, 0.12, 0.9, 8.6, '#ffffff');
  for (let r = -3; r <= 3; r++) arm.box(0, y0 + 1.12, r * 1.05, 2.6, 0.1, 0.5, '#7a4a22');      // benches
  for (const sx of [-1.7, 1.7]) arm.rod(new THREE.Vector3(sx, y0 + 0.9, -4), new THREE.Vector3(sx, y0 + 2.0, -4), 0.05, '#ffffff');
  arm.cyl(0, y0 + 1.0, -5.4, 0.08, 2.6, '#dddddd');                      // bow pole with a flag
  arm.box(0.45, y0 + 3.2, -5.4, 0.9, 0.5, 0.04, '#ff6a00');
  pend.add(new THREE.Mesh(arm.build(), litMat()));
  const bb = new Bulbs();
  for (let i = 0; i < 20; i++) { const z = -4.2 + i * 0.44; bb.add(-1.78, y0 + 1.5, z, BULB[i % 6], (i % 6) / 6, 1.1); bb.add(1.78, y0 + 1.5, z, BULB[(i + 1) % 6], (i % 6) / 6, 1.1); }
  for (let i = 0; i < 10; i++) bb.add(0, y0 + 0.18, -3.2 + i * 0.7, '#ffd68a', -1, 1.0);
  pend.add(bb.object(0.7));
  for (let r = -3; r <= 3; r++) for (const sx of [-0.85, 0, 0.85]) {      // people on the benches, facing the middle of the boat
    if (r === 0 || rnd(r * 13 + sx * 7 + 3) < 0.35) continue;
    const p = someone(r * 11 + sx * 5 + 200, 'chair', 0.9);
    p.position.set(sx, y0 + 0.75, r * 1.05 + (r < 0 ? -0.05 : 0.05));
    if (r < 0) p.rotation.y = Math.PI;
    pend.add(p);
  }
  group.add(pend);
  return {
    group, post: [], rails: [solid(boxRing(4.0, 6.0))], light: [0, 3, 0, '#ffc870'],      // the footing: the boat swings over it
    update: (t) => { pend.rotation.x = 0.95 * Math.sin(t * 0.85) * (0.75 + 0.25 * Math.sin(t * 0.13)); },
  };
}

/** Chair swing (chakri): a tower with a spinning umbrella; 16 chairs on chains fly outwards as it speeds up. */
function chairSwing(): Ride {
  const group = new THREE.Group(), H = 10.5, N = 16;
  const base = new Geo();
  base.cyl(0, 0, 0, 5.4, 0.35, '#3a3633', 20);
  base.cyl(0, 0.35, 0, 0.45, H - 0.35, '#e8e0d0', 12, 0.6);
  base.cyl(0, 0.35, 0, 0.9, 1.4, '#b3261e', 12, 1.2);
  group.add(new THREE.Mesh(base.build(), litMat()));
  const head = new THREE.Group();
  head.position.y = H;
  const top = new Geo();
  const cone = new THREE.ConeGeometry(5.3, 1.9, 24, 1, true).toNonIndexed();
  const pos = cone.getAttribute('position');
  const cols: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI;
    const c = C(Math.floor((a / (Math.PI * 2)) * 24) % 2 ? '#d62828' : '#f2c21b');
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  cone.deleteAttribute('uv');
  cone.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const coneMesh = new THREE.Mesh(cone, litMat({ side: THREE.DoubleSide }));
  coneMesh.position.y = 0.6;
  head.add(coneMesh);
  top.cyl(0, -0.4, 0, 0.7, 0.8, '#b3261e', 12);
  top.cyl(0, 1.5, 0, 0.12, 1.0, '#ffd24a', 6);
  top.add(new THREE.SphereGeometry(0.3, 10, 8), '#ffd24a', new THREE.Matrix4().makeTranslation(0, 2.6, 0));
  const hb = new Bulbs();
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; hb.add(Math.cos(a) * 5.35, -0.32, Math.sin(a) * 5.35, BULB[i % 6], (i % 8) / 8, 1.3); }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; hb.add(Math.cos(a) * 2.6, 0.75, Math.sin(a) * 2.6, BULB[(i + 3) % 6], (i % 8) / 8, 1.0); }
  head.add(new THREE.Mesh(top.build(), litMat()), hb.object(0.8));
  const chairGeo = (c: string) => {
    const g = new Geo();
    g.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -4.4, 0), 0.025, '#cfcfcf', 4);
    g.box(0, -4.75, 0, 0.5, 0.07, 0.5, c);
    g.box(0, -4.5, 0.25, 0.5, 0.45, 0.06, c);
    g.rod(new THREE.Vector3(-0.22, -4.72, -0.2), new THREE.Vector3(0.22, -4.72, -0.2), 0.02, '#dddddd', 4);
    g.box(0, -5.05, -0.16, 0.4, 0.05, 0.12, '#444');
    return g.build();
  };
  const chairs: THREE.Group[] = [];
  const cmat = litMat();
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * 4.5, -0.25, Math.sin(a) * 4.5);
    g.rotation.y = -a;
    g.userData.a = a;
    g.add(new THREE.Mesh(chairGeo(FEST[k % FEST.length]), cmat));
    if (rnd(k * 3 + 2) > 0.25) {                 // somebody in the chair
      const p = someone(k * 7 + 300, 'chair', 0.85, ['boy', 'girl', 'boy', 'girl', 'uncle']);
      p.position.set(0, -5.11, 0.02);
      g.add(p);
    }
    head.add(g);
    chairs.push(g);
  }
  group.add(head);
  let spin = 0;
  return {
    group, post: [[0, 0, 1.4]], light: [0, 6, 0, '#ffc060'],
    update: (t, dt) => {
      const speed = 0.2 + 1.3 * (0.5 - 0.5 * Math.cos(t * 0.17));  // winds up and down
      spin += speed * dt;
      head.rotation.y = spin;
      const tilt = 0.62 * Math.min(1, (speed - 0.2) / 1.0);
      for (const c of chairs) { c.rotation.z = tilt; c.rotation.x = 0; }
    },
  };
}

/**
 * Carousel (ghoda jhoola): models/carousel.glb (tools/blender/build_props.py): the fixed plinth, the part that turns
 * (platform, poles, the striped canopy and its bulbs) and twelve horses, white and black, that rise and fall on their
 * poles as it goes round; children ride most of them.
 */
function carousel(): Ride {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  /** per horse: what moves up and down, the bottom of its stroke (relative to where the model put it), its phase */
  const horses: { o: THREE.Object3D; low: number; k: number }[] = [];
  let dir = 1;
  gltfLoader().loadAsync('models/carousel.glb').then((gltf) => {
    const sc = gltf.scene;
    sc.updateMatrixWorld(true);
    const shadow = (m: THREE.Object3D) => m.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
    const base = sc.getObjectByName('base'), body = sc.getObjectByName('spin');
    if (base) { shadow(base); group.add(base); }
    if (body) { shadow(body); spin.add(body); }
    const tmpl: Record<string, THREE.Mesh | undefined> = {};
    for (const c of ['white', 'black']) sc.getObjectByName('horse_' + c)?.traverse((o) => { if ((o as THREE.Mesh).isMesh) tmpl[c] = o as THREE.Mesh; });
    const slots = sc.children.filter((o) => /^slot_(white|black)_\d+$/.test(o.name));
    // each ring's lowest horse is at the bottom of the stroke
    const ringLow = new Map<number, number>();
    const ring = (o: THREE.Object3D) => (Math.hypot(o.position.x, o.position.z) > 2.9 ? 1 : 0);
    for (const s of slots) ringLow.set(ring(s), Math.min(ringLow.get(ring(s)) ?? Infinity, s.position.y));
    const v = new THREE.Vector3();
    slots.forEach((s, k) => {
      const t = tmpl[s.name.includes('_white_') ? 'white' : 'black'];
      if (!t) return;
      const holder = new THREE.Group();
      const horse = new THREE.Mesh(t.geometry, t.material);
      horse.matrixAutoUpdate = false;
      horse.matrix.copy(s.matrixWorld).multiply(t.matrixWorld);
      horse.castShadow = true;
      holder.add(horse);
      // where it is and which way it faces (its head: the highest points), its back's height at the middle
      const pos = t.geometry.getAttribute('position');
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(horse.matrix).clone());
      const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
      const top = [...pts].sort((p, q) => q.y - p.y).slice(0, Math.max(8, pts.length >> 5));
      const head = top.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(top.length);
      const f = new THREE.Vector2(head.x - c.x, head.z - c.z).normalize();
      // the saddle: halfway from nose to tail (the head's dense mesh pulls the centroid forward), a little back of it
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { const d = p.x * f.x + p.z * f.y; lo = Math.min(lo, d); hi = Math.max(hi, d); }
      const along = (lo + hi) / 2 - 0.06 - (c.x * f.x + c.z * f.y);
      c.x += f.x * along; c.z += f.y * along;
      const back = pts.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < 0.12).reduce((m, p) => Math.max(m, p.y), -Infinity);
      if (k === 0) dir = f.x * c.z - f.y * c.x > 0 ? 1 : -1;     // turn the way the horses face
      if (k % 3 !== 2) {                         // a child on most of them
        const kid = someone(k * 9 + 400, 'ride', 0.62, ['boy', 'girl']);
        kid.position.set(c.x, back - 0.36, c.z);
        kid.rotation.y = Math.atan2(-f.x, -f.y);
        holder.add(kid);
      }
      spin.add(holder);
      horses.push({ o: holder, low: ringLow.get(ring(s))! - s.position.y, k });
    });
  }).catch(() => {});
  return {
    group, post: [], rails: [solid(roundRing(4.75))], light: [0, 5, 0, '#ffb870'],
    update: (t, dt) => {
      spin.rotation.y += dt * 0.5 * dir;
      for (const h of horses) h.o.position.y = h.low + 0.3 * (1 - Math.cos(t * 2.0 + h.k * 1.7));
    },
  };
}

/** Hindola: the old wooden, hand-turned wheel with six cradles. */
function hindola(): Ride {
  const group = new THREE.Group(), HUB = 4.6, R = 3.3, N = 6;
  const frame = new Geo();
  for (const sx of [-1.4, 1.4]) for (const sz of [-2.6, 2.6]) frame.rod(new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, HUB, 0), 0.12, '#7a4a22');
  frame.rod(new THREE.Vector3(-1.6, HUB, 0), new THREE.Vector3(1.6, HUB, 0), 0.14, '#5b3a1c');
  frame.box(0, 0.05, 0, 3.6, 0.1, 6.4, '#5a4a38');
  group.add(new THREE.Mesh(frame.build(), litMat({ metalness: 0.05 })));
  const wheel = new THREE.Group();
  wheel.position.y = HUB;
  const w = new Geo(), bulbs = new Bulbs();
  for (const x of [-0.9, 0.9]) for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2, b = ((k + 1) / N) * Math.PI * 2;
    w.rod(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, Math.cos(a) * R, Math.sin(a) * R), 0.06, '#8a5a2a');
    w.rod(new THREE.Vector3(x, Math.cos(a) * R, Math.sin(a) * R), new THREE.Vector3(x, Math.cos(b) * R, Math.sin(b) * R), 0.06, '#8a5a2a');
    bulbs.add(x, Math.cos(a) * R, Math.sin(a) * R, BULB[k % 6], (k % 6) / 6, 1.0);
  }
  wheel.add(new THREE.Mesh(w.build(), litMat({ metalness: 0.05 })), bulbs.object(0.6));
  const cradle = (c: string) => {
    const g = new Geo();
    g.box(0, -0.75, 0, 1.3, 0.08, 0.8, '#7a4a22');
    g.box(0, -0.45, -0.38, 1.3, 0.6, 0.05, c);
    g.box(-0.63, -0.45, 0, 0.05, 0.6, 0.8, c);
    g.box(0.63, -0.45, 0, 0.05, 0.6, 0.8, c);
    g.box(0, 0.05, 0, 1.5, 0.05, 1.0, c);
    for (const sx of [-0.62, 0.62]) for (const sz of [-0.35, 0.35]) g.rod(new THREE.Vector3(sx, -0.7, sz), new THREE.Vector3(sx, 0, sz), 0.02, '#ddd', 4);
    return g.build();
  };
  const cm = litMat({ metalness: 0.05 }), cabins: THREE.Group[] = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
    g.add(new THREE.Mesh(cradle(FEST[(k * 3) % FEST.length]), cm));
    for (const sx of [-0.3, 0.3]) {              // children sitting in the cradle
      if (rnd(k * 5 + sx * 9 + 7) < 0.3) continue;
      const p = someone(k * 3 + sx * 10 + 500, 'sit', 0.6, ['boy', 'girl']);
      p.position.set(sx, -0.71, 0.05);
      g.add(p);
    }
    wheel.add(g);
    cabins.push(g);
  }
  group.add(wheel);
  return {
    group, post: [], rails: [solid(boxRing(1.9, 3.5))], light: [0, 3, 0, '#ffc070'],      // its footing, the cradles' sweep
    update: (t, dt) => {
      wheel.rotation.x += dt * (0.3 + 0.25 * Math.sin(t * 0.4));
      for (const c of cabins) c.rotation.x = -wheel.rotation.x;
    },
  };
}

/** Woven cloth for the boundary: 0 maroon-and-gold shamiana stripes, 1 faded blue tarpaulin, 2 old printed blanket. */
function clothTexture(kind: number): THREE.CanvasTexture {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  if (kind === 0) {
    const cols = ['#7e1a1d', '#e0a93a', '#17406f', '#e0a93a', '#7e1a1d', '#f1e6c8'];
    for (let i = 0; i < 8; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(i * 32, 0, 32, S); }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 14, 0, 4, S);
  } else if (kind === 1) {
    g.fillStyle = '#2f5f97';
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 0, S, 3); g.fillRect(0, S / 2, S, 2); g.fillRect(0, S - 3, S, 3);
    g.fillStyle = '#c9ced4';
    for (const x of [8, 128, 248]) for (const y of [8, S - 8]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
  } else {
    g.fillStyle = '#f0e4c0';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#a3342b' : '#2e6b4f';
      g.fillRect(x * 64 + 4, y * 64 + 4, 56, 56);
      g.fillStyle = '#f2c14e';
      g.beginPath(); g.arc(x * 64 + 32, y * 64 + 32, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f0e4c0';
      g.beginPath(); g.arc(x * 64 + 32, y * 64 + 32, 4, 0, Math.PI * 2); g.fill();
    }
  }
  // weave, dirt and old creases
  for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${0.04 + (y % 8) * 0.004})`; g.fillRect(0, y, S, 1); }
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(60,45,30,${0.03 + rnd(i) * 0.07})`; g.fillRect(rnd(i + 3) * S, rnd(i + 9) * S, 3 + rnd(i + 1) * 30, 1 + rnd(i + 5) * 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---- the mela -------------------------------------------------------------------------------------

/** the kavi sammelan's people and places, for the story (world frame; [x, z] on the ground) */
export interface Sammelan {
  kumar: Person;
  anchor: Person;
  /** on the sofas, left to right from Kumar's chair (Buddha last) */
  poets: Person[];
  /** where each sits ([0]: Kumar's armchair), at `seatY`, facing `facing` (the audience) */
  seats: [number, number][];
  seatY: number;
  facing: number;
  /** the stage's top */
  floor: number;
  /** the height of the ground (the stage, its stairs) */
  ground: (x: number, z: number) => number;
  mic: [number, number];
  micProp: HandProp;
  /** beside the mic, on Kumar's side (where whoever is called up comes to), and where the anchor steps aside to (that
   * side too, once the mic is handed over: the far stairs' side clear) */
  micSide: [number, number];
  aside: [number, number];
  lota: HandProp;
  lotaAt: [number, number];
  /** outside the back-stage door, on the ground; just inside it, at the back of the stage */
  door: [number, number];
  behind: [number, number];
  /** through the curtain, on the stage, in front of the banner (by Kumar's end of the row) */
  inside: [number, number];
  /** from Kumar's chair (a step out in front of it) round the end of the row, behind the sofas, down the far stairs and
   * away from the stage: the way he goes to find somewhere (and, backwards, the way he comes back) */
  exit: [number, number][];
  centre: [number, number];
  /** held things, put in their hands each frame (add a HandProp to have it done) */
  props: HandProp[];
  /** people the chatting leaves alone */
  quiet: Set<Person>;
  /** where to put things (the mela's group, in the world's frame) */
  group: THREE.Group;
  /** the audience on the dari (in the stage's group: their world positions by getWorldPosition), as they load */
  audience: Seated[];
  /** run every frame while Ramu is near the stage */
  ticks: Set<(dt: number) => void>;
  /** just outside the sammelan's two gates (east, then north: two places at each) */
  gates: [number, number][];
  /** the way from (x, z) (anywhere in or about the sammelan) to the gap in front of the stage, about level with toZ, round
   * the audience: in at a gate if outside the fence */
  route: (x: number, z: number, toZ: number) => [number, number][];
}

/** somebody in the audience, and how they sit (their floor clip and its speed) */
export interface Seated { actor: Actor; sit: string; scale: number }


export class Mela {
  readonly group = new THREE.Group();
  /** solid circles for collision: [x, z, r] */
  readonly posts: [number, number, number, number?, number?][] = [];   // [x, z, r, height (default: tall), foot (default: the ground)]
  /** railings you can't climb over, and walkable surfaces such as the well's stair and gallery */
  readonly rails: { ring: [number, number][]; h: number; camH: number }[] = [];   // camH: the camera cannot cross below this height (0 = it can)
  readonly floors: ((x: number, z: number) => number | null)[] = [];
  /** collision rings for the boundary cloth (thin quads; none across the tear) */
  readonly walls: [number, number][][] = [];
  readonly crowd: Pedestrians;
  /** the giant wheel, for the story */
  readonly giant: GiantWheel = { speed: 0.22, cabins: [], hub: new THREE.Vector3(), R: 11 };
  /** run every frame while the mela is near (the story's own: its chasing guards) */
  readonly always = new Set<(dt: number) => void>();
  private rides: Ride[] = [];
  private t = 0;

  constructor(map: MapData, lights: LightPool | null, desktop: boolean) {
    this.buildGround();
    this.addRide(giantWheel(this.giant), WHEEL.x, WHEEL.z, Math.PI / 2, lights);
    this.giant.hub.x += WHEEL.x;
    this.giant.hub.z += WHEEL.z;
    this.addRide(columbus(), COLUMBUS.x, COLUMBUS.z, 0, lights);
    this.addRide(chairSwing(), CHAIR_SWING.x, CHAIR_SWING.z, 0, lights);
    this.addRide(carousel(), CAROUSEL.x, CAROUSEL.z, 0, lights);
    this.addRide(hindola(), HINDOLA.x, HINDOLA.z, 0, lights);
    this.addRide(buildMautKuan(), KUAN.x, KUAN.z, -Math.PI / 2, lights);   // the foot of its stair is to the north-west, towards the aisles
    this.addRide(buildInflatable(), INFLATABLE.x, INFLATABLE.z, 0, lights);
    this.buildStage(lights, desktop);
    this.buildSammelanFence();
    this.buildStalls(lights);
    this.buildGate(lights);
    this.buildMasts(lights);
    this.buildWalls(lights);
    this.buildOperators();
    this.buildLitter(desktop);
    this.buildGrass(desktop);
    // Ramu walks on the dirt (it lies over the park's grass), the packed aisle, the dari: not sunk in them
    const mid = DZ + 150;
    this.floors.push((x, z) => {
      if (!inMela(x, z)) return null;
      if (x > this.dari.x0 && x < this.dari.x1 && z > this.dari.z0 && z < this.dari.z1) return DARI_Y;
      if (Math.abs(x - GATE.x) < 3.5 && z > mid && z < GATE.z) return AISLE_Y;
      return DIRT_Y;
    });

    // the crowd strolling the aisles: a mela is packed
    this.crowd = new Pedestrians(this.aisles(map), true);
    this.crowd.setCount(desktop ? 64 : 26);
    this.crowd.lite = 0.5;                              // half of them the light bodies (actors.ts)
    // as many guards as when the crowd was 24 (12) strong: more people, not more of them after Ramu
    this.crowd.populate(desktop ? 64 : 26, { ...MELA_MIX, security: (MELA_MIX.security ?? 0) * (desktop ? 24 / 64 : 12 / 26) });
    this.crowd.huntIf = (x, z) => inMela(x, z);        // its guards go for Ramu once he is inside, never through the cloth
    this.crowd.huntRange = 70;                          // ... from anywhere they can see across the ground
    this.group.add(this.crowd.group);
  }

  private addRide(r: Ride, x: number, z: number, ry: number, lights: LightPool | null): void {
    r.group.position.set(x, 0, z);
    r.group.rotation.y = ry;
    this.group.add(r.group);
    this.rides.push(r);
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const [px, pz, pr, ph, pb] of r.post) this.posts.push([x + px * c + pz * s, z - px * s + pz * c, pr, ph, pb]);
    if (r.rails) for (const w of r.rails) this.rails.push({ h: w.h, camH: w.camH ?? 0, ring: w.ring.map(([px, pz]) => [x + px * c + pz * s, z - px * s + pz * c] as [number, number]) });
    if (r.floor) { const f = r.floor; this.floors.push((wx, wz) => f((wx - x) * c - (wz - z) * s, (wx - x) * s + (wz - z) * c)); }
    lights?.add(x, r.light[1], z, r.light[3], 230, 34);
  }

  update(dt: number, fx: number, fz: number, dirX: number, dirZ: number, px: number, pz: number, py = 0): void {
    this.t += dt;
    const far = Math.hypot(fx - MELA.cx, fz - MELA.cz) > 260;
    if (far) return;
    if (Math.hypot(fx - this.poetsAt[0], fz - this.poetsAt[1]) < 70) {
      for (const c of this.chat) {
        if (this.quiet.has(c.p) || (c.t -= dt) > 0) continue;
        const f = c.p.face;
        f.talking = !f.talking;
        c.t = f.talking ? 1.5 + Math.random() * 3.5 : 2 + Math.random() * 5;
      }
      for (const p of this.cast) if (p.visible) p.update(dt);
      for (const h of this.props) h.update();
      for (const f of this.ticks) f(dt);
      this.audTick ^= 1;
      for (let i = this.audTick; i < this.audience.length; i += 2) this.audience[i].update(dt * 2);
    }
    // the stall people: drawn only in front of the camera and within 90 m (rigged bodies are never culled on their own),
    // and those within 60 m moving, half of them each frame
    this.stallTick ^= 1;
    const dl = Math.hypot(dirX, dirZ) || 1;
    for (let i = 0; i < this.stallPeople.length; i++) {
      const a = this.stallPeople[i], q = a.root.position, ox = q.x - fx, oz = q.z - fz, d = Math.hypot(ox, oz);
      a.root.visible = d < 10 || (d < 90 && (ox * dirX + oz * dirZ) / (d * dl) > 0.3);
      if ((i & 1) === this.stallTick && a.root.visible && d < 60) a.update(dt * 2);
    }
    for (const r of this.rides) r.update(this.t, dt);
    grassWind(this.t);
    for (const o of this.operators) this.operate(o, dt, Math.hypot(fx - o.x, fz - o.z) < 90);
    for (const f of this.always) f(dt);
    this.crowd.update(dt, fx, fz, dirX, dirZ, px, pz, py);
  }

  // ground: trodden dirt over the park grass and a packed aisle from the gate to the middle (the dari sheets under the audience are laid with the stage)
  private buildGround(): void {
    const g = new Geo();
    const sh = new THREE.Shape([[MELA.x0, MELA.z0], [MELA.x1, MELA.z0], [MELA.x1, MELA.z1], [MELA.x0, MELA.z1]].map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);   // shape y = -z; after the turn it lies flat, facing up
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, 0.05);
    g.add(geo.index ? geo.toNonIndexed() : geo, '#6f624d');
    const mid = DZ + 150;   // the packed aisle runs from the gate to the middle
    g.box(GATE.x, 0.07, (GATE.z + mid) / 2, 7, 0.02, GATE.z - mid, '#7b6d56');
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  /**
   * The sofas, once their model is in (in the stage's frame, backs to the banner, x along the row), merged by material, a
   * few draw calls for the lot.
   */
  private stageProps(stage: THREE.Group, sofas: { name: string; x: number }[], z: number, floor: number): void {
    const loader = gltfLoader();
    loader.loadAsync('models/sofas.glb').then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        let name = m.name;
        for (let p: THREE.Object3D | null = m; p; p = p.parent) if (/^(sofa2|sofa3|chair)$/.test(p.name)) { name = p.name; break; }
        for (const s of sofas) {
          if (s.name !== name) continue;
          const geo = m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(new THREE.Matrix4().makeTranslation(s.x, floor, z));
          const mat = m.material as THREE.Material;
          if (!byMat.has(mat)) byMat.set(mat, []);
          byMat.get(mat)!.push(geo);
        }
      });
      for (const [mat, geos] of byMat) {
        const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = mesh.receiveShadow = true;
        stage.add(mesh);
      }
    }).catch(() => {});
  }

  /**
   * The long low table in front of the poets (stage frame; `seats`: the poets' x along the row, `z`: the table's middle):
   * a white cloth with a maroon skirt, and before each poet a steel plate of fruit, a bottle of water and a glass, a
   * packet of biscuits here and there; a heaped bowl of fruit and a bunch of marigolds in the middle.
   */
  private stageTable(stage: THREE.Group, seats: number[], z: number, floor: number, post: (x: number, z: number, r: number, h?: number, base?: number) => void): void {
    const x0 = Math.min(...seats) - 0.55, x1 = Math.max(...seats) + 0.55, L = x1 - x0, cx = (x0 + x1) / 2, H = 0.48, top = floor + H + 0.02;
    const g = new Geo();
    g.box(cx, floor + H, z, L, 0.04, 0.66, '#ece6d6');                              // the cloth over the top
    g.box(cx, floor + H / 2, z, L + 0.02, H - 0.02, 0.68, '#7b1113');               // the skirt to the floor
    g.box(cx, floor + H - 0.06, z + 0.345, L + 0.03, 0.08, 0.01, '#f2c21b');        // a gold band along the front
    const steel = new Geo();
    const food: FoodSpot[] = [];
    seats.forEach((x, i) => {
      const r = (k: number) => rnd(i * 17 + k);
      // the plate, its rim, and the fruit on it
      steel.cyl(x, top, z - 0.04, 0.15, 0.012, '#c9c9cf', 16);
      steel.cyl(x, top + 0.012, z - 0.04, 0.15, 0.012, '#b5b5bb', 16, 0.155);
      food.push({ name: 'banana', x: x - 0.04, y: top + 0.012, z: z - 0.06, ry: r(1) * 6, s: 0.55 });
      food.push({ name: r(2) < 0.5 ? 'apple' : 'orange', x: x + 0.07, y: top + 0.012, z: z - 0.0, ry: r(3) * 6 });
      if (r(4) < 0.6) food.push({ name: 'mango', x: x - 0.06, y: top + 0.012, z: z + 0.03, ry: r(5) * 6, s: 0.85 });
      // water and a glass of it, to his right
      food.push({ name: r(6) < 0.5 ? 'water' : 'water_small', x: x + 0.24, y: top, z: z - 0.14, ry: r(7) * 6 });
      steel.cyl(x + 0.2, top, z + 0.08, 0.035, 0.1, '#d8dde2', 10, 0.04);
      if (r(8) < 0.5) food.push({ name: r(9) < 0.5 ? 'biscuits' : 'biscuits_b', x: x - 0.22, y: top, z: z + 0.12, ry: (r(10) - 0.5) * 0.8 });
    });
    // the middle: a bowl of fruit and a bunch of marigolds in a brass pot
    const mid = seats.reduce((a, b) => a + b, 0) / seats.length;
    steel.cyl(mid + 0.45, top, z + 0.12, 0.2, 0.08, '#b08d3a', 16, 0.13);
    food.push({ name: 'grapes', x: mid + 0.45, y: top + 0.06, z: z + 0.1, ry: 0.4 }, { name: 'apple', x: mid + 0.36, y: top + 0.06, z: z + 0.2, ry: 1 },
      { name: 'orange', x: mid + 0.55, y: top + 0.06, z: z + 0.18, ry: 2 }, { name: 'mango', x: mid + 0.5, y: top + 0.06, z: z + 0.02, ry: 3 },
      { name: 'coconut', x: mid - 0.5, y: top, z: z + 0.1, ry: 0.3 });
    steel.cyl(mid, top, z + 0.12, 0.08, 0.14, '#b08d3a', 12, 0.05);
    for (let k = 0; k < 14; k++) g.sphere(mid + (rnd(k) - 0.5) * 0.22, top + 0.2 + rnd(k + 3) * 0.1, z + 0.12 + (rnd(k + 7) - 0.5) * 0.16, 0.045, k % 3 ? '#ef6c00' : '#f9a825');
    const m = new THREE.Mesh(g.build(), litMat({ metalness: 0, roughness: 0.9 }));
    m.castShadow = m.receiveShadow = true;
    stage.add(m, new THREE.Mesh(steel.build(), litMat({ metalness: 0.85, roughness: 0.3 })));
    addFoods(stage, food);
    for (let x = x0 + 0.35; x < x1; x += 0.7) post(x, z, 0.35, floor + H, floor);     // knee high: jump up on it
  }

  /** the kavi sammelan's people (poets, Kumar, the anchor) and their places, for the story, once all are in */
  sammelan!: Promise<Sammelan>;
  /** ... the same people (animated, so updated while Ramu is near enough to see them), and where they sit */
  private cast: Person[] = [];
  /** things in people's hands (the mic, the lota, fruit), put there each frame */
  private props: HandProp[] = [];
  /** people the chatting leaves alone (the story has them talk) */
  private quiet = new Set<Person>();
  /** the audience as the story sees them: each with the way they sit (to sit back down after getting up) */
  private seated: Seated[] = [];
  /** the story's things that move (thrown fruit), run every frame near the stage */
  private ticks = new Set<(dt: number) => void>();
  private poetsAt: [number, number] = [0, 0];
  /** the audience on the dari, rigged (updated half at a time, while Ramu is near enough to see them) */
  private audience: Actor[] = [];
  private audTick = 0;
  /** the stall keepers and their customers (rigged, talking) */
  private stallPeople: Actor[] = [];
  private stallTick = 0;
  /** where the dari is (world): Ramu stands on it */
  private dari: Rect = { x0: 0, x1: 0, z0: 0, z1: 0 };
  /** the poets chatting on the sofas: seconds until each next starts or stops talking */
  private chat: { p: Person; t: number }[] = [];

  private buildStage(lights: LightPool | null, desktop: boolean): void {
    // The stage is built in its own frame (centre at the origin, front toward +z, audience beyond) and the group is turned so the
    // front faces east, as on the map.
    const cx = 0, cz = 0, W = STAGE.z1 - STAGE.z0, D = STAGE.x1 - STAGE.x0, SH = 1.3;
    const sx0 = (STAGE.x0 + STAGE.x1) / 2, sz0 = (STAGE.z0 + STAGE.z1) / 2;
    const stage = new THREE.Group();
    stage.position.set(sx0, 0, sz0);
    stage.rotation.y = Math.PI / 2;
    this.group.add(stage);
    const toW = (lx: number, lz: number): [number, number] => [sx0 + lz, sz0 - lx];
    const L = (x: number, y: number, z: number, color: string, intensity: number, range: number) => { const [wx, wz] = toW(x, z); lights?.add(wx, y, wz, color, intensity, range); };
    const post = (x: number, z: number, r: number, h?: number, base?: number) => { const [wx, wz] = toW(x, z); this.posts.push([wx, wz, r, h, base]); };
    const g = new Geo(), bulbs = new Bulbs();
    g.box(cx, SH / 2, cz, W, SH, D, '#6b4a2a');
    g.box(cx, SH + 0.04, cz, W - 0.4, 0.08, D - 0.4, '#bdb8a8');                                     // white gaddi (a dull white: under the stage lights a true white burns out)
    g.box(cx, SH + 0.04, cz + 0.4, W - 2, 0.1, 3.2, '#aca697');                                         // second sheet, under the poets
    for (const sx of [-1, 1]) {
      g.box(cx + sx * (W / 2 - 1.2), 0.5, cz + D / 2 + 1.0, 1.4, 1.0, 0.5, '#8a5a2a');               // steps
      for (let k = 0; k < 3; k++) g.box(cx + sx * (W / 2 + 1.3), 0.5 + k * 1.0, cz + D / 2 - 1.2, 1.2, 0.95, 1.2, '#161616');   // speaker stacks
    }
    // truss, pillars, roof
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.rod(new THREE.Vector3(cx + sx * (W / 2 - 0.2), SH, cz + sz * (D / 2 - 0.2)), new THREE.Vector3(cx + sx * (W / 2 - 0.2), 7.4, cz + sz * (D / 2 - 0.2)), 0.16, '#8f8f94');
    g.box(cx, 7.5, cz + D / 2 - 0.2, W, 0.5, 0.5, '#9a9aa0');
    g.box(cx, 7.5, cz - D / 2 + 0.2, W, 0.5, 0.5, '#9a9aa0');
    for (const sx of [-1, 1]) g.box(cx + sx * (W / 2 - 0.2), 7.5, cz, 0.5, 0.5, D, '#9a9aa0');
    g.add(new THREE.ConeGeometry(W * 0.64, 2.4, 4, 1).rotateY(Math.PI / 4), '#f2e6c9', new THREE.Matrix4().makeScale(1, 1, D / W * 1.05).setPosition(cx, 8.95, cz));
    for (let i = 0; i < 12; i++) g.box(cx - W / 2 + 0.7 + i * (W - 1.4) / 11, 7.15, cz + D / 2, 0.5, 0.4, 0.04, FEST[i % FEST.length]);   // valance
    // marigold garlands: strings of orange and yellow along the front of the truss and down the pillars
    const marigold = (a: THREE.Vector3, b: THREE.Vector3, sag: number, n: number) => {
      for (let i = 0; i <= n; i++) {
        const t = i / n, p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        g.sphere(p.x, p.y, p.z, 0.11, i % 3 === 0 ? '#f9a825' : '#ef6c00', 1, 1, 1);
      }
    };
    marigold(new THREE.Vector3(cx - W / 2, 7.2, cz + D / 2), new THREE.Vector3(cx, 7.2, cz + D / 2), 0.7, 20);
    marigold(new THREE.Vector3(cx, 7.2, cz + D / 2), new THREE.Vector3(cx + W / 2, 7.2, cz + D / 2), 0.7, 20);
    const loops = Math.round(W / 2.2), lw = W / loops;
    for (let i = 0; i < loops; i++) marigold(new THREE.Vector3(cx - W / 2 + i * lw, SH + 0.15, cz + D / 2 - 0.05), new THREE.Vector3(cx - W / 2 + (i + 1) * lw, SH + 0.15, cz + D / 2 - 0.05), 0.35, 8);
    // stage lights on the truss
    for (let i = 0; i < 9; i++) {
      const x = cx - W / 2 + 1 + i * (W - 2) / 8;
      g.box(x, 7.1, cz + D / 2 - 0.5, 0.45, 0.45, 0.45, '#1b1b1e');
      const c = ['#ff8a3d', '#ffd29a', '#6ab7ff', '#ff6fa8', '#ffd29a'][i % 5];
      bulbs.add(x, 6.85, cz + D / 2 - 0.5, c, -1, 3.2);
    }
    stage.add(new THREE.Mesh(g.build(), litMat()));
    // banner backdrop + side flex
    const tex = banner(1024, 300, '#7b1113', '#f2c21b', [
      { text: 'अखिल भारतीय कवि सम्मेलन', size: 120, color: '#ffe9a8', y: 105 },
      { text: 'मोतीझील महोत्सव  •  कानपुर', size: 64, color: '#ffffff', y: 215 },
    ]);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, 5.0), bannerMat(tex, 0.55));
    back.position.set(cx, SH + 3.1, cz - D / 2 + 0.15);
    stage.add(back);
    const side = banner(256, 512, '#0d3b66', '#fcbf49', [
      { text: 'कवि', size: 130, color: '#fcbf49', y: 130 }, { text: 'सम्मेलन', size: 90, color: '#ffffff', y: 260 }, { text: '7 PM', size: 90, color: '#ffffff', y: 390 },
    ]);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.8), bannerMat(side, 0.5));
      m.position.set(cx + sx * (W / 2 + 3.2), 3.6, cz + D / 2 - 0.6);
      stage.add(m);
      const pole = new Geo().rod(new THREE.Vector3(cx + sx * (W / 2 + 3.2), 0, cz + D / 2 - 0.7), new THREE.Vector3(cx + sx * (W / 2 + 3.2), 6.2, cz + D / 2 - 0.7), 0.07, '#888');
      stage.add(new THREE.Mesh(pole.build(), litMat()));
    }
    stage.add(bulbs.object(0.9));
    // Light for the poets, not the floor: the lamps hang out in front of the stage and above head height, so they reach the
    // people and the banner at a slant and the gaddi only at a glancing angle.
    L(cx, 6.6, cz + D / 2 + 3.5, '#ffb877', 110, 30);
    L(cx - 8, 6.4, cz + D / 2 + 2.5, '#ffd29a', 60, 26);
    L(cx + 8, 6.4, cz + D / 2 + 2.5, '#ffd29a', 60, 26);
    L(cx, 7, cz + 17, '#ffcf9a', 120, 28);
    for (const sx of [-1, 1]) post(cx + sx * (W / 2 + 1.3), cz + D / 2 - 1.2, 0.65);
    for (let i = -2; i <= 2; i++) for (const k of [-1, -0.5, 0, 0.5, 1]) post(cx + i * (W / 2 - 1.3) / 2, cz + k * (D / 2 - 1.3), 1.3, SH + 0.08);   // the platform (its top the gaddi): jump up on it
    // the two wooden boxes in front of it (a metre high): jump up on them
    for (const sx of [-1, 1]) for (const ox of [-0.45, 0, 0.45]) post(cx + sx * (W / 2 - 1.2) + ox, cz + D / 2 + 1.0, 0.25, 1.0);
    post(cx - W / 2, cz + D / 2 - 0.5, 0.5);
    post(cx + W / 2, cz + D / 2 - 0.5, 0.5);

    // people (figures.ts): poets on the gaddi, one at the mic, the audience on the floor
    const people: Spot[] = [];
    // the poets on a row of sofas across the middle of the stage (sofas.glb: tools/blender/build_props.py), a long low table
    // laid with fruit and water in front of them, the one reciting at the mic in front of that; in the armchair at the left
    // end, Kumar, the young poet (his own model: assets/kumar)
    const FLOOR = SH + 0.08, SEAT_Z = cz - 0.9, MIC: [number, number] = [cx - 2.6, cz + D / 2 - 0.9];
    const row: { name: 'chair' | 'sofa2' | 'sofa3'; w: number; seats: number[] }[] = [
      { name: 'chair', w: 0.67, seats: [0] }, { name: 'sofa2', w: 1.23, seats: [-0.3, 0.3] }, { name: 'sofa3', w: 1.8, seats: [-0.56, 0, 0.56] },
      { name: 'sofa2', w: 1.23, seats: [-0.3, 0.3] }, { name: 'chair', w: 0.67, seats: [0] },
    ];
    const GAP = 0.35, span = row.reduce((a, r) => a + r.w, 0) + GAP * (row.length - 1);
    const sofas: { name: string; x: number }[] = [], seats: number[] = [];
    let at = cx - span / 2;
    for (const r of row) {
      const x = at + r.w / 2;
      sofas.push({ name: r.name, x });
      for (const s of r.seats) seats.push(x + s);
      post(x, SEAT_Z, r.w / 2, FLOOR + 0.9, FLOOR);
      at += r.w + GAP;
    }
    this.stageProps(stage, sofas, SEAT_Z, FLOOR);
    this.stageTable(stage, seats, SEAT_Z + 1.25, FLOOR, post);
    // the poets: rigged people on the cushions, listening and talking among themselves, now and then laughing or clapping;
    // Buddha, the old poet with the white beard (his own model: assets/budda), in the armchair at the right end; Kumar,
    // the young poet (assets/kumar), in the armchair at the left end; and the anchor (assets/anchor), on his feet at the
    // front, a mic in his fist at his chin (the recite clip: the talking clip with the right hand held up there; the mic
    // is put in it every frame, HandProp). They are the story's people (stage 1, part 2 moves them about), so they are
    // Persons in the world's frame, not in the stage's group.
    const poets: RigName[] = ['uncle', 'uncle', 'boy', 'aunty', 'uncle', 'girl', 'uncle', 'buddha'];
    const CLIPS = ['sitting_talking', 'sitting_clap', 'sitting_talking', 'sitting_laughing', 'sitting_talking', 'sitting_clap', 'sitting_laughing', 'sitting_talking'];
    const FACE = -Math.PI / 2, SEAT_Y = FLOOR + SIT_Y;          // facing the audience (the stage's front, east)
    const seatW = seats.map((x) => toW(x, SEAT_Z + SIT_Z));
    // the stairs (north side, local +x) and the back-stage door (local -z), by the torn place in the wall
    const sw = STAGE_STAIRS.x1 - STAGE_STAIRS.x0, scz = (STAGE_STAIRS.x0 + STAGE_STAIRS.x1) / 2 - sx0;
    const doorX = Math.max(-W / 2 + 1.5, Math.min(W / 2 - 1.5, sz0 - (STAGE_ENTRY.z0 + STAGE_ENTRY.z1) / 2));
    const st0 = W / 2 + 0.6 - 0.3 - 0.45;                                  // local x of the top step's inner edge
    const stairs = (x: number, z: number): number | null => {
      const lx = sz0 - z, lz = x - sx0;                                      // the stage's frame (toW turned back)
      if (Math.abs(lz - scz) > sw / 2 || lx < st0 || lx > st0 + 3.6) return null;
      return (4 - Math.floor((lx - st0) / 0.9)) * SH / 4;
    };
    const ground = (x: number, z: number): number => stairs(x, z) ?? (x > STAGE.x0 && x < STAGE.x1 && z > STAGE.z0 && z < STAGE.z1 ? FLOOR : 0);
    const cast: RigName[] = [...poets, 'kumar', 'anchor'];
    const kinds = [...new Set(cast)];
    this.sammelan = Promise.all(kinds.map((k) => makeActors(k, cast.filter((p) => p === k).length))).then(async (made) => {
      const left = new Map(kinds.map((k, i) => [k, made[i]]));
      const person = (kind: RigName, [x, z]: [number, number], y: number) => {
        const p = new Person(left.get(kind)!.shift()!, x, y, z, FACE);
        p.floor = ground;
        this.group.add(p.actor.root);
        this.cast.push(p);
        return p;
      };
      const ps = poets.map((kind, i) => {
        const p = person(kind, seatW[i + 1], SEAT_Y);
        p.hold(CLIPS[i], 0.85 + rnd(i * 7 + 3) * 0.3, 0);
        p.actor.update(rnd(i * 13 + 1) * 20);                // not all at the same moment of it
        p.face.laughing = CLIPS[i] === 'sitting_laughing';
        // those talking among themselves say a few words, then listen (turned on and off in update)
        if (CLIPS[i] === 'sitting_talking') this.chat.push({ p, t: rnd(i * 5 + 2) * 4 });
        return p;
      });
      // Kumar in the armchair at the end, talking to the poet beside him now and then
      const kumar = person('kumar', seatW[0], SEAT_Y);
      kumar.hold('sitting_talking', 0.9, 0);
      kumar.actor.update(7);
      this.chat.push({ p: kumar, t: 3 });
      const anchor = person('anchor', toW(MIC[0], MIC[1]), FLOOR);
      anchor.hold('mic_talk', 0.9, 0);                       // (Katpootli: the mic at his mouth, the free hand making his points)
      anchor.walkClip = 'mic_walk';
      anchor.face.talking = true;                            // reciting, all the while
      const micObj = await gltfLoader().loadAsync('models/handmic.glb').then((g) => g.scene, () => new THREE.Group());
      micObj.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      const mic = new HandProp(micObj, 'mic', 0.07);
      this.group.add(micObj);
      mic.holder(anchor.actor.root);
      // the first poet's lota, on the floor under the table's edge in front of him (he bends down for it: pick_up)
      const lotaObj = lota(), [lx, lz] = toW(seats[1] - 0.08, SEAT_Z + LOTA_Z);
      lotaObj.position.set(lx, FLOOR, lz);
      this.group.add(lotaObj);
      this.props.push(mic);
      return {
        kumar, anchor, poets: ps, seats: seatW, seatY: SEAT_Y, facing: FACE, floor: FLOOR, ground,
        mic: toW(MIC[0], MIC[1]), micProp: mic, micSide: toW(MIC[0] - 0.85, MIC[1] - 0.25), aside: toW(MIC[0] - 1.8, MIC[1] - 0.5), lota: new HandProp(lotaObj, 'hang', LOTA_NECK), lotaAt: [lx, lz] as [number, number],
        door: toW(doorX, -D / 2 - 2.6), behind: toW(doorX, -D / 2 - 0.8), inside: toW(doorX, -D / 2 + 1.3),
        exit: [[seats[0], SEAT_Z + 0.55], [seats[0] - 0.9, SEAT_Z + 0.55], [seats[0] - 0.9, SEAT_Z - 1.5], [st0 - 0.7, SEAT_Z - 1.5],
          [st0 - 0.5, scz], [st0 + 4.2, scz], [st0 + 7.5, scz + 1.5]].map(([x, z]) => toW(x, z)),
        centre: toW(cx, cz), props: this.props, quiet: this.quiet, group: this.group, audience: this.seated, ticks: this.ticks,
        gates: [[SAMMELAN.x1 + 1.6, SAMMELAN_GATES.east.z - 0.8], [SAMMELAN.x1 + 2.4, SAMMELAN_GATES.east.z + 0.8],
          [SAMMELAN_GATES.north.x - 0.7, SAMMELAN.z0 - 1.6], [SAMMELAN_GATES.north.x + 0.7, SAMMELAN.z0 - 2.4]] as [number, number][],
        route: (x: number, z: number, toZ: number) => this.roundDari(x, z, toZ),
      };
    });
    this.sammelan.catch((e) => console.error('the sammelan failed to load', e));
    for (let i = 0; i <= poets.length; i++) post(seats[i], SEAT_Z - 0.05, 0.3, FLOOR + 1.3, FLOOR);
    post(MIC[0], MIC[1], 0.3, FLOOR + 1.8, FLOOR);
    const [px, pz] = toW(cx, SEAT_Z);
    this.poetsAt = [px, pz];
    // the audience: the front rows fairly full, a few scattered behind (about 75 people); the rows stop short of the fence
    const cols = Math.floor((AUDIENCE.z1 - AUDIENCE.z0) / 0.86), rowsN = Math.min(11, Math.floor((SAMMELAN.x1 - 1.6 - AUDIENCE.x0) / 0.95));
    const aud0 = AUDIENCE.x0 - sx0 + 0.5;       // first row, in the stage frame
    for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
      if (rnd(r * 97 + c * 13 + 5) > (r < 5 ? 0.42 : 0.15) || (!desktop && (r + c) % 2)) continue;
      const x = cx - (cols - 1) * 0.43 + c * 0.86 + (rnd(r * 7 + c) - 0.5) * 0.15, z = aud0 + r * 0.95 + (rnd(c * 5 + r) - 0.5) * 0.12;
      // facing the stage (-z) with a little turn
      people.push({ x, y: 0.09, z, ry: (rnd(r * 3 + c * 11) - 0.5) * 0.5, pose: 'sit', n: r * 131 + c * 17 });
    }
    // they are rigged people sitting on the dari (the floor clips: Sitting Idle, and two ways of sitting still), each at
    // their own moment of it, blinking now and then
    const AUD_KINDS: RigName[] = ['uncle', 'aunty', 'girl', 'boy', 'uncle', 'aunty', 'boy'];
    const kindOf = people.map((p) => AUD_KINDS[Math.floor(rnd(p.n! * 0.37 + 5) * AUD_KINDS.length)]);
    const audKinds = [...new Set(kindOf)];
    Promise.all(audKinds.map((k) => makeActors(k, kindOf.filter((x) => x === k).length, true))).then((made) => {
      const left = new Map(audKinds.map((k, i) => [k, made[i]]));
      people.forEach((p, i) => {
        const a = left.get(kindOf[i])!.shift()!;
        const u = rnd(p.n! * 0.71 + 2);
        a.root.position.set(p.x, DARI_Y, p.z);
        a.root.rotation.y = p.ry;
        const sit = u < 0.62 ? 'floor_idle' : u < 0.82 ? 'floor_cross' : 'floor_knees', scale = 0.8 + rnd(p.n! + 9) * 0.4;
        a.play(sit, scale, 0);
        a.update(rnd(p.n! * 1.3) * 11);
        a.face.blinking = true;
        stage.add(a.root);
        this.audience.push(a);
        this.seated.push({ actor: a, sit, scale });
      });
    }).catch((e) => console.error('audience failed to load', e));
    for (const [x, z, r, h, base] of figurePosts(people)) post(x, z, r, h, base);   // the poets and the audience: you go round them
    // the white dari sheets under the audience
    const d = new Geo();
    const dw = AUDIENCE.z1 - AUDIENCE.z0, dd = rowsN * 0.95 + 0.4, dcz = AUDIENCE.x0 + dd / 2 - sx0;
    d.box(0, 0.09, dcz, dw, 0.04, dd, '#c9c5b6');
    for (let i = 0; i < Math.floor(dw / 3.1); i++) d.box(-dw / 2 + 1.5 + i * 3.1, 0.115, dcz, 0.05, 0.01, dd, '#cfc9b8');
    // stage frame -> world: x = sx0 + lz, z = sz0 - lx
    this.dari = { x0: sx0 + dcz - dd / 2, x1: sx0 + dcz + dd / 2, z0: sz0 - dw / 2, z1: sz0 + dw / 2 };
    const dm = new THREE.Mesh(d.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    dm.receiveShadow = true;
    stage.add(dm);
    // stairs up the north side (local +x), and the back-stage entry by the torn place in the wall (back = local -z)
    const ex = new Geo();
    for (let i = 0; i < 4; i++) ex.box(W / 2 + 0.6 + (3 - i) * 0.9 - 0.3, (i + 1) * SH / 4 / 2, scz, 0.9, (i + 1) * SH / 4, sw, i % 2 ? '#8a5a2a' : '#7a4e24');
    // ... to walk up: each step's top is a floor (from the side the higher steps are too tall to step onto: Ramu goes round)
    this.floors.push(stairs);
    for (const sz of [-1, 1]) ex.rod(new THREE.Vector3(W / 2 + 3.2, 0.9, scz + sz * sw / 2), new THREE.Vector3(W / 2 + 0.2, SH + 0.9, scz + sz * sw / 2), 0.04, '#b8b8bc');
    ex.box(doorX, 0.35, -D / 2 - 1.0, 2.0, 0.7, 1.4, '#8a5a2a');
    for (const ox of [-0.5, 0.5]) post(doorX + ox, -D / 2 - 1.0, 0.5, 0.7);           // the step up at the back: on top of it
    ex.box(doorX, 0.175, -D / 2 - 2.05, 2.0, 0.35, 0.7, '#7a4e24');                    // ... and a lower one before it
    for (const ox of [-0.6, 0, 0.6]) post(doorX + ox, -D / 2 - 2.05, 0.4, 0.35);
    ex.box(doorX, 0.8, -D / 2 - 0.3, 2.6, 1.6, 0.12, '#1c1c20');
    for (const sx of [-1, 1]) ex.rod(new THREE.Vector3(doorX + sx * 1.35, SH, -D / 2 - 0.1), new THREE.Vector3(doorX + sx * 1.35, SH + 2.6, -D / 2 - 0.1), 0.05, '#b8b8bc');
    ex.box(doorX, SH + 2.7, -D / 2 - 0.1, 2.8, 0.1, 0.1, '#b8b8bc');
    for (const sx of [-1, 1]) ex.box(doorX + sx * 0.7, SH + 1.3, -D / 2 - 0.12, 1.3, 2.4, 0.04, '#7b1113');   // curtain halves
    stage.add(new THREE.Mesh(ex.build(), litMat({ metalness: 0.1, roughness: 0.8 })));
  }

  /**
   * A wooden fence round the kavi sammelan, from the cloth wall at the back round the stage and its audience: posts of
   * rough timber every two metres, three planks, two ways in framed by taller posts and a beam with marigolds. It is a
   * railing Ramu can't climb (the camera passes over it).
   */
  private buildSammelanFence(): void {
    const { x0, x1, z0, z1 } = SAMMELAN, { east, north } = SAMMELAN_GATES;
    const g = new Geo();
    const WOOD = ['#6b4a2b', '#7a5532', '#5f4126', '#735030'];
    const H = 1.25, STEP = 2.0;
    // straight runs [ax, az] -> [bx, bz] with the gaps cut out
    const runs: [number, number, number, number][] = [
      [x0 + 0.15, z0, north.x - north.half, z0], [north.x + north.half, z0, x1, z0],
      [x1, z0, x1, east.z - east.half], [x1, east.z + east.half, x1, z1],
      [x1, z1, x0 + 0.15, z1],
    ];
    let n = 0;
    for (const [ax, az, bx, bz] of runs) {
      const len = Math.hypot(bx - ax, bz - az), alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const k = Math.max(1, Math.round(len / STEP));
      for (let i = 0; i <= k; i++, n++) {
        const x = ax + ((bx - ax) * i) / k, z = az + ((bz - az) * i) / k, h = H + 0.08 + (rnd(n * 3 + 1) - 0.5) * 0.08;
        g.box(x, h / 2, z, 0.11, h, 0.11, WOOD[n % 4]);
        g.box(x, h + 0.02, z, 0.13, 0.04, 0.13, '#4e3520');              // a cut top, darker
      }
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      for (const [j, y] of [0.32, 0.72, 1.12].entries()) {
        const sag = (rnd(n * 7 + j) - 0.5) * 0.03;
        g.box(mx, y + sag, mz, alongX ? len : 0.035, 0.13, alongX ? 0.035 : len, WOOD[(n + j + 1) % 4]);
      }
      this.rails.push({ h: H, camH: 0, ring: alongX
        ? [[ax, az - 0.1], [bx, bz - 0.1], [bx, bz + 0.1], [ax, az + 0.1]]
        : [[ax - 0.1, az], [bx - 0.1, bz], [bx + 0.1, bz], [ax + 0.1, az]] });
    }
    // the ways in: taller posts, a beam over, a string of marigolds under it
    const gate = (ax: number, az: number, bx: number, bz: number) => {
      for (const [x, z] of [[ax, az], [bx, bz]]) {
        g.box(x, 1.4, z, 0.16, 2.8, 0.16, '#5f4126');
        this.posts.push([x, z, 0.12, 2.8]);
      }
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az), w = Math.hypot(bx - ax, bz - az) + 0.5;
      g.box((ax + bx) / 2, 2.72, (az + bz) / 2, alongX ? w : 0.18, 0.16, alongX ? 0.18 : w, '#6b4a2b');
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, y = 2.55 - Math.sin(t * Math.PI) * 0.3;
        g.sphere(ax + (bx - ax) * t, y, az + (bz - az) * t, 0.08, i % 3 === 0 ? '#f9a825' : '#ef6c00', 1, 1, 1);
      }
    };
    gate(x1, east.z - east.half, x1, east.z + east.half);
    gate(north.x - north.half, z0, north.x + north.half, z0);
    const m = new THREE.Mesh(g.build(), litMat({ metalness: 0, roughness: 0.95 }));
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
  }

  private buildStalls(lights: LightPool | null): void {
    const g = new Geo(), bulbs = new Bulbs();
    const keepers: Spot[] = [];
    const types = 4;
    const stall = (x: number, z: number, ry: number, seed: number) => {
      const type = Math.floor(rnd(seed) * types), col = FEST[Math.floor(rnd(seed + 1) * FEST.length)], col2 = FEST[Math.floor(rnd(seed + 2) * FEST.length)];
      const c = Math.cos(ry), s = Math.sin(ry);
      const P = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
      const bx = (lx: number, y: number, lz: number, sx: number, sy: number, sz: number, color: string) => {
        const [px, pz] = P(lx, lz);
        g.box(px, y, pz, sx, sy, sz, color, ry);
      };
      bx(0, 0.5, 0.15, 2.5, 1.0, 0.9, col);                         // counter
      bx(0, 0.52, 0.15, 2.56, 0.06, 0.96, '#e8d8b0');
      bx(0, 1.3, -0.95, 2.8, 2.6, 0.06, col2);                       // back cloth
      for (const sx of [-1.35, 1.35]) { const [px, pz] = P(sx, 0.8); g.rod(new THREE.Vector3(px, 0, pz), new THREE.Vector3(px, 3.0, pz), 0.04, '#b08a55'); const [qx, qz] = P(sx, -0.95); g.rod(new THREE.Vector3(qx, 0, qz), new THREE.Vector3(qx, 3.1, qz), 0.04, '#b08a55'); }
      // sloping striped canopy
      for (let k = 0; k < 8; k++) {
        const lx = -1.4 + (k + 0.5) * 0.35;
        const [px, pz] = P(lx, -0.1);
        g.add(new THREE.BoxGeometry(0.35, 0.05, 2.1), k % 2 ? '#fff4d6' : col, new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeRotationX(0.14)).setPosition(px, 3.0, pz));
        bx(lx, 2.75, 0.97, 0.3, 0.3, 0.03, k % 2 ? col2 : '#fff4d6');   // scalloped valance
      }
      // lights: tube light + bulbs along the front edge
      const [tx, tz] = P(0, 0.75);
      bulbs.add(tx, 2.85, tz, '#fff6e0', -1, 3.0);
      for (let k = 0; k < 7; k++) { const [px, pz] = P(-1.2 + k * 0.4, 1.0); bulbs.add(px, 2.7, pz, BULB[(k + Math.floor(seed)) % 6], (k % 4) / 4, 1.0); }
      // goods
      if (type === 0) {         // toys + balloons
        for (let k = 0; k < 26; k++) { const [px, pz] = P((rnd(seed + k) - 0.5) * 2.4, -0.55 + rnd(seed + k + 40) * 0.5); g.sphere(px, 1.7 + rnd(seed + k + 80) * 0.9, pz, 0.22, FEST[k % FEST.length], 1, 1.2, 1); }
        for (let k = 0; k < 8; k++) bx(-1.0 + k * 0.28, 0.7, 0.1, 0.18, 0.25, 0.2, FEST[(k + 3) % FEST.length]);
      } else if (type === 1) {  // chaat / jalebi: a big kadhai with a glowing fire
        const [kx, kz] = P(-0.5, 0.2);
        g.cyl(kx, 1.03, kz, 0.5, 0.18, '#1c1c1c', 12, 0.4);
        g.cyl(kx, 1.2, kz, 0.42, 0.02, '#e07a10', 12);
        bulbs.add(kx, 1.3, kz, '#ff7a1a', -1, 3.4);
        for (let k = 0; k < 5; k++) bx(0.5 + (k % 2) * 0.3, 1.1 + k * 0.1, 0.1, 0.45, 0.07, 0.45, k % 2 ? '#e8d8b0' : '#f2c21b');
      } else if (type === 2) {  // bangles + accessories hung on the back cloth
        for (let r = 0; r < 4; r++) for (let k = 0; k < 11; k++) bx(-1.2 + k * 0.24, 1.2 + r * 0.38, -0.88, 0.16, 0.26, 0.04, FEST[(r * 3 + k) % FEST.length]);
      } else {                   // cotton candy: pink clouds on sticks
        for (let k = 0; k < 9; k++) { const [px, pz] = P(-1.0 + k * 0.25, 0.15); g.sphere(px, 1.5 + (k % 3) * 0.08, pz, 0.24, k % 2 ? '#ff9ec7' : '#ffd1e3', 1, 1.1, 1); g.rod(new THREE.Vector3(px, 1.05, pz), new THREE.Vector3(px, 1.3, pz), 0.012, '#eee', 4); }
        const [mx, mz] = P(0.9, 0.15);
        g.cyl(mx, 1.0, mz, 0.4, 0.3, '#d8d8de', 12);
      }
      this.posts.push([x, z, 1.35]);
      // the stall keeper behind the counter, and now and then somebody buying
      const [kx, kz] = P((rnd(seed + 5) - 0.5) * 1.2, -0.58);
      keepers.push({ x: kx, y: 0.05, z: kz, ry: ry + Math.PI, pose: rnd(seed + 6) < 0.5 ? 'stand' : 'talk', n: seed * 3 + 1 });
      const buyers = rnd(seed + 7) < 0.45 ? (rnd(seed + 8) < 0.4 ? 2 : 1) : 0;
      for (let b = 0; b < buyers; b++) {
        const [px, pz] = P((rnd(seed + 9 + b) - 0.5) * 1.6 + (b ? 0.7 : 0), 1.25 + rnd(seed + 11 + b) * 0.3);
        keepers.push({ x: px, y: 0.05, z: pz, ry: ry + (rnd(seed + 13 + b) - 0.5) * 0.6, pose: ONLOOKER[Math.floor(rnd(seed + 15 + b) * ONLOOKER.length)], n: seed * 7 + b + 2 });
      }
    };
    // the blocks of the map: stalls in a row along the long side, two rows back to back when the block is deep enough;
    // the fronts face outward, into the aisles
    let n = 0;
    const bunting = new Geo();
    const string = (a: THREE.Vector3, b: THREE.Vector3, sag: number, step: number, ph: number) => {
      const len = a.distanceTo(b), nb = Math.max(2, Math.round(len / step));
      for (let i = 0; i <= nb; i++) {
        const t = i / nb, p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        bulbs.add(p.x, p.y, p.z, BULB[(i + ph) % BULB.length], ((i + ph) % 6) / 6, 1.0);
        if (i % 2 === 1) bunting.add(new THREE.BoxGeometry(0.28, 0.34, 0.012), FEST[(i + ph) % FEST.length], new THREE.Matrix4().makeRotationZ(Math.PI / 4).setPosition(p.x, p.y - 0.18, p.z));
      }
    };
    const SPACING = 3.0;
    for (const B of STALL_BLOCKS) {
      const w = B.x1 - B.x0, d = B.z1 - B.z0, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
      const horizontal = w >= d, len = horizontal ? w : d, depth = horizontal ? d : w;
      const count = Math.max(1, Math.floor(len / SPACING)), rows = depth >= 5 ? 2 : 1;
      for (let r = 0; r < rows; r++) {
        const side = rows === 2 ? (r ? 1 : -1) : 0, off = side * 1.05;
        for (let k = 0; k < count; k++) {
          const along = (k - (count - 1) / 2) * (len / count);
          if (horizontal) stall(cx + along, cz + off, side > 0 ? 0 : Math.PI, 10 + n++);
          else stall(cx + off, cz + along, side > 0 ? Math.PI / 2 : -Math.PI / 2, 10 + n++);
        }
      }
      // strings of bulbs and bunting along both long edges, and one light over the block
      const e = depth / 2 + 0.3;
      for (const sd of [-1, 1]) {
        if (horizontal) string(new THREE.Vector3(B.x0 + 0.4, 3.2, cz + sd * e), new THREE.Vector3(B.x1 - 0.4, 3.2, cz + sd * e), 0.8, 0.85, Math.floor(cx + sd));
        else string(new THREE.Vector3(cx + sd * e, 3.2, B.z0 + 0.4), new THREE.Vector3(cx + sd * e, 3.2, B.z1 - 0.4), 0.8, 0.85, Math.floor(cz + sd));
      }
      lights?.add(cx, 4.4, cz, '#ffc98a', 150, 22);
    }
    this.group.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.05, roughness: 0.8 })));
    this.group.add(new THREE.Mesh(bunting.build(), litMat({ metalness: 0, roughness: 0.9, side: THREE.DoubleSide })));
    this.group.add(bulbs.object(0.7));
    // the keepers and their customers are rigged people (the light bodies, actors.ts), talking: the keeper selling, the
    // customer haggling, or looking round at the goods; each at their own moment of it
    const KINDS: RigName[] = ['uncle', 'aunty', 'girl', 'boy', 'uncle', 'boy', 'aunty', 'girl', 'uncle'];
    const kindOf = keepers.map((p) => KINDS[Math.floor(rnd(p.n! * 0.53 + 3) * KINDS.length)]);
    const kinds = [...new Set(kindOf)];
    Promise.all(kinds.map((k) => makeActors(k, kindOf.filter((x) => x === k).length, true))).then((made) => {
      const left = new Map(kinds.map((k, i) => [k, made[i]]));
      keepers.forEach((p, i) => {
        const a = left.get(kindOf[i])!.shift()!;
        const u = rnd(p.n! * 0.91 + 4);
        a.root.position.set(p.x, DIRT_Y, p.z);
        a.root.rotation.y = p.ry;
        a.play(u < 0.7 ? 'talk' : u < 0.85 ? 'argue' : 'look_around', 0.85 + rnd(p.n! + 17) * 0.3, 0);
        a.update(rnd(p.n! * 1.7) * 9);
        a.face.blinking = true;
        this.group.add(a.root);
        this.stallPeople.push(a);
      });
    }).catch((e) => console.error('stall people failed to load', e));
    for (const [x, z, r, h, base] of figurePosts(keepers)) this.posts.push([x, z, r, h, base]);   // the stall-keepers and their customers
  }

  private buildGate(lights: LightPool | null): void {
    const cx = GATE.x, cz = GATE.z - 0.8, W = 15;
    const g = new Geo(), bulbs = new Bulbs();
    for (const sx of [-1, 1]) {
      g.box(cx + sx * W / 2, 3.2, cz, 1.2, 6.4, 1.2, '#f2e6c9');
      g.box(cx + sx * W / 2, 6.6, cz, 1.7, 0.4, 1.7, '#b3261e');
      g.add(new THREE.ConeGeometry(0.8, 1.6, 4).rotateY(Math.PI / 4), '#f2c21b', new THREE.Matrix4().makeTranslation(cx + sx * W / 2, 7.6, cz));
      for (let i = 0; i < 12; i++) bulbs.add(cx + sx * W / 2 + sx * 0.64, 0.4 + i * 0.5, cz + 0.62, BULB[i % 6], (i % 6) / 6, 1.1);
    }
    g.box(cx, 6.2, cz, W, 1.2, 1.0, '#8b1a1a');
    for (let i = 0; i < 16; i++) g.box(cx - W / 2 + 0.5 + i * (W - 1) / 15, 7.0, cz, 0.4, 0.5, 0.5, FEST[i % FEST.length]);
    for (let i = 0; i < 28; i++) { const x = cx - W / 2 + i * W / 27; bulbs.add(x, 5.55, cz + 0.55, BULB[i % 6], (i % 8) / 8, 1.2); bulbs.add(x, 6.85, cz + 0.55, BULB[(i + 2) % 6], (i % 8) / 8, 1.2); }
    this.group.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.05 })));
    const tex = banner(1024, 200, '#8b1a1a', '#f2c21b', [{ text: 'मोतीझील मेला — स्वागतम्', size: 100, color: '#ffe9a8', y: 100 }]);
    for (const dz of [0.52, -0.52]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.4, 1.1), bannerMat(tex, 0.7));
      m.position.set(cx, 6.2, cz + dz);
      if (dz < 0) m.rotation.y = Math.PI;
      this.group.add(m);
    }
    this.group.add(bulbs.object(0.85));
    lights?.add(cx, 5, cz - 2, '#ffbf80', 260, 30);
    this.posts.push([cx - W / 2, cz, 0.9], [cx + W / 2, cz, 0.9]);
  }

  // tall floodlight masts on the edges: the white glare that makes a mela visible from far away
  private buildMasts(lights: LightPool | null): void {
    const g = new Geo(), bulbs = new Bulbs();
    for (const [lx, lz] of [[-5.5, 131], [105.5, 131], [-5.5, 199], [105.5, 199], [44, 129.5], [30, 201], [75, 201]]) {
      const x = DX + lx, z = DZ + lz;
      g.rod(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 11, z), 0.12, '#7a7d82');
      g.box(x, 11.2, z, 1.7, 0.5, 0.3, '#2a2a2e');
      for (let k = 0; k < 4; k++) bulbs.add(x - 0.6 + k * 0.4, 11.0, z - 0.2, '#fff7e0', -1, 3.2);
      this.posts.push([x, z, 0.3]);
      lights?.add(x, 10, z, '#fff0d0', 320, 40);
    }
    this.group.add(new THREE.Mesh(g.build(), litMat()), bulbs.object(1.0));
  }

  // ---- the people who run the rides --------------------------------------------------------------------

  /** each ride's operator, at a control box with a lever (models/lever.glb: tools/blender/build_lever.py) */
  private operators: { a: Actor; x: number; z: number; arm: THREE.Object3D | null; t: number; pull: number; n: number }[] = [];

  /**
   * Every ride has its man: he stands at a painted iron control box beside it, watching it go round, and every so often
   * he pushes the lever on the box over (and back, the next time). The inflatable's attendant just stands by its door.
   * Placed by the ride's middle, the direction out from it (radians, 0 = +x, PI/2 = +z) and the distance.
   */
  private buildOperators(): void {
    const box = new Geo();
    const spots: { x: number; z: number; ry: number; lever: boolean; kind: RigName }[] = [];
    const place = (c: { x: number; z: number }, ang: number, dist: number, kind: RigName, lever = true) => {
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const bx = c.x + dx * dist, bz = c.z + dz * dist, ry = Math.atan2(dx, dz);     // he faces the ride
      if (lever) {
        box.box(bx, 0.36, bz, 0.5, 0.62, 0.9, '#2f5d3a', ry);                       // the box, on short legs
        box.box(bx, 0.68, bz, 0.54, 0.04, 0.94, '#24462c', ry);
        for (const [lx, lz] of [[-0.2, -0.4], [0.2, -0.4], [-0.2, 0.4], [0.2, 0.4]]) {
          const wx = bx + lx * Math.cos(ry) + lz * Math.sin(ry), wz = bz - lx * Math.sin(ry) + lz * Math.cos(ry);
          box.box(wx, 0.03, wz, 0.06, 0.06, 0.06, '#1b1b1b', ry);
        }
        box.box(bx + 0.252 * Math.cos(ry), 0.5, bz - 0.252 * Math.sin(ry), 0.01, 0.16, 0.5, '#d8c060', ry);   // a yellow warning plate
        this.posts.push([bx, bz, 0.4, 0.7]);
      }
      const ox = bx + dx * (lever ? 0.72 : 0), oz = bz + dz * (lever ? 0.72 : 0);
      spots.push({ x: ox, z: oz, ry, lever, kind });
      this.posts.push([ox, oz, 0.26, 1.7]);
      return [bx, bz, ry] as const;
    };
    const levers: (readonly [number, number, number])[] = [
      place(WHEEL, Math.PI / 2, 4.6, 'uncle'),
      place(COLUMBUS, 0, 5.6, 'boy'),
      place(CHAIR_SWING, Math.PI * 0.75, 8.3, 'uncle'),
      place(CAROUSEL, -Math.PI / 2, 6.0, 'boy'),
      place(HINDOLA, Math.PI, 3.0, 'uncle'),
    ];
    place(INFLATABLE, 1.0, INFLATABLE.r + 2.2, 'boy', false);
    const m = new THREE.Mesh(box.build(), litMat({ metalness: 0.4, roughness: 0.6 }));
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    gltfLoader().loadAsync('models/lever.glb').then((gltf) => {
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      levers.forEach(([bx, bz, ry], i) => {
        const lv = gltf.scene.clone(true);
        lv.position.set(bx, 0.7 - 0.16, bz);             // its plate on the box's lid, the cog down inside
        lv.rotation.y = ry;
        this.group.add(lv);
        const arm = lv.getObjectByName('arm') ?? null;
        if (arm) arm.rotation.x = 0.38;                  // over towards him
        const op = this.operators.find((o) => o.n === i);
        if (op) op.arm = arm;
        this.leverArms[i] = arm;
      });
    }).catch((e) => console.error('lever failed to load', e));
    const kinds = [...new Set(spots.map((s) => s.kind))];
    Promise.all(kinds.map((k) => makeActors(k, spots.filter((s) => s.kind === k).length))).then((made) => {
      const left = new Map(kinds.map((k, i) => [k, made[i]]));
      spots.forEach((s, i) => {
        const a = left.get(s.kind)!.shift()!;
        a.root.position.set(s.x, DIRT_Y, s.z);
        a.root.rotation.y = s.ry;
        a.play(s.lever ? 'idle' : 'look_around', 0.9 + rnd(i) * 0.2, 0);
        a.face.blinking = true;
        this.group.add(a.root);
        this.operators.push({ a, x: s.x, z: s.z, arm: s.lever ? this.leverArms[i] ?? null : null, t: 6 + rnd(i * 3) * 14, pull: -1, n: s.lever ? i : -1 });
      });
    }).catch((e) => console.error('operators failed to load', e));
  }
  private leverArms: (THREE.Object3D | null)[] = [];

  /** the giant wheel's operator (by his lever), for the story; null until loaded */
  get wheelMan(): Actor | null { return this.operators.find((o) => o.n === 0)?.a ?? null; }

  /** the giant wheel's operator pulls his lever now (the arm goes over as his hand gets there, ~0.9 s) */
  pullWheelLever(): void {
    const o = this.operators.find((p) => p.n === 0);
    if (o) { o.pull = 0; o.a.once('push_one', 'lever-story' + this.t.toFixed(2), 1, 0.2); }
  }

  /** an operator's few seconds: waiting, now and then the push on the lever (the arm goes over as his hand gets there) */
  private operate(o: Mela['operators'][number], dt: number, near: boolean): void {
    if (!near) return;
    o.a.update(dt);
    if (o.n < 0) return;
    if (o.pull < 0) {
      o.t -= dt;
      if (o.t <= 0) { o.pull = 0; o.a.once('push_one', 'lever' + this.t.toFixed(1), 1, 0.25); }
      return;
    }
    const from = o.arm?.userData.at ?? 0.38;
    o.pull += dt;
    if (o.arm) {
      const k = Math.min(1, Math.max(0, (o.pull - 0.55) / 0.35));
      o.arm.rotation.x = from + (-from - from) * k * k * (3 - 2 * k);
    }
    if (o.pull > 1.6) {
      if (o.arm) o.arm.userData.at = -from;
      o.pull = -1;
      o.t = 12 + Math.random() * 18;
      o.a.play('idle', 1, 0.4);
    }
  }

  // ---- litter: the ground after a few evenings of the mela -----------------------------------------------

  /**
   * The way from (x, z) to the front of the stage round the audience on the dari (a block nobody gets through): in at the
   * sammelan's gate if outside its fence, along the dari's side nearer (z) to the gap between it and the stage, then along
   * that gap to about `toZ`.
   */
  private roundDari(x: number, z: number, toZ: number): [number, number][] {
    const d = this.dari, side = z < (d.z0 + d.z1) / 2 ? d.z0 - 0.9 : d.z1 + 0.9, gap = d.x0 - 0.7;
    const out: [number, number][] = [];
    // outside the fence: in through the gate first
    const { east, north } = SAMMELAN_GATES;
    if (x > SAMMELAN.x1) out.push([SAMMELAN.x1 + 1, Math.max(east.z - east.half + 0.6, Math.min(east.z + east.half - 0.6, z))], [SAMMELAN.x1 - 1.2, east.z]);
    else if (z < SAMMELAN.z0) out.push([Math.max(north.x - north.half + 0.5, Math.min(north.x + north.half - 0.5, x)), SAMMELAN.z0 - 1], [north.x, SAMMELAN.z0 + 1.2]);
    if (x > d.x0) out.push([Math.min(x, d.x1 + 0.9), side]);
    out.push([gap, side], [gap, Math.max(d.z0 + 0.5, Math.min(d.z1 - 0.5, toZ))]);
    return out;
  }

  /**
   * Worn patches of grass on the open ground (grass.ts): a green-brown stain on the dirt (roadDirt.ts) with clumps and
   * sprigs of grass in it, thick in the middle, thinning out. Where the feet don't go: away from the stalls' fronts, the
   * aisle, the dari, the rides.
   */
  private buildGrass(desktop: boolean): void {
    let seed = 313;
    const r = () => rnd(seed++ * 0.731);
    const inR = (b: Rect, x: number, z: number) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
    const pad = (b: Rect, m: number) => ({ x0: b.x0 - m, x1: b.x1 + m, z0: b.z0 - m, z1: b.z1 + m });
    const rides = [{ ...WHEEL, r: 5 }, { ...COLUMBUS, r: 8 }, { ...CHAIR_SWING, r: 9 }, { ...CAROUSEL, r: 7 }, { ...HINDOLA, r: 5 },
      { ...INFLATABLE, r: INFLATABLE.r + 3 }, { ...KUAN, r: KUAN.r + 1 }];
    const mid = DZ + 150;
    const bare = (x: number, z: number) => STALL_BLOCKS.some((b) => inR(pad(b, 1.2), x, z)) || inR(pad(STAGE, 1), x, z)
      || inR(pad(this.dari, 0.5), x, z) || (Math.abs(x - GATE.x) < 5 && z > mid) || rides.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)
      || x < MELA.x0 + 0.6 || x > MELA.x1 - 0.6 || z < MELA.z0 + 0.6 || z > MELA.z1 - 0.6;
    const spots: GrassSpot[] = [];
    const stains: [number, number, number, number, number][] = [];
    const N = desktop ? 60 : 26;
    for (let i = 0, tries = 0; i < N && tries < 2000; tries++) {
      const x = MELA.x0 + 2 + r() * (MELA.x1 - MELA.x0 - 4), z = MELA.z0 + 2 + r() * (MELA.z1 - MELA.z0 - 4);
      if (bare(x, z)) continue;
      i++;
      const R = 0.8 + r() * 1.8;
      stains.push([x, DIRT_Y + 0.004, z, R * 2.3, r() * 6.28]);
      const n = Math.round(R * R * (desktop ? 2.6 : 1.6));
      for (let k = 0; k < n; k++) {
        const a = r() * 6.28, d = Math.pow(r(), 0.8) * R, gx = x + Math.cos(a) * d, gz = z + Math.sin(a) * d;
        if (bare(gx, gz)) continue;
        const edge = d / R;                                        // smaller and sparser toward the rim
        const tuft = r() < 0.8 - edge * 0.4;
        spots.push({ name: tuft ? 'tuft' : 'sprig', x: gx, y: DIRT_Y - 0.01, z: gz, ry: r() * 6.28,
          s: tuft ? (0.7 + r() * 0.5) * (1 - edge * 0.35) : 1.3 + r() * 0.9 });
      }
    }
    addGrass(this.group, spots);
    this.group.add(groundDecals({ grass: stains }));
  }

  /**
   * Chip packets, wrappers, cans, cartons and bottles (foods.ts), paper cups, leaf plates (pattal) and scraps of paper, and
   * flat dirt (roadDirt.ts): thickest round the stalls, thinner in the open, none under the rides or in the stalls.
   */
  private buildLitter(desktop: boolean): void {
    let seed = 91;
    const r = () => rnd(seed++ * 0.613);
    const pad = (b: Rect, m: number) => ({ x0: b.x0 - m, x1: b.x1 + m, z0: b.z0 - m, z1: b.z1 + m });
    const inR = (b: Rect, x: number, z: number) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
    const rides = [{ ...WHEEL, r: 3 }, { ...COLUMBUS, r: 6 }, { ...CHAIR_SWING, r: 1.5 }, { ...CAROUSEL, r: 5 }, { ...HINDOLA, r: 3.6 },
      { ...INFLATABLE, r: INFLATABLE.r + 1 }, { ...KUAN, r: KUAN.r }];
    const blocked = (x: number, z: number) => STALL_BLOCKS.some((b) => inR(pad(b, 0.2), x, z)) || inR(STAGE, x, z)
      || rides.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
    const nearStalls = (x: number, z: number) => STALL_BLOCKS.some((b) => inR(pad(b, 3.5), x, z));
    const items: FoodSpot[] = [];
    const cups = new Geo(), plates = new Geo();
    const decals: { litter: [number, number, number, number, number][]; mud: [number, number, number, number, number][] } = { litter: [], mud: [] };
    const N = desktop ? 2600 : 1200;
    const THINGS: [FoodName, number][] = [['chips', 3], ['chips_b', 3], ['chips_c', 2], ['flat_bag', 3], ['wrapper', 2], ['wrapper_b', 2],
      ['can', 1.5], ['carton', 1.5], ['cookie_pack', 1.5], ['water_small', 1.2], ['popcorn', 0.6]];
    const total = THINGS.reduce((a, [, w]) => a + w, 0);
    const mid = DZ + 150;
    for (let i = 0; i < N; i++) {
      const x = MELA.x0 + 0.5 + r() * (MELA.x1 - MELA.x0 - 1), z = MELA.z0 + 0.5 + r() * (MELA.z1 - MELA.z0 - 1);
      if (blocked(x, z) || r() > (nearStalls(x, z) ? 1 : 0.35)) continue;
      const y = (inR(this.dari, x, z) ? DARI_Y : Math.abs(x - GATE.x) < 3.5 && z > mid ? AISLE_Y : DIRT_Y) + 0.003;
      const what = r();
      if (what < 0.5) {                                   // something out of the food pack, mostly lying flat
        let w = r() * total, k = 0;
        while (w > THINGS[k][1]) w -= THINGS[k++][1];
        const name = THINGS[k][0];
        const lying = name === 'can' || name === 'carton' || name === 'water_small' || name === 'popcorn';
        const crushed = 0.35 + r() * 0.5;
        items.push(lying
          ? { name, x, y: y + (name === 'can' ? 0.05 : name === 'water_small' ? 0.032 : name === 'popcorn' ? 0.06 : 0.016), z, ry: r() * 6.28, rz: Math.PI / 2, s: name === 'popcorn' ? 0.8 : 1 }
          : { name, x, y, z, ry: r() * 6.28, rx: (r() - 0.5) * 0.3, s: 1, ...(name.startsWith('chips') ? { s: 0.9 } : {}), ...(crushed < 0.5 ? { rz: 0.2 } : {}) });
      } else if (what < 0.65) {                           // a paper cup: of chai, tipped over
        const a = r() * 6.28, tip = r() < 0.8;
        const cup = new THREE.CylinderGeometry(0.035, 0.026, 0.07, 8, 1, true);
        cups.add(cup, r() < 0.7 ? '#efeae0' : '#d9c7a3', tip
          ? new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).setPosition(x, y + 0.03, z)
          : new THREE.Matrix4().makeTranslation(x, y + 0.035, z));
      } else if (what < 0.78) {                           // a leaf plate (pattal), flat or a little curled
        const rr = 0.1 + r() * 0.05;
        plates.add(new THREE.CylinderGeometry(rr, rr * 0.8, 0.012, 10), r() < 0.5 ? '#6f7a3a' : '#8a7a45',
          new THREE.Matrix4().makeRotationX((r() - 0.5) * 0.25).setPosition(x, y + 0.008, z));
      } else if (what < 0.93) {
        decals.litter.push([x, y + 0.002, z, 0.5 + r() * 0.8, r() * 6.28]);
      } else {
        decals.mud.push([x, y + 0.001, z, 1.2 + r() * 2.2, r() * 6.28]);
      }
    }
    addFoods(this.group, items);
    const cm = new THREE.Mesh(cups.build(), litMat({ metalness: 0, roughness: 0.85, side: THREE.DoubleSide }));
    const pm = new THREE.Mesh(plates.build(), litMat({ metalness: 0, roughness: 0.95 }));
    cm.receiveShadow = pm.receiveShadow = true;
    this.group.add(cm, pm, groundDecals(decals));
  }

  // ---- boundary: long cloth walls on bamboo poles, with one torn place to slip in through -------------

  private buildWalls(lights: LightPool | null): void {
    const H = 3.4, SPAN = 3.0;
    const kinds: THREE.BufferGeometry[][] = [[], [], []];
    const poles = new Geo();
    const jag = (i: number) => rnd(i * 12.9898 + 4.1);

    /** Cloth between two poles; `strips` gives the lowest y of the cloth for each 0.25 m strip (torn edges), else a full panel. */
    const cloth = (ax: number, az: number, dx: number, dz: number, len: number, kind: number, seed: number,
                   bottom?: (xl: number) => number): void => {
      const rot = Math.atan2(-dz, dx);
      const M = new THREE.Matrix4().makeRotationY(rot).setPosition(ax, 0, az);
      const strips = Math.max(4, Math.round(len / 0.25)), rows = 6;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i <= strips; i++) {
        const xl = (i / strips) * len;
        const tt = xl / len;
        const b = bottom ? bottom(xl) : 0.15 + jag(seed + i) * 0.06;
        const sag = Math.sin(tt * Math.PI) * 0.16;                  // top edge hangs between the poles
        const top = H - sag;
        for (let r = 0; r <= rows; r++) {
          const f = r / rows, y = b + (top - b) * f;
          const billow = 0.09 * Math.sin(xl * 1.7 + seed) * (0.4 + 0.6 * f) + 0.07 * Math.sin(xl * 0.6 + y * 1.3 + seed * 2.0);
          pos.push(xl, y, billow);
          uv.push(xl / 1.5, y / 1.5);
        }
      }
      for (let i = 0; i < strips; i++) for (let r = 0; r < rows; r++) {
        const a = i * (rows + 1) + r, bq = a + 1, c = a + rows + 1, d = c + 1;
        idx.push(a, c, bq, bq, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.applyMatrix4(M);
      kinds[kind].push(g);
    };

    const L = WALL_LOOP;
    let seed = 0;
    for (let e = 0; e < L.length; e++) {
      const a = L[e], b = L[(e + 1) % L.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      // the openings on this edge: the torn place, and the gate (a clear gap); distance along the edge, measured from `a`
      const along = (q: { x: number; z: number }) => ((q.x - a[0]) * dx + (q.z - a[1]) * dz);
      const onThis = (q: { x: number; z: number }) => Math.abs((q.x - a[0]) * dz - (q.z - a[1]) * dx) < 0.5 && along(q) > 0 && along(q) < len;
      const here = [{ q: TEAR, half: 3, torn: true }, { q: GATE, half: GATE.half, torn: false }].filter((o) => onThis(o.q)).sort((u, v) => along(u.q) - along(v.q));
      const spans: { s0: number; s1: number; torn: boolean }[] = [];
      let cur = 0;
      for (const o of here) {
        const st = along(o.q);
        if (st - o.half - cur > 0.3) spans.push({ s0: cur, s1: st - o.half, torn: false });
        if (o.torn) spans.push({ s0: st - 3, s1: st + 3, torn: true });
        cur = st + o.half;
      }
      if (len - cur > 0.3) spans.push({ s0: cur, s1: len, torn: false });
      for (const sp of spans) {
        const n = Math.max(1, Math.round((sp.s1 - sp.s0) / SPAN)), w = (sp.s1 - sp.s0) / n;
        const P = (s: number): [number, number] => [a[0] + dx * s, a[1] + dz * s];
        if (sp.torn) {
          // one 6 m piece of cloth with a ragged opening in the middle: the lower edge climbs to a ragged lip, a few strips dangle
          const c = 3;
          const bottom = (xl: number) => {
            const d = Math.abs(xl - c), j = jag(Math.round(xl * 4) + 77);
            if (d < 1.05) return 2.55 + j * 0.45;
            if (d < 2.1) return 0.15 + (2.6 - 0.15) * (1 - (d - 1.05) / 1.05) + (j - 0.5) * 0.5;
            return 0.15 + jag(Math.round(xl * 4)) * 0.06;
          };
          const [px, pz] = P(sp.s0);
          cloth(px, pz, dx, dz, 6, 2, 900 + e, bottom);
          for (let k = 0; k < 7; k++) {                       // torn threads hanging into the opening
            const xl = c - 1.0 + (k / 6) * 2.0 + (jag(k + 5) - 0.5) * 0.2;
            const low = 1.5 + jag(k + 31) * 0.8;
            const [tx, tz] = P(sp.s0 + xl);
            const g = new THREE.PlaneGeometry(0.09 + jag(k) * 0.07, 2.65 - low, 1, 3);
            g.translate(0, low + (2.65 - low) / 2, 0.03);
            g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(-dz, dx)).setPosition(tx, 0, tz));
            kinds[2].push(g);
          }
          // collision: the two solid stretches either side of the 2 m gap
          this.wallQuad([P(sp.s0), P(sp.s0 + c - 1.0)], dx, dz);
          this.wallQuad([P(sp.s0 + c + 1.0), P(sp.s1)], dx, dz);
          for (const s of [sp.s0, sp.s1]) { const [qx, qz] = P(s); poles.rod(new THREE.Vector3(qx, 0, qz), new THREE.Vector3(qx, H + 0.4, qz), 0.055, '#8a6a3a'); }
          // two poles bracing the opening
          for (const off of [-1.45, 1.45]) { const [qx, qz] = P(sp.s0 + c + off); poles.rod(new THREE.Vector3(qx, 0, qz), new THREE.Vector3(qx + dz * 0.15, H - 0.2, qz - dx * 0.15), 0.045, '#8a6a3a'); }
          continue;
        }
        for (let k = 0; k < n; k++) {
          const [px, pz] = P(sp.s0 + k * w);
          cloth(px, pz, dx, dz, w + 0.04, (seed++ * 7 + e) % 3, seed * 3.7);
          poles.rod(new THREE.Vector3(px, 0, pz), new THREE.Vector3(px, H + 0.4, pz), 0.055, '#8a6a3a');
        }
        const [ex, ez] = P(sp.s1);
        poles.rod(new THREE.Vector3(ex, 0, ez), new THREE.Vector3(ex, H + 0.4, ez), 0.055, '#8a6a3a');
        this.wallQuad([P(sp.s0), P(sp.s1)], dx, dz);
      }
    }
    const mats = [clothTexture(0), clothTexture(1), clothTexture(2)].map((map) =>
      new THREE.MeshStandardMaterial({ map, roughness: 0.95, side: THREE.DoubleSide, emissive: new THREE.Color('#ffffff'), emissiveMap: map, emissiveIntensity: 0.16 }));
    kinds.forEach((list, i) => {
      if (!list.length) return;
      const merged = mergeGeometries(list.map((g) => { const x = g.index ? g.toNonIndexed() : g; x.deleteAttribute('normal'); x.computeVertexNormals(); return x; }))!;
      const m = new THREE.Mesh(merged, mats[i]);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    });
    this.group.add(new THREE.Mesh(poles.build(), litMat({ metalness: 0, roughness: 0.9 })));
    // the torn place: a trodden path leads to it from the park (no glow of its own: it stood at the stage's back corner
    // and burnt the stage out)
    const path = new Geo();
    path.box(TEAR.x - 3, 0.06, TEAR.z, 6, 0.02, 3.2, '#8a7a60');   // the alley beside the building west of the wall is ~6 m wide
    this.group.add(new THREE.Mesh(path.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
  }

  /** Thin collision slab along a wall stretch (ends given as map points). */
  private wallQuad(ends: [number, number][], dx: number, dz: number): void {
    const [a, b] = ends;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) return;
    const nx = -dz * 0.12, nz = dx * 0.12;
    this.walls.push([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]]);
  }

  /** aisles of the mela as a street graph: a grid of free cells (clear of stalls, rides, the stage and the wall), linked to their neighbours */
  private aisles(map: MapData): MapData {
    const road = (pts: [number, number][]) => ({ id: 0, pts, w: 1.0, cls: 'service', name: '', oneway: false, lanes: 1, bridge: false, layer: 0, divider: false, sidewalk: 'no', surface: '' });
    const pad = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, x1: r.x1 + m, z0: r.z0 - m, z1: r.z1 + m });
    const solids: Rect[] = [...STALL_BLOCKS.map((r) => pad(r, 1.4)), pad(STAGE, 1.2), pad(AUDIENCE, 0.4), pad(SAMMELAN, 0.8)];
    const discs = [{ ...WHEEL, r: WHEEL.r + 1.5 }, { ...INFLATABLE, r: INFLATABLE.r + 2 }, { ...KUAN, r: KUAN.r + 1.5 },
      { ...CAROUSEL, r: 6.5 }, { ...HINDOLA, r: 7 }, { ...COLUMBUS, r: 8 }, { ...CHAIR_SWING, r: 8 }];
    const X0 = MELA.x0 + 1.5, X1 = MELA.x1 - 1.5, Z0 = MELA.z0 + 0.5, Z1 = MELA.z1 - 0.5;
    const free = (x: number, z: number) =>
      x > X0 && x < X1 && z > Z0 && z < Z1 &&
      !solids.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) && !discs.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
    const S = 4.5, roads: ReturnType<typeof road>[] = [];
    const gx = (i: number) => MELA.x0 + 2 + i * S, gz = (j: number) => MELA.z0 + 1.5 + j * S;
    for (let i = 0; gx(i) < X1; i++) for (let j = 0; gz(j) < Z1; j++) {
      if (!free(gx(i), gz(j))) continue;
      if (free(gx(i + 1), gz(j)) && gx(i + 1) < X1) roads.push(road([[gx(i), gz(j)], [gx(i + 1), gz(j)]]));
      if (free(gx(i), gz(j + 1)) && gz(j + 1) < Z1) roads.push(road([[gx(i), gz(j)], [gx(i), gz(j + 1)]]));
    }
    return { ...map, roads };
  }
}
