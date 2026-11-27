import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 Small helpers shared by the API functions. They use plain Node requests and responses, so the same handlers run on
 Vercel (api/*.ts) and in the Vite dev server (vite.config.ts mounts them under /api).
*/

export type Req = IncomingMessage & { body?: unknown };
export type Res = ServerResponse;

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

/** the JSON body (Vercel may have parsed it already) */
export async function body(req: Req): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64_000) throw new HttpError(413, 'too_large');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'bad_json'); }
}

export function send(res: Res, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

/** run a handler: errors become { error: code } with their status */
export function handle(fn: (req: Req, res: Res) => Promise<void>) {
  return async (req: Req, res: Res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code });
      console.error(e);
      send(res, 500, { error: 'server' });
    }
  };
}

export const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---- signed cookies (sessions) -------------------------------------------------------------------------

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.VERCEL) throw new Error('AUTH_SECRET must be set (16+ characters)');
  return 'dev-only-secret-not-for-production';
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function sign(payload: object): string {
  const p = b64(JSON.stringify(payload));
  return `${p}.${createHmac('sha256', secret()).update(p).digest('base64url')}`;
}

export function verify<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const want = createHmac('sha256', secret()).update(p).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as T & { e: number };
    return v.e > Date.now() ? v : null;
  } catch { return null; }
}

export function cookie(req: Req, name: string): string | undefined {
  const h = req.headers.cookie ?? '';
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function setCookie(res: Res, name: string, value: string, maxAgeS: number): void {
  const secure = process.env.VERCEL ? '; Secure' : '';
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  list.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`);
  res.setHeader('Set-Cookie', list);
}

export function method(req: Req, ...allowed: string[]): void {
  if (!allowed.includes(req.method ?? '')) throw new HttpError(405, 'method');
}
