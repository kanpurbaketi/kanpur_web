import * as THREE from 'three';
import { Bulbs, Geo, banner, bannerMat, litMat, rnd } from './geo';
import { LightPool, NIGHT } from './night';
import { Building, P2, pointInPoly } from './types';

/*
 Kanpur Nagar Nigam (stage 1: straight ahead at the bend, behind its compound wall), from a photo of it:
   main block    four floors of red brick; grey-framed bands of windows, tall white textured panels between them, a grey
                 band over the ground floor, a deep grey parapet carrying "NAGAR NIGAM KANPUR · logo · नगर निगम कानपुर",
                 solar panels on the roof
   wing          the Administrative Block in front of it, to the west: brick and dark grey, a heavy grey roof slab, a
                 canopy over the ground-floor portico on grey columns, yellow pots of plants, "ADMINISTRATIVE BLOCK"
   island        a round of clipped hedge with a cycad in it, its kerb painted yellow and green, before the entrance
 The two map buildings are taken out of the city's build (prepareRoute) and drawn here instead.
*/

const FLOOR = 3.6;

/** the two blocks in the map: the long main block (16 m), and the wing in front of it (12.8 m) */
export function isNagarNigam(b: Building): boolean {
  return pointInPoly(-70, 415, b.pts) || pointInPoly(-60, 400, b.pts);
}

export class NagarNigam {
  readonly group = new THREE.Group();
  private solid = new Geo();
  private bulbs = new Bulbs();

  constructor(blocks: Building[], private lights: LightPool | null) {
    const main = blocks.find((b) => pointInPoly(-70, 415, b.pts));
    const wing = blocks.find((b) => pointInPoly(-60, 400, b.pts));
    if (main) this.block(main.pts, 16, mainFacade());
    if (wing) {
      this.block(wing.pts, 12.8, wingFacade());
      this.wingFront(wing.pts);
    }
    if (main) this.sign(main.pts, 16);
    if (main) this.solar(main.pts, 16);
    this.island(-41.5, 388.5);
    const m = new THREE.Mesh(this.solid.build(), litMat({ roughness: 0.8, metalness: 0.05 }));
    m.castShadow = m.receiveShadow = true;
    this.group.add(m, this.bulbs.object(0.8));
  }

  /** walls round the footprint with the facade laid on at its true size (a tile is 16 m wide, the full height), a flat grey roof */
  private block(pts: P2[], H: number, tex: { map: THREE.Texture; glow: THREE.Texture }): void {
    const ring = ccw(pts);
    const pos: number[] = [], uv: number[] = [], nor: number[] = [];
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;      // outward, for a ring counter-clockwise on a north-up map
      const u0 = u / 16, u1 = (u + L) / 16;
      const quad: [number, number, number, number, number][] = [[ax, 0, az, u0, 0], [bx, 0, bz, u1, 0], [bx, H, bz, u1, 1], [ax, H, az, u0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const q = quad[k];
        pos.push(q[0], q[1], q[2]); uv.push(q[3], q[4]); nor.push(nx, 0, nz);
      }
      u += L;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const walls = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: tex.map, emissiveMap: tex.glow, emissive: new THREE.Color(NIGHT ? '#ffe2b0' : '#000000'), emissiveIntensity: NIGHT ? 1.2 : 0, roughness: 0.85,
    }));
    walls.castShadow = walls.receiveShadow = true;
    this.group.add(walls);
    // the roof: flat, grey, a little inside the parapet's top
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const roof = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, H - 0.6, 0);
    this.solid.add(roof, '#7c7e80');
  }

  /** "NAGAR NIGAM KANPUR · logo · नगर निगम कानपुर" on the parapet of the main block's front (the stretch facing the lane), lit */
  private sign(pts: P2[], H: number): void {
    // along the front east of the wing, (-38.3, 407.6) to (-12.7, 408.8) in the map: three nearly straight edges, one sign
    void pts;
    const a: P2 = [-38.3, 407.6], b: P2 = [-12.7, 408.8], bl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const L = bl - 1.5, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const tex = banner(2048, 128, '#55595e', '#55595e', [
      { text: 'NAGAR NIGAM KANPUR', size: 70, color: '#f4f4f2', y: 70, x: 470 },
      { text: 'नगर निगम कानपुर', size: 74, color: '#f4f4f2', y: 72, x: 1560 },
    ]);
    // the corporation's round seal between the two names
    const c = (tex.image as HTMLCanvasElement).getContext('2d')!;
    c.fillStyle = '#e9e4d8'; c.beginPath(); c.arc(1024, 64, 46, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#b3261e'; c.lineWidth = 7; c.beginPath(); c.arc(1024, 64, 36, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#d9822b'; c.beginPath(); c.arc(1024, 64, 18, 0, Math.PI * 2); c.fill();
    tex.needsUpdate = true;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(L, L / 16), bannerMat(tex, NIGHT ? 0.7 : 0));
    const ry = Math.atan2(b[1] - a[1], -(b[0] - a[0]));     // the plane faces out (north): its normal (sin ry, cos ry) = (dz, -dx)
    p.position.set(mx + Math.sin(ry) * 0.25, H - 0.85, mz + Math.cos(ry) * 0.25);
    p.rotation.y = ry;
    this.group.add(p);
    // floodlit from below at night
    this.lights?.add(mx + Math.sin(ry) * 10, 2, mz + Math.cos(ry) * 10, '#fff1d6', 160, 30);
  }

  /** frames of solar panels on the roof, tilted to the south */
  private solar(pts: P2[], H: number): void {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const x0 = Math.min(...xs) + 6, x1 = Math.max(...xs) - 6, z0 = Math.min(...zs) + 6, z1 = Math.max(...zs) - 6;
    for (let x = x0; x < x1; x += 6) for (let z = z0; z < z1; z += 5) {
      if (!pointInPoly(x, z, pts) || rnd(x * 0.31 + z) < 0.35) continue;
      this.solid.add(new THREE.BoxGeometry(4.6, 0.06, 2.2).rotateX(-0.3), '#1d2a44', new THREE.Matrix4().makeTranslation(x, H + 0.4, z));
      for (const dx of [-2, 2]) this.solid.box(x + dx, H - 0.1, z + 0.8, 0.08, 0.9, 0.08, '#8a8d90').box(x + dx, H - 0.25, z - 0.8, 0.08, 0.5, 0.08, '#8a8d90');
    }
  }

  /** the wing's front: the canopy over the portico on grey columns, the heavy roof slab, the name on the canopy, pots of plants */
  private wingFront(pts: P2[]): void {
    const ring = ccw(pts);
    // its north face
    let a: P2 = ring[0], b: P2 = ring[1];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if ((q[0] - p[0]) / L < -0.9) { a = p; b = q; }
    }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, nx = -dz, nz = dx;   // (nx, nz): outward
    const ry = Math.atan2(-dz, dx);
    const at = (s: number, out: number): P2 => [a[0] + dx * s + nx * out, a[1] + dz * s + nz * out];
    const G = '#55595e', DG = '#3e4246';
    // canopy slab over the portico, 3.2 m out, at the first floor; a band of the same along the face
    const [cx, cz] = at(L / 2, 1.6);
    this.solid.box(cx, 4.2, cz, L + 0.6, 0.7, 3.4, DG, ry);
    // the roof slab: overhanging all round the front
    const [rx, rz] = at(L / 2, 0.6);
    this.solid.box(rx, 12.8 + 0.35, rz, L + 1.6, 0.9, 1.6, DG, ry);
    // columns under the canopy, pots between them
    for (let s = 1.2; s < L - 0.5; s += (L - 2.4) / 4) {
      const [px, pz] = at(s, 2.9);
      this.solid.box(px, 1.95, pz, 0.55, 3.9, 0.55, G, ry);
      const [ox, oz] = at(s + 1.1, 3.2);
      this.solid.cyl(ox, 0, oz, 0.28, 0.7, '#e2b52c', 10, 0.22);
      for (let k = 0; k < 7; k++) this.solid.sphere(ox + (rnd(s * 3 + k) - 0.5) * 0.5, 0.9 + rnd(k + s) * 0.35, oz + (rnd(s + k * 7) - 0.5) * 0.5, 0.2, '#2f6b2a');
    }
    // "ADMINISTRATIVE BLOCK" on the canopy's front edge
    const tex = banner(1024, 96, DG, DG, [{ text: 'ADMINISTRATIVE BLOCK', size: 64, color: '#f4f4f2', y: 52 }]);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(L - 1, 14), Math.min(L - 1, 14) / 10.7), bannerMat(tex, NIGHT ? 0.6 : 0));
    const [sx, sz] = at(L / 2, 3.32);
    p.position.set(sx, 4.2, sz);
    p.rotation.y = Math.atan2(nx, nz);     // facing out (north)
    this.group.add(p);
    // the portico's lights
    for (let s = 2; s < L - 1; s += 3) { const [bx, bz] = at(s, 2.2); this.bulbs.add(bx, 3.8, bz, '#fff3d0', -1, 1.6); }
    this.lights?.add(cx + nx * 4, 3, cz + nz * 4, '#fff1d6', 110, 18);
  }

  /** the round before the entrance: kerb in yellow and green, clipped hedge, a cycad in the middle */
  private island(x: number, z: number): void {
    const R = 3.4, n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2, m = (a + b) / 2;
      this.solid.box(x + Math.cos(m) * R, 0.17, z + Math.sin(m) * R, 2 * R * Math.sin(Math.PI / n) + 0.02, 0.34, 0.3, i % 2 ? '#2f7a4a' : '#e9b92e', -m + Math.PI / 2);
    }
    this.solid.cyl(x, 0, z, R - 0.15, 0.32, '#5a4632', 28);
    // the hedge: a ring of clipped box, lumpy
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      this.solid.sphere(x + Math.cos(a) * (R - 0.75), 0.75, z + Math.sin(a) * (R - 0.75), 0.62, i % 3 ? '#3d6e2c' : '#467a33', 1, 0.8, 1);
    }
    this.solid.sphere(x, 0.8, z, 1.6, '#3a6a2a', 1, 0.45, 1);
    // the cycad: a short rough trunk, a crown of long stiff fronds
    this.solid.cyl(x, 0.6, z, 0.28, 1.5, '#5b4a36', 10, 0.24);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd(i) * 0.2, up = 0.25 + 0.5 * rnd(i * 3.1), len = 1.6 + rnd(i * 1.7) * 0.6;
      const frond = new THREE.BoxGeometry(0.42, 0.03, len).translate(0, 0, len / 2).rotateX(-up).rotateY(a);
      this.solid.add(frond, i % 2 ? '#2f6b2a' : '#3b7d30', new THREE.Matrix4().makeTranslation(x, 2.1, z));
    }
  }
}

/** a ring turned counter-clockwise on a north-up map (x east, z south): the outward normal of a→b is (-dz, dx) */
function ccw(pts: P2[]): P2[] {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    s += ax * bz - bx * az;
  }
  // in x-east / z-south, a positive shoelace sum runs clockwise on the screen of a map (north up): flip it then
  return s > 0 ? [...pts].reverse() : pts;
}

// ---- facades --------------------------------------------------------------------------------------------------------

const PX = 64;   // pixels per metre

function canvas(wm: number, hm: number): [HTMLCanvasElement, CanvasRenderingContext2D, HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = e.width = wm * PX;
  c.height = e.height = hm * PX;
  const g = c.getContext('2d')!, ge = e.getContext('2d')!;
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, e.width, e.height);
  return [c, g, e, ge];
}

/** red brick in courses (y is metres from the top of the canvas) */
function brick(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#9a4636';
  g.fillRect(x * PX, y * PX, w * PX, h * PX);
  let seed = Math.round(x * 13 + y * 7);
  for (let yy = y * PX; yy < (y + h) * PX; yy += 5) {
    g.fillStyle = 'rgba(210,180,160,0.22)';
    g.fillRect(x * PX, yy, w * PX, 1);
    for (let xx = x * PX + ((yy / 5) % 2) * 7; xx < (x + w) * PX; xx += 14) {
      const k = rnd(seed++ * 0.37);
      g.fillStyle = k < 0.33 ? 'rgba(60,20,10,0.12)' : k < 0.66 ? 'rgba(255,200,170,0.07)' : 'rgba(0,0,0,0)';
      g.fillRect(xx + 1, yy + 1, 12, 4);
    }
  }
}

/** a window: white frame, dark glass with a sky sheen, mullions; lit (warm) on the glow canvas some nights */
function windowAt(g: CanvasRenderingContext2D, ge: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean, panes = 2): void {
  g.fillStyle = '#e8e8e4';
  g.fillRect(x * PX, y * PX, w * PX, h * PX);
  const f = 0.08;
  const grad = g.createLinearGradient(0, y * PX, 0, (y + h) * PX);
  grad.addColorStop(0, '#5d6f80'); grad.addColorStop(1, '#2c3640');
  g.fillStyle = grad;
  g.fillRect((x + f) * PX, (y + f) * PX, (w - 2 * f) * PX, (h - 2 * f) * PX);
  g.fillStyle = '#e8e8e4';
  for (let k = 1; k < panes; k++) g.fillRect((x + (w * k) / panes - 0.03) * PX, y * PX, 0.06 * PX, h * PX);
  g.fillRect(x * PX, (y + h * 0.3) * PX, w * PX, 0.05 * PX);
  if (lit) { ge.fillStyle = '#c9a46a'; ge.fillRect((x + f) * PX, (y + f) * PX, (w - 2 * f) * PX, (h - 2 * f) * PX); }
}

/** the main block: 16 m tile (repeats along the walls) by 16 m (the full height) */
function mainFacade(): { map: THREE.Texture; glow: THREE.Texture } {
  const W = 16, H = 16;
  const [c, g, e, ge] = canvas(W, H);
  const top = (ym: number) => H - ym;           // metres above ground -> canvas y (from the top)
  brick(g, 0, 0, W, H);
  // parapet: deep grey band
  g.fillStyle = '#55595e'; g.fillRect(0, 0, W * PX, 1.6 * PX);
  g.fillStyle = '#44484c'; g.fillRect(0, 1.6 * PX, W * PX, 0.12 * PX);
  // ground floor: a grey band over it, broad windows below
  g.fillStyle = '#6f7378'; g.fillRect(0, top(4.3) * PX, W * PX, 0.8 * PX);
  let s = 3;
  for (let x = 0.6; x < W - 2; x += 3.2) windowAt(g, ge, x, top(3.0), 2.6, 1.9, rnd(s++) < 0.4, 3);
  // floors 1-3: a grey-framed band of three windows; a tall white panel; another band
  for (let f = 1; f <= 3; f++) {
    const y0 = 3.5 + f * FLOOR;           // top of the window band
    for (const bx of [0.5, 9.8]) {
      g.fillStyle = '#7b7f84'; g.fillRect(bx * PX, top(y0) * PX, 5.4 * PX, 2.3 * PX);
      for (let k = 0; k < 2; k++) windowAt(g, ge, bx + 0.3 + k * 2.5, top(y0 - 0.2), 2.3, 1.85, rnd(s++) < 0.35, 2);
    }
  }
  // the tall white panel (textured, as in the photo) between the bands, floors 1-3
  g.fillStyle = '#dcdedd'; g.fillRect(6.6 * PX, top(14.3) * PX, 2.6 * PX, 10 * PX);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd(i * 1.3) < 0.5 ? 'rgba(150,155,160,0.35)' : 'rgba(255,255,255,0.5)';
    g.fillRect((6.6 + rnd(i * 2.7) * 2.6) * PX, (top(14.3) + rnd(i * 4.1) * 10) * PX, 3, 2);
  }
  return finish(c, e);
}

/** the wing: brick floors with pairs of grey-framed windows, a dark recessed ground floor (the portico) */
function wingFacade(): { map: THREE.Texture; glow: THREE.Texture } {
  const W = 16, H = 12.8;
  const [c, g, e, ge] = canvas(W, H);
  const top = (ym: number) => H - ym;
  brick(g, 0, 0, W, H);
  g.fillStyle = '#2c2f33'; g.fillRect(0, top(3.9) * PX, W * PX, 3.9 * PX);                 // the portico, in shadow
  for (let x = 1; x < W - 1; x += 3.4) {                                                     // its glass doors
    g.fillStyle = '#1c2228'; g.fillRect(x * PX, top(2.8) * PX, 2.2 * PX, 2.8 * PX);
    ge.fillStyle = NIGHT ? '#6b5a3c' : '#000'; ge.fillRect(x * PX, top(2.8) * PX, 2.2 * PX, 2.8 * PX);
  }
  let s = 41;
  for (let f = 1; f <= 2; f++) {
    const y0 = 3.6 + f * FLOOR;
    g.fillStyle = '#4a4e53'; g.fillRect(0, top(y0 - 2.5) * PX, W * PX, 0.35 * PX);           // a slab edge under each floor's windows
    for (let x = 0.8; x < W - 2; x += 4) {
      g.fillStyle = '#5c6065'; g.fillRect((x - 0.15) * PX, top(y0) * PX, 2.9 * PX, 2.3 * PX);
      windowAt(g, ge, x, top(y0 - 0.15), 2.6, 1.9, rnd(s++) < 0.35, 3);
    }
  }
  return finish(c, e);
}

function finish(c: HTMLCanvasElement, e: HTMLCanvasElement): { map: THREE.Texture; glow: THREE.Texture } {
  const map = new THREE.CanvasTexture(c), glow = new THREE.CanvasTexture(e);
  for (const t of [map, glow]) {
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
  }
  return { map, glow };
}
