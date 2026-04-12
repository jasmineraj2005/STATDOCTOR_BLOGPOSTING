/**
 * Shared types + client-safe helpers.
 * Server-only file I/O lives in lib/posts-server.ts — do not import fs here.
 */

export type AHPRAFlag = {
  flag_type: string
  excerpt: string
  fix_applied: string
  requires_human_review: boolean
}

export type Source = {
  title: string
  url: string
  publisher: string
  snippet: string
}

export type Post = {
  title: string
  slug: string
  meta_title: string
  meta_description: string
  focus_keyword: string
  og_image_alt: string
  content_markdown: string
  tldr: string
  pillar: string
  target_keywords: string[]
  word_count: number
  reading_time_minutes: number
  sources: Source[]
  image_url: string | null
  image_credit: string | null
  faq_json_ld: Record<string, unknown>
  medical_webpage_schema: Record<string, unknown>
  ahpra_flags: AHPRAFlag[]
  ahpra_passed: boolean
  generated_at: string
}

export type PipelineStats = {
  total_posts: number
  posts_this_week: number
  ahpra_pass_rate: number  // 0–100
  avg_word_count: number
  keywords_tracked: number  // unique target keywords across all posts
  pillars_covered: number   // how many of the 6 pillars have ≥1 post
  last_run: string | null
  next_run: string | null
}

export const PILLAR_LABELS: Record<string, string> = {
  locum_pay_rates: "Locum Pay & Rates",
  how_to_locum: "Getting Started",
  locum_by_location: "Locum by Location",
  industry_news: "Industry News",
  locum_vs_agency: "Marketplace vs Agency",
  doctor_wellbeing: "Doctor Wellbeing",
}

/**
 * Format a timestamp as "2h ago" / "3d ago" / "just now".
 */
export function timeAgo(iso: string | null): string {
  if (!iso) return "never"
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Format a timestamp as "in 2d" / "in 5h".
 */
export function timeUntil(iso: string | null): string {
  if (!iso) return "—"
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return "overdue"
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `in ${hours}h`
  const days = Math.floor(hours / 24)
  return `in ${days}d`
}
