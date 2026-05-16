import { NextResponse } from "next/server";
import { sql, isDbConfigured } from "@/lib/admin/db";
import { recordCronRun } from "@/lib/admin/cron";
import { upsertPost, logAudit } from "@/lib/admin/store";
import { publishPost } from "@/lib/admin/publish";
import { dispatchAlert } from "@/lib/alerts/resend";
import type { Post } from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled publish — fires daily at 09:00 UTC.
 *
 * If today (UTC) is a publish day, picks the oldest 'scheduled' article and
 * publishes it. One article per cron run — keeps the cadence uniform.
 *
 * Publish days: Tue (2), Wed (3), Fri (5), Sun (0). Mon (1), Thu (4), Sat (6)
 * are explicitly NOT publish days — per the editorial calendar.
 *
 *   GET /api/cron/scheduled-publish
 *   Authorization: Bearer ${CRON_SECRET}
 */
const PUBLISH_DAYS = new Set([0, 2, 3, 5]); // Sun, Tue, Wed, Fri (UTC)

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

  const today = new Date().getUTCDay();
  // ?force=1 bypasses the weekday check — for manual catch-up runs and tests.
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && !PUBLISH_DAYS.has(today)) {
    await recordCronRun(
      "scheduled-publish",
      true,
      `Non-publish day (UTC weekday ${today}); skipping.`,
    );
    return NextResponse.json({
      ok: true,
      published: null,
      reason: "not_a_publish_day",
    });
  }

  // Pick the oldest scheduled article — FIFO across the approved queue.
  type Row = { slug: string; filename: string; data: Post };
  const { rows } = await sql<Row>`
    SELECT slug, filename, data
      FROM posts
      WHERE status = 'scheduled'
      ORDER BY last_reviewed_at ASC NULLS FIRST, generated_at ASC
      LIMIT 1
  `;
  if (rows.length === 0) {
    await recordCronRun(
      "scheduled-publish",
      true,
      "Publish day, but the scheduled queue is empty.",
    );
    return NextResponse.json({ ok: true, published: null, reason: "empty_queue" });
  }

  const row = rows[0];
  const now = new Date().toISOString();
  const next: Post = {
    ...row.data,
    status: "published",
    dateModified: now,
  };
  const file = {
    filename: row.filename,
    filepath: "",
    ts: row.filename.match(/^(\d{8}_\d{6})_/)?.[1] ?? "",
    post: next,
  };

  // Mark published in DB first, then push to the website repo.
  await upsertPost(file, next);

  let result;
  try {
    result = await publishPost(file);
  } catch (err) {
    // publishPost threw an unhandled error (network error, unexpected exception, etc.)
    // Roll back to 'publish_failed' so the operator can retry via POST /api/posts/[slug]/retry-publish.
    const errorMessage = err instanceof Error ? err.message : String(err);
    await upsertPost(file, { ...row.data, status: "publish_failed" });
    await logAudit({
      ts: now,
      slug: row.slug,
      action: "publish-failed",
      detail: `publishPost threw unexpectedly — ${errorMessage}`,
    });
    await recordCronRun("scheduled-publish", false, errorMessage);
    await dispatchAlert({
      kind: "publish_failed",
      severity: "error",
      detail: `publishPost threw for slug=${row.slug}: ${errorMessage}`,
      context: { slug: row.slug },
    });
    return NextResponse.json(
      { ok: false, error: "publish_failed", detail: errorMessage },
      { status: 500 },
    );
  }

  if (result.ok) {
    await logAudit({
      ts: now,
      slug: row.slug,
      action: "publish",
      detail: `scheduled publish (UTC weekday ${today}) — ${result.detail}`,
    });
    await recordCronRun(
      "scheduled-publish",
      true,
      `Published ${row.slug} (slot: UTC weekday ${today}).`,
    );
    return NextResponse.json({ ok: true, published: row.slug });
  } else {
    // Roll back to 'publish_failed' so operator can retry; next slot won't auto-pick it up.
    await upsertPost(file, { ...row.data, status: "publish_failed" });
    await logAudit({
      ts: now,
      slug: row.slug,
      action: "publish-failed",
      detail: `scheduled publish handoff failed — ${result.detail}`,
    });
    await recordCronRun("scheduled-publish", false, result.detail);
    await dispatchAlert({
      kind: "publish_failed",
      severity: "error",
      detail: `Publish failed for slug=${row.slug}: ${result.detail}`,
      context: { slug: row.slug },
    });
    return NextResponse.json(
      { ok: false, error: "publish_failed", detail: result.detail },
      { status: 500 },
    );
  }
}
