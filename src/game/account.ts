import { lang, setLang, type Lang } from '../i18n';

/*
 The player's account, through the game's API (api/*.ts: Vercel functions, or the Vite dev server in development).
 The session is an http-only cookie, so nothing about it is kept in the page.
*/

export interface Me { username: string; email: string; lang: Lang; unlocked: number[] }
/** a play of a stage, as the server keeps it (api/me.ts runs) */
export interface Run { id: number; stage: number; started_at: string; played_s: number; completed_at: string | null; stats: Record<string, number> }
export interface Config { ads: { enabled: boolean; client: string; slot: string } }

export class ApiError extends Error {
  constructor(public code: string) { super(code); }
}

async function call<T>(path: string, data?: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`api/${path}`, data
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin' }
      : { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError('network');
  }
  const j = await r.json().catch(() => ({ error: r.ok ? 'server' : r.status === 404 ? 'network' : 'server' }));
  if (!r.ok || j.error) throw new ApiError(j.error ?? 'server');
  return j as T;
}

let me: Me | null = null;
const listeners: ((m: Me | null) => void)[] = [];

export const account = {
  get me(): Me | null { return me; },

  /** who is signed in (null: nobody, or the server can't be reached) */
  async load(): Promise<Me | null> {
    try { me = (await call<{ user: Me | null }>('me')).user; } catch { me = null; }
    if (me) setLang(me.lang);
    return me;
  },

  onChange(f: (m: Me | null) => void): void { listeners.push(f); },

  async login(login: string, password: string): Promise<Me> {
    return set((await call<{ user: Me }>('auth', { action: 'login', login, password })).user);
  },
  async signupCode(username: string, email: string): Promise<void> {
    await call('auth', { action: 'signup-code', username, email, lang });
  },
  async signup(username: string, email: string, password: string, code: string): Promise<Me> {
    return set((await call<{ user: Me }>('auth', { action: 'signup', username, email, password, code, lang })).user);
  },
  async forgotCode(login: string): Promise<void> {
    await call('auth', { action: 'forgot-code', login, lang });
  },
  async reset(login: string, code: string, password: string): Promise<Me> {
    return set((await call<{ user: Me }>('auth', { action: 'reset', login, code, password })).user);
  },
  async logout(): Promise<void> {
    await call('auth', { action: 'logout' }).catch(() => {});
    me = null;
    for (const f of listeners) f(me);
  },
  /** the language, kept with the account too */
  saveLang(l: Lang): void {
    if (me) { me.lang = l; void call('me', { action: 'lang', lang: l }).catch(() => {}); }
  },

  async config(): Promise<Config> {
    try { return await call<Config>('config'); } catch { return { ads: { enabled: false, client: '', slot: '' } }; }
  },

  // ---- plays of a stage ----
  async runStart(stage: number): Promise<number> {
    return (await call<{ run: number }>('me', { action: 'run-start', stage })).run;
  },
  runBeat(run: number, played: number, stats: object, done = false): void {
    void call('me', { action: done ? 'run-done' : 'run-beat', run, played, stats }).catch(() => {});
  },
  /** the player's plays, newest first, with their scorecards (none if not signed in or offline) */
  async runs(): Promise<Run[]> {
    if (!me) return [];
    try { return (await call<{ runs: Run[] }>('me', { action: 'runs' })).runs; } catch { return []; }
  },
  /** on leaving the page: a last beat that survives the unload */
  runBeacon(run: number, played: number, stats: object): void {
    const b = new Blob([JSON.stringify({ action: 'run-beat', run, played, stats })], { type: 'application/json' });
    navigator.sendBeacon?.('api/me', b);
  },
};

function set(m: Me): Me {
  me = m;
  setLang(m.lang);
  for (const f of listeners) f(me);
  return m;
}
