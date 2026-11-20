import { onLang, t } from '../i18n';
import { DRIVABLE, MapData, type P2 } from '../world/types';

/**
 Where a stage's mission leads (set each frame from the story's director; null when roaming free): the minimap shows a
 pin (or, off its edge, an arrow on the rim) and a dotted path; the big map the same with the mission's text.
*/
export interface Guide {
  x: number;
  z: number;
  /** the mission, and the hint for the next place on the way */
  title: string;
  hint: string;
  /** places to pass on the way, in order, before x/z */
  path: P2[];
  /** a search area (metres) instead of an exact spot */
  radius?: number;
}

const SIZE = 180;      // minimap size in CSS px
const RANGE = 160;     // meters shown from center to edge
export const PX_PER_M = 1.5;  // resolution of the pre-rendered map image

/** Minimap (pre-rendered map, rotated around the player each frame) and the credit line. */
export class Hud {
  private ctx: CanvasRenderingContext2D;
  /** pre-rendered north-up map; pixel = (x - x0, z - z0) * PX_PER_M. Also drawn by the Map panel. */
  readonly img: HTMLCanvasElement;
  readonly x0: number;
  readonly z0: number;
  guide: Guide | null = null;
  /** a click on the minimap (opens the big map) */
  onOpen: (() => void) | null = null;

  constructor(map: MapData) {
    const canvas = document.getElementById('minimap') as HTMLCanvasElement;
    canvas.addEventListener('click', () => this.onOpen?.());
    canvas.style.cursor = 'pointer';
    const tip = () => { canvas.title = t('map.open'); canvas.setAttribute('aria-label', t('map.open')); };
    tip();
    onLang(tip);
    const dpr = Math.min(2, devicePixelRatio);
    canvas.width = canvas.height = SIZE * dpr;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    document.getElementById('credits')!.textContent = map.attribution;

    const [x0, z0, x1, z1] = map.bounds;
    this.x0 = x0 - 50;
    this.z0 = z0 - 50;
    this.img = document.createElement('canvas');
    this.img.width = (x1 - x0 + 100) * PX_PER_M;
    this.img.height = (z1 - z0 + 100) * PX_PER_M;
    const g = this.img.getContext('2d')!;
    const tx = (x: number) => (x - this.x0) * PX_PER_M;
    const tz = (z: number) => (z - this.z0) * PX_PER_M;
    const poly = (pts: [number, number][]) => {
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z))));
      g.closePath();
    };
    g.fillStyle = '#d9cfb8';
    g.fillRect(0, 0, this.img.width, this.img.height);
    g.fillStyle = '#9cc27f';
    for (const p of map.parks) (poly(p.pts), g.fill());
    g.fillStyle = '#6aa5b8';
    for (const w of map.water) (poly(w.pts), g.fill());
    g.lineCap = g.lineJoin = 'round';
    for (const r of map.roads) {
      g.strokeStyle = DRIVABLE.has(r.cls) ? (r.w >= 8 ? '#ffffff' : '#f5f1e6') : '#e8dfcc';
      g.lineWidth = Math.max(1.5, r.w * PX_PER_M);
      g.beginPath();
      r.pts.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z))));
      g.stroke();
    }
    g.fillStyle = '#b3a58c';
    for (const b of map.buildings) (poly(b.pts), g.fill());
    g.strokeStyle = '#8a8a8a';
    g.lineWidth = 6 * PX_PER_M;
    for (const r of map.rails) {
      if (!(r.bridge || r.layer > 0 || r.kind === 'subway')) continue;
      g.beginPath();
      r.pts.forEach(([x, z], i) => (i ? g.lineTo(tx(x), tz(z)) : g.moveTo(tx(x), tz(z))));
      g.stroke();
    }
  }

  /** yaw: camera yaw (radians); map rotates so "forward" is up. */
  update(x: number, z: number, yaw: number): void {
    const c = this.ctx;
    const s = SIZE / (RANGE * 2);
    c.save();
    c.clearRect(0, 0, SIZE, SIZE);
    c.beginPath();
    c.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    c.clip();
    c.translate(SIZE / 2, SIZE / 2);
    c.rotate(yaw);
    c.scale(s / PX_PER_M, s / PX_PER_M);
    c.drawImage(this.img, -(x - this.x0) * PX_PER_M, -(z - this.z0) * PX_PER_M);
    c.restore();
    this.drawGuide(x, z, yaw);
    // player arrow + north marker
    c.fillStyle = '#e8590c';
    c.beginPath();
    c.moveTo(SIZE / 2, SIZE / 2 - 8);
    c.lineTo(SIZE / 2 + 6, SIZE / 2 + 6);
    c.lineTo(SIZE / 2 - 6, SIZE / 2 + 6);
    c.fill();
    const nx = SIZE / 2 + Math.sin(yaw) * (SIZE / 2 - 10), ny = SIZE / 2 - Math.cos(yaw) * (SIZE / 2 - 10);
    c.fillStyle = '#222';
    c.font = 'bold 12px system-ui';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', nx, ny);
  }

  /** the mission's pin, path and search area; an arrow on the rim when the pin is off the map */
  private drawGuide(x: number, z: number, yaw: number): void {
    const g = this.guide;
    if (!g) return;
    const c = this.ctx, s = SIZE / (RANGE * 2), C = SIZE / 2, cos = Math.cos(yaw), sin = Math.sin(yaw);
    const P = (wx: number, wz: number): P2 => {
      const dx = (wx - x) * s, dz = (wz - z) * s;
      return [C + dx * cos - dz * sin, C + dx * sin + dz * cos];
    };
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
    const [tx, ty] = P(g.x, g.z);
    const off = Math.hypot(tx - C, ty - C) > C - 12;
    c.save();
    c.beginPath();
    c.arc(C, C, C, 0, Math.PI * 2);
    c.clip();
    c.lineCap = c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(C, C);
    for (const [px, pz] of g.path) c.lineTo(...P(px, pz));
    c.lineTo(tx, ty);
    c.setLineDash([2, 5]);
    c.strokeStyle = 'rgba(255,255,255,.9)';
    c.lineWidth = 5;
    c.stroke();
    c.strokeStyle = '#c2410c';
    c.lineWidth = 3;
    c.stroke();
    c.setLineDash([]);
    if (g.radius) {
      c.beginPath();
      c.arc(tx, ty, g.radius * s, 0, Math.PI * 2);
      c.fillStyle = `rgba(242,153,42,${0.18 + 0.1 * pulse})`;
      c.fill();
      c.setLineDash([4, 3]);
      c.strokeStyle = '#c2410c';
      c.lineWidth = 1.5;
      c.stroke();
      c.setLineDash([]);
    } else if (!off) {
      c.beginPath();
      c.arc(tx, ty, 6 + 5 * pulse, 0, Math.PI * 2);
      c.fillStyle = `rgba(242,153,42,${0.5 - 0.35 * pulse})`;
      c.fill();
      c.beginPath();
      c.arc(tx, ty, 5, 0, Math.PI * 2);
      c.fillStyle = '#f2992a';
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
    if (off) {
      // on the rim, pointing out towards it
      const a = Math.atan2(ty - C, tx - C), r = C - 11;
      c.save();
      c.translate(C + Math.cos(a) * r, C + Math.sin(a) * r);
      c.rotate(a);
      c.beginPath();
      c.moveTo(8, 0);
      c.lineTo(-5, -7);
      c.lineTo(-2, 0);
      c.lineTo(-5, 7);
      c.closePath();
      c.fillStyle = '#f2992a';
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.globalAlpha = 0.75 + 0.25 * pulse;
      c.stroke();
      c.fill();
      c.restore();
    }
  }
}
