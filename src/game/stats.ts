import { P2 } from '../world/types';

const KEY = 'kanpur.stats.v1';
const CELL = 25; // m, grid used for "area explored"
const RUN_SPEED = 5.5; // m/s; walking is 4, running 8.5

interface Saved {
  walked: number;   // m
  ran: number;      // m
  played: number;   // s
  jumps: number;
  topSpeed: number; // m/s
  sessions: number;
  visited: string[];
  firstPlayed: number; // epoch ms
}

/** Play statistics, kept in this browser (localStorage). Missing or blocked storage just means fresh stats. */
export class Stats {
  private s: Saved;
  private visited: Set<string>;
  private roadCells: Set<string>;
  private last: { x: number; z: number } | null = null;
  private jumpBase = 0;
  private saveIn = 5;
  session = 0; // s

  constructor(roadPoints: P2[]) {
    this.roadCells = new Set(roadPoints.map(([x, z]) => cellKey(x, z)));
    const empty: Saved = { walked: 0, ran: 0, played: 0, jumps: 0, topSpeed: 0, sessions: 0, visited: [], firstPlayed: Date.now() };
    let loaded: Partial<Saved> = {};
    try {
      loaded = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      /* storage unavailable */
    }
    this.s = { ...empty, ...loaded };
    this.s.sessions++;
    this.visited = new Set(this.s.visited);
    addEventListener('pagehide', () => this.save());
  }

  /** Call every frame while playing. `jumps` is the player's running jump counter. */
  update(dt: number, x: number, z: number, speed: number, jumps: number): void {
    this.session += dt;
    this.s.played += dt;
    if (this.last) {
      const d = Math.hypot(x - this.last.x, z - this.last.z);
      if (d < 5) { // ignore teleports / respawns
        if (speed > RUN_SPEED) this.s.ran += d;
        else this.s.walked += d;
      }
    }
    this.last = { x, z };
    this.s.topSpeed = Math.max(this.s.topSpeed, speed);
    this.s.jumps += jumps - this.jumpBase;
    this.jumpBase = jumps;
    const k = cellKey(x, z);
    if (this.roadCells.has(k)) this.visited.add(k);
    if ((this.saveIn -= dt) < 0) {
      this.saveIn = 5;
      this.save();
    }
  }

  get data() {
    return {
      ...this.s,
      session: this.session,
      explored: this.roadCells.size ? this.visited.size / this.roadCells.size : 0,
    };
  }

  save(): void {
    this.s.visited = [...this.visited];
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* storage unavailable */
    }
  }

  reset(): void {
    this.s = { walked: 0, ran: 0, played: 0, jumps: 0, topSpeed: 0, sessions: 1, visited: [], firstPlayed: Date.now() };
    this.visited.clear();
    this.session = 0;
    this.save();
  }
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
}
