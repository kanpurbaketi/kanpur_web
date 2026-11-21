import * as THREE from 'three';
import { addFigures, figure, figurePosts, ONLOOKER, Spot } from './figures';
import { banner, Bulbs, Geo, litMat, rnd } from './geo';
import { beamMaterial } from './night';
import { cloneCar, loadPBR } from './vehicleModels';
import { Actor, makeActors, RigName } from './actors';

/*
 Maut ka kuan (the Well of Death): a tall round wooden drum with a railed gallery on top where the crowd leans over,
 a round stair that winds up the outside to it, a ticket booth, flood lights, and motorbikes and cars that circle on the wall.
 Built as a Ride (see mela.ts): a group at the well's centre, an update(t) that moves the vehicles, collision posts.
 Local frame: the well is centred on (0, 0).
*/

export const WELL_R = 12.0;    // inner radius of the drum
const H = 13;                  // wall height (the gallery floor)
const YK = H / 8.2;            // the vehicles' heights on the wall were set for a wall 8.2 m high
const TAU = Math.PI * 2;

const wallPoint = (a: number, r: number, y: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
/** y-rotation that turns a box's x axis along the circle's tangent at angle a */
const tangentRy = (a: number) => -(a + Math.PI / 2);

// ---- vehicles (local frame: x right, y up, z forward; the origin is where the wheels touch) ----------

function bikeModel(rider: number, tank: string): THREE.Group {
  const lamps = new Bulbs();
  const root = new THREE.Group();
  // the motorbike is a Royal Enfield Classic 350, the well of death's own (tools/blender/import_vehicle.py); the rider sits on it
  loadPBR('enfield').then((parts) => root.add(cloneCar(parts, tank)));
  lamps.add(0, 0.82, 0.86, '#fff4d6', -1, 1.1);
  lamps.add(0, 0.7, -0.98, '#ff3030', -1, 0.6);
  // rider (figures.ts): leaning forward, arms to the bar, feet on the pegs
  const man = figure('boy', rider, 'ride');
  man.position.set(0, 0.3, -0.33);
  man.rotation.y = Math.PI;                  // the bike's front is +z
  root.add(man);
  root.add(lamps.object(0.8));
  return root;
}

/** the show-offs dancing on the cars' roofs (rigged: updated with the well) */
const dancers: Actor[] = [];

function carModel(file: string, dancer: RigName, n: number): THREE.Group {
  const root = new THREE.Group();
  loadPBR(file).then((parts) => root.add(cloneCar(parts, '#ffffff')));
  // somebody standing up on the roof and dancing, arms up, as the car goes round the wall
  makeActors(dancer, 1, true).then(([a]) => {
    a.root.position.set(0, 1.43, -0.4);
    a.root.rotation.y = n % 2 ? Math.PI : Math.PI * 0.8;
    a.play('dance', 0.95 + n * 0.08, 0);
    a.update(n * 0.7);
    a.face.blinking = true;
    a.face.laughing = n % 2 === 0;
    root.add(a.root);
    dancers.push(a);
  }).catch((e) => console.error('dancer failed to load', e));
  return root;
}

// ---- the well ------------------------------------------------------------------------------------------

export function buildMautKuan() {
  const group = new THREE.Group();
  const posts: [number, number, number, number?, number?][] = [];
  const g = new Geo(), bulbs = new Bulbs();
  const R = WELL_R;

  // the wooden drum: dark upright planks, steel hoops on the outside
  const PL = 144;
  const wood = ['#3a2c21', '#43352a', '#2c211a', '#3d2d22', '#4a1c16'];   // dark, with a few blood-stained planks
  for (let i = 0; i < PL; i++) {
    const a = ((i + 0.5) / PL) * TAU, p = wallPoint(a, R + 0.07, H / 2);
    g.box(p.x, p.y, p.z, (TAU * R) / PL + 0.02, H, 0.14, wood[rnd(i * 3.1) < 0.09 ? 4 : (i * 7 + Math.floor(rnd(i) * 3)) % 4], tangentRy(a));
  }
  for (const y of [0.7, H * 0.36, H * 0.66, H - 0.5]) for (let i = 0; i < 72; i++) {
    const a0 = (i / 72) * TAU, a1 = ((i + 1) / 72) * TAU;
    g.rod(wallPoint(a0, R + 0.2, y), wallPoint(a1, R + 0.2, y), 0.05, '#555a60', 4);
  }
  g.cyl(0, 0, 0, R + 0.1, 0.1, '#8d7048', 48);      // sand floor
  g.cyl(0, 0.1, 0, R * 0.56, 0.025, '#6b1414', 40);
  g.cyl(0, 0.1, 0, R * 0.5, 0.03, '#7d6240', 40);

  // gallery: a ring floor on a scaffold, a railing with X lattice, a plain outer rail the banners hang from
  const RG0 = R + 0.05, RG1 = R + 1.8, NG = 96;
  // the round stair: it winds up the outside of the scaffold from its foot (at A0) to a landing level with the gallery (ending
  // at A1). The angle falls as it climbs; the last LAND of the way is the landing, where the gallery's outer rail is open.
  const RS0 = RG1 + 0.1, RS1 = RS0 + 2.0;
  const A0 = 2.356, SPAN = 3.5, LAND = 0.17, A1 = A0 - SPAN, STEPS = 72, DA = (SPAN - LAND) / STEPS;
  const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
  const inGap = (a: number, m = 0) => { const d = wrap(a - A1); return d < LAND + m || d > TAU - m; };
  for (let i = 0; i < NG; i++) {
    const a = ((i + 0.5) / NG) * TAU, rm = (RG0 + RG1) / 2, p = wallPoint(a, rm, H - 0.06);
    g.box(p.x, p.y, p.z, (TAU * rm) / NG + 0.03, 0.1, RG1 - RG0, i % 2 ? '#7a6a55' : '#6f5f4b', tangentRy(a));
  }
  for (let i = 0; i < 28; i++) {          // scaffold: upright posts under the gallery's outer edge (the stair passes outside them)
    const a = (i / 28) * TAU, b = ((i + 1) / 28) * TAU;
    g.rod(wallPoint(a, RG1 - 0.05, 0), wallPoint(a, RG1 - 0.05, H - 0.1), 0.08, '#6e747b', 5);
    for (const [y0, y1] of [[0.2, H * 0.48], [H * 0.5, H - 0.3]]) {
      g.rod(wallPoint(a, RG1 - 0.05, y0), wallPoint(b, RG1 - 0.05, y1), 0.025, '#8d939a', 4);
      g.rod(wallPoint(a, RG1 - 0.05, y1), wallPoint(b, RG1 - 0.05, y0), 0.025, '#8d939a', 4);
    }
  }
  for (let i = 0; i < NG; i++) {
    const a0 = (i / NG) * TAU, a1 = ((i + 1) / NG) * TAU;
    const am = (a0 + a1) / 2;
    const skip = inGap(am);   // gap in the outer rail where the stair's landing meets the gallery
    {
      const ri = R + 0.2, tall = i % 4 === 0;
      for (const [y, rr] of [[1.12, 0.04], [0.62, 0.028], [0.14, 0.028]] as const) g.rod(wallPoint(a0, ri, H + y), wallPoint(a1, ri, H + y), rr, '#d9541e', 4);
      g.rod(wallPoint(a0, ri, H + 0.12), wallPoint(a1, ri, H + 1.1), 0.012, '#c8501a', 3);
      g.rod(wallPoint(a0, ri, H + 1.1), wallPoint(a1, ri, H + 0.12), 0.012, '#c8501a', 3);
      g.rod(wallPoint(a0, ri, H), wallPoint(a0, ri, H + (tall ? 3.3 : 1.12)), tall ? 0.05 : 0.03, tall ? '#3a6bb0' : '#d9541e', 5);
    }
    if (!skip) {
      const ro = RG1 - 0.05;
      g.rod(wallPoint(a0, ro, H + 1.12), wallPoint(a1, ro, H + 1.12), 0.035, '#d9541e', 4);
      g.rod(wallPoint(a0, ro, H + 0.5), wallPoint(a1, ro, H + 0.5), 0.025, '#d9541e', 4);
      g.rod(wallPoint(a0, ro, H), wallPoint(a0, ro, H + 1.12), 0.03, '#d9541e', 4);
    }
    // strings of bulbs along the top, floods on the tall posts
    if (i % 4 === 0 && !skip) {
      const p = wallPoint(a0, R + 0.25, H + 3.3);
      for (let k = -1; k <= 1; k += 2) {
        const q = wallPoint(a0 + k * 0.025, R + 0.35, H + 3.15);
        bulbs.add(q.x, q.y, q.z, (i / 4) % 2 ? '#ff3a22' : '#fff2d8', -1, 1.1);
      }
      g.box(p.x, p.y - 0.05, p.z, 0.5, 0.35, 0.12, '#2a2a2e', tangentRy(a0));
      const sk = wallPoint(a0, R + 0.2, H + 3.62);                       // a skull on top of each tall post
      g.sphere(sk.x, sk.y, sk.z, 0.2, '#e8e2cf', 1, 1.05, 1);
      g.box(sk.x, sk.y - 0.2, sk.z, 0.2, 0.12, 0.2, '#e8e2cf', tangentRy(a0));
      for (const e of [-1, 1]) { const q = wallPoint(a0 + e * 0.012, R + 0.2 - 0.17, H + 3.64); g.sphere(q.x, q.y, q.z, 0.055, '#120808'); }
    }
    const rb = wallPoint(a0, RG1, H + 3.0);
    bulbs.add(rb.x, rb.y, rb.z, i % 2 ? '#ff2a1a' : '#fff2d8', (i % 8) / 8, 1.0);
  }
  for (let i = 0; i < NG; i++) {   // the bulb string along the top rim, drooping between the tall posts
    const a0 = (i / NG) * TAU;
    if (i % 4 === 0) g.rod(wallPoint(a0, R + 0.2, H + 1.12), wallPoint(a0, R + 0.2, H + 3.3), 0.012, '#3a6bb0', 3);
  }
  // central pole
  g.cyl(0, 0.1, 0, 0.11, H + 1.4, '#1a1a1d', 8);
  for (let k = 0; k < 8; k++) g.cyl(0, 0.8 + k * 1.7, 0, 0.125, 0.55, '#a31515', 8);

  // the round stair: treads on two stringers, posts under it, a handrail each side with bulbs along the outer one
  const top = (i: number) => (H - 0.01) * ((i + 1) / STEPS);
  for (let i = 0; i < STEPS; i++) {
    const a = A0 - (i + 0.5) * DA, an = A0 - (i + 1.5) * DA, y = top(i), yn = top(Math.min(i + 1, STEPS - 1));
    const p = wallPoint(a, (RS0 + RS1) / 2, y - 0.04);
    g.box(p.x, p.y, p.z, ((RS0 + RS1) / 2) * DA + 0.06, 0.08, RS1 - RS0, i % 2 ? '#8a7a64' : '#7f705b', tangentRy(a));
    for (const [r, rail] of [[RS0 + 0.04, 0.028], [RS1 - 0.04, 0.035]] as const) {
      g.rod(wallPoint(a, r, y - 0.14), wallPoint(an, r, yn - 0.14), 0.06, '#6e747b', 4);              // stringer
      g.rod(wallPoint(a, r, y + 1.0), wallPoint(an, r, yn + 1.0), rail, '#d9541e', 4);                 // handrail
      if (i % 3 === 0) g.rod(wallPoint(a, r, y), wallPoint(a, r, y + 1.0), 0.022, '#d9541e', 4);
      if (i % 6 === 3 && y > 0.6) g.rod(wallPoint(a, r, 0), wallPoint(a, r, y - 0.1), 0.05, '#6e747b', 5);
    }
    if (i % 4 === 0) { const q = wallPoint(a, RS1, y + 1.12); bulbs.add(q.x, q.y, q.z, (i / 4) % 2 ? '#ff3a22' : '#fff2d8', (i % 16) / 16, 1.0); }
  }
  for (let k = 0; k < 4; k++) {            // the landing, level with the gallery
    const a = A1 + LAND * (1 - (k + 0.5) / 4), p = wallPoint(a, (RG1 + RS1) / 2, H - 0.06);
    g.box(p.x, p.y, p.z, ((RG1 + RS1) / 2) * (LAND / 4) + 0.06, 0.1, RS1 - RG1 + 0.1, '#7a6a55', tangentRy(a));
  }
  for (const y of [1.0, 0.5]) {
    g.rod(wallPoint(A1 + LAND, RS1 - 0.04, H + y), wallPoint(A1, RS1 - 0.04, H + y), 0.03, '#d9541e', 4);
    g.rod(wallPoint(A1, RS1 - 0.04, H + y), wallPoint(A1, RG1, H + y), 0.03, '#d9541e', 4);              // closed at the far end
  }
  for (const r of [RS1 - 0.04, RG1 + 0.3]) g.rod(wallPoint(A1, r, 0), wallPoint(A1, r, H + 1.0), 0.06, '#6e747b', 5);
  // ticket booth by the foot of the stair
  const BA = A0 + 0.5, BX = Math.cos(BA) * (RS1 + 1.8), BZ = Math.sin(BA) * (RS1 + 1.8);
  g.box(BX, 1.3, BZ, 1.8, 2.6, 1.6, '#c9a34a');
  g.box(BX, 2.65, BZ, 2.2, 0.12, 2.0, '#b3261e');
  g.box(BX + 0.92, 1.1, BZ, 0.1, 0.9, 1.0, '#26323d');
  group.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.15, roughness: 0.8 })));
  group.add(bulbs.object(0.8));

  // painted words on the inside of the drum, and the hung banners outside
  const face = "'Noto Sans Devanagari','Kohinoor Devanagari','Mangal','Devanagari Sangam MN','Nirmala UI',Arial,sans-serif";
  const paint = document.createElement('canvas');
  paint.width = 1024; paint.height = 256;
  const pg = paint.getContext('2d')!;
  pg.textAlign = 'center'; pg.textBaseline = 'middle';
  pg.font = `bold 170px ${face}`;
  pg.fillStyle = 'rgba(214,40,30,0.92)';
  pg.fillText('मौत का कुआँ', 512, 128, 960);
  const ptex = new THREE.CanvasTexture(paint);
  ptex.colorSpace = THREE.SRGBColorSpace;
  ptex.wrapS = THREE.RepeatWrapping;
  ptex.repeat.x = -1;      // read from inside the drum
  ptex.offset.x = 1;
  const pmat = new THREE.MeshStandardMaterial({ map: ptex, transparent: true, roughness: 1, side: THREE.BackSide, depthWrite: false });
  const arcBand = (a: number, w: number, r: number, y0: number, h: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24, 1, true, Math.PI / 2 - a - w / 2, w), mat);
    m.position.y = y0 + h / 2;
    group.add(m);
  };
  arcBand(Math.PI / 2, 1.3, R - 0.005, H * 0.5, 3.4, pmat);
  arcBand(-Math.PI / 2, 1.3, R - 0.005, H * 0.5, 3.4, pmat);
  // a painted skull and crossbones, glowing red eyes
  const sc = document.createElement('canvas');
  sc.width = 1024; sc.height = 640;
  const sg = sc.getContext('2d')!;
  sg.lineCap = 'round';
  sg.strokeStyle = 'rgba(226,218,194,.92)';
  sg.lineWidth = 46;
  for (const d of [-1, 1]) { sg.beginPath(); sg.moveTo(512 - d * 330, 60); sg.lineTo(512 + d * 330, 560); sg.stroke(); }
  sg.fillStyle = 'rgba(232,226,207,.96)';
  sg.beginPath(); sg.ellipse(512, 270, 200, 190, 0, 0, Math.PI * 2); sg.fill();
  sg.beginPath(); sg.roundRect(402, 380, 220, 120, 28); sg.fill();
  sg.strokeStyle = 'rgba(40,25,20,.85)';
  sg.lineWidth = 7;
  for (let k = 0; k < 5; k++) { sg.beginPath(); sg.moveTo(430 + k * 41, 440); sg.lineTo(430 + k * 41, 500); sg.stroke(); }
  for (const d of [-1, 1]) {
    const gl = sg.createRadialGradient(512 + d * 80, 270, 8, 512 + d * 80, 270, 78);
    gl.addColorStop(0, 'rgba(255,70,40,1)'); gl.addColorStop(0.45, 'rgba(120,10,10,1)'); gl.addColorStop(1, 'rgba(10,4,4,1)');
    sg.fillStyle = gl;
    sg.beginPath(); sg.ellipse(512 + d * 80, 270, 66, 76, d * 0.2, 0, Math.PI * 2); sg.fill();
  }
  sg.fillStyle = 'rgba(20,8,8,.95)';
  sg.beginPath(); sg.moveTo(512, 320); sg.lineTo(486, 372); sg.lineTo(538, 372); sg.closePath(); sg.fill();
  const stex = new THREE.CanvasTexture(sc);
  stex.colorSpace = THREE.SRGBColorSpace;
  stex.wrapS = THREE.RepeatWrapping;
  stex.repeat.x = -1;
  stex.offset.x = 1;
  const smat = new THREE.MeshStandardMaterial({ map: stex, emissiveMap: stex, emissive: new THREE.Color(0.18, 0.1, 0.08), transparent: true, roughness: 1, side: THREE.BackSide, depthWrite: false });
  arcBand(0, 0.85, R - 0.006, H * 0.3, 6.4, smat);
  arcBand(Math.PI, 0.85, R - 0.006, H * 0.3, 6.4, smat);
  // opaque cladding behind the planks, so nothing that rides the wall can show through from outside
  const skin = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.17, R + 0.17, H, 64, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 1, side: THREE.DoubleSide }));
  skin.position.y = H / 2;
  group.add(skin);
  const cap = new THREE.Mesh(new THREE.RingGeometry(R - 0.02, R + 0.25, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 1 }));
  cap.position.y = H - 0.02;
  group.add(cap);
  const outer = (a: number, tex: THREE.Texture) => arcBand(a, 1.2, RG1 - 0.02, H + 0.1, 1.0, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.55, 0.55, 0.55), roughness: 0.8 }));
  outer(0.2, banner(1024, 128, '#120a0a', '#a31515', [{ text: 'सिर्फ एक गलती सीधे यमराज के दर्शन', size: 70, color: '#ff4a2e', y: 66 }]));
  outer(2.2, banner(1024, 128, '#6e0d0d', '#e0a526', [{ text: 'मौत का कुआँ', size: 96, color: '#ffe14d', y: 66 }]));
  outer(-2.6, banner(1024, 128, '#120a0a', '#a31515', [{ text: 'WALL OF DEATH  ·  टिकट ₹30', size: 70, color: '#ff4a2e', y: 66 }]));
  const sign = banner(256, 128, '#b3261e', '#fcbf49', [{ text: 'टिकट', size: 60, color: '#ffe14d', y: 38 }, { text: '₹30', size: 60, color: '#ffffff', y: 92 }]);
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: new THREE.Color(0.6, 0.6, 0.6) }));
  sm.position.set(BX + 0.99, 2.15, BZ);
  sm.rotation.y = Math.PI / 2;
  group.add(sm);

  // the crowd leaning on the rail, and a few waiting at the booth
  const spots: Spot[] = [];
  for (let i = 0; i < 112; i++) {
    const a = ((i + 0.5) / 112) * TAU + (rnd(i) - 0.5) * 0.03;
    if (inGap(a, 0.06)) continue;                     // the way in from the stair is kept clear
    if (rnd(i * 3 + 1) < 0.12) continue;
    const r = R + 0.55 + rnd(i * 5) * 0.35, p = wallPoint(a, r, H - 0.01);
    const kid = rnd(i * 9 + 2) < 0.12;
    spots.push({
      x: p.x, y: H - 0.01, z: p.z, ry: Math.atan2(Math.cos(a), Math.sin(a)) + (rnd(i * 7) - 0.5) * 0.5, n: i,
      pose: ONLOOKER[Math.floor(rnd(i * 13) * ONLOOKER.length)], ...(kid ? { s: 0.66, kind: i % 2 ? 'boy' : 'girl' } as const : {}),
    });
  }
  for (let i = 0; i < 14; i++) {       // waiting at the foot of the stair, by the booth
    const a = A0 + 0.06 + rnd(i * 3) * 0.34, rr = RS1 + 0.9 + rnd(i * 5) * 2.6;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    spots.push({ x, y: 0.02, z, ry: Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2 + (rnd(i * 7) - 0.5) * 1.2, n: 100 + i, pose: ONLOOKER[Math.floor(rnd(i * 17 + 3) * ONLOOKER.length)] });
  }
  addFigures(group, spots);
  posts.push(...figurePosts(spots));      // the onlookers on the gallery and at the booth stand in the way

  // moving vehicles: bikes ride near-horizontal bands high on the wall, cars lower and tilted
  interface Veh { obj: THREE.Group; a0: number; w: number; y0: number; amp: number; sp: number; phi: number; ph: number; off: number }
  const vehicles: Veh[] = [
    { obj: bikeModel(1, '#d62828'), a0: 0.0, w: 1.55, y0: 5.6, amp: 0.9, sp: 0.5, phi: 0.1, ph: 0.0, off: 0.04 },
    { obj: bikeModel(4, '#1f4aa6'), a0: 2.2, w: 1.4, y0: 4.4, amp: 1.0, sp: 0.4, phi: 0.08, ph: 1.7, off: 0.04 },
    { obj: bikeModel(6, '#2a2a30'), a0: 4.1, w: 1.7, y0: 6.2, amp: 0.8, sp: 0.6, phi: 0.12, ph: 3.1, off: 0.04 },
    { obj: carModel('maruti_red', 'boy', 0), a0: 1.0, w: 0.9, y0: 2.4, amp: 0.4, sp: 0.3, phi: 0.12, ph: 0.6, off: 0.32 },
    { obj: carModel('maruti', 'uncle', 1), a0: 3.3, w: 0.85, y0: 2.7, amp: 0.5, sp: 0.35, phi: 0.1, ph: 2.4, off: 0.32 },
    { obj: carModel('maruti_green', 'boy', 2), a0: 5.4, w: 0.95, y0: 2.2, amp: 0.35, sp: 0.25, phi: 0.14, ph: 4.2, off: 0.32 },
  ];
  for (const v of vehicles) group.add(v.obj);
  // each headlight throws a soft pool of light on the wall ahead of it (a curved strip, so it hugs the drum)
  const wallPool = (a0: number, a1: number, w: number) => {
    const N = 14, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = a0 + (a1 - a0) * t;
      for (const j of [0, 1]) { pos.push(Math.cos(a) * (R - 0.016), (j - 0.5) * w, Math.sin(a) * (R - 0.016)); uv.push(j, 1 - t); }
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  };
  const poolMat = beamMaterial(0.6);
  poolMat.side = THREE.DoubleSide;
  const bikePool = wallPool(0.07, 0.07 + 3.2 / R, 1.5), carPool = wallPool(0.21, 0.21 + 4.6 / R, 2.6);
  const pools = vehicles.map((v, i) => {
    const m = new THREE.Mesh(i < 3 ? bikePool : carPool, poolMat);
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.userData.noAO = true;
    group.add(m);
    return m;
  });
  const f = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3(), r = new THREE.Vector3(), mm = new THREE.Matrix4();
  const place = (t: number) => {
    for (const v of vehicles) {
      const a = v.a0 + v.w * t, y = (v.y0 + Math.sin(t * v.sp + v.ph) * v.amp) * YK;
      f.set(-Math.sin(a), 0, Math.cos(a));
      n.set(-Math.cos(a), 0, -Math.sin(a));
      u.copy(n).multiplyScalar(Math.cos(v.phi)).addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(v.phi)).normalize();
      r.crossVectors(u, f);
      mm.makeBasis(r, u, f).setPosition(Math.cos(a) * (R - v.off), y, Math.sin(a) * (R - v.off));
      v.obj.matrix.copy(mm);
      v.obj.matrixAutoUpdate = false;
      v.obj.matrixWorldNeedsUpdate = true;
      const pm = pools[vehicles.indexOf(v)];
      pm.rotation.y = -a;
      pm.position.y = y;
    }
  };
  place(0);

  // collision: the drum and its scaffold (only up to the gallery floor, so the gallery is clear), the booth
  for (let i = 0; i < 84; i++) {
    const a = (i / 84) * TAU;
    posts.push([Math.cos(a) * (R + 0.9), Math.sin(a) * (R + 0.9), 0.9, H - 0.35]);
  }
  posts.push([BX, BZ, 1.35]);
  // railings: the inner rail all round, the outer rail with a gap at the stair, and the stair's two handrails
  const arc = (a0: number, a1: number, r: number, n: number) => Array.from({ length: n + 1 }, (_, k) => { const a = a0 + ((a1 - a0) * k) / n; return [Math.cos(a) * r, Math.sin(a) * r] as [number, number]; });
  const loop = (pts: [number, number][], back: [number, number][]) => [...pts, ...back.reverse()];
  const rails = [
    // the two gallery rails also hold the camera in (camH): from outside, the rail and the banners came between it and Ramu
    { ring: arc(0, TAU, R + 0.22, 96).slice(0, 96), h: H + 1.1, camH: H + 6 },
    { ring: loop(arc(A1 + LAND, A1 + TAU, RG1 - 0.05, 96), arc(A1 + LAND, A1 + TAU, RG1 - 0.1, 96)), h: H + 1.1, camH: H + 6 },
    // the stair's outer handrail, in lengths that rise with it, and the closed end of the landing
    ...Array.from({ length: 14 }, (_, k) => {
      const a0 = A0 - (SPAN * k) / 14, a1 = A0 - (SPAN * (k + 1)) / 14;
      return { ring: loop(arc(a0, a1, RS1, 4), arc(a0, a1, RS1 + 0.06, 4)), h: Math.min(H, (H * (A0 - a1)) / (SPAN - LAND)) + 1.1, camH: 0 };
    }),
    { ring: [wallPoint(A1, RG1, 0), wallPoint(A1, RS1 + 0.06, 0), wallPoint(A1 - 0.004, RS1 + 0.06, 0), wallPoint(A1 - 0.004, RG1, 0)].map((p) => [p.x, p.z] as [number, number]), h: H + 1.1, camH: 0 },
  ];
  // walkable: the gallery ring, and the stair (a smooth ramp through the treads) with its landing
  const floor = (x: number, z: number): number | null => {
    const rr = Math.hypot(x, z);
    if (rr < R) return 0.1;                          // the sand floor of the well
    if (rr >= RG0 + 0.1 && rr <= RG1) return H - 0.01;
    if (rr > RG1 && rr <= RS1) {
      const da = wrap(A0 - Math.atan2(z, x));
      if (da <= SPAN) return Math.min(H - 0.01, (H - 0.01) * (da / (SPAN - LAND)));
    }
    return null;
  };

  return {
    group,
    update: (t: number, dt: number) => { place(t); for (const d of dancers) d.update(dt); },
    post: posts,
    rails,
    floor,
    light: [0, H + 2.5, 0, '#ff8a60'] as [number, number, number, string],
  };
}
