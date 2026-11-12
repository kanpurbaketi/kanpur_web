/*
 Player preferences (this browser only, localStorage). Changes apply live: Ramu and the menu subscribe.
   skinTone  0 = deep ... 1 = fair; DEFAULT_SKIN is the tone the character was authored with, lightened a little.
*/

const KEY = 'kanpur.prefs.v1';
export const DEFAULT_SKIN = 0.52;

export interface Prefs { skinTone: number }

export class PlayerPrefs {
  private p: Prefs = { skinTone: DEFAULT_SKIN };
  private listeners: (() => void)[] = [];

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
      if (typeof s.skinTone === 'number' && isFinite(s.skinTone)) this.p.skinTone = Math.min(1, Math.max(0, s.skinTone));
    } catch {
      /* storage unavailable or corrupt: defaults */
    }
  }

  get skinTone(): number {
    return this.p.skinTone;
  }

  set skinTone(v: number) {
    this.p.skinTone = Math.min(1, Math.max(0, v));
    try {
      localStorage.setItem(KEY, JSON.stringify(this.p));
    } catch {
      /* storage unavailable */
    }
    for (const f of this.listeners) f();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }
}

/** Skin tone 0..1 -> the shader's gamma on skin pixels (<1 lightens) and a warm tint (only for the fair end). */
export function skinParams(t: number): { gamma: number; tint: [number, number, number] } {
  return { gamma: 1.12 - 0.5 * t, tint: [1 + 0.06 * t, 1 + 0.02 * t, 1 - 0.03 * t] };
}

/** A representative skin colour for the settings swatch (CSS). The base is the average skin pixel of the texture. */
export function skinSwatch(t: number): string {
  const { gamma, tint } = skinParams(t);
  const base = [0.415, 0.291, 0.216];
  const c = base.map((v, i) => Math.min(1, Math.pow(v, gamma) * tint[i]));
  return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
}
