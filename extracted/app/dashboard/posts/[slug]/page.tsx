import { notFound } from "next/navigation"
import Header from "@/components/header"
import PostDetail from "@/components/post-detail"
import { getPostBySlug, getAllPosts } from "@/lib/posts-server"
import type { Source } from "@/lib/posts"
import type { SourceWithImage } from "@/components/source-image-gallery"

export const dynamic = "force-dynamic"

// ── OG image scrape for all sources ──────────────────────────────────────────

async function fetchArticleMedia(src: Source): Promise<SourceWithImage> {
  try {
    const res = await fetch(src.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; StatDoctorBot/1.0; +https://statdoctor.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 7200 },
    })
    if (!res.ok) return { ...src, imageUrl: null, inlineImages: [] }
    const html = await res.text()

    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    const imageUrl = ogMatch?.[1] ?? null

    return { ...src, imageUrl, inlineImages: [] }
  } catch {
    return { ...src, imageUrl: null, inlineImages: [] }
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getPostBySlug(slug)
  if (!post) notFound()

  const allPosts = getAllPosts()
  const relatedPosts = allPosts.filter((p) => p.slug !== slug).slice(0, 3)

  const topSources: Source[] = post.sources.slice(0, 6)
  const sourceImages: SourceWithImage[] = await Promise.all(
    topSources.map((src) => fetchArticleMedia(src))
  )

  return (
    <div className="min-h-screen bg-white" id="top">
      <Header light />
      <PostDetail post={post} relatedPosts={relatedPosts} sourceImages={sourceImages} />
    </div>
  )
}
