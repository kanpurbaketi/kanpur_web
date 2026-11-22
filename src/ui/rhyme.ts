import { onLang, t, tk } from '../i18n';

/*
 The rhyme quiz (stage 1, part 2): a panel with the couplet's first line and four second lines to pick from (keys 1-4,
 a click or a tap), a ring that runs down (no answer in time counts as wrong). The pick flashes, then shows green (right)
 or red (wrong, and the right one green beside it). A rigged question turns every pick red and shows no right one.
 ask() resolves once the answer has been shown.
*/

export interface RhymeQuestion {
  /** i18n keys: the first line, and the four second lines */
  line: string;
  choices: string[];
  right: number;
  rigged?: boolean;
  secs?: number;
}

export interface RhymeAnswer { picked: number; right: boolean }

export class RhymeQuiz {
  readonly root = document.createElement('div');
  private title = document.createElement('div');
  private ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  private line = document.createElement('div');
  private list = document.createElement('div');
  private hint = document.createElement('div');
  private q: RhymeQuestion | null = null;
  private buttons: HTMLButtonElement[] = [];
  private done: ((a: RhymeAnswer) => void) | null = null;
  private left = 0;
  private last = 0;
  private raf = 0;
  /** true while the game is paused (the clock stops) */
  paused: () => boolean = () => false;

  constructor() {
    this.root.className = 'rq';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    const head = document.createElement('div');
    head.className = 'rq-head';
    this.title.className = 'rq-title';
    this.ring.setAttribute('viewBox', '0 0 36 36');
    this.ring.classList.add('rq-ring');
    const back = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const c of [back, this.arc]) { c.setAttribute('cx', '18'); c.setAttribute('cy', '18'); c.setAttribute('r', '15'); }
    back.setAttribute('class', 'rq-ring-back');
    this.arc.setAttribute('class', 'rq-ring-arc');
    this.ring.append(back, this.arc);
    head.append(this.title, this.ring);
    this.line.className = 'rq-line';
    this.list.className = 'rq-list';
    this.hint.className = 'rq-hint';
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rq-choice';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.pick(i); });
      this.buttons.push(b);
      this.list.append(b);
    }
    this.root.append(head, this.line, this.list, this.hint);
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.done) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4) { e.preventDefault(); e.stopPropagation(); this.pick(n - 1); }
    }, true);
    onLang(() => this.draw());
  }

  ask(q: RhymeQuestion): Promise<RhymeAnswer> {
    this.q = q;
    this.left = q.secs ?? 20;
    this.last = performance.now();
    for (const b of this.buttons) { b.className = 'rq-choice'; b.disabled = false; }
    this.draw();
    this.root.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();   // the mouse, to click a line
    const p = new Promise<RhymeAnswer>((done) => { this.done = done; });
    this.tick();
    return p;
  }

  private draw(): void {
    const q = this.q;
    if (!q) return;
    this.title.textContent = t('quiz.title');
    this.line.textContent = tk(q.line);
    this.hint.textContent = t('quiz.hint');
    q.choices.forEach((k, i) => { this.buttons[i].innerHTML = `<b>${i + 1}</b><span></span>`; this.buttons[i].lastElementChild!.textContent = tk(k); });
  }

  private tick = (): void => {
    if (!this.done || !this.q) return;
    const now = performance.now(), dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused()) this.left -= dt;
    const all = this.q.secs ?? 20, k = Math.max(0, this.left / all), C = 2 * Math.PI * 15;
    this.arc.setAttribute('stroke-dasharray', `${(C * k).toFixed(2)} ${C.toFixed(2)}`);
    this.ring.classList.toggle('low', this.left < 5);
    if (this.left <= 0) { this.pick(-1); return; }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** -1: time ran out */
  private pick(i: number): void {
    const q = this.q, done = this.done;
    if (!q || !done) return;
    this.done = null;
    cancelAnimationFrame(this.raf);
    for (const b of this.buttons) b.disabled = true;
    const right = i === q.right && !q.rigged;
    if (i >= 0) this.buttons[i].classList.add('picked');
    setTimeout(() => {
      if (i >= 0) this.buttons[i].classList.add(right ? 'right' : 'wrong');
      if (!right && !q.rigged) this.buttons[q.right].classList.add('right');
      setTimeout(() => { this.root.hidden = true; done({ picked: i, right }); }, 1300);
    }, 650);
  }
}

const css = `
.rq { position: fixed; left: 50%; bottom: 120px; z-index: 30; transform: translateX(-50%); width: min(620px, calc(100vw - 32px));
  padding: 14px 16px 12px; border-radius: 14px; background: rgba(20,16,12,.86); color: #fff; font-family: system-ui, sans-serif;
  border-left: 4px solid #f2992a; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); box-sizing: border-box; }
.rq-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.rq-title { font-size: 12px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #f2c08a; }
.rq-ring { width: 30px; height: 30px; transform: rotate(-90deg); flex: none; }
.rq-ring-back { fill: none; stroke: rgba(255,255,255,.18); stroke-width: 4; }
.rq-ring-arc { fill: none; stroke: #f2c08a; stroke-width: 4; stroke-linecap: round; transition: stroke .3s; }
.rq-ring.low .rq-ring-arc { stroke: #ff6b5a; }
.rq-line { margin: 6px 0 10px; font-size: 21px; font-weight: 700; line-height: 1.35; }
.rq-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rq-choice { display: flex; align-items: flex-start; gap: 9px; text-align: left; padding: 10px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.07); color: #fff; font: inherit; font-size: 15px; line-height: 1.35;
  transition: background .2s, border-color .2s; }
.rq-choice:hover:not(:disabled) { background: rgba(242,153,42,.22); border-color: #f2992a; }
.rq-choice b { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px;
  background: rgba(242,192,138,.25); color: #f2c08a; }
.rq-choice:disabled { cursor: default; }
.rq-choice.picked { background: rgba(242,153,42,.35); border-color: #f2992a; }
.rq-choice.right { background: rgba(60,170,90,.45); border-color: #5fd17f; }
.rq-choice.wrong { background: rgba(200,50,40,.5); border-color: #ff6b5a; }
.rq-hint { margin-top: 8px; font-size: 12px; color: #cdbfae; }
@media (max-width: 760px) { .rq { bottom: 96px; padding: 12px; } .rq-line { font-size: 18px; } .rq-list { grid-template-columns: 1fr; gap: 6px; } .rq-choice { font-size: 14px; padding: 9px 10px; } }
`;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
