import * as THREE from 'three';
import { hash2 } from './types';

/*
 What a street lamp does to the road at night: a pool of warm (or cool) light under it (no reflections: the road is dry
 and dusty). Instanced quads, additive; only the lamps near the camera are drawn.
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

const MAX = 90, RANGE = 140;

export class LampPools {
  readonly group = new THREE.Group();
  private pools: THREE.InstancedMesh;
  private lamps: { x: number; z: number; c: THREE.Color }[];

  constructor(lamps: [number, number][]) {
    this.lamps = lamps.map(([x, z]) => ({ x, z, c: new THREE.Color(lampColor(x, z)) }));
    const mat = (map: THREE.Texture, s: number) => new THREE.MeshBasicMaterial({
      map, color: new THREE.Color(s, s, s), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true,
    });
    const flat = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(flat(), mat(radial(), 0.5), MAX);
    for (const m of [this.pools]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.renderOrder = 2;
      m.count = 0;
      this.group.add(m);
    }
  }

  update(cx: number, cz: number): void {
    let n = 0;
    const M = new THREE.Matrix4(), V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion();
    for (const l of this.lamps) {
      const dx = cx - l.x, dz = cz - l.z, d = Math.hypot(dx, dz);
      if (d > RANGE || n >= MAX) continue;
      this.pools.setMatrixAt(n, M.compose(V.set(l.x, 0.09, l.z), Q.identity(), S.set(15, 1, 15)));
      this.pools.setColorAt(n, l.c);
      n++;
    }
    this.pools.count = n;
    for (const m of [this.pools]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
