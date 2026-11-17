import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CollisionWorld } from './collide';
import { Controls } from '../game/controls';
import { NIGHT } from '../world/night';
import { loadSettings, onSettingsChange, Settings } from '../game/settings';
import { skinParams } from '../game/skin';
import { CLIP_SECS, ONCE, prepareClips, PUNCH_LANDS } from '../world/actors';

const CROUCH = 1.2, ACCEL = 12, GRAVITY = 9.8, TURN = 10, RADIUS = 0.35;
const CAM_DIST = 3.2, EYE = 1.35;

/** Ramu on a vehicle (set every frame by the driving): his seat in the world, which way it faces, how he sits, and the chase camera */
export interface Ride {
  x: number; y: number; z: number; heading: number; pose: 'ride' | 'drive';
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
  private punchT = 0;      // seconds since the punch in the air began
  private reelClip = 'hit';   // which way he takes this blow (head / body, turn about)
  private wake = 0;        // seconds left of getting up after a knock-out (no control while it runs)
  private wasOut = false;
  private grounded = true;
  private keys = new Set<string>();
  private touchMove = new THREE.Vector2();
  private touchRun = false;
  private jumpQueued = false;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current: THREE.AnimationAction | null = null;
  private wasGrounded = true;
  private punchQueued = false;
  private punching = false;
  /** admin settings (walk / run / jump / punch speeds, skin tone); updated live from the admin tab */
  private cfg: Settings = loadSettings();
  private blob: THREE.Mesh | null = null;
  /** on a vehicle: he sits, posed, and the camera follows the vehicle; null on foot */
  ride: Ride | null = null;
  /** the get on / off key (or button) was pressed */
  onUse: (() => void) | null = null;
  private body: THREE.Object3D | null = null;
  private seated = new Map<string, THREE.Mesh>();
  private lookIdle = 0;    // seconds since the player last turned the camera
  private skin = { gamma: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) }, glow: { value: NIGHT ? 0.2 : 0.1 } };

  constructor(private camera: THREE.PerspectiveCamera, private world: CollisionWorld, dom: HTMLElement, private controls: Controls) {
    onSettingsChange((s) => (this.cfg = s));
    this.buildBody();
    this.buildBlob();
    this.root.add(this.model);
    this.bindInput(dom);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** horizontal speed, m/s */
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** the way he faces (radians, the same convention as a pedestrian's heading) */
  get facing(): number {
    return this.model.rotation.y;
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
    this.root.position.set(x, this.world.floorAt(x, z, 0.5), z);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.punching = false;
  }

  update(dt: number): void {
    this.lookIdle += dt;
    const r = this.ride;
    if (this.body) this.body.visible = !r;
    if (this.blob) this.blob.visible = !r;
    for (const [pose, m] of this.seated) m.visible = !!r && r.pose === pose;
    if (r) {
      this.root.position.set(r.x, r.y, r.z);
      this.vel.set(0, 0, 0);
      this.model.rotation.y = r.heading + Math.PI;
      this.jumpQueued = this.punchQueued = false;
      this.punching = false;
      // the camera swings round behind the vehicle as it goes, unless the player is looking about
      if (this.lookIdle > 1.2 && Math.abs(r.speed) > 1.5) {
        const want = r.heading + Math.PI;
        const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
        this.yaw += d * Math.min(1, dt * 2.2);
        this.pitch += (-0.22 - this.pitch) * Math.min(1, dt * 1.5);
      }
      this.updateCamera(r.cx, r.camH, r.cz, r.cam);
      return;
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
      if (this.jumpQueued && this.grounded) {
        this.vel.y = this.cfg.jumpSpeed;
        this.grounded = false;
        this.jumps++;
      }
    }
    this.jumpQueued = false;
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
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    p.y += this.vel.y * dt;
    const floor = this.world.floorAt(p.x, p.z, p.y);
    if (this.grounded && this.vel.y <= 0 && p.y > floor && p.y - floor < 0.45) p.y = floor;   // walking down a stair keeps his feet on it
    if (p.y <= floor) {
      p.y = floor;
      this.vel.y = 0;
      this.grounded = true;
    }
    [p.x, p.z] = this.world.resolve(p.x, p.z, RADIUS, p.y);

    // face movement direction + simple limb swing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (dir.lengthSq() > 0.0025) {
      const want = Math.atan2(-dir.x, -dir.z);
      let d = want - this.model.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.model.rotation.y += d * Math.min(1, TURN * dt);
    }
    this.animate(dt, hs, crouching);
    this.updateBlob();

    this.updateCamera(p.x, p.y + EYE, p.z, CAM_DIST);
  }

  /** the camera on its arm from the point (px, py, pz), pulled in where something is in the way */
  private updateCamera(px: number, py: number, pz: number, dist: number): void {
    const cp = Math.cos(this.pitch);
    const bx = Math.sin(this.yaw) * cp, by = -Math.sin(this.pitch), bz = Math.cos(this.yaw) * cp;
    const t = this.world.raycast(px, py, pz, px + bx * dist, py + by * dist, pz + bz * dist);
    const d = Math.max(0.4, dist * t - 0.25);
    // squeezed against something (a wall behind him, the rail of a narrow gallery): rise as it closes in, to look over
    // his head rather than into the back of it
    const lift = Math.max(0, 1.7 - d) * 0.28;
    this.camera.position.set(px + bx * d, Math.max(0.3, py + by * d + lift), pz + bz * d);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** a key (or mouse button) went down: the one-shot actions */
  private press(code: string): void {
    if (this.controls.matches('jump', code)) this.jumpQueued = true;
    if (this.controls.matches('punch', code)) this.punchQueued = true;
    if (this.controls.matches('use', code) && this.enabled) this.onUse?.();
  }

  private bindInput(dom: HTMLElement): void {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (!e.repeat) this.press(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
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
      this.punchQueued = true;
      e.preventDefault();
    });
    document.getElementById('btn-use')?.addEventListener('touchstart', (e) => {
      if (this.enabled) this.onUse?.();
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
    new GLTFLoader().loadAsync('models/ramu_rig.glb').then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = false;                    // no dark shadow blob under / around him
        // He stays in the ambient-occlusion pass: left out of it, the shading of whatever stood behind him (a railing,
        // a lattice) was drawn across his body, as if he were see-through.
        m.frustumCulled = false;                 // the skinned bounds do not follow the animation
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.82;
        mat.metalness = 0;
        if (mat.map) mat.map.anisotropy = 8;
        this.tuneSkin(mat);
      });
      gltf.scene.rotation.y = Math.PI;
      this.model.add(gltf.scene);
      this.body = gltf.scene;
      // how he sits on a vehicle: still poses of the same body (tools/blender/build_figures.py --char ramu), in his own material
      let mat: THREE.Material | null = null;
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !mat) mat = (o as THREE.Mesh).material as THREE.Material; });
      new GLTFLoader().loadAsync('models/figures/ramu.glb').then((f) => {
        f.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !mat) return;
          const seat = new THREE.Mesh(m.geometry.rotateY(Math.PI), mat);    // the file faces +z, as the rig does
          seat.visible = false;
          seat.castShadow = false;
          this.seated.set(m.name, seat);
          this.model.add(seat);
        });
      }).catch((e) => console.error('Ramu seated poses failed to load', e));
      if (NIGHT) {
        // a soft cool light just above him, so he does not vanish into the dark street
        const glow = new THREE.PointLight('#d8e4ff', 9, 9, 2);
        glow.position.set(0, 2.4, 0.6);
        this.root.add(glow);
      }
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of prepareClips(gltf.animations)) {
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
    m.userData.noAO = true;
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
    } else if (!this.grounded) {
      // the jump clip is ~2.2 s with a wind-up; the game's jump is ~1 s, hence the double speed
      if (this.wasGrounded) { const j = this.play('jump', 0.08); if (j) { j.reset().play(); j.timeScale = 2.0; } }
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
    this.wasGrounded = this.grounded;
    this.mixer.update(dt);
  }
}

function moveToward(v: number, target: number, step: number): number {
  return Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
}
