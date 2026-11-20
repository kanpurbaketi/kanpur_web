import { db, schema } from './_lib/db.js';
import { HttpError, body, handle, method, send, str } from './_lib/http.js';
import { STAGES, publicUser, requireUser, sessionUser } from './_lib/users.js';

/*
 GET  /api/me                          { user: { username, email, lang, unlocked } | null }
 POST /api/me { action, ... }          (signed in)
   lang       { lang: 'en' | 'hi' }
   run-start  { stage }                a play of a stage begins (refused if it is locked) -> { run }
   run-beat   { run, played, stats }   how long it has been played, and the play statistics so far
   run-done   { run }                  the stage's goal was reached
*/

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

function cleanStats(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const k of ['walked', 'ran', 'jumps', 'topSpeed', 'explored', 'step']) out[k] = num((v as Record<string, unknown>)[k], 0, 1e7);
  return out;
}

export default handle(async (req, res) => {
  method(req, 'GET', 'POST');
  await schema();
  if (req.method === 'GET') {
    const u = await sessionUser(req);
    return send(res, 200, { user: u ? publicUser(u) : null });
  }
  const u = await requireUser(req);
  const b = await body(req);
  const action = str(b.action, 20);
  const s = db();

  if (action === 'lang') {
    const lang = str(b.lang, 2) === 'hi' ? 'hi' : 'en';
    await s`UPDATE users SET lang = ${lang} WHERE id = ${u.id}`;
    return send(res, 200, { ok: true });
  }

  if (action === 'run-start') {
    const stage = Math.round(num(b.stage, 0, STAGES));
    if (stage < 1 || !u.unlocked.includes(stage)) throw new HttpError(403, 'locked');
    const [r] = await s`INSERT INTO runs (user_id, stage) VALUES (${u.id}, ${stage}) RETURNING id`;
    return send(res, 200, { run: r.id });
  }

  if (action === 'run-beat' || action === 'run-done') {
    const run = Math.round(num(b.run, 0, 2 ** 31 - 1));
    const played = num(b.played, 0, 7 * 86400);
    const stats = cleanStats(b.stats);
    const done = action === 'run-done';
    const r = await s`UPDATE runs SET last_seen = now(),
                        played_s = GREATEST(played_s, ${played}),
                        stats = CASE WHEN ${Object.keys(stats).length > 0} THEN ${s.json(stats)} ELSE stats END,
                        completed_at = CASE WHEN ${done} AND completed_at IS NULL THEN now() ELSE completed_at END
                      WHERE id = ${run} AND user_id = ${u.id} RETURNING id`;
    if (!r.length) throw new HttpError(404, 'run');
    return send(res, 200, { ok: true });
  }

  throw new HttpError(400, 'action');
});
