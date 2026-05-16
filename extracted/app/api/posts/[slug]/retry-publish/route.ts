/**
 * POST /api/posts/[slug]/retry-publish
 *
 * Flips a post with status='publish_failed' back to 'scheduled' so it will
 * be picked up by the next scheduled-publish cron run.
 *
 * Authorization: admin cookie (same as other admin routes)
 *
 * Response:
 *   200 { ok: true, slug, status: "scheduled" }   — post queued for retry
 *   400 { ok: false, error: "not_publish_failed" } — post is not in publish_failed state
 *   404 { ok: false, error: "not_found" }          — slug not found
 *   401 { ok: false, error: "unauthorized" }       — auth failed
 */

import { NextResponse } from "next/server";
import { isAuthorised } from "@/lib/admin/auth";
import { getPostBySlug, upsertPost, logAudit } from "@/lib/admin/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authorised = await isAuthorised();
  if (!authorised) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const file = await getPostBySlug(slug);

  if (!file) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (file.post.status !== "publish_failed") {
    return NextResponse.json(
      {
        ok: false,
        error: "not_publish_failed",
        detail: `Post status is '${file.post.status}'; only 'publish_failed' posts can be retried.`,
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const updated = { ...file.post, status: "scheduled" as const, dateModified: now };
  await upsertPost(file, updated);
  await logAudit({
    ts: now,
    slug,
    action: "approve",
    detail: "Retrying publish: status reset from publish_failed to scheduled.",
  });

  return NextResponse.json({ ok: true, slug, status: "scheduled" });
}
