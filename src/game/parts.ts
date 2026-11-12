/*
 The parts of Kanpur (map tiles). public/data/parts.json is the manifest written by tools/osm/make_parts.py;
 a part is "built" when its map.json exists. Which parts are open to players is chosen on the admin page:
   - the manifest's own "open" flags are the shared default (commit them with the data),
   - the admin page can override them in this browser (localStorage), which is what the game then uses.
*/

export interface Part {
  id: string;
  title: string;
  row: number;
  col: number;
  bbox: [number, number, number, number];
  center: [number, number];
  buildings: number;
  built: boolean;
  open?: boolean;
}

export interface Manifest { parts: Part[] }

const KEY = 'kanpur.parts.v1';
export const HOME = 'moti_jheel';

export async function loadManifest(): Promise<Manifest> {
  try {
    const r = await fetch('data/parts.json', { cache: 'no-cache' });
    if (r.ok) return (await r.json()) as Manifest;
  } catch {
    /* no manifest: just the home part */
  }
  return { parts: [{ id: HOME, title: 'Moti Jheel', row: 0, col: 0, bbox: [26.4736, 80.3119, 26.4846, 80.3239], center: [26.4791, 80.3179], buildings: 0, built: true, open: true }] };
}

/** the open part ids: the admin's choice in this browser, else the manifest's flags, always including home */
export function openIds(m: Manifest): string[] {
  let ids: string[] | null = null;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(s)) ids = s.filter((x) => typeof x === 'string');
  } catch {
    /* storage unavailable */
  }
  if (!ids) ids = m.parts.filter((p) => p.open).map((p) => p.id);
  if (!ids.includes(HOME)) ids.unshift(HOME);
  return ids;
}

export function saveOpen(ids: string[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

/** the parts a player can go to: open and built */
export function playable(m: Manifest): Part[] {
  const open = new Set(openIds(m));
  return m.parts.filter((p) => open.has(p.id) && p.built);
}
