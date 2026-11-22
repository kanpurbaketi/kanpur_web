import * as THREE from 'three';
import { gltfLoader, lookUrl } from './gltf';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Face } from './face';
import { NIGHT } from './night';

/*
 Rigged people for the crowd: photo-built models on the same skeleton as Ramu, carrying the same clips
 (tools/blender/build_ramu_rig.py --char uncle | security | college_girl | college_boy | aunty -> public/models/<name>_rig.glb). The goon is the uncle's model in dark clothes; the woman in a burqa is the aunty's.
 Each file is loaded once; every Actor is a clone that shares its geometry and material and has its own skeleton and mixer.
 One model makes several people: a "look" is another texture for the same body (no moustache, a beard, darker skin, grey
 hair, other clothes), painted by tools/people/make_variants.py into public/models/looks/. The actors of a kind take the
 looks in turn.
 Pedestrians moves them (see Pedestrians.addRigged): an Actor only knows how to stand somewhere and play a clip.
*/

export type RigName = 'uncle' | 'security' | 'goon' | 'girl' | 'boy' | 'aunty' | 'burqa' | 'kumar' | 'anchor' | 'buddha' | 'anaya';

/** height in metres (as built), used to match the walk clip's stride to the ground speed */
/** `step`: how much of the walk clip's stride they take (a sari allows short steps only) */
const RIGS: Record<RigName, { file: string; height: number; step?: number }> = {
  uncle: { file: 'models/uncle_rig.glb', height: 1.66 },
  security: { file: 'models/security_rig.glb', height: 1.72 },
  goon: { file: 'models/uncle_rig.glb', height: 1.66 },        // the uncle's body in dark clothes
  girl: { file: 'models/college_girl_rig.glb', height: 1.58 },
  boy: { file: 'models/college_boy_rig.glb', height: 1.70 },
  aunty: { file: 'models/aunty_rig.glb', height: 1.56, step: 0.55 },
  burqa: { file: 'models/aunty_rig.glb', height: 1.56, step: 0.55 },  // the aunty's body in a burqa
  kumar: { file: 'models/kumar_rig.glb', height: 1.68 },        // the young poet on the kavi sammelan's stage
  anchor: { file: 'models/anchor_rig.glb', height: 1.70 },      // the kavi sammelan's anchor, at the mic
  buddha: { file: 'models/buddha_rig.glb', height: 1.63 },      // the old poet with the white beard
  anaya: { file: 'models/anaya_rig.glb', height: 1.60 },        // the girl with the candy floss on the well's gallery
};
/** the looks of each kind: '' is the model as built, the rest are textures in models/looks/<name>.jpg (.webp when built) */
const LOOKS: Record<RigName, string[]> = {
  uncle: ['', 'uncle_b', 'uncle_c', 'uncle_d', 'uncle_e', 'uncle_f', 'uncle_g', 'uncle_h'],
  security: [''],                  // the guard keeps his blue uniform
  goon: ['goon_a', 'goon_b'],
  girl: ['', 'college_girl_b', 'college_girl_c', 'college_girl_d', 'college_girl_e', 'college_girl_f', 'college_girl_g', 'college_girl_h', 'college_girl_i', 'college_girl_j'],
  boy: ['', 'college_boy_b', 'college_boy_c', 'college_boy_d', 'college_boy_e', 'college_boy_f', 'college_boy_g', 'college_boy_h', 'college_boy_i', 'college_boy_j'],
  burqa: ['burqa_a', 'burqa_b', 'burqa_c', 'burqa_d'],
  aunty: ['', 'aunty_b', 'aunty_c', 'aunty_d', 'aunty_e', 'aunty_f', 'aunty_g', 'aunty_h', 'aunty_i', 'aunty_j'],
  kumar: [''],
  anchor: [''],
  buddha: [''],
  anaya: [''],
};
// Ramu's clips cover this much ground per second at normal playback, for his 1.52 m
const WALK_SPEED = 1.35, RUN_SPEED = 5.0, CLIP_HEIGHT = 1.52;

/** clips that play through once and hold their last pose */
export const ONCE = new Set(['punch', 'kick', 'hit', 'hit2', 'block', 'shove', 'fall', 'fall2', 'get_up', 'jump',
  'stomach', 'stomach_hit', 'push', 'push_one', 'pockets', 'head_no', 'angry_point', 'disappointed', 'throw', 'offer',
  'hang_start', 'hang_braced', 'hang_drop']);   // Ramu on the giant wheel (stage 1, part 3)   // the last row: stage 1's scenes
/** clip lengths as the game plays them, seconds at normal speed (after the cuts in prepareClips) */
export const CLIP_SECS = { punch: 2.0, kick: 1.6, hit: 1.9, hit2: 1.35, block: 1.35, shove: 1.75, get_up: 2.7 };
/** in the kick clip the foot lands this many seconds in */
export const KICK_LANDS = 0.63;
/** in the punch clip (2 s at normal speed) the fist lands this many seconds in */
export const PUNCH_LANDS = 1.1;

/**
 * The clips as the game uses them: named plainly, and the two reactions cut down to the part that matters. "Taking Punch"
 * recoils for two seconds and then stands on guard for four more; "Knocked Out" waits a second in a boxer's stance before the
 * fall begins.
 */
export function prepareClips(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  return clips.map((clip) => {
    const name = clip.name.replace(/^.*\|/, '');
    // "Shove Reaction" stands still at both ends; the stumble is in the middle
    const cut = name === 'hit' ? [0.1, 2.0] : name === 'fall' ? [1.0, clip.duration] : name === 'shove' ? [0.15, 1.9] : null;
    const out = cut ? THREE.AnimationUtils.subclip(clip, name, Math.round(cut[0] * 30), Math.round(cut[1] * 30), 30) : clip;
    out.name = name;
    return out;
  });
}

/**
 * Where a clip leaves the hips, on the ground plane, in the body's own frame (x to its left, z the way it faces is -z):
 * at the clip's end, or at its start. The fall carries the body about a metre back; the get-up clip starts from near the
 * origin. The difference is how far the model has to be moved for one to follow the other without a jump.
 */
function hipsAt(clip: THREE.AnimationClip | undefined, end: boolean): THREE.Vector3 {
  const t = clip?.tracks.find((k) => /Hips\.position$/.test(k.name));
  if (!t) return new THREE.Vector3();
  const i = end ? t.values.length - 3 : 0;
  return new THREE.Vector3(-t.values[i], 0, -t.values[i + 2]);      // the model is turned half round inside its root
}

interface Source { scene: THREE.Object3D; clips: THREE.AnimationClip[]; lie: THREE.Vector3; material: THREE.MeshStandardMaterial }
const cache = new Map<string, Promise<Source>>();     // by file: the goon is the uncle's model
const lookCache = new Map<string, Promise<THREE.MeshStandardMaterial>>();
const nextLook: Record<RigName, number> = { uncle: 0, security: 0, goon: 0, girl: 0, boy: 0, aunty: 0, burqa: 0, kumar: 0, anchor: 0, buddha: 0, anaya: 0 };

/** The model's material wearing another texture (one material per look, shared by everyone who has that look). */
function lookMaterial(look: string, base: THREE.MeshStandardMaterial): Promise<THREE.MeshStandardMaterial> {
  if (!look) return Promise.resolve(base);
  let p = lookCache.get(look);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(lookUrl(look)).then((tex) => {
      tex.flipY = false;                         // as glTF textures are
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = base.clone();
      mat.map = tex;
      mat.emissiveMap = tex;
      return mat;
    });
    lookCache.set(look, p);
  }
  return p;
}

function load(name: RigName): Promise<Source> {
  let p = cache.get(RIGS[name].file);
  if (!p) {
    p = gltfLoader().loadAsync(RIGS[name].file).then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        m.frustumCulled = false;                 // the skinned bounds do not follow the animation
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.85;
        mat.metalness = 0;
        if (mat.map) {
          mat.map.anisotropy = 4;
          // a faint self-glow from their own colours, so they stay readable between the lamps (as Ramu does)
          mat.emissiveMap = mat.map;
          mat.emissive = new THREE.Color().setScalar(NIGHT ? 0.16 : 0.06);
        }
      });
      let material!: THREE.MeshStandardMaterial;
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) material = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; });
      const clips = prepareClips(gltf.animations);
      const by = (n: string) => clips.find((c) => c.name === n);
      return { scene: gltf.scene, clips, material, lie: hipsAt(by('fall'), true).sub(hipsAt(by('get_up'), false)) };
    });
    cache.set(RIGS[name].file, p);
  }
  return p;
}

export class Actor {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: THREE.AnimationAction | null = null;
  private stride: number;
  private step: number;
  private under: THREE.AnimationAction | null = null;   // the idle pose mixed into a shortened walk
  private state = '';        // what is playing: a looping clip's name, or the key of a one-shot
  /** where the body lies after the backward fall, relative to where it stood (in the root's frame): the get-up starts there */
  readonly lie: THREE.Vector3;
  /** the mouth and eyes: still unless switched on (`face.talking`, `face.laughing`, `face.blinking`) */
  readonly face: Face;

  constructor(name: RigName, src: Source, material = src.material) {
    const body = clone(src.scene);
    if (material !== src.material) body.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material; });
    body.rotation.y = Math.PI;                   // the file faces +Z, the game's people face -Z
    this.root.add(body);
    this.face = new Face(body);
    this.step = RIGS[name].step ?? 1;
    this.stride = (RIGS[name].height / CLIP_HEIGHT) * this.step;
    this.lie = src.lie;
    this.mixer = new THREE.AnimationMixer(body);
    for (const clip of src.clips) {
      const a = this.mixer.clipAction(clip);
      if (ONCE.has(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[clip.name] = a;
    }
    if (this.step < 1) {
      // short steps: the walk at part weight over the standing pose (a copy of the idle clip, so it is its own action)
      const idle = src.clips.find((c) => c.name === 'idle');
      if (idle) { this.under = this.mixer.clipAction(idle.clone()); this.under.setEffectiveWeight(0).play(); }
    }
    this.play('idle', 1, 0);
    this.mixer.update(Math.random() * 3);        // not everyone breathing in step
  }

  /** Crossfade to a looping clip and set its playback speed. */
  play(name: string, timeScale = 1, fade = 0.25): void {
    if (!this.actions[name]) name = 'idle';
    if (this.state !== name) this.start(name, fade);
    this.state = name;
    if (this.current) this.current.timeScale = timeScale;
  }

  /**
   * A one-shot (a punch, taking a punch, the fall): played through once from the start and held. `key` names this
   * particular occasion (the third punch taken, say): the clip starts again only when the key changes.
   */
  once(name: string, key: string, timeScale = 1, fade = 0.1): void {
    if (this.state === key || !this.actions[name]) return;
    this.state = key;
    this.start(name, fade);
    if (this.current) this.current.timeScale = timeScale;
  }

  private start(name: string, fade: number): void {
    const next = this.actions[name];
    if (!next) return;
    const prev = this.current;
    const stepping = this.under !== null && (name === 'walk' || name === 'run');
    next.reset().setEffectiveWeight(stepping ? this.step : 1).play();
    this.under?.setEffectiveWeight(stepping ? 1 - this.step : 0);
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.current = next;
  }

  /**
   * Stand, walk or run to suit a ground speed in m/s (the clip is paced so the feet do not slide).
   * `idle`: what standing looks like just now (looking around, arguing, on guard in a fight).
   */
  move(speed: number, idle = 'idle'): void {
    if (speed < 0.25) this.play(idle);
    else if (speed < 2.6) this.play('walk', speed / (WALK_SPEED * this.stride));
    else this.play('run', speed / (RUN_SPEED * this.stride));
  }

  update(dt: number): void {
    this.mixer.update(dt);
    this.face.update(dt);
  }
}

/** How many looks a kind has (the model as built counts as one). */
export const lookCount = (name: RigName): number => LOOKS[name].length;

/** The material of one look of a kind, for anything else that wears it (the still figures: figures.ts). */
export async function rigMaterial(name: RigName, look: number): Promise<THREE.MeshStandardMaterial> {
  const src = await load(name);
  return lookMaterial(LOOKS[name][look % LOOKS[name].length], src.material);
}

const liteCache = new Map<string, Promise<Source>>();
/**
 * The light body of a kind (models/<name>_rig_lite.glb: tools/blender/build_ramu_rig.py): the same skeleton, the mesh cut to
 * about a fifth, no face keys. It plays the full file's clips and wears its material: its face UVs are passed on to the
 * face shader, and its mouth never darkens.
 */
function loadLite(name: RigName): Promise<Source> {
  const file = RIGS[name].file.replace('.glb', '_lite.glb');
  let p = liteCache.get(file);
  if (!p) {
    p = Promise.all([load(name), gltfLoader().loadAsync(file)]).then(([full, gltf]) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        m.frustumCulled = false;
        m.material = full.material;
        const g = m.geometry, uv1 = g.getAttribute('uv1');
        if (uv1) g.setAttribute('faceUv', uv1);
        else g.setAttribute('faceUv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2).fill(-1), 2));
        g.setAttribute('faceDark', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count), 1));
      });
      return { scene: gltf.scene, clips: full.clips, material: full.material, lie: full.lie };
    });
    liteCache.set(file, p);
  }
  return p;
}

/**
 * `n` people of one kind (clones of one loaded model), each with the next of that kind's looks. `lite`: the light body
 * (for many at once, seldom seen close: the kavi sammelan's audience).
 */
export async function makeActors(name: RigName, n: number, lite = false): Promise<Actor[]> {
  const src = await (lite ? loadLite(name) : load(name));
  const looks = LOOKS[name];
  const mats = await Promise.all(Array.from({ length: n }, () => lookMaterial(looks[nextLook[name]++ % looks.length], src.material)));
  return mats.map((m) => new Actor(name, src, m));
}
