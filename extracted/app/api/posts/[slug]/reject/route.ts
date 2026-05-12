import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getPostFileBySlug, writePostFile } from "@/lib/admin/loader";
import { logAuditEvent } from "@/lib/admin/audit";
import { REJECTION_LABELS, type RejectionCode } from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_CODES = Object.keys(REJECTION_LABELS) as RejectionCode[];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorised())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const file = await getPostFileBySlug(slug);
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const form = await req.formData();
  const rawCode = String(form.get("reason_code") ?? "other");
  const code: RejectionCode = (VALID_CODES as string[]).includes(rawCode)
    ? (rawCode as RejectionCode)
    : "other";
  const text = String(form.get("reason_text") ?? "").slice(0, 1000);

  const now = new Date().toISOString();
  const history = [
    ...(file.post.rejection_history ?? []),
    { ts: now, code, text },
  ];
  const isFinal = history.length >= 2;

  const updated = {
    ...file.post,
    status: "rejected" as const,
    rejection_history: history,
    last_reviewed_at: now,
  };
  await writePostFile(file, updated);

  await logAuditEvent({
    ts: now,
    slug: slug,
    action: "reject",
    reason_code: code,
    reason_text: text,
    detail: isFinal
      ? "Final rejection — topic dropped, no further regen."
      : "Rejected — eligible for one regen attempt.",
  });

  // Regen is intentionally out-of-band — kicking off Python from a Next.js
  // handler ties the request to a subprocess we can't reliably reap. The user
  // re-runs `python main.py --regen <slug>` (or a cron picks rejected posts
  // up). The rejection text is read by the Writer from rejection_history.

  redirect("/admin/posts");
}
