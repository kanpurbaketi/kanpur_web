import { DEFAULTS, LIMITS, Settings, loadSettings, onSettingsChange, saveSettings } from '../game/settings';
import { skinSwatch } from '../game/skin';
import { HOME, loadManifest, openIds, saveOpen, type Manifest } from '../game/parts';

/*
 Admin portal: a sign-in gate, then the settings the game reads (crowd, Ramu's skin tone and speeds).

 The gate is only a gate. This is a static page with no server, so the check runs in the browser: the password is not
 in the source (only its SHA-256), but anyone who can open the developer tools can get past it or edit the settings
 directly. Do not use it to protect anything that matters.
*/

const SESSION = 'kanpur.admin.session';
const HASH = 'dda3c6fd33c074a64f87b81d9445f40d97c3b32c56070149ddc4d6f210ab4218'; // sha256("kanpur-admin:<user>:<password>")

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loginEl = $('login'), appEl = $('app'), logout = $('logout'), err = $('login-err');

function signedIn(): boolean {
  try {
    return sessionStorage.getItem(SESSION) === HASH;
  } catch {
    return false;
  }
}

function gate(): void {
  const ok = signedIn();
  loginEl.hidden = ok;
  appEl.hidden = !ok;
  logout.hidden = !ok;
  if (!ok) $('user').focus();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = ($('user') as HTMLInputElement).value.trim();
  const pass = ($('pass') as HTMLInputElement).value;
  let h = '';
  try {
    h = await sha256(`kanpur-admin:${user}:${pass}`);
  } catch {
    err.textContent = 'This browser cannot check passwords here (it needs https or localhost).';
    return;
  }
  if (h === HASH) {
    try {
      sessionStorage.setItem(SESSION, HASH);
    } catch {
      /* private mode: the gate just stays open for this page load */
    }
    err.textContent = '';
    ($('pass') as HTMLInputElement).value = '';
    appEl.hidden = false;
    loginEl.hidden = true;
    logout.hidden = false;
  } else {
    err.textContent = 'Wrong username or password.';
    ($('pass') as HTMLInputElement).select();
  }
});

logout.addEventListener('click', () => {
  try {
    sessionStorage.removeItem(SESSION);
  } catch {
    /* nothing to clear */
  }
  gate();
});

// ---- settings ------------------------------------------------------------------------------------------

interface Row { key: keyof Settings; label: string; hint: string; unit: string; where: 'world' | 'ramu'; ends?: [string, string]; fmt?: (v: number) => string }

const ROWS: Row[] = [
  { key: 'crowd', label: 'Crowd density', hint: 'How many pedestrians are kept on the streets around the player.', unit: 'people', where: 'world',
    fmt: (v) => String(v) },
  { key: 'skinTone', label: 'Skin tone', hint: 'Applies to his skin only, not the clothes.', unit: '', where: 'ramu', ends: ['Deep', 'Fair'], fmt: (v) => String(v) },
  { key: 'walkSpeed', label: 'Walking speed', hint: 'Without the run key.', unit: 'm/s', where: 'ramu', fmt: (v) => v.toFixed(1) },
  { key: 'runSpeed', label: 'Running speed', hint: 'While the run key is held.', unit: 'm/s', where: 'ramu', fmt: (v) => v.toFixed(1) },
  { key: 'jumpSpeed', label: 'Jumping speed', hint: 'Take-off speed: a bigger number is a higher, longer jump.', unit: 'm/s', where: 'ramu', fmt: (v) => v.toFixed(1) },
  { key: 'punchSpeed', label: 'Punch speed', hint: '1× is the original animation; higher is faster.', unit: '×', where: 'ramu', fmt: (v) => v.toFixed(1) },
];

const status = $('status');
let clear = 0;
function saved(ok: boolean): void {
  status.textContent = ok ? 'Saved' : 'Could not save: this browser is blocking storage.';
  status.classList.toggle('err', !ok);
  clearTimeout(clear);
  if (ok) clear = window.setTimeout(() => (status.textContent = ''), 1500);
}

const inputs = new Map<keyof Settings, { slider: HTMLInputElement; out: HTMLOutputElement; tag?: HTMLElement; swatch?: HTMLElement }>();

function levelName(n: number): string {
  return n === 0 ? 'Empty' : n <= 60 ? 'Quiet' : n <= 120 ? 'Normal' : n <= 220 ? 'Busy' : 'Festival';
}

function paint(r: Row, v: number): void {
  const e = inputs.get(r.key)!;
  e.slider.value = String(v);
  e.out.textContent = (r.fmt ?? String)(v);
  if (e.tag) e.tag.textContent = levelName(v);
  if (e.swatch) e.swatch.style.background = skinSwatch(v / 100);
}

function change(r: Row, v: number): void {
  paint(r, v);
  saved(saveSettings({ ...loadSettings(), [r.key]: v }));
}

for (const r of ROWS) {
  const [lo, hi, step] = LIMITS[r.key];
  const d = document.createElement('div');
  d.className = 'setting';
  const id = `s-${r.key}`;
  d.innerHTML = `<div class="top"><label for="${id}">${r.label}</label></div><p class="hint">${r.hint}</p>`;
  const top = d.firstElementChild as HTMLElement;
  const out = document.createElement('output');
  out.htmlFor = id;
  top.append(out);
  if (r.unit) {
    const u = document.createElement('span');
    u.className = 'unit';
    u.textContent = r.unit;
    top.append(u);
  }
  const ent: { slider: HTMLInputElement; out: HTMLOutputElement; tag?: HTMLElement; swatch?: HTMLElement } = { slider: null as never, out };
  if (r.key === 'crowd') {
    ent.tag = document.createElement('span');
    ent.tag.className = 'tag';
    top.append(ent.tag);
  }
  if (r.key === 'skinTone') {
    ent.swatch = document.createElement('span');
    ent.swatch.className = 'swatch';
    top.append(ent.swatch);
  }
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = id;
  slider.min = String(lo);
  slider.max = String(hi);
  slider.step = String(step);
  ent.slider = slider;
  slider.addEventListener('input', () => change(r, Number(slider.value)));
  d.append(slider);
  const scale = document.createElement('div');
  scale.className = 'scale';
  const [a, b] = r.ends ?? [String(lo), String(hi)];
  scale.innerHTML = `<span>${a}</span><span>${b}</span>`;
  d.append(scale);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'link';
  reset.textContent = 'Default';
  reset.setAttribute('aria-label', `Reset ${r.label} to its default`);
  reset.addEventListener('click', () => change(r, DEFAULTS[r.key]));
  top.append(reset);
  inputs.set(r.key, ent);
  $(r.where).append(d);
}

const PRESETS: [string, number][] = [['Empty', 0], ['Quiet', 40], ['Normal', 90], ['Busy', 160], ['Festival', 300]];
const crowdRow = ROWS[0];
const presets = $('presets');
const syncPresets = (n: number) => {
  for (const b of Array.from(presets.children)) b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.n) === n));
};
for (const [name, n] of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.dataset.n = String(n);
  b.addEventListener('click', () => { change(crowdRow, n); syncPresets(n); });
  presets.append(b);
}
inputs.get('crowd')!.slider.addEventListener('input', () => syncPresets(Number(inputs.get('crowd')!.slider.value)));

function showAll(s: Settings): void {
  for (const r of ROWS) paint(r, s[r.key]);
  syncPresets(s.crowd);
}

$('reset-all').addEventListener('click', () => {
  if (!confirm('Reset the crowd and all of Ramu\u2019s settings to their defaults?')) return;
  saved(saveSettings({ ...DEFAULTS }));
  showAll({ ...DEFAULTS });
});

onSettingsChange(showAll); // another admin tab changed something
showAll(loadSettings());
gate();

// ---- parts of Kanpur ----------------------------------------------------------------------------------

async function parts(): Promise<void> {
  const m: Manifest = await loadManifest();
  const list = $('part-list'), search = $('part-search') as HTMLInputElement, st = $('part-status');
  let open = new Set(openIds(m));
  const say = (t: string, err = false) => { st.textContent = t; st.classList.toggle('err', err); };
  const persist = () => say(saveOpen([...open]) ? 'Saved' : 'Could not save: this browser is blocking storage.', false);
  const sorted = [...m.parts].sort((a, b) => (a.id === HOME ? -1 : b.id === HOME ? 1 : b.buildings - a.buildings));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    for (const p of sorted) {
      if (q && !p.title.toLowerCase().includes(q) && !p.id.includes(q)) continue;
      const row = document.createElement('label');
      row.className = 'part' + (p.built ? '' : ' unbuilt');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = open.has(p.id);
      cb.disabled = !p.built || p.id === HOME;
      cb.setAttribute('aria-label', `Open ${p.title}`);
      cb.addEventListener('change', () => { cb.checked ? open.add(p.id) : open.delete(p.id); persist(); count(); });
      const name = document.createElement('span');
      name.textContent = p.title;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.innerHTML = p.built ? `${p.buildings.toLocaleString()} buildings` : `build: <code>build_part.py ${p.id}</code>`;
      const chip = document.createElement('span');
      chip.className = 'chip' + (p.built ? '' : ' no');
      chip.textContent = p.built ? 'Built' : 'Not built';
      row.append(cb, name, meta, chip);
      list.append(row);
    }
    if (!list.children.length) list.textContent = 'No parts match.';
  };
  const count = () => {
    const built = m.parts.filter((p) => p.built).length;
    $('part-count').textContent = `${m.parts.length} parts in the grid · ${built} built · ${[...open].filter((id) => m.parts.some((p) => p.id === id && p.built)).length} open. ` +
      'Build more with: .venv/bin/python tools/osm/build_part.py --all';
  };
  search.addEventListener('input', draw);
  $('open-built').addEventListener('click', () => { open = new Set(m.parts.filter((p) => p.built).map((p) => p.id)); persist(); draw(); count(); });
  $('close-all').addEventListener('click', () => { open = new Set([HOME]); persist(); draw(); count(); });
  $('export-parts').addEventListener('click', () => {
    const out = { ...m, parts: m.parts.map((p) => ({ ...p, open: open.has(p.id) })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 0)], { type: 'application/json' }));
    a.download = 'parts.json';
    a.click();
    URL.revokeObjectURL(a.href);
    say('Put the downloaded file at public/data/parts.json and rebuild to publish it.');
  });
  draw();
  count();
}
void parts();
