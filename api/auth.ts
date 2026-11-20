import { db, schema } from './_lib/db.js';
import { HttpError, body, handle, method, send, str } from './_lib/http.js';
import {
  EMAIL, USERNAME, User, checkHash, checkPassword, endSession, findUser, hashPassword, publicUser, sendCode, startSession, useCode,
} from './_lib/users.js';

/*
 POST /api/auth  { action, ... }
   signup-code  { username, email, lang }            checks both are free, mails a code
   signup       { username, email, password, code }  makes the account and signs in
   login        { login (username or email), password }
   logout
   forgot-code  { login, lang }                       mails a reset code to the account's email (says ok either way)
   reset        { login, code, password }             sets the new password and signs in
*/

async function taken(username: string, email: string): Promise<void> {
  const r = await db()`SELECT lower(username) = ${username.toLowerCase()} AS u, lower(email) = ${email.toLowerCase()} AS e
                       FROM users WHERE lower(username) = ${username.toLowerCase()} OR lower(email) = ${email.toLowerCase()}`;
  if (r.some((x) => x.u)) throw new HttpError(409, 'username_taken');
  if (r.some((x) => x.e)) throw new HttpError(409, 'email_taken');
}

function checkSignup(username: string, email: string): void {
  if (!USERNAME.test(username)) throw new HttpError(400, 'username_bad');
  if (!EMAIL.test(email)) throw new HttpError(400, 'email_bad');
}

export default handle(async (req, res) => {
  method(req, 'POST');
  await schema();
  const b = await body(req);
  const action = str(b.action, 20), lang = str(b.lang, 2) === 'hi' ? 'hi' : 'en';

  if (action === 'signup-code') {
    const username = str(b.username, 40), email = str(b.email, 200);
    checkSignup(username, email);
    await taken(username, email);
    await sendCode(email, 'signup', lang);
    return send(res, 200, { ok: true });
  }

  if (action === 'signup') {
    const username = str(b.username, 40), email = str(b.email, 200), password = typeof b.password === 'string' ? b.password : '';
    checkSignup(username, email);
    checkPassword(password);
    await taken(username, email);
    await useCode(email, 'signup', str(b.code, 10));
    let u: User;
    try {
      [u] = await db()<User[]>`INSERT INTO users (username, email, pass_hash, lang, last_login)
        VALUES (${username}, ${email}, ${await hashPassword(password)}, ${lang}, now()) RETURNING *`;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'username_taken');   // taken in the meantime
      throw e;
    }
    startSession(res, u);
    return send(res, 200, { user: publicUser(u) });
  }

  if (action === 'login') {
    const login = str(b.login, 200), password = typeof b.password === 'string' ? b.password : '';
    const u = login ? await findUser(login) : null;
    if (!u || !(await checkHash(password, u.pass_hash))) throw new HttpError(401, 'login_wrong');
    await db()`UPDATE users SET last_login = now() WHERE id = ${u.id}`;
    startSession(res, u);
    return send(res, 200, { user: publicUser(u) });
  }

  if (action === 'logout') {
    endSession(res);
    return send(res, 200, { ok: true });
  }

  if (action === 'forgot-code') {
    const u = await findUser(str(b.login, 200));
    if (u) {
      try { await sendCode(u.email, 'reset', lang); }
      catch (e) { if (!(e instanceof HttpError && e.code === 'code_wait')) throw e; }
    }
    return send(res, 200, { ok: true });       // the same answer whether or not the account exists
  }

  if (action === 'reset') {
    const password = typeof b.password === 'string' ? b.password : '';
    checkPassword(password);
    const u = await findUser(str(b.login, 200));
    if (!u) throw new HttpError(400, 'code_wrong');
    await useCode(u.email, 'reset', str(b.code, 10));
    const [n] = await db()<User[]>`UPDATE users SET pass_hash = ${await hashPassword(password)}, pass_ver = pass_ver + 1, last_login = now()
                                   WHERE id = ${u.id} RETURNING *`;
    startSession(res, n);
    return send(res, 200, { user: publicUser(n) });
  }

  throw new HttpError(400, 'action');
});
