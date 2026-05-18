/**
 * POST /api/posts/[slug]/restore
 *
 * Reverse a prior soft delete by clearing deleted_at. Returns 204 on success,
 * 404 if the slug is unknown or not currently soft-deleted.
 */
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { logAudit, restorePostBySlug } from "@/lib/admin/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthorised())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const ok = await restorePostBySlug(slug);
  if (!ok) {
    return NextResponse.json(
      { error: "not_found_or_not_deleted" },
      { status: 404 },
    );
  }

  await logAudit({
    ts: new Date().toISOString(),
    slug,
    action: "edit",
    detail: "restore: deleted_at cleared",
  });

  redirect("/admin/posts");
}
