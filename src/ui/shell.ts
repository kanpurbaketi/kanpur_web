import { account, ApiError, type Me } from '../game/account';
import { STAGES, type Stage } from '../game/stages';
import { fmtNum, lang, onLang, setLang, t, tk, type Lang } from '../i18n';

/*
 Everything around the game itself: the home screen (no world loaded), signing up and logging in, the list of stages,
 the language, the loading page before a stage (at least 5 s, with an ad when the admin has ads on), and in the game the
 player's name at the top left with an ⓘ for the stage's details.
*/

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

const errText = (e: unknown) => {
  const k = `err.${e instanceof ApiError ? e.code : 'server'}`, s = tk(k);
  return s === k ? t('err.server') : s;
};

/** go to a stage (the page reloads into it) or home */
export function goStage(n: number): void {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('stage', String(n));
  location.href = u.toString();
}
/** home, with a message to show there (an i18n key, and the stage it is about) */
export function goHome(msg?: string, n?: number): void {
  const u = new URL(location.href);
  u.search = '';
  if (msg) u.searchParams.set('msg', msg);
  if (n) u.searchParams.set('n', String(n));
  location.href = u.toString();
}

// ---------- the stage list ----------

/** 10 cards: the unlocked ones can be played (a built one starts, one not built yet says so), the rest are locked */
export function stagesView(opts: { current?: number; done?: Set<number>; onMsg: (m: string) => void }): HTMLElement {
  const wrap = el('div', 'sh-stages');
  const unlocked = new Set(account.me?.unlocked ?? [1]);
  for (const s of STAGES) {
    const open = unlocked.has(s.n), here = s.n === opts.current;
    const b = el('button', 'sh-stage' + (open ? '' : ' locked') + (here ? ' here' : ''));
    b.type = 'button';
    b.disabled = !open || here;
    const num = el('span', 'sh-stage-n', String(s.n));
    const name = el('span', 'sh-stage-t', s.built ? tk(`stage.${s.n}.title`) : t('stage.soon'));
    const state = el('span', 'sh-stage-s',
      here ? t('stage.playing') : !open ? `🔒 ${t('stage.locked')}` : opts.done?.has(s.n) ? `✓ ${t('stage.done')}` : s.built ? `▶ ${t('stage.play')}` : t('stage.soon'));
    b.append(num, el('span', 'sh-stage-l', t('stage.n', { n: s.n })), name, state);
    b.setAttribute('aria-label', `${t('stage.n', { n: s.n })}: ${name.textContent}, ${state.textContent}`);
    b.addEventListener('click', async () => {
      if (!account.me) {
        const m = await authDialog('login');
        if (!m) return;
        if (!m.unlocked.includes(s.n)) return opts.onMsg(t('stage.lockedMsg', { n: s.n }));
      }
      if (!s.built) return opts.onMsg(t('stage.notReady', { n: s.n }));
      goStage(s.n);
    });
    wrap.append(b);
  }
  return wrap;
}

// ---------- settings: language and account ----------

export function settingsView(opts: { onLogout: () => void; onLogin?: () => void }): HTMLElement {
  const box = el('div', 'sh-settings');
  const h1 = el('h3', '', t('settings.language'));
  const seg = el('div', 'sh-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', t('settings.language'));
  for (const [l, name] of [['en', 'English'], ['hi', 'हिंदी']] as [Lang, string][]) {
    const b = el('button', '', name);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(l === lang));
    b.addEventListener('click', () => { setLang(l); account.saveLang(l); });
    seg.append(b);
  }
  const h2 = el('h3', '', t('settings.account'));
  const me = account.me;
  const who = el('p', 'sh-muted', me ? t('settings.signedInAs', { name: me.username }) : t('settings.notSignedIn'));
  const act = el('button', 'sh-btn ghost', me ? t('nav.logout') : t('nav.login'));
  act.type = 'button';
  act.addEventListener('click', async () => {
    if (account.me) { await account.logout(); opts.onLogout(); }
    else if (await authDialog('login')) opts.onLogin?.();
  });
  box.append(h1, seg, el('p', 'sh-muted', t('settings.langNote')), h2, who, act);
  return box;
}

// ---------- signing up, logging in, a new password ----------

type Mode = 'login' | 'signup' | 'forgot';

/** the sign-in dialog: resolves with the player once signed in, or null if closed */
export function authDialog(start: Mode = 'login'): Promise<Me | null> {
  return new Promise((resolve) => {
    const ov = el('div', 'sh-overlay on');
    const card = el('div', 'sh-card sh-auth');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    ov.append(card);
    document.body.append(ov);
    const finish = (m: Me | null) => { ov.remove(); removeEventListener('keydown', esc, true); resolve(m); };
    const esc = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.stopImmediatePropagation(); finish(null); } };
    addEventListener('keydown', esc, true);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) finish(null); });

    const field = (label: string, type: string, auto: string, hint?: string) => {
      const l = el('label', 'sh-field');
      const i = el('input');
      i.type = type;
      i.autocomplete = auto as AutoFill;
      i.required = true;
      l.append(el('span', '', label), i);
      if (hint) l.append(el('small', '', hint));
      return { l, i };
    };
    const show = (mode: Mode) => {
      card.replaceChildren();
      const head = el('div', 'sh-card-head');
      const x = el('button', 'sh-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', t('nav.close'));
      x.addEventListener('click', () => finish(null));
      head.append(el('h2', '', mode === 'login' ? t('auth.login') : mode === 'signup' ? t('auth.signup') : t('auth.reset')), x);
      const form = el('form');
      form.noValidate = true;
      const err = el('p', 'sh-err');
      err.setAttribute('role', 'alert');
      const note = el('p', 'sh-ok');
      note.setAttribute('role', 'status');
      const go = el('button', 'sh-btn');
      go.type = 'submit';
      const links = el('div', 'sh-links');
      const link = (txt: string, to: Mode) => {
        const a = el('button', 'sh-link', txt);
        a.type = 'button';
        a.addEventListener('click', () => show(to));
        links.append(a);
      };
      const busy = async (f: () => Promise<void>) => {
        err.textContent = '';
        const label = go.textContent;
        go.disabled = true;
        go.textContent = t('auth.wait');
        try { await f(); } catch (e) { err.textContent = errText(e); }
        finally { go.disabled = false; if (go.textContent === t('auth.wait')) go.textContent = label; }   // unless f() relabelled it
      };

      if (mode === 'login') {
        const id = field(t('auth.loginId'), 'text', 'username'), pw = field(t('auth.password'), 'password', 'current-password');
        go.textContent = t('auth.go');
        form.append(id.l, pw.l, err, go);
        link(t('auth.forgot'), 'forgot');
        link(t('auth.notMember'), 'signup');
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!id.i.value.trim() || !pw.i.value) { err.textContent = t('err.login_wrong'); return; }
          void busy(async () => finish(await account.login(id.i.value.trim(), pw.i.value)));
        });
        card.append(head, form, links);
        id.i.focus();
        return;
      }

      if (mode === 'signup') {
        const un = field(t('auth.username'), 'text', 'username', t('auth.usernameHint'));
        const em = field(t('auth.email'), 'email', 'email');
        const pw = field(t('auth.password'), 'password', 'new-password', t('auth.passwordHint'));
        const pw2 = field(t('auth.confirm'), 'password', 'new-password');
        const code = field(t('auth.code'), 'text', 'one-time-code');
        code.i.inputMode = 'numeric';
        code.i.maxLength = 6;
        code.l.hidden = true;
        const resend = el('button', 'sh-link', t('auth.resend'));
        resend.type = 'button';
        const change = el('button', 'sh-link', t('auth.changeDetails'));
        change.type = 'button';
        const step2 = el('div', 'sh-links');
        step2.append(resend, change);
        step2.hidden = true;
        let sent = false;
        const lock = (on: boolean) => { for (const f of [un, em, pw, pw2]) f.i.readOnly = on; };
        go.textContent = t('auth.sendCode');
        const check = (): string => {
          if (!/^[A-Za-z0-9_.]{3,20}$/.test(un.i.value.trim())) return t('err.username_bad');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.i.value.trim())) return t('err.email_bad');
          if (pw.i.value.length < 8) return t('err.password_short');
          if (pw.i.value !== pw2.i.value) return t('err.mismatch');
          return '';
        };
        const sendCode = () => busy(async () => {
          await account.signupCode(un.i.value.trim(), em.i.value.trim());
          sent = true;
          lock(true);
          code.l.hidden = false;
          step2.hidden = false;
          note.textContent = t('auth.codeSent', { email: em.i.value.trim() });
          go.textContent = t('auth.create');
          code.i.focus();
        });
        resend.addEventListener('click', () => void sendCode());
        change.addEventListener('click', () => {
          sent = false; lock(false); code.l.hidden = true; step2.hidden = true; note.textContent = ''; go.textContent = t('auth.sendCode'); un.i.focus();
        });
        form.append(un.l, em.l, pw.l, pw2.l, note, code.l, step2, err, go);
        link(t('auth.member'), 'login');
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const bad = check();
          if (bad) { err.textContent = bad; return; }
          if (!sent) { void sendCode(); return; }
          if (!/^\d{6}$/.test(code.i.value.trim())) { err.textContent = t('err.code_wrong'); return; }
          void busy(async () => finish(await account.signup(un.i.value.trim(), em.i.value.trim(), pw.i.value, code.i.value.trim())));
        });
        card.append(head, form, links);
        un.i.focus();
        return;
      }

      // forgot: the username or email, then the code and a new password
      const id = field(t('auth.loginId'), 'text', 'username');
      const code = field(t('auth.code'), 'text', 'one-time-code');
      code.i.inputMode = 'numeric';
      code.i.maxLength = 6;
      const pw = field(t('auth.newPassword'), 'password', 'new-password', t('auth.passwordHint'));
      const pw2 = field(t('auth.confirm'), 'password', 'new-password');
      for (const f of [code, pw, pw2]) f.l.hidden = true;
      let sent = false;
      go.textContent = t('auth.sendCode');
      form.append(id.l, note, code.l, pw.l, pw2.l, err, go);
      link(t('auth.backToLogin'), 'login');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!id.i.value.trim()) { err.textContent = t('err.login_wrong'); return; }
        if (!sent) {
          void busy(async () => {
            await account.forgotCode(id.i.value.trim());
            sent = true;
            id.i.readOnly = true;
            for (const f of [code, pw, pw2]) f.l.hidden = false;
            note.textContent = t('auth.forgotSent');
            go.textContent = t('auth.setPassword');
            code.i.focus();
          });
          return;
        }
        if (!/^\d{6}$/.test(code.i.value.trim())) { err.textContent = t('err.code_wrong'); return; }
        if (pw.i.value.length < 8) { err.textContent = t('err.password_short'); return; }
        if (pw.i.value !== pw2.i.value) { err.textContent = t('err.mismatch'); return; }
        void busy(async () => finish(await account.reset(id.i.value.trim(), code.i.value.trim(), pw.i.value)));
      });
      card.append(head, form, links);
      id.i.focus();
    };
    show(start);
  });
}

// ---------- the name at the top left, with ⓘ ----------

/** "👤 username ⓘ": the signed-in player (or "User"); ⓘ shows the details of the stage being played */
export class UserChip {
  readonly root = el('div', 'sh-chip');
  private name = el('span', 'sh-chip-name');
  private info = el('button', 'sh-chip-i', 'i');
  private pop = el('div', 'sh-pop');
  private stage: Stage | null = null;
  private live: { played: () => number; done: () => boolean } | null = null;
  private tick = 0;

  constructor(cls = '') {
    if (cls) this.root.classList.add(cls);
    const av = el('span', 'sh-chip-av');
    av.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6z"/></svg>';
    this.info.type = 'button';
    this.info.hidden = true;
    this.info.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.pop.hidden = true;
    this.root.append(av, this.name, this.info, this.pop);
    addEventListener('pointerdown', (e) => { if (!this.pop.hidden && !this.root.contains(e.target as Node)) this.toggle(false); });
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && !this.pop.hidden) this.toggle(false); });
    this.draw();
    onLang(() => this.draw());
    account.onChange(() => this.draw());
  }

  setStage(s: Stage, live: { played: () => number; done: () => boolean }): void {
    this.stage = s;
    this.live = live;
    this.draw();
  }

  private draw(): void {
    this.name.textContent = account.me?.username ?? t('user.guest');
    this.info.hidden = !this.stage;
    this.info.setAttribute('aria-label', t('user.info'));
    this.info.title = t('user.info');
    if (!this.pop.hidden) this.fill();
  }

  private toggle(on = this.pop.hidden): void {
    this.pop.hidden = !on;
    this.info.setAttribute('aria-expanded', String(on));
    clearInterval(this.tick);
    if (on) { this.fill(); this.tick = window.setInterval(() => this.fill(), 1000); document.exitPointerLock?.(); }
  }

  private fill(): void {
    const s = this.stage;
    if (!s) return;
    const played = this.live?.played() ?? 0, done = this.live?.done() ?? false;
    const m = Math.floor(played / 60), sec = Math.floor(played % 60);
    this.pop.replaceChildren(
      el('div', 'sh-pop-k', t('stage.n', { n: s.n })),
      el('h3', '', tk(`stage.${s.n}.title`)),
      el('p', '', tk(`stage.${s.n}.desc`)),
      rows([
        [t('stage.goal'), tk(`stage.${s.n}.goal`)],
        [t('stage.status'), done ? `✓ ${t('stage.done')}` : t('stage.inProgress')],
        [t('stage.time'), `${fmtNum(m)}:${String(sec).padStart(2, '0')}`],
      ]),
    );
  }
}

function rows(list: [string, string][]): HTMLElement {
  const dl = el('dl', 'sh-rows');
  for (const [k, v] of list) dl.append(el('dt', '', k), el('dd', '', v));
  return dl;
}

// ---------- the home screen ----------

/** the screen before a stage: the player, the stages, settings. No world is loaded behind it. */
export function showHome(): void {
  document.getElementById('status')?.remove();
  const root = el('div', 'sh-home');
  document.body.append(root);
  const chip = new UserChip('home');
  const q = new URLSearchParams(location.search), msg = q.get('msg');
  let note = msg?.startsWith('stage.') || msg?.startsWith('err.') ? tk(msg, { n: q.get('n') ?? '' }) : '';
  if (msg) history.replaceState(null, '', location.pathname);
  const draw = () => {
    root.replaceChildren();
    const top = el('header', 'sh-top');
    const right = el('div', 'sh-top-r');
    const set = el('button', 'sh-btn ghost', `⚙ ${t('nav.settings')}`);
    set.type = 'button';
    set.addEventListener('click', () => panel(t('nav.settings'), (close) => settingsView({ onLogout: () => { close(); draw(); }, onLogin: () => { close(); draw(); } })));
    right.append(set);
    if (!account.me) {
      const li = el('button', 'sh-btn ghost', t('nav.login'));
      li.type = 'button';
      li.addEventListener('click', async () => { if (await authDialog('login')) draw(); });
      const su = el('button', 'sh-btn', t('nav.signup'));
      su.type = 'button';
      su.addEventListener('click', async () => { if (await authDialog('signup')) draw(); });
      right.append(li, su);
    }
    top.append(chip.root, right);
    const hero = el('div', 'sh-hero');
    hero.append(el('h1', '', t('app.title')), el('p', '', t('app.tagline')));
    const sec = el('section', 'sh-card sh-home-stages');
    const banner = el('p', 'sh-note', note);
    banner.setAttribute('role', 'status');
    banner.hidden = !note;
    sec.append(el('h2', '', t('nav.stages')), el('p', 'sh-muted', account.me ? t('stage.pick') : t('stage.loginFirst')), banner,
      stagesView({ onMsg: (m) => { note = m; banner.textContent = m; banner.hidden = false; } }));
    root.append(top, hero, sec);
  };
  draw();
  onLang(draw);
  account.onChange(draw);
}

/** a dialog with a title and one view (closes on ×, Esc or a click outside) */
export function panel(title: string, view: (close: () => void) => HTMLElement): void {
  const ov = el('div', 'sh-overlay on');
  const card = el('div', 'sh-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const close = () => { ov.remove(); removeEventListener('keydown', esc, true); };
  const esc = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.stopImmediatePropagation(); close(); } };
  const draw = () => {
    const head = el('div', 'sh-card-head');
    const x = el('button', 'sh-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', t('nav.close'));
    x.addEventListener('click', close);
    head.append(el('h2', '', title), x);
    card.replaceChildren(head, view(close));
  };
  draw();
  onLang(() => { if (ov.isConnected) draw(); });
  addEventListener('keydown', esc, true);
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  ov.append(card);
  document.body.append(ov);
}

// ---------- the loading page ----------

const MIN_S = 5;

/** The loading page for a stage: shown for at least 5 s, and until `ready()` is true. An ad in the middle when on. */
export async function loadingScreen(s: Stage, place: string, ready: () => boolean): Promise<void> {
  const root = el('div', 'sh-loading');
  const title = el('div', 'sh-load-head');
  title.append(el('div', 'sh-load-k', t('stage.n', { n: s.n })), el('h1', '', tk(`stage.${s.n}.title`)), el('p', '', tk(`stage.${s.n}.goal`)));
  const ad = el('div', 'sh-ad');
  ad.hidden = true;
  const bar = el('div', 'sh-load-bar');
  const fill = el('div');
  bar.append(fill);
  const line = el('p', 'sh-load-line', t('load.loading', { place }));
  root.append(title, ad, bar, line);
  document.body.append(root);
  const st = document.getElementById('status');
  if (st) st.style.visibility = 'hidden';

  void account.config().then((c) => {
    if (c.ads.enabled) {
      ad.hidden = false;
      ad.append(el('span', 'sh-ad-k', t('load.ad')));
      const ins = el('ins', 'adsbygoogle');
      ins.style.display = 'block';
      ins.dataset.adClient = c.ads.client;
      ins.dataset.adSlot = c.ads.slot;
      ins.dataset.adFormat = 'auto';
      ins.dataset.fullWidthResponsive = 'true';
      ad.append(ins);
      const sc = el('script');
      sc.async = true;
      sc.crossOrigin = 'anonymous';
      sc.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(c.ads.client)}`;
      document.head.append(sc);
      const w = window as unknown as { adsbygoogle: unknown[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } else if (import.meta.env.DEV && (c.ads as { switchedOn?: boolean }).switchedOn) {
      ad.hidden = false;                                  // development: ads on, but no AdSense ids yet
      ad.append(el('span', 'sh-ad-k', t('load.ad')), el('div', 'sh-ad-dev', 'AdSense 300 × 250 (set ADSENSE_CLIENT and ADSENSE_SLOT)'));
    }
  });

  const t0 = performance.now();
  await new Promise<void>((done) => {
    const step = () => {
      const s = (performance.now() - t0) / 1000;
      fill.style.width = `${Math.min(100, (s / MIN_S) * 100)}%`;
      if (s >= MIN_S) line.textContent = ready() ? t('load.ready') : t('load.loading', { place });
      if (s >= MIN_S && ready()) return done();
      requestAnimationFrame(step);
    };
    step();
  });
  root.classList.add('out');
  setTimeout(() => root.remove(), 400);
}

export function loadingFailed(e: unknown): void {
  const line = document.querySelector('.sh-load-line');
  if (line) line.textContent = t('load.failed', { e: String(e) });
}

// ---------- a short message over the game ----------

export function toast(msg: string, s = 5): void {
  const d = el('div', 'sh-toast', msg);
  d.setAttribute('role', 'status');
  document.body.append(d);
  requestAnimationFrame(() => d.classList.add('on'));
  setTimeout(() => { d.classList.remove('on'); setTimeout(() => d.remove(), 400); }, s * 1000);
}

// ---------- styles ----------

const css = `
.sh-home { position: fixed; inset: 0; z-index: 40; overflow: auto; color: #f3eee6; font-family: system-ui, sans-serif;
  background: radial-gradient(ellipse at 50% 120%, #7a3a12 0%, #2a1610 45%, #120c0a 100%); }
.sh-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px; }
.sh-top-r { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.sh-hero { text-align: center; padding: 4vh 16px 2vh; }
.sh-hero h1 { margin: 0; font-size: clamp(44px, 9vw, 84px); letter-spacing: 1px; color: #f2a65a; text-shadow: 0 4px 24px rgba(242,153,42,.35); }
.sh-hero p { margin: 6px 0 0; color: #d8c9b4; font-size: 16px; }
.sh-home-stages { width: min(880px, calc(100% - 32px)); margin: 3vh auto 48px; }
.sh-card { background: #f7f3ec; color: #2a241e; border-radius: 14px; padding: 20px; box-shadow: 0 16px 48px rgba(0,0,0,.4); box-sizing: border-box; }
.sh-card h2 { margin: 0 0 4px; font-size: 19px; }
.sh-card h3 { margin: 14px 0 8px; font-size: 15px; }
.sh-card h3:first-child { margin-top: 0; }
.sh-muted { margin: 0 0 12px; color: #6f6357; font-size: 14px; }
.sh-note { margin: 0 0 12px; padding: 9px 12px; border-radius: 8px; background: #fff1dc; color: #7a3a05; font-size: 14px; }
.sh-stages { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.sh-stage { position: relative; display: grid; gap: 2px; align-content: start; min-height: 118px; padding: 14px 12px 12px; text-align: left;
  border: 1px solid #e0d7c8; border-radius: 12px; background: #fff; color: #2b2520; font: inherit; cursor: pointer; }
.sh-stage:hover:not(:disabled) { border-color: #f2992a; background: #fff6e8; }
.sh-stage:focus-visible, .sh-btn:focus-visible, .sh-link:focus-visible, .sh-x:focus-visible, .sh-seg button:focus-visible, .sh-chip-i:focus-visible
  { outline: 2px solid #d9621a; outline-offset: 2px; }
.sh-stage-n { font-size: 30px; font-weight: 800; line-height: 1; color: #d9621a; }
.sh-stage-l { font-size: 12px; color: #7a6e62; margin-top: 4px; }
.sh-stage-t { font-weight: 650; font-size: 15px; }
.sh-stage-s { margin-top: auto; padding-top: 8px; font-size: 12px; font-weight: 600; color: #2e7d32; }
.sh-stage.locked { background: #efe9df; color: #8a7e70; cursor: default; }
.sh-stage.locked .sh-stage-n { color: #b3a898; }
.sh-stage.locked .sh-stage-s { color: #8a7e70; }
.sh-stage.here { border-color: #f2992a; background: #fff6e8; cursor: default; }
.sh-stage.here .sh-stage-s { color: #b5480a; }
.sh-btn { padding: 9px 16px; border: 0; border-radius: 9px; background: #d9621a; color: #fff; font: 600 14px system-ui, sans-serif; cursor: pointer; }
.sh-btn:hover { background: #c0561a; }
.sh-btn:disabled { opacity: .6; cursor: default; }
.sh-btn.ghost { background: rgba(255,255,255,.1); color: inherit; border: 1px solid rgba(255,255,255,.28); }
.sh-btn.ghost:hover { background: rgba(255,255,255,.18); }
.sh-card .sh-btn.ghost { background: #fff; color: #2a241e; border-color: #d8cfc1; }
.sh-card .sh-btn.ghost:hover { background: #f0e9dd; }
.sh-overlay { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(20,16,12,.55); overflow: auto; }
.sh-overlay > .sh-card { width: min(460px, 100%); max-height: calc(100vh - 32px); overflow: auto; }
.sh-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sh-card-head h2 { margin: 0; }
.sh-x { width: 34px; height: 34px; border: 0; border-radius: 8px; background: none; font-size: 24px; color: #6f6357; cursor: pointer; }
.sh-x:hover { background: #ece4d6; }
.sh-auth form { display: grid; gap: 12px; }
.sh-field { display: grid; gap: 4px; font-size: 13px; color: #5d5248; }
.sh-field input { padding: 10px 12px; border: 1px solid #cfc5b4; border-radius: 8px; font: 15px system-ui, sans-serif; background: #fff; color: #2a241e; }
.sh-field input:read-only { background: #f0e9dd; color: #6f6357; }
.sh-field input:focus { outline: 2px solid #f2992a; outline-offset: 0; border-color: transparent; }
.sh-field small { color: #8a7e70; font-size: 12px; }
.sh-err { margin: 0; min-height: 1.2em; color: #b3261e; font-size: 14px; }
.sh-err:empty { display: none; }
.sh-ok { margin: 0; color: #2e6b30; font-size: 14px; }
.sh-ok:empty { display: none; }
.sh-links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 14px; margin-top: 14px; }
form .sh-links { margin-top: 0; }
.sh-link { border: 0; padding: 0; background: none; color: #b5480a; font: 14px system-ui, sans-serif; text-decoration: underline; cursor: pointer; }
.sh-seg { display: inline-flex; padding: 3px; border-radius: 10px; background: #e8e0d2; gap: 3px; }
.sh-seg button { padding: 8px 18px; border: 0; border-radius: 8px; background: none; font: 600 14px system-ui, sans-serif; color: #5d5248; cursor: pointer; }
.sh-seg button[aria-checked="true"] { background: #fff; color: #2a241e; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.sh-settings .sh-muted { margin-top: 8px; }
.sh-chip { position: fixed; left: 68px; top: 16px; z-index: 19; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 6px 0 8px;
  box-sizing: border-box; border-radius: 10px; background: rgba(0,0,0,.45); color: #fff; font: 600 14px system-ui, sans-serif;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.sh-chip.home { position: relative; left: 0; top: 0; background: rgba(255,255,255,.1); }
.sh-chip-av { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: #f2992a; color: #2a1a08; }
.sh-chip-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sh-chip-i { width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.75); background: none; color: #fff;
  font: italic 700 13px Georgia, serif; cursor: pointer; padding: 0; }
.sh-chip-i:hover, .sh-chip-i[aria-expanded="true"] { background: rgba(255,255,255,.2); }
.sh-pop { position: absolute; left: 0; top: 52px; width: min(320px, calc(100vw - 84px)); padding: 14px 16px; border-radius: 12px;
  background: #f7f3ec; color: #2a241e; font-weight: 400; box-shadow: 0 10px 32px rgba(0,0,0,.4); }
.sh-pop h3 { margin: 2px 0 6px; font-size: 17px; }
.sh-pop p { margin: 0 0 10px; font-size: 13px; line-height: 1.45; color: #4d443b; }
.sh-pop-k { font-size: 12px; font-weight: 700; color: #d9621a; text-transform: uppercase; letter-spacing: .5px; }
.sh-rows { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
.sh-rows dt { color: #7a6e62; }
.sh-rows dd { margin: 0; font-weight: 600; }
.sh-loading { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
  padding: 24px 16px; box-sizing: border-box; color: #f3eee6; font-family: system-ui, sans-serif; transition: opacity .4s;
  background: radial-gradient(ellipse at 50% 120%, #7a3a12 0%, #2a1610 45%, #120c0a 100%); }
.sh-loading.out { opacity: 0; pointer-events: none; }
.sh-load-head { text-align: center; }
.sh-load-head h1 { margin: 4px 0; font-size: clamp(30px, 6vw, 48px); color: #f2a65a; }
.sh-load-head p { margin: 0; color: #d8c9b4; }
.sh-load-k { font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #d8c9b4; }
.sh-ad { position: relative; width: min(336px, 100%); min-height: 250px; padding-top: 18px; box-sizing: border-box; }
.sh-ad-k { position: absolute; top: 0; left: 0; font-size: 11px; color: #a8998a; }
.sh-ad-dev { display: grid; place-items: center; height: 250px; border: 1px dashed #8a7e70; border-radius: 6px; color: #a8998a; font-size: 13px; text-align: center; padding: 12px; box-sizing: border-box; }
.sh-load-bar { width: min(320px, 80%); height: 6px; border-radius: 3px; background: rgba(255,255,255,.15); overflow: hidden; }
.sh-load-bar div { height: 100%; width: 0; background: #f2992a; border-radius: 3px; }
.sh-load-line { margin: 0; font-size: 14px; color: #d8c9b4; }
.sh-toast { position: fixed; left: 50%; top: 18%; z-index: 45; transform: translate(-50%, -8px); max-width: calc(100% - 32px); padding: 12px 18px;
  border-radius: 12px; background: rgba(28,24,20,.9); color: #fff; font: 600 16px system-ui, sans-serif; text-align: center; opacity: 0;
  transition: opacity .35s, transform .35s; pointer-events: none; }
.sh-toast.on { opacity: 1; transform: translate(-50%, 0); }
[hidden] { display: none !important; }
@media (max-width: 520px) { .sh-chip-name { max-width: 90px; } .sh-top { padding: 12px; } }
`;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
