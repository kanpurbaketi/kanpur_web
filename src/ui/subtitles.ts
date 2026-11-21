import { onLang, t } from '../i18n';

/*
 What is said, on screen: the speaker's name and the line at the bottom, black bars top and bottom while a cutscene
 runs, and its Skip button (Enter does the same).
*/

export class Subtitles {
  private top = document.createElement('div');
  private bottom = document.createElement('div');
  private box = document.createElement('div');
  private who = document.createElement('div');
  private line = document.createElement('div');
  private skip = document.createElement('button');
  onSkip: (() => void) | null = null;

  constructor() {
    this.top.className = 'cine-bar top';
    this.bottom.className = 'cine-bar bottom';
    this.box.className = 'subs';
    this.box.setAttribute('role', 'status');
    this.box.setAttribute('aria-live', 'polite');
    this.who.className = 'subs-who';
    this.line.className = 'subs-line';
    this.box.append(this.who, this.line);
    this.box.hidden = true;
    this.skip.className = 'cine-skip';
    this.skip.type = 'button';
    this.skip.hidden = true;
    this.skip.addEventListener('click', () => this.onSkip?.());
    const label = () => (this.skip.textContent = `${t('story.skip')} ⏭`);
    label();
    onLang(label);
    addEventListener('keydown', (e) => {
      if (!this.skip.hidden && (e.code === 'Enter' || e.code === 'NumpadEnter') && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.onSkip?.();
      }
    });
    document.body.append(this.top, this.bottom, this.box, this.skip);
  }

  /** the bars and Skip, for a cutscene */
  cinema(on: boolean): void {
    document.body.classList.toggle('cinema', on);
    this.skip.hidden = !on;
    if (on) document.exitPointerLock?.();
  }

  show(who: string, text: string): void {
    this.who.textContent = who;
    this.who.hidden = !who;
    this.line.textContent = text;
    this.box.hidden = false;
  }

  hide(): void { this.box.hidden = true; }
}

const css = `
.cine-bar { position: fixed; left: 0; right: 0; height: 0; z-index: 17; background: #000; transition: height .45s ease; pointer-events: none; }
.cine-bar.top { top: 0; }
.cine-bar.bottom { bottom: 0; }
body.cinema .cine-bar { height: 9vh; }
body.cinema #hint, body.cinema #life, body.cinema #minimap, body.cinema .sh-chip, body.cinema .menu-btn, body.cinema .obj,
body.cinema .tbtn, body.cinema #stick, body.cinema #use-tip { visibility: hidden; }
.subs { position: fixed; left: 50%; bottom: calc(9vh + 18px); z-index: 18; transform: translateX(-50%); max-width: min(760px, calc(100vw - 32px));
  padding: 8px 16px 10px; border-radius: 10px; background: rgba(0,0,0,.55); color: #fff; text-align: center; font-family: system-ui, sans-serif;
  pointer-events: none; }
body:not(.cinema) .subs { bottom: 120px; }
.subs-who { font-size: 12px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: #f2c08a; }
.subs-line { font-size: 19px; font-weight: 600; line-height: 1.4; text-shadow: 0 1px 3px rgba(0,0,0,.6); white-space: pre-line; }
.cine-skip { position: fixed; right: 20px; bottom: calc(9vh + 18px); z-index: 19; padding: 8px 14px; border: 1px solid rgba(255,255,255,.5);
  border-radius: 8px; background: rgba(0,0,0,.45); color: #fff; font: 600 14px system-ui, sans-serif; cursor: pointer; }
.cine-skip:hover { background: rgba(0,0,0,.7); }
.cine-skip:focus-visible { outline: 2px solid #f2992a; outline-offset: 2px; }
@media (max-width: 600px) { .subs-line { font-size: 16px; } .cine-skip { bottom: auto; top: calc(9vh + 10px); } }
`;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
