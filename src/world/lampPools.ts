import * as THREE from 'three';
import { hash2 } from './types';

/*
 What a street lamp does to the road at night: a pool of warm (or cool) light under it, and on the wet asphalt a bright streak
 that points back at the camera, the way a lamp reflects in a puddle. Instanced quads, additive; only the lamps near the camera are drawn.
 Lamps differ in colour (sodium orange, warm white, cool LED), which is what gives a night street its mixed colours.
*/

export function lampColor(x: number, z: number): string {
  const h = hash2(Math.round(x), Math.round(z));
  return h < 0.5 ? '#ffb15a' : h < 0.78 ? '#ffe0a8' : '#bfd8ff';
}

function radial(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  r.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function streak(): THREE.CanvasTexture {
  const W = 32, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / (H - 1);                                  // 0 at the lamp, 1 far toward the viewer
    const across = Math.exp(-Math.pow((x / (W - 1) - 0.5) * 2 * (1.2 + 1.6 * t), 2) * 3.2);
    const along = Math.pow(1 - t, 1.6) * Math.min(1, t * 14);
    const v = Math.round(255 * across * along);
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

const MAX = 90, RANGE = 140;

export class LampPools {
  readonly group = new THREE.Group();
  private pools: THREE.InstancedMesh;
  private streaks: THREE.InstancedMesh;
  private lamps: { x: number; z: number; c: THREE.Color }[];

  constructor(lamps: [number, number][]) {
    this.lamps = lamps.map(([x, z]) => ({ x, z, c: new THREE.Color(lampColor(x, z)) }));
    const mat = (map: THREE.Texture, s: number) => new THREE.MeshBasicMaterial({
      map, color: new THREE.Color(s, s, s), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true,
    });
    const flat = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(flat(), mat(radial(), 0.5), MAX);
    this.streaks = new THREE.InstancedMesh(flat(), mat(streak(), 0.55), MAX);
    for (const m of [this.pools, this.streaks]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.userData.noAO = true;
      m.renderOrder = 2;
      m.count = 0;
      this.group.add(m);
    }
  }

  update(cx: number, cz: number): void {
    let n = 0;
    const M = new THREE.Matrix4(), V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
    for (const l of this.lamps) {
      const dx = cx - l.x, dz = cz - l.z, d = Math.hypot(dx, dz);
      if (d > RANGE || n >= MAX) continue;
      this.pools.setMatrixAt(n, M.compose(V.set(l.x, 0.09, l.z), Q.identity(), S.set(15, 1, 15)));
      this.pools.setColorAt(n, l.c);
      const len = Math.min(11, 3 + d * 0.2);                // the streak points at the camera and grows with the distance
      Q.setFromAxisAngle(UP, Math.atan2(dx, dz));
      const ux = dx / (d || 1), uz = dz / (d || 1);
      this.streaks.setMatrixAt(n, M.compose(V.set(l.x + ux * len * 0.5, 0.1, l.z + uz * len * 0.5), Q, S.set(1.5 + d * 0.01, 1, len)));
      this.streaks.setColorAt(n, l.c);
      n++;
    }
    this.pools.count = this.streaks.count = n;
    for (const m of [this.pools, this.streaks]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
