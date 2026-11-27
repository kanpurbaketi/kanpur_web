import * as THREE from 'three';
import { storeMicPose } from '../world/handProp';
import { gltfLoader } from '../world/gltf';
import { CollisionWorld } from './collide';
import { Controls } from '../game/controls';
import { NIGHT } from '../world/night';
import { loadSettings, onSettingsChange, Settings } from '../game/settings';
import { skinParams } from '../game/skin';
import { CLIP_SECS, ONCE, prepareClips, PUNCH_LANDS } from '../world/actors';
import { Rider, RidePose, SEATS } from './rider';
import { LockTools, pickPhase } from './lockTools';
import { Face } from '../world/face';

const CROUCH = 1.2, ACCEL = 12, GRAVITY = 9.8, TURN = 10, RADIUS = 0.35;
/**
 * The jump, against the jump clip (2.2 s, made for a standing jump): its knees bend 0.30-0.72 s, it leaves the ground at
 * 0.74, lands at 1.36 and has absorbed the landing by 1.85. The game runs those parts at the speed of the real jump: a
 * short knee bend first (a standing jump only: running, he takes off at once), the flight stretched over the real time
 * in the air, the landing played after he is down.
 */
const J_BEND = [0.30, 0.72], J_AIR = [0.74, 1.36], J_LAND = [1.36, 1.85];
const WINDUP = 0.15;    // seconds of the knee bend before a standing jump leaves the ground
const CAM_DIST = 3.2, EYE = 1.35;
/** aiming a gun: the camera this close, this far over his right shoulder, this much lower, the view this much narrower */
const AIM_DIST = 1.55, AIM_SIDE = 0.5, AIM_DROP = 0.08, AIM_FOV = 0.82;
/** a gun out, not aiming: the camera at its usual distance but this far over his right shoulder and this much higher, so
 the crosshair (the middle of the screen) is out past him, not on the back of his head */
const ARMED_SIDE = 0.75, ARMED_LIFT = 0.12;

/** which body the player has: the teen (the stages) or the grown man (Explore world); his height sets the eye line */
export interface Body { model: string; eye: number }
export const TEEN: Body = { model: 'models/ramu_rig.glb', eye: EYE };
export const ADULT: Body = { model: 'models/ramu_adult_rig.glb', eye: 1.55 };

/**
 * Ramu on a vehicle (set every frame by the driving): which way it faces, its pose for the rider (body frame, kind, steer,
 * wheels' roll, how far on he is), and the chase camera.
 */
export interface Ride extends RidePose {
  heading: number;
  /** the vehicle: its centre, its speed (m/s, backward < 0), the camera's distance and the height it looks at */
  cx: number; cz: number; speed: number; cam: number; camH: number;
}

/** Ramu: third-person walk / run / jump with an orbit camera. Port of kanpur/game/scripts/player/ramu.gd. */
export class Ramu {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = -0.3;
  enabled = true;
  /** total jumps (for statistics) */
  jumps = 0;
  /** punches thrown so far (the game checks it to see when one was thrown) */
  punches = 0;
  /** seconds left of being knocked about (no control while it runs) */
  stun = 0;
  /** laid out (the life bar ran out): he falls and lies there until the game wakes him */
  knockedOut = false;
  private reel = 0;        // seconds left of taking a blow
  /** blows taken so far (whatever he was at, a blow stops it: picking a lock) */
  hits = 0;
  private punchT = 0;      // seconds since the punch in the air began
  private reelClip = 'hit';   // which way he takes this blow (head / body, turn about)
  private wake = 0;        // seconds left of getting up after a knock-out (no control while it runs)
  private wasOut = false;
  private grounded = true;
  private keys = new Set<string>();
  private touchMove = new THREE.Vector2();
  private touchRun = false;
  private jumpQueued = false;
  /** the jump under way: 0 none, 1 bending to spring, 2 in the air, 3 landing; seconds into the phase; how long the flight should last */
  private jumpPhase = 0;
  private jumpT = 0;
  private airFor = 1;
  private mixer: THREE.AnimationMixer | null = null;
  /** his mouth and eyes (off until switched on: `face.talking`, `face.blinking`); null until the model has loaded */
  face: Face | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: THREE.AnimationAction | null = null;
  private punchQueued = false;
  private punching = false;
  /** admin settings (walk / run / jump / punch speeds, skin tone); updated live from the admin tab */
  private cfg: Settings = loadSettings();
  private blob: THREE.Mesh | null = null;
  /** on a vehicle: he sits, posed, and the camera follows the vehicle; null on foot */
  ride: Ride | null = null;
  /** at a lock (set by Driving each frame, null when not): where the lock is, where he stands to it, low for a bike's */
  lockPick: { lock: THREE.Vector3; stand: [number, number]; low: boolean; t: number; need: number } | null = null;
  /** how far into the picking pose (eases in and out), and the last lock (for easing out) */
  private pickW = 0;
  private lastPick: { lock: THREE.Vector3; low: boolean; t: number; need: number } | null = null;
  /** the tension wrench and the pick, in his hands while he is at a car's lock */
  private tools: LockTools | null = null;
  /** a cutscene has the camera: he does not move it (src/game/story/cutcam.ts does) */
  cinematic = false;
  /** a clip played once while he stands (a scene's gesture: the hand on the stomach, the pockets), and its time left */
  private gestureName: string | null = null;
  private gestureT = 0;
  private headBone: THREE.Object3D | null = null;
  /** the get on / off key (or button) was pressed */
  onUse: (() => void) | null = null;
  /** the vehicle keys: headlights (pressed), horn (down and up) */
  onKey: ((a: 'lights' | 'horn', down: boolean) => void) | null = null;
  /** poses him on a vehicle (IK on his rig); also the gun's arm (src/player/gun.ts) */
  rider: Rider | null = null;
  /** the loaded model (its bones), null until it has loaded */
  skeleton: THREE.Object3D | null = null;
  /** a gun in his hand (src/player/gun.ts): the punch key fires instead, and he faces where the camera looks while aiming
   or shooting */
  armed = false;
  /** shots asked for (the punch key, armed) since the gun last took them */
  private shots = 0;
  /** seconds he keeps facing the aim after a shot (the gun lowered after) */
  private aimHold = 0;
  /** 0 .. 1: how far the camera has gone over his shoulder (aiming) */
  private aimW = 0;
  private armedW = 0;
  private aimFov = 0;
  /** where the game's camera last was (a cutscene's camera elsewhere leaves it): the crosshair's line starts here */
  readonly aimFrom = new THREE.Vector3();
  private lookIdle = 0;    // seconds since the player last turned the camera
  /** the chase camera's point on a vehicle (it lags the vehicle a little, and looks ahead as it goes) */
  private chase = new THREE.Vector3();
  private chasing = false;
  private baseFov = 0;
  private skin = { gamma: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) }, glow: { value: NIGHT ? 0.2 : 0.1 } };

  constructor(private camera: THREE.PerspectiveCamera, private world: CollisionWorld, dom: HTMLElement, private controls: Controls, private body: Body = TEEN) {
    onSettingsChange((s) => (this.cfg = s));
    this.buildBody();
    this.buildBlob();
    this.root.add(this.model);
    this.bindInput(dom);
  }

  /** shots asked for since the last call (the gun fires them) */
  takeShots(): number { const n = this.shots; this.shots = 0; return n; }

  /** the aim held (its key down), armed and on foot */
  /** one of his clips (by name), if the rig has it */
  clip(name: string): THREE.AnimationClip | undefined { return this.actions[name]?.getClip(); }

  get aimHeld(): boolean { return this.armed && this.enabled && !this.ride && this.controls.held('aim', this.keys); }

  /** facing where the camera looks: aiming, or just after a shot */
  get aimingPose(): boolean { return this.armed && !this.ride && !this.pose && (this.aimHeld || this.aimHold > 0); }

  /** the camera's yaw and pitch (radians): where the crosshair points */
  get aimAngles(): { yaw: number; pitch: number } { return { yaw: this.yaw, pitch: this.pitch }; }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** on his feet on something (not in the air) */
  get onGround(): boolean { return this.grounded; }

  /** horizontal speed, m/s */
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** the way he faces (radians, the same convention as a pedestrian's heading) */
  get facing(): number {
    return this.model.rotation.y;
  }

  /** play a clip once while he stands (a scene's gesture); its length in seconds (0: no such clip). Moving ends it.
   `hold`: seconds more on its last frame (stopGesture ends it sooner) */
  gesture(name: string, timeScale = 1, hold = 0): number {
    const a = this.actions[name];
    if (!a) return 0;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = timeScale;
    if (this.current === a) this.current = null;     // replayed: start it over
    this.gestureName = name;
    this.gestureT = a.getClip().duration / timeScale + hold;
    return this.gestureT;
  }

  stopGesture(): void { this.gestureT = 0; }

  /** where his head is (world), for close-ups; false until the body has loaded */
  headPosition(out: THREE.Vector3): boolean {
    if (!this.headBone) this.model.traverse((o) => { if (!this.headBone && /Head$/.test(o.name)) this.headBone = o; });
    if (!this.headBone) return false;
    this.headBone.getWorldPosition(out);
    return true;
  }

  /** put him standing at (x, z) (a cutscene places him), still; `y`: about where his feet are (on the stage: its top) */
  standAt(x: number, z: number, y = 0): void {
    this.root.position.set(x, this.world.floorAt(x, z, y + 0.5), z);
    this.vel.set(0, 0, 0);
  }

  /** a held pose (sitting in a chair): a looping clip, where he is put, no walking or falling until standUp() */
  private pose: string | null = null;
  get posed(): boolean { return this.pose !== null; }

  /** sit him (or hold him in any looping clip) at (x, y, z), facing `ry` */
  sitAt(x: number, y: number, z: number, ry: number, clip = 'sitting_talking'): void {
    this.root.position.set(x, y, z);
    this.model.rotation.y = ry;
    this.vel.set(0, 0, 0);
    this.gestureT = 0;
    this.pose = clip;
    this.poseLast = false;
    this.poseAt = null;
    this.snap(clip);
  }

  /**
   * Straight into `clip`, no crossfade, the bones put there now: a shot framed on him in the same moment (a skipped scene
   * landing him at the mic) finds his head where it is, not where the last pose (sitting) had it.
   */
  private snap(clip: string): void {
    const next = this.actions[clip] ?? this.actions.idle;
    if (!next || !this.mixer) return;
    this.mixer.stopAllAction();
    next.reset().setEffectiveWeight(1).play();
    this.current = next;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
  }

  /** change the held clip (eating, talking) while sitting; `last`: a once-only clip (a fall) held on its last frame */
  /** the held pose's clip: playing, or held at its last frame (`last`), or held at `at` seconds into it */
  holdClip(clip: string, last = false, at: number | null = null): void { if (this.pose) { this.pose = clip; this.poseLast = last; this.poseAt = at; } }
  private poseLast = false;
  private poseAt: number | null = null;

  /** out of the held pose, standing at (x, z) on whatever is there at about height y */
  standUp(x: number, z: number, y: number): void {
    this.pose = null;
    this.standAt(x, z, y);
  }

  /** turn to face a point (the punch finds its man) */
  faceTowards(x: number, z: number): void {
    this.model.rotation.y = Math.atan2(-(x - this.root.position.x), -(z - this.root.position.z));
  }

  /** Thrown by a car or a blow: sets him flying (vx, vz in m/s, vy up) and takes control away for a moment. */
  knock(vx: number, vz: number, vy = 3): void {
    this.vel.x = vx;
    this.vel.z = vz;
    this.vel.y = vy;
    this.grounded = false;
    this.jumpPhase = 2;                       // thrown: in the air (the flying pose) until he comes down
    this.jumpT = 0;
    this.airFor = Math.max(0.3, (2 * vy) / GRAVITY);
    this.stun = 0.9;
    this.punching = false;
  }

  /** true while a punch of his is in the air */
  get isPunching(): boolean {
    return this.punching;
  }

  /** how long after a punch starts the fist lands, seconds (at the admin's punch speed) */
  get punchDelay(): number {
    return PUNCH_LANDS / this.cfg.punchSpeed;
  }

  /** He has been hit: a short recoil (a punch of his own already in the air still goes through). */
  flinch(): void {
    this.hits++;
    if (this.punching) return;
    this.reel = 0.5;
    this.reelClip = this.reelClip === 'hit' && this.actions.hit2 ? 'hit2' : 'hit';
    this.actions[this.reelClip]?.reset();
  }

  /** forget held keys (e.g. when a menu takes focus) */
  releaseKeys(): void {
    this.keys.clear();
    this.touchMove.set(0, 0);
  }

  /** the movement keys / stick: x to the right, y back (-1 forward), each -1..1 */
  stick(): THREE.Vector2 {
    const v = new THREE.Vector2();
    if (!this.enabled) return v;
    const c = this.controls;
    if (c.held('forward', this.keys)) v.y -= 1;
    if (c.held('back', this.keys)) v.y += 1;
    if (c.held('left', this.keys)) v.x -= 1;
    if (c.held('right', this.keys)) v.x += 1;
    v.add(this.touchMove);
    return v.clampScalar(-1, 1);
  }

  /** the hand brake (the jump key) held */
  get braking(): boolean {
    return this.enabled && this.controls.held('jump', this.keys);
  }

  /** Got off a vehicle at (x, z): on his feet there. */
  stepDown(x: number, z: number): void {
    this.ride = null;
    this.model.rotation.set(0, this.model.rotation.y, 0);      // upright again (a bike leant him over)
    this.root.position.set(x, this.world.floorAt(x, z, 0.5), z);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.jumpPhase = 0;
    this.punching = false;
  }

  /** thrown clear of a moving car (he jumped): the leap, a roll along the ground, up on his feet; -1: not */
  private bailT = -1;
  private bailV = new THREE.Vector2();
  get bailing(): boolean { return this.bailT >= 0; }

  /** He jumps out of a moving vehicle at (x, z), going at (vx, vz) m/s: he leaps, rolls and gets up. */
  bail(x: number, z: number, vx: number, vz: number): void {
    this.ride = null;
    this.root.position.set(x, this.world.floorAt(x, z, 0.5), z);
    this.model.rotation.set(0, Math.atan2(-vx, -vz), 0);
    this.bailV.set(vx, vz);
    this.bailT = 0;
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.jumpPhase = 0;
    this.punching = false;
    this.gestureT = 0;
  }

  /** the jump out, a frame of it; false when he is not jumping out (any more) */
  private bailFrame(dt: number): boolean {
    if (this.bailT < 0) return false;
    const LEAP = 0.42, ROLL = 0.7, UP = CLIP_SECS.get_up / 1.8, C = 0.62;
    const t = (this.bailT += dt), p = this.root.position, m = this.model, A = this.actions;
    // carried on by the car's speed: little drag in the air, a lot once he is rolling on the ground
    this.bailV.multiplyScalar(Math.exp(-(t < LEAP ? 0.4 : t < LEAP + ROLL ? 2.2 : 9) * dt));
    [p.x, p.z] = this.world.resolve(p.x + this.bailV.x * dt, p.z + this.bailV.y * dt, RADIUS, p.y);
    const floor = this.world.floorAt(p.x, p.z, 0.5);
    const heading = m.rotation.y;
    if (t < LEAP) {
      // the clip's crouch in the door and the leap, arms over the head; up in an arc
      const a = this.play(A.car_bail ? 'car_bail' : 'jump', 0.05);
      if (a) { a.timeScale = 0; a.time = Math.min(a.getClip().duration * 0.75, (t / LEAP) * a.getClip().duration * 0.75); }
      p.y = floor + 0.45 * Math.sin(Math.PI * Math.min(1, t / LEAP));
    } else if (t < LEAP + ROLL) {
      // tucked, a roll over forward along the ground: turned about the middle of the ball he makes
      const a = this.play(A.car_bail ? 'car_bail' : 'crouch', 0.08);
      if (a && A.car_bail) { a.timeScale = 0; a.time = a.getClip().duration - 0.001; }
      const k = (t - LEAP) / ROLL, th = -Math.PI * 2 * (k * k * (3 - 2 * k));
      m.rotation.set(th, heading, 0, 'YXZ');
      const c = _bail.set(0, C, 0).applyEuler(m.rotation);
      m.position.set(-c.x, C - c.y, -c.z);
      p.y = floor - 0.32 * Math.sin(Math.PI * k);
    } else {
      m.rotation.set(0, heading, 0, 'XYZ');
      m.position.set(0, 0, 0);
      p.y = floor;
      if (t < LEAP + ROLL + UP && A.get_up) {
        const g = this.play('get_up', 0.15);
        if (g) g.timeScale = 1.8;
      } else {
        this.bailT = -1;
        this.bailV.set(0, 0);
      }
    }
    this.mixer?.update(dt);
    this.face?.update(dt);
    this.updateBlob();
    if (!this.cinematic) this.updateCamera(p.x, floor + this.body.eye, p.z, CAM_DIST + 0.8);     // (the ground's height: not down into the roll with him)
    return true;
  }

  update(dt: number): void {
    this.lookIdle += dt;
    if (this.bailFrame(dt)) return;
    const r = this.ride;
    if (this.blob) this.blob.visible = !r;
    if (r) {
      this.vel.set(0, 0, 0);
      this.jumpQueued = this.punchQueued = false;
      this.punching = false;
      // on it: the standing idle from the mixer, then the rider bends him onto the seat, the grips and the pedals
      if (this.mixer && this.rider) {
        // in a car: the clips made for it (getting in and out paced by how far along he is; sitting at the wheel), else
        // the standing idle, and the rider bends him onto the seat, the grips and the pedals
        const A = this.actions, car = A.car_sit && r.kind in SEATS && 'wheel' in SEATS[r.kind].hands;
        const clip = !car ? 'idle' : r.w >= 1 && !r.leaving ? 'car_sit' : r.leaving ? 'car_out' : 'car_in';
        const a = this.play(A[clip] ? clip : 'car_sit', 0.15);
        if (a && (clip === 'car_in' || clip === 'car_out') && A[clip]) {
          const len = a.getClip().duration;
          a.timeScale = 0;
          a.time = Math.min(len - 0.001, (clip === 'car_in' ? r.w : 1 - r.w) * len);
        } else if (a) a.timeScale = 1;
        this.mixer.update(dt);
        this.face?.update(dt);
        this.rider.apply(this.root, this.model, r, !!car);
      }
      // the camera swings round behind the vehicle as it goes, unless the player is looking about
      if (this.lookIdle > 1.2 && Math.abs(r.speed) > 1.5) {
        const want = r.heading + Math.PI;
        const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
        this.yaw += d * Math.min(1, dt * 2.2);
        this.pitch += (-0.22 - this.pitch) * Math.min(1, dt * 1.5);
      }
      // the chase camera: its point a little ahead of the vehicle as it goes, following on a spring (it lags when the
      // vehicle jumps away, catches up as it settles); the view widens with speed
      const ahead = Math.max(-2, Math.min(4, r.speed * 0.18));
      const tx = r.cx + Math.sin(r.heading) * ahead, tz = r.cz + Math.cos(r.heading) * ahead;
      if (!this.chasing) { this.chase.set(tx, r.camH, tz); this.chasing = true; this.baseFov = this.camera.fov; }
      const k = 1 - Math.exp(-dt * 7);
      this.chase.x += (tx - this.chase.x) * k;
      this.chase.z += (tz - this.chase.z) * k;
      this.chase.y = r.camH;
      const fov = this.baseFov + Math.min(12, Math.abs(r.speed) * 0.55);
      if (Math.abs(fov - this.camera.fov) > 0.05) {
        this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
        this.camera.updateProjectionMatrix();
      }
      if (!this.cinematic) this.updateCamera(this.chase.x, this.chase.y, this.chase.z, r.cam + Math.min(1.5, Math.abs(r.speed) * 0.06));
      return;
    }
    if (this.chasing) {                      // off the vehicle: the view as it was
      this.chasing = false;
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
    const input = new THREE.Vector2();
    this.stun = Math.max(0, this.stun - dt);
    if (this.enabled && this.stun <= 0 && this.wake <= 0) {
      const c = this.controls;
      if (c.held('forward', this.keys)) input.y -= 1;
      if (c.held('back', this.keys)) input.y += 1;
      if (c.held('left', this.keys)) input.x -= 1;
      if (c.held('right', this.keys)) input.x += 1;
      input.add(this.touchMove);
      if (this.jumpQueued && this.grounded && this.jumpPhase !== 1 && this.jumpPhase !== 2) {
        // standing: the knees bend first; on the move he springs off at once
        if (Math.hypot(this.vel.x, this.vel.z) < 1.2 && this.actions.jump) { this.jumpPhase = 1; this.jumpT = 0; }
        else this.takeOff();
      }
    }
    this.jumpQueued = false;
    this.jumpT += dt;
    if (this.jumpPhase === 1 && (this.stun > 0 || !this.enabled)) this.jumpPhase = 0;
    if (this.jumpPhase === 1 && this.jumpT >= WINDUP) this.takeOff();
    if (this.jumpPhase === 3 && this.jumpT > 0.5) this.jumpPhase = 0;
    const crouching = this.enabled && this.controls.held('crouch', this.keys);
    if (this.punchQueued && this.enabled && this.stun <= 0 && this.wake <= 0 && this.grounded && !this.punching && this.actions.punch) {
      this.punching = true;
      this.punchT = 0;
      this.punches++;
      const a = this.actions.punch;
      a.reset();
      a.timeScale = this.cfg.punchSpeed;
      this.play('punch', 0.05);
    }
    this.punchQueued = false;
    if (this.pose) {                         // held: sitting in a chair (a scene); a gesture may play over it
      this.vel.set(0, 0, 0);
      this.animate(dt, 0, false);
      this.updateBlob();
      const q = this.root.position;
      if (!this.cinematic) this.updateCamera(q.x, q.y + this.body.eye, q.z, CAM_DIST);
      return;
    }
    if (input.lengthSq() > 1) input.normalize();
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dir = new THREE.Vector3(input.x * cos + input.y * sin, 0, -input.x * sin + input.y * cos);
    const running = this.controls.held('run', this.keys) || this.touchRun;
    let speed = crouching ? CROUCH : running ? this.cfg.runSpeed : this.cfg.walkSpeed;
    if (this.punching) speed *= 0.15;
    const step = (this.stun > 0 ? 4 : ACCEL * speed) * dt;   // knocked back: slide rather than stop dead
    this.vel.x = moveToward(this.vel.x, dir.x * speed, step);
    this.vel.z = moveToward(this.vel.z, dir.z * speed, step);
    this.vel.y -= GRAVITY * dt;

    const p = this.root.position;
    // a raised floor too high to step onto (a stair from the side, the stage) is a wall: slide along it
    const nx = p.x + this.vel.x * dt, nz = p.z + this.vel.z * dt, w = this.world;
    if (!w.tooHigh(nx, nz, p.y) || w.tooHigh(p.x, p.z, p.y)) { p.x = nx; p.z = nz; }
    else if (!w.tooHigh(nx, p.z, p.y)) p.x = nx;
    else if (!w.tooHigh(p.x, nz, p.y)) p.z = nz;
    // falling: whatever he passed on the way down this frame catches him (a fast fall, or a slow frame, skips no top)
    const y0 = p.y;
    p.y += this.vel.y * dt;
    const floor = this.world.floorAt(p.x, p.z, Math.max(p.y, y0));
    if (this.grounded && this.vel.y <= 0 && p.y > floor && p.y - floor < 0.45) p.y = floor;   // walking down a stair keeps his feet on it
    if (p.y <= floor) {
      p.y = floor;
      this.vel.y = 0;
      this.grounded = true;
      if (this.jumpPhase === 2) { this.jumpPhase = 3; this.jumpT = 0; }   // down: the landing
    }
    [p.x, p.z] = this.world.resolve(p.x, p.z, RADIUS, p.y);

    // at a lock and not moving off: he steps over to it and turns to it
    const lp = this.lockPick;
    if (lp && dir.lengthSq() < 0.0025 && this.grounded) {
      const e = Math.min(1, dt * 8);
      p.x += (lp.stand[0] - p.x) * e;
      p.z += (lp.stand[1] - p.z) * e;
      const want = Math.atan2(-(lp.lock.x - p.x), -(lp.lock.z - p.z));
      const d = Math.atan2(Math.sin(want - this.model.rotation.y), Math.cos(want - this.model.rotation.y));
      this.model.rotation.y += d * Math.min(1, dt * 10);
    }
    // face movement direction + simple limb swing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.aimHold = Math.max(0, this.aimHold - dt);
    if (this.aimingPose && this.stun <= 0) {                 // the gun up: he faces where the camera looks, and steps sideways
      let d = this.yaw - this.model.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.model.rotation.y += d * Math.min(1, 18 * dt);
    } else if (dir.lengthSq() > 0.0025) {
      const want = Math.atan2(-dir.x, -dir.z);
      let d = want - this.model.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.model.rotation.y += d * Math.min(1, TURN * dt);
    }
    this.animate(dt, hs, crouching);
    // the hands on the lock, over the clip
    if (lp) this.lastPick = { lock: lp.lock, low: lp.low, t: lp.t, need: lp.need };
    this.pickW = Math.max(0, Math.min(1, this.pickW + (lp && hs < 0.8 ? dt / 0.35 : -dt / 0.2)));
    this.pickHands();
    this.updateBlob();

    if (!this.cinematic) this.updateCamera(p.x, p.y + this.body.eye, p.z, CAM_DIST);
  }

  /**
   * At a lock, after the clip: the hands put on it (or, at a car's door first, on its handle), the fingers round the
   * tools, and the tools drawn in them. A car's lock goes in four parts (lockTools.ts): try the door, the tools out,
   * at it, open.
   */
  private pickHands(): void {
    const k = this.lastPick, tools = this.tools;
    if (tools && !tools.pick.parent && this.root.parent) tools.addTo(this.root.parent);
    if (this.pickW <= 0 || !k || !this.rider) { tools?.hide(); return; }
    if (k.low) {
      this.rider.pick(this.model, k.lock, k.t, true, this.pickW, !!this.actions.pick_low);
      tools?.hide();
      return;
    }
    const ph = this.actions.pick_try ? pickPhase(k.t, k.need) : null;
    const ik = ph ? ph.ik : 1;
    const stroke = this.rider.pick(this.model, k.lock, ph ? ph.at : k.t, false, this.pickW * ik, !!this.actions.pick_lock, ph ? ph.handle * this.pickW : 0);
    if (!tools || !ph || this.pickW < 0.5) { tools?.hide(); return; }
    // in his hand (a look at them) before they go in: the fingers closed on them
    if (ph.tools === 'hand') this.rider.grip('Right', 0.7, 0.4);
    const fwd = _pickFwd.set(k.lock.x - this.root.position.x, 0, k.lock.z - this.root.position.z).normalize();
    this.model.updateMatrixWorld(true);
    tools.update(ph.tools, k.lock, fwd, stroke);
  }

  /** off the ground: up at the jump speed; the flight should take 2 v / g */
  private takeOff(): void {
    this.vel.y = this.cfg.jumpSpeed;
    this.grounded = false;
    this.jumps++;
    this.jumpPhase = 2;
    this.jumpT = 0;
    this.airFor = (2 * this.cfg.jumpSpeed) / GRAVITY;
  }

  /** the camera on its arm from the point (px, py, pz), pulled in where something is in the way */
  private updateCamera(px: number, py: number, pz: number, dist: number): void {
    // aiming: closer, over the right shoulder, the view a little narrower
    const aimTo = this.aimHeld ? 1 : 0;
    this.aimW += (aimTo - this.aimW) * Math.min(1, 12 * (1 / 60));
    if (this.aimW > 0.001 || this.aimFov) {
      if (!this.aimFov) this.aimFov = this.camera.fov;
      this.camera.fov = this.aimFov * (1 + (AIM_FOV - 1) * this.aimW);
      this.camera.updateProjectionMatrix();
      if (this.aimW <= 0.001) { this.camera.fov = this.aimFov; this.camera.updateProjectionMatrix(); this.aimFov = 0; }
    }
    this.armedW += ((this.armed && !this.ride ? 1 : 0) - this.armedW) * Math.min(1, 6 * (1 / 60));
    if (this.aimW > 0.001 || this.armedW > 0.001) {
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);            // the camera's right
      const carry = this.armedW * (1 - this.aimW);
      const side = AIM_SIDE * this.aimW + ARMED_SIDE * carry, ox = rx * side, oz = rz * side;
      py += ARMED_LIFT * carry;
      const t0 = this.world.raycast(px, py, pz, px + ox, py, pz + oz);   // not through a wall beside him
      px += ox * Math.max(0, t0 - 0.15); pz += oz * Math.max(0, t0 - 0.15);
      py -= AIM_DROP * this.aimW;
      dist += (AIM_DIST - dist) * this.aimW;
    }
    const cp = Math.cos(this.pitch);
    const bx = Math.sin(this.yaw) * cp, by = -Math.sin(this.pitch), bz = Math.cos(this.yaw) * cp;
    const t = this.world.raycast(px, py, pz, px + bx * dist, py + by * dist, pz + bz * dist);
    const d = Math.max(0.4, dist * t - 0.25);
    // squeezed against something (a wall behind him, the rail of a narrow gallery): rise as it closes in, to look over
    // his head rather than into the back of it
    const lift = Math.max(0, 1.7 - d) * 0.28;
    this.camera.position.set(px + bx * d, Math.max(0.3, py + by * d + lift), pz + bz * d);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.aimFrom.copy(this.camera.position);
  }

  /** the crosshair's line: its direction (from yaw and pitch, as the camera looks) */
  aimDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** a key (or mouse button) went down: the one-shot actions */
  private press(code: string): void {
    if (this.controls.matches('jump', code)) this.jumpQueued = true;
    if (this.controls.matches('punch', code)) {
      if (this.armed) { if (this.enabled) { this.shots++; this.aimHold = 2.5; } } else this.punchQueued = true;
    }
    if (this.controls.matches('use', code) && this.enabled) this.onUse?.();
    if (this.controls.matches('lights', code) && this.enabled) this.onKey?.('lights', true);
    if (this.controls.matches('horn', code) && this.enabled) this.onKey?.('horn', true);
  }

  private bindInput(dom: HTMLElement): void {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (!e.repeat) this.press(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.controls.matches('horn', e.code)) this.onKey?.('horn', false);
    });
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('click', () => {
      if (matchMedia('(pointer: fine)').matches) dom.requestPointerLock?.();
    });
    addEventListener('mousedown', (e) => {
      // mouse buttons can be bound too ('Mouse0' = left click), once the mouse is captured by the game
      if (document.pointerLockElement !== dom) return;
      this.keys.add('Mouse' + e.button);
      this.press('Mouse' + e.button);
    });
    addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());     // right click is the aim
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.look(e.movementX, e.movementY);
    });
    this.bindTouch(dom);
  }

  private look(dx: number, dy: number, k = 0.0025): void {
    if (dx || dy) this.lookIdle = 0;
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.2, Math.min(0.5, this.pitch - dy * k));
  }

  /** Left half: virtual joystick. Right half: drag to look. Buttons: run toggle, jump. */
  private bindTouch(dom: HTMLElement): void {
    const stick = document.getElementById('stick')!;
    const knob = document.getElementById('knob')!;
    let moveId = -1, lookId = -1;
    let sx = 0, sy = 0, lx = 0, ly = 0;
    dom.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < innerWidth / 2 && moveId < 0) {
          moveId = t.identifier;
          sx = t.clientX;
          sy = t.clientY;
          stick.style.display = 'block';
          stick.style.left = `${sx - 60}px`;
          stick.style.top = `${sy - 60}px`;
        } else if (lookId < 0) {
          lookId = t.identifier;
          lx = t.clientX;
          ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === moveId) {
          const dx = t.clientX - sx, dy = t.clientY - sy;
          const len = Math.min(50, Math.hypot(dx, dy));
          const a = Math.atan2(dy, dx);
          knob.style.transform = `translate(${Math.cos(a) * len}px, ${Math.sin(a) * len}px)`;
          this.touchMove.set((Math.cos(a) * len) / 50, (Math.sin(a) * len) / 50);
        } else if (t.identifier === lookId) {
          this.look(t.clientX - lx, t.clientY - ly, 0.005);
          lx = t.clientX;
          ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === moveId) {
          moveId = -1;
          this.touchMove.set(0, 0);
          stick.style.display = 'none';
          knob.style.transform = '';
        } else if (t.identifier === lookId) lookId = -1;
      }
    };
    dom.addEventListener('touchend', end);
    dom.addEventListener('touchcancel', end);
    const runBtn = document.getElementById('btn-run')!;
    runBtn.addEventListener('touchstart', (e) => {
      this.touchRun = !this.touchRun;
      runBtn.classList.toggle('on', this.touchRun);
      e.preventDefault();
    });
    document.getElementById('btn-punch')?.addEventListener('touchstart', (e) => {
      if (this.armed) { this.shots++; this.aimHold = 2.5; } else this.punchQueued = true;   // armed: it shoots
      e.preventDefault();
    });
    document.getElementById('btn-use')?.addEventListener('touchstart', (e) => {
      if (this.enabled) this.onUse?.();
      e.preventDefault();
    });
    document.getElementById('btn-lights')?.addEventListener('touchstart', (e) => {
      if (this.enabled) this.onKey?.('lights', true);
      e.preventDefault();
    });
    const horn = document.getElementById('btn-horn');
    horn?.addEventListener('touchstart', (e) => {
      if (this.enabled) this.onKey?.('horn', true);
      e.preventDefault();
    });
    horn?.addEventListener('touchend', (e) => {
      this.onKey?.('horn', false);
      e.preventDefault();
    });
    document.getElementById('btn-jump')!.addEventListener('touchstart', (e) => {
      this.jumpQueued = true;
      e.preventDefault();
    });
  }

  /**
   * Ramu: the generated teen model with a Mixamo skeleton (tools/blender/build_ramu_rig.py -> public/models/ramu_rig.glb),
   * with idle / walk / jog / run / jump clips. The file faces +Z, the game faces -Z, hence the half turn.
   */
  private buildBody(): void {
    gltfLoader().loadAsync(this.body.model).then((gltf) => {
      this.skeleton = gltf.scene;
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = false;                    // no dark shadow blob under / around him
        m.frustumCulled = false;                 // he is always on screen (and his clips carry him far: the hanging, the fall)
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.82;
        mat.metalness = 0;
        if (mat.map) mat.map.anisotropy = 8;
        this.tuneSkin(mat);
      });
      gltf.scene.rotation.y = Math.PI;
      this.model.add(gltf.scene);
      this.rider = new Rider(gltf.scene);
      this.tools = new LockTools(gltf.scene);
      if (NIGHT) {
        // a soft cool light just above him, so he does not vanish into the dark street
        const glow = new THREE.PointLight('#d8e4ff', 9, 9, 2);
        glow.position.set(0, 2.4, 0.6);
        this.root.add(glow);
      }
      this.face = new Face(gltf.scene);
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      const clips = prepareClips(gltf.animations);
      storeMicPose(gltf.scene, clips);
      for (const clip of clips) {
        const a = this.mixer.clipAction(clip);
        if (ONCE.has(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        this.actions[clip.name] = a;
      }
      this.mixer.addEventListener('finished', (e) => { if (e.action === this.actions.punch) this.punching = false; });
      this.play('idle', 0);
    }).catch((e) => console.error('Ramu model failed to load', e));
  }

  /** A faint, soft contact shadow under his feet (the real shadow map is off for him: it read as a dark halo). */
  private buildBlob(): void {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    r.addColorStop(0, 'rgba(0,0,0,0.55)');
    r.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    m.renderOrder = 1;
    this.blob = m;
    this.root.add(m);
  }

  /** stays on the ground (just above the footpath) while he jumps, and fades as he rises */
  private updateBlob(): void {
    if (!this.blob) return;
    const h = this.root.position.y;
    this.blob.position.y = 0.17 - h;
    const k = Math.max(0, 1 - h * 0.45);
    this.blob.scale.setScalar(0.7 + 0.3 * k);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.8 * k;
  }

  /**
   * Skin tone is applied live in the shader: pixels that look like skin (warm orange-brown; the shirt is blue and the satchel
   * yellower) get a gamma lift set by the admin page's skin tone. A faint self-glow, from the already toned colour, keeps him
   * readable in shade.
   */
  private tuneSkin(mat: THREE.MeshStandardMaterial): void {
    const apply = () => {
      const { gamma, tint } = skinParams(this.cfg.skinTone / 100);
      this.skin.gamma.value = gamma;
      this.skin.tint.value.setRGB(tint[0], tint[1], tint[2]);
    };
    apply();
    onSettingsChange(apply);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSkinGamma = this.skin.gamma;
      sh.uniforms.uSkinTint = this.skin.tint;
      sh.uniforms.uGlow = this.skin.glow;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uSkinGamma;
uniform vec3 uSkinTint;
uniform float uGlow;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 enc = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.4545));
  float m = clamp((enc.r - enc.b - 0.05) / 0.12, 0.0, 1.0) * clamp((0.82 - enc.g / max(enc.r, 0.001)) / 0.08, 0.0, 1.0)
          * step(enc.g, enc.r) * step(enc.b, enc.g);
  vec3 toned = min(vec3(1.0), pow(diffuseColor.rgb, vec3(uSkinGamma)) * uSkinTint);
  diffuseColor.rgb = mix(diffuseColor.rgb, toned, m);
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance = diffuseColor.rgb * uGlow;`);
    };
  }

  /** Crossfade to a clip (no-op if it is already the current one). */
  private play(name: string, fade = 0.18): THREE.AnimationAction | null {
    const next = this.actions[name];
    if (!next) return null;
    if (this.current !== next) {
      next.reset().setEffectiveWeight(1).play();
      if (this.current) this.current.crossFadeTo(next, fade, false);
      this.current = next;
    }
    return next;
  }

  /** Pick the clip from what Ramu is doing and set its playback speed to match the ground speed. */
  private animate(dt: number, hs: number, crouching: boolean): void {
    if (!this.mixer) return;
    const A = this.actions;
    const set = (name: string, fallback: string, scale: number): void => {
      const act = this.play(A[name] ? name : fallback);
      if (act) act.timeScale = scale;
    };
    this.reel = Math.max(0, this.reel - dt);
    // A punch must play to its end to be over (its 'finished' event clears `punching`), so nothing but a knock-out cuts
    // into it; the timer is a backstop in case the clip is ever faded out before it finishes.
    if (this.punching && (this.knockedOut || (this.punchT += dt) > 2.6 / this.cfg.punchSpeed)) this.punching = false;
    // woken after a knock-out: he gets up off the ground before he can do anything else
    if (this.wasOut && !this.knockedOut && A.get_up) { this.wake = CLIP_SECS.get_up / 1.6; A.get_up.reset(); }
    this.wasOut = this.knockedOut;
    this.wake = Math.max(0, this.wake - dt);
    if (hs >= 0.25 || this.knockedOut || this.reel > 0) this.gestureT = 0;      // walking off (or a blow) ends a gesture
    if (this.knockedOut) {
      const f = this.play(A.fall ? 'fall' : 'idle', 0.08);
      if (f) f.timeScale = 1.5;
    } else if (this.wake > 0) {
      const g = this.play('get_up', 0);
      if (g) g.timeScale = 1.6;
    } else if (this.punching) {
      this.play('punch', 0.05);
    } else if (this.reel > 0 && A[this.reelClip]) {
      const h = this.play(this.reelClip, 0.06);
      if (h) h.timeScale = this.reelClip === 'hit' ? 2.4 : 2.0;
    } else if (this.jumpPhase && A.jump && (this.jumpPhase !== 3 || this.jumpT < (hs > 1.2 ? 0.12 : (J_LAND[1] - J_LAND[0]) / 1.5))) {
      // the clip's time is set from the jump itself (see J_BEND): the bend, the flight stretched over the time in the
      // air (held just before touchdown if the fall is longer), then the landing at 1.5x
      const t = this.jumpT, ph = this.jumpPhase;
      const ct = ph === 1 ? J_BEND[0] + (J_BEND[1] - J_BEND[0]) * Math.min(1, t / WINDUP)
        : ph === 2 ? J_AIR[0] + (J_AIR[1] - J_AIR[0] - 0.06) * Math.min(1, t / this.airFor)
          : J_LAND[0] + t * 1.5;
      const j = this.play('jump', ph === 3 ? 0.04 : 0.1);
      if (j) { j.timeScale = 0; j.time = ct; }
    } else if (this.gestureT > 0 && this.gestureName && hs < 0.25) {
      this.gestureT -= dt;
      this.play(this.gestureName, 0.25);
    } else if (this.pose) {
      set(this.pose, 'idle', 1);
      const a = this.poseLast || this.poseAt !== null ? A[this.pose] : null;
      if (a) { a.timeScale = 0; a.time = this.poseLast ? a.getClip().duration - 0.001 : Math.min(a.getClip().duration - 0.001, Math.max(0, this.poseAt!)); a.setEffectiveWeight(1); }
    } else if (this.lockPick && hs < 0.8) {
      // the clips made for it (Katpootli): bent to a car's door, or crouched by a bike's front wheel, a glance round now and then
      if (this.lockPick.low) set(A.pick_low ? 'pick_low' : 'crouch', 'idle', 1);
      else if (A.pick_try) {
        // a car's: the four parts in turn, each clip held at the time the picking has got to
        const ph = pickPhase(this.lockPick.t, this.lockPick.need);
        const a = this.play(ph.clip, 0.15);
        if (a) {
          const len = a.getClip().duration;
          a.timeScale = 0;
          a.time = ph.clip === 'pick_lock' ? ph.at % len : Math.min(ph.at, len - 0.001);
        }
      } else set('pick_lock', 'idle', A.pick_lock ? 1 : 0.6);
    } else if (crouching) {
      if (hs < 0.25) set('crouch', 'idle', 1);
      else set('crouch_walk', 'crouch', Math.max(0.6, hs / 0.9));
    } else if (hs < 0.25) {
      set('idle', 'idle', 1);
    } else if (hs < (this.cfg.walkSpeed + this.cfg.runSpeed) / 2) {
      set('walk', 'walk', hs / 1.35);
    } else {
      set('run', 'run', hs / 5.0);
    }
    this.mixer.update(dt);
    this.face?.update(dt);
  }
}

const _bail = new THREE.Vector3();

function moveToward(v: number, target: number, step: number): number {
  return Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
}

const _pickFwd = new THREE.Vector3();
