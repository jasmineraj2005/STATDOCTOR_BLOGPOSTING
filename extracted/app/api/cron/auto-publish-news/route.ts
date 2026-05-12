import { NextResponse } from "next/server";
import { sql, isDbConfigured } from "@/lib/admin/db";
import { recordCronRun } from "@/lib/admin/cron";
import { upsertPost, logAudit } from "@/lib/admin/store";
import { publishPost } from "@/lib/admin/publish";
import { runValidators, isApprovable } from "@/lib/admin/validators";
import type { Post } from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Auto-publish news posts that have sat pending for > AUTO_PUBLISH_NEWS_HOURS.
 *
 * Per blog.md "Editorial review workflow": news loses 80% of value at +4 days,
 * so we don't block on CEO availability. Guides + Inside StatDoctor queue
 * indefinitely (handled here by content_type filter).
 *
 *   GET /api/cron/auto-publish-news
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * For every candidate:
 *   - Re-run validators (same checks as manual Approve)
 *   - If approvable: flip to published, publish via publish.ts, audit row
 *   - If not approvable: leave as pending_review, write an alert
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
      { ok: false, detail: "POSTGRES_URL not set; cron is a no-op in FS mode." },
      { status: 200 },
    );
  }

  const hours = Number(process.env.AUTO_PUBLISH_NEWS_HOURS ?? "48");
  if (!Number.isFinite(hours) || hours <= 0) {
    return NextResponse.json(
      { error: "invalid_AUTO_PUBLISH_NEWS_HOURS" },
      { status: 500 },
    );
  }

  type Row = { slug: string; filename: string; data: Post };
  const cutoffIso = new Date(Date.now() - hours * 3600_000).toISOString();
  const { rows } = await sql<Row>`
    SELECT slug, filename, data
      FROM posts
      WHERE status = 'pending_review'
        AND content_type = 'news'
        AND generated_at < ${cutoffIso}
      ORDER BY generated_at ASC
      LIMIT 50
  `;

  const summary: {
    candidates: number;
    auto_published: string[];
    held: { slug: string; failed: string[] }[];
  } = { candidates: rows.length, auto_published: [], held: [] };

  for (const row of rows) {
    const validators = runValidators(row.data);
    if (!isApprovable(validators)) {
      const failed = validators
        .filter((v) => v.status === "fail")
        .map((v) => v.label);
      summary.held.push({ slug: row.slug, failed });
      await recordAlert(
        "auto_publish_blocked",
        `News post '${row.slug}' has sat > ${hours}h but fails validators: ${failed.join(", ")}. CEO must edit + manual approve.`,
      );
      continue;
    }

    const now = new Date().toISOString();
    // Mark approved first so a publish-failed row doesn't get mislabelled as
    // "published" — same pattern as the manual /api/posts/[slug]/approve handler.
    const approved: Post = {
      ...row.data,
      status: "approved",
      last_reviewed_at: now,
      dateModified: now,
    };
    const file = {
      filename: row.filename,
      filepath: "",
      ts: row.filename.match(/^(\d{8}_\d{6})_/)?.[1] ?? "",
      post: approved,
    };
    await upsertPost(file, approved);

    const result = await publishPost(file);
    if (result.ok) {
      await upsertPost(file, { ...approved, status: "published" });
      await logAudit({
        ts: now,
        slug: row.slug,
        action: "publish",
        detail: `auto-publish after ${hours}h CEO inaction — ${result.detail}`,
      });
      summary.auto_published.push(row.slug);
    } else {
      await logAudit({
        ts: now,
        slug: row.slug,
        action: "publish-failed",
        detail: `auto-publish after ${hours}h — handoff failed — ${result.detail}`,
      });
      await recordAlert(
        "auto_publish_handoff_failed",
        `Auto-publish for '${row.slug}' approved the DB row but the handoff failed: ${result.detail}`,
      );
    }
  }

  await recordCronRun(
    "auto-publish-news",
    true,
    `${summary.candidates} candidates · ${summary.auto_published.length} published · ${summary.held.length} held`,
  );
  return NextResponse.json({ ok: true, ...summary });
}

async function recordAlert(kind: string, detail: string): Promise<void> {
  try {
    await sql`
      INSERT INTO alerts (kind, detail) VALUES (${kind}, ${detail})
    `;
  } catch {
    // alerts table may not exist yet — created in the next migration.
  }
}
