/*
 Game settings edited in the admin portal (admin.html) and read by the game.
 Stored in localStorage, so they apply to this browser only; an open game tab picks up changes live
 through the `storage` event.
*/
const KEY = 'kanpur.settings.v1';

export interface Settings {
  /** people kept around the player on a desktop (touch devices use half) */
  crowd: number;
  /** Ramu: skin tone 0 (deep) .. 100 (fair) */
  skinTone: number;
  /** Ramu: walking speed, m/s (no run key held) */
  walkSpeed: number;
  /** Ramu: running speed, m/s */
  runSpeed: number;
  /** Ramu: take-off speed of a jump, m/s (height = v^2 / 2g, so 5 is about 1.3 m) */
  jumpSpeed: number;
  /** Ramu: punch animation speed, 1 = the clip as made */
  punchSpeed: number;
}

export const CROWD_MAX = 300;
export const DEFAULTS: Settings = { crowd: 90, skinTone: 52, walkSpeed: 2.2, runSpeed: 5.6, jumpSpeed: 5, punchSpeed: 2.4 };

/** min, max, step for each setting (the admin sliders and the validation use the same table) */
export const LIMITS: Record<keyof Settings, [number, number, number]> = {
  crowd: [0, CROWD_MAX, 5],
  skinTone: [0, 100, 1],
  walkSpeed: [1, 6, 0.1],
  runSpeed: [3, 12, 0.1],
  jumpSpeed: [3, 9, 0.1],
  punchSpeed: [0.5, 4, 0.1],
};

function clean(s: Partial<Settings>): Settings {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = Number(s[k]);
    const [lo, hi] = LIMITS[k];
    if (s[k] !== undefined && Number.isFinite(v)) out[k] = Math.max(lo, Math.min(hi, k === 'crowd' ? Math.round(v) : v));
  }
  return out;
}

export function loadSettings(): Settings {
  try {
    return clean({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') });
  } catch {
    return { ...DEFAULTS };
  }
}

/** Returns false if the browser refused to store it (private mode, storage blocked). */
export function saveSettings(s: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(clean(s)));
    return true;
  } catch {
    return false;
  }
}

/** Called when another tab (the admin portal) changes the settings. */
export function onSettingsChange(fn: (s: Settings) => void): void {
  addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) fn(loadSettings());
  });
}
