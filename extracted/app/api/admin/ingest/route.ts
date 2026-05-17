import { NextResponse } from "next/server";
import { upsertPost } from "@/lib/admin/store";
import { validateSourcesQuick } from "@/lib/admin/url-validator";
import { runIngestGate, gateMode } from "./gate";
import type { Post, PostFile, AHPRAFlag } from "@/lib/admin/types";

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

  // ── URL whitelist gate (load-bearing, unbypassable) ──────────────────────
  // Whitelist-only check — no HEAD calls at ingest to keep POST latency low.
  // The Python pipeline (M1.T6) performs HEAD checks at generation time.
  const sources = Array.isArray(post.sources) ? post.sources : [];

  let filteredPost = post;
  let droppedCount = 0;
  const responseFlags: Array<{ type: string; url: string; publisher?: string }> = [];

  if (sources.length > 0) {
    const { okSources, flags, totalOk } = validateSourcesQuick(sources);

    if (totalOk === 0) {
      // Every source is off-whitelist: reject entirely, never enter queue
      return NextResponse.json(
        { error: "all_sources_invalid", flags },
        { status: 422 },
      );
    }

    if (totalOk < sources.length) {
      // Partial: drop bad sources, append flags to ahpra_flags, continue
      droppedCount = sources.length - totalOk;

      const newAhpraFlags: AHPRAFlag[] = [
        ...(Array.isArray(post.ahpra_flags) ? post.ahpra_flags : []),
        ...flags.map((f) => ({
          flag_type: f.type,          // maps SourceFlag.type → AHPRAFlag.flag_type
          excerpt: `Dropped source: ${f.url}`,
          fix_applied: "source_removed_from_article",
          requires_human_review: true,
        })),
      ];

      filteredPost = {
        ...post,
        sources: okSources as Post["sources"],
        ahpra_flags: newAhpraFlags,
      };

      responseFlags.push(...flags);
    }
  }

  // ── Layer C — server-side hard-gate (Fail-Agent) ──────────────────────────
  // Checks word_count vs validators.json floors, source_count >= 5, required
  // schema fields. Strict mode returns 422 + validation_errors[]. Shadow mode
  // (default) logs and continues — flip FAIL_AGENT_INGEST_GATE=strict on
  // Vercel after smoke-testing real pipeline output.
  const layerCErrors = runIngestGate(filteredPost as Parameters<typeof runIngestGate>[0]);
  if (layerCErrors.length > 0) {
    if (gateMode() === "strict") {
      return NextResponse.json(
        { error: "validation_failed", validation_errors: layerCErrors },
        { status: 422 },
      );
    }
    console.warn(
      `[fail-agent/layer-c] slug=${filteredPost.slug} mode=shadow violations=${JSON.stringify(layerCErrors)}`,
    );
  }

  const file: PostFile = {
    filename,
    filepath: "", // not used in DB mode
    ts: filename.match(/^(\d{8}_\d{6})_/)?.[1] ?? "",
    post: filteredPost,
  };

  try {
    await upsertPost(file, filteredPost);
  } catch (e) {
    return NextResponse.json(
      { error: "upsert_failed", detail: String(e) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    slug: filteredPost.slug,
    ...(droppedCount > 0 ? { dropped: droppedCount, flags: responseFlags } : {}),
  });
}
