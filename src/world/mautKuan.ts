import * as THREE from 'three';
import { addFigures, figure, figurePosts, melaPeople, ONLOOKER, population, Spot } from './figures';
import { banner, Bulbs, Geo, litMat, rnd } from './geo';
import { beamMaterial, NIGHT } from './night';
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
/**
 The gallery and the round stair, for the story (the well's own frame: angle a from +x toward +z; the well is turned
 -90 degrees in the mela, so a point (a, r) is at (x - sin a r, z + cos a r) in the world). The stair rises from its foot
 at a0 as the angle falls, to the landing at a1 (a0 - span); the last `land` of it is the landing, level with the gallery.
*/
export const GALLERY = { y: H, r0: WELL_R + 0.05, r1: WELL_R + 1.8, stairR0: WELL_R + 1.9, stairR1: WELL_R + 3.9, a0: 2.356, span: 3.5, land: 0.17, a1: 2.356 - 3.5, girl: 2.356 - 3.5 + Math.PI };   // girl: right across the well from the stair's top
const YK = H / 8.2;
/**
 The story's hold on the show (stage 1, part 3: the bikes and cars come past Ramu as he falls): a turn added to each
 vehicle round the wall, the show's clock as last seen, and the vehicles' rounds (angle a0 + w t, height (y0 + ...) yk).
*/
export const WELL_SHOW = { t: 0, shift: [0, 0, 0, 0, 0, 0], ride: [] as { a0: number; w: number; y0: number }[], yk: H / 8.2 };            // the vehicles' heights on the wall were set for a wall 8.2 m high
const TAU = Math.PI * 2;
const STEEL = '#e4e7ea', STEEL_D = '#a3a9af';       // white-painted steel, as the fair's wells are now: the rails, posts and the upper deck
/** the LED tubes' white: past 1, so the bloom catches it at night */
const LED = NIGHT ? new THREE.Color(2.6, 2.6, 2.8) : new THREE.Color(1.1, 1.1, 1.15);

/**
 The drum's inside: weathered grey upright planks in lengths with butt joints, the grain, nail rows over the battens behind,
 and the tyres' rubber, streaked round in the bands the bikes and cars run in, soot along the bottom. One tile is 40 planks
 (a sixth of the way round) by the wall's height.
*/
function plankTexture(): THREE.CanvasTexture {
  const W = 2048, HP = 1024, N = 40, pw = W / N, m = HP / H;
  const c = document.createElement('canvas');
  c.width = W; c.height = HP;
  const g = c.getContext('2d')!;
  const yp = (y: number) => HP - y * m;
  for (let i = 0; i < N; i++) {
    const x0 = i * pw, l = 42 + rnd(i * 1.7) * 16, hue = 26 + rnd(i * 2.3) * 16, sat = 5 + rnd(i * 3.9) * 11;
    let y = 0, k = 0;
    while (y < H) {
      const y1 = Math.min(H, y + 2.2 + rnd(i * 5.1 + k * 7.3) * 3.6);
      g.fillStyle = `hsl(${hue},${sat}%,${l + (rnd(i * 9.7 + k * 3.1) - 0.5) * 9}%)`;
      g.fillRect(x0, yp(y1), pw, (y1 - y) * m);
      for (let s = 0; s < 8; s++) {          // grain
        const gx = x0 + 3 + rnd(i * 13 + k * 5 + s * 1.3) * (pw - 6);
        g.strokeStyle = `rgba(32,24,18,${0.07 + rnd(i + s * 2.7 + k) * 0.13})`;
        g.lineWidth = 0.6 + rnd(s * 4.1 + i) * 1.3;
        g.beginPath();
        g.moveTo(gx, yp(y));
        for (let yy = y; yy <= y1; yy += 0.35) g.lineTo(gx + Math.sin(yy * 1.9 + s + i * 0.7) * 1.5, yp(yy));
        g.stroke();
      }
      if (rnd(i * 4.3 + k * 1.9) < 0.25) {     // a knot
        const kx = x0 + pw * (0.3 + rnd(i + k * 2.2) * 0.4), ky = yp(y + (y1 - y) * rnd(i * 2 + k));
        g.fillStyle = 'rgba(40,28,20,.45)';
        g.beginPath(); g.ellipse(kx, ky, 3.5, 6, 0, 0, TAU); g.fill();
      }
      if (y > 0) { g.fillStyle = 'rgba(22,16,12,.75)'; g.fillRect(x0, yp(y) - 1, pw, 2.5); }
      y = y1; k++;
    }
    g.fillStyle = 'rgba(14,10,8,.9)'; g.fillRect(x0, 0, 2.5, HP);              // the gap between planks
    g.fillStyle = 'rgba(255,250,240,.07)'; g.fillRect(x0 + 2.5, 0, 2, HP);      // and the plank's worn edge
  }
  g.fillStyle = 'rgba(26,20,18,.8)';
  for (const yb of [0.45, 2.6, 4.9, 7.2, 9.5, 11.8]) for (let i = 0; i < N; i++) for (const d of [0.28, 0.72]) {
    g.beginPath(); g.arc(i * pw + d * pw, yp(yb), 1.7, 0, TAU); g.fill();
  }
  for (let s = 0; s < 1100; s++) {             // rubber: the cars' band low down, the bikes' wider above it
    const band = rnd(s * 1.3) < 0.3 ? 3.0 + rnd(s * 2.1) * 1.8 : 5.2 + rnd(s * 2.9) * 6.6;
    const y0 = yp(band), x = rnd(s * 3.7) * W, len = 150 + rnd(s * 5.3) * 800, dy = (rnd(s * 4.4) - 0.5) * 50;
    g.strokeStyle = `rgba(16,12,10,${0.03 + rnd(s * 7.1) * 0.09})`;
    g.lineWidth = 1 + rnd(s * 9.3) * 5;
    for (const o of [0, -W]) {                 // drawn twice so a streak running off the right edge comes back in at the left
      g.beginPath();
      g.moveTo(x + o, y0);
      g.bezierCurveTo(x + o + len * 0.33, y0 + dy * 0.2 + (rnd(s) - 0.5) * 20, x + o + len * 0.66, y0 + dy * 0.6, x + o + len, y0 + dy);
      g.stroke();
    }
  }
  const soot = g.createLinearGradient(0, yp(2.2), 0, HP);
  soot.addColorStop(0, 'rgba(28,22,18,0)');
  soot.addColorStop(1, 'rgba(28,22,18,.65)');
  g.fillStyle = soot;
  g.fillRect(0, yp(2.2), W, 2.2 * m);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 The well's bottom: trodden sand, darker and packed in a ring by the wall where the bikes and cars roll on and off it, tyre
 arcs, and patches of grass come up where nothing runs (round the pole, and in clumps between). One texture over the whole
 floor (the disc's uv spans its width).
*/
function sandTexture(): THREE.CanvasTexture {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!, mid = S / 2, px = S / (2 * WELL_R);
  g.fillStyle = '#b39668';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {            // grains and pebbles
    const l = 38 + rnd(i * 1.3) * 30;
    g.fillStyle = `hsla(${32 + rnd(i * 2.1) * 10},${22 + rnd(i * 3.3) * 18}%,${l}%,${0.25 + rnd(i * 4.7) * 0.4})`;
    const r = 0.6 + rnd(i * 5.9) ** 3 * 3.5;
    g.beginPath(); g.arc(rnd(i * 6.1) * S, rnd(i * 7.3) * S, r, 0, TAU); g.fill();
  }
  for (let i = 0; i < 60; i++) {               // soft blotches: damp and dry
    const x = rnd(i * 8.7) * S, y = rnd(i * 9.1) * S, r = 30 + rnd(i * 3.7) * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rnd(i) < 0.5 ? 'rgba(90,70,45,.18)' : 'rgba(225,205,160,.16)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const ring = g.createRadialGradient(mid, mid, (WELL_R - 3.2) * px, mid, mid, WELL_R * px);   // packed by the wall
  ring.addColorStop(0, 'rgba(70,55,40,0)');
  ring.addColorStop(1, 'rgba(70,55,40,.6)');
  g.fillStyle = ring;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {               // tyre arcs round the outer ring
    const r = (WELL_R - 0.4 - rnd(i * 2.9) * 3) * px, a = rnd(i * 4.1) * TAU;
    g.strokeStyle = `rgba(45,34,24,${0.12 + rnd(i * 5.5) * 0.2})`;
    g.lineWidth = 2 + rnd(i * 6.6) * 4;
    g.beginPath(); g.arc(mid, mid, r, a, a + 0.4 + rnd(i * 7.7) * 1.6); g.stroke();
  }
  const patch = (x: number, y: number, r: number, seed: number) => {
    for (let k = 0; k < 7; k++) {              // a clump: overlapping soft greens
      const cx = x + (rnd(seed + k * 1.1) - 0.5) * r, cy = y + (rnd(seed + k * 2.3) - 0.5) * r, rr = r * (0.35 + rnd(seed + k * 3.7) * 0.4);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, 'rgba(78,104,44,.85)');
      gr.addColorStop(0.7, 'rgba(96,112,52,.5)');
      gr.addColorStop(1, 'rgba(110,110,60,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.fill();
    }
    for (let k = 0; k < r * 3; k++) {          // blades
      const a = rnd(seed * 3 + k) * TAU, d = rnd(seed * 5 + k * 1.7) ** 0.7 * r * 0.75, bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
      g.strokeStyle = `hsla(${80 + rnd(k + seed) * 30},${35 + rnd(k * 2 + seed) * 25}%,${20 + rnd(k * 3 + seed) * 22}%,.8)`;
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + (rnd(k * 4 + seed) - 0.5) * 6, by - 4 - rnd(k * 5 + seed) * 7); g.stroke();
    }
  };
  patch(mid, mid, 2.2 * px, 1);                  // round the pole
  for (let i = 0; i < 16; i++) {
    const a = rnd(i * 3.3 + 7) * TAU, d = (1.5 + rnd(i * 4.9 + 2) * (WELL_R - 5)) * px;
    patch(mid + Math.cos(a) * d, mid + Math.sin(a) * d, (0.5 + rnd(i * 2.2) * 1.3) * px, 10 + i * 7);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** a railing panel's steel mesh: upright bars and an X across, white on clear (one panel to a texture repeat) */
let meshCanvas: HTMLCanvasElement | null = null;
function meshTexture(panels: number): THREE.CanvasTexture {
  if (!meshCanvas) {
    const c = (meshCanvas = document.createElement('canvas'));
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    for (let x = 8; x < 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 128); g.moveTo(0, 128); g.lineTo(256, 0); g.stroke();
    g.lineWidth = 8;
    g.beginPath(); g.moveTo(0, 2); g.lineTo(256, 2); g.moveTo(0, 126); g.lineTo(256, 126); g.moveTo(2, 0); g.lineTo(2, 128); g.stroke();
  }
  const t = new THREE.CanvasTexture(meshCanvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = panels;
  t.anisotropy = 4;
  return t;
}

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
  // somebody standing up on the roof and dancing as the car goes round the wall (the Hip Hop and Silly Dancing clips, one
  // each way)
  melaPeople.ready.then(() => makeActors(dancer, 1, true)).then(([a]) => {   // (once Ramu is near the mela)
    a.root.position.set(0, 1.43, -0.4);
    a.root.rotation.y = n % 2 ? Math.PI : Math.PI * 0.8;
    a.play(n % 2 ? 'dance_silly' : 'dance_hiphop', 0.95 + n * 0.08, 0);
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
  const g = new Geo(), bulbs = new Bulbs(), leds = new Geo();
  const R = WELL_R;
  const PH = 4.7;          // the tall posts on the inner rail, over the upper deck's crowd
  /** an arm out from a tall post's top over the well, an LED flood at its end tilted down into the drum */
  const ledFlood = (a: number) => {
    const foot = wallPoint(a, R + 0.2, H + PH - 0.3), end = wallPoint(a, R - 0.7, H + PH + 0.15);
    g.rod(foot, end, 0.035, STEEL, 4);
    const t = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), n = new THREE.Vector3(-Math.cos(a), -1.1, -Math.sin(a)).normalize();
    const b = new THREE.Vector3().crossVectors(t, n), mm = new THREE.Matrix4().makeBasis(t, n, b);
    g.add(new THREE.BoxGeometry(0.75, 0.1, 0.34), STEEL_D, mm.clone().setPosition(end));
    const face = end.clone().addScaledVector(n, 0.055);
    leds.add(new THREE.BoxGeometry(0.66, 0.01, 0.26), LED, mm.clone().setPosition(face));
    const h = face.clone().addScaledVector(n, 0.12);
    bulbs.add(h.x, h.y, h.z, '#f2f5ff', -1, NIGHT ? 2.0 : 1.2);
  };

  // the wooden drum: weathered grey upright planks inside (one textured cylinder), steel hoops on the outside
  for (const y of [0.7, H * 0.36, H * 0.66, H - 0.5]) for (let i = 0; i < 72; i++) {
    const a0 = (i / 72) * TAU, a1 = ((i + 1) / 72) * TAU;
    g.rod(wallPoint(a0, R + 0.2, y), wallPoint(a1, R + 0.2, y), 0.05, '#555a60', 4);
  }
  g.cyl(0, 0, 0, R + 0.1, 0.1, '#5a4a3a', 48);      // under the plank floor
  const planks = plankTexture();
  planks.repeat.x = 6;
  const wallMat = new THREE.MeshStandardMaterial({ map: planks, roughness: 0.92, side: THREE.BackSide,
    emissiveMap: planks, emissive: new THREE.Color(NIGHT ? 0.2 : 0.03, NIGHT ? 0.2 : 0.03, NIGHT ? 0.22 : 0.03) });   // (at night as if the LED floods lit it all round)
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 128, 1, true), wallMat);
  wall.position.y = H / 2;
  group.add(wall);
  const floorTex = sandTexture();
  const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(R + 0.02, 72).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1, emissiveMap: floorTex, emissive: wallMat.emissive }));
  floorMesh.position.y = 0.105;
  group.add(floorMesh);

  // gallery: a ring floor on a scaffold, white steel railings with mesh panels, the outer one the banners hang from
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
      for (const [y, rr] of [[1.12, 0.04], [0.62, 0.028], [0.14, 0.028]] as const) g.rod(wallPoint(a0, ri, H + y), wallPoint(a1, ri, H + y), rr, STEEL, 4);
      g.rod(wallPoint(a0, ri, H), wallPoint(a0, ri, H + (tall ? PH : 1.12)), tall ? 0.06 : 0.03, STEEL, 5);
    }
    if (!skip) {
      const ro = RG1 - 0.05;
      g.rod(wallPoint(a0, ro, H + 1.12), wallPoint(a1, ro, H + 1.12), 0.035, STEEL, 4);
      g.rod(wallPoint(a0, ro, H + 0.5), wallPoint(a1, ro, H + 0.5), 0.025, STEEL, 4);
      g.rod(wallPoint(a0, ro, H), wallPoint(a0, ro, H + 1.12), 0.03, STEEL, 4);
    }
    // on each tall post an arm out over the well with an LED flood at its end, tilted down into the drum
    if (i % 4 === 0) ledFlood(a0);
  }
  for (let i = 0; i < NG; i += 4) {   // an LED strip from post top to post top all round
    const a0 = (i / NG) * TAU, a1 = ((i + 4) / NG) * TAU;
    leds.rod(wallPoint(a0, R + 0.2, H + PH - 0.05), wallPoint(a1, R + 0.2, H + PH - 0.05), 0.025, LED, 4);
    g.rod(wallPoint(a0, R + 0.2, H + PH), wallPoint(a1, R + 0.2, H + PH), 0.04, STEEL, 4);
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
      g.rod(wallPoint(a, r, y + 1.0), wallPoint(an, r, yn + 1.0), rail, STEEL, 4);                 // handrail
      if (i % 3 === 0) g.rod(wallPoint(a, r, y), wallPoint(a, r, y + 1.0), 0.022, STEEL, 4);
      if (i % 6 === 3 && y > 0.6) g.rod(wallPoint(a, r, 0), wallPoint(a, r, y - 0.1), 0.05, '#6e747b', 5);
    }
    if (i % 4 === 0) { const q = wallPoint(a, RS1, y + 1.12); bulbs.add(q.x, q.y, q.z, (i / 4) % 2 ? '#ff3a22' : '#fff2d8', (i % 16) / 16, 1.0); }
  }
  for (let k = 0; k < 4; k++) {            // the landing, level with the gallery
    const a = A1 + LAND * (1 - (k + 0.5) / 4), p = wallPoint(a, (RG1 + RS1) / 2, H - 0.06);
    g.box(p.x, p.y, p.z, ((RG1 + RS1) / 2) * (LAND / 4) + 0.06, 0.1, RS1 - RG1 + 0.1, '#7a6a55', tangentRy(a));
  }
  for (const y of [1.0, 0.5]) {
    g.rod(wallPoint(A1 + LAND, RS1 - 0.04, H + y), wallPoint(A1, RS1 - 0.04, H + y), 0.03, STEEL, 4);
    g.rod(wallPoint(A1, RS1 - 0.04, H + y), wallPoint(A1, RG1, H + y), 0.03, STEEL, 4);              // closed at the far end
  }
  for (const r of [RS1 - 0.04, RG1 + 0.3]) g.rod(wallPoint(A1, r, 0), wallPoint(A1, r, H + 1.0), 0.06, '#6e747b', 5);
  // the upper deck: a second ring of standing room above and behind the gallery, out over the stair, with its own rail at
  // the front and the back, on steel columns (from the gallery's outer rail in front, from the ground outside the stair
  // behind). It is open over the stair's last stretch and the landing (DG1 round to DG0), so a climber there, and the camera
  // behind him, are never under it.
  const DY = H + 2.4, DK0 = RG1 + 0.05, DK1 = RS1 + 0.3, DG0 = A1 + LAND + 0.95, DG1 = A1 + TAU - 0.06, ND = 66, dda = (DG1 - DG0) / ND;
  for (let i = 0; i < ND; i++) {
    const a = DG0 + (i + 0.5) * dda, rm = (DK0 + DK1) / 2, p = wallPoint(a, rm, DY - 0.06);
    g.box(p.x, p.y, p.z, rm * dda + 0.03, 0.1, DK1 - DK0, i % 2 ? '#86898c' : '#7d8083', tangentRy(a));
    const a0 = DG0 + i * dda, a1 = a0 + dda;
    for (const [r, front] of [[DK0 + 0.05, true], [DK1 - 0.05, false]] as const) {
      g.rod(wallPoint(a0, r, DY + 1.1), wallPoint(a1, r, DY + 1.1), 0.04, STEEL, 4);
      g.rod(wallPoint(a0, r, DY + 0.1), wallPoint(a1, r, DY + 0.1), 0.03, STEEL, 4);
      g.rod(wallPoint(a0, r, DY), wallPoint(a0, r, DY + 1.1), 0.03, STEEL, 4);
      if (front) leds.rod(wallPoint(a0, r, DY + 1.17), wallPoint(a1, r, DY + 1.17), 0.02, LED, 3);
    }
    for (const r of [DK0, DK1]) g.rod(wallPoint(a0, r, DY - 0.14), wallPoint(a1, r, DY - 0.14), 0.06, STEEL_D, 4);
    if (i % 3 === 0) {
      const b = DG0 + Math.min(ND, i + 3) * dda;
      g.rod(wallPoint(a0, DK0, H + 1.12), wallPoint(a0, DK0, DY), 0.06, STEEL, 5);
      g.rod(wallPoint(a0, DK1, 0), wallPoint(a0, DK1, DY), 0.08, STEEL, 5);
      g.rod(wallPoint(a0, DK0, DY - 0.12), wallPoint(a0, DK1, DY - 0.9), 0.04, STEEL_D, 4);
      for (const [y0, y1] of [[0.3, DY * 0.5], [DY * 0.5, DY - 0.2]]) {
        g.rod(wallPoint(a0, DK1, y0), wallPoint(b, DK1, y1), 0.025, STEEL_D, 4);
        g.rod(wallPoint(a0, DK1, y1), wallPoint(b, DK1, y0), 0.025, STEEL_D, 4);
      }
      const c = wallPoint(a0, DK1, 0);
      posts.push([c.x, c.z, 0.12, DY]);
    }
  }
  for (const a of [DG0, DG1]) {     // the deck's two ends closed
    const c = wallPoint(a, DK1, 0);
    g.rod(wallPoint(a, DK1, 0), wallPoint(a, DK1, DY + 1.1), 0.08, STEEL, 5);
    posts.push([c.x, c.z, 0.12, DY]);
    for (const y of [0.1, 0.6, 1.1]) g.rod(wallPoint(a, DK0 + 0.05, DY + y), wallPoint(a, DK1 - 0.05, DY + y), 0.035, STEEL, 4);
  }

  // ticket booth by the foot of the stair
  const BA = A0 + 0.5, BX = Math.cos(BA) * (RS1 + 1.8), BZ = Math.sin(BA) * (RS1 + 1.8);
  g.box(BX, 1.3, BZ, 1.8, 2.6, 1.6, '#c9a34a');
  g.box(BX, 2.65, BZ, 2.2, 0.12, 2.0, '#b3261e');
  g.box(BX + 0.92, 1.1, BZ, 0.1, 0.9, 1.0, '#26323d');
  group.add(new THREE.Mesh(g.build(), litMat({ metalness: 0.15, roughness: 0.8 })));
  group.add(new THREE.Mesh(leds.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
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
  // the steel mesh in the railings' panels (one panel between each two uprights)
  const meshBand = (a0: number, a1: number, r: number, y0: number, h: number, panels: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, Math.ceil(((a1 - a0) / TAU) * 192), 1, true, Math.PI / 2 - a1, a1 - a0),
      new THREE.MeshStandardMaterial({ map: meshTexture(panels), color: STEEL, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.3 }));
    m.position.y = y0 + h / 2;
    group.add(m);
  };
  meshBand(0, TAU, R + 0.2, H + 0.14, 0.98, NG);
  meshBand(A1 + LAND, A1 + TAU, RG1 - 0.05, H + 0.02, 1.1, Math.round(((TAU - LAND) / TAU) * NG));
  meshBand(DG0, DG1, DK0 + 0.05, DY + 0.1, 1.0, ND);
  meshBand(DG0, DG1, DK1 - 0.05, DY + 0.1, 1.0, ND);
  arcBand(Math.PI / 2, 1.3, R - 0.005, H * 0.5, 3.4, pmat);
  arcBand(-Math.PI / 2, 1.3, R - 0.005, H * 0.5, 3.4, pmat);
  // opaque cladding behind the planks, so nothing that rides the wall can show through from outside
  const skin = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.17, R + 0.17, H, 64, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 1, side: THREE.DoubleSide }));
  skin.position.y = H / 2;
  group.add(skin);
  const cap = new THREE.Mesh(new THREE.RingGeometry(R - 0.02, R + 0.25, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: STEEL_D, roughness: 0.7 }));
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
    if (wrap(a - GALLERY.girl + 0.45) < 0.9) continue;  // and the rail either side of the girl's spot (stage 1's end)
    if (rnd(i * 3 + 1) < 0.45) continue;              // gaps (and fewer bodies to draw): Ramu runs round the gallery behind them
    const r = R + 0.4 + rnd(i * 5) * 0.12, p = wallPoint(a, r, H - 0.01);   // leaning on the rail: the outer half is free
    const kid = rnd(i * 9 + 2) < 0.12;
    spots.push({
      x: p.x, y: H - 0.01, z: p.z, ry: Math.atan2(Math.cos(a), Math.sin(a)) + (rnd(i * 7) - 0.5) * 0.5, n: i,
      pose: ONLOOKER[Math.floor(rnd(i * 13) * ONLOOKER.length)], ...(kid ? { s: 0.66, kind: i % 2 ? 'boy' : 'girl' } as const : {}),
    });
  }
  for (let i = 0; i < 8; i++) {        // waiting at the foot of the stair, by the booth
    const a = A0 + 0.06 + rnd(i * 3) * 0.34, rr = RS1 + 0.9 + rnd(i * 5) * 2.6;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    spots.push({ x, y: 0.02, z, ry: Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2 + (rnd(i * 7) - 0.5) * 1.2, n: 100 + i, pose: ONLOOKER[Math.floor(rnd(i * 17 + 3) * ONLOOKER.length)] });
  }
  posts.push(...figurePosts(spots));      // the onlookers on the gallery and at the booth stand in the way
  // a few along the upper deck's rail (out of Ramu's way: nothing stands in for them; kept few for the frame rate). They
  // borrow the looks of the people on the gallery, so they are drawn in the same batches (no more draw calls).
  const rail = spots.filter((s) => s.y > 1), deck: Spot[] = [];
  for (let i = 0; i < 26; i++) {
    const a = DG0 + 0.06 + ((i + rnd(i * 1.9) * 0.6) / 26) * (DG1 - DG0 - 0.12);
    const r = DK0 + 0.38 + rnd(i * 5.3) * 0.12, p = wallPoint(a, r, DY), like = rail[(i * 7) % rail.length];
    deck.push({ ...like, x: p.x, y: DY, z: p.z, ry: Math.atan2(Math.cos(a), Math.sin(a)) + (rnd(i * 6.3) - 0.5) * 0.6 });
  }
  addFigures(group, [...spots, ...deck]);

  // moving vehicles: bikes ride near-horizontal bands high on the wall, cars lower and tilted
  interface Veh { obj: THREE.Group; a0: number; w: number; y0: number; amp: number; sp: number; phi: number; ph: number; off: number }
  const vehicles: Veh[] = !population.on ? [] : [      // (nobody about, Explore world: no show)
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
    group.add(m);
    return m;
  });
  const f = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3(), r = new THREE.Vector3(), mm = new THREE.Matrix4();
  WELL_SHOW.ride = vehicles;
  const place = (t: number) => {
    WELL_SHOW.t = t;
    for (const v of vehicles) {
      const a = v.a0 + v.w * t + WELL_SHOW.shift[vehicles.indexOf(v)], y = (v.y0 + Math.sin(t * v.sp + v.ph) * v.amp) * YK;
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
    // (railings: bullets and looks go through them, thin)
    { ring: arc(0, TAU, R + 0.22, 96).slice(0, 96), h: H + 1.1, camH: H + 6, thin: true },
    { ring: loop(arc(A1 + LAND, A1 + TAU, RG1 - 0.05, 96), arc(A1 + LAND, A1 + TAU, RG1 - 0.1, 96)), h: H + 1.1, camH: H + 6, thin: true },
    // the stair's outer handrail, in lengths that rise with it, and the closed end of the landing
    ...Array.from({ length: 14 }, (_, k) => {
      const a0 = A0 - (SPAN * k) / 14, a1 = A0 - (SPAN * (k + 1)) / 14;
      return { ring: loop(arc(a0, a1, RS1, 4), arc(a0, a1, RS1 + 0.06, 4)), h: Math.min(H, (H * (A0 - a1)) / (SPAN - LAND)) + 1.1, camH: 0, thin: true };
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
    light: [0, H + 3.5, 0, '#eef1ff'] as [number, number, number, string],
  };
}
