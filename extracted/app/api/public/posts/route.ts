import { NextResponse } from "next/server";
import { getAllPosts } from "@/lib/admin/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public read API — list of published posts. Designed to be consumed by the
 * statdoctor.app website (and any other reader) instead of having them read
 * filesystem JSONs.
 *
 *   GET /api/public/posts
 *
 * Response shape:
 *   { posts: Post[], count: number, last_modified: string | null }
 *
 * Cache: 5 minutes at the edge, 1 hour stale-while-revalidate.
 */
export async function GET() {
  const all = await getAllPosts();
  const published = all
    .filter((f) => f.post.status === "published")
    .map((f) => f.post);
  const lastModified =
    published.reduce<string | null>((acc, p) => {
      const m = p.dateModified ?? p.generated_at;
      return acc && acc > m ? acc : m;
    }, null);

  return NextResponse.json(
    { posts: published, count: published.length, last_modified: lastModified },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=300, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
