/*
 The player's look sensitivity (Settings, in the game's menu): how fast the camera turns for a mouse movement or a drag
 on a touch screen. A step 1..10 per browser, kept apart for touch and for the mouse (a thumb and a mouse want different
 speeds), step 5 by default: twice the speed the game had before there was a setting.
*/
const KEY = `ramu.look.${matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse'}`;
export const LOOK_MIN = 1, LOOK_MAX = 10, LOOK_DEFAULT = 5;

let step = LOOK_DEFAULT;
try {
  const v = Number(localStorage.getItem(KEY));
  if (v >= LOOK_MIN && v <= LOOK_MAX) step = v;
} catch { /* private window: the default */ }

/** the step now, 1..10 */
export const lookStep = (): number => step;
/** what the step multiplies the game's old turning speed by (5: 2x, 1: 0.4x, 10: 4x) */
export const lookScale = (): number => step * 0.4;

export function setLookStep(v: number): void {
  step = Math.max(LOOK_MIN, Math.min(LOOK_MAX, Math.round(v)));
  try { localStorage.setItem(KEY, String(step)); } catch { /* private window: this visit only */ }
}
