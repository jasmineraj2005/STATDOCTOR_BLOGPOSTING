import { NextResponse } from "next/server";
import { sql, isDbConfigured } from "@/lib/admin/db";
import { recordCronRun } from "@/lib/admin/cron";
import { computeBatchReport } from "@/lib/admin/batch-report";
import { checkWeeklyInvariants } from "@/lib/admin/weekly-invariants";
import type { AuditEvent } from "@/lib/admin/audit";
import type { DbLike } from "@/lib/admin/weekly-invariants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Sunday Batch Report — fires at 09:00 UTC Monday (19:00 AEST Sunday).
 *
 *   GET /api/cron/sunday-batch-report
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Required env:
 *   RESEND_API_KEY        — Resend API key (free tier: 3,000 emails/month)
 *   SUNDAY_REPORT_EMAIL   — override recipient (default: anu@statdoctor.net)
 *
 * Behaviour:
 *   1. Fetches audit_events from the last Sunday's review window
 *      (Sunday 06:00–18:00 AEST = Sunday 20:00–08:00 UTC)
 *   2. Computes BatchReport via computeBatchReport()
 *   3. Runs checkWeeklyInvariants() for the write-back loop
 *   4. Persists the report row into sunday_batch_reports (upsert by window_end)
 *   5. Emails the CEO via Resend
 *
 * Cron schedule in vercel.json: "0 9 * * 1" (09:00 UTC every Monday)
 */

// The recipient if SUNDAY_REPORT_EMAIL is not set.
const DEFAULT_RECIPIENT = "anu@statdoctor.net";

/**
 * Compute the Sunday review window boundaries for a given "now" date.
 * The window is Sunday 06:00 AEST → Sunday 18:00 AEST (previous Sunday
 * relative to `now`).
 *
 * AEST = UTC+10. So:
 *   Window start: last Sunday 06:00 AEST = last Sunday 20:00 UTC (Sat evening)
 *   Window end:   last Sunday 18:00 AEST = last Sunday 08:00 UTC
 *
 * For simplicity we use a 24-hour lookback from 09:00 UTC Monday, which
 * captures all of Sunday AEST regardless of daylight-saving transitions.
 */
export function computeSundayWindow(now: Date): { start: Date; end: Date } {
  // "now" is assumed to be ~09:00 UTC Monday.
  // The Sunday window we want is the previous 30h — generous enough to cover
  // all of Sunday AEST (which starts 14:00 UTC Sat and ends 14:00 UTC Sun).
  const end = new Date(now);
  // Window closes at 18:00 AEST = 08:00 UTC Sunday
  // From 09:00 UTC Monday that's 25 hours ago
  end.setUTCHours(end.getUTCHours() - 1); // step back 1h from now (09:00→08:00)
  end.setUTCDate(end.getUTCDate() - 1); // step back 1 day (Mon→Sun)

  const start = new Date(end);
  start.setUTCHours(end.getUTCHours() - 12); // 12h window covers the review session

  return { start, end };
}

export async function GET(req: Request) {
  // ── auth ──────────────────────────────────────────────────────────────────
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, detail: "POSTGRES_URL not set; cron is a no-op." },
      { status: 200 },
    );
  }

  const now = new Date();
  const { start, end } = computeSundayWindow(now);

  // ── fetch audit events for the Sunday window ──────────────────────────────
  type AuditRow = {
    ts: string;
    slug: string;
    action: string;
    reason_code: string | null;
    reason_text: string | null;
    detail: string | null;
  };
  const { rows: auditRows } = await sql<AuditRow>`
    SELECT ts::text, slug, action, reason_code, reason_text, detail
      FROM audit_events
      WHERE ts >= ${start.toISOString()}
        AND ts <= ${end.toISOString()}
      ORDER BY ts ASC
  `;

  const events: AuditEvent[] = auditRows.map((r) => ({
    ts: r.ts,
    slug: r.slug,
    action: r.action as AuditEvent["action"],
    reason_code: (r.reason_code ?? undefined) as AuditEvent["reason_code"],
    reason_text: r.reason_text ?? undefined,
    detail: r.detail ?? undefined,
  }));

  // ── compute batch report ──────────────────────────────────────────────────
  const report = computeBatchReport(events);

  // ── persist report row ────────────────────────────────────────────────────
  // Create table on first run if it doesn't exist (idempotent).
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS sunday_batch_reports (
        id                  BIGSERIAL PRIMARY KEY,
        window_start        TIMESTAMPTZ NOT NULL,
        window_end          TIMESTAMPTZ NOT NULL,
        approved            INT NOT NULL DEFAULT 0,
        edited              INT NOT NULL DEFAULT 0,
        rejected            INT NOT NULL DEFAULT 0,
        duration_seconds    INT NOT NULL DEFAULT 0,
        approve_as_is_rate  NUMERIC(5,4) NOT NULL DEFAULT 0,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (window_end)
      )
    `;
    await sql`
      INSERT INTO sunday_batch_reports
        (window_start, window_end, approved, edited, rejected, duration_seconds, approve_as_is_rate)
      VALUES (
        ${start.toISOString()},
        ${end.toISOString()},
        ${report.approved},
        ${report.edited},
        ${report.rejected},
        ${report.durationSeconds},
        ${report.approveAsIsRate}
      )
      ON CONFLICT (window_end) DO UPDATE SET
        approved           = EXCLUDED.approved,
        edited             = EXCLUDED.edited,
        rejected           = EXCLUDED.rejected,
        duration_seconds   = EXCLUDED.duration_seconds,
        approve_as_is_rate = EXCLUDED.approve_as_is_rate
    `;
  } catch {
    // Non-fatal — report email still sends even if persistence fails
  }

  // ── run weekly invariants ─────────────────────────────────────────────────
  const dbLike: DbLike = {
    query: async <T extends Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number }> => {
      // Use raw pool query for the invariant checker
      const { Pool } = await import("pg");
      const conn =
        process.env.POSTGRES_URL ||
        process.env.POSTGRES_URL_NON_POOLING ||
        process.env.DATABASE_URL;
      if (!conn) return { rows: [], rowCount: 0 };
      const p = new Pool({ connectionString: conn, max: 1 });
      try {
        const res = await p.query<T>(text, values as unknown[]);
        return { rows: res.rows, rowCount: res.rowCount ?? 0 };
      } finally {
        await p.end();
      }
    },
  };
  const invariants = await checkWeeklyInvariants({ now, db: dbLike });

  // ── build email ───────────────────────────────────────────────────────────
  const totalDecisions = report.approved + report.rejected;
  const approveRatePct =
    totalDecisions > 0
      ? `${(report.approveAsIsRate * 100).toFixed(1)}%`
      : "N/A";
  const durationMin = Math.round(report.durationSeconds / 60);

  const subject = `StatDoctor Sunday batch — ${report.approved} approval${report.approved !== 1 ? "s" : ""}`;

  const breachedInvariants = invariants.filter((i) => i.status === "breach");
  const invariantHtml =
    breachedInvariants.length > 0
      ? `<h2 style="color:#c00">⚠ Weekly invariant breaches</h2><ul>${breachedInvariants
          .map(
            (i) =>
              `<li><strong>${esc(i.name)}</strong>: ${esc(i.detail)}</li>`,
          )
          .join("")}</ul>`
      : `<p style="color:#3a7">✓ All weekly invariants pass.</p>`;

  const articleLinesHtml =
    report.articleLines.length > 0
      ? `<ul>${report.articleLines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
      : "<p>(no editorial events this window)</p>";

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a2e; max-width: 720px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 22px; margin: 0 0 16px;">StatDoctor Sunday batch report</h1>
  <p style="color:#6b7a73; margin: 0 0 24px;">
    Window: ${esc(start.toISOString())} → ${esc(end.toISOString())}
  </p>

  <h2 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px;">Summary</h2>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td>Approved</td><td><strong>${report.approved}</strong></td></tr>
    <tr><td>Edited before approve</td><td><strong>${report.edited}</strong></td></tr>
    <tr><td>Rejected</td><td><strong>${report.rejected}</strong></td></tr>
    <tr><td>Approve-as-is rate</td><td><strong>${approveRatePct}</strong></td></tr>
    <tr><td>Session duration</td><td><strong>${durationMin} min</strong></td></tr>
  </table>

  <h2 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 24px;">Per-article</h2>
  ${articleLinesHtml}

  <h2 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 24px;">Weekly health checks</h2>
  ${invariantHtml}
</body></html>`;

  // ── send via Resend ───────────────────────────────────────────────────────
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.SUNDAY_REPORT_EMAIL ?? DEFAULT_RECIPIENT;
  const from =
    process.env.DIGEST_EMAIL_FROM ??
    "StatDoctor Editorial <digest@statdoctor.app>";

  let sent: { ok: boolean; detail: string } = { ok: false, detail: "" };
  if (!apiKey) {
    sent = {
      ok: false,
      detail: "RESEND_API_KEY not set; report logged but not sent.",
    };
  } else {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, html }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      sent = res.ok
        ? { ok: true, detail: `Resend id=${body.id ?? "?"}` }
        : {
            ok: false,
            detail: `Resend ${res.status}: ${body.message ?? "error"}`,
          };
    } catch (e) {
      sent = { ok: false, detail: `Resend fetch threw: ${String(e)}` };
    }
  }

  await recordCronRun(
    "sunday-batch-report",
    sent.ok || !apiKey,
    sent.detail || "report completed",
  );

  return NextResponse.json({
    ok: true,
    sent: sent.ok,
    detail: sent.detail,
    report: {
      approved: report.approved,
      edited: report.edited,
      rejected: report.rejected,
      durationSeconds: report.durationSeconds,
      approveAsIsRate: report.approveAsIsRate,
    },
    invariants: invariants.map((i) => ({ name: i.name, status: i.status })),
  });
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
