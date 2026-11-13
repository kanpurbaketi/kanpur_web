import * as THREE from 'three';
import { banner, Bulbs, Geo, litMat, rnd } from './geo';
import { beamMaterial } from './night';
import { cloneCar, loadPBR } from './vehicleModels';

/*
 Maut ka kuan (the Well of Death): a tall round wooden drum with a railed gallery on top where the crowd leans over,
 an outside stair and ticket booth, flood lights, and motorbikes and cars that circle on the wall.
 Built as a Ride (see mela.ts): a group at the well's centre, an update(t) that moves the vehicles, collision posts.
 Local frame: the well is centred on (0, 0); the stair runs west (-x).
*/

export const WELL_R = 8.0;     // inner radius of the drum
const H = 8.2;                 // wall height (the gallery floor)
const TAU = Math.PI * 2;

type Spec = { top: string; bottom: string; skin: string; hair: string; woman: boolean; pose: 'sit' | 'stand'; wave?: boolean };
export type PersonFactory = (s: Spec) => THREE.BufferGeometry;

const wallPoint = (a: number, r: number, y: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
/** y-rotation that turns a box's x axis along the circle's tangent at angle a */
const tangentRy = (a: number) => -(a + Math.PI / 2);

// ---- vehicles (local frame: x right, y up, z forward; the origin is where the wheels touch) ----------

const TIRE = '#171717', CHROME = '#c9ccd1';

function addTorus(g: Geo, r: number, tube: number, y: number, z: number, x = 0): void {
  g.add(new THREE.TorusGeometry(r, tube, 6, 14), TIRE, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(x, y, z));
  g.add(new THREE.CylinderGeometry(r * 0.92, r * 0.92, tube * 1.2, 12), '#3b3b3f', new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(x, y, z));
  g.add(new THREE.CylinderGeometry(r * 0.2, r * 0.2, tube * 2.6, 8), CHROME, new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(x, y, z));
}

function tiltBox(g: Geo, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx: number, color: string): void {
  g.add(new THREE.BoxGeometry(sx, sy, sz), color, new THREE.Matrix4().makeRotationX(rx).setPosition(x, y, z));
}

function limb(g: Geo, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color: string): void {
  g.rod(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), r, color, 5);
}

function bikeModel(shirt: string, helmet: string, tank: string): THREE.Group {
  const g = new Geo(), lamps = new Bulbs();
  addTorus(g, 0.32, 0.065, 0.33, 0.58);
  addTorus(g, 0.32, 0.075, 0.33, -0.58);
  limb(g, 0, 0.33, 0.58, 0, 0.9, 0.36, 0.028, CHROME);
  limb(g, 0.06, 0.33, 0.58, 0.06, 0.9, 0.36, 0.02, CHROME);
  limb(g, 0, 0.33, -0.58, 0, 0.58, -0.12, 0.03, '#2a2a2a');
  limb(g, 0, 0.46, -0.12, 0, 0.7, 0.28, 0.04, '#2a2a2a');
  g.box(0, 0.42, 0.05, 0.24, 0.3, 0.34, '#4a4a50');
  g.sphere(0, 0.84, 0.12, 0.14, tank, 0.9, 0.85, 2.0);
  g.box(0, 0.75, -0.3, 0.2, 0.07, 0.46, '#161616');
  limb(g, -0.36, 0.97, 0.34, 0.36, 0.97, 0.34, 0.016, CHROME);
  limb(g, 0.15, 0.24, -0.55, 0.15, 0.27, 0.0, 0.03, CHROME);
  g.sphere(0, 0.9, 0.5, 0.08, '#fff4d6');
  g.sphere(0, 0.68, -0.6, 0.04, '#d62828');
  lamps.add(0, 0.9, 0.56, '#fff4d6', -1, 1.1);
  lamps.add(0, 0.68, -0.64, '#ff3030', -1, 0.6);
  // rider: leaning forward, arms to the bar, legs to the pegs
  tiltBox(g, 0.36, 0.52, 0.22, 0, 1.17, -0.1, -0.35, shirt);
  g.sphere(0, 1.55, 0.06, 0.115, '#a9714b');
  g.sphere(0, 1.58, 0.045, 0.14, helmet, 1, 0.95, 1.08);
  for (const s of [-1, 1]) {
    limb(g, s * 0.2, 1.33, 0.0, s * 0.35, 0.97, 0.34, 0.04, shirt);
    limb(g, s * 0.12, 0.84, -0.3, s * 0.21, 0.6, 0.12, 0.07, '#2c3a52');
    limb(g, s * 0.21, 0.6, 0.12, s * 0.2, 0.26, 0.02, 0.055, '#2c3a52');
  }
  const root = new THREE.Group();
  root.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.3, roughness: 0.55 })));
  root.add(lamps.object(0.8));
  return root;
}

function carModel(body: string, stunt: boolean): THREE.Group {
  const root = new THREE.Group();
  loadPBR('maruti').then((parts) => root.add(cloneCar(parts, body)));
  if (stunt) {   // a daredevil standing on the roof with an arm up
    const g = new Geo();
    for (const s of [-1, 1]) limb(g, s * 0.12, 1.43, -0.45, s * 0.08, 1.95, -0.45, 0.07, '#1d2a44');
    tiltBox(g, 0.38, 0.55, 0.22, 0, 2.2, -0.45, 0, '#e0a526');
    g.sphere(0, 2.62, -0.45, 0.12, '#96633f');
    g.sphere(0, 2.68, -0.45, 0.12, '#15110f', 1, 0.7, 1);
    limb(g, -0.2, 2.4, -0.45, -0.42, 2.1, -0.45, 0.04, '#e0a526');
    limb(g, 0.2, 2.4, -0.45, 0.45, 2.85, -0.45, 0.04, '#e0a526');
    root.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.2, roughness: 0.6 })));
  }
  return root;
}

// ---- the well ------------------------------------------------------------------------------------------

export function buildMautKuan(person: PersonFactory, personMat: THREE.Material) {
  const group = new THREE.Group();
  const posts: [number, number, number, number?][] = [];
  const g = new Geo(), bulbs = new Bulbs();
  const R = WELL_R;
  const STAIR_A = Math.PI;

  // the wooden drum: dark upright planks, steel hoops on the outside
  const PL = 96;
  const wood = ['#3a2c21', '#43352a', '#2c211a', '#3d2d22', '#4a1c16'];   // dark, with a few blood-stained planks
  for (let i = 0; i < PL; i++) {
    const a = ((i + 0.5) / PL) * TAU, p = wallPoint(a, R + 0.07, H / 2);
    g.box(p.x, p.y, p.z, (TAU * R) / PL + 0.02, H, 0.14, wood[rnd(i * 3.1) < 0.09 ? 4 : (i * 7 + Math.floor(rnd(i) * 3)) % 4], tangentRy(a));
  }
  for (const y of [0.7, 3.0, 5.4, 7.7]) for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * TAU, a1 = ((i + 1) / 48) * TAU;
    g.rod(wallPoint(a0, R + 0.2, y), wallPoint(a1, R + 0.2, y), 0.05, '#555a60', 4);
  }
  g.cyl(0, 0, 0, R + 0.1, 0.1, '#8d7048', 48);      // sand floor
  g.cyl(0, 0.1, 0, R * 0.56, 0.025, '#6b1414', 40);
  g.cyl(0, 0.1, 0, R * 0.5, 0.03, '#7d6240', 40);

  // gallery: a ring floor on a scaffold, a railing with X lattice, a plain outer rail the banners hang from
  const RG0 = R + 0.05, RG1 = R + 1.6, NG = 64;
  for (let i = 0; i < NG; i++) {
    const a = ((i + 0.5) / NG) * TAU, rm = (RG0 + RG1) / 2, p = wallPoint(a, rm, H - 0.06);
    g.box(p.x, p.y, p.z, (TAU * rm) / NG + 0.03, 0.1, RG1 - RG0, i % 2 ? '#7a6a55' : '#6f5f4b', tangentRy(a));
  }
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    if (Math.abs(Math.atan2(Math.sin(a - STAIR_A), Math.cos(a - STAIR_A))) < 0.1) continue;   // the stair comes down here
    g.rod(wallPoint(a, RG1 + 0.5, 0), wallPoint(a, RG1 - 0.1, H - 0.1), 0.07, '#6e747b', 5);
    const b = ((i + 1) / 20) * TAU;
    g.rod(wallPoint(a, RG1 + 0.5, 0.2), wallPoint(b, RG1 + 0.5, 4.4), 0.025, '#8d939a', 4);
    g.rod(wallPoint(a, RG1 + 0.5, 4.4), wallPoint(b, RG1 + 0.5, 0.2), 0.025, '#8d939a', 4);
  }
  for (let i = 0; i < NG; i++) {
    const a0 = (i / NG) * TAU, a1 = ((i + 1) / NG) * TAU;
    const am = (a0 + a1) / 2;
    const skip = Math.abs(Math.atan2(Math.sin(am - STAIR_A), Math.cos(am - STAIR_A))) < 0.105;   // gap in the outer rail for the stair
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
  for (let k = 0; k < 5; k++) g.cyl(0, 0.8 + k * 1.7, 0, 0.125, 0.55, '#a31515', 8);

  // stair from the gallery down to the west (-x), with rails
  const STEPS = 26, RUN = 0.58, X0 = -(RG1 + 0.0);
  for (let i = 0; i < STEPS; i++) {
    const top = H - 0.06 - i * ((H - 0.06) / STEPS), x = X0 - (i + 0.5) * RUN;
    g.box(x, top - 0.04, 0, RUN, 0.08, 2.0, '#8a7a64');
    if (i % 3 === 0) g.rod(new THREE.Vector3(x, 0, -0.97), new THREE.Vector3(x, top, -0.97), 0.04, '#6e747b', 4), g.rod(new THREE.Vector3(x, 0, 0.97), new THREE.Vector3(x, top, 0.97), 0.04, '#6e747b', 4);
  }
  for (const sz of [-1.02, 1.02]) {
    g.rod(new THREE.Vector3(X0, H + 0.95, sz), new THREE.Vector3(X0 - STEPS * RUN, 0.95, sz), 0.035, '#d9541e', 4);
    g.rod(new THREE.Vector3(X0, H - 0.06, sz), new THREE.Vector3(X0 - STEPS * RUN, 0, sz), 0.05, '#6e747b', 4);
  }
  // ticket booth at the foot of the stair
  const BX = X0 - STEPS * RUN - 2.0, BZ = -3.2;
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
  arcBand(Math.PI / 2, 1.3, R - 0.005, 4.0, 2.2, pmat);
  arcBand(-Math.PI / 2, 1.3, R - 0.005, 4.0, 2.2, pmat);
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
  arcBand(0, 0.85, R - 0.006, 2.6, 4.2, smat);
  arcBand(Math.PI, 0.85, R - 0.006, 2.6, 4.2, smat);
  // opaque cladding behind the planks, so nothing that rides the wall can show through from outside
  const skin = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.17, R + 0.17, H, 64, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 1, side: THREE.DoubleSide }));
  skin.position.y = H / 2;
  group.add(skin);
  const cap = new THREE.Mesh(new THREE.RingGeometry(R - 0.02, R + 0.25, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 1 }));
  cap.position.y = H - 0.02;
  group.add(cap);
  const outer = (a: number, tex: THREE.Texture) => arcBand(a, 1.2, RG1 - 0.02, H + 0.1, 1.0, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.55, 0.55, 0.55), roughness: 0.8 }));
  outer(0, banner(1024, 128, '#120a0a', '#a31515', [{ text: 'सिर्फ एक गलती सीधे यमराज के दर्शन', size: 70, color: '#ff4a2e', y: 66 }]));
  outer(Math.PI / 2, banner(1024, 128, '#6e0d0d', '#e0a526', [{ text: 'मौत का कुआँ', size: 96, color: '#ffe14d', y: 66 }]));
  outer(-Math.PI / 2, banner(1024, 128, '#120a0a', '#a31515', [{ text: 'WALL OF DEATH  ·  टिकट ₹30', size: 70, color: '#ff4a2e', y: 66 }]));
  const sign = banner(256, 128, '#b3261e', '#fcbf49', [{ text: 'टिकट', size: 60, color: '#ffe14d', y: 38 }, { text: '₹30', size: 60, color: '#ffffff', y: 92 }]);
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: new THREE.Color(0.6, 0.6, 0.6) }));
  sm.position.set(BX + 0.99, 2.15, BZ);
  sm.rotation.y = Math.PI / 2;
  group.add(sm);

  // the crowd leaning on the rail, and a few waiting at the booth
  const skins = ['#8a5a3c', '#a9714b', '#b98058', '#7a4e34', '#c08d66', '#96633f'];
  const hairs = ['#0d0c0f', '#15110f', '#0d0c0f', '#5c5a58', '#b9b6b0'];
  const outfits: Spec[] = [
    { top: '#f4f0e6', bottom: '#2c3646', woman: false }, { top: '#8aa4c8', bottom: '#2c3646', woman: false }, { top: '#e07b39', bottom: '#3a3a40', woman: false },
    { top: '#2a8a7a', bottom: '#2a8a7a', woman: true }, { top: '#c2185b', bottom: '#c2185b', woman: true }, { top: '#d9d4c4', bottom: '#5a4a3a', woman: false },
    { top: '#3a5a40', bottom: '#2c3646', woman: false }, { top: '#7b3fa0', bottom: '#7b3fa0', woman: true }, { top: '#c62828', bottom: '#1d1d22', woman: false, wave: true },
  ].map((o, i) => ({ ...o, skin: skins[i % 6], hair: o.woman ? '#0d0c0f' : hairs[i % 5], pose: 'stand' as const }));
  const spots: { x: number; y: number; z: number; ry: number; s: number; v: number }[] = [];
  for (let i = 0; i < 72; i++) {
    const a = ((i + 0.5) / 72) * TAU + (rnd(i) - 0.5) * 0.04;
    if (Math.abs(Math.atan2(Math.sin(a - STAIR_A), Math.cos(a - STAIR_A))) < 0.16) continue;
    if (rnd(i * 3 + 1) < 0.12) continue;
    const r = R + 0.55 + rnd(i * 5) * 0.35, p = wallPoint(a, r, H - 0.01);
    const kid = rnd(i * 9 + 2) < 0.12;
    spots.push({ x: p.x, y: H - 0.01, z: p.z, ry: Math.atan2(Math.cos(a), Math.sin(a)) + (rnd(i * 7) - 0.5) * 0.5, s: kid ? 0.68 : 0.93 + rnd(i) * 0.12, v: Math.floor(rnd(i * 13) * outfits.length) });
  }
  for (let i = 0; i < 12; i++) {
    const x = BX + 2.4 + rnd(i * 3) * 2.8, z = BZ - 1.8 + rnd(i * 5) * 3.6;
    spots.push({ x, y: 0.02, z, ry: Math.PI / 2 + (rnd(i * 7) - 0.5) * 0.9, s: 0.94 + rnd(i) * 0.1, v: Math.floor(rnd(i * 17 + 3) * outfits.length) });
  }
  outfits.forEach((o, v) => {
    const mine = spots.filter((s) => s.v === v);
    if (!mine.length) return;
    const im = new THREE.InstancedMesh(person(o), personMat, mine.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
    mine.forEach((s, i) => {
      q.setFromAxisAngle(UP, s.ry);
      im.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.s, s.s, s.s)));
      im.setColorAt(i, new THREE.Color().setScalar(0.85 + rnd(i * 11 + v) * 0.25));
    });
    im.frustumCulled = false;
    group.add(im);
  });

  // moving vehicles: bikes ride near-horizontal bands high on the wall, cars lower and tilted
  interface Veh { obj: THREE.Group; a0: number; w: number; y0: number; amp: number; sp: number; phi: number; ph: number; off: number }
  const vehicles: Veh[] = [
    { obj: bikeModel('#c62828', '#f4f0e6', '#d62828'), a0: 0.0, w: 1.55, y0: 5.6, amp: 0.9, sp: 0.5, phi: 0.1, ph: 0.0, off: 0.04 },
    { obj: bikeModel('#2b4c8c', '#1d1d22', '#1f4aa6'), a0: 2.2, w: 1.4, y0: 4.4, amp: 1.0, sp: 0.4, phi: 0.08, ph: 1.7, off: 0.04 },
    { obj: bikeModel('#e0a526', '#c62828', '#2a2a30'), a0: 4.1, w: 1.7, y0: 6.2, amp: 0.8, sp: 0.6, phi: 0.12, ph: 3.1, off: 0.04 },
    { obj: carModel('#a72a2a', false), a0: 1.0, w: 0.9, y0: 2.4, amp: 0.4, sp: 0.3, phi: 0.12, ph: 0.6, off: 0.32 },
    { obj: carModel('#e9e7e0', true), a0: 3.3, w: 0.85, y0: 2.7, amp: 0.5, sp: 0.35, phi: 0.1, ph: 2.4, off: 0.32 },
    { obj: carModel('#2b6e3a', false), a0: 5.4, w: 0.95, y0: 2.2, amp: 0.35, sp: 0.25, phi: 0.14, ph: 4.2, off: 0.32 },
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
      const a = v.a0 + v.w * t, y = v.y0 + Math.sin(t * v.sp + v.ph) * v.amp;
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
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * TAU;
    if (Math.abs(Math.atan2(Math.sin(a - STAIR_A), Math.cos(a - STAIR_A))) < 0.16) continue;
    posts.push([Math.cos(a) * (R + 0.9), Math.sin(a) * (R + 0.9), 0.9, H - 0.35]);
  }
  posts.push([BX, BZ, 1.35]);
  // railings: the inner rail all round, the outer rail with a gap at the stair, and the stair's two handrails
  const arc = (a0: number, a1: number, r: number, n: number) => Array.from({ length: n + 1 }, (_, k) => { const a = a0 + ((a1 - a0) * k) / n; return [Math.cos(a) * r, Math.sin(a) * r] as [number, number]; });
  const GAP = 0.105;
  const loop = (pts: [number, number][], back: [number, number][]) => [...pts, ...back.reverse()];
  const rails = [
    { ring: arc(0, TAU, R + 0.22, 64).slice(0, 64), h: H + 1.1 },
    { ring: loop(arc(STAIR_A + GAP, STAIR_A + TAU - GAP, RG1 - 0.05, 64), arc(STAIR_A + GAP, STAIR_A + TAU - GAP, RG1 - 0.1, 64)), h: H + 1.1 },
    ...[-1, 1].map((sz) => ({ ring: [[X0, sz * 1.02], [X0 - STEPS * RUN, sz * 1.02], [X0 - STEPS * RUN, sz * 1.08], [X0, sz * 1.08]] as [number, number][], h: H + 1.1 })),
  ];
  // walkable: the gallery ring, and the stair (a smooth ramp through the treads)
  const XE = X0 - STEPS * RUN;
  const floor = (x: number, z: number): number | null => {
    const rr = Math.hypot(x, z);
    if (rr >= RG0 + 0.1 && rr <= RG1) return H - 0.01;
    if (x <= X0 && x >= XE && Math.abs(z) <= 1.0) return Math.max(0, (H - 0.1) * ((x - XE) / (X0 - XE)));
    return null;
  };

  return {
    group,
    update: (t: number, _dt: number) => place(t),
    post: posts,
    rails,
    floor,
    light: [0, H + 2.5, 0, '#ff8a60'] as [number, number, number, string],
  };
}
