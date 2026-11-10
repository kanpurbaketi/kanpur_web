/*
 Game settings edited in the admin portal (admin.html) and read by the game.
 Stored in localStorage, so they apply to this browser only; an open game tab picks up changes live
 through the `storage` event.
*/
const KEY = 'kanpur.settings.v1';

export interface Settings {
  /** people kept around the player on a desktop (touch devices use half) */
  crowd: number;
}

export const CROWD_MAX = 300;
export const DEFAULTS: Settings = { crowd: 90 };

function clean(s: Partial<Settings>): Settings {
  const crowd = Number(s.crowd);
  return { crowd: Number.isFinite(crowd) ? Math.max(0, Math.min(CROWD_MAX, Math.round(crowd))) : DEFAULTS.crowd };
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
