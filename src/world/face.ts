import * as THREE from 'three';

/*
 Faces that talk and blink. The rigged people (and Ramu) carry two shape keys, built into their files by
 tools/blender/build_ramu_rig.py: `mouth_open` (the lower lip and chin drop, the corners stay shut), `blink` (the upper
 lid slides down over the painted eye) and `angry` (brows down and together, lids narrowed, the mouth's corners down), and the landmarks they were made from (the mesh's extras: `face`).
 A Face drives them, and only when switched on: `talking` (syllables, now open, now shut, with pauses), `laughing` (wide
 and quick), `blinking` (every few seconds), `angry` (0..1: how much of a scowl, eased to). Off, the face rests and costs nothing.
 faceMaterial() darkens the parted lips in the shader (some faces have no dark line between the lips to stretch open),
 and sharpens the face: the body's texture is the source's cut down (its eyes, nose and lips soft), so the front of the
 face also has a texture of its own at the source's full detail, its features drawn clearer (models/faces/<name>.jpg,
 on a second UV map), and the shader draws the face with that, coloured to the body's texture (a look's darker skin
 carries over). Where a look painted over the face (a beard, no moustache) the body's texture is kept.
*/

interface Marks {
  mouth: [number, number, number]; mhw: number; eyes: [number, number][]; ehw: number;
  /** the face's own texture (under models/), and how many mip levels finer it is than the body's there */
  tex?: string; bias?: number;
}

const faceTextures = new Map<string, THREE.Texture>();
/** the texture of a face, loaded once; `ready` set when it is there (the shader leaves it alone until then) */
function faceTexture(url: string, ready: { value: number }): THREE.Texture {
  let t = faceTextures.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url, () => { t!.userData.ok = true; for (const r of t!.userData.waiting as { value: number }[]) r.value = 1; });
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;                           // glTF's UVs
    t.anisotropy = 8;
    t.userData.waiting = [];
    faceTextures.set(url, t);
  }
  if (t.userData.ok) ready.value = 1;
  else (t.userData.waiting as { value: number }[]).push(ready);
  return t;
}

const smooth = (a: number, b: number, x: number) => (x <= a ? 0 : x >= b ? 1 : ((x - a) / (b - a)) ** 2 * (3 - 2 * ((x - a) / (b - a))));

/**
 * The share of the mouth's darkness at each vertex (1 on the line where the lips meet, in the middle of the mouth),
 * as the attribute `faceDark`, from the landmarks; once per geometry (clones share it).
 */
export function prepareFace(mesh: THREE.Mesh): void {
  const g = mesh.geometry, m = mesh.userData.face as Marks | undefined;
  if (!m || g.getAttribute('faceDark')) return;
  // the face's UVs (TEXCOORD_1), under a name of their own (three's own uv1 is declared only when a map uses it)
  const uv1 = g.getAttribute('uv1');
  if (uv1) g.setAttribute('faceUv', uv1);
  const pos = g.getAttribute('position'), out = new Float32Array(pos.count);
  const [mx, my, front] = m.mouth;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (z < front || Math.abs(y - my) > 0.02) continue;
    const lat = 1 - smooth(m.mhw * 0.15, m.mhw * 1.05, Math.abs(x - mx));
    out[i] = lat * Math.exp(-(((y - my) / 0.0045) ** 2));
  }
  g.setAttribute('faceDark', new THREE.BufferAttribute(out, 1));
  // how far down the lower lip goes at full opening, along the mouth (the mouth_open key: the first morph target), at
  // each vertex's x: across the gap the shader reads where between the lips it is (0 the upper, 1 the lower) from how
  // far down the point has gone over that
  const key = g.morphAttributes.position?.[0];
  const drop = new Float32Array(pos.count), line = new Float32Array(pos.count).fill(my);
  if (key) {
    const N = 24, bins = new Float32Array(N), w = m.mhw * 1.1, lineY = new Float32Array(N), lineN = new Float32Array(N);
    const bin = (x: number) => Math.max(0, Math.min(N - 1, Math.round(((x - mx) / w * 0.5 + 0.5) * (N - 1))));
    for (let i = 0; i < pos.count; i++) {
      if (out[i] < 0.6) continue;                     // (the lips' inner edges only: the chin below them goes further)
      const dy = g.morphTargetsRelative ? key.getY(i) : key.getY(i) - pos.getY(i);
      const b = bin(pos.getX(i));
      bins[b] = Math.min(bins[b], dy);
      lineY[b] += pos.getY(i); lineN[b]++;
    }
    for (let b = 0; b < N; b++) lineY[b] = lineN[b] ? lineY[b] / lineN[b] : my;
    for (let i = 0; i < pos.count; i++) { const b = bin(pos.getX(i)); drop[i] = -bins[b]; line[i] = lineY[b]; }
  }
  g.setAttribute('faceDrop', new THREE.BufferAttribute(drop, 1));
  g.setAttribute('faceLine', new THREE.BufferAttribute(line, 1));
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
  const sharp = !!m.tex;
  const ready = { value: 0 };
  const faceMap = sharp ? faceTexture(`models/${m.tex}`, ready) : null;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    if (sharp) Object.assign(sh.uniforms, { faceMap: { value: faceMap }, faceOn: ready });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float faceDark;\nattribute float faceDrop;\nattribute float faceLine;\nvarying float vFaceDark;\nvarying float vOpen;\nvarying vec3 vRest;\nvarying float vDown;\nvarying float vDrop;${sharp ? '\nattribute vec2 faceUv;\nvarying vec2 vFaceUv;' : ''}`)
      .replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
  vDown = faceLine - transformed.y;          // (below where the lips meet here, now)
  vDrop = faceDrop;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vRest = position;
  vFaceDark = faceDark;${sharp ? '\n  vFaceUv = faceUv;' : ''}
#if defined( USE_MORPHTARGETS ) && !defined( USE_INSTANCING_MORPH )
  vOpen = morphTargetInfluences[ 0 ];
#else
  vOpen = 0.0;
#endif`);
    // the inside of the open mouth: only the gap where the lips part (the lips keep their colour), a dark red-brown,
    // deepest in its middle, lighter toward the lips (no teeth: drawn on these faces they followed the mesh's triangles,
    // jagged). Matt
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vFaceDark;
varying float vOpen;
varying vec3 vRest;
varying float vDown;
varying float vDrop;
// (vFaceDark is 1 on the line where the lips meet, falling off over the lips: the wider open, the more of it is gap)
// how far out the teeth go from the mouth's middle, of its half width
const float TEETH_W = 0.36;
float mouthEdge() { return smoothstep( mix( 0.6, 0.35, vOpen ), mix( 0.85, 0.65, vOpen ), vFaceDark ); }
float mouthDark() { return mouthEdge() * smoothstep( 0.03, 0.2, vOpen ); }
vec3 mouthColour() {
  float deep = smoothstep( 0.8, 1.0, vFaceDark );
  vec3 c = mix( vec3( 0.16, 0.045, 0.04 ), vec3( 0.035, 0.009, 0.008 ), deep );
  // the teeth, a thin white line along the top of the opening and one along the bottom. Above where the lips met
  // (t < 0) the opening ends where the dark comes in (its soft edge: the upper teeth along it); below, t is how far down
  // of the lower lip's drop here a point now is (1 at the lower lip: the lower teeth just over it)
  float t = vDown / max( vDrop * vOpen, 1e-5 );
  float e = mouthEdge();
  float top = ( 1.0 - step( 0.0, t ) ) * ( 1.0 - smoothstep( 0.62, 0.88, e ) );
  float bottom = smoothstep( 0.74, 0.84, t );
  // (both only across the middle of the mouth, fading well before its corners: two lines, never a ring round the opening)
  float side = abs( vRest.x - ${f(m.mouth[0])} ) / ${f(m.mhw)};
  float teeth = max( top, bottom * 0.9 ) * smoothstep( 0.12, 0.3, vOpen ) * ( 1.0 - smoothstep( TEETH_W - 0.14, TEETH_W, side ) );
  return mix( c, vec3( 0.72, 0.68, 0.61 ), teeth );
}
${eyeMask}`)
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>${sharp ? `
uniform sampler2D faceMap;
uniform float faceOn;
varying vec2 vFaceUv;
// the face from its own texture, coloured to the body's: the two compared blurred well past the features, so a look's
// skin tone carries over; and where a look repainted the face (a beard, a shave), its colour is not what the face
// texture blurs to at the body's detail: the body's kept there
const float FACE_BIAS = ${f(m.bias ?? 2)};
float lodOf( vec2 uv, sampler2D t ) {
  vec2 tc = uv * vec2( textureSize( t, 0 ) );
  return log2( max( max( length( dFdx( tc ) ), length( dFdy( tc ) ) ), 1e-6 ) );
}
vec3 faceDetail( vec3 base ) {
  if ( faceOn < 0.5 || vFaceUv.x < -0.5 ) return base;
  vec3 hi = texture( faceMap, vFaceUv ).rgb;
  vec3 lo = textureLod( faceMap, vFaceUv, max( lodOf( vFaceUv, faceMap ), FACE_BIAS ) ).rgb;
  float same = 1.0 - smoothstep( 0.05, 0.14, length( sqrt( max( lo, 0.0 ) ) - sqrt( max( base, 0.0 ) ) ) );
  vec3 tint = vec3( 1.0 );
#ifdef USE_MAP
  float L = max( lodOf( vMapUv, map ), 0.0 ) + 1.5;
  tint = clamp( textureLod( map, vMapUv, L ).rgb / max( textureLod( faceMap, vFaceUv, L + FACE_BIAS ).rgb, vec3( 0.003 ) ), 0.5, 2.0 );
#endif
  return mix( base, hi * tint, same );
}` : ''}`)
      // the eyes: the painted texture is soft and greyed; more contrast (dark iris and pupil, clearer white), a little colour, and wet
      .replace('#include <map_fragment>', `#include <map_fragment>${sharp ? '\n  diffuseColor.rgb = faceDetail( diffuseColor.rgb );' : ''}
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
  diffuseColor.rgb = mix( diffuseColor.rgb, mouthColour(), faceD );`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix( roughnessFactor, 0.22, faceE );\n  roughnessFactor = mix( roughnessFactor, 1.0, faceD );')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= 1.0 - faceD;');
  };
  const key = mat.customProgramCacheKey.bind(mat);
  const marks = m.eyes.flat().map(f).join(',');
  mat.customProgramCacheKey = () => key() + '|face4' + marks + f(m.mouth[0]) + f(m.mhw) + (m.tex ?? '');
  mat.needsUpdate = true;
}

/** talking, the mouth's key taken this far past its own full opening at most (it was made shallow: whispering) */
const MOUTH_GAIN = 1.5;

export class Face {
  /** say things: the mouth opens and shuts in syllables, with pauses between words */
  talking = false;
  /** laugh: the mouth wide, in quick bursts */
  laughing = false;
  /** blink every few seconds */
  blinking = false;
  /** a scowl, 0..1 (eased to over a quarter second or so) */
  angry = 0;
  /** a smile, 0..1 (eased to); only the faces built with a `smile` key */
  smile = 0;
  /** the eyes shut, 0..1 (eased to, slowly: the lids sink); held over any blink */
  shut = 0;
  private mesh: THREE.Mesh | null = null;
  private iMouth = -1;
  private iBlink = -1;
  private iAngry = -1;
  private iSmile = -1;
  private scowl = 0;
  private grin = 0;
  private lids = 0;
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
      this.iSmile = d.smile ?? -1;
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
        else if (r < 0.14) { this.target = 0; this.next = 0.18 + Math.random() * 0.35; }       // between words
        // syllables: mostly half open (30-60%), now and then a wide vowel (70-85%), the lips not quite meeting between
        else if (this.target > 0.2) { this.target = 0.05 + Math.random() * 0.08; this.next = 0.06 + Math.random() * 0.06; }
        else { this.target = r > 0.85 ? 0.7 + Math.random() * 0.15 : 0.3 + Math.random() * 0.3; this.next = 0.09 + Math.random() * 0.1; }
      }
    } else this.target = 0;
    if (this.open === 0 && this.target === 0) { /* resting */ }
    else {
      this.open += (this.target - this.open) * Math.min(1, dt * (this.laughing ? 22 : 15));   // (eased: the lips do not snap)
      if (this.target === 0 && this.open < 0.01) this.open = 0;
    }
    inf[this.iMouth] = this.open * (this.laughing ? 1 : MOUTH_GAIN);   // (the key itself opens only a little: talking takes it past its full)
    if (this.iAngry >= 0 && (this.scowl !== this.angry)) {
      this.scowl += (this.angry - this.scowl) * Math.min(1, dt * 9);
      if (Math.abs(this.angry - this.scowl) < 0.005) this.scowl = this.angry;
      inf[this.iAngry] = this.scowl;
    }
    if (this.iSmile >= 0 && (this.grin !== this.smile)) {
      this.grin += (this.smile - this.grin) * Math.min(1, dt * 4);
      if (Math.abs(this.smile - this.grin) < 0.005) this.grin = this.smile;
      inf[this.iSmile] = this.grin;
    }
    // the eyes
    if (this.iBlink < 0) return;
    if (this.lids !== this.shut) {
      this.lids += (this.shut - this.lids) * Math.min(1, dt * 1.6);
      if (Math.abs(this.shut - this.lids) < 0.005) this.lids = this.shut;
    }
    if (this.blinking) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0 && this.lid <= 0) {
        this.lid = 0.17;
        this.nextBlink = Math.random() < 0.15 ? 0.3 : 2 + Math.random() * 4;          // now and then twice in a row
      }
    }
    if (this.lid > 0) {
      this.lid = Math.max(0, this.lid - dt);
      inf[this.iBlink] = Math.max(this.lids, Math.sin((1 - this.lid / 0.17) * Math.PI));
    } else inf[this.iBlink] = this.lids;
  }
}
