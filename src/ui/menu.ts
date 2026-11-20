import { Stats } from '../game/stats';
import { setStartChoice, startChoice, STARTS } from '../game/start';
import type { Part } from '../game/parts';
import { ACTIONS, Action, Controls, DEFAULTS, label } from '../game/controls';
import { MapData, P2, centroid } from '../world/types';
import { Hud, PX_PER_M } from './hud';
import { account } from '../game/account';
import { fmtNum, onLang, t, tk } from '../i18n';
import { goHome, settingsView, stagesView } from './shell';

type Item = 'stages' | 'settings' | 'profile' | 'map' | 'places' | 'stats' | 'controls';
const ITEMS: Item[] = ['stages', 'settings', 'profile', 'map', 'places', 'stats', 'controls'];
const TITLE: Record<Item, Parameters<typeof t>[0]> = {
  stages: 'menu.stages', settings: 'menu.settings', profile: 'menu.profile', map: 'menu.map', places: 'menu.places', stats: 'menu.stats', controls: 'menu.controls',
};

export interface MenuDeps {
  map: MapData;
  hud: Hud;
  stats: Stats;
  controls: Controls;
  /** the part of Kanpur that is loaded, and the parts a player may go to (open and built) */
  area: string;
  parts: Part[];
  /** every part of Kanpur, open or not (the city map greys out the unopened ones) */
  allParts: Part[];
  /** the stage being played (none in development with ?debug) */
  stage?: number;
  player: () => { x: number; z: number; yaw: number };
  /** called when a panel opens / closes, so the game can pause */
  onPause: (paused: boolean) => void;
}

/**
 * Top-left menu button -> dropdown (Stages, Settings, Profile, Map, ...) -> one panel at a time.
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
  private cityView = true; // map shows the whole of Kanpur (greyed) until switched to the local street map
  private mapView = { cx: 0, cz: 0, scale: 0 }; // metres at panel centre, canvas px per metre

  constructor(private d: MenuDeps) {
    this.btn.innerHTML = '<span></span><span></span><span></span>';
    this.btn.setAttribute('aria-label', t('menu.menu'));
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.addEventListener('click', () => this.toggleDrop());

    const items = () => {
      this.drop.replaceChildren();
      for (const it of ITEMS) {
        const b = el('button', 'menu-item');
        b.innerHTML = `${ICONS[it]}<span></span>`;
        (b.lastElementChild as HTMLElement).textContent = t(TITLE[it]);
        b.addEventListener('click', () => this.show(it));
        this.drop.append(b);
      }
    };
    items();
    onLang(() => {                                    // the new language straight away, in the open panel too
      items();
      this.btn.setAttribute('aria-label', t('menu.menu'));
      if (this.open) { const it = this.open; this.open = null; this.show(it, true); }
    });

    const head = el('div', 'menu-head');
    const close = el('button', 'menu-close');
    close.textContent = '×';
    close.setAttribute('aria-label', t('nav.close'));
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

  private show(it: Item, again = false): void {
    this.toggleDrop(false);
    const wasOpen = this.open !== null || again;
    this.open = it;
    this.title.textContent = t(TITLE[it]);
    this.body.replaceChildren();
    this.panel.dataset.item = it;
    this.overlay.classList.add('on');
    if (!wasOpen) this.d.onPause(true);
    if (it === 'stages') this.renderStages();
    else if (it === 'settings') this.body.append(settingsView({ onLogout: () => goHome() }));
    else if (it === 'profile') this.renderProfile();
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

  // ---------- Stages ----------
  private renderStages(): void {
    const note = text('p', '', 'muted');
    note.setAttribute('role', 'status');
    this.body.append(text('p', t('stage.pick'), 'muted'), stagesView({ current: this.d.stage, onMsg: (m) => (note.textContent = m) }), note);
  }

  // ---------- Profile ----------
  private renderProfile(): void {
    const s = this.d.stats.data;
    const me = account.me;
    const avatar = el('div', 'avatar');
    avatar.textContent = (me?.username[0] ?? '?').toUpperCase();
    const top = el('div', 'profile-top');
    const who = el('div');
    who.append(text('div', me?.username ?? t('user.guest'), 'profile-name'), text('div', me?.email ?? t('profile.guest'), 'muted'));
    top.append(avatar, who);
    this.body.append(top, rows([
      [t('profile.character'), t('profile.ramu')],
      [t('profile.area'), this.d.area === 'moti_jheel' ? tk('place.moti_jheel') : this.d.map.title || 'Kanpur'],
      [t('profile.since'), new Date(s.firstPlayed).toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' })],
      [t('profile.sessions'), fmtNum(s.sessions)],
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
      if (this.cityView) return;
      this.mapView.scale = Math.max(fit(), Math.min(6, this.mapView.scale * k));
      draw();
    };
    mk('▦', t('map.toggle'), () => {
      this.cityView = !this.cityView;
      draw();
    });
    mk('+', t('map.in'), () => zoom(1.5));
    mk('−', t('map.out'), () => zoom(1 / 1.5));
    mk('◎', t('map.me'), () => {
      const p = this.d.player();
      this.mapView.cx = p.x;
      this.mapView.cz = p.z;
      draw();
    });
    mk('⤢', t('map.all'), () => {
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
    canvas.addEventListener('click', (e) => {
      if (!this.cityView) return;
      const r = canvas.getBoundingClientRect();
      const hit = this.cityHit(canvas, e.clientX - r.left, e.clientY - r.top);
      if (!hit || hit.id === this.d.area) return;
      const u = new URL(location.href);
      u.searchParams.set('area', hit.id);
      for (const k of ['spawn', 'cam', 'at']) u.searchParams.delete(k);
      location.href = u.toString();
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (this.cityView) return;
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev || this.cityView) return;
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

  /** lat/lon -> canvas px for the whole-city view (plain equirectangular, fitted to all parts) */
  private cityProj(canvas: HTMLCanvasElement) {
    const all = this.d.allParts;
    const s = Math.min(...all.map((p) => p.bbox[0])), n = Math.max(...all.map((p) => p.bbox[2]));
    const w = Math.min(...all.map((p) => p.bbox[1])), e = Math.max(...all.map((p) => p.bbox[3]));
    const kx = Math.cos(((s + n) / 2) * Math.PI / 180);
    const W = canvas.clientWidth, H = canvas.clientHeight, pad = 26;
    const k = Math.min((W - 2 * pad) / ((e - w) * kx), (H - 2 * pad) / (n - s));
    const ox = (W - (e - w) * kx * k) / 2, oy = (H - (n - s) * k) / 2;
    return { x: (lon: number) => ox + (lon - w) * kx * k, y: (lat: number) => oy + (n - lat) * k };
  }

  private cityHit(canvas: HTMLCanvasElement, px: number, py: number): Part | null {
    const pr = this.cityProj(canvas);
    const open = new Set(this.d.parts.map((p) => p.id));
    for (const p of this.d.allParts) {
      if (!open.has(p.id)) continue;
      if (px >= pr.x(p.bbox[1]) && px <= pr.x(p.bbox[3]) && py >= pr.y(p.bbox[2]) && py <= pr.y(p.bbox[0])) return p;
    }
    return null;
  }

  /** The whole of Kanpur as a grid of boxes: only the opened parts are coloured, the rest are greyed out. */
  private drawCity(canvas: HTMLCanvasElement): void {
    const g = canvas.getContext('2d')!;
    const dpr = canvas.width / (canvas.clientWidth || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#c9c6bf';
    g.fillRect(0, 0, W, H);
    const pr = this.cityProj(canvas);
    const open = new Set(this.d.parts.map((p) => p.id));
    const box = (p: Part) => [pr.x(p.bbox[1]), pr.y(p.bbox[2]), pr.x(p.bbox[3]) - pr.x(p.bbox[1]), pr.y(p.bbox[0]) - pr.y(p.bbox[2])] as const;
    for (const p of this.d.allParts) {
      const [x, y, w, h] = box(p);
      g.fillStyle = '#b4b1aa';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#9d9a93';
      g.lineWidth = 0.5;
      g.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.d.allParts) {
      if (!open.has(p.id)) continue;
      const [x, y, w, h] = box(p);
      g.fillStyle = p.id === this.d.area ? '#f2a65a' : '#8fbf7a';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#7a3a05';
      g.lineWidth = 2;
      g.strokeRect(x, y, w, h);
      g.font = '700 12px system-ui, sans-serif';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.strokeText(p.title, x + w / 2, y - 9);
      g.fillStyle = '#3a1d02';
      g.fillText(p.title, x + w / 2, y - 9);
    }
    const me = this.d.player();
    const [lat0, lon0] = this.d.map.origin_latlon;
    const lat = lat0 - me.z / 111320, lon = lon0 + me.x / (111320 * Math.cos(lat0 * Math.PI / 180));
    g.fillStyle = '#e8590c';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(pr.x(lon), pr.y(lat), 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#222';
    g.font = 'bold 13px system-ui';
    g.fillText(t('map.north'), W - 22, 16);
    g.textAlign = 'left';
    g.font = '11px system-ui';
    g.fillText(t('map.cityNote'), 12, H - 12);
  }

  private drawMap(canvas: HTMLCanvasElement): void {
    if (this.cityView) { this.drawCity(canvas); return; }
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
      label([st[0], st[1] - 14 / scale], t('map.metro'), '#1f3b57');
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
    g.fillText(t('map.north'), W - 22, 16);
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
    search.placeholder = t('places.search');
    search.setAttribute('aria-label', t('places.search'));
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
        (b.querySelector('.place-meta') as HTMLElement).textContent = here ? t('places.here') : p.buildings ? t('places.buildings', { n: fmtNum(p.buildings) }) : t('places.go');
        b.addEventListener('click', () => {
          const u = new URL(location.href);
          u.searchParams.set('area', p.id);
          for (const k of ['spawn', 'cam', 'at']) u.searchParams.delete(k);
          location.href = u.toString();
        });
        list.append(b);
      }
      if (!list.children.length) list.append(text('p', t('places.none'), 'muted'));
    };
    search.addEventListener('input', draw);
    draw();
    const note = text('p', parts.length > 1 ? t('places.many') : t('places.one'), 'muted');
    if (this.d.area === 'moti_jheel') this.body.append(this.startAt());
    this.body.append(search, list, note);
  }

  /** Moti Jheel: where the game starts (stage 1 from the Shivaji Putla gate, or straight into the mela). Choosing one restarts there. */
  private startAt(): HTMLElement {
    const box = el('div', 'start-at');
    box.append(text('h3', t('places.startAt')));
    const now = new URLSearchParams(location.search).get('spawn') ?? startChoice();
    const list = el('div', 'place-list');
    for (const s of STARTS) {
      const here = s.id === now;
      const b = el('button', 'place-row');
      b.setAttribute('aria-pressed', String(here));
      b.innerHTML = `<span><span class="place-name"></span><br><span class="place-meta"></span></span><span class="place-meta"></span>`;
      const [name, note, state] = b.querySelectorAll('span.place-name, span.place-meta') as NodeListOf<HTMLElement>;
      name.textContent = tk(`start.${s.id}.title`) || s.title;
      note.textContent = tk(`start.${s.id}.note`) || s.note;
      state.textContent = here ? t('places.chosen') : t('places.startHere');
      b.addEventListener('click', () => {
        setStartChoice(s.id);
        const u = new URL(location.href);
        for (const k of ['spawn', 'cam', 'at']) u.searchParams.delete(k);
        location.href = u.toString();
      });
      list.append(b);
    }
    box.append(list, text('p', t('places.startNote'), 'muted'));
    return box;
  }

  // ---------- Controls ----------
  /** The key bindings: current keys (click one, then press the new key), the defaults for reference, a reset button. */
  private renderControls(): void {
    const c = this.d.controls;
    const table = el('table', 'ctl-table');
    table.innerHTML = '<thead><tr><th></th><th></th><th></th><th></th></tr></thead>';
    table.querySelectorAll('th').forEach((th, i) => (th.textContent = t((['ctl.action', 'ctl.key', 'ctl.alt', 'ctl.default'] as const)[i])));
    const tb = el('tbody');
    table.append(tb);
    const note = text('p', t('ctl.note'), 'muted');
    let stop: (() => void) | null = null;
    const draw = () => {
      tb.replaceChildren();
      for (const a of ACTIONS) {
        const tr = el('tr');
        tr.append(text('td', actName(a.id)));
        for (const slot of [0, 1] as const) {
          const td = el('td');
          const b = el('button', 'key-btn');
          b.textContent = label(c.get(a.id)[slot]);
          if (!c.isDefault(a.id, slot)) b.classList.add('changed');
          b.setAttribute('aria-label', t('ctl.aria', { name: actName(a.id), slot: slot ? t('ctl.altSlot') : t('ctl.main'), key: b.textContent ?? '' }));
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
      b.textContent = t('ctl.press');
      note.textContent = t('ctl.pressNote');
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
        const name = actName(a);
        done(code ? t('ctl.set', { name, key: label(code) }) + (from ? t('ctl.taken', { from: actName(from) }) : '') : t('ctl.cleared', { name }));
      };
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();       // the game and the menu must not react while a key is being chosen
        if (e.code === 'Escape') return done(t('ctl.cancelled'));
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
    reset.textContent = t('ctl.reset');
    reset.addEventListener('click', () => {
      stop?.();
      c.reset();
      note.textContent = t('ctl.resetDone');
      draw();
    });
    const mouse = rows([
      [t('ctl.look'), t('ctl.lookHow')],
      [t('ctl.release'), 'Esc'],
      [t('ctl.touch'), t('ctl.touchHow')],
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
    tile(t('stats.walked'), km(s.walked));
    tile(t('stats.ran'), km(s.ran));
    tile(t('stats.explored'), `${(s.explored * 100).toFixed(1)}%`);
    tile(t('stats.played'), dur(s.played));
    tile(t('stats.session'), dur(s.session));
    tile(t('stats.jumps'), fmtNum(s.jumps));
    tile(t('stats.top'), `${(s.topSpeed * 3.6).toFixed(1)} km/h`);
    tile(t('stats.sessions'), fmtNum(s.sessions));
    const reset = el('button', 'link-btn');
    reset.textContent = t('stats.reset');
    reset.addEventListener('click', () => {
      if (confirm(t('stats.confirm'))) {
        this.d.stats.reset();
        this.show('stats');
      }
    });
    const note = text('p', t('stats.note'), 'muted');
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

const actName = (a: Action) => t(`act.${a}` as Parameters<typeof t>[0]);
const lang = () => (document.documentElement.lang === 'hi' ? 'hi-IN' : 'en-IN');

function km(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function dur(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const hi = document.documentElement.lang === 'hi';
  return h ? (hi ? `${h} घंटे ${m} मिनट` : `${h} h ${m} min`) : m ? (hi ? `${m} मिनट` : `${m} min`) : (hi ? `${Math.floor(s)} सेकंड` : `${Math.floor(s)} s`);
}

function niceLength(m: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  return [1, 2, 5, 10].map((k) => k * p).find((v) => v >= m) ?? 10 * p;
}

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS: Record<Item, string> = {
  stages: svg('<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  map: svg('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  stats: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  places: svg('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  controls: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
};
