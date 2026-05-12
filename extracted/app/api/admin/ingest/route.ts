import { NextResponse } from "next/server";
import { upsertPost } from "@/lib/admin/store";
import type { Post, PostFile } from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pipeline → dashboard ingest. The Python pipeline POSTs the FinalPost JSON
 * to this endpoint after generation. The dashboard upserts the post into the
 * DB; from there the review queue can see it.
 *
 *   POST /api/admin/ingest
 *   Authorization: Bearer ${INGEST_TOKEN}
 *   Body: { filename: string, post: <FinalPost> }
 *
 * INGEST_TOKEN is deliberately separate from ADMIN_TOKEN so a leaked pipeline
 * key can't be used to approve posts.
 */
export async function POST(req: Request) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "ingest_disabled", detail: "INGEST_TOKEN not configured" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("authorization") ?? "";
  if (provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { filename?: unknown; post?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const filename = typeof body.filename === "string" ? body.filename : "";
  const post = body.post as Post | undefined;
  if (!filename || !post || typeof post.slug !== "string") {
    return NextResponse.json(
      { error: "bad_request", detail: "Expected { filename, post: FinalPost }" },
      { status: 400 },
    );
  }

  const file: PostFile = {
    filename,
    filepath: "", // not used in DB mode
    ts: filename.match(/^(\d{8}_\d{6})_/)?.[1] ?? "",
    post,
  };

  try {
    await upsertPost(file, post);
  } catch (e) {
    return NextResponse.json(
      { error: "upsert_failed", detail: String(e) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, slug: post.slug });
}
