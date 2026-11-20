/*
 The story's sounds. A recording in public/audio/sfx/<name>.mp3 is played if there is one; otherwise it is made here
 with WebAudio (the audio context starts on the first click, and the stage's Start is one).
   stomach   a long hungry growl: a low buzzing tone that bends up and down, gurgling, under a little muffled noise
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

export async function playSfx(name: 'stomach', volume = 1): Promise<void> {
  if (await file(name)) return;
  if (name === 'stomach') growl(volume);
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
