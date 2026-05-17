import { NextResponse } from "next/server";
import { buildCanaryFile, buildCanaryPost } from "@/lib/admin/canary-fixture";
import { recordCronRun } from "@/lib/admin/cron";
import { dispatchAlert } from "@/lib/alerts/resend";
import { claimForApproval, deletePostBySlug, upsertPost } from "@/lib/admin/store";
import { isDbConfigured } from "@/lib/admin/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Fail-Agent Layer D — synthetic canary.
 *
 *   GET /api/cron/canary
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Walks the full ingest → approve → schedule → delete path daily so a silent
 * regression in any step is caught within 24h. The synthetic post never
 * publishes for real (no GitHub commit); deletion happens at the end so no
 * stray row remains. Slug `__canary-…` is filtered from the public queue
 * views by lib/admin/store.ts.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization") ?? "";
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "db_not_configured" },
      { status: 503 },
    );
  }

  const now = new Date();
  const post = buildCanaryPost(now);
  const file = buildCanaryFile(now);
  const steps: string[] = [];

  try {
    // 1. Ingest (synthetic post lands as pending_review)
    await upsertPost(file, post);
    steps.push("ingest");

    // 2. Approve → transitions pending_review → scheduled
    const claimed = await claimForApproval(post.slug);
    if (!claimed) {
      throw new Error("claimForApproval returned null (canary did not transition)");
    }
    steps.push("approve");
    steps.push("scheduled");

    // 3. Publish (dry-run — never writes to the website repo)
    steps.push("publish_dry");

    // 4. Cleanup
    const deleted = await deletePostBySlug(post.slug);
    if (!deleted) {
      throw new Error("deletePostBySlug returned false (canary row not removed)");
    }
    steps.push("delete");

    await recordCronRun("canary", true, `canary ok: ${steps.join("→")}`);
    return NextResponse.json({ ok: true, steps, slug: post.slug });
  } catch (e) {
    // Best-effort cleanup so a failure doesn't leave a stray row.
    try {
      await deletePostBySlug(post.slug);
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e);
    await recordCronRun("canary", false, `canary failed at step ${steps.length + 1}: ${msg}`);
    await dispatchAlert({
      kind: "canary_failed",
      severity: "critical",
      detail: `canary failed after step ${steps[steps.length - 1] ?? "(none)"}: ${msg}`,
      context: { steps, slug: post.slug },
    });
    return NextResponse.json(
      { ok: false, steps, error: msg },
      { status: 500 },
    );
  }
}
