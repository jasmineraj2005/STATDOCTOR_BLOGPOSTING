import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getPostBySlug, claimForApproval, logAudit } from "@/lib/admin/store";
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
 *
 * Race-condition safety: the final state transition is handled by claimForApproval(),
 * a single SQL UPDATE … WHERE status='pending_review' RETURNING. Postgres's row-level
 * locks guarantee only one concurrent caller gets the row back; the second gets null
 * and receives 409. Validators run before the claim (non-state-mutating read), so a
 * validator failure never touches DB state.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorised())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  // 1. Read post — pure, no state mutation.
  const file = await getPostBySlug(slug);
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 2. Run validators server-side — never trust the client's claim of approval.
  //    This is a pure check; if it fails we return 400 without touching state.
  const validators = runValidators(file.post);
  if (!isApprovable(validators)) {
    const failed = validators.filter((v) => v.status === "fail").map((v) => v.label);
    return NextResponse.json(
      { error: "validators_failed", failed },
      { status: 400 },
    );
  }

  // 3. Atomic claim: single UPDATE … WHERE status='pending_review' RETURNING.
  //    If null, the post was already claimed by a concurrent request (or its
  //    status changed since step 1).
  const claimed = await claimForApproval(slug);
  if (!claimed) {
    return NextResponse.json(
      { error: "already_approved_or_not_found" },
      { status: 409 },
    );
  }

  // 4. Audit log — claim already persisted, log is best-effort.
  await logAudit({
    ts: claimed.post.last_reviewed_at ?? new Date().toISOString(),
    slug,
    action: "approve",
    detail: "Approved — queued for next scheduled publish slot",
  });

  redirect("/admin/posts");
}
