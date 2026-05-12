import { NextResponse } from "next/server";
import { getPostBySlug } from "@/lib/admin/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public read API — single post by slug. Only returns posts with
 * status === "published". 404 otherwise.
 *
 *   GET /api/public/posts/{slug}
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const file = await getPostBySlug(slug);
  if (!file || file.post.status !== "published") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(file.post, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
