/*
 Skin tone helpers (the tone itself is a setting, see settings.ts).
 Tone 0 = deep ... 1 = fair; the facade of the character shader lifts skin-coloured pixels by a gamma that comes from here.
*/

/** Skin tone 0..1 -> the shader's gamma on skin pixels (<1 lightens) and a warm tint (only toward the fair end). */
export function skinParams(t: number): { gamma: number; tint: [number, number, number] } {
  return { gamma: 1.12 - 0.5 * t, tint: [1 + 0.06 * t, 1 + 0.02 * t, 1 - 0.03 * t] };
}

/** A representative skin colour for the admin swatch (CSS). The base is the average skin pixel of the texture. */
export function skinSwatch(t: number): string {
  const { gamma, tint } = skinParams(t);
  const base = [0.415, 0.291, 0.216];
  const c = base.map((v, i) => Math.min(1, Math.pow(v, gamma) * tint[i]));
  return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
}
