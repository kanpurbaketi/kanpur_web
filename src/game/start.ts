/** Where a game in Moti Jheel starts (menu → Places → Start at). `?spawn=` in the URL overrides it. */
export type Start = 'shivaji' | 'inside';
export const STARTS: { id: Start; title: string; note: string }[] = [
  { id: 'shivaji', title: 'Shivaji Putla gate', note: 'Stage 1 from the start: find the way to the mela' },
  { id: 'inside', title: 'Inside the mela', note: 'By the stage, past the torn place in the cloth' },
];
const KEY = 'kanpur.start.v1';

export function startChoice(): Start {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'shivaji' || v === 'inside') return v;
  } catch { /* private window: the default */ }
  return 'shivaji';
}

export function setStartChoice(s: Start): void {
  try { localStorage.setItem(KEY, s); } catch { /* not kept: still reloads there via ?spawn */ }
}
