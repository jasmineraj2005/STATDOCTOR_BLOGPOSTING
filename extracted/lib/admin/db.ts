import "server-only";

import { Pool, type QueryResultRow } from "pg";

/** Returns true when a Postgres connection string is set. */
export function isDbConfigured(): boolean {
  return Boolean(connectionString());
}

function connectionString(): string | undefined {
  return (
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    undefined
  );
}

let _pool: Pool | null = null;

/** Lazily-instantiated singleton pool. Reuses sockets across requests. */
export function pool(): Pool {
  if (_pool) return _pool;
  const conn = connectionString();
  if (!conn) {
    throw new Error(
      "Database not configured. Set POSTGRES_URL / DATABASE_URL before calling pool().",
    );
  }
  _pool = new Pool({
    connectionString: conn,
    // Neon / Supabase / Vercel Postgres all require SSL; local Postgres usually doesn't.
    ssl:
      conn.includes("localhost") || conn.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
    max: 5, // small — Vercel serverless functions don't need a big pool
  });
  return _pool;
}

/** Tagged-template SQL with `$1, $2, …` parameterisation — mirrors the
 *  @vercel/postgres shape so callers reading this code feel familiar. */
export async function sql<T extends QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) text += `$${i + 1}`;
  }
  const res = await pool().query<T>(text, values as unknown[]);
  return { rows: res.rows, rowCount: res.rowCount ?? 0 };
}

/** Lower-level escape hatch — multi-statement DDL, raw text. */
export async function rawQuery(text: string): Promise<void> {
  await pool().query(text);
}
