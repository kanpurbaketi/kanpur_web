/*
 The story's sounds. A recording in public/audio/sfx/<name>.mp3 is played if there is one; otherwise it is made here
 with WebAudio (the audio context starts on the first click, and the stage's Start is one).
   stomach   a long hungry growl: a low buzzing tone that bends up and down, gurgling, under a little muffled noise
   applause  a crowd clapping: hundreds of short noise bursts (each a clap, its own pitch), thick at first, thinning out
   boo       a crowd booing: a dozen low voices on an "ooo" (buzzing tones through the vowel's two formants), each its own
             pitch, sliding down
   thud      something soft hitting somebody: a short low knock
*/

let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

/** try the recording first */
function file(name: string): Promise<boolean> {
  return new Promise((done) => {
    const a = new Audio(`audio/sfx/${name}.mp3`);
    const t = setTimeout(() => done(false), 700);
    a.addEventListener('canplaythrough', () => { clearTimeout(t); void a.play().then(() => done(true), () => done(false)); }, { once: true });
    a.addEventListener('error', () => { clearTimeout(t); done(false); }, { once: true });
    a.load();
  });
}

export type Sfx = 'stomach' | 'applause' | 'boo' | 'thud';

export async function playSfx(name: Sfx, volume = 1, secs = 3.5): Promise<void> {
  if (await file(name)) return;
  if (name === 'stomach') growl(volume);
  else if (name === 'applause') applause(volume, secs);
  else if (name === 'boo') boo(volume, secs);
  else if (name === 'thud') thud(volume);
}

function boo(volume: number, dur: number): void {
  const c = audio();
  void c.resume();
  const t0 = c.currentTime + 0.02;
  const out = c.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(0.22 * volume, t0 + 0.35);
  out.gain.setValueAtTime(0.22 * volume, t0 + dur - 0.8);
  out.gain.linearRampToValueAtTime(0, t0 + dur);
  // the "ooo": two formants
  const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), mix = c.createGain();
  f1.type = f2.type = 'bandpass';
  f1.frequency.value = 330; f1.Q.value = 5;
  f2.frequency.value = 820; f2.Q.value = 7;
  mix.gain.value = 1;
  f1.connect(mix); f2.connect(mix);
  mix.connect(out).connect(c.destination);
  for (let i = 0; i < 12; i++) {
    const o = c.createOscillator(), g = c.createGain(), start = t0 + Math.random() * 0.5, f = 95 + Math.random() * 90;
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, start);
    o.frequency.linearRampToValueAtTime(f * 0.82, t0 + dur);
    const vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 4 + Math.random() * 3;
    vg.gain.value = 3;
    vib.connect(vg).connect(o.frequency);
    g.gain.value = 0.5 + Math.random() * 0.5;
    o.connect(g);
    g.connect(f1); g.connect(f2);
    for (const x of [o, vib]) { x.start(start); x.stop(t0 + dur + 0.05); }
  }
}

function thud(volume: number): void {
  const c = audio();
  void c.resume();
  const t0 = c.currentTime + 0.01;
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.setValueAtTime(140, t0);
  o.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
  g.gain.setValueAtTime(0.6 * volume, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + 0.2);
}

/** a crowd clapping for `dur` seconds */
function applause(volume: number, dur: number): void {
  const c = audio();
  void c.resume();
  const t0 = c.currentTime + 0.02;
  // one clap: 40 ms of noise falling away fast
  const len = Math.ceil(c.sampleRate * 0.04), clap = c.createBuffer(1, len, c.sampleRate), d = clap.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18));
  const out = c.createGain();
  out.gain.value = 0.5 * volume;
  out.connect(c.destination);
  // ~30 people clapping ~3 times a second each at the start, fewer toward the end
  const n = Math.round(90 * dur);
  for (let i = 0; i < n; i++) {
    const u = Math.random(), t = t0 + dur * (1 - Math.sqrt(1 - u)) ;   // more early on
    const s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    s.buffer = clap;
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 1800;
    bp.Q.value = 1.2;
    g.gain.value = 0.25 + Math.random() * 0.5;
    s.connect(bp).connect(g).connect(out);
    s.start(t);
  }
}

function growl(volume: number): void {
  const c = audio();
  void c.resume();
  const t0 = c.currentTime + 0.02, dur = 1.9;
  const out = c.createGain();
  out.gain.value = 0;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  lp.Q.value = 4;
  lp.connect(out).connect(c.destination);
  // the tone: a buzzing sawtooth whose pitch wanders (two slow bends and a quick gurgle on top)
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(70, t0);
  osc.frequency.linearRampToValueAtTime(105, t0 + 0.5);
  osc.frequency.linearRampToValueAtTime(62, t0 + 1.1);
  osc.frequency.linearRampToValueAtTime(95, t0 + 1.6);
  osc.frequency.linearRampToValueAtTime(55, t0 + dur);
  const gurgle = c.createOscillator(), gg = c.createGain();
  gurgle.frequency.value = 9;
  gg.gain.value = 14;
  gurgle.connect(gg).connect(osc.frequency);
  osc.connect(lp);
  // a bubbling loudness: on and off a few times, fading in and out
  const g = out.gain, v = 0.55 * volume;
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(v * 0.6, t0 + 0.15);
  for (let i = 0, t = t0 + 0.15; t < t0 + dur - 0.3; i++, t += 0.12 + ((i * 37) % 7) * 0.02) {
    g.linearRampToValueAtTime(v * (0.45 + ((i * 53) % 10) / 18), t);
  }
  g.linearRampToValueAtTime(0, t0 + dur);
  // muffled noise under it
  const n = c.createBufferSource(), buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.35;
  n.buffer = buf;
  const nlp = c.createBiquadFilter();
  nlp.type = 'lowpass';
  nlp.frequency.value = 180;
  n.connect(nlp).connect(out);
  for (const s of [osc, gurgle, n]) { s.start(t0); s.stop(t0 + dur + 0.05); }
}
