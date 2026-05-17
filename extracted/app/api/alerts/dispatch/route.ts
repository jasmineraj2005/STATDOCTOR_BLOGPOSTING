import { NextResponse } from "next/server";
import { dispatchAlert, type AlertSeverity } from "@/lib/alerts/resend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fail-Agent Layer B — alert dispatch endpoint.
 *
 *   POST /api/alerts/dispatch
 *   Authorization: Bearer ${ALERT_INGEST_TOKEN}
 *   Body: { kind, severity ∈ {warn,error,critical}, detail, context? }
 *
 * Called by the recover-and-alert composite GitHub Action when a cron has
 * failed twice. Severity=error|critical sends an email via Resend; warn is
 * DB-only. 1h dedup per kind prevents spam.
 */
const VALID_SEVERITIES: AlertSeverity[] = ["warn", "error", "critical"];

export async function POST(req: Request) {
  const expected = process.env.ALERT_INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "disabled", detail: "ALERT_INGEST_TOKEN not configured" },
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

  const kind = typeof body.kind === "string" ? body.kind : "";
  const severity = typeof body.severity === "string" ? body.severity : "";
  const detail = typeof body.detail === "string" ? body.detail : "";
  const context =
    body.context && typeof body.context === "object"
      ? (body.context as Record<string, unknown>)
      : undefined;

  if (!kind || !detail) {
    return NextResponse.json(
      { error: "bad_request", detail: "Expected { kind, severity, detail }" },
      { status: 400 },
    );
  }
  if (!VALID_SEVERITIES.includes(severity as AlertSeverity)) {
    return NextResponse.json(
      { error: "bad_severity", detail: `severity must be one of ${VALID_SEVERITIES.join(",")}` },
      { status: 400 },
    );
  }

  const result = await dispatchAlert({
    kind,
    severity: severity as AlertSeverity,
    detail,
    context,
  });

  return NextResponse.json({ ok: true, ...result });
}
