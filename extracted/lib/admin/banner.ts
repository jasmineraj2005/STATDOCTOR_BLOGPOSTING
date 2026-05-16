/**
 * lib/admin/banner.ts — Banner state machine (M7)
 *
 * Computes the highest-severity active banner state from DB data.
 * Pure-ish (DB-dependent). Returns one banner state or "none".
 *
 * Precedence (highest → lowest):
 *   publish_failed > cron_stale > stale_review > needs_review_high > none
 *
 * Consumed by: /api/admin/banner-state (returns JSON to the dashboard).
 * UI wiring is a follow-up milestone (M6.5/M8).
 */

export type BannerState =
  | { kind: "none" }
  | { kind: "needs_review_high"; count: number }
  | { kind: "stale_review"; daysSinceLastReview: number }
  | { kind: "publish_failed"; count: number }
  | { kind: "cron_stale"; cronName: string; ageHours: number };

/** DB interface — injectable for testing. */
export type BannerDb = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

/** Thresholds (tunable). */
const NEEDS_REVIEW_HIGH_THRESHOLD = 5;   // >5 pending_review posts → banner
const STALE_REVIEW_DAYS = 7;             // no review activity in 7 days
const CRON_STALE_HOURS = 26;             // cron not run in 26h (should run daily)

/**
 * Compute the current banner state.
 *
 * @param db   DB interface (injectable for tests; defaults to prod pool)
 * @param now  Current timestamp (injectable for deterministic tests)
 */
export async function computeBannerState(db: BannerDb, now: Date): Promise<BannerState> {
  // ── 1. publish_failed (highest severity) ─────────────────────────────────────
  const publishFailedResult = await db.query(
    `SELECT COUNT(*)::int AS count FROM posts WHERE status = 'publish_failed'`,
  );
  const publishFailedCount = Number(publishFailedResult.rows[0]?.count ?? 0);
  if (publishFailedCount > 0) {
    return { kind: "publish_failed", count: publishFailedCount };
  }

  // ── 2. cron_stale ─────────────────────────────────────────────────────────────
  // Any cron that hasn't run a successful run within CRON_STALE_HOURS.
  const cronThreshold = new Date(now.getTime() - CRON_STALE_HOURS * 60 * 60 * 1000);
  const cronStaleResult = await db.query(
    `SELECT kind,
            EXTRACT(EPOCH FROM ($1::timestamptz - COALESCE(last_ok, '1970-01-01'::timestamptz))) / 3600 AS age_hours
       FROM cron_runs
       WHERE COALESCE(last_ok, '1970-01-01'::timestamptz) < $1::timestamptz
       ORDER BY age_hours DESC
       LIMIT 1`,
    [cronThreshold.toISOString()],
  );
  if (cronStaleResult.rows.length > 0) {
    const row = cronStaleResult.rows[0];
    return {
      kind: "cron_stale",
      cronName: String(row.kind),
      ageHours: Math.round(Number(row.age_hours)),
    };
  }

  // ── 3. stale_review ───────────────────────────────────────────────────────────
  // No post has been reviewed (last_reviewed_at updated) in 7 days.
  const staleReviewThreshold = new Date(now.getTime() - STALE_REVIEW_DAYS * 24 * 60 * 60 * 1000);
  const staleReviewResult = await db.query(
    `SELECT MAX(last_reviewed_at) AS last_review FROM posts WHERE last_reviewed_at IS NOT NULL`,
  );
  const lastReview = staleReviewResult.rows[0]?.last_review;
  if (!lastReview || new Date(lastReview as string) < staleReviewThreshold) {
    const daysSince = lastReview
      ? Math.floor((now.getTime() - new Date(lastReview as string).getTime()) / (24 * 60 * 60 * 1000))
      : 9999;
    return { kind: "stale_review", daysSinceLastReview: daysSince };
  }

  // ── 4. needs_review_high ──────────────────────────────────────────────────────
  const pendingResult = await db.query(
    `SELECT COUNT(*)::int AS count FROM posts WHERE status = 'pending_review'`,
  );
  const pendingCount = Number(pendingResult.rows[0]?.count ?? 0);
  if (pendingCount > NEEDS_REVIEW_HIGH_THRESHOLD) {
    return { kind: "needs_review_high", count: pendingCount };
  }

  // ── 5. none ───────────────────────────────────────────────────────────────────
  return { kind: "none" };
}
