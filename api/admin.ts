import { createHash, timingSafeEqual } from 'node:crypto';
import { db, getSetting, schema, setSetting } from './_lib/db.js';
import { HttpError, Req, body, cookie, handle, method, send, setCookie, sign, str, verify } from './_lib/http.js';
import { STAGES, User } from './_lib/users.js';

/*
 The admin's API. The admin signs in with ADMIN_USER / ADMIN_PASSWORD from the environment (not a player account).
 GET  /api/admin                         { admin: true | false }
 POST /api/admin { action, ... }
   login   { user, password }
   logout
   search  { q }                         players whose username or email contains q (the newest first if q is empty)
   user    { username }                  one player: details, unlocked stages, how they played each stage
   unlock  { username, stages: [n...] }  the stages this player has open (stage 1 always)
   ads     { enabled }                   ads on the loading page for everyone
   config                                { ads: { enabled, adsense } }
*/

const COOKIE = 'ra', HOURS = 12;
const h = (s: string) => createHash('sha256').update(s).digest();

function isAdmin(req: Req): boolean {
  return !!verify<{ a: number }>(cookie(req, COOKIE))?.a;
}

export default handle(async (req, res) => {
  method(req, 'GET', 'POST');
  if (req.method === 'GET') return send(res, 200, { admin: isAdmin(req) });
  const b = await body(req);
  const action = str(b.action, 20);

  if (action === 'login') {
    const U = process.env.ADMIN_USER, P = process.env.ADMIN_PASSWORD;
    if (!U || !P) throw new HttpError(503, 'admin_unset');
    const ok = timingSafeEqual(h(`${str(b.user, 200)}\n${typeof b.password === 'string' ? b.password : ''}`), h(`${U}\n${P}`));
    if (!ok) { await new Promise((r) => setTimeout(r, 600)); throw new HttpError(401, 'login_wrong'); }
    setCookie(res, COOKIE, sign({ a: 1, e: Date.now() + HOURS * 36e5 }), HOURS * 3600);
    return send(res, 200, { ok: true });
  }
  if (action === 'logout') {
    setCookie(res, COOKIE, '', 0);
    return send(res, 200, { ok: true });
  }
  if (!isAdmin(req)) throw new HttpError(401, 'admin');
  await schema();
  const s = db();

  if (action === 'search') {
    const q = str(b.q, 100).toLowerCase();
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const rows = await s`
      SELECT u.username, u.email, u.unlocked, u.created_at, u.last_login,
             COALESCE(sum(r.played_s), 0)::float AS played_s, count(r.id)::int AS plays
      FROM users u LEFT JOIN runs r ON r.user_id = u.id
      WHERE ${q === ''} OR lower(u.username) LIKE ${like} OR lower(u.email) LIKE ${like}
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT 50`;
    return send(res, 200, { users: rows });
  }

  if (action === 'user') {
    const [u] = await s<User[]>`SELECT * FROM users WHERE lower(username) = ${str(b.username, 40).toLowerCase()}`;
    if (!u) throw new HttpError(404, 'user');
    const stages = await s`
      SELECT stage, count(*)::int AS plays, sum(played_s)::float AS played_s, max(last_seen) AS last_played,
             min(completed_at) AS first_completed, count(completed_at)::int AS completions,
             min(played_s) FILTER (WHERE completed_at IS NOT NULL)::float AS best_s
      FROM runs WHERE user_id = ${u.id} GROUP BY stage ORDER BY stage`;
    const runs = await s`SELECT stage, started_at, played_s::float, completed_at, stats FROM runs
                         WHERE user_id = ${u.id} ORDER BY started_at DESC LIMIT 20`;
    return send(res, 200, {
      user: { username: u.username, email: u.email, lang: u.lang, unlocked: u.unlocked, created_at: u.created_at, last_login: u.last_login },
      stages, runs, count: STAGES,
    });
  }

  if (action === 'unlock') {
    const want = Array.isArray(b.stages) ? b.stages : [];
    const set = new Set<number>([1]);
    for (const n of want) if (Number.isInteger(n) && n >= 1 && n <= STAGES) set.add(n as number);
    const list = [...set].sort((x, y) => x - y);
    const r = await s`UPDATE users SET unlocked = ${list} WHERE lower(username) = ${str(b.username, 40).toLowerCase()} RETURNING unlocked`;
    if (!r.length) throw new HttpError(404, 'user');
    return send(res, 200, { unlocked: r[0].unlocked });
  }

  if (action === 'ads') {
    await setSetting('ads_enabled', b.enabled === true);
    return send(res, 200, { enabled: b.enabled === true });
  }

  if (action === 'config') {
    return send(res, 200, {
      ads: { enabled: await getSetting('ads_enabled', false), adsense: !!process.env.ADSENSE_CLIENT && !!process.env.ADSENSE_SLOT },
      mail: process.env.EMAIL_TEST_CODE ? 'test' : process.env.BREVO_API_KEY ? 'brevo' : 'unset',
    });
  }

  throw new HttpError(400, 'action');
});
