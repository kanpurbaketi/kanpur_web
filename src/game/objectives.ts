import { fmtNum, onLang, tk } from '../i18n';
import { GATE, inMela } from '../world/melaSite';
import { STATUE } from '../world/stage1Site';

/*
 A stage's instructions: steps, one at a time, in a box at the top of the screen with how far the next place is.
 A step is done when Ramu gets there; the last one is the stage's goal. Lines are i18n keys (stage.<n>.step<i>).
*/

export interface Step {
  /** where the step leads (for the distance shown) */
  at: [number, number];
  done: (x: number, z: number) => boolean;
}

/** Stage 1, from Chhatrapati Shivaji chowk to the mela: through the gate, down the park road, right at the Nagar Nigam, in at the mela's gate */
const STAGE1: Step[] = [
  { at: [STATUE[0] - 2, 58], done: (_x, z) => z > 58 },                       // through the Shivaji Putla gate
  { at: [-42, 330], done: (_x, z) => z > 318 },                                // down the park road to the Nagar Nigam
  { at: [-90, 340], done: (x, z) => z > 318 && x < -75 },                     // right, along the Nagar Nigam's wall
  { at: [GATE.x, GATE.z], done: (x, z) => inMela(x, z) },                     // the mela on the right: in at its gate
];

export const STEPS: Record<number, Step[]> = { 1: STAGE1 };

export class Objectives {
  readonly root = document.createElement('div');
  private i = 0;
  private line = document.createElement('div');
  private dist = document.createElement('span');
  private count = document.createElement('span');
  private flashT = 0;
  finished = false;

  constructor(private n: number, private steps: Step[], private onDone: () => void) {
    this.root.className = 'obj';
    this.root.setAttribute('role', 'status');
    const head = document.createElement('div');
    head.className = 'obj-head';
    head.append(this.count, this.dist);
    this.line.className = 'obj-line';
    this.root.append(head, this.line);
    this.root.hidden = true;
    document.body.append(this.root);
    onLang(() => this.draw(true));
  }

  /** shown once the stage has been started (after its introduction) */
  start(): void { this.root.hidden = false; }

  get step(): number { return this.i; }

  update(dt: number, x: number, z: number): void {
    if (this.finished || this.root.hidden) return;
    let moved = false;
    while (this.i < this.steps.length && this.steps[this.i].done(x, z)) { this.i++; moved = true; }
    if (this.i >= this.steps.length) {
      this.finished = true;
      this.root.classList.add('done');
      this.line.textContent = tk(`stage.${this.n}.goal`) + ' ✓';
      this.dist.textContent = '';
      setTimeout(() => (this.root.hidden = true), 6000);
      this.onDone();
      return;
    }
    if (moved) { this.flashT = 1.2; this.root.classList.add('flash'); }
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.root.classList.remove('flash');
    this.px = x; this.pz = z;
    this.draw(moved);
  }

  private last = '';
  private px = 0;
  private pz = 0;
  private draw(force: boolean): void {
    if (this.finished || this.i >= this.steps.length) return;
    const [ax, az] = this.steps[this.i].at;
    const m = Math.round(Math.hypot(ax - this.px, az - this.pz) / 5) * 5;
    const key = `${this.i}|${m}`;
    if (!force && key === this.last) return;
    this.last = key;
    this.count.textContent = tk('obj.step', { i: this.i + 1, n: this.steps.length });
    this.dist.textContent = tk('obj.dist', { m: fmtNum(m) });
    this.line.textContent = tk(`stage.${this.n}.step${this.i + 1}`);
  }
}

const css = `
.obj { position: fixed; left: 50%; top: 16px; z-index: 18; transform: translateX(-50%); width: min(420px, calc(100vw - 340px)); min-width: 240px;
  padding: 9px 14px 10px; border-radius: 12px; background: rgba(20,16,12,.72); color: #fff; font-family: system-ui, sans-serif;
  border-left: 4px solid #f2992a; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); pointer-events: none; transition: background .3s; }
.obj.flash { background: rgba(122,58,18,.85); }
.obj.done { border-left-color: #4caf50; }
.obj-head { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #f2c08a; }
.obj-line { margin-top: 3px; font-size: 15px; font-weight: 600; line-height: 1.35; }
@media (max-width: 760px) { .obj { top: auto; bottom: 200px; width: calc(100vw - 32px); min-width: 0; } }
`;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
