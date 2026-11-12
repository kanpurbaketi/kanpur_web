import { Stats } from '../game/stats';
import type { Part } from '../game/parts';
import { ACTIONS, Action, Controls, DEFAULTS, label } from '../game/controls';
import { MapData, P2, centroid } from '../world/types';
import { Hud, PX_PER_M } from './hud';

const PROFILE_KEY = 'kanpur.profile.v1';
type Item = 'profile' | 'map' | 'places' | 'stats' | 'controls';
const TITLES: Record<Item, string> = { profile: 'Profile', map: 'Map', places: 'Places', stats: 'Statistics', controls: 'Controls' };

export interface MenuDeps {
  map: MapData;
  hud: Hud;
  stats: Stats;
  controls: Controls;
  /** the part of Kanpur that is loaded, and the parts a player may go to (open and built) */
  area: string;
  parts: Part[];
  player: () => { x: number; z: number; yaw: number };
  /** called when a panel opens / closes, so the game can pause */
  onPause: (paused: boolean) => void;
}

/**
 * Top-left menu button -> dropdown (Profile, Map, Statistics) -> one panel at a time.
 * The game is paused while a panel is open. Esc closes; M toggles the map.
 */
export class Menu {
  private btn = el('button', 'menu-btn');
  private drop = el('div', 'menu-drop');
  private overlay = el('div', 'menu-overlay');
  private panel = el('div', 'menu-panel');
  private title = el('h2');
  private body = el('div', 'menu-body');
  private open: Item | null = null;
  private mapView = { cx: 0, cz: 0, scale: 0 }; // metres at panel centre, canvas px per metre

  constructor(private d: MenuDeps) {
    this.btn.innerHTML = '<span></span><span></span><span></span>';
    this.btn.setAttribute('aria-label', 'Menu');
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.addEventListener('click', () => this.toggleDrop());

    for (const it of Object.keys(TITLES) as Item[]) {
      const b = el('button', 'menu-item');
      b.innerHTML = `${ICONS[it]}<span>${TITLES[it]}</span>`;
      b.addEventListener('click', () => this.show(it));
      this.drop.append(b);
    }

    const head = el('div', 'menu-head');
    const close = el('button', 'menu-close');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    head.append(this.title, close);
    this.panel.append(head, this.body);
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.overlay.append(this.panel);
    this.overlay.addEventListener('click', (e) => e.target === this.overlay && this.close());

    document.body.append(this.btn, this.drop, this.overlay);

    addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (this.drop.classList.contains('on') && !this.drop.contains(t) && !this.btn.contains(t)) this.toggleDrop(false);
    });
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) {
        if (e.code === 'Escape') (e.target as HTMLInputElement).blur();
        return;
      }
      if (e.code === 'Escape' && (this.open || this.drop.classList.contains('on'))) this.close();
      if (this.d.controls.matches('map', e.code) && this.btn.style.display !== 'none') this.open === 'map' ? this.close() : this.show('map');
    });
  }

  set visible(v: boolean) {
    this.btn.style.display = v ? '' : 'none';
  }

  private toggleDrop(on = !this.drop.classList.contains('on')): void {
    this.drop.classList.toggle('on', on);
    this.btn.setAttribute('aria-expanded', String(on));
    if (on) document.exitPointerLock?.();
  }

  private show(it: Item): void {
    this.toggleDrop(false);
    const wasOpen = this.open !== null;
    this.open = it;
    this.title.textContent = TITLES[it];
    this.body.replaceChildren();
    this.panel.dataset.item = it;
    this.overlay.classList.add('on');
    if (!wasOpen) this.d.onPause(true);
    if (it === 'profile') this.renderProfile();
    else if (it === 'map') this.renderMap();
    else if (it === 'controls') this.renderControls();
    else if (it === 'places') this.renderPlaces();
    else this.renderStats();
  }

  close(): void {
    this.toggleDrop(false);
    if (!this.open) return;
    this.open = null;
    this.overlay.classList.remove('on');
    this.d.onPause(false);
  }

  // ---------- Profile ----------
  private renderProfile(): void {
    const prof = loadProfile();
    const s = this.d.stats.data;
    const avatar = el('div', 'avatar');
    const name = el('input', 'name-input') as HTMLInputElement;
    name.value = prof.name;
    name.maxLength = 24;
    name.placeholder = 'Your name';
    name.setAttribute('aria-label', 'Player name');
    const setAvatar = () => (avatar.textContent = (name.value.trim()[0] ?? '?').toUpperCase());
    setAvatar();
    name.addEventListener('input', () => {
      setAvatar();
      saveProfile({ ...prof, name: name.value.trim() || 'Player' });
    });
    const top = el('div', 'profile-top');
    const label = el('label', 'field');
    label.append(text('span', 'Name'), name);
    top.append(avatar, label);
    this.body.append(top, rows([
      ['Character', 'Ramu'],
      ['Area', this.d.map.title || 'Moti Jheel, Kanpur'],
      ['Playing since', new Date(s.firstPlayed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })],
      ['Sessions', String(s.sessions)],
    ]));
  }

  // ---------- Map ----------
  private renderMap(): void {
    const canvas = el('canvas', 'map-canvas') as HTMLCanvasElement;
    const bar = el('div', 'map-bar');
    const mk = (label: string, aria: string, fn: () => void) => {
      const b = el('button', 'map-btn');
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      bar.append(b);
    };
    this.body.append(canvas, bar);

    const [x0, z0, x1, z1] = this.d.map.bounds;
    const fit = () => Math.min(canvas.clientWidth / (x1 - x0), canvas.clientHeight / (z1 - z0));
    const me = this.d.player();
    const draw = () => this.drawMap(canvas);
    requestAnimationFrame(() => {
      const dpr = Math.min(2, devicePixelRatio);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      this.mapView = { cx: me.x, cz: me.z, scale: fit() * 2.5 };
      draw();
    });
    const zoom = (k: number) => {
      this.mapView.scale = Math.max(fit(), Math.min(6, this.mapView.scale * k));
      draw();
    };
    mk('+', 'Zoom in', () => zoom(1.5));
    mk('−', 'Zoom out', () => zoom(1 / 1.5));
    mk('◎', 'Centre on me', () => {
      const p = this.d.player();
      this.mapView.cx = p.x;
      this.mapView.cz = p.z;
      draw();
    });
    mk('⤢', 'Whole area', () => {
      this.mapView = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, scale: fit() };
      draw();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    // drag to pan (mouse and touch), pinch to zoom
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      if (pts.size === 1) {
        this.mapView.cx -= (e.clientX - prev.x) / this.mapView.scale;
        this.mapView.cz -= (e.clientY - prev.y) / this.mapView.scale;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.mapView.scale = Math.max(fit(), Math.min(6, this.mapView.scale * (dist / pinch)));
        pinch = dist;
      }
      draw();
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  private drawMap(canvas: HTMLCanvasElement): void {
    const g = canvas.getContext('2d')!;
    const dpr = canvas.width / (canvas.clientWidth || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const { cx, cz, scale } = this.mapView;
    const sx = (x: number) => W / 2 + (x - cx) * scale;
    const sz = (z: number) => H / 2 + (z - cz) * scale;
    const { hud, map } = this.d;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#d9cfb8';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high';
    const k = scale / PX_PER_M;
    g.drawImage(hud.img, sx(hud.x0), sz(hud.z0), hud.img.width * k, hud.img.height * k);

    // labels: named water, parks, the metro station
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = (p: P2, t: string, color: string) => {
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.strokeText(t, sx(p[0]), sz(p[1]));
      g.fillStyle = color;
      g.fillText(t, sx(p[0]), sz(p[1]));
    };
    for (const w of map.water) if (w.name) label(centroid(w.pts), w.name, '#1d4f60');
    for (const p of map.parks) if (p.name) label(centroid(p.pts), p.name, '#2f5a22');
    const st = map.landmarks.moti_jheel_metro;
    if (st) {
      g.fillStyle = '#1f3b57';
      g.fillRect(sx(st[0]) - 5, sz(st[1]) - 5, 10, 10);
      label([st[0], st[1] - 14 / scale], 'Metro', '#1f3b57');
    }

    // player arrow (points where the camera looks)
    const me = this.d.player();
    g.save();
    g.translate(sx(me.x), sz(me.z));
    g.rotate(-me.yaw);
    g.fillStyle = '#e8590c';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(8, 8);
    g.lineTo(0, 4);
    g.lineTo(-8, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // north + scale bar
    g.fillStyle = '#222';
    g.font = 'bold 13px system-ui';
    g.fillText('N ↑', W - 22, 16);
    const bar = niceLength(90 / scale);
    g.fillRect(12, H - 16, bar * scale, 3);
    g.textAlign = 'left';
    g.font = '11px system-ui';
    g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, 12, H - 26);
  }

  // ---------- Places ----------
  /** The parts of Kanpur the admin has opened. Going to one reloads the game with that map. */
  private renderPlaces(): void {
    const parts = [...this.d.parts].sort((a, b) => a.title.localeCompare(b.title));
    const search = el('input', 'place-search') as HTMLInputElement;
    search.type = 'search';
    search.placeholder = 'Search places';
    search.setAttribute('aria-label', 'Search places');
    const list = el('div', 'place-list');
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren();
      for (const p of parts) {
        if (q && !p.title.toLowerCase().includes(q)) continue;
        const here = p.id === this.d.area;
        const b = el('button', 'place-row');
        b.disabled = here;
        b.innerHTML = `<span class="place-name"></span><span class="place-meta"></span>`;
        (b.querySelector('.place-name') as HTMLElement).textContent = p.title;
        (b.querySelector('.place-meta') as HTMLElement).textContent = here ? 'You are here' : p.buildings ? `${p.buildings.toLocaleString()} buildings` : 'Go';
        b.addEventListener('click', () => {
          const u = new URL(location.href);
          u.searchParams.set('area', p.id);
          for (const k of ['spawn', 'cam', 'at']) u.searchParams.delete(k);
          location.href = u.toString();
        });
        list.append(b);
      }
      if (!list.children.length) list.append(text('p', 'No places match.', 'muted'));
    };
    search.addEventListener('input', draw);
    draw();
    const note = text('p', parts.length > 1 ? 'Places open to play. Going to one reloads the game there.' : 'Only Moti Jheel is open for now.', 'muted');
    this.body.append(search, list, note);
  }

  // ---------- Controls ----------
  /** The key bindings: current keys (click one, then press the new key), the defaults for reference, a reset button. */
  private renderControls(): void {
    const c = this.d.controls;
    const table = el('table', 'ctl-table');
    table.innerHTML = '<thead><tr><th>Action</th><th>Key</th><th>Alternative</th><th>Default</th></tr></thead>';
    const tb = el('tbody');
    table.append(tb);
    const note = text('p', 'Click a key, then press the new one. Esc cancels, Backspace clears.', 'muted');
    let stop: (() => void) | null = null;
    const draw = () => {
      tb.replaceChildren();
      for (const a of ACTIONS) {
        const tr = el('tr');
        tr.append(text('td', a.label));
        for (const slot of [0, 1] as const) {
          const td = el('td');
          const b = el('button', 'key-btn');
          b.textContent = label(c.get(a.id)[slot]);
          if (!c.isDefault(a.id, slot)) b.classList.add('changed');
          b.setAttribute('aria-label', `${a.label}, ${slot ? 'alternative' : 'main'} key: ${b.textContent}. Click to change`);
          b.addEventListener('click', () => listen(a.id, slot, b));
          td.append(b);
          tr.append(td);
        }
        tr.append(text('td', DEFAULTS[a.id].filter(Boolean).map(label).join(' / '), 'ctl-default'));
        tb.append(tr);
      }
    };
    const listen = (a: Action, slot: 0 | 1, b: HTMLButtonElement) => {
      stop?.();
      b.classList.add('listening');
      b.textContent = 'Press a key…';
      note.textContent = 'Press the new key (Esc cancels, Backspace clears).';
      let active = true;
      const done = (msg: string) => {
        active = false;
        removeEventListener('keydown', onKey, true);
        removeEventListener('mousedown', onMouse, true);
        stop = null;
        note.textContent = msg;
        draw();
      };
      const assign = (code: string) => {
        const from = c.set(a, slot, code);
        const name = ACTIONS.find((x) => x.id === a)!.label;
        done(code ? `${name}: ${label(code)}${from ? ` (taken from "${ACTIONS.find((x) => x.id === from)!.label}")` : ''}` : `${name}: cleared`);
      };
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();       // the game and the menu must not react while a key is being chosen
        if (e.code === 'Escape') return done('Cancelled.');
        if (e.code === 'Backspace' || e.code === 'Delete') return assign('');
        if (['MetaLeft', 'MetaRight', 'ContextMenu'].includes(e.code)) return;
        assign(e.code);
      };
      const onMouse = (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.key-btn') === b) return;   // the click that started listening
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.button <= 2) assign('Mouse' + e.button);
      };
      addEventListener('keydown', onKey, true);
      setTimeout(() => active && addEventListener('mousedown', onMouse, true), 0);
      stop = () => done('');
    };
    const reset = el('button', 'link-btn');
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => {
      stop?.();
      c.reset();
      note.textContent = 'Controls reset to the defaults.';
      draw();
    });
    const mouse = rows([
      ['Look around', 'Move the mouse (click the game first)'],
      ['Release the mouse / close a panel', 'Esc'],
      ['Touch screens', 'Left half: move · right half: look · buttons: run, jump, punch'],
    ]);
    draw();
    const foot = el('p', 'muted');
    foot.append(note, ' ', reset);
    this.body.append(table, mouse, foot);
  }

  // ---------- Statistics ----------
  private renderStats(): void {
    const s = this.d.stats.data;
    const grid = el('div', 'stat-grid');
    const tile = (label: string, value: string) => {
      const t = el('div', 'stat');
      t.append(text('div', value, 'stat-v'), text('div', label, 'stat-l'));
      grid.append(t);
    };
    tile('Distance walked', km(s.walked));
    tile('Distance run', km(s.ran));
    tile('Area explored', `${(s.explored * 100).toFixed(1)}%`);
    tile('Time played', dur(s.played));
    tile('This session', dur(s.session));
    tile('Jumps', s.jumps.toLocaleString());
    tile('Top speed', `${(s.topSpeed * 3.6).toFixed(1)} km/h`);
    tile('Sessions', String(s.sessions));
    const reset = el('button', 'link-btn');
    reset.textContent = 'Reset statistics';
    reset.addEventListener('click', () => {
      if (confirm('Reset all statistics?')) {
        this.d.stats.reset();
        this.show('stats');
      }
    });
    const note = text('p', 'Saved in this browser only.', 'muted');
    note.append(' ', reset);
    this.body.append(grid, note);
  }
}

// ---------- helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function text(tag: keyof HTMLElementTagNameMap, t: string, cls?: string): HTMLElement {
  const e = el(tag, cls);
  e.textContent = t;
  return e;
}

function rows(list: [string, string][]): HTMLElement {
  const dl = el('dl', 'rows');
  for (const [k, v] of list) dl.append(text('dt', k), text('dd', v));
  return dl;
}

function loadProfile(): { name: string } {
  try {
    return { name: 'Player', ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return { name: 'Player' };
  }
}

function saveProfile(p: { name: string }): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

function km(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function dur(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${Math.floor(s)} s`;
}

function niceLength(m: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  return [1, 2, 5, 10].map((k) => k * p).find((v) => v >= m) ?? 10 * p;
}

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS: Record<Item, string> = {
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  map: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  stats: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  places: svg('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  controls: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
};
