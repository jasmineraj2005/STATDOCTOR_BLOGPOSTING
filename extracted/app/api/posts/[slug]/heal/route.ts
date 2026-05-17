import { NextResponse } from "next/server";
import { getPostBySlug } from "@/lib/admin/store";
import { runValidators } from "@/lib/admin/validators";
import { isAuthorised } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Heal-Agent UI trigger.
 *
 *   POST /api/posts/[slug]/heal
 *   Cookie: admin_token=...
 *
 * Fires `gh workflow_dispatch` on heal.yml with the slug as input. The Python
 * heal-agent runs inside GH Actions, fetches the post via heal-data, calls
 * writer.regenerate, POSTs the patched post back to /api/admin/ingest.
 *
 * Requires Vercel env:
 *   - HEAL_DISPATCH_REPO        (e.g. "jasmineraj2005/STATDOCTOR_BLOGPOSTING")
 *   - HEAL_DISPATCH_REF         (e.g. "main" or "feat/...")
 *   - HEAL_DISPATCH_TOKEN       (PAT with `workflow` scope)
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

  const failures = runValidators(file.post).filter((r) => r.status === "fail");
  if (failures.length === 0) {
    return NextResponse.json({
      ok: true,
      no_op: true,
      detail: "All validators green; nothing to heal.",
    });
  }

  const repo = process.env.HEAL_DISPATCH_REPO;
  const ref = process.env.HEAL_DISPATCH_REF ?? "main";
  const token = process.env.HEAL_DISPATCH_TOKEN;
  if (!repo || !token) {
    return NextResponse.json(
      {
        error: "heal_disabled",
        detail:
          "HEAL_DISPATCH_REPO + HEAL_DISPATCH_TOKEN env vars not set on Vercel. " +
          "See HANDOVER.md §Heal-Agent.",
      },
      { status: 503 },
    );
  }

  const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/heal.yml/dispatches`;
  const dispatchBody = { ref, inputs: { slug } };

  const ghRes = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(dispatchBody),
  });

  if (!ghRes.ok) {
    const detail = await ghRes.text();
    return NextResponse.json(
      { error: "dispatch_failed", status: ghRes.status, detail },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    dispatched: true,
    failures: failures.map((f) => ({ check: f.check, label: f.label })),
    detail:
      "Heal workflow dispatched. Refresh in ~90s — the patched article will replace this one.",
  });
}
