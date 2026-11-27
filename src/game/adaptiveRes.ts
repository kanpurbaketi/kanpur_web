/*
 Adaptive resolution: when the frame rate falls below LOW the picture is drawn at fewer pixels (the pixel ratio a step
 down, to at most MIN of where it started), and when there is room again (above HIGH) a step back up.
 A step down that does not make it faster (the frame held up by the script, not the drawing: a big crowd) is taken back,
 and no other is tried for a while: no picture made soft for nothing.
*/

const LOW = 48;          // fps: under this, fewer pixels
const HIGH = 57;         // fps: over this (near a 60 Hz screen's cap), more again
const STEP = 0.85;       // each step, this much of the pixel ratio
const MIN = 0.6;         // never below this much of where it started ...
const FLOOR = 0.75;      // ... nor below this many pixels to the CSS pixel (softer than that looks blurred)
const WINDOW = 1.5;      // s of frames averaged before a decision
const GAIN = 1.06;       // a step down must make it this much faster to be kept
const HOLD = 20;         // s with no step down after one that did not help
const HOLD_UP = 12;      // s with no step up after a step down (so it does not swing up and down)

export class AdaptiveRes {
  private pr: number;
  private readonly min: number;
  private t = 0;
  private n = 0;
  private hold = 0;
  private holdUp = 0;
  private last = 0;
  /** the fps before the last step down, while waiting to see if it helped */
  private trial: number | null = null;

  constructor(private readonly base: number, private readonly apply: (pr: number) => void) {
    this.pr = base;
    this.min = Math.min(base, Math.max(base * MIN, FLOOR));
  }

  get ratio(): number { return this.pr; }

  /** every frame */
  update(): void {
    const now = performance.now() / 1000, real = now - this.last;
    this.last = now;
    if (real <= 0 || real > 0.5) return;          // (the first frame, or a tab put away and back: not a frame to count)
    this.hold = Math.max(0, this.hold - real);
    this.holdUp = Math.max(0, this.holdUp - real);
    this.t += real;
    this.n++;
    if (this.t < WINDOW) return;
    const fps = this.n / this.t;
    this.t = 0;
    this.n = 0;
    if (this.trial !== null) {
      const before = this.trial;
      this.trial = null;
      if (fps < before * GAIN) { this.set(Math.min(this.base, this.pr / STEP)); this.hold = HOLD; }   // no faster: back
      return;
    }
    if (fps < LOW && this.hold <= 0 && this.pr > this.min + 1e-3) {
      this.trial = fps;
      this.holdUp = HOLD_UP;
      this.set(Math.max(this.min, this.pr * STEP));
    } else if (fps > HIGH && this.holdUp <= 0 && this.pr < this.base - 1e-3) {
      this.set(Math.min(this.base, this.pr / STEP));
    }
  }

  private set(pr: number): void {
    if (Math.abs(pr - this.pr) < 1e-3) return;
    this.pr = pr;
    this.apply(pr);
    this.last = 0;                                // (the frame that remakes the render targets is a slow one: not counted)
  }
}
