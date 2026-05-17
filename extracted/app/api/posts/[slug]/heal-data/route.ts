import { NextResponse } from "next/server";
import { getPostBySlug } from "@/lib/admin/store";
import { runValidators } from "@/lib/admin/validators";
import cfg from "@/lib/admin/validators.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Heal-Agent companion endpoint.
 *
 *   GET /api/posts/[slug]/heal-data
 *   Authorization: Bearer ${INGEST_TOKEN}
 *
 * Returns the post + the list of currently-red validators + the word floor
 * for its content_type. Called by `backend/heal_agent.py` running in the
 * GitHub Actions heal workflow so it can build a targeted fix instruction.
 *
 * Auth via INGEST_TOKEN (same token the pipeline uses) — the Python heal
 * script already has this, no new secret needed.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const expected = process.env.INGEST_TOKEN;
  const auth = req.headers.get("authorization") ?? "";
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  const file = await getPostBySlug(slug);
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const results = runValidators(file.post);
  const validation_failures = results
    .filter((r) => r.status === "fail")
    .map((r) => ({ check: r.check, label: r.label, detail: r.detail }));

  const wordFloors = (cfg as { word_floors: Record<string, number> }).word_floors;
  const word_floor = wordFloors[file.post.content_type] ?? 1500;

  // heal_attempt is tracked as the count of prior 'pending_heal' rows for
  // this slug in pipeline_runs. Simpler: read from post.heal_attempt if set
  // (we keep this as a top-level field on the Post JSON so heal_agent can
  // pass it back via X-Heal-Attempt). Falls back to 0 for first heal.
  const heal_attempt =
    typeof (file.post as unknown as { heal_attempt?: number }).heal_attempt === "number"
      ? (file.post as unknown as { heal_attempt: number }).heal_attempt
      : 0;

  return NextResponse.json({
    slug,
    post: file.post,
    filename: file.filename,
    validation_failures,
    word_floor,
    heal_attempt,
  });
}
