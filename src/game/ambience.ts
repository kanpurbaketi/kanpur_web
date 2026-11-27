/*
 The sounds of the street round Ramu (WebAudio):
   crowd      people talking: public/audio/crowd.mp3 (a recording, looped), as loud as there are people near him, silent
              on an empty street; until the file is there, nothing
   shouts     somebody run over (or Ramu knocked down by a vehicle): a shout, one of public/audio/shout1.mp3,
              shout2.mp3, shout3.mp3 (whichever are there), as loud as it is near; until one is there, nothing
   crickets   at night, faint chirping (made here, no file)
 It starts with the first key or click (browsers will not play before one). update() every frame with the people near
 Ramu (a count); shout() where somebody was hit.
*/

const CROWD = 'audio/crowd.mp3';
const SHOUTS = ['audio/shout1.mp3', 'audio/shout2.mp3', 'audio/shout3.mp3'];
/** a shout further off than this (m) is not heard */
const SHOUT_RANGE = 70;

export class CityAmbience {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private crowd: GainNode | null = null;
  private shouts: AudioBuffer[] = [];
  private lastShout = 0;
  private chirpT = 1;
  private level = 0;
  /** what it was told last (tests read it) */
  heard = { people: 0 };

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
    const c = this.ctx;
    this.out = c.createGain();
    this.out.connect(c.destination);
    this.crowd = c.createGain();
    this.crowd.gain.value = 0;
    this.crowd.connect(this.out);
    void this.load(CROWD).then((buf) => {
      if (!buf) return;
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.connect(this.crowd!);
      s.start(0, Math.random() * buf.duration);
    });
    for (const u of SHOUTS) void this.load(u).then((buf) => { if (buf) this.shouts.push(buf); });
  }

  /** a sound file, or null if it is not there (yet) */
  private async load(url: string): Promise<AudioBuffer | null> {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await this.ctx!.decodeAudioData(await r.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** every frame: `people` near Ramu (a count) */
  update(dt: number, people: number): void {
    this.heard.people = people;
    const c = this.ctx;
    if (!c || !this.crowd) return;
    if (c.state === 'suspended') void c.resume();
    this.level += (Math.min(1, people / 10) - this.level) * Math.min(1, dt * 1.5);
    this.crowd.gain.setTargetAtTime(this.level * 0.6, c.currentTime, 0.3);
    if (this.night && (this.chirpT -= dt) <= 0) { this.chirp(); this.chirpT = 0.5 + Math.random() * 1.2; }
  }

  /** somebody hit by a vehicle `d` m from the listener (`pan` -1..1: to the left / right): a shout */
  shout(d: number, pan = 0): void {
    const c = this.ctx;
    if (!c || !this.out || !this.shouts.length || d > SHOUT_RANGE) return;
    if (c.currentTime - this.lastShout < 0.6) return;                 // one at a time
    this.lastShout = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.shouts[Math.floor(Math.random() * this.shouts.length)];
    s.playbackRate.value = 0.94 + Math.random() * 0.12;              // not the same voice every time
    const g = c.createGain();
    g.gain.value = Math.min(1, 6 / Math.max(6, d));
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(g).connect(p).connect(this.out);
    s.start();
  }

  /** a cricket: a few quick pulses of a high tone */
  private chirp(): void {
    const c = this.ctx!, now = c.currentTime;
    const p = c.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    const out = c.createGain();
    out.gain.value = 0.006 + Math.random() * 0.008;
    out.connect(p).connect(this.out!);
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
