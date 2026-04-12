import "server-only"
import fs from "fs"
import path from "path"
import type { PipelineStats, Post } from "@/lib/posts"

/**
 * Absolute path to the backend output directory.
 * The Next.js app is at /extracted/ — backend/output sits one level up.
 */
function outputDir(): string {
  return path.resolve(process.cwd(), "..", "backend", "output")
}

/**
 * Read all *.json posts from backend/output, sorted newest-first.
 * Runs at request time on the server — never ships to the browser.
 */
export function getAllPosts(): Post[] {
  const dir = outputDir()
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  const posts: Post[] = []

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8")
      posts.push(JSON.parse(raw))
    } catch {
      // Skip unreadable/malformed files silently
    }
  }

  // Newest first
  return posts.sort(
    (a, b) =>
      new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
  )
}

export function getPostBySlug(slug: string): Post | null {
  return getAllPosts().find((p) => p.slug === slug) ?? null
}

export function computeStats(posts: Post[]): PipelineStats {
  const now = Date.now()
  const week = 7 * 24 * 60 * 60 * 1000

  const postsThisWeek = posts.filter(
    (p) => now - new Date(p.generated_at).getTime() < week
  ).length

  const passed = posts.filter((p) => p.ahpra_passed).length
  const ahpraPassRate =
    posts.length > 0 ? Math.round((passed / posts.length) * 100) : 0

  const avgWordCount =
    posts.length > 0
      ? Math.round(
          posts.reduce((sum, p) => sum + p.word_count, 0) / posts.length
        )
      : 0

  const lastRun = posts[0]?.generated_at ?? null
  const nextRun = lastRun
    ? new Date(new Date(lastRun).getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()
    : null

  // Unique keywords across every post's target_keywords array (case-insensitive)
  const keywordSet = new Set<string>()
  for (const p of posts) {
    for (const kw of p.target_keywords ?? []) {
      keywordSet.add(kw.trim().toLowerCase())
    }
  }

  // Pillars covered: unique pillar values used
  const pillarSet = new Set(posts.map((p) => p.pillar))

  return {
    total_posts: posts.length,
    posts_this_week: postsThisWeek,
    ahpra_pass_rate: ahpraPassRate,
    avg_word_count: avgWordCount,
    keywords_tracked: keywordSet.size,
    pillars_covered: pillarSet.size,
    last_run: lastRun,
    next_run: nextRun,
  }
}
