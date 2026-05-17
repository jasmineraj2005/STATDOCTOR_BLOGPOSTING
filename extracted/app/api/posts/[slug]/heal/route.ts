import { NextResponse } from "next/server";
import { getPostBySlug } from "@/lib/admin/store";
import { runValidators } from "@/lib/admin/validators";
import { isAuthorised } from "@/lib/admin/auth";
import { dispatchHealWorkflow } from "@/lib/admin/heal-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Heal-Agent — manual CEO override.
 *
 *   POST /api/posts/[slug]/heal
 *   Cookie: admin_token=...
 *
 * Ingest auto-fires heal when an inbound article has red validators, so most
 * articles are healed before the CEO ever sees them. This endpoint is the
 * manual override for an article that already landed in the queue (e.g. an
 * edit re-introduced a banned phrase).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorised())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  const file = await getPostBySlug(slug);
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const results = runValidators(file.post);
  const outcome = await dispatchHealWorkflow(slug, results);

  if (!outcome.ok) {
    const httpStatus = outcome.reason === "heal_disabled" ? 503 : 502;
    return NextResponse.json(outcome, { status: httpStatus });
  }

  if (!outcome.dispatched) {
    return NextResponse.json({
      ok: true,
      no_op: true,
      detail: "All validators green or non-fixable; nothing to heal.",
      failures: outcome.failures,
    });
  }

  return NextResponse.json({
    ok: true,
    dispatched: true,
    failures: outcome.failures,
    detail:
      "Heal workflow dispatched. Refresh in ~90s — the patched article will replace this one.",
  });
}
