import { NextResponse } from "next/server";
import { isDbConfigured, sql } from "@/lib/admin/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fail-Agent Layer A — pipeline run logger.
 *
 *   POST /api/admin/pipeline-runs
 *   Authorization: Bearer ${INGEST_TOKEN}
 *   Body: { run_id, agent_name, status, failure_reason?, retry_count? }
 *
 * Reuses INGEST_TOKEN so the pipeline doesn't need a fourth secret. Inserts
 * one row into `pipeline_runs`. Operators query by run_id to debug.
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const run_id = typeof body.run_id === "string" ? body.run_id : "";
  const agent_name = typeof body.agent_name === "string" ? body.agent_name : "";
  const status = typeof body.status === "string" ? body.status : "";
  const failure_reason =
    typeof body.failure_reason === "string" ? body.failure_reason : null;
  const retry_count = typeof body.retry_count === "number" ? body.retry_count : 0;

  const validAgents = new Set([
    "intelligence",
    "researcher",
    "writer",
    "seo",
    "ahpra",
  ]);
  const validStatuses = new Set(["ok", "fail", "retried", "aborted"]);
  if (!run_id || !validAgents.has(agent_name) || !validStatuses.has(status)) {
    return NextResponse.json(
      {
        error: "bad_request",
        detail:
          "Expected { run_id, agent_name ∈ {intelligence,researcher,writer,seo,ahpra}, status ∈ {ok,fail,retried,aborted}, failure_reason?, retry_count? }",
      },
      { status: 400 },
    );
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, logged: false, reason: "db_not_configured" });
  }

  try {
    await sql`
      INSERT INTO pipeline_runs (run_id, agent_name, status, failure_reason, retry_count)
      VALUES (${run_id}, ${agent_name}, ${status}, ${failure_reason}, ${retry_count})
    `;
  } catch (e) {
    return NextResponse.json(
      { error: "insert_failed", detail: String(e) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
