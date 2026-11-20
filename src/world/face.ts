import * as THREE from 'three';

/*
 Faces that talk and blink. The rigged people (and Ramu) carry two shape keys, built into their files by
 tools/blender/build_ramu_rig.py: `mouth_open` (the lower lip and chin drop, the corners stay shut), `blink` (the upper
 lid slides down over the painted eye) and `angry` (brows down and together, lids narrowed, the mouth's corners down), and the landmarks they were made from (the mesh's extras: `face`).
 A Face drives them, and only when switched on: `talking` (syllables, now open, now shut, with pauses), `laughing` (wide
 and quick), `blinking` (every few seconds), `angry` (0..1: how much of a scowl, eased to). Off, the face rests and costs nothing.
 faceMaterial() darkens the parted lips in the shader (some faces have no dark line between the lips to stretch open).
*/

interface Marks { mouth: [number, number, number]; mhw: number; eyes: [number, number][]; ehw: number }

const smooth = (a: number, b: number, x: number) => (x <= a ? 0 : x >= b ? 1 : ((x - a) / (b - a)) ** 2 * (3 - 2 * ((x - a) / (b - a))));

/**
 * The share of the mouth's darkness at each vertex (1 on the line where the lips meet, in the middle of the mouth),
 * as the attribute `faceDark`, from the landmarks; once per geometry (clones share it).
 */
export function prepareFace(mesh: THREE.Mesh): void {
  const g = mesh.geometry, m = mesh.userData.face as Marks | undefined;
  if (!m || g.getAttribute('faceDark')) return;
  const pos = g.getAttribute('position'), out = new Float32Array(pos.count);
  const [mx, my, front] = m.mouth;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (z < front || Math.abs(y - my) > 0.02) continue;
    const lat = 1 - smooth(m.mhw * 0.15, m.mhw * 1.05, Math.abs(x - mx));
    out[i] = lat * Math.exp(-(((y - my) / 0.0045) ** 2));
  }
  g.setAttribute('faceDark', new THREE.BufferAttribute(out, 1));
}

/** The material's shader darkens the parted lips (by the mouth's opening, the first shape key). Once per material. */
const patched = new WeakSet<THREE.Material>();      // (not userData: a clone copies that, but not the shader hook)
const f = (n: number) => n.toFixed(5);
export function faceMaterial(mat: THREE.Material, m: Marks): void {
  if (patched.has(mat)) return;
  patched.add(mat);
  // the painted eyes (in the mesh's own space, so the mask rides with the lids as they blink): ellipses round each
  const eyes = m.eyes.map(([x, y]) => `max( e, 1.0 - smoothstep( 0.7, 1.0, length( vec2( ( p.x - ${f(x)} ) / ${f(m.ehw * 0.9)}, ( p.y - ${f(y)} ) / ${f(m.ehw * 0.45)} ) ) ) )`);
  const eyeMask = `float eyeMask( vec3 p ) {
  if ( p.z < ${f(m.mouth[2] - 0.05)} ) return 0.0;
  float e = 0.0;
  ${eyes.map((s) => `e = ${s};`).join('\n  ')}
  return e;
}`;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float faceDark;\nvarying float vFaceDark;\nvarying float vOpen;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vRest = position;
  vFaceDark = faceDark;
#if defined( USE_MORPHTARGETS ) && !defined( USE_INSTANCING_MORPH )
  vOpen = morphTargetInfluences[ 0 ];
#else
  vOpen = 0.0;
#endif`);
    // the inside of the open mouth: near black (a solid band where the lips part, not a smudge), and matt
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vFaceDark;
varying float vOpen;
varying vec3 vRest;
float mouthDark() { return smoothstep( 0.04, 0.3, vFaceDark ) * smoothstep( 0.02, 0.18, vOpen ); }
${eyeMask}`)
      // the eyes: the painted texture is soft and greyed; more contrast (dark iris and pupil, clearer white), a little colour, and wet
      .replace('#include <map_fragment>', `#include <map_fragment>
  float faceE = eyeMask( vRest );
  if ( faceE > 0.0 ) {
    vec3 g = pow( max( diffuseColor.rgb, 0.0 ), vec3( 1.0 / 2.2 ) );
    float l = dot( g, vec3( 0.299, 0.587, 0.114 ) );
    vec3 c = mix( vec3( l ), g, 0.85 );
    c = clamp( ( c - 0.45 ) * 1.5 + 0.5, 0.0, 1.0 );
    c *= mix( 1.0, 0.75, smoothstep( 0.45, 0.2, l ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, pow( c, vec3( 2.2 ) ), faceE );
  }
  float faceD = mouthDark();
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.025, 0.01, 0.01 ), faceD );`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix( roughnessFactor, 0.22, faceE );\n  roughnessFactor = mix( roughnessFactor, 1.0, faceD );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= 1.0 - faceD;');
  };
  const key = mat.customProgramCacheKey.bind(mat);
  const marks = m.eyes.flat().map(f).join(',');
  mat.customProgramCacheKey = () => key() + '|face' + marks;
  mat.needsUpdate = true;
}

export class Face {
  /** say things: the mouth opens and shuts in syllables, with pauses between words */
  talking = false;
  /** laugh: the mouth wide, in quick bursts */
  laughing = false;
  /** blink every few seconds */
  blinking = false;
  /** a scowl, 0..1 (eased to over a quarter second or so) */
  angry = 0;
  private mesh: THREE.Mesh | null = null;
  private iMouth = -1;
  private iBlink = -1;
  private iAngry = -1;
  private scowl = 0;
  private open = 0;
  private target = 0;
  private next = 0;
  private lid = 0;          // time left in the blink under way
  private nextBlink = 1 + Math.random() * 3;

  /** the face of whoever's model this is (nothing happens if it has none) */
  constructor(model: THREE.Object3D) {
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (this.mesh || !m.isMesh || !m.morphTargetDictionary || !m.morphTargetInfluences) return;
      const d = m.morphTargetDictionary;
      if (d.mouth_open === undefined) return;
      this.mesh = m;
      this.iMouth = d.mouth_open;
      if (this.iMouth !== 0) console.warn('face: the shader expects mouth_open as the first shape key');
      this.iBlink = d.blink ?? -1;
      this.iAngry = d.angry ?? -1;
      m.morphTargetInfluences.fill(0);       // at rest: the files carry their keys' weights as 1 (the glTF's default weights)
      prepareFace(m);
      const marks = m.userData.face as Marks | undefined;
      if (marks) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) faceMaterial(mat, marks);
    });
  }

  get has(): boolean { return this.mesh !== null; }

  update(dt: number): void {
    const inf = this.mesh?.morphTargetInfluences;
    if (!inf) return;
    // the mouth
    if (this.talking || this.laughing) {
      this.next -= dt;
      if (this.next <= 0) {
        const r = Math.random();
        if (this.laughing) { this.target = this.target > 0.5 ? 0.35 + r * 0.15 : 0.8 + r * 0.2; this.next = 0.09 + Math.random() * 0.06; }
        else if (r < 0.16) { this.target = 0; this.next = 0.18 + Math.random() * 0.35; }       // between words
        else { this.target = this.target > 0.25 ? 0.05 + r * 0.15 : 0.35 + r * 0.6; this.next = 0.07 + Math.random() * 0.11; }
      }
    } else this.target = 0;
    if (this.open === 0 && this.target === 0) { /* resting */ }
    else {
      this.open += (this.target - this.open) * Math.min(1, dt * 22);
      if (this.target === 0 && this.open < 0.01) this.open = 0;
    }
    inf[this.iMouth] = this.open;
    if (this.iAngry >= 0 && (this.scowl !== this.angry)) {
      this.scowl += (this.angry - this.scowl) * Math.min(1, dt * 9);
      if (Math.abs(this.angry - this.scowl) < 0.005) this.scowl = this.angry;
      inf[this.iAngry] = this.scowl;
    }
    // the eyes
    if (this.iBlink < 0) return;
    if (this.blinking) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0 && this.lid <= 0) {
        this.lid = 0.17;
        this.nextBlink = Math.random() < 0.15 ? 0.3 : 2 + Math.random() * 4;          // now and then twice in a row
      }
    }
    if (this.lid > 0) {
      this.lid = Math.max(0, this.lid - dt);
      inf[this.iBlink] = Math.sin((1 - this.lid / 0.17) * Math.PI);
    } else inf[this.iBlink] = 0;
  }
}
