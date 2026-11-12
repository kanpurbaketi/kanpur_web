import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { walkAlong } from './city';
import { BULB, Bulbs, C, FEST, Geo, litMat, rnd } from './geo';
import { LightPool, NIGHT } from './night';
import { inMela } from './melaSite';
import { centroid, DRIVABLE, MapData, P2, hash2, pointInPoly } from './types';

/*
 Street life for every part of the city:
   vendors    chai tapris, paan shops, chaat / samosa carts, sugarcane-juice stalls, fruit thelas, momos carts and
              kulfi carts along the roadsides, clustered at junctions and near bus stops, hospitals, banks, stations
   frontages  a named signboard on the building for every named place in the data (restaurants, cafes, banks, hospitals...)
              and a dhaba / sweet shop / restaurant with seating on some shop fronts
 Everything is procedural, merged into a few meshes; bulbs and signboards glow at night.
*/

type Kind = 'chai' | 'paan' | 'chaat' | 'juice' | 'fruit' | 'momos' | 'kulfi';
const KINDS: { kind: Kind; weight: number; r: number; label: string; sub: string; bg: string; fg: string }[] = [
  { kind: 'chai', weight: 28, r: 1.7, label: 'चाय', sub: 'TEA STALL', bg: '#1f6f43', fg: '#ffe9a8' },
  { kind: 'paan', weight: 22, r: 1.1, label: 'पान भंडार', sub: 'PAN • CIGARETTE', bg: '#b3261e', fg: '#fff1c9' },
  { kind: 'chaat', weight: 14, r: 1.3, label: 'चाट • समोसा', sub: 'CHAAT • SAMOSA', bg: '#f2b822', fg: '#5b1410' },
  { kind: 'juice', weight: 8, r: 1.3, label: 'गन्ना रस', sub: 'SUGARCANE JUICE', bg: '#2e8b57', fg: '#ffffff' },
  { kind: 'fruit', weight: 12, r: 1.2, label: '', sub: '', bg: '', fg: '' },
  { kind: 'momos', weight: 8, r: 1.1, label: 'मोमोज़', sub: 'MOMOS • CHOWMEIN', bg: '#c62828', fg: '#ffe45c' },
  { kind: 'kulfi', weight: 8, r: 1.0, label: 'कुल्फी', sub: 'KULFI • ICE CREAM', bg: '#1c4f9c', fg: '#ffffff' },
];
const TOTAL_WEIGHT = KINDS.reduce((a, k) => a + k.weight, 0);

const FOOD = new Set(['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream', 'bakery', 'confectionery', 'sweets', 'bar', 'pub', 'biergarten']);
const SIGN_STYLE: Record<string, [string, string]> = {   // kind -> [background, text]
  restaurant: ['#9c1c1c', '#ffe9a8'], cafe: ['#4a2c17', '#ffe9c2'], fast_food: ['#d62828', '#ffe45c'], food_court: ['#d62828', '#ffe45c'],
  ice_cream: ['#1c4f9c', '#ffffff'], bakery: ['#8a4b1d', '#fff1d6'], confectionery: ['#a31d5c', '#ffe9f2'], sweets: ['#a31d5c', '#ffe9f2'],
  hospital: ['#f4f4f4', '#1c4f9c'], clinic: ['#f4f4f4', '#1c4f9c'], doctors: ['#f4f4f4', '#1c4f9c'], pharmacy: ['#1f7a45', '#ffffff'],
  bank: ['#1c3f7a', '#ffffff'], atm: ['#1c3f7a', '#ffffff'], hotel: ['#3a2a5c', '#ffe9a8'], school: ['#0d3b66', '#fcbf49'],
  college: ['#0d3b66', '#fcbf49'], optician: ['#f4f4f4', '#b3261e'], electronics: ['#222222', '#ffd24a'],
};
const GENERIC = [['शर्मा स्वीट्स', 'SHARMA SWEETS', 'sweets'], ['होटल आनंद', 'HOTEL ANAND • VEG', 'restaurant'], ['न्यू पंजाबी ढाबा', 'NEW PUNJABI DHABA', 'restaurant'],
  ['चाट भंडार', 'CHAAT BHANDAR', 'fast_food'], ['मिठाई घर', 'MITHAI GHAR', 'sweets'], ['राधे रेस्टोरेंट', 'RADHE RESTAURANT', 'restaurant'],
  ['कानपुर कचौड़ी वाला', 'KACHORI • JALEBI', 'fast_food'], ['गुप्ता बेकरी', 'GUPTA BAKERY', 'bakery'], ['ठग्गू के लड्डू', 'LADDU • KHEER', 'sweets'],
  ['बाबा ढाबा', 'BABA DHABA', 'restaurant'], ['कॉफ़ी कॉर्नर', 'COFFEE CORNER', 'cafe'], ['अग्रवाल मिष्ठान्न', 'AGARWAL MISHTHAN', 'sweets']] as const;

// ---- signboards ---------------------------------------------------------------------------------------

/** Canvas atlas of signboards (main line + small line), drawn on demand; quads reference a tile. */
class SignAtlas {
  private static COLS = 4;
  private static ROWS = 20;
  private readonly TW = 512;
  private readonly TH = 100;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tiles = new Map<string, number>();
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];

  constructor() {
    this.canvas.width = this.TW * SignAtlas.COLS;
    this.canvas.height = this.TH * SignAtlas.ROWS;
    this.g = this.canvas.getContext('2d')!;
  }

  get full(): boolean {
    return this.tiles.size >= SignAtlas.COLS * SignAtlas.ROWS;
  }

  /** tile index for a label (drawn once per distinct label / colours) */
  tile(main: string, sub: string, bg: string, fg: string): number {
    const key = `${main}|${sub}|${bg}|${fg}`;
    let i = this.tiles.get(key);
    if (i !== undefined) return i;
    if (this.full) return 0;
    i = this.tiles.size;
    this.tiles.set(key, i);
    const g = this.g, ox = (i % SignAtlas.COLS) * this.TW, oy = Math.floor(i / SignAtlas.COLS) * this.TH;
    g.save();
    g.translate(ox, oy);
    g.fillStyle = bg;
    g.fillRect(0, 0, this.TW, this.TH);
    g.fillStyle = fg;
    g.fillRect(0, 0, this.TW, 5);
    g.fillRect(0, this.TH - 5, this.TW, 5);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const face = "'Noto Sans Devanagari','Kohinoor Devanagari','Mangal','Devanagari Sangam MN','Nirmala UI',Arial,sans-serif";
    const fit = (t: string, weight: string, px: number, maxW: number) => {
      g.font = `${weight} ${px}px ${face}`;
      const w = g.measureText(t).width;
      return w > maxW ? Math.floor((px * maxW) / w) : px;
    };
    const hasSub = sub !== '';
    const pm = fit(main, 'bold', hasSub ? 52 : 64, this.TW - 40);
    g.font = `bold ${pm}px ${face}`;
    g.fillStyle = fg;
    g.fillText(main, this.TW / 2, hasSub ? 38 : 52);
    if (hasSub) {
      const ps = fit(sub, '600', 24, this.TW - 40);
      g.font = `600 ${ps}px Arial, sans-serif`;
      g.fillText(sub, this.TW / 2, 80);
    }
    g.restore();
    return i;
  }

  /** a board of w x h metres centred at (x, y, z), facing local +z turned by ry */
  quad(x: number, y: number, z: number, w: number, h: number, ry: number, tile: number): void {
    const c = Math.cos(ry), s = Math.sin(ry);
    const corner = (lx: number, ly: number): [number, number, number] => [x + lx * c, y + ly, z - lx * s];
    const u0 = (tile % SignAtlas.COLS) / SignAtlas.COLS, u1 = u0 + 1 / SignAtlas.COLS;
    const v0 = Math.floor(tile / SignAtlas.COLS) / SignAtlas.ROWS, v1 = v0 + 1 / SignAtlas.ROWS;   // v0 = top row (flipY off)
    const a = corner(-w / 2, h / 2), b = corner(w / 2, h / 2), d = corner(w / 2, -h / 2), e = corner(-w / 2, -h / 2);
    const n = [s, 0, c];
    const push = (p: number[], uvp: [number, number]) => { this.pos.push(...p); this.nor.push(...n); this.uv.push(...uvp); };
    push(a, [u0, v0]); push(e, [u0, v1]); push(b, [u1, v0]);
    push(b, [u1, v0]); push(e, [u0, v1]); push(d, [u1, v1]);
  }

  mesh(): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = 8;
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: NIGHT ? 0.9 : 0.12, roughness: 0.8, side: THREE.DoubleSide,
    }));
    m.castShadow = false;
    return m;
  }
}

// ---- vendor models (local: origin on the ground, front toward +z) ------------------------------------

interface Sink { g: Geo; bulb: (x: number, y: number, z: number, c: string, phase?: number, size?: number) => void; sign: (y: number, w: number, h: number, z: number, x?: number) => void }

function tarp(seed: number): string {
  return ['#2a6fb5', '#1f8a5a', '#e07b1c', '#b3261e', '#3d5a80'][Math.floor(rnd(seed) * 5)];
}

function chai(s: Sink, seed: number): void {
  const g = s.g, roof = tarp(seed);
  for (const sx of [-1.35, 1.35]) for (const sz of [-0.9, 0.9]) g.rod(new THREE.Vector3(sx, 0, sz), new THREE.Vector3(sx, 2.3, sz), 0.035, '#b08a55');
  g.add(new THREE.BoxGeometry(3.1, 0.05, 2.3), roof, new THREE.Matrix4().makeRotationX(0.12).setPosition(0, 2.35, 0));
  g.box(0, 1.1, -0.95, 2.7, 2.2, 0.05, '#3a3a3a');                                // back screen
  g.box(0, 0.42, 0.25, 1.9, 0.84, 0.75, '#7a4a22');                               // counter
  g.box(0, 0.86, 0.25, 2.0, 0.05, 0.85, '#e0cfa8');
  g.cyl(-0.5, 0.88, 0.2, 0.2, 0.05, '#333', 12);                                     // stove
  g.cyl(-0.5, 0.93, 0.2, 0.14, 0.34, '#b8b8bc', 10, 0.16);                         // kettle
  g.cyl(-0.5, 1.27, 0.2, 0.05, 0.08, '#999', 8);
  s.bulb(-0.5, 0.95, 0.38, '#ff7a1a', -1, 2.4);                                     // glowing coals
  for (let k = 0; k < 6; k++) g.cyl(0.2 + (k % 3) * 0.17, 0.9, 0.12 + Math.floor(k / 3) * 0.17, 0.045, 0.1, '#e8f0f0', 8);   // tea glasses
  for (let k = 0; k < 4; k++) g.cyl(0.65, 0.9 + k * 0.17, 0.5, 0.09, 0.16, k % 2 ? '#e0a040' : '#c0392b', 8);              // snack jars
  for (let k = 0; k < 9; k++) g.box(-1.1 + k * 0.28, 1.95 + (k % 2) * 0.08, 0.7, 0.14, 0.2, 0.03, FEST[(k + Math.floor(seed * 7)) % FEST.length]);  // hanging packets
  g.box(0, 0.22, 1.2, 1.5, 0.08, 0.35, '#8a5a2a');                                   // bench
  for (const sx of [-0.6, 0.6]) { g.box(sx, 0.11, 1.2, 0.07, 0.22, 0.3, '#6a4a22'); }
  for (const [sx, sz, c] of [[-1.2, 1.4, '#2a6fb5'], [1.25, 1.4, '#d62828'], [0.9, 1.9, '#2a9d8f']] as [number, number, string][]) g.cyl(sx, 0, sz, 0.17, 0.4, c, 8, 0.15);
  s.bulb(-0.8, 2.15, 0.9, '#ffe6a0', -1, 1.6);
  s.bulb(0.8, 2.15, 0.9, '#ffe6a0', -1, 1.6);
  s.sign(2.0, 1.5, 0.3, 1.18);
}

function paan(s: Sink, seed: number): void {
  const g = s.g, body = ['#7a3a1d', '#1f5f8b', '#2d6a3e', '#8b1f1f'][Math.floor(rnd(seed) * 4)];
  g.box(0, 1.05, -0.2, 1.5, 2.1, 1.2, body);                                          // the gumti (kiosk) body
  g.box(0, 0.5, 0.45, 1.5, 1.0, 0.1, body);                                           // counter front
  g.box(0, 1.02, 0.5, 1.6, 0.06, 0.5, '#d8c8a0');                                     // counter shelf
  g.box(0, 1.6, 0.4, 1.3, 0.8, 0.04, '#1a1a1a');                                      // dark opening
  g.add(new THREE.BoxGeometry(1.8, 0.07, 1.5), '#2a2a2e', new THREE.Matrix4().makeRotationX(0.1).setPosition(0, 2.2, 0));
  for (let r = 0; r < 3; r++) for (let k = 0; k < 8; k++) g.box(-0.55 + k * 0.16, 2.0 - r * 0.22, 0.46, 0.11, 0.17, 0.02, FEST[(k + r * 3) % FEST.length]);   // chips / sachets
  for (let k = 0; k < 4; k++) g.cyl(-0.5 + k * 0.33, 1.05, 0.5, 0.07, 0.2, k % 2 ? '#e8e0c0' : '#d6a030', 8);                        // jars
  g.box(0.5, 1.42, 0.2, 0.3, 0.4, 0.03, '#b0c8d8');                                   // mirror
  s.bulb(-0.5, 1.88, 0.6, '#ffd47a', -1, 1.5);
  s.bulb(0.5, 1.88, 0.6, '#ffd47a', -1, 1.5);
  s.sign(2.45, 1.4, 0.28, 0.1);
}

function chaat(s: Sink, seed: number): void {
  const g = s.g, c = FEST[Math.floor(rnd(seed) * FEST.length)];
  g.box(0, 0.75, 0, 1.9, 0.12, 0.95, '#8a5a2a');                                      // cart bed
  g.box(0, 0.45, 0, 1.7, 0.5, 0.8, '#c9b48a');
  for (const sx of [-0.95, 0.95]) g.add(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 14), '#222', new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx, 0.4, 0));
  g.cyl(-0.45, 0.82, 0, 0.36, 0.14, '#1c1c1c', 14, 0.28);                             // kadhai
  g.cyl(-0.45, 0.95, 0, 0.3, 0.02, '#d9791a', 12);
  s.bulb(-0.45, 1.0, 0, '#ff7a1a', -1, 2.4);
  g.box(0.5, 1.15, 0, 0.8, 0.6, 0.7, '#cfe6ef');                                      // glass case
  for (let k = 0; k < 6; k++) g.sphere(0.25 + (k % 3) * 0.25, 1.15, -0.15 + Math.floor(k / 3) * 0.3, 0.09, k % 2 ? '#d99a3a' : '#c9772a', 1, 0.8, 1);   // samosas
  g.rod(new THREE.Vector3(0, 0.8, -0.4), new THREE.Vector3(0, 2.4, -0.4), 0.03, '#cfcfcf');
  g.add(new THREE.ConeGeometry(1.6, 0.5, 10, 1, true), c, new THREE.Matrix4().makeTranslation(0, 2.35, -0.4));          // umbrella
  s.bulb(0, 2.05, -0.1, '#ffe6a0', -1, 1.4);
  s.sign(1.7, 1.2, 0.26, 0.5);
}

function juice(s: Sink): void {
  const g = s.g;
  g.box(0, 0.75, 0, 1.8, 0.12, 0.9, '#6a4a22');
  g.box(0, 0.42, 0, 1.6, 0.5, 0.75, '#2e6b46');
  for (const sx of [-0.9, 0.9]) g.add(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 14), '#222', new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx, 0.38, 0));
  g.box(-0.4, 1.15, 0, 0.6, 0.6, 0.5, '#b8b8bc');                                     // the juicer
  g.add(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12), '#8a8a90', new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(-0.4, 1.3, 0.3));   // wheel
  for (let k = 0; k < 14; k++) g.rod(new THREE.Vector3(0.5 + (k % 5) * 0.08, 0.85, -0.2 + (k % 3) * 0.12), new THREE.Vector3(0.7 + (k % 5) * 0.1, 1.9, -0.3 + (k % 3) * 0.1), 0.03, '#7ea03a', 5);   // canes
  for (let k = 0; k < 5; k++) g.cyl(-0.1 + k * 0.12, 0.88, 0.32, 0.05, 0.14, '#e8f0f0', 8);
  g.add(new THREE.BoxGeometry(2.2, 0.05, 1.6), '#2e8b57', new THREE.Matrix4().makeRotationX(0.1).setPosition(0, 2.3, 0));
  for (const sx of [-1, 1]) g.rod(new THREE.Vector3(sx, 0.8, 0.6), new THREE.Vector3(sx, 2.3, 0.6), 0.03, '#cccccc');
  s.bulb(0, 2.1, 0.6, '#ffe6a0', -1, 1.5);
  s.sign(1.95, 1.4, 0.28, 0.9);
}

function fruit(s: Sink, seed: number): void {
  const g = s.g;
  g.box(0, 0.8, 0, 2.0, 0.1, 1.0, '#8a5a2a');
  g.box(0, 0.5, 0, 1.9, 0.5, 0.9, '#a9794a');
  for (const sx of [-1.05, 1.05]) g.add(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 14), '#222', new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx, 0.42, 0));
  const piles: [number, string, number][] = [[-0.65, '#e8861a', 0.1], [0, '#c0392b', 0.1], [0.65, '#f2d12a', 0.09]];
  piles.forEach(([x, col, r], i) => {
    for (let row = 0; row < 3; row++) for (let k = 0; k < 4 - row; k++) g.sphere(x - (3 - row) * 0.06 + k * 0.13, 0.95 + row * 0.12, -0.12 + (k % 2) * 0.2, r, i === 2 ? '#f2d12a' : col, i === 2 ? 1.6 : 1, 1, 1);
  });
  for (let k = 0; k < 6; k++) g.sphere(-0.9 + k * 0.36, 0.95, 0.32, 0.1, FEST[(k + Math.floor(seed * 5)) % FEST.length], 1, 0.9, 1);
  g.rod(new THREE.Vector3(0, 0.85, -0.45), new THREE.Vector3(0, 2.2, -0.45), 0.03, '#cfcfcf');
  g.add(new THREE.ConeGeometry(1.7, 0.45, 10, 1, true), tarp(seed + 3), new THREE.Matrix4().makeTranslation(0, 2.15, -0.45));
  s.bulb(0, 1.85, 0.1, '#ffe6a0', -1, 1.3);
}

function momos(s: Sink, seed: number): void {
  const g = s.g, c = seed > 0.5 ? '#c62828' : '#f2b822';
  g.box(0, 0.75, 0, 1.7, 0.12, 0.9, '#8a8a90');
  g.box(0, 0.42, 0, 1.5, 0.5, 0.75, '#c8c8cc');
  for (const sx of [-0.85, 0.85]) g.add(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 14), '#222', new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx, 0.38, 0));
  for (let k = 0; k < 3; k++) g.cyl(-0.4, 0.81 + k * 0.2, 0, 0.3 - k * 0.02, 0.18, '#b8b8bc', 12);                     // steamer stack
  g.cyl(-0.4, 1.41, 0, 0.12, 0.08, '#999', 8);
  g.cyl(0.35, 0.81, 0, 0.3, 0.12, '#222', 12, 0.26);                                                                      // wok
  s.bulb(0.35, 0.95, 0, '#ff6a1a', -1, 2.2);
  g.rod(new THREE.Vector3(0, 0.8, -0.4), new THREE.Vector3(0, 2.3, -0.4), 0.03, '#cfcfcf');
  g.add(new THREE.ConeGeometry(1.5, 0.45, 10, 1, true), c, new THREE.Matrix4().makeTranslation(0, 2.25, -0.4));
  s.bulb(0, 2.0, 0.1, '#ffe6a0', -1, 1.3);
  s.sign(1.7, 1.1, 0.24, 0.5);
}

function kulfi(s: Sink): void {
  const g = s.g;
  g.box(0, 0.45, 0, 1.3, 0.7, 0.8, '#f4f4f0');
  g.box(0, 0.82, 0, 1.36, 0.05, 0.86, '#1c4f9c');
  for (const sx of [-0.7, 0.7]) g.add(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 12), '#222', new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(sx, 0.3, 0));
  for (let k = 0; k < 6; k++) g.add(new THREE.ConeGeometry(0.06, 0.22, 6), FEST[k % FEST.length], new THREE.Matrix4().makeTranslation(-0.4 + k * 0.16, 0.95, 0.25));
  g.rod(new THREE.Vector3(0.5, 0.8, -0.3), new THREE.Vector3(0.5, 2.3, -0.3), 0.03, '#cfcfcf');
  g.add(new THREE.ConeGeometry(1.3, 0.4, 10, 1, true), '#f2f2f2', new THREE.Matrix4().makeTranslation(0.2, 2.25, -0.3));
  g.box(-0.5, 1.6, 0.4, 0.4, 0.3, 0.03, '#d62828');                                                                       // little flag board
  s.bulb(0.2, 2.0, 0.1, '#ffe6a0', -1, 1.3);
  s.sign(1.55, 1.0, 0.22, 0.45, -0.5);
}

// ---- the world -----------------------------------------------------------------------------------------

/** the mela clearing in Moti Jheel: no building there, so nothing to hang a sign on */
function cleared(map: MapData, x: number, z: number): boolean {
  return map.area === 'moti_jheel' && inMela(x, z, 6);
}

export class Vendors {
  readonly group = new THREE.Group();
  /** solid circles for collision: [x, z, r] */
  readonly posts: [number, number, number][] = [];
  readonly stats = { vendors: 0, frontages: 0, signs: 0 };
  /** where signboards hang: [x, z, facing angle] (for test scripts / debugging) */
  readonly signSpots: [number, number, number][] = [];

  constructor(map: MapData, occupied: (x: number, z: number) => boolean, avoid: [number, number, number][], lights: LightPool | null, desktop = true) {
    const geos: THREE.BufferGeometry[] = [];
    const bulbs = new Bulbs();
    const atlas = new SignAtlas();
    const placed: P2[] = [];
    const roadSegs = new RoadIndex(map);
    const isFree = (x: number, z: number, r: number) =>
      ![[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dz]) => occupied(x + dx, z + dz)) &&
      !avoid.some(([ax, az, ar]) => Math.hypot(ax - x, az - z) < r + ar + 0.3) &&
      !placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3.4);

    const make = (kind: Kind, seed: number): ((s: Sink) => void) => {
      switch (kind) {
        case 'chai': return (s) => chai(s, seed);
        case 'paan': return (s) => paan(s, seed);
        case 'chaat': return (s) => chaat(s, seed);
        case 'juice': return (s) => juice(s);
        case 'fruit': return (s) => fruit(s, seed);
        case 'momos': return (s) => momos(s, seed);
        default: return (s) => kulfi(s);
      }
    };
    const info = (kind: Kind) => KINDS.find((k) => k.kind === kind)!;

    const place = (kind: Kind, x: number, y: number, z: number, rot: number, seed: number): void => {
      const I = info(kind);
      const g = new Geo();
      const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
      const c = Math.cos(rot), s = Math.sin(rot);
      const W = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
      const sink: Sink = {
        g,
        bulb: (lx, ly, lz, col, phase = -1, size = 1.2) => { const [wx, wz] = W(lx, lz); bulbs.add(wx, y + ly, wz, col, phase, size); },
        sign: (ly, w, h, lz, lx = 0) => {
          if (!I.label) return;
          const [wx, wz] = W(lx, lz);
          atlas.quad(wx, y + ly, wz, w, h, rot, atlas.tile(I.label, I.sub, I.bg, I.fg));
        },
      };
      make(kind, seed)(sink);
      const geo = g.build();
      geo.applyMatrix4(M);
      geos.push(geo);
      placed.push([x, z]);
      this.posts.push([x, z, I.r]);
      this.stats.vendors++;
      if (NIGHT && lights && (this.stats.vendors % 3 === 0)) lights.add(x, 2.6, z, '#ffc27a', 32, 9);
    };

    const pickKind = (r: number): Kind => {
      let a = r * TOTAL_WEIGHT;
      for (const k of KINDS) { a -= k.weight; if (a <= 0) return k.kind; }
      return 'chai';
    };

    // 1. along the roads: a vendor here and there, more on busy roads
    const cap = desktop ? 220 : 110;
    for (const r of map.roads) {
      if (this.stats.vendors >= cap) break;
      if (r.bridge || !DRIVABLE.has(r.cls) || r.w < 3.5) continue;
      const major = ['trunk', 'primary', 'secondary', 'tertiary'].includes(r.cls);
      const walk = r.sidewalk === 'both' || r.sidewalk === 'yes';
      const side = r.oneway || hash2(r.id, 7) < 0.5 ? 1 : -1;
      const step = major ? 46 + hash2(r.id, 3) * 40 : 110 + hash2(r.id, 5) * 90;
      walkAlong(r.pts, step, (px, pz, dx, dz) => {
        if (this.stats.vendors >= cap) return;
        const sd = hash2(px * 1.3, pz * 0.7) < 0.5 ? side : -side;
        const nx = dz * sd, nz = -dx * sd;
        const kind = pickKind(hash2(px, pz + 11));
        const rr = info(kind).r;
        const off = r.w / 2 + (walk ? 1.45 : 1.0) + rr * 0.6;
        const x = px + nx * off, z = pz + nz * off;
        if (!isFree(x, z, rr)) return;
        place(kind, x, walk ? 0.16 : 0.02, z, Math.atan2(-nx, -nz), hash2(x, z));
      }, 12 + hash2(r.id, 9) * 20);
    }

    // 2. clusters (chai + paan, as at every chowk) next to bus stops, stations and busy public places
    for (const poi of map.pois) {
      if (this.stats.vendors >= cap + 40) break;
      const busy = ['stop', 'bus_station', 'station', 'hospital', 'bank', 'school', 'college', 'university', 'place_of_worship', 'marketplace', 'cinema'].includes(poi.kind);
      if (!busy) continue;
      const near = roadSegs.nearest(poi.p[0], poi.p[1]);
      if (!near) continue;
      for (let k = 0; k < 2; k++) {
        const kind: Kind = k === 0 ? 'chai' : (hash2(poi.p[0], poi.p[1]) < 0.5 ? 'paan' : 'chaat');
        const rr = info(kind).r;
        const off = near.w / 2 + (near.walk ? 1.45 : 1.0) + rr * 0.6;
        const x = near.x + near.nx * off + near.dx * (k ? 4.5 : -1.5), z = near.z + near.nz * off + near.dz * (k ? 4.5 : -1.5);
        if (isFree(x, z, rr)) place(kind, x, near.walk ? 0.16 : 0.02, z, Math.atan2(-near.nx, -near.nz), hash2(x, z));
      }
    }

    // 3. named places: a signboard on the building for every point of interest, seating for the restaurants
    const seating = new Geo();
    const frontage = (bx: number, bz: number, nx: number, nz: number, ex: number, ez: number, ry: number, name: string, sub: string,
                      kind: string, food: boolean, seed: number) => {
      const [bg, fg] = SIGN_STYLE[kind] ?? ['#2a3f5a', '#ffffff'];
      const t = atlas.tile(name, sub, bg, fg);
      const wBoard = Math.min(5.5, Math.max(3, ex * 0.7));
      atlas.quad(bx + nx * 0.25, 3.7, bz + nz * 0.25, wBoard, wBoard / 4.6, ry, t);
      for (const sx of [-1, 1]) bulbs.add(bx + nx * 0.4 + sx * (wBoard / 2 + 0.1) * Math.cos(ry), 3.7, bz + nz * 0.4 - sx * (wBoard / 2 + 0.1) * Math.sin(ry), '#ffe6a0', -1, 1.2);
      this.stats.signs++;
      this.signSpots.push([bx, bz, ry]);
      if (!food) return;
      // seating out front: a few plastic tables with chairs, a striped awning
      this.stats.frontages++;
      const col = FEST[Math.floor(rnd(seed) * FEST.length)];
      const c = Math.cos(ry), s = Math.sin(ry);
      for (let k = 0; k < 3; k++) {
        const lx = (k - 1) * 1.8, ld = 1.3 + (k % 2) * 0.5;
        const tx = bx + lx * c + nx * ld, tz = bz - lx * s + nz * ld;
        if (occupied(tx, tz) || !roadSegs.clear(tx, tz, 0.9)) continue;
        seating.cyl(tx, 0, tz, 0.4, 0.72, '#f0f0ec', 10);
        seating.cyl(tx, 0.72, tz, 0.42, 0.04, col, 10);
        for (const a of [0, 1.57, 3.14, 4.71]) {
          const cx = tx + Math.cos(a) * 0.62, cz = tz + Math.sin(a) * 0.62;
          seating.box(cx, 0.22, cz, 0.38, 0.04, 0.38, '#2a6fb5');
          seating.box(cx, 0.5, cz + Math.sin(a) * 0.17, 0.38, 0.4, 0.03, '#2a6fb5');
          seating.rod(new THREE.Vector3(cx - 0.15, 0, cz - 0.15), new THREE.Vector3(cx - 0.15, 0.22, cz - 0.15), 0.015, '#2a6fb5', 4);
          seating.rod(new THREE.Vector3(cx + 0.15, 0, cz + 0.15), new THREE.Vector3(cx + 0.15, 0.22, cz + 0.15), 0.015, '#2a6fb5', 4);
        }
        bulbs.add(tx, 2.4, tz, '#ffd9a0', -1, 1.3);
        this.posts.push([tx, tz, 0.5]);
      }
    };

    const buildingIndex = new BuildingIndex(map);
    for (const poi of map.pois) {
      if (!poi.name) continue;
      const hit = buildingIndex.frontEdge(poi.p[0], poi.p[1]);
      if (!hit) continue;
      const main = poi.name_hi || poi.name;
      const sub = poi.name_hi ? poi.name : (FOOD.has(poi.kind) ? poi.kind.replace(/_/g, ' ').toUpperCase() : '');
      frontage(hit.x, hit.z, hit.nx, hit.nz, hit.len, 0, Math.atan2(hit.nx, hit.nz), main, sub, poi.kind, FOOD.has(poi.kind), hash2(poi.p[0], poi.p[1]));
    }
    // generic dhabas, sweet shops and restaurants on some shop fronts (every part of the city has them)
    let generic = 0;
    for (const b of map.buildings) {
      if (generic >= (desktop ? 70 : 35)) break;
      if (!b.shop || b.front.length === 0 || b.seed < 0.86) continue;
      { const [cx, cz] = centroid(b.pts); if (cleared(map, cx, cz)) continue; }
      const i = b.front[0];
      const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 9) continue;
      let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      if (pointInPoly(mx + nx * 0.05, mz + nz * 0.05, b.pts)) { nx = -nx; nz = -nz; }
      const [name, sub, kind] = GENERIC[Math.floor(b.seed * 977) % GENERIC.length];
      frontage(mx, mz, nx, nz, len, 0, Math.atan2(nx, nz), name, sub, kind, true, b.seed);
      generic++;
    }

    // build
    if (geos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, litMat({ metalness: 0.05, roughness: 0.8, side: THREE.DoubleSide }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (!seating.empty) this.group.add(new THREE.Mesh(seating.build(), litMat({ metalness: 0.05, roughness: 0.8 })));
    const signMesh = atlas.mesh();
    if (signMesh) this.group.add(signMesh);
    if (bulbs.count) this.group.add(bulbs.object(NIGHT ? 0.7 : 0.2));
    void C; void BULB;
  }
}

// ---- spatial helpers -----------------------------------------------------------------------------------

/** nearest point on a drivable road, with its direction and side normal, and "is any road within r of this point" */
class RoadIndex {
  private cells = new Map<string, { a: P2; b: P2; w: number; walk: boolean }[]>();
  private CELL = 25;

  constructor(map: MapData) {
    for (const r of map.roads) {
      if (r.bridge || !DRIVABLE.has(r.cls)) continue;
      const walk = r.sidewalk === 'both' || r.sidewalk === 'yes';
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const x0 = Math.floor(Math.min(a[0], b[0]) / this.CELL), x1 = Math.floor(Math.max(a[0], b[0]) / this.CELL);
        const z0 = Math.floor(Math.min(a[1], b[1]) / this.CELL), z1 = Math.floor(Math.max(a[1], b[1]) / this.CELL);
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
          const k = cx + ',' + cz;
          let l = this.cells.get(k);
          if (!l) this.cells.set(k, (l = []));
          l.push({ a, b, w: r.w, walk });
        }
      }
    }
  }

  private near(x: number, z: number, reach: number) {
    const out: { a: P2; b: P2; w: number; walk: boolean }[] = [];
    for (let cx = Math.floor((x - reach) / this.CELL); cx <= Math.floor((x + reach) / this.CELL); cx++)
      for (let cz = Math.floor((z - reach) / this.CELL); cz <= Math.floor((z + reach) / this.CELL); cz++) {
        const l = this.cells.get(cx + ',' + cz);
        if (l) out.push(...l);
      }
    return out;
  }

  private static proj(x: number, z: number, a: P2, b: P2): { t: number; d: number } {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    return { t, d: Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) };
  }

  /** true if no road surface (half width + margin) is within the margin of the point */
  clear(x: number, z: number, margin: number): boolean {
    for (const s of this.near(x, z, 12)) {
      if (RoadIndex.proj(x, z, s.a, s.b).d < s.w / 2 + margin) return false;
    }
    return true;
  }

  nearest(x: number, z: number): { x: number; z: number; dx: number; dz: number; nx: number; nz: number; w: number; walk: boolean } | null {
    let best: { s: { a: P2; b: P2; w: number; walk: boolean }; t: number; d: number } | null = null;
    for (const s of this.near(x, z, 40)) {
      const p = RoadIndex.proj(x, z, s.a, s.b);
      if (!best || p.d < best.d) best = { s, t: p.t, d: p.d };
    }
    if (!best || best.d > 40) return null;
    const { a, b } = best.s;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    const px = a[0] + (b[0] - a[0]) * best.t, pz = a[1] + (b[1] - a[1]) * best.t;
    // unit normal pointing from the road toward the point
    let nx = dz, nz = -dx;
    if ((x - px) * nx + (z - pz) * nz < 0) { nx = -nx; nz = -nz; }
    return { x: px, z: pz, dx, dz, nx, nz, w: best.s.w, walk: best.s.walk };
  }
}

/** the road-facing wall of the building nearest to a point (for hanging a signboard on it) */
class BuildingIndex {
  private cells = new Map<string, number[]>();
  private CELL = 20;

  constructor(private map: MapData) {
    map.buildings.forEach((b, bi) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of b.pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      for (let cx = Math.floor((x0 - 8) / this.CELL); cx <= Math.floor((x1 + 8) / this.CELL); cx++)
        for (let cz = Math.floor((z0 - 8) / this.CELL); cz <= Math.floor((z1 + 8) / this.CELL); cz++) {
          const k = cx + ',' + cz;
          let l = this.cells.get(k);
          if (!l) this.cells.set(k, (l = []));
          l.push(bi);
        }
    });
  }

  frontEdge(x: number, z: number): { x: number; z: number; nx: number; nz: number; len: number } | null {
    const list = this.cells.get(Math.floor(x / this.CELL) + ',' + Math.floor(z / this.CELL)) ?? [];
    let best: { x: number; z: number; nx: number; nz: number; len: number; d: number } | null = null;
    for (const bi of list) {
      const b = this.map.buildings[bi];
      if (!b.front.length) continue;
      { const [cx, cz] = centroid(b.pts); if (cleared(this.map, cx, cz)) continue; }
      for (const i of b.front) {
        const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 3) continue;
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        const d = Math.hypot(mx - x, mz - z) + (pointInPoly(x, z, b.pts) ? 0 : 6);
        if (!best || d < best.d) {
          let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
          if (pointInPoly(mx + nx * 0.05, mz + nz * 0.05, b.pts)) { nx = -nx; nz = -nz; }
          best = { x: mx, z: mz, nx, nz, len, d };
        }
      }
    }
    return best && best.d < 40 ? best : null;
  }
}
