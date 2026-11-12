import * as THREE from 'three';
import { MapData } from './types';
import {
  BODY, torsoGeo, thighGeo, shinGeo, footGeo, upperArmGeo, forearmGeo, handGeo, skirtGeo, headGeo, HEAD,
  shortHairGeo, longHairGeo, drapeGeo,
} from './body';

/*
 Random pedestrians.
 A fixed pool of people is kept around the player: they walk the street network (footpath where a road
 has one, otherwise the edge of the carriageway), pick a random turn at each junction, pause now and then,
 and some just stand around. Anyone left far behind is moved to a street ahead / out of sight.
 Rendering: one InstancedMesh per body part (a dozen draw calls for everybody), per-person colours and height.
*/

const SPAWN_MIN = 60, SPAWN_MAX = 170, DESPAWN = 195; // metres from the player
const SIDEWALK_Y = 0.16;

interface Link { to: number; off: number; y: number }
interface Node { x: number; z: number; links: Link[] }

interface Ped {
  kind: number;       // 0 shirt + trousers, 1 kurta-pyjama, 2 salwar kameez, 3 sari
  scale: number;
  skirt: number;      // length of the kurta / sari below the waist (0 = none)
  speed: number;
  jitter: number;     // personal sideways offset
  a: number; b: number; link: Link; t: number; len: number;
  x: number; y: number; z: number; heading: number;
  phase: number; moving: number; wait: number;
  fresh: boolean;     // not on a street yet
}

const SKIN = ['#8a5a3c', '#a9714b', '#b98058', '#7a4e34', '#c08d66', '#96633f'];
const HAIR = ['#0d0c0f', '#15110f', '#1e1612', '#0d0c0f', '#5c5a58', '#b9b6b0'];
const SHIRTS = ['#e9e6dc', '#b9c7d8', '#6f8fb3', '#c9b48a', '#8a9a6a', '#d8d2c4', '#a34a3a', '#3f5a78', '#e2c36b', '#7b7f86', '#cfd8c0'];
const TROUSERS = ['#2c3646', '#3a3a3c', '#4a4238', '#5b6470', '#2a2a2e', '#6b5d4a'];
const KURTAS = ['#f0ebdd', '#e4dcc6', '#d8c9a3', '#cfd6dc', '#e8a94a', '#c9d2b4'];
const BRIGHT = ['#c2185b', '#e0652a', '#2a8a7a', '#d4a017', '#7b3fa0', '#1f6fb5', '#c0392b', '#2e8b57', '#e84a8a', '#3a4fb0', '#b5651d'];

export class Pedestrians {
  readonly group = new THREE.Group();
  private nodes: Node[] = [];
  private peds: Ped[] = [];
  private active = 0;
  private parts: Record<'thigh' | 'shin' | 'torso' | 'skirt' | 'drape' | 'sleeve' | 'forearm' | 'hand' | 'head' | 'hair' | 'longHair' | 'feet', THREE.InstancedMesh>;

  /** `local`: a fixed crowd on a small street graph (the mela): people stay on it and never get recycled around the player */
  constructor(map: MapData, readonly capacity: number, private local = false) {
    const count = capacity;
    this.buildGraph(map);
    const face = faceTexture();
    const mat = (roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ roughness, ...extra });
    const im = (g: THREE.BufferGeometry, n: number, rough = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.InstancedMesh(g, mat(rough, extra), n);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // instances move around the whole map
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const G = geometries();
    this.parts = {
      thigh: im(G.thigh, count * 2, 0.9), shin: im(G.shin, count * 2, 0.9), torso: im(G.torso, count),
      skirt: im(G.skirt, count, 0.9, { side: THREE.DoubleSide }), drape: im(G.drape, count, 0.8, { side: THREE.DoubleSide }),
      sleeve: im(G.sleeve, count * 2), forearm: im(G.forearm, count * 2, 0.65), hand: im(G.hand, count * 2, 0.6),
      head: im(G.head, count, 0.6, { map: face }), hair: im(G.hair, count, 0.45), longHair: im(G.longHair, count, 0.45),
      feet: im(G.feet, count * 2, 0.7),
    };
    for (let i = 0; i < count; i++) this.peds.push(this.makePerson(i));
    this.setCount(0);
  }

  /** number of people currently on the streets */
  get count(): number {
    return this.active;
  }

  /** Change the crowd size (0 .. capacity). Takes effect on the next update. */
  setCount(n: number): void {
    n = Math.max(0, Math.min(this.capacity, Math.round(n) || 0));
    for (let i = this.active; i < n; i++) this.peds[i].fresh = true;
    this.active = n;
    const P = this.parts;
    for (const m of [P.torso, P.skirt, P.drape, P.head, P.hair, P.longHair]) m.count = n;
    for (const m of [P.thigh, P.shin, P.sleeve, P.forearm, P.hand, P.feet]) m.count = n * 2;
  }

  /** Street network: one node per distinct road vertex, links along the roads. */
  private buildGraph(map: MapData): void {
    const index = new Map<string, number>();
    const nodeAt = (x: number, z: number) => {
      const k = `${x.toFixed(1)},${z.toFixed(1)}`;
      let i = index.get(k);
      if (i === undefined) {
        i = this.nodes.length;
        this.nodes.push({ x, z, links: [] });
        index.set(k, i);
      }
      return i;
    };
    for (const r of map.roads) {
      if (r.bridge) continue;
      const walk = r.sidewalk === 'both' || r.sidewalk === 'yes';
      // on the footpath where there is one, otherwise along the edge of the road
      const off = walk ? r.w / 2 + 1.0 : Math.max(0.5, r.w / 2 - 0.4);
      const y = walk ? SIDEWALK_Y : 0.05;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = nodeAt(r.pts[i][0], r.pts[i][1]), b = nodeAt(r.pts[i + 1][0], r.pts[i + 1][1]);
        if (a === b) continue;
        this.nodes[a].links.push({ to: b, off, y });
        this.nodes[b].links.push({ to: a, off, y });
      }
    }
  }

  private makePerson(i: number): Ped {
    const r = Math.random();
    const kind = r < 0.45 ? 0 : r < 0.6 ? 1 : r < 0.82 ? 2 : 3;
    const child = kind === 0 && Math.random() < 0.12;
    const woman = kind >= 2;
    const scale = child ? 0.62 + Math.random() * 0.12 : (woman ? 0.9 : 0.96) + Math.random() * 0.1;
    const p: Ped = {
      kind, scale,
      skirt: kind === 1 ? 0.42 : kind === 2 ? 0.5 : kind === 3 ? 0.84 : 0,
      speed: (child ? 1.5 : kind === 3 ? 1.0 : 1.15) + Math.random() * 0.45,
      jitter: (Math.random() - 0.5) * 0.7,
      a: 0, b: 0, link: { to: 0, off: 0, y: 0 }, t: 0, len: 1,
      x: 0, y: 0, z: 0, heading: 0, phase: Math.random() * 6, moving: 1, wait: 0, fresh: true,
    };
    // colours
    const c = new THREE.Color();
    const pick = (list: string[]) => c.set(list[Math.floor(Math.random() * list.length)]).clone();
    const skin = pick(SKIN), hair = pick(HAIR.slice(0, child || woman ? 4 : 6));
    const top = pick(kind === 0 ? SHIRTS : kind === 1 ? KURTAS : BRIGHT);
    const accent = pick(BRIGHT); // sari blouse / dupatta
    const bottom = kind === 0 ? pick(TROUSERS) : kind === 1 ? pick(['#ece8dc', '#e0dccf', '#d9d4c4'])
      : kind === 2 ? (Math.random() < 0.5 ? top.clone().multiplyScalar(0.7) : pick(['#e8e3d6', '#2f2f35', '#d9b44a'])) : top;
    const longSleeve = kind === 1 || (kind === 0 && Math.random() < 0.35);
    const P = this.parts;
    P.torso.setColorAt(i, kind === 3 ? accent : top);
    P.skirt.setColorAt(i, top);
    P.drape.setColorAt(i, kind === 3 ? top : accent);
    P.head.setColorAt(i, skin);
    P.hair.setColorAt(i, hair);
    P.longHair.setColorAt(i, hair);
    for (const k of [i * 2, i * 2 + 1]) {
      P.thigh.setColorAt(k, bottom);
      P.shin.setColorAt(k, bottom);
      P.sleeve.setColorAt(k, kind === 3 ? accent : top);
      P.forearm.setColorAt(k, longSleeve ? top : skin);
      P.hand.setColorAt(k, skin);
      P.feet.setColorAt(k, skin.clone().multiplyScalar(0.55)); // sandals / dusty feet
    }
    return p;
  }

  /** Put a person on a random street segment in the given distance band around (fx, fz). */
  private place(p: Ped, fx: number, fz: number, min: number, max: number, dirX: number, dirZ: number): boolean {
    const cands: number[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (!n.links.length) continue;
      if (this.local) { cands.push(i); continue; }
      const dx = n.x - fx, dz = n.z - fz, d = Math.hypot(dx, dz);
      if (d < min || d > max) continue;
      // close ones only where the camera is not looking, so nobody pops into view
      if (d < 120 && dx * dirX + dz * dirZ > 0.2 * d) continue;
      cands.push(i);
    }
    if (!cands.length) return false;
    p.a = cands[Math.floor(Math.random() * cands.length)];
    const links = this.nodes[p.a].links;
    this.setLink(p, links[Math.floor(Math.random() * links.length)]);
    p.t = Math.random() * p.len;
    p.wait = Math.random() < (this.local ? 0.35 : 0.14) ? 8 + Math.random() * 40 : 0; // some people just stand around
    const [x, y, z, h] = this.target(p);
    p.x = x; p.y = y; p.z = z;
    p.heading = p.wait ? h + Math.PI / 2 + (Math.random() - 0.5) : h;
    p.moving = p.wait ? 0 : 1;
    return true;
  }

  private setLink(p: Ped, l: Link): void {
    const A = this.nodes[p.a], B = this.nodes[l.to];
    p.b = l.to;
    p.link = l;
    p.len = Math.hypot(B.x - A.x, B.z - A.z) || 0.01;
    p.t = 0;
  }

  /** Where the person should be on their current segment: [x, y, z, heading]. */
  private target(p: Ped): [number, number, number, number] {
    const A = this.nodes[p.a], B = this.nodes[p.b];
    const dx = (B.x - A.x) / p.len, dz = (B.z - A.z) / p.len;
    const off = p.link.off + p.jitter;
    return [A.x + dx * p.t + dz * off, p.link.y, A.z + dz * p.t - dx * off, Math.atan2(-dx, -dz)];
  }

  /**
   * (fx, fz): the player (or camera) position; (dirX, dirZ): where the camera looks, on the ground plane;
   * (px, pz): somebody to make way for (the player), if any.
   */
  update(dt: number, fx: number, fz: number, dirX: number, dirZ: number, px = Infinity, pz = Infinity): void {
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (p.fresh) {
        // new arrivals fill the streets all around the player (nobody right on top of them)
        this.place(p, fx, fz, 6, SPAWN_MAX, 0, 0);
        p.fresh = false;
      }
      if (!this.local && Math.hypot(p.x - fx, p.z - fz) > DESPAWN) this.place(p, fx, fz, SPAWN_MIN, SPAWN_MAX, dirX, dirZ);
      const blocked = Math.hypot(p.x - px, p.z - pz) < 0.9;
      let walking = false;
      if (p.wait > 0) p.wait -= dt;
      else if (!blocked) {
        walking = true;
        p.t += p.speed * dt;
        if (p.t >= p.len) {
          // junction: any street except straight back, unless it is a dead end
          const here = p.b, from = p.a;
          const opts = this.nodes[here].links.filter((l) => l.to !== from);
          p.a = here;
          this.setLink(p, opts.length ? opts[Math.floor(Math.random() * opts.length)] : this.nodes[here].links[0]);
          if (Math.random() < 0.05) p.wait = 2 + Math.random() * 6;
        }
      }
      const [tx, ty, tz, th] = this.target(p);
      const k = Math.min(1, dt * 5);
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
      p.z += (tz - p.z) * k;
      if (p.wait <= 0) {
        const d = Math.atan2(Math.sin(th - p.heading), Math.cos(th - p.heading));
        p.heading += d * Math.min(1, dt * 6);
      }
      p.moving += ((walking ? 1 : 0) - p.moving) * Math.min(1, dt * 6);
      p.phase += p.speed * dt * 4.2 * p.moving / p.scale;
    }
    this.write();
  }

  private write(): void {
    const P = this.parts;
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      const swing = Math.sin(p.phase) * 0.55 * p.moving;
      const bob = Math.abs(Math.cos(p.phase)) * 0.025 * p.moving;
      ROOT.compose(V.set(p.x, p.y + bob * p.scale, p.z), Q.setFromAxisAngle(UP, p.heading), S.setScalar(p.scale));
      const woman = p.kind >= 2;
      P.torso.setMatrixAt(i, ROOT);
      P.head.setMatrixAt(i, ROOT);
      P.hair.setMatrixAt(i, woman ? ZERO : ROOT);
      P.longHair.setMatrixAt(i, woman ? ROOT : ZERO);
      P.drape.setMatrixAt(i, woman ? ROOT : ZERO);
      if (p.skirt) P.skirt.setMatrixAt(i, M.copy(ROOT).multiply(L.makeTranslation(0, BODY.hipY + 0.04, 0)).scale(V.set(1, p.skirt, 1)));
      else P.skirt.setMatrixAt(i, ZERO);
      const legSwing = p.kind === 3 ? swing * 0.45 : swing; // short steps in a sari
      for (const s of [0, 1]) {
        const sign = s ? 1 : -1, k = i * 2 + s;
        // leg: thigh swings from the hip, the knee flexes as the leg comes through
        M.copy(ROOT).multiply(L.makeTranslation(sign * BODY.hipX, BODY.hipY, 0)).multiply(R.makeRotationX(legSwing * sign));
        P.thigh.setMatrixAt(k, M);
        const knee = 0.9 * Math.max(0, sign * Math.cos(p.phase)) * p.moving * (p.kind === 3 ? 0.45 : 1);
        M.multiply(L.makeTranslation(0, -BODY.thigh, 0)).multiply(R.makeRotationX(-knee));
        P.shin.setMatrixAt(k, M);
        P.feet.setMatrixAt(k, M);
        // arm: swings opposite to the leg, elbow bent a little more as the hand comes forward
        const armA = -swing * 0.75 * sign;
        M.copy(ROOT).multiply(L.makeTranslation(sign * BODY.shoulderX, BODY.shoulderY, 0)).multiply(R.makeRotationX(armA));
        P.sleeve.setMatrixAt(k, M);
        const flex = 0.18 + 0.55 * Math.max(0, armA / 0.42) * p.moving;
        M.multiply(L.makeTranslation(0, -BODY.upperArm, 0)).multiply(R.makeRotationX(flex));
        P.forearm.setMatrixAt(k, M);
        P.hand.setMatrixAt(k, M);
      }
    }
    for (const m of Object.values(P)) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion();
const ROOT = new THREE.Matrix4(), M = new THREE.Matrix4(), L = new THREE.Matrix4(), R = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Body parts in model space: 1.8 m tall at scale 1, facing -Z, limbs hanging from their pivot at the origin. */
function geometries() {
  return {
    thigh: thighGeo(), shin: shinGeo(), feet: footGeo(), torso: torsoGeo(), skirt: skirtGeo(), drape: drapeGeo(),
    sleeve: upperArmGeo(), forearm: forearmGeo(), hand: handGeo(), head: headGeo(), hair: shortHairGeo(), longHair: longHairGeo(),
  };
}

/**
 * Face for the head loft, painted in greys so the per-person skin colour tints it (multiply).
 * The face sits at u = 0.75; the corner at (0.02, 0.98) must stay white (the nose, ears and neck sample it).
 */
export function faceTexture(): THREE.CanvasTexture {
  const W = 512, H = 256, cx = W * 0.75;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const y = (worldY: number) => (1 - (worldY - HEAD.y0) / (HEAD.y1 - HEAD.y0)) * H;
  const blob = (x: number, py: number, rx: number, ry: number, rgba: string, fade = 0) => {
    g.save();
    g.translate(x, py);
    g.scale(rx, ry);
    const r = g.createRadialGradient(0, 0, fade, 0, 0, 1);
    r.addColorStop(0, rgba);
    r.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = r;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  for (const s of [-1, 1]) {
    const ex = cx + s * 30, ey = y(1.68);
    blob(ex, ey + 1, 22, 11, 'rgba(90,60,50,.35)');              // eye socket shadow
    g.fillStyle = 'rgba(25,18,16,.95)';                           // eye
    g.beginPath();
    g.ellipse(ex, ey, 11, 4.6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(30,20,16,.9)';                          // upper lid
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(ex, ey - 0.5, 12, 5.4, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.strokeStyle = 'rgba(25,18,15,.8)';                          // brow
    g.lineWidth = 4.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex - s * 14, y(1.704));
    g.quadraticCurveTo(ex, y(1.715), ex + s * 15, y(1.699));
    g.stroke();
    blob(cx + s * 38, y(1.625), 22, 18, 'rgba(160,90,80,.3)');   // cheek
  }
  blob(cx, y(1.64), 7, 12, 'rgba(110,70,60,.28)');                // nose shadow
  g.fillStyle = 'rgba(95,40,38,.85)';                             // lips
  g.beginPath();
  g.ellipse(cx, y(1.597), 18, 4.5, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(40,15,15,.9)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(cx - 17, y(1.597));
  g.lineTo(cx + 17, y(1.597));
  g.stroke();
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 14, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
