import postgres from 'postgres';

/*
 The database: Postgres (Neon on Vercel, or a local one for development, see scripts/devdb.sh).
 The connection string comes from DATABASE_URL (Vercel's Neon integration sets it; POSTGRES_URL also works).
 The tables are made on first use, so a fresh database needs nothing run by hand.
*/

let sql: postgres.Sql | null = null;
let ready: Promise<void> | null = null;

export function db(): postgres.Sql {
  if (sql) return sql;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  let host = '';
  try { host = new URL(url).hostname; } catch { /* a key=value string */ }
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(host) || url.includes('host=/');
  sql = postgres(url, {
    max: process.env.VERCEL ? 1 : 5,   // one connection per serverless instance
    prepare: false,                    // works through Neon's pooler (pgbouncer)
    ssl: local ? false : 'require',
    idle_timeout: 20,
    onnotice: () => {},
  });
  return sql;
}

/** the tables, made once per instance (CREATE ... IF NOT EXISTS) */
export function schema(): Promise<void> {
  if (ready) return ready;
  const s = db();
  ready = (async () => {
    await s`CREATE TABLE IF NOT EXISTS users (
      id          serial PRIMARY KEY,
      username    text NOT NULL,
      email       text NOT NULL,
      pass_hash   text NOT NULL,
      pass_ver    int  NOT NULL DEFAULT 1,
      lang        text NOT NULL DEFAULT 'en',
      unlocked    int[] NOT NULL DEFAULT '{1}',
      created_at  timestamptz NOT NULL DEFAULT now(),
      last_login  timestamptz
    )`;
    await s`CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (lower(username))`;
    await s`CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email))`;
    await s`CREATE TABLE IF NOT EXISTS email_codes (
      email       text NOT NULL,
      purpose     text NOT NULL,
      code_hash   text NOT NULL,
      expires_at  timestamptz NOT NULL,
      tries       int NOT NULL DEFAULT 0,
      sent_at     timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (email, purpose)
    )`;
    await s`CREATE TABLE IF NOT EXISTS runs (
      id           serial PRIMARY KEY,
      user_id      int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage        int NOT NULL,
      started_at   timestamptz NOT NULL DEFAULT now(),
      last_seen    timestamptz NOT NULL DEFAULT now(),
      played_s     real NOT NULL DEFAULT 0,
      completed_at timestamptz,
      stats        jsonb NOT NULL DEFAULT '{}'
    )`;
    await s`CREATE INDEX IF NOT EXISTS runs_user ON runs (user_id, stage)`;
    await s`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL)`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db()`SELECT value FROM settings WHERE key = ${key}`;
  return r.length ? (r[0].value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const s = db();
  await s`INSERT INTO settings (key, value) VALUES (${key}, ${s.json(value as never)})
          ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
}
