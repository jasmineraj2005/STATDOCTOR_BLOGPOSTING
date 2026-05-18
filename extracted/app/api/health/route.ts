import { NextResponse } from "next/server";
import { sql, isDbConfigured } from "@/lib/admin/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Per-cron maximum tolerated staleness (hours) — beyond this we report "stale".
const CRON_STALENESS_HOURS: Record<string, number> = {
  "scheduled-publish": 26, // daily expected
  "competitor-audit": 80, // 3×/wk → 56h max-gap + 24h buffer
  "seo-snapshot": 50, // daily expected, GSC has a 2-day lag
  "daily-digest": 26, // daily expected
};

/**
 * Crons we expect to fail for known external reasons (e.g. seo-snapshot fails
 * daily until the GSC service account propagates in Google's directory — see
 * docs/bugs.md O2 / docs/plan.md M25). Surfaced in the checks object so the
 * issue stays visible, but does NOT downgrade overall status.
 *
 * Operator-configurable via comma-separated env: HEALTH_EXPECTED_FAILING_CRONS.
 * Clear the env var (or remove the cron from it) once the upstream issue is
 * resolved so the health endpoint goes back to enforcing freshness.
 */
function expectedFailingCrons(): Set<string> {
  const raw = (process.env.HEALTH_EXPECTED_FAILING_CRONS ?? "").trim();
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

type Status = "healthy" | "degraded" | "failing";

/**
 * Public health endpoint. Designed for uptime monitors (UptimeRobot, Better
 * Stack, etc.). Returns 200 + ok=true when everything's fine; 503 + ok=false
 * when degraded so a non-2xx fires the operator's alert path.
 *
 * Intentionally unauthenticated — uptime monitors can't sign requests.
 * Don't leak anything sensitive in the response.
 */
export async function GET() {
  const checks: Record<string, string> = {};
  let status: Status = "healthy";

  if (!isDbConfigured()) {
    checks.db = "not_configured";
    status = "degraded";
    return NextResponse.json(
      { ok: false, status, checks },
      { status: 503 },
    );
  }

  // DB reachable?
  try {
    await sql`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "unreachable";
    status = "failing";
    return NextResponse.json(
      { ok: false, status, checks },
      { status: 503 },
    );
  }

  // Cron freshness — any cron that ran but is now stale, OR has more recent
  // fails than oks, downgrades health unless the cron is in the
  // HEALTH_EXPECTED_FAILING_CRONS allowlist.
  const tolerated = expectedFailingCrons();
  try {
    type CronRow = {
      kind: string;
      last_ok: Date | null;
      last_fail: Date | null;
    };
    const { rows } = await sql<CronRow>`
      SELECT kind, last_ok, last_fail FROM cron_runs
    `;
    for (const r of rows) {
      const maxAgeH = CRON_STALENESS_HOURS[r.kind] ?? 168;
      const lastOk = r.last_ok ? new Date(r.last_ok).getTime() : 0;
      const lastFail = r.last_fail ? new Date(r.last_fail).getTime() : 0;
      const ageH = (Date.now() - lastOk) / 3600_000;
      const isTolerated = tolerated.has(r.kind);
      if (lastFail > lastOk) {
        checks[`cron:${r.kind}`] = isTolerated
          ? "last_run_failed_tolerated"
          : "last_run_failed";
        if (!isTolerated) status = "degraded";
      } else if (lastOk && ageH > maxAgeH) {
        checks[`cron:${r.kind}`] = isTolerated
          ? `stale_${Math.round(ageH)}h_tolerated`
          : `stale_${Math.round(ageH)}h`;
        if (!isTolerated) status = "degraded";
      } else {
        checks[`cron:${r.kind}`] = "ok";
      }
    }
    if (rows.length === 0) {
      checks.crons = "not_yet_run";
      // Not a hard fail — fresh installs need a grace period.
    }
  } catch {
    checks.crons = "error";
    status = "degraded";
  }

  const httpStatus = status === "healthy" ? 200 : 503;
  return NextResponse.json({ ok: status === "healthy", status, checks }, { status: httpStatus });
}
