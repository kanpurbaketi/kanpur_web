import { P2 } from '../world/types';

const KEY = 'kanpur.stats.v1';

/*
 The scorecard: what Ramu does to the people and the property about him. Counted for this play (`run`: one load of the
 page, so one play of a stage) and for all time (kept with the rest). The play's goes to the server with its beats
 (api/me.ts), so the menu (Statistics) and the admin can show every play's.
   runOver   people his vehicle knocked down        beaten    people his punches laid out
   thrown    people thrown off vehicles he took     punches   punches that landed
   taken     vehicles he took                       crashes   hard knocks of a vehicle he drove (not scrapes)
   lamps     headlamps broken                       damageRs  what the dents and lamps would cost to mend (rupees)
   knockouts times Ramu himself was knocked out
*/
export const SCORE_KEYS = ['runOver', 'beaten', 'thrown', 'punches', 'taken', 'crashes', 'lamps', 'damageRs', 'knockouts'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export type Score = Record<ScoreKey, number>;
const noScore = (): Score => Object.fromEntries(SCORE_KEYS.map((k) => [k, 0])) as Score;
/** people hurt, all ways */
export const injured = (s: Partial<Score>) => (s.runOver ?? 0) + (s.beaten ?? 0) + (s.thrown ?? 0);

/** what each kind of vehicle costs new (₹); a wreck (damage 100) costs half of it to mend */
const PRICE: Record<string, number> = {
  cycle: 7000, rickshaw: 18000, pulsar: 110000, enfield: 210000, autorickshaw: 280000, tirri: 160000, maruti: 250000,
  swift: 650000, ambassador: 450000, bolero: 950000, bus: 2500000, truck: 1800000,
};
const LAMP_RS = 2500;
/** the cost of `points` (0..100) of damage to a vehicle of this kind, and a headlamp if one broke */
export function repairRs(kind: string, points: number, lamp: boolean): number {
  const price = PRICE[kind] ?? PRICE[kind.split('_')[0]] ?? 300000;
  return Math.round((points / 100) * price * 0.5 + (lamp ? LAMP_RS : 0));
}
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
  score: Score;     // the scorecard, all time
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
  /** this play's scorecard */
  readonly run: Score = noScore();

  constructor(roadPoints: P2[]) {
    this.roadCells = new Set(roadPoints.map(([x, z]) => cellKey(x, z)));
    const empty: Saved = { walked: 0, ran: 0, played: 0, jumps: 0, topSpeed: 0, sessions: 0, visited: [], firstPlayed: Date.now(), score: noScore() };
    let loaded: Partial<Saved> = {};
    try {
      loaded = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      /* storage unavailable */
    }
    this.s = { ...empty, ...loaded };
    this.s.score = { ...noScore(), ...loaded.score };
    this.s.sessions++;
    this.visited = new Set(this.s.visited);
    addEventListener('pagehide', () => this.save());
  }

  /** something for the scorecard: this play's and all time's */
  count(k: ScoreKey, n = 1): void {
    if (!(n > 0)) return;
    this.run[k] += n;
    this.s.score[k] += n;
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
      score: { ...this.s.score },
      run: { ...this.run },
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
    this.s = { walked: 0, ran: 0, played: 0, jumps: 0, topSpeed: 0, sessions: 1, visited: [], firstPlayed: Date.now(), score: noScore() };
    this.visited.clear();
    this.session = 0;
    this.save();
  }
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
}
