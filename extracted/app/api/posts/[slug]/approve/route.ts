import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getPostBySlug, upsertPost, logAudit } from "@/lib/admin/store";
import { runValidators, isApprovable } from "@/lib/admin/validators";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Approve handler.
 *
 * Approval = "queued for publication", not "live now". The /api/cron/scheduled-
 * publish cron fires Tue/Wed/Fri/Sun at 09:00 UTC and publishes one 'scheduled'
 * article per slot. So:
 *
 *   pending_review  ─[Approve]──▶  scheduled  ─[scheduler cron]──▶  published
 *                                      │
 *                                      └────[Edit]─▶  pending_review (re-review)
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorised())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const file = await getPostBySlug(slug);
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Re-run validators server-side — never trust the client's claim of approval.
  const validators = runValidators(file.post);
  if (!isApprovable(validators)) {
    const failed = validators.filter((v) => v.status === "fail").map((v) => v.label);
    return NextResponse.json(
      { error: "validators_failed", failed },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const scheduled = {
    ...file.post,
    status: "scheduled" as const,
    last_reviewed_at: now,
    dateModified: now,
  };
  await upsertPost(file, scheduled);

  await logAudit({
    ts: now,
    slug,
    action: "approve",
    detail: "Approved — queued for next scheduled publish slot",
  });

  redirect("/admin/posts");
}
