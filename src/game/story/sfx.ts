/*
 The game's sound effects: recordings in public/audio/sfx (tools/audio/make_sounds.sh; CC0, public/audio/CREDITS.md),
 loaded once and played through WebAudio as loud and as long as asked; until a recording has loaded (or if it is
 missing), the stand-in made here plays instead (the audio context starts on the first click, and the stage's Start is one).
   stomach   a hungry growl              (stand-in: a low buzzing tone that bends up and down, gurgling)
   applause  a crowd clapping            (stand-in: hundreds of short noise bursts, thick at first, thinning out)
   boo       a crowd booing              (stand-in: a dozen low voices on an "ooo", sliding down)
   thud      something soft hitting somebody (stand-in: a short low knock)
   punch     a fist landing, one of four at random (stand-in: the thud)
   shot      the revolver firing; flesh: a bullet into somebody; ricochet: one off a wall; cock: the hammer drawn back
             (Explore world: src/player/gun.ts; stand-in: the thud)
*/

let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

export type Sfx = 'stomach' | 'applause' | 'boo' | 'thud' | 'punch' | 'shot' | 'flesh' | 'ricochet' | 'cock';

/** the recordings of each (a random one plays) */
const FILES: Record<Sfx, string[]> = {
  stomach: ['stomach'], applause: ['applause'], boo: ['boo'], thud: ['thud'],
  punch: ['punch1', 'punch2', 'punch3', 'punch4'],
  shot: ['shot1', 'shot2'], flesh: ['flesh1', 'flesh2', 'flesh3'], ricochet: ['ricochet'], cock: ['cock'],
};
/** how loud each recording plays at volume 1 (they are loudness-matched; the crowds sit a little under the hits) */
const GAIN: Record<Sfx, number> = { stomach: 0.9, applause: 0.8, boo: 0.8, thud: 0.8, punch: 0.7, shot: 0.9, flesh: 0.8, ricochet: 0.5, cock: 0.6 };

const buffers = new Map<string, Promise<AudioBuffer | null>>();
function load(name: string): Promise<AudioBuffer | null> {
  let p = buffers.get(name);
  if (!p) {
    p = fetch(`audio/sfx/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => audio().decodeAudioData(b))
      .catch(() => null);
    buffers.set(name, p);
  }
  return p;
}

/** start loading every recording (once the audio context may exist: after the first click) */
export function preloadSfx(): void {
  for (const list of Object.values(FILES)) for (const f of list) void load(f);
}

/** a recording, if loaded: as loud as `volume`, cut off (faded) after `secs` */
function recording(buf: AudioBuffer, volume: number, secs: number): void {
  const c = audio();
  const t0 = c.currentTime + 0.01;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.95 + Math.random() * 0.1;         // never quite the same twice
  const g = c.createGain();
  g.gain.value = volume;
  const len = Math.min(secs, buf.duration / src.playbackRate.value);
  if (len < buf.duration / src.playbackRate.value - 0.05) {    // cut short: faded out over the last part
    g.gain.setValueAtTime(volume, t0 + Math.max(0, len - 0.8));
    g.gain.linearRampToValueAtTime(0, t0 + len);
  }
  src.connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + len + 0.05);
}

export async function playSfx(name: Sfx, volume = 1, secs = 3.5): Promise<void> {
  const c = audio();
  if (c.state === 'suspended') void c.resume();
  const list = FILES[name];
  const buf = await Promise.race([load(list[Math.floor(Math.random() * list.length)]), new Promise<null>((r) => setTimeout(() => r(null), 120))]);
  if (buf) return recording(buf, volume * GAIN[name], name === 'applause' || name === 'boo' ? secs : buf.duration);
  if (name === 'stomach') growl(volume);
  else if (name === 'applause') applause(volume, secs);
  else if (name === 'boo') boo(volume, secs);
  else thud(volume);
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
