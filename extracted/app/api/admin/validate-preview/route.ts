import { NextResponse } from "next/server";

import { runValidators } from "@/lib/admin/validators";
import type { Post } from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pipeline-side preview validator (M13 closed-loop retry).
 *
 *   POST /api/admin/validate-preview
 *   Authorization: Bearer ${INGEST_TOKEN}
 *   Body: { post: Post }
 *
 * Runs the same `runValidators` suite the ingest route uses, but never writes
 * to the DB. The Python pipeline POSTs the assembled FinalPost here between
 * writer/seo/ahpra and the real ingest call; if any validator returns "fail",
 * the writer is re-invoked with the failure reason as `previous_failure`.
 *
 * Auth reuses INGEST_TOKEN — the pipeline already carries it.
 */
export async function POST(req: Request) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "disabled", detail: "INGEST_TOKEN not configured" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("authorization") ?? "";
  if (provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { post?: unknown };
  try {
    body = (await req.json()) as { post?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.post || typeof body.post !== "object") {
    return NextResponse.json(
      { error: "missing_post", detail: "Expected { post: Post }" },
      { status: 400 },
    );
  }

  const post = body.post as Post;
  const all_validators = runValidators(post);
  const red_validators = all_validators.filter((r) => r.status === "fail");

  return NextResponse.json({ red_validators, all_validators });
}
