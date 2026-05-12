import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getPostBySlug, upsertPost, logAudit } from "@/lib/admin/store";
import { runValidators, isApprovable } from "@/lib/admin/validators";
import { publishPost } from "@/lib/admin/publish";

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
  const file = await getPostBySlug(slug);
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Re-run validators server-side — never trust the client's claim of approval.
  const validators = runValidators(file.post);
  if (!isApprovable(validators)) {
    const failed = validators.filter((v) => v.status === "fail").map((v) => v.label);
    return NextResponse.json(
      { error: "validators_failed", failed },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const approved = {
    ...file.post,
    status: "approved" as const,
    last_reviewed_at: now,
    dateModified: now,
  };

  await upsertPost(file, approved);

  const result = await publishPost({ ...file, post: approved });

  if (result.ok) {
    await upsertPost(file, { ...approved, status: "published" });
    await logAudit({
      ts: now,
      slug,
      action: "publish",
      detail: result.detail,
    });
  } else {
    await logAudit({
      ts: now,
      slug,
      action: "publish-failed",
      detail: result.detail,
    });
    return NextResponse.json(
      { error: "publish_failed", detail: result.detail },
      { status: 500 },
    );
  }

  redirect("/admin/posts");
}
