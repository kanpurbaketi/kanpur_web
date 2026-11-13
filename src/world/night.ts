import * as THREE from 'three';

/*
 Night-time support:
   NIGHT            true unless ?time=day
   nightUniform     0 / 1, read by the facade shader (lit windows, backlit shop signs)
   LightPool        a few real point lights that hop to whichever street lamp / mela light is nearest the camera
   halos()          additive round glow sprites (THREE.Points) for lamps and bulbs; everything else is emissive
*/

export const NIGHT = new URLSearchParams(location.search).get('time') !== 'day';
export const nightUniform = { value: NIGHT ? 1 : 0 };

export interface LightSource { x: number; y: number; z: number; color: THREE.Color; intensity: number; range: number }

export class LightPool {
  readonly sources: LightSource[] = [];
  private lights: THREE.PointLight[] = [];
  private assigned: (LightSource | null)[] = [];
  private tick = 0;

  constructor(scene: THREE.Scene, n: number) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight('#ffdca0', 0, 30, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
      this.assigned.push(null);
    }
  }

  add(x: number, y: number, z: number, color: string, intensity: number, range = 30): void {
    this.sources.push({ x, y, z, color: new THREE.Color(color), intensity, range });
  }

  /** Re-pick the nearest sources a few times a second; lights whose source stays in the set are left alone. */
  update(cx: number, cz: number, force = false): void {
    if (!force && this.tick++ % 8) return;
    const scored = this.sources.map((s) => ({ s, d: (s.x - cx) ** 2 + (s.z - cz) ** 2 }));
    scored.sort((a, b) => a.d - b.d);
    const top = scored.slice(0, this.lights.length).map((e) => e.s);
    const free: number[] = [];
    this.assigned.forEach((s, i) => { if (!s || !top.includes(s)) free.push(i); });
    const fresh = top.filter((s) => !this.assigned.includes(s));
    fresh.forEach((s, k) => {
      const i = free[k];
      if (i === undefined) return;
      this.assigned[i] = s;
      const l = this.lights[i];
      l.position.set(s.x, s.y, s.z);
      l.color.copy(s.color);
      l.intensity = s.intensity;
      l.distance = s.range;
    });
    free.slice(fresh.length).forEach((i) => { this.assigned[i] = null; this.lights[i].intensity = 0; });
  }
}

let spriteTex: THREE.CanvasTexture | null = null;
function sprite(): THREE.CanvasTexture {
  if (spriteTex) return spriteTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.06, 'rgba(255,255,255,0.8)');
  r.addColorStop(0.16, 'rgba(255,255,255,0.3)');
  r.addColorStop(0.36, 'rgba(255,255,255,0.075)');
  r.addColorStop(0.7, 'rgba(255,255,255,0.015)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  spriteTex = new THREE.CanvasTexture(c);
  spriteTex.colorSpace = THREE.SRGBColorSpace;
  return spriteTex;
}

/**
 * A headlight beam as it lands on the road (or a wall): a soft egg-shaped pool, brightest next to the lamp, widening and
 * fading away from it. On a quad lying flat, the bright end is its -z end (so a vehicle that faces +z puts the quad ahead).
 */
let beamTex: THREE.CanvasTexture | null = null;
export function beamTexture(): THREE.CanvasTexture {
  if (beamTex) return beamTex;
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);                         // 0 at the lamp, 1 at the far edge of the pool
    const half = 0.34 + 0.66 * Math.sqrt(t);       // the beam widens away from the lamp
    const along = Math.pow(1 - t, 1.35) * sm(0, 0.05, t) * (0.55 + 0.45 * (1 - sm(0.4, 1, t)));
    for (let x = 0; x < W; x++) {
      const s = Math.abs((x / (W - 1)) * 2 - 1) / half;
      const across = 1 - sm(0.35, 1, s);
      const v = Math.round(255 * Math.max(0, Math.min(1, along * across * (0.55 + 0.45 * (1 - s * s)))));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  beamTex = new THREE.CanvasTexture(c);
  beamTex.colorSpace = THREE.NoColorSpace;
  return beamTex;
}

/** Additive material for beam pools. `strength` ~0.5 is a car headlight at night. */
export function beamMaterial(strength = 0.55, tint = '#ffe7bd'): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    map: beamTexture(), color: new THREE.Color(tint).multiplyScalar(strength), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  return m;
}

/** Shared view/time uniforms for glow materials (set by `updateGlow` each frame). */
export const glowUniforms = { time: { value: 0 }, scale: { value: 600 } };

export function updateGlow(dt: number, camera: THREE.PerspectiveCamera, heightPx: number): void {
  glowUniforms.time.value += dt;
  glowUniforms.scale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

/**
 * Glow sprites: one point per light. `size` is the sprite diameter in metres; `phase` (0..1, or -1 for steady) makes the
 * point pulse in a chase pattern. Returns a THREE.Points to add to the scene (or to a moving group).
 */
export function halos(pts: { x: number; y: number; z: number; color: THREE.Color; size: number; phase?: number }[],
                      strength = 0.8): THREE.Points {
  const pos: number[] = [], col: number[] = [], size: number[] = [], ph: number[] = [];
  for (const p of pts) {
    pos.push(p.x, p.y, p.z);
    col.push(p.color.r, p.color.g, p.color.b);
    size.push(p.size);
    ph.push(p.phase ?? -1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('phase', new THREE.Float32BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { map: { value: sprite() }, time: glowUniforms.time, scale: glowUniforms.scale, strength: { value: strength } },
    vertexShader: `attribute float size; attribute float phase; attribute vec3 color;
uniform float time, scale;
varying vec3 vCol;
void main() {
  float pulse = phase < 0.0 ? 1.0 : 0.35 + 0.65 * step(0.5, fract(time * 1.3 - phase));
  vCol = color * pulse;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / max(0.1, -mv.z), 2.0, 80.0);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform sampler2D map; uniform float strength;
varying vec3 vCol;
void main() {
  float a = texture2D(map, gl_PointCoord).r;
  gl_FragColor = vec4(vCol * a * strength, 1.0);
}`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.userData.noAO = true;
  return p;
}
