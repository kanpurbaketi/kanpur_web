/*
 The sounds of the vehicle Ramu drives, all made with WebAudio (no sound files):
   engine   two detuned oscillators at the firing frequency (from the revs) and a little noise, through a low-pass
            that opens with the throttle; a preset per kind of engine (petrol car, diesel bus / truck, two-stroke auto,
            single-cylinder bike, the e-rickshaw's motor whine; nothing for the pedalled ones but the chain)
   tyres    band-passed noise, as loud as they slide
   knocks   a thud (low sine + muffled noise burst) as hard as the hit
   horn     per kind: a car's twin-tone, a bus / truck's pressure horn, an auto's bulb-ish honk, a bike's beep, a bell
 The audio context starts on the first key or click (browsers will not play before one).
*/

export interface EngineState {
  kind: string;
  rpm: number;
  /** 0..1 */
  throttle: number;
  /** m/s */
  speed: number;
  /** 0..1, how much the tyres slide */
  slip: number;
  horn: boolean;
  /** the engine is dead (wrecked): no engine note */
  dead?: boolean;
}

type Preset = { lo: number; hi: number; wave: OscillatorType; sub: number; cut: number; vol: number; noise: number };
const PRESETS: Record<string, Preset> = {
  car: { lo: 32, hi: 190, wave: 'sawtooth', sub: 0.5, cut: 380, vol: 0.16, noise: 0.03 },
  diesel: { lo: 24, hi: 78, wave: 'sawtooth', sub: 0.5, cut: 260, vol: 0.24, noise: 0.08 },
  auto: { lo: 22, hi: 82, wave: 'square', sub: 0.5, cut: 520, vol: 0.13, noise: 0.06 },
  bike: { lo: 26, hi: 150, wave: 'square', sub: 0.5, cut: 700, vol: 0.12, noise: 0.04 },
  whine: { lo: 240, hi: 900, wave: 'sine', sub: 1.5, cut: 3000, vol: 0.035, noise: 0 },
};
const ENGINE: Record<string, string | null> = {
  swift: 'car', maruti: 'car', maruti_red: 'car', maruti_green: 'car', ambassador: 'car', bolero: 'diesel',
  bus: 'diesel', bus_green: 'diesel', truck: 'diesel', autorickshaw: 'auto', pulsar: 'bike', tirri: 'whine',
  cycle: null, rickshaw: null,
};
/** horn: frequencies (Hz), wave, loudness; 'bell' rings instead */
const HORNS: Record<string, { f: number[]; wave: OscillatorType; vol: number } | 'bell'> = {
  car: { f: [415, 520], wave: 'square', vol: 0.07 },
  diesel: { f: [262, 330, 392], wave: 'sawtooth', vol: 0.09 },
  auto: { f: [370, 380], wave: 'square', vol: 0.08 },
  bike: { f: [480, 600], wave: 'square', vol: 0.06 },
  whine: { f: [700], wave: 'square', vol: 0.05 },
};

export class VehicleAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private eng: { a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; noise: GainNode; preset: string } | null = null;
  private tyre: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private horn: { nodes: OscillatorNode[]; gain: GainNode } | null = null;
  private bellT = 0;
  private noiseBuf: AudioBuffer | null = null;

  constructor() {
    const start = () => {
      this.start();
      removeEventListener('keydown', start);
      removeEventListener('pointerdown', start);
    };
    addEventListener('keydown', start);
    addEventListener('pointerdown', start);
  }

  private start(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(c.destination);
    // a second of white noise, looped wherever noise is wanted
    this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // the tyres
    const tn = this.noiseSource();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 6;
    const tg = c.createGain();
    tg.gain.value = 0;
    tn.connect(bp).connect(tg).connect(this.master);
    this.tyre = { gain: tg, filter: bp };
  }

  private noiseSource(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start();
    return s;
  }

  /** every frame: the vehicle Ramu drives (null: on foot, all quiet) */
  update(st: EngineState | null, dt: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    if (c.state === 'suspended') void c.resume();
    const now = c.currentTime;
    const preset = st && !st.dead ? ENGINE[st.kind] ?? null : null;
    // the engine: built for the kind, faded out when off it
    if (this.eng && this.eng.preset !== preset) {
      const old = this.eng;
      old.gain.gain.setTargetAtTime(0, now, 0.08);
      setTimeout(() => { old.a.stop(); old.b.stop(); }, 600);
      this.eng = null;
    }
    if (!this.eng && preset) this.eng = this.buildEngine(preset);
    if (this.eng && st) {
      const P = PRESETS[this.eng.preset];
      const r = Math.max(0, Math.min(1.1, (st.rpm - 900) / 5200));
      const f = P.lo + (P.hi - P.lo) * r;
      this.eng.a.frequency.setTargetAtTime(f, now, 0.05);
      this.eng.b.frequency.setTargetAtTime(f * P.sub * 1.007, now, 0.05);
      this.eng.filter.frequency.setTargetAtTime(P.cut * (1 + st.throttle * 2.2 + r), now, 0.06);
      this.eng.gain.gain.setTargetAtTime(P.vol * (0.55 + 0.3 * st.throttle + 0.3 * r), now, 0.08);
      this.eng.noise.gain.setTargetAtTime(P.noise * (0.4 + st.throttle), now, 0.08);
    }
    // the tyres
    if (this.tyre) {
      const squeal = st ? Math.max(0, st.slip - 0.25) * Math.min(1, Math.abs(st.speed) / 6) : 0;
      this.tyre.gain.gain.setTargetAtTime(Math.min(0.12, squeal * 0.14), now, 0.05);
      this.tyre.filter.frequency.setTargetAtTime(1100 + Math.abs(st?.speed ?? 0) * 18, now, 0.1);
    }
    // the horn (or bell)
    const kind = st ? ENGINE[st.kind] ?? 'bell' : null;
    const h = kind ? HORNS[kind] ?? 'bell' : null;
    if (st?.horn && h === 'bell') {
      this.bellT -= dt;
      if (this.bellT <= 0) { this.bell(); this.bellT = 0.28; }
    } else this.bellT = 0;
    if (st?.horn && h && h !== 'bell') {
      if (!this.horn) {
        const g = c.createGain();
        g.gain.value = 0;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        g.connect(lp).connect(this.master);
        const nodes = h.f.map((fr) => {
          const o = c.createOscillator();
          o.type = h.wave;
          o.frequency.value = fr;
          o.connect(g);
          o.start();
          return o;
        });
        g.gain.setTargetAtTime(h.vol, now, 0.01);
        this.horn = { nodes, gain: g };
      }
    } else if (this.horn) {
      const old = this.horn;
      old.gain.gain.setTargetAtTime(0, now, 0.02);
      setTimeout(() => old.nodes.forEach((o) => o.stop()), 200);
      this.horn = null;
    }
  }

  /** a knock: `hard` ~ m/s of speed lost */
  thud(hard: number): void {
    const c = this.ctx;
    if (!c || !this.master || hard < 0.6) return;
    const now = c.currentTime, vol = Math.min(0.9, 0.12 + hard * 0.07);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, now);
    o.frequency.exponentialRampToValueAtTime(38, now + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.4);
    // the crunch: noise, muffled, short; louder metal for a hard one
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + hard * 220;
    const ng = c.createGain();
    ng.gain.setValueAtTime(vol * 0.8, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.18 + hard * 0.02);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(now);
    n.stop(now + 0.5);
  }

  private buildEngine(preset: string): NonNullable<VehicleAudio['eng']> {
    const c = this.ctx!, P = PRESETS[preset];
    const a = c.createOscillator(), b = c.createOscillator();
    a.type = P.wave;
    b.type = P.wave === 'sine' ? 'triangle' : 'square';
    a.frequency.value = P.lo;
    b.frequency.value = P.lo * P.sub;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = P.cut;
    filter.Q.value = 2;
    const gain = c.createGain();
    gain.gain.value = 0;
    const bg = c.createGain();
    bg.gain.value = 0.6;
    a.connect(filter);
    b.connect(bg).connect(filter);
    const noise = c.createGain();
    noise.gain.value = 0;
    this.noiseSource().connect(noise).connect(filter);
    filter.connect(gain).connect(this.master!);
    a.start();
    b.start();
    return { a, b, filter, gain, noise, preset };
  }

  /** a cycle bell: two bright partials, ringing down */
  private bell(): void {
    const c = this.ctx!, now = c.currentTime;
    for (const [f, v] of [[2350, 0.06], [3170, 0.035], [4880, 0.015]] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(v, now);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 0.6);
      o.connect(g).connect(this.master!);
      o.start(now);
      o.stop(now + 0.65);
    }
  }
}
