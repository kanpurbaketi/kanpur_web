import * as THREE from 'three';
import { fmtNum, onLang, t, tk } from '../../i18n';
import type { Guide } from '../../ui/hud';
import { Subtitles } from '../../ui/subtitles';
import type { Face } from '../../world/face';
import { CutCam, type Shot } from './cutcam';

/*
 Runs a stage's story (src/game/story/stage<n>.ts), written as plain async code:
   scene(body)       a cutscene: bars, Skip, Ramu held still; the camera given back after
   say(who, ...)     a line: the subtitle, the speaker's mouth moving, the recording if there is one
                     (public/audio/voice/<stage>/<id>.mp3), else as long as the words take
   wait(s)           seconds of game time (cut short by Skip inside a scene)
   until(test)       until the player does something (Skip does not touch these)
   mission(...)      the box at the top: the mission, the hint for the next place on the way, how far it is;
                     resolves when the last place is reached
   shot / closeUp    the cutscene camera
 Skip ends a scene at once: every wait in it resolves straight away, so whatever the scene does after its waits (where
 people end up, what is set) still happens. update(dt) runs every frame after Ramu's, while the game is not paused.
*/

export type Who = 'ramu' | 'keeper' | 'guard';

export interface Waypoint {
  /** where it leads (for the distance shown) */
  at: [number, number];
  /** the hint shown on the way there */
  hint: string;
  done: (x: number, z: number) => boolean;
  /** the maps show a search area this wide (m) round `at`, not the exact spot */
  radius?: number;
}

export interface Actorish {
  position: THREE.Vector3;
  facing: number;
  headPosition(out: THREE.Vector3): boolean;
}

const WORDS_S = 0.33, LINE_PAD = 0.8;

export class Director {
  readonly subs = new Subtitles();
  readonly cam: CutCam;
  readonly box: MissionBox;
  /** Ramu is held still (a cutscene) */
  locked = false;
  private inScene = false;
  private skipping = false;
  private timers: { t: number; done: () => void }[] = [];
  private tests: { test: () => boolean; done: () => void }[] = [];
  private voice: HTMLAudioElement | null = null;
  private v = new THREE.Vector3();
  private now: { textKey: string; steps: Waypoint[]; i: number } | null = null;

  constructor(camera: THREE.PerspectiveCamera, private ramu: Actorish & { cinematic: boolean }, private stage: number) {
    this.cam = new CutCam(camera, ramu);
    this.box = new MissionBox();
    this.subs.onSkip = () => this.skip();
  }

  update(dt: number): void {
    for (const w of [...this.timers]) if ((w.t -= dt) <= 0) { this.timers.splice(this.timers.indexOf(w), 1); w.done(); }
    for (const w of [...this.tests]) if (w.test()) { this.tests.splice(this.tests.indexOf(w), 1); w.done(); }
    this.box.update(dt, this.ramu.position.x, this.ramu.position.z);
    this.cam.update(dt);
  }

  wait(s: number): Promise<void> {
    if (this.skipping || s <= 0) return Promise.resolve();
    return new Promise((done) => this.timers.push({ t: s, done }));
  }

  until(test: () => boolean): Promise<void> {
    if (test()) return Promise.resolve();
    return new Promise((done) => this.tests.push({ test, done }));
  }

  async scene(body: () => Promise<void>): Promise<void> {
    this.inScene = true;
    this.skipping = false;
    this.locked = true;
    this.subs.cinema(true);
    try {
      await body();
    } finally {
      this.inScene = false;
      this.skipping = false;
      this.subs.cinema(false);
      this.subs.hide();
      this.cam.release(0.8);
      this.locked = false;
    }
  }

  get skipped(): boolean { return this.skipping; }

  skip(): void {
    if (!this.inScene || this.skipping) return;
    this.skipping = true;
    this.voice?.pause();
    this.subs.hide();
    for (const w of this.timers.splice(0)) w.done();
  }

  /** a line: `key` is the i18n line (line.s<n>.<id>), its recording voice/<stage>/<id>.mp3 */
  async say(who: Who, face: Face | null | undefined, id: string): Promise<void> {
    if (this.skipping) return;
    const key = `line.s${this.stage}.${id}`;
    this.subs.show(t(`who.${who}` as Parameters<typeof t>[0]), tk(key));
    const recorded = await this.recording(`audio/voice/stage${this.stage}/${id}.mp3`);
    const secs = recorded ?? LINE_PAD + WORDS_S * tk(key).split(/\s+/).length;
    if (face) face.talking = true;
    await this.wait(secs);
    if (face) face.talking = false;
    this.voice?.pause();
    this.voice = null;
    this.subs.hide();
  }

  /** plays the recording if there is one: its length, or null */
  private recording(url: string): Promise<number | null> {
    return new Promise((done) => {
      const a = new Audio(url);
      const t0 = setTimeout(() => done(null), 600);
      a.addEventListener('loadedmetadata', () => {
        clearTimeout(t0);
        if (!isFinite(a.duration) || this.skipping) return done(null);
        this.voice = a;
        void a.play().catch(() => {});
        done(a.duration + 0.25);
      }, { once: true });
      a.addEventListener('error', () => { clearTimeout(t0); done(null); }, { once: true });
      a.load();
    });
  }

  // ---- missions ----

  async mission(n: number, textKey: string, steps: Waypoint[]): Promise<void> {
    this.now = { textKey, steps, i: 0 };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      this.now.i = i;
      this.box.set(n, textKey, s.hint, s.at);
      await this.until(() => s.done(this.ramu.position.x, this.ramu.position.z));
    }
    this.now = null;
    this.box.clear();
  }

  /** where the mission leads, for the maps: its last place, through the ones still ahead; null between missions and in cutscenes */
  guide(): Guide | null {
    const m = this.now;
    if (!m || this.inScene) return null;
    const ahead = m.steps.slice(m.i), last = ahead[ahead.length - 1];
    return {
      x: last.at[0], z: last.at[1], radius: last.radius,
      title: tk(m.textKey), hint: tk(ahead[0].hint),
      path: ahead.slice(0, -1).map((s) => s.at),
    };
  }

  // ---- the camera ----

  shot(s: Shot, secs = 0.9, drift?: THREE.Vector3): void { this.cam.to(s, this.skipping ? 0 : secs, drift); }

  /**
   * a shot of somebody from in front: `dist` metres off their face, `side` to one side (+ their right), `drop` how far
   * below the face it looks (0: the face; 0.35: the chest), `fov` degrees
   */
  front(who: Actorish, o: { dist: number; side?: number; up?: number; drop?: number; fov: number }): Shot {
    const head = new THREE.Vector3();
    if (!who.headPosition(head)) head.set(who.position.x, who.position.y + 1.4, who.position.z);
    const f = who.facing, fx = -Math.sin(f), fz = -Math.cos(f);        // the way they face
    const rx = -fz, rz = fx;                                             // their right
    const side = o.side ?? 0;
    const pos = new THREE.Vector3(head.x + fx * o.dist + rx * side, head.y + (o.up ?? 0), head.z + fz * o.dist + rz * side);
    return { pos, look: head.clone().setY(head.y - (o.drop ?? 0)), fov: o.fov };
  }

  /** towards (m/s) the face of whoever a shot looks at: a slow push in */
  pushIn(s: Shot, speed: number): THREE.Vector3 {
    return this.v.subVectors(s.look, s.pos).normalize().multiplyScalar(speed).clone();
  }
}

/** the box at the top: "Mission 1 · 120 m", the mission, the hint for the next place */
export class MissionBox {
  readonly root = document.createElement('div');
  private head = document.createElement('div');
  private num = document.createElement('span');
  private dist = document.createElement('span');
  private line = document.createElement('div');
  private hint = document.createElement('div');
  private n = 0;
  private textKey = '';
  private hintKey = '';
  /** where the mission leads now (the maps show it), or null */
  target: [number, number] | null = null;
  private last = '';
  private px = 0;
  private pz = 0;
  private flashT = 0;

  constructor() {
    this.root.className = 'obj';
    this.root.setAttribute('role', 'status');
    this.head.className = 'obj-head';
    this.line.className = 'obj-line';
    this.hint.className = 'obj-hint';
    this.head.append(this.num, this.dist);
    this.root.append(this.head, this.line, this.hint);
    this.root.hidden = true;
    document.body.append(this.root);
    onLang(() => this.draw(true));
  }

  set(n: number, textKey: string, hintKey: string, at: [number, number]): void {
    const fresh = n !== this.n || textKey !== this.textKey;
    this.n = n; this.textKey = textKey; this.hintKey = hintKey; this.target = at;
    this.root.hidden = false;
    this.flashT = fresh ? 1.6 : 0.8;
    this.root.classList.add('flash');
    this.draw(true);
  }

  clear(): void { this.root.hidden = true; this.target = null; }

  update(dt: number, x: number, z: number): void {
    this.px = x; this.pz = z;
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.root.classList.remove('flash');
    if (!this.root.hidden) this.draw(false);
  }

  private draw(force: boolean): void {
    if (!this.target) return;
    const m = Math.round(Math.hypot(this.target[0] - this.px, this.target[1] - this.pz) / 5) * 5;
    const key = `${this.textKey}|${this.hintKey}|${m}`;
    if (!force && key === this.last) return;
    this.last = key;
    this.num.textContent = t('obj.mission', { n: this.n });
    this.dist.textContent = t('obj.dist', { m: fmtNum(m) });
    this.line.textContent = tk(this.textKey);
    this.hint.textContent = tk(this.hintKey);
    this.hint.hidden = !this.hintKey;
  }
}

const css = `
.obj { position: fixed; left: 50%; top: 16px; z-index: 18; transform: translateX(-50%); width: min(440px, calc(100vw - 340px)); min-width: 240px;
  padding: 9px 14px 10px; border-radius: 12px; background: rgba(20,16,12,.72); color: #fff; font-family: system-ui, sans-serif;
  border-left: 4px solid #f2992a; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); pointer-events: none; transition: background .3s; }
.obj.flash { background: rgba(122,58,18,.88); }
.obj-head { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #f2c08a; }
.obj-line { margin-top: 3px; font-size: 16px; font-weight: 700; line-height: 1.3; }
.obj-hint { margin-top: 2px; font-size: 13px; color: #e9dccb; line-height: 1.35; }
@media (max-width: 760px) { .obj { top: auto; bottom: 200px; width: calc(100vw - 32px); min-width: 0; } }
`;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
