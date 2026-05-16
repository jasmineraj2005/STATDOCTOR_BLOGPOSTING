/**
 * weekly-invariants.ts
 *
 * Checks a set of named weekly health invariants and inserts breach alerts
 * into the `alerts` table. Inject `db` for testing.
 */

export type InvariantStatus = "ok" | "breach";

export type Invariant = {
  name: string;
  status: InvariantStatus;
  detail: string;
};

export type DbLike = {
  query: <T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number }>;
};

export type CheckWeeklyInvariantsOpts = {
  now: Date;
  db: DbLike;
};

/**
 * checkWeeklyInvariants
 *
 * Runs the following invariant checks:
 *
 * 1. stale_review — no successful Sunday review in the last 8 days
 *    (uses audit_events: looks for an 'approve' or 'reject' action within 8d)
 *
 * 2. low_approve_rate — last 4 Sunday review batches averaged < 0.95 approve-as-is rate
 *    (reads from a sunday_batch_reports table populated by the cron; gracefully
 *     degrades to "ok" if the table doesn't exist / has < 4 rows)
 *
 * 3. publish_backlog — more than 3 articles stuck in 'scheduled' status > 48h
 *
 * Breaches insert into the `alerts` table (kind = "invariant:<name>").
 * Returns the array of Invariant results.
 */
export async function checkWeeklyInvariants(
  opts: CheckWeeklyInvariantsOpts,
): Promise<Invariant[]> {
  const { now, db } = opts;
  const results: Invariant[] = [];

  // ── 1. stale_review ──────────────────────────────────────────────────────
  {
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 3600_000).toISOString();
    const { rows } = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM audit_events
         WHERE ts >= $1
           AND action IN ('approve','reject')`,
      [eightDaysAgo],
    );
    const reviewCount = rows[0]?.n ?? 0;
    const stale: Invariant =
      reviewCount === 0
        ? {
            name: "stale_review",
            status: "breach",
            detail: "No approve/reject audit events in the last 8 days.",
          }
        : {
            name: "stale_review",
            status: "ok",
            detail: `${reviewCount} review action(s) in the last 8 days.`,
          };
    results.push(stale);
    if (stale.status === "breach") {
      await insertAlert(db, "invariant:stale_review", stale.detail);
    }
  }

  // ── 2. low_approve_rate ──────────────────────────────────────────────────
  {
    let lowRateInvariant: Invariant;
    try {
      const { rows } = await db.query<{
        approve_as_is_rate: number;
      }>(
        `SELECT approve_as_is_rate
           FROM sunday_batch_reports
           ORDER BY window_end DESC
           LIMIT 4`,
      );

      if (rows.length < 4) {
        // Not enough history yet — skip this check
        lowRateInvariant = {
          name: "low_approve_rate",
          status: "ok",
          detail: `Only ${rows.length} Sunday report(s) on record; need 4 for trend check.`,
        };
      } else {
        const avg =
          rows.reduce((acc, r) => acc + Number(r.approve_as_is_rate), 0) /
          rows.length;
        lowRateInvariant =
          avg < 0.95
            ? {
                name: "low_approve_rate",
                status: "breach",
                detail: `Last 4 Sunday batches averaged ${(avg * 100).toFixed(1)}% approve-as-is (threshold: 95%).`,
              }
            : {
                name: "low_approve_rate",
                status: "ok",
                detail: `Last 4 Sunday batches averaged ${(avg * 100).toFixed(1)}% approve-as-is.`,
              };
      }
    } catch {
      // Table doesn't exist yet (pre-first-deploy) — treat as ok
      lowRateInvariant = {
        name: "low_approve_rate",
        status: "ok",
        detail: "sunday_batch_reports table not yet available.",
      };
    }
    results.push(lowRateInvariant);
    if (lowRateInvariant.status === "breach") {
      await insertAlert(
        db,
        "invariant:low_approve_rate",
        lowRateInvariant.detail,
      );
    }
  }

  // ── 3. publish_backlog ───────────────────────────────────────────────────
  {
    const fortyEightHoursAgo = new Date(
      now.getTime() - 48 * 3600_000,
    ).toISOString();
    const { rows } = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM posts
         WHERE status = 'scheduled'
           AND last_reviewed_at < $1`,
      [fortyEightHoursAgo],
    );
    const backlogCount = rows[0]?.n ?? 0;
    const backlog: Invariant =
      backlogCount > 3
        ? {
            name: "publish_backlog",
            status: "breach",
            detail: `${backlogCount} articles stuck in 'scheduled' for > 48h (threshold: 3).`,
          }
        : {
            name: "publish_backlog",
            status: "ok",
            detail: `${backlogCount} article(s) in 'scheduled' for > 48h.`,
          };
    results.push(backlog);
    if (backlog.status === "breach") {
      await insertAlert(db, "invariant:publish_backlog", backlog.detail);
    }
  }

  return results;
}

async function insertAlert(
  db: DbLike,
  kind: string,
  detail: string,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO alerts (kind, detail) VALUES ($1, $2)`,
      [kind, detail],
    );
  } catch {
    // Don't let alert insertion failure bubble up and break the invariant check
  }
}
