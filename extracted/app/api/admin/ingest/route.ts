import { NextResponse } from "next/server";
import { upsertPost } from "@/lib/admin/store";
import { validateSourcesQuick } from "@/lib/admin/url-validator";
import { runValidators } from "@/lib/admin/validators";
import { dispatchHealWorkflow, hasFixableFailures } from "@/lib/admin/heal-dispatch";
import { runIngestGate, gateMode } from "./gate";
import type { Post, PostFile, AHPRAFlag, PostStatus } from "@/lib/admin/types";

/** Heal-loop guardrail — max times the heal agent can re-POST a single slug. */
const MAX_HEAL_ATTEMPTS = 2;

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

  // ── Auto-heal — only show fully-green articles in the queue ───────────────
  // Run runValidators(); if any fail AND they're heal-fixable AND we haven't
  // exhausted retries, save with status='pending_heal' and fire the heal
  // workflow. Healed POSTs increment X-Heal-Attempt so we can stop after N.
  const healAttempt = Math.max(
    0,
    parseInt(req.headers.get("x-heal-attempt") ?? "0", 10) || 0,
  );

  const validatorResults = runValidators(filteredPost);
  const redValidators = validatorResults.filter((r) => r.status === "fail");

  let healStatus: "ok" | "pending_heal" | "heal_failed" = "ok";
  let postToSave: Post = filteredPost;

  if (redValidators.length > 0) {
    if (hasFixableFailures(validatorResults) && healAttempt < MAX_HEAL_ATTEMPTS) {
      healStatus = "pending_heal";
      postToSave = { ...filteredPost, status: "pending_heal" as PostStatus };
    } else {
      // Non-fixable failures (sources/schema/ahpra) OR ran out of attempts.
      // Land as heal_failed so the operator sees it explicitly rather than a
      // silent red row in pending_review.
      healStatus = "heal_failed";
      postToSave = { ...filteredPost, status: "heal_failed" as PostStatus };
    }
  }

  const file: PostFile = {
    filename,
    filepath: "", // not used in DB mode
    ts: filename.match(/^(\d{8}_\d{6})_/)?.[1] ?? "",
    post: postToSave,
  };

  try {
    await upsertPost(file, postToSave);
  } catch (e) {
    // The 'pending_heal' / 'heal_failed' statuses are only valid after the
    // schema migration runs. If the prod DB hasn't been migrated yet, the
    // CHECK constraint rejects the row. Detect that case and fall back to
    // 'pending_review' so the article still lands — operator can run the
    // migration later and the next ingest will use the new statuses cleanly.
    const message = String(e);
    const isCheckConstraint =
      message.includes("posts_status_check") ||
      message.includes("violates check constraint");
    if (isCheckConstraint && healStatus !== "ok") {
      console.warn(
        `[ingest] CHECK constraint blocked status='${postToSave.status}' — falling back to pending_review. Run POST /api/admin/migrate to enable new statuses. slug=${postToSave.slug}`,
      );
      const fallback: Post = { ...filteredPost, status: "pending_review" };
      const fallbackFile: PostFile = { ...file, post: fallback };
      try {
        await upsertPost(fallbackFile, fallback);
        postToSave = fallback;
        healStatus = "ok"; // suppress heal dispatch (no auto-heal until migrated)
      } catch (e2) {
        return NextResponse.json(
          { error: "upsert_failed", detail: String(e2), fallback_attempted: true },
          { status: 500 },
        );
      }
    } else {
      return NextResponse.json(
        { error: "upsert_failed", detail: String(e) },
        { status: 500 },
      );
    }
  }

  // Fire heal workflow_dispatch (don't fail the ingest if dispatch errors —
  // the article is saved as pending_heal so operator can manually trigger).
  let healDispatch: unknown = null;
  if (healStatus === "pending_heal") {
    try {
      healDispatch = await dispatchHealWorkflow(postToSave.slug, validatorResults);
    } catch (e) {
      healDispatch = { ok: false, reason: "dispatch_threw", detail: String(e) };
    }
  }

  return NextResponse.json({
    ok: true,
    slug: postToSave.slug,
    status: postToSave.status,
    heal_attempt: healAttempt,
    red_validators: redValidators.map((r) => r.check),
    ...(healDispatch ? { heal_dispatch: healDispatch } : {}),
    ...(droppedCount > 0 ? { dropped: droppedCount, flags: responseFlags } : {}),
  });
}
