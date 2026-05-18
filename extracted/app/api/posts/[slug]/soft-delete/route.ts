/**
 * POST /api/posts/[slug]/soft-delete
 *
 * Hide a post from the queue without losing its data. Reversible via the
 * /api/posts/[slug]/restore endpoint. Convention 4 (no hard deletes — see
 * docs/architecture.md §12).
 *
 * Returns 204 No Content on success, 404 if the slug is unknown or already
 * soft-deleted.
 */
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { logAudit, softDeletePostBySlug } from "@/lib/admin/store";

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
  const ok = await softDeletePostBySlug(slug);
  if (!ok) {
    return NextResponse.json(
      { error: "not_found_or_already_deleted" },
      { status: 404 },
    );
  }

  await logAudit({
    ts: new Date().toISOString(),
    slug,
    action: "edit",
    detail: "soft_delete: deleted_at set",
  });

  redirect("/admin/posts");
}
