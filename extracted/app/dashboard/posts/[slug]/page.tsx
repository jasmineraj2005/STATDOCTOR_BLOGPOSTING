import { notFound } from "next/navigation"
import Header from "@/components/header"
import PostDetail from "@/components/post-detail"
import { getPostBySlug, getAllPosts } from "@/lib/posts-server"
import type { Source } from "@/lib/posts"
import type { SourceWithImage, InlineImage } from "@/components/source-image-gallery"

export const dynamic = "force-dynamic"

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function isDataViz(caption: string): boolean {
  return /chart|graph|figure|statistic|data|price|rate|percent|%|index|survey/i.test(caption)
}

function isGuardianUrl(url: string): boolean {
  return url.includes("theguardian.com")
}

function guardianPathFromUrl(url: string): string | null {
  const match = url.match(/theguardian\.com\/(.+)/)
  return match?.[1]?.split("?")[0] ?? null
}

// ── Guardian Content API ───────────────────────────────────────────────────────

async function fetchGuardianMedia(src: Source): Promise<SourceWithImage> {
  const apiKey = process.env.GUARDIAN_API_KEY
  if (!apiKey) return { ...src, imageUrl: null, inlineImages: [] }

  const path = guardianPathFromUrl(src.url)
  if (!path) return { ...src, imageUrl: null, inlineImages: [] }

  try {
    const apiUrl =
      `https://content.guardianapis.com/${path}` +
      `?show-blocks=all&show-fields=thumbnail,main&api-key=${apiKey}`

    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 7200 },
    })
    if (!res.ok) return { ...src, imageUrl: null, inlineImages: [] }

    const data = await res.json()
    const content = data?.response?.content
    if (!content) return { ...src, imageUrl: null, inlineImages: [] }

    // Thumbnail / OG image
    const imageUrl: string | null = content.fields?.thumbnail ?? null

    // Inline images from body blocks
    type Asset = { file: string; typeData?: { width?: number } }
    type Element = {
      type?: string
      assets?: Asset[]
      imageTypeData?: { caption?: string; altText?: string }
    }
    type Block = { elements?: Element[] }

    const bodyBlocks: Block[] = content.blocks?.body ?? []
    const allImages: InlineImage[] = []

    for (const block of bodyBlocks) {
      for (const el of block.elements ?? []) {
        if (el.type !== "image") continue
        const assets = (el.assets ?? []).sort(
          (a, b) => (b.typeData?.width ?? 0) - (a.typeData?.width ?? 0)
        )
        const best = assets[0]
        if (!best?.file) continue
        const rawCaption =
          el.imageTypeData?.caption ?? el.imageTypeData?.altText ?? ""
        allImages.push({ src: best.file, caption: stripHtml(rawCaption) })
      }
    }

    // Data-viz images first, then others; keep up to 4
    const inlineImages = [
      ...allImages.filter((img) => isDataViz(img.caption)),
      ...allImages.filter((img) => !isDataViz(img.caption)),
    ].slice(0, 4)

    return { ...src, imageUrl, inlineImages }
  } catch {
    return { ...src, imageUrl: null, inlineImages: [] }
  }
}

// ── Generic OG scrape (non-Guardian sources) ──────────────────────────────────

async function fetchArticleMedia(src: Source): Promise<SourceWithImage> {
  if (isGuardianUrl(src.url)) return fetchGuardianMedia(src)

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

  // Fetch images for top 6 sources in parallel (Guardian via API, others via OG scrape)
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
