import * as THREE from 'three';
import { NIGHT } from './night';

/**
 * Smoke from a damaged engine: soft round puffs (one THREE.Points, one draw) that rise, drift, grow and fade.
 * `emit` adds one at a point with a shade (0 black .. 1 light grey); `update` moves them all.
 */
export class Smoke {
  readonly points: THREE.Points;
  private readonly n = 220;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private shade: Float32Array;
  private next = 0;

  constructor() {
    const n = this.n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1e9);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.shade = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('shade', new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uLight: { value: NIGHT ? 0.32 : 1 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute float shade;
        varying float vAlpha; varying float vShade;
        void main() {
          vAlpha = alpha; vShade = shade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * 620.0 / max(0.5, -mv.z);
        }`,
      fragmentShader: `
        uniform float uLight;
        varying float vAlpha; varying float vShade;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p) * 2.0;
          // a soft blob, a little lumpy
          float a = smoothstep(1.0, 0.25, d) * (0.75 + 0.25 * sin(p.x * 19.0 + p.y * 13.0) * cos(p.y * 9.0 - p.x * 7.0));
          if (a * vAlpha < 0.01) discard;
          vec3 c = vec3(mix(0.06, 0.62, vShade)) * uLight;
          gl_FragColor = vec4(c, a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  emit(x: number, y: number, z: number, shade: number, vx = 0, vz = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([x + (Math.random() - 0.5) * 0.2, y, z + (Math.random() - 0.5) * 0.2], i * 3);
    this.vel.set([vx * 0.3 + (Math.random() - 0.5) * 0.4, 0.7 + Math.random() * 0.5, vz * 0.3 + (Math.random() - 0.5) * 0.4], i * 3);
    this.age[i] = 0;
    this.life[i] = 1.8 + Math.random() * 1.2;
    this.shade[i] = shade;
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const t = (this.age[i] += dt) / this.life[i];
      if (t >= 1) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      alive++;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      this.vel[i * 3] *= 1 - dt * 0.8;
      this.vel[i * 3 + 2] *= 1 - dt * 0.8;
      this.size[i] = 0.3 + t * 1.3;
      this.alpha[i] = 0.5 * Math.min(1, t * 6) * (1 - t) ** 1.5;
    }
    this.points.visible = alive > 0;
    if (!alive) return;
    const g = this.points.geometry;
    for (const a of ['position', 'size', 'alpha', 'shade']) g.getAttribute(a).needsUpdate = true;
  }
}
