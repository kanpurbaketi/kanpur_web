/*
 The city behind everything, made with WebAudio like the vehicles' sounds (src/game/audio.ts; no sound files):
   hum         the far traffic: deep rumbling noise, always there (quieter at night), louder with vehicles going by near Ramu
   horns       somebody honking somewhere: one to three short beeps, muffled by distance, off to one side; often by
               day and in traffic, now and then at night
   people      the murmur of people talking, as many voices as there are people near him (none on an empty street):
               each a buzz at a speaking pitch through two vowel filters, in syllables and pauses, the vowels changing
   building    by day only, a building site somewhere off: hammering on steel, a drill, an angle grinder, by turns, with
               quiet spells between
   crickets    at night, faint chirping
 It starts with the first key or click (browsers will not play before one). update() every frame with what is round
 Ramu: people (a count) and traffic (vehicles moving nearby, weighted by nearness).
*/

const VOICES = 7;

interface Voice { src: OscillatorNode; f1: BiquadFilterNode; f2: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode; t: number; talk: number; pitch: number }

export class CityAmbience {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private hum: { gain: GainNode; lp: BiquadFilterNode } | null = null;
  private crowd: GainNode | null = null;
  private voices: Voice[] = [];
  private site: GainNode | null = null;
  private hornT = 2;
  private siteT = 4;
  private chirpT = 1;
  private level = 0;
  /** what it was told last (tests read it) */
  heard = { people: 0, traffic: 0 };

  constructor(private night: boolean) {
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
    try { this.ctx = new AudioContext(); } catch { return; }
    const c = this.ctx, sr = c.sampleRate;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, c.currentTime, 1.5);           // fades in
    this.out.connect(c.destination);
    // two seconds of white noise, and of brown (deep, rumbling)
    this.noise = c.createBuffer(1, sr * 2, sr);
    this.brown = c.createBuffer(1, sr * 2, sr);
    const w = this.noise.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < w.length; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    // the hum of the city's traffic
    const hs = this.loop(this.brown);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const hg = c.createGain();
    hg.gain.value = 0;
    hs.connect(lp).connect(hg).connect(this.out);
    // a little hiss of tyres on it
    const ts = this.loop(this.noise);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    const tg = c.createGain();
    tg.gain.value = 0.05;
    ts.connect(bp).connect(tg).connect(hg);
    this.hum = { gain: hg, lp };
    // people talking
    this.crowd = c.createGain();
    this.crowd.gain.value = 0;
    const clp = c.createBiquadFilter();
    clp.type = 'lowpass';
    clp.frequency.value = 2600;
    this.crowd.connect(clp).connect(this.out);
    for (let i = 0; i < VOICES; i++) this.voices.push(this.voice(i));
    // the building site
    this.site = c.createGain();
    this.site.gain.value = 1;
    const slp = c.createBiquadFilter();
    slp.type = 'lowpass';
    slp.frequency.value = 3200;
    this.site.connect(slp).connect(this.out);
  }

  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * 1.9);
    return s;
  }

  /** a voice: a buzz at a speaking pitch through two vowel filters; update() makes it talk */
  private voice(i: number): Voice {
    const c = this.ctx!;
    const src = c.createOscillator();
    src.type = 'sawtooth';
    const pitch = i % 3 === 0 ? 190 + Math.random() * 50 : 100 + Math.random() * 45;      // women's and men's
    src.frequency.value = pitch;
    const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
    f1.type = f2.type = 'bandpass';
    f1.Q.value = 5;
    f2.Q.value = 8;
    f1.frequency.value = 500;
    f2.frequency.value = 1500;
    const mix = c.createGain();
    mix.gain.value = 1;
    const gain = c.createGain();
    gain.gain.value = 0;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    src.connect(f1).connect(mix);
    src.connect(f2).connect(mix);
    // a breath of noise in it, for the consonants
    const n = this.loop(this.noise!);
    const nb = c.createBiquadFilter();
    nb.type = 'highpass';
    nb.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.value = 0.06;
    n.connect(nb).connect(ng).connect(mix);
    mix.connect(gain).connect(pan).connect(this.crowd!);
    src.start();
    return { src, f1, f2, gain, pan, t: Math.random() * 2, talk: 0, pitch };
  }

  /** every frame: `people` near Ramu (a count), `traffic` (vehicles moving near, weighted by how near) */
  update(dt: number, people: number, traffic: number): void {
    this.heard.people = people; this.heard.traffic = traffic;
    const c = this.ctx;
    if (!c || !this.out || !this.hum || !this.crowd) return;
    if (c.state === 'suspended') void c.resume();
    const now = c.currentTime;
    // the hum: always some; more, and brighter, with traffic going by
    const busy = Math.min(1, traffic / 4);
    this.hum.gain.gain.setTargetAtTime((this.night ? 0.05 : 0.08) + busy * 0.12, now, 0.6);
    this.hum.lp.frequency.setTargetAtTime(220 + busy * 260, now, 0.6);
    // horns
    if ((this.hornT -= dt) <= 0) {
      this.honk(busy);
      const every = this.night ? 9 + Math.random() * 20 : 2.2 + Math.random() * 6 - busy * 1.5;
      this.hornT = Math.max(1.2, every);
    }
    // people talking: as many voices as people, up to all of them, louder with more
    this.level += (Math.min(1, people / 9) - this.level) * Math.min(1, dt * 1.5);
    this.crowd.gain.setTargetAtTime(this.level * 0.11, now, 0.3);
    const talking = Math.min(VOICES, Math.ceil(people * 0.7));
    this.voices.forEach((v, i) => {
      if ((v.t -= dt) > 0) return;
      const on = i < talking;
      if (!on) { v.gain.gain.setTargetAtTime(0, now, 0.15); v.t = 0.5; return; }
      if (v.talk <= 0) {
        // between sentences: quiet a while, then a new one
        v.gain.gain.setTargetAtTime(0, now, 0.06);
        v.talk = 1.5 + Math.random() * 4;
        v.t = 0.4 + Math.random() * 2.2;
        v.pan.pan.setTargetAtTime(Math.random() * 1.6 - 0.8, now, 0.5);
        return;
      }
      // a syllable: a vowel (its two formants), a pitch that wanders, a loudness; now and then a short gap
      const syl = 0.09 + Math.random() * 0.16;
      v.talk -= syl;
      v.t = syl;
      const gap = Math.random() < 0.12;
      v.gain.gain.setTargetAtTime(gap ? 0.05 : 0.35 + Math.random() * 0.65, now, 0.025);
      v.f1.frequency.setTargetAtTime(300 + Math.random() * 550, now, 0.03);
      v.f2.frequency.setTargetAtTime(900 + Math.random() * 1500, now, 0.03);
      v.src.frequency.setTargetAtTime(v.pitch * (0.85 + Math.random() * 0.35), now, 0.05);
    });
    // the building site, by day
    if (!this.night && (this.siteT -= dt) <= 0) this.siteT = this.work();
    // crickets, at night
    if (this.night && (this.chirpT -= dt) <= 0) { this.chirp(); this.chirpT = 0.5 + Math.random() * 1.2; }
  }

  /** somebody honking somewhere: a car's, an auto's, a bike's, a truck's; one to three beeps */
  private honk(busy: number): void {
    const c = this.ctx!, now = c.currentTime;
    const kinds: [number[], OscillatorType][] = [[[415, 520], 'square'], [[370, 380], 'square'], [[480, 600], 'square'], [[262, 330, 392], 'sawtooth'], [[330, 415], 'square']];
    const [fs, wave] = kinds[Math.floor(Math.random() * kinds.length)];
    const far = Math.random();
    const vol = (0.012 + (1 - far) * 0.03) * (0.6 + busy * 0.6);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700 + (1 - far) * 1800;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.random() * 1.8 - 0.9;
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(lp).connect(pan).connect(this.out!);
    let t = now;
    const beeps = Math.random() < 0.5 ? 1 : Math.random() < 0.6 ? 2 : 3;
    for (let i = 0; i < beeps; i++) {
      const len = 0.12 + Math.random() * (i === beeps - 1 ? 0.5 : 0.15);
      g.gain.setTargetAtTime(vol, t, 0.01);
      g.gain.setTargetAtTime(0, t + len, 0.02);
      t += len + 0.08 + Math.random() * 0.1;
    }
    for (const f of fs) {
      const o = c.createOscillator();
      o.type = wave;
      o.frequency.value = f * (0.97 + Math.random() * 0.06);
      o.connect(g);
      o.start(now);
      o.stop(t + 0.2);
    }
  }

  /** the building site: one spell of work (hammering, a drill, a grinder) or a quiet one; returns seconds till the next */
  private work(): number {
    const r = Math.random();
    const pan = Math.random() * 1.4 - 0.7;
    if (r < 0.4) {
      // hammering on steel: a run of blows
      const n = 4 + Math.floor(Math.random() * 9), gap = 0.42 + Math.random() * 0.25;
      for (let i = 0; i < n; i++) this.clank(this.ctx!.currentTime + i * gap * (0.9 + Math.random() * 0.2), pan);
      return n * gap + 2 + Math.random() * 6;
    }
    if (r < 0.62) { const s = 1.5 + Math.random() * 3.5; this.drill(s, pan); return s + 3 + Math.random() * 7; }
    if (r < 0.8) { const s = 2 + Math.random() * 4; this.grind(s, pan); return s + 3 + Math.random() * 8; }
    return 4 + Math.random() * 8;                                               // a quiet spell
  }

  private dest(pan: number, vol: number, to: AudioNode = this.site!): GainNode {
    const c = this.ctx!;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    const g = c.createGain();
    g.gain.value = vol;
    g.connect(p).connect(to);
    return g;
  }

  /** a hammer on steel: a knock, and a short ring of steel's out-of-tune partials */
  private clank(at: number, pan: number): void {
    const c = this.ctx!, out = this.dest(pan, 0.05);
    for (const [f, v, d] of [[1180, 0.5, 0.18], [2770, 0.35, 0.12], [4290, 0.2, 0.08], [610, 0.3, 0.1]] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (0.98 + Math.random() * 0.04);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(v, at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + d + 0.05);
    }
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.6, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    n.connect(bp).connect(g).connect(out);
    n.start(at, Math.random());
    n.stop(at + 0.06);
  }

  /** a drill: a motor's buzz, chattering as it bites */
  private drill(secs: number, pan: number): void {
    const c = this.ctx!, now = c.currentTime, out = this.dest(pan, 0);
    out.gain.setTargetAtTime(0.022, now, 0.08);
    out.gain.setTargetAtTime(0, now + secs, 0.1);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, now);
    o.frequency.exponentialRampToValueAtTime(118, now + 0.4);
    const am = c.createOscillator();
    am.frequency.value = 22 + Math.random() * 8;
    const amg = c.createGain();
    amg.gain.value = 0.5;
    const body = c.createGain();
    body.gain.value = 0.6;
    am.connect(amg).connect(body.gain);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.5;
    o.connect(bp).connect(body).connect(out);
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const nb = c.createBiquadFilter();
    nb.type = 'bandpass';
    nb.frequency.value = 2400;
    const ng = c.createGain();
    ng.gain.value = 0.25;
    n.connect(nb).connect(ng).connect(body);
    for (const s of [o, am, n]) { s.start(now); s.stop(now + secs + 0.6); }
  }

  /** an angle grinder: a high whine over a hiss, the pitch sagging as it cuts */
  private grind(secs: number, pan: number): void {
    const c = this.ctx!, now = c.currentTime, out = this.dest(pan, 0);
    out.gain.setTargetAtTime(0.012, now, 0.15);
    out.gain.setTargetAtTime(0, now + secs, 0.2);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(2300, now);
    o.frequency.linearRampToValueAtTime(3100, now + 0.5);
    for (let t = now + 0.8; t < now + secs; t += 0.6 + Math.random()) o.frequency.setTargetAtTime(2500 + Math.random() * 600, t, 0.2);
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const nb = c.createBiquadFilter();
    nb.type = 'bandpass';
    nb.frequency.value = 4200;
    nb.Q.value = 2;
    const ng = c.createGain();
    ng.gain.value = 1.6;
    const og = c.createGain();
    og.gain.value = 0.4;
    o.connect(og).connect(out);
    n.connect(nb).connect(ng).connect(out);
    for (const s of [o, n]) { s.start(now); s.stop(now + secs + 0.8); }
  }

  /** a cricket: a few quick pulses of a high tone */
  private chirp(): void {
    const c = this.ctx!, now = c.currentTime;
    const out = this.dest(Math.random() * 1.6 - 0.8, 0.006 + Math.random() * 0.008, this.out!);     // (not through the site's muffling)
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 4300 + Math.random() * 500;
    const g = c.createGain();
    g.gain.value = 0;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = now + i * 0.045;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.008);
      g.gain.linearRampToValueAtTime(0, t + 0.03);
    }
    o.connect(g).connect(out);
    o.start(now);
    o.stop(now + n * 0.045 + 0.05);
  }
}
