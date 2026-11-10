import { CROWD_MAX, DEFAULTS, loadSettings, onSettingsChange, saveSettings } from '../game/settings';

const PRESETS: [string, number][] = [['Empty', 0], ['Quiet', 40], ['Normal', 90], ['Busy', 160], ['Festival', 300]];

const slider = document.getElementById('crowd') as HTMLInputElement;
const out = document.getElementById('crowd-out')!;
const level = document.getElementById('level')!;
const status = document.getElementById('status')!;
const presets = document.getElementById('presets')!;
slider.max = String(CROWD_MAX);

function levelName(n: number): string {
  return n === 0 ? 'Empty' : n <= 60 ? 'Quiet' : n <= 120 ? 'Normal' : n <= 220 ? 'Busy' : 'Festival';
}

function show(n: number): void {
  slider.value = String(n);
  out.textContent = String(n);
  level.textContent = levelName(n);
  for (const b of Array.from(presets.children)) b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.n) === n));
}

let clear = 0;
function set(n: number): void {
  show(n);
  const ok = saveSettings({ ...loadSettings(), crowd: n });
  status.textContent = ok ? 'Saved' : 'Could not save: this browser is blocking storage.';
  status.classList.toggle('err', !ok);
  clearTimeout(clear);
  if (ok) clear = window.setTimeout(() => (status.textContent = ''), 1500);
}

for (const [name, n] of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.dataset.n = String(n);
  b.addEventListener('click', () => set(n));
  presets.append(b);
}
slider.addEventListener('input', () => set(Number(slider.value)));
document.getElementById('reset')!.addEventListener('click', () => set(DEFAULTS.crowd));
onSettingsChange((s) => show(s.crowd)); // another admin tab changed it
show(loadSettings().crowd);
