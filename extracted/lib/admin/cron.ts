import "server-only";

import { sql, isDbConfigured } from "./db";

/** Record a cron invocation. Updates the heartbeat row used by /api/health
 *  and the daily digest. Safe to call without a DB — silently no-ops. */
export async function recordCronRun(
  kind: string,
  ok: boolean,
  detail: string,
): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    if (ok) {
      await sql`
        INSERT INTO cron_runs (kind, last_ok, last_detail, runs_total, fails_total)
        VALUES (${kind}, NOW(), ${detail}, 1, 0)
        ON CONFLICT (kind) DO UPDATE SET
          last_ok     = NOW(),
          last_detail = EXCLUDED.last_detail,
          runs_total  = cron_runs.runs_total + 1
      `;
    } else {
      await sql`
        INSERT INTO cron_runs (kind, last_fail, last_detail, runs_total, fails_total)
        VALUES (${kind}, NOW(), ${detail}, 1, 1)
        ON CONFLICT (kind) DO UPDATE SET
          last_fail   = NOW(),
          last_detail = EXCLUDED.last_detail,
          runs_total  = cron_runs.runs_total + 1,
          fails_total = cron_runs.fails_total + 1
      `;
      // Also write an alert so the digest catches it.
      await sql`
        INSERT INTO alerts (kind, detail)
        VALUES (${`cron_failed:${kind}`}, ${detail})
      `;
    }
  } catch {
    // Cron-tracking failure isn't worth bringing down the actual cron.
  }
}
