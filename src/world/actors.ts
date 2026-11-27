import * as THREE from 'three';
import { storeMicPose } from './handProp';
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

export type RigName = 'uncle' | 'security' | 'security_thin' | 'goon' | 'girl' | 'boy' | 'aunty' | 'burqa' | 'kumar' | 'anchor' | 'buddha' | 'anaya';

/** height in metres (as built), used to match the walk clip's stride to the ground speed */
/** `step`: how much of the walk clip's stride they take (a sari allows short steps only) */
const RIGS: Record<RigName, { file: string; height: number; step?: number }> = {
  uncle: { file: 'models/uncle_rig.glb', height: 1.66 },
  security: { file: 'models/security_rig.glb', height: 1.72 },
  security_thin: { file: 'models/security_thin_rig.glb', height: 1.75 },   // the thin guard: every other guard asked for (makeActors)
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
/** how tall a kind of person is, m (as built; Actor.shape may scale them a little) */
export const rigHeight = (name: RigName): number => RIGS[name].height;
/** the looks of each kind: '' is the model as built, the rest are textures in models/looks/<name>.jpg (.webp when built) */
const LOOKS: Record<RigName, string[]> = {
  uncle: ['', 'uncle_b', 'uncle_c', 'uncle_d', 'uncle_e', 'uncle_f', 'uncle_g', 'uncle_h'],
  security: ['', 'security_b', 'security_c', 'security_d'],   // the uniform stays: dark skinned; no beard; a grey beard
  security_thin: [''],
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
/** nearer than this (metres from the camera) a person wears the full body; further, the light one */
const LOD_NEAR = 24;
/** further than this they are not drawn at all */
const CULL_FAR = 85;
const _at = new THREE.Vector3();
// Ramu's clips cover this much ground per second at normal playback, for his 1.52 m
const WALK_SPEED = 1.35, RUN_SPEED = 5.0, CLIP_HEIGHT = 1.52;

/** clips that play through once and hold their last pose */
export const ONCE = new Set(['punch', 'kick', 'hit', 'hit2', 'block', 'shove', 'fall', 'fall2', 'fall_sweep', 'get_up', 'jump',
  'stomach', 'stomach_hit', 'push', 'push_one', 'pockets', 'head_no', 'angry_point', 'disappointed', 'throw', 'offer',
  'hang_start', 'hang_braced', 'hang_drop',
  'ticket_check', 'shove_aside', 'pick_up', 'give', 'take', 'car_bail', 'mic_give', 'mic_take', 'rise', 'self_point', 'struck', 'pick_try', 'pick_start', 'pick_open', 'climb_roof', 'roof_leap', 'jump_far']);   // made in Katpootli (assets/anims/kp_*.fbx)   // Ramu on the giant wheel (stage 1, part 3)   // the last row: stage 1's scenes
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
    // "Sweep Fall" (shot in the chest) crouches for its first 20 frames before the blow lands: from the moment it does
    // (frame 21, the head snapping back; the feet are off the ground by frame 28)
    const cut = name === 'hit' ? [0.1, 2.0] : name === 'fall' ? [1.0, clip.duration] : name === 'shove' ? [0.15, 1.9]
      : name === 'fall_sweep' ? [0.68, clip.duration] : null;
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
const nextLook: Record<RigName, number> = { uncle: 0, security: 0, security_thin: 0, goon: 0, girl: 0, boy: 0, aunty: 0, burqa: 0, kumar: 0, anchor: 0, buddha: 0, anaya: 0 };

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

/**
 Off screen, not drawn: a body's bounds are its pose as built (the bind pose), opened out to take in whatever its clips
 do with it (a fall a metre back, arms up, a hand reaching out). Without bounds of its own a skinned mesh was drawn every
 frame wherever it was (three's own bounds for it come from one pose and would cut a falling man off mid-fall).
*/
export function cullAsBody(m: THREE.SkinnedMesh): void {
  if (!m.isSkinnedMesh) { m.frustumCulled = true; return; }
  const g = m.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  m.boundingSphere = g.boundingSphere!.clone();
  m.boundingSphere.radius *= 2.2;
  m.frustumCulled = true;
}

function load(name: RigName): Promise<Source> {
  let p = cache.get(RIGS[name].file);
  if (!p) {
    p = gltfLoader().loadAsync(RIGS[name].file).then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        cullAsBody(m);
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
      storeMicPose(gltf.scene, clips);                       // (copied onto each clone with userData)
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

  /** where the camera is (main.ts sets it every frame): near it a person wears the full body, further off the light one */
  static readonly eye = new THREE.Vector3();
  /** how zoomed in the camera is (1 at a 70 degree field of view; a cutscene's long lens is less): distances are counted
   as they look on screen, so a guard 25 m off in a close shot across the well keeps his full body */
  static zoom = 1;
  private full: THREE.Object3D[] = [];
  private lite: THREE.Object3D[] = [];
  private far = false;
  private skipped = 0;
  private frame = 0;
  /** a security guard: standing is the guard's stance (guard_stand: feet apart, chest out, looking about), not the idle */
  private guard = false;

  constructor(name: RigName, src: Source, material = src.material, liteSrc?: Source) {
    const body = clone(src.scene);
    if (material !== src.material) body.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material; });
    body.rotation.y = Math.PI;                   // the file faces +Z, the game's people face -Z
    this.root.add(body);
    this.face = new Face(body);
    if (liteSrc) this.addLite(body, liteSrc, material);
    this.step = RIGS[name].step ?? 1;
    this.guard = name === 'security' || name === 'security_thin';
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

  /**
   The light body (a fifth of the triangles, no face keys) worn beside the full one, on the full one's skeleton: the same
   bones by name, so one mixer moves both. update() shows one or the other by how far off the camera is.
  */
  private addLite(body: THREE.Object3D, liteSrc: Source, material: THREE.Material): void {
    const bones = new Map<string, THREE.Bone>();
    body.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
    body.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.full.push(o); });
    const liteBody = clone(liteSrc.scene);
    const meshes: THREE.SkinnedMesh[] = [];
    liteBody.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    const parent = this.full[0]?.parent ?? body;
    for (const m of meshes) {
      const mapped = m.skeleton.bones.map((b) => bones.get(b.name));
      if (mapped.some((b) => !b)) return;            // not the same skeleton after all: the full body only
      m.bind(new THREE.Skeleton(mapped as THREE.Bone[], m.skeleton.boneInverses), m.bindMatrix);
      m.material = material;
      m.visible = false;
      parent.add(m);
      this.lite.push(m);
    }
  }

  private chestBone: THREE.Object3D | null | undefined;
  /** where the chest is in the world now (the upper spine; the root if the rig has none): a pool of blood under a body */
  chest(out: THREE.Vector3): THREE.Vector3 {
    if (this.chestBone === undefined) {
      this.chestBone = null;
      this.root.traverse((o) => { if (!this.chestBone && (o as THREE.Bone).isBone && /Spine1$/.test(o.name)) this.chestBone = o; });
    }
    this.root.updateMatrixWorld(true);
    return (this.chestBone ?? this.root).getWorldPosition(out);
  }

  /** a build of their own: `tall` scales the height, `wide` the breadth (0.85: thin); the stride follows the legs */
  shape(tall: number, wide: number): void {
    this.root.children[0].scale.set(wide, tall, wide);
    this.stride *= tall;
  }

  /** Crossfade to a looping clip and set its playback speed. */
  /** the rig has this clip */
  has(name: string): boolean { return !!this.actions[name]; }

  play(name: string, timeScale = 1, fade = 0.25): void {
    if (!this.actions[name]) name = 'idle';
    if (name === 'idle' && this.guard && this.actions.guard_stand) name = 'guard_stand';
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
  move(speed: number, idle = 'idle', walk = 'walk'): void {
    if (speed < 0.25) this.play(idle);
    else if (speed < 2.6) this.play(this.actions[walk] ? walk : 'walk', speed / (WALK_SPEED * this.stride));
    else this.play('run', speed / (RUN_SPEED * this.stride));
  }

  /** move the body on by `dt`; true when the bones were posed this frame (far off they are only every other or third) */
  update(dt: number): boolean {
    const d = this.root.getWorldPosition(_at).distanceTo(Actor.eye) * Actor.zoom;
    // far across the fair they are a few pixels high: not drawn (the body only: the story hides people by their root)
    const body = this.root.children[0];
    if (body) body.visible = d < CULL_FAR;
    if (this.lite.length) {
      const far = d > (this.far ? LOD_NEAR - 3 : LOD_NEAR);       // (a little give, so nobody flickers on the line)
      if (far !== this.far) {
        this.far = far;
        for (const m of this.full) m.visible = !far;
        for (const m of this.lite) m.visible = far;
      }
    }
    // far off, the body is moved every other or every third frame (by the time gone by): nobody can tell, and the
    // crowd's bones are much of the frame's work
    const every = d > 70 ? 3 : d > 35 ? 2 : 1;
    this.skipped += dt;
    if (++this.frame % every !== 0) return false;
    this.mixer.update(this.skipped);
    this.skipped = 0;
    if (!this.far) this.face.update(dt * every);
    return true;
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
        cullAsBody(m);
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
/** guards made so far: every other one is the thin guard */
let guards = 0;

/**
 `n` people of a kind. Security guards come as a mix of the two guards' bodies, the stout one (in his looks) and the thin
 one (his own face: the stout one's looks are painted for another body); whoever asks for them still has 'security'.
*/
export async function makeActors(name: RigName, n: number, lite = false, pick?: string[]): Promise<Actor[]> {
  if (name !== 'security') return makeKind(name, n, lite, pick);
  const stout: number[] = [], thin: number[] = [];
  for (let i = 0; i < n; i++) (guards++ % 2 ? thin : stout).push(i);
  const [a, b] = await Promise.all([
    stout.length ? makeKind('security', stout.length, lite, pick && stout.map((i) => pick[i % pick.length])) : Promise.resolve([]),
    thin.length ? makeKind('security_thin', thin.length, lite).catch(() => makeKind('security', thin.length, lite)) : Promise.resolve([]),
  ]);
  const out: Actor[] = new Array(n);
  stout.forEach((i, k) => { out[i] = a[k]; });
  thin.forEach((i, k) => { out[i] = b[k]; });
  return out;
}

async function makeKind(name: RigName, n: number, lite = false, pick?: string[]): Promise<Actor[]> {
  const src = await (lite ? loadLite(name) : load(name));
  const looks = LOOKS[name];
  // `pick`: these looks, in order (the story's own people, who must each look different)
  const mats = await Promise.all(Array.from({ length: n }, (_, i) => lookMaterial(pick ? pick[i % pick.length] : looks[nextLook[name]++ % looks.length], src.material)));
  const far = lite ? undefined : await loadLite(name).catch(() => undefined);     // the light body for when they are far off
  return mats.map((m) => new Actor(name, src, m, far));
}
