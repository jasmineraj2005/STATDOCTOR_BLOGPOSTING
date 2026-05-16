import { NextResponse } from "next/server";
import { sql, isDbConfigured } from "@/lib/admin/db";
import { recordCronRun } from "@/lib/admin/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Daily digest — sends an email summarising the last 24h of editorial activity.
 *
 *   GET /api/cron/daily-digest
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Required env:
 *   - RESEND_API_KEY      (free tier: 3,000 emails/month — plenty)
 *   - DIGEST_EMAIL_TO     (e.g. anu@statdoctor.net)
 *
 * Optional env:
 *   - DIGEST_EMAIL_FROM   (default: "StatDoctor Editorial <digest@statdoctor.app>")
 *
 * Behaviour: assembles digest → POSTs to Resend → marks the alerts that were
 * surfaced this round as acknowledged so tomorrow's digest doesn't double-up.
 * If RESEND_API_KEY is missing, the digest is logged but not sent (safe dev mode).
 */
export async function GET(req: Request) {
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

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Recent post lifecycle activity.
  type ActionRow = { action: string; n: number };
  const { rows: actionRows } = await sql<ActionRow>`
    SELECT action, COUNT(*)::int AS n
      FROM audit_events
      WHERE ts >= ${since}
      GROUP BY action
      ORDER BY n DESC
  `;

  // Current backlog by status.
  type StatusRow = { status: string; n: number };
  const { rows: statusRows } = await sql<StatusRow>`
    SELECT status, COUNT(*)::int AS n
      FROM posts
      GROUP BY status
      ORDER BY status
  `;

  // Cron heartbeat.
  type CronRow = {
    kind: string;
    last_ok: Date | string | null;
    last_fail: Date | string | null;
    last_detail: string | null;
    fails_total: number;
  };
  const { rows: cronRows } = await sql<CronRow>`
    SELECT kind, last_ok, last_fail, last_detail, fails_total FROM cron_runs ORDER BY kind
  `;

  // Unacknowledged alerts (top 20 by recency).
  type AlertRow = { id: number; ts: Date | string; kind: string; detail: string };
  const { rows: alertRows } = await sql<AlertRow>`
    SELECT id, ts, kind, detail
      FROM alerts
      WHERE acknowledged_at IS NULL
      ORDER BY ts DESC
      LIMIT 20
  `;

  // URL-rejection flag counts (last 7 days) — sourced from ahpra_flags in posts.data.
  // M1.T1-T3 stores SourceFlag objects {type, url, publisher, reason} in ahpra_flags.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  type UrlFlagRow = { type: string; n: number };
  const { rows: urlFlagRows } = await sql<UrlFlagRow>`
    SELECT flag->>'type' AS type, COUNT(*)::int AS n
      FROM posts,
           jsonb_array_elements(data->'ahpra_flags') AS flag
      WHERE data->>'generated_at' >= ${sevenDaysAgo}
        AND flag->>'type' IN ('source_not_in_whitelist', 'source_unreachable')
      GROUP BY flag->>'type'
  `;

  const subject =
    alertRows.length > 0
      ? `[StatDoctor] Digest — ${alertRows.length} alert(s) pending`
      : `[StatDoctor] Daily digest — all systems nominal`;

  const html = renderDigest({
    sinceIso: since,
    actions: actionRows,
    statuses: statusRows,
    crons: cronRows,
    alerts: alertRows,
    urlFlags: urlFlagRows,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  });

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  const from =
    process.env.DIGEST_EMAIL_FROM ?? "StatDoctor Editorial <digest@statdoctor.app>";

  let sent: { ok: boolean; detail: string } = { ok: false, detail: "" };
  if (!apiKey || !to) {
    sent = { ok: false, detail: "RESEND_API_KEY or DIGEST_EMAIL_TO not set; digest not sent" };
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
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      sent = res.ok
        ? { ok: true, detail: `Resend id=${body.id ?? "?"}` }
        : { ok: false, detail: `Resend ${res.status}: ${body.message ?? "error"}` };
    } catch (e) {
      sent = { ok: false, detail: `Resend fetch threw: ${String(e)}` };
    }
  }

  // Acknowledge the alerts we just surfaced — so tomorrow's digest doesn't
  // re-spam them. Only do this if the email actually sent OR if there's no
  // email configured (otherwise alerts pile up forever in misconfigured envs).
  if (alertRows.length > 0 && (sent.ok || !apiKey)) {
    const ids = alertRows.map((a) => a.id);
    await sql`
      UPDATE alerts SET acknowledged_at = NOW() WHERE id = ANY(${ids})
    `;
  }

  await recordCronRun(
    "daily-digest",
    sent.ok || !apiKey,
    sent.detail || "digest skipped (no Resend config)",
  );

  return NextResponse.json({
    ok: sent.ok || !apiKey,
    sent: sent.ok,
    detail: sent.detail,
    counts: {
      actions: actionRows.reduce((a, r) => a + r.n, 0),
      alerts_surfaced: alertRows.length,
    },
  });
}

function renderDigest(d: {
  sinceIso: string;
  actions: { action: string; n: number }[];
  statuses: { status: string; n: number }[];
  crons: {
    kind: string;
    last_ok: Date | string | null;
    last_fail: Date | string | null;
    last_detail: string | null;
    fails_total: number;
  }[];
  alerts: { id: number; ts: Date | string; kind: string; detail: string }[];
  urlFlags: { type: string; n: number }[];
  siteUrl: string;
}): string {
  const fmt = (v: Date | string | null) =>
    v == null ? "—" : new Date(v).toLocaleString("en-AU", { timeZone: "Australia/Sydney" });
  const actions = d.actions.length
    ? d.actions.map((r) => `<li>${esc(r.action)}: ${r.n}</li>`).join("")
    : "<li>(no activity)</li>";
  const statuses = d.statuses.length
    ? d.statuses.map((r) => `<li>${esc(r.status)}: ${r.n}</li>`).join("")
    : "<li>(no posts yet)</li>";
  const crons = d.crons.length
    ? d.crons
        .map(
          (r) =>
            `<tr><td>${esc(r.kind)}</td><td>${fmt(r.last_ok)}</td><td>${fmt(r.last_fail)}</td><td>${r.fails_total}</td><td>${esc(r.last_detail ?? "")}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">(no cron has run yet)</td></tr>`;
  const alerts = d.alerts.length
    ? d.alerts
        .map(
          (r) =>
            `<li><strong>${esc(r.kind)}</strong> · ${fmt(r.ts)}<br>${esc(r.detail)}</li>`,
        )
        .join("")
    : "<li style='color:#3a7'>None — all systems nominal.</li>";
  const inboxLink = d.siteUrl
    ? `<p><a href="${esc(d.siteUrl)}/admin/posts">Open the review queue →</a></p>`
    : "";

  const notInWhitelist = d.urlFlags.find((r) => r.type === "source_not_in_whitelist")?.n ?? 0;
  const unreachable = d.urlFlags.find((r) => r.type === "source_unreachable")?.n ?? 0;
  const totalRejected = notInWhitelist + unreachable;
  const urlValidationLine =
    totalRejected === 0
      ? "URL validation (last 7 days): no rejections — pipeline producing clean sources ✓"
      : `URL validation (last 7 days): ${totalRejected} URLs rejected — ${notInWhitelist} not in whitelist, ${unreachable} unreachable`;

  return `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a2e; max-width: 720px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 22px; margin: 0 0 16px;">StatDoctor editorial digest</h1>
  <p style="color:#6b7a73; margin: 0 0 24px;">Last 24h since ${esc(d.sinceIso)} (UTC).</p>

  <h2 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px;">⚠ Alerts</h2>
  <ul>${alerts}</ul>

  <h2 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 24px;">Activity</h2>
  <ul>${actions}</ul>

  <h2 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 24px;">Backlog</h2>
  <ul>${statuses}</ul>

  <h2 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 24px;">Cron heartbeat</h2>
  <table style="border-collapse: collapse; width: 100%; font-size: 13px;">
    <thead><tr><th align="left">Job</th><th align="left">Last OK</th><th align="left">Last fail</th><th align="left">Fails total</th><th align="left">Last detail</th></tr></thead>
    <tbody>${crons}</tbody>
  </table>

  <h2 style="font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 24px;">Source quality</h2>
  <p style="font-size: 13px; margin: 4px 0;">${esc(urlValidationLine)}</p>

  ${inboxLink}
</body></html>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
