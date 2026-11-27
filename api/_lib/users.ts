import { randomBytes, randomInt, scrypt as scryptCb, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, schema } from './db.js';
import { HttpError, Req, Res, cookie, setCookie, sign, verify } from './http.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const STAGES = 10;                 // stage cards; stage 1 is open to everyone
const SESSION = 'rs', SESSION_DAYS = 30;

export interface User {
  id: number; username: string; email: string; pass_hash: string; pass_ver: number;
  lang: string; unlocked: number[]; created_at: Date; last_login: Date | null;
}

// ---- rules -----------------------------------------------------------------------------------------

export const USERNAME = /^[A-Za-z0-9_.]{3,20}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function checkPassword(pw: string): void {
  if (pw.length < 8) throw new HttpError(400, 'password_short');
  if (pw.length > 200) throw new HttpError(400, 'password_long');
}

// ---- passwords ---------------------------------------------------------------------------------------

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}

export async function checkHash(pw: string, stored: string): Promise<boolean> {
  const [kind, s, h] = stored.split('$');
  if (kind !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return timingSafeEqual(got, want);
}

// ---- users -------------------------------------------------------------------------------------------

export async function findUser(login: string): Promise<User | null> {
  await schema();
  const l = login.toLowerCase();
  const r = await db()<User[]>`SELECT * FROM users WHERE lower(username) = ${l} OR lower(email) = ${l} LIMIT 1`;
  return r[0] ?? null;
}

export async function userById(id: number): Promise<User | null> {
  await schema();
  const r = await db()<User[]>`SELECT * FROM users WHERE id = ${id}`;
  return r[0] ?? null;
}

/** what the game is told about the player */
export function publicUser(u: User) {
  return { username: u.username, email: u.email, lang: u.lang, unlocked: [...u.unlocked].sort((a, b) => a - b) };
}

// ---- sessions ----------------------------------------------------------------------------------------

export function startSession(res: Res, u: User): void {
  setCookie(res, SESSION, sign({ u: u.id, v: u.pass_ver, e: Date.now() + SESSION_DAYS * 864e5 }), SESSION_DAYS * 86400);
}

export function endSession(res: Res): void {
  setCookie(res, SESSION, '', 0);
}

/** the signed-in player, or null (a password change signs out every old session) */
export async function sessionUser(req: Req): Promise<User | null> {
  const s = verify<{ u: number; v: number }>(cookie(req, SESSION));
  if (!s) return null;
  const u = await userById(s.u);
  return u && u.pass_ver === s.v ? u : null;
}

export async function requireUser(req: Req): Promise<User> {
  const u = await sessionUser(req);
  if (!u) throw new HttpError(401, 'login');
  return u;
}

// ---- email codes (Brevo) -----------------------------------------------------------------------------

const CODE_MIN = 10, CODE_TRIES = 5, RESEND_S = 45;
const codeHash = (email: string, code: string) => createHash('sha256').update(`${email.toLowerCase()}:${code}`).digest('hex');

/** a six-digit code for this email and purpose, stored hashed and sent by mail */
export async function sendCode(email: string, purpose: 'signup' | 'reset', lang: string): Promise<void> {
  await schema();
  const s = db(), e = email.toLowerCase();
  const prev = await s`SELECT sent_at FROM email_codes WHERE email = ${e} AND purpose = ${purpose}`;
  if (prev.length && Date.now() - new Date(prev[0].sent_at).getTime() < RESEND_S * 1000) throw new HttpError(429, 'code_wait');
  const test = process.env.EMAIL_TEST_CODE;
  const code = test && /^\d{6}$/.test(test) ? test : String(randomInt(0, 1_000_000)).padStart(6, '0');
  await s`INSERT INTO email_codes (email, purpose, code_hash, expires_at, tries, sent_at)
          VALUES (${e}, ${purpose}, ${codeHash(e, code)}, now() + ${CODE_MIN + ' minutes'}::interval, 0, now())
          ON CONFLICT (email, purpose) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, sent_at = now()`;
  if (test) { console.log(`[mail] test mode: the ${purpose} code for ${e} is ${code}`); return; }
  await mail(email, purpose, code, lang);
}

/** the code is right (and then used up), or an error */
export async function useCode(email: string, purpose: 'signup' | 'reset', code: string): Promise<void> {
  await schema();
  const s = db(), e = email.toLowerCase();
  const r = await s`SELECT code_hash, expires_at, tries FROM email_codes WHERE email = ${e} AND purpose = ${purpose}`;
  if (!r.length || new Date(r[0].expires_at).getTime() < Date.now()) throw new HttpError(400, 'code_expired');
  if (r[0].tries >= CODE_TRIES) throw new HttpError(429, 'code_tries');
  if (r[0].code_hash !== codeHash(e, code.trim())) {
    await s`UPDATE email_codes SET tries = tries + 1 WHERE email = ${e} AND purpose = ${purpose}`;
    throw new HttpError(400, 'code_wrong');
  }
  await s`DELETE FROM email_codes WHERE email = ${e} AND purpose = ${purpose}`;
}

async function mail(to: string, purpose: 'signup' | 'reset', code: string, lang: string): Promise<void> {
  const key = process.env.BREVO_API_KEY, from = process.env.BREVO_SENDER_EMAIL;
  if (!key || !from) throw new Error('BREVO_API_KEY and BREVO_SENDER_EMAIL must be set (or EMAIL_TEST_CODE for testing)');
  const hi = lang === 'hi';
  const subject = purpose === 'signup'
    ? (hi ? 'रामू: आपका ईमेल कोड' : 'Ramu: your email code')
    : (hi ? 'रामू: पासवर्ड बदलने का कोड' : 'Ramu: your password reset code');
  const line = purpose === 'signup'
    ? (hi ? 'अपना ईमेल पक्का करने के लिए यह कोड डालें:' : 'Enter this code to verify your email:')
    : (hi ? 'नया पासवर्ड रखने के लिए यह कोड डालें:' : 'Enter this code to set a new password:');
  const after = hi ? `यह कोड ${CODE_MIN} मिनट तक चलेगा। अगर आपने यह नहीं माँगा, तो इस ईमेल को अनदेखा करें।`
    : `The code works for ${CODE_MIN} minutes. If you didn't ask for it, ignore this email.`;
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: from, name: process.env.BREVO_SENDER_NAME || 'Ramu' },
      to: [{ email: to }],
      subject,
      htmlContent: `<p>${line}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p style="color:#666">${after}</p>`,
      textContent: `${line} ${code}\n\n${after}`,
    }),
  });
  if (!r.ok) {
    console.error('brevo', r.status, await r.text().catch(() => ''));
    throw new HttpError(502, 'mail_failed');
  }
}
