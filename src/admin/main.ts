import { DEFAULTS, LIMITS, Settings, loadSettings, onSettingsChange, saveSettings } from '../game/settings';
import { skinSwatch } from '../game/skin';
import { HOME, loadManifest, openIds, saveOpen, type Manifest } from '../game/parts';

/*
 Admin portal: a sign-in checked by the server (ADMIN_USER / ADMIN_PASSWORD, api/admin.ts), then
   - Players: search by username or email, a player's details and play, the stages unlocked for them;
   - Ads: the loading page's ad on or off for everyone;
   - Game settings: the crowd, Ramu's skin tone and speeds, the parts of Kanpur (these stay in this browser).
*/

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loginEl = $('login'), appEl = $('app'), logout = $('logout'), err = $('login-err');

async function api<T = Record<string, unknown>>(data?: object): Promise<T> {
  const r = await fetch('api/admin', data
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }
    : { cache: 'no-store' });
  const j = await r.json().catch(() => ({ error: 'server' }));
  if (!r.ok || j.error) throw new Error(j.error ?? 'server');
  return j as T;
}

function show(ok: boolean): void {
  loginEl.hidden = ok;
  appEl.hidden = !ok;
  logout.hidden = !ok;
  if (ok) { void search(''); void loadAds(); } else $('user').focus();
}

async function gate(): Promise<void> {
  try { show((await api<{ admin: boolean }>()).admin); }
  catch { show(false); err.textContent = 'The server can’t be reached (run the game with its API: npm run dev, or on Vercel).'; }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = ($('user') as HTMLInputElement).value.trim();
  const pass = ($('pass') as HTMLInputElement).value;
  try {
    await api({ action: 'login', user, password: pass });
    err.textContent = '';
    ($('pass') as HTMLInputElement).value = '';
    show(true);
  } catch (x) {
    const code = (x as Error).message;
    err.textContent = code === 'admin_unset' ? 'ADMIN_USER and ADMIN_PASSWORD are not set on the server.'
      : code === 'login_wrong' ? 'Wrong username or password.' : 'The server can’t be reached.';
    ($('pass') as HTMLInputElement).select();
  }
});

logout.addEventListener('click', async () => {
  await api({ action: 'logout' }).catch(() => {});
  show(false);
});

// ---- tabs ----------------------------------------------------------------------------------------------

for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs button'))) {
  tab.addEventListener('click', () => {
    for (const b of Array.from(document.querySelectorAll('.tabs button'))) b.setAttribute('aria-selected', String(b === tab));
    for (const sec of Array.from(document.querySelectorAll<HTMLElement>('main > [data-tab]'))) sec.hidden = sec.dataset.tab !== tab.dataset.tab;
  });
}

// ---- players -------------------------------------------------------------------------------------------

interface Player { username: string; email: string; unlocked: number[]; created_at: string; last_login: string | null; played_s: number; plays: number }
interface StageRow { stage: number; plays: number; played_s: number; last_played: string; first_completed: string | null; completions: number; best_s: number | null; furthest: number }
interface Detail {
  user: { username: string; email: string; lang: string; unlocked: number[]; created_at: string; last_login: string | null };
  stages: StageRow[];
  runs: { stage: number; started_at: string; played_s: number; completed_at: string | null; stats: Record<string, number> }[];
  count: number;
}

const BUILT = new Set([1]);           // stages that exist in the game (src/game/stages.ts)
/** what a play's `step` (missions done, src/game/story/stage<n>.ts) means, per stage */
const STEPS: Record<number, string[]> = {
  1: ['Not past the start', 'Found the food carts (samosa refused)', 'Stood in the ticket line (pushed out)', 'In through the torn sheet (part 1 done)'],
};
const reached = (stage: number, step?: number) => STEPS[stage]?.[step ?? 0] ?? (step ? `Mission ${step}` : '—');
const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const dur = (s: number | null) => {
  if (s === null || s === undefined) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${x} s` : `${x} s`;
};
const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

let current = '';

async function search(q: string): Promise<void> {
  const list = $('user-list'), count = $('user-count');
  try {
    const { users } = await api<{ users: Player[] }>({ action: 'search', q });
    list.replaceChildren();
    for (const u of users) {
      const b = mk('button', 'user-row');
      b.type = 'button';
      b.setAttribute('role', 'listitem');
      if (u.username === current) b.setAttribute('aria-current', 'true');
      const name = mk('b', '', u.username), stages = mk('span', 'meta', `Stages ${u.unlocked.join(', ')}`);
      const email = mk('span', 'meta', u.email), play = mk('span', 'meta', `${u.plays} play${u.plays === 1 ? "" : "s"} · ${dur(u.played_s)}`);
      b.append(name, stages, email, play);
      b.addEventListener('click', () => void open(u.username));
      list.append(b);
    }
    count.textContent = users.length ? (q ? `${users.length} found${users.length === 50 ? ' (the first 50)' : ''}.` : `The newest ${users.length} players.`)
      : q ? 'No player matches.' : 'No players yet.';
    if (users.length === 1 && q) void open(users[0].username);
  } catch (x) { sessionLost(x); }
}

$('user-search').addEventListener('submit', (e) => { e.preventDefault(); void search(($('user-q') as HTMLInputElement).value.trim()); });

async function open(username: string): Promise<void> {
  current = username;
  for (const r of Array.from(document.querySelectorAll('.user-row'))) r.setAttribute('aria-current', String(r.querySelector('b')?.textContent === username));
  const box = $('user-detail');
  try {
    const d = await api<Detail>({ action: 'user', username });
    box.hidden = false;
    box.replaceChildren();
    const u = d.user;
    const kv = mk('dl', 'kv');
    for (const [k, v] of [['Email', u.email], ['Joined', when(u.created_at)], ['Last login', when(u.last_login)], ['Language', u.lang === 'hi' ? 'Hindi' : 'English']]) {
      kv.append(mk('dt', '', k), mk('dd', '', v));
    }
    box.append(mk('h3', '', u.username), kv);

    // unlocked stages
    box.append(mk('h4', '', 'Unlocked stages'));
    const boxes = mk('div', 'stage-boxes');
    const checks: HTMLInputElement[] = [];
    for (let n = 1; n <= d.count; n++) {
      const l = mk('label', 'stage-box' + (n === 1 ? ' fixed' : ''));
      const c = mk('input');
      c.type = 'checkbox';
      c.checked = u.unlocked.includes(n);
      c.disabled = n === 1;
      c.value = String(n);
      checks.push(c);
      const txt = mk('span', '', `Stage ${n}`);
      if (!BUILT.has(n)) txt.append(mk('br'), mk('small', '', 'not built yet'));
      l.append(c, txt);
      boxes.append(l);
    }
    const btns = mk('div', 'row-btns');
    const save = mk('button', 'btn', 'Save stages');
    save.type = 'button';
    const all = mk('button', 'btn ghost', 'Unlock all');
    all.type = 'button';
    const st = mk('span', 'status');
    st.setAttribute('role', 'status');
    all.addEventListener('click', () => { for (const c of checks) c.checked = true; });
    save.addEventListener('click', async () => {
      try {
        const r = await api<{ unlocked: number[] }>({ action: 'unlock', username: u.username, stages: checks.filter((c) => c.checked).map((c) => Number(c.value)) });
        st.textContent = `Saved: stages ${r.unlocked.join(', ')}`;
        st.classList.remove('err');
        void search(($('user-q') as HTMLInputElement).value.trim());
      } catch (x) { st.textContent = 'Could not save.'; st.classList.add('err'); sessionLost(x); }
    });
    btns.append(save, all, st);
    box.append(boxes, btns);

    // how they play
    box.append(mk('h4', '', 'Performance by stage'));
    if (!d.stages.length) box.append(mk('p', 'note', 'Has not played a stage yet.'));
    else {
      const t = mk('table', 'perf');
      t.innerHTML = '<thead><tr><th>Stage</th><th>Plays</th><th>Time played</th><th>Furthest</th><th>Completed</th><th>Best time to finish</th><th>Last played</th></tr></thead>';
      const tb = mk('tbody');
      for (const s of d.stages) {
        const tr = mk('tr');
        const done = mk('td', s.completions ? 'ok' : '', s.completions ? `✓ ${s.completions}× (first ${when(s.first_completed)})` : 'Not yet');
        tr.append(mk('td', '', String(s.stage)), mk('td', '', String(s.plays)), mk('td', '', dur(s.played_s)), mk('td', '', reached(s.stage, s.furthest)), done, mk('td', '', dur(s.best_s)), mk('td', '', when(s.last_played)));
        tb.append(tr);
      }
      t.append(tb);
      const w = mk('div', 'table-wrap');
      w.append(t);
      box.append(w);
      box.append(mk('h4', '', 'Recent plays'));
      const r = mk('table', 'perf');
      r.innerHTML = '<thead><tr><th>Started</th><th>Stage</th><th>Played</th><th>Reached</th><th>Finished</th><th>Injured</th><th>Damage</th><th>Vehicles taken</th><th>Walked</th><th>Ran</th><th>Top speed</th></tr></thead>';
      const rb = mk('tbody');
      for (const x of d.runs) {
        const tr = mk('tr');
        const m = (v?: number) => (v ? (v < 1000 ? `${Math.round(v)} m` : `${(v / 1000).toFixed(2)} km`) : '—');
        // the play's scorecard (src/game/stats.ts): people hurt all ways, and what the damage would cost to mend
        const hurt = (x.stats.runOver ?? 0) + (x.stats.beaten ?? 0) + (x.stats.thrown ?? 0);
        tr.append(mk('td', '', when(x.started_at)), mk('td', '', String(x.stage)), mk('td', '', dur(x.stats.finishS || x.played_s)), mk('td', '', reached(x.stage, x.stats.step)),
          mk('td', x.completed_at ? 'ok' : '', x.completed_at ? '✓' : '—'), mk('td', '', String(hurt)),
          mk('td', '', `₹${Math.round(x.stats.damageRs ?? 0).toLocaleString('en-IN')}`), mk('td', '', String(x.stats.taken ?? 0)), mk('td', '', m(x.stats.walked)), mk('td', '', m(x.stats.ran)),
          mk('td', '', x.stats.topSpeed ? `${(x.stats.topSpeed * 3.6).toFixed(1)} km/h` : '—'));
        rb.append(tr);
      }
      r.append(rb);
      const w2 = mk('div', 'table-wrap');
      w2.append(r);
      box.append(w2);
    }
  } catch (x) {
    box.hidden = false;
    box.textContent = 'Could not load this player.';
    sessionLost(x);
  }
}

function sessionLost(x: unknown): void {
  if ((x as Error).message === 'admin') show(false);
}

// ---- ads -----------------------------------------------------------------------------------------------

const adsOn = $('ads-on') as HTMLInputElement;
async function loadAds(): Promise<void> {
  try {
    const c = await api<{ ads: { enabled: boolean; adsense: boolean }; mail: string }>({ action: 'config' });
    adsOn.checked = c.ads.enabled;
    const warn = $('ads-warn');
    warn.hidden = c.ads.adsense;
    warn.textContent = 'AdSense isn’t set up on the server yet (ADSENSE_CLIENT and ADSENSE_SLOT), so no ad shows even when this is on.';
  } catch (x) { sessionLost(x); }
}
adsOn.addEventListener('change', async () => {
  const st = $('ads-status');
  try {
    const r = await api<{ enabled: boolean }>({ action: 'ads', enabled: adsOn.checked });
    st.textContent = r.enabled ? 'Ads are on for every player.' : 'Ads are off.';
    st.classList.remove('err');
  } catch (x) {
    adsOn.checked = !adsOn.checked;
    st.textContent = 'Could not save.';
    st.classList.add('err');
    sessionLost(x);
  }
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
void gate();

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
