import { onLang, t } from '../i18n';

type Words = 'grip.title' | 'leap.title' | 'leap.castle';

/*
 The timed prompt (stage 1, part 3, on the giant wheel): a call ("Jump!"), a ring running down, and Space (or a tap on
 the big button) before it runs out. grab() resolves true if it was in time. `kind` picks the words: 'grip' (your grip is
 slipping: grab), 'leap' (jump to the cabin behind; or, with grab's `title`, any other call to jump).
*/

export class GripPrompt {
  private root = document.createElement('div');
  private title = document.createElement('div');
  private ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  private btn = document.createElement('button');
  private key = document.createElement('div');
  private done: ((ok: boolean) => void) | null = null;
  private left = 0;
  private all = 1;
  private last = 0;
  private raf = 0;
  private titleKey: Words = 'grip.title';

  constructor(private kind: 'grip' | 'leap' = 'grip') {
    this.root.className = 'grip';
    this.root.hidden = true;
    this.title.className = 'grip-title';
    this.ring.setAttribute('viewBox', '0 0 100 100');
    this.ring.classList.add('grip-ring');
    const back = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const c of [back, this.arc]) { c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', '46'); }
    back.setAttribute('class', 'grip-ring-back');
    this.arc.setAttribute('class', 'grip-ring-arc');
    this.ring.append(back, this.arc);
    this.btn.type = 'button';
    this.btn.className = 'grip-btn';
    this.btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.finish(true); });
    const wrap = document.createElement('div');
    wrap.className = 'grip-wrap';
    wrap.append(this.ring, this.btn);
    this.key.className = 'grip-key';
    this.root.append(this.title, wrap, this.key);
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.done || e.code !== 'Space') return;
      e.preventDefault();
      e.stopPropagation();
      this.finish(true);
    }, true);
    onLang(() => this.draw());
  }

  /** the prompt for `secs`: true if he grabbed in time */
  grab(secs: number, title?: Words): Promise<boolean> {
    this.titleKey = title ?? `${this.kind}.title`;
    this.all = this.left = secs;
    this.last = performance.now();
    this.draw();
    this.root.hidden = false;
    this.root.classList.remove('ok', 'miss');
    const p = new Promise<boolean>((done) => { this.done = done; });
    this.tick();
    return p;
  }

  private draw(): void {
    this.title.textContent = t(this.titleKey);
    this.btn.textContent = t(`${this.kind}.tap`);
    this.key.textContent = t('grip.key', { key: 'Space' });
  }

  private tick = (): void => {
    if (!this.done) return;
    const now = performance.now();
    this.left -= Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const C = 2 * Math.PI * 46, k = Math.max(0, this.left / this.all);
    this.arc.setAttribute('stroke-dasharray', `${(C * k).toFixed(1)} ${C.toFixed(1)}`);
    if (this.left <= 0) { this.finish(false); return; }
    this.raf = requestAnimationFrame(this.tick);
  };

  private finish(ok: boolean): void {
    const done = this.done;
    if (!done) return;
    this.done = null;
    cancelAnimationFrame(this.raf);
    this.root.classList.add(ok ? 'ok' : 'miss');
    setTimeout(() => { this.root.hidden = true; }, 350);
    done(ok);
  }

  dispose(): void { this.done = null; cancelAnimationFrame(this.raf); this.root.remove(); }
}

const css = `
.grip { position: fixed; left: 50%; bottom: 110px; z-index: 30; transform: translateX(-50%); display: flex; flex-direction: column;
  align-items: center; gap: 8px; font-family: system-ui, sans-serif; color: #fff; pointer-events: none; }
.grip[hidden] { display: none; }
.grip-title { font-size: 20px; font-weight: 800; white-space: nowrap; text-shadow: 0 2px 6px rgba(0,0,0,.7); }
.grip-wrap { position: relative; width: 104px; height: 104px; }
.grip-ring { position: absolute; inset: 0; transform: rotate(-90deg); }
.grip-ring-back { fill: rgba(20,16,12,.6); stroke: rgba(255,255,255,.2); stroke-width: 6; }
.grip-ring-arc { fill: none; stroke: #f2992a; stroke-width: 6; stroke-linecap: round; }
.grip-btn { position: absolute; inset: 12px; border-radius: 50%; border: none; background: #f2992a; color: #1d140c; font: inherit;
  font-size: 18px; font-weight: 800; cursor: pointer; pointer-events: auto; touch-action: manipulation; }
.grip-key { font-size: 13px; color: #f2dcc4; text-shadow: 0 1px 4px rgba(0,0,0,.8); }
.grip.ok .grip-btn { background: #5fd17f; }
.grip.miss .grip-btn { background: #ff6b5a; }
@media (max-width: 760px) { .grip { bottom: 36vh; } .grip-key { display: none; } }   /* above the mission box */
`;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
