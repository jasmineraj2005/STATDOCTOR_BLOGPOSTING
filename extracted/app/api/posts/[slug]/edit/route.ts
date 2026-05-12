import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getPostBySlug, upsertPost, logAudit } from "@/lib/admin/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function POST(
  req: Request,
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

  const form = await req.formData();
  const meta_title = String(form.get("meta_title") ?? file.post.meta_title).slice(0, 60);
  const meta_description = String(
    form.get("meta_description") ?? file.post.meta_description,
  ).slice(0, 155);
  const keywords = parseKeywords(String(form.get("keywords") ?? ""));
  const content_markdown = String(
    form.get("content_markdown") ?? file.post.content_markdown,
  );

  const word_count = content_markdown.split(/\s+/).filter(Boolean).length;
  const reading_time_minutes = Math.max(1, Math.round(word_count / 200));

  const updated = {
    ...file.post,
    meta_title,
    meta_description,
    keywords,
    content_markdown,
    word_count,
    reading_time_minutes,
    // Editing reverts a rejected post back to pending_review.
    status: "pending_review" as const,
  };
  await upsertPost(file, updated);

  await logAudit({
    ts: new Date().toISOString(),
    slug,
    action: "edit",
    detail: `meta_title len=${meta_title.length}, words=${word_count}, keywords=${keywords.length}`,
  });

  redirect(`/admin/posts/${slug}`);
}
