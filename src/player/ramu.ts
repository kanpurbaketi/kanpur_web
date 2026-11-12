import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CollisionWorld } from './collide';
import { Controls } from '../game/controls';
import { NIGHT } from '../world/night';
import { loadSettings, onSettingsChange, Settings } from '../game/settings';
import { skinParams } from '../game/skin';

const CROUCH = 1.2, ACCEL = 12, GRAVITY = 9.8, TURN = 10, RADIUS = 0.35;
const CAM_DIST = 3.2, EYE = 1.35;

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

  /** forget held keys (e.g. when a menu takes focus) */
  releaseKeys(): void {
    this.keys.clear();
    this.touchMove.set(0, 0);
  }

  update(dt: number): void {
    const input = new THREE.Vector2();
    if (this.enabled) {
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
    if (this.punchQueued && this.enabled && this.grounded && !this.punching && this.actions.punch) {
      this.punching = true;
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
    const step = ACCEL * speed * dt;
    this.vel.x = moveToward(this.vel.x, dir.x * speed, step);
    this.vel.z = moveToward(this.vel.z, dir.z * speed, step);
    this.vel.y -= GRAVITY * dt;

    const p = this.root.position;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    p.y += this.vel.y * dt;
    if (p.y <= 0) {
      p.y = 0;
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

    this.updateCamera();
  }

  private updateCamera(): void {
    const p = this.root.position;
    const px = p.x, py = p.y + EYE, pz = p.z;
    const cp = Math.cos(this.pitch);
    const bx = Math.sin(this.yaw) * cp, by = -Math.sin(this.pitch), bz = Math.cos(this.yaw) * cp;
    const t = this.world.raycast(px, py, pz, px + bx * CAM_DIST, py + by * CAM_DIST, pz + bz * CAM_DIST);
    const d = Math.max(0.4, CAM_DIST * t - 0.25);
    this.camera.position.set(px + bx * d, Math.max(0.3, py + by * d), pz + bz * d);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** a key (or mouse button) went down: the one-shot actions */
  private press(code: string): void {
    if (this.controls.matches('jump', code)) this.jumpQueued = true;
    if (this.controls.matches('punch', code)) this.punchQueued = true;
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
        m.userData.noAO = true;                  // and no ambient-occlusion halo from the post pass
        m.frustumCulled = false;                 // the skinned bounds do not follow the animation
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.82;
        mat.metalness = 0;
        if (mat.map) mat.map.anisotropy = 8;
        this.tuneSkin(mat);
      });
      gltf.scene.rotation.y = Math.PI;
      this.model.add(gltf.scene);
      if (NIGHT) {
        // a soft cool light just above him, so he does not vanish into the dark street
        const glow = new THREE.PointLight('#d8e4ff', 9, 9, 2);
        glow.position.set(0, 2.4, 0.6);
        this.root.add(glow);
      }
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        const name = clip.name.replace(/^.*\|/, '');
        const a = this.mixer.clipAction(clip);
        if (name === 'jump' || name === 'punch') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        this.actions[name] = a;
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
    if (this.punching) {
      this.play('punch', 0.05);
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
