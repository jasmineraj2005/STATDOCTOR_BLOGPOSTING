import "server-only";

import { sql } from "@vercel/postgres";

/** Returns true when a Vercel-Postgres-compatible connection string is set. */
export function isDbConfigured(): boolean {
  return Boolean(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL,
  );
}

/** Default tagged-template SQL client from @vercel/postgres. */
export { sql };
