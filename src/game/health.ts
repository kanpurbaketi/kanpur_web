import { onLang, t } from '../i18n';
/*
 Ramu's life bar (top-left, under the menu button). hurt(n) lowers it with a short red flash and a hit cooldown;
 it refills slowly after a few quiet seconds; at zero Ramu is knocked out and wakes at the spawn point with a full bar.
*/
export class Health {
  readonly max = 100;
  value = 100;
  private since = 99;     // seconds since last hurt
  private cooldown = 0;   // no double hits inside this window
  private out = 0;        // knocked-out countdown
  private fill: HTMLElement;
  private num: HTMLElement;
  private flash: HTMLElement;
  private banner: HTMLElement;

  constructor(private onKnockedOut: () => void) {
    const root = document.createElement('div');
    root.id = 'life';
    root.innerHTML = '<span class="life-name"></span><div class="life-track"><div class="life-fill"></div></div><span class="life-num"></span>';
    const name = root.querySelector('.life-name') as HTMLElement;
    document.body.append(root);
    this.fill = root.querySelector('.life-fill') as HTMLElement;
    this.num = root.querySelector('.life-num') as HTMLElement;
    this.flash = document.createElement('div');
    this.flash.id = 'hurt-flash';
    this.banner = document.createElement('div');
    this.banner.id = 'ko-banner';
    const words = () => { name.textContent = t('life.name'); this.banner.textContent = t('life.ko'); };
    words();
    onLang(words);
    document.body.append(this.flash, this.banner);
    this.draw();
  }

  get knockedOut(): boolean { return this.out > 0; }

  hurt(n: number): void {
    if (this.out > 0 || this.cooldown > 0) return;
    this.value = Math.max(0, this.value - n);
    this.since = 0;
    this.cooldown = 0.8;
    this.flash.style.opacity = '0.55';
    if (this.value <= 0) {
      this.out = 2.5;
      this.banner.style.opacity = '1';
    }
    this.draw();
  }

  heal(n: number): void {
    this.value = Math.min(this.max, this.value + n);
    this.draw();
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.since += dt;
    const f = parseFloat(this.flash.style.opacity || '0');
    if (f > 0) this.flash.style.opacity = String(Math.max(0, f - dt * 1.2));
    if (this.out > 0) {
      this.out -= dt;
      if (this.out <= 0) {
        this.value = this.max;
        this.banner.style.opacity = '0';
        this.draw();
        this.onKnockedOut();
      }
    } else if (this.since > 6 && this.value < this.max) {
      this.value = Math.min(this.max, this.value + 3 * dt);
      this.draw();
    }
  }

  private draw(): void {
    const p = this.value / this.max;
    this.fill.style.width = `${p * 100}%`;
    this.fill.style.background = p > 0.5 ? '#4caf50' : p > 0.25 ? '#e0a526' : '#d32f2f';
    this.num.textContent = String(Math.ceil(this.value));
  }
}
