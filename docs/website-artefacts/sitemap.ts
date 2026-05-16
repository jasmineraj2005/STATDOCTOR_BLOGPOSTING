/**
 * Drop-in for ~/website/app/sitemap.ts
 *
 * Next.js App Router sitemap convention — this file must be named `sitemap.ts`
 * and placed at the app root: `~/website/app/sitemap.ts`
 *
 * Next.js will automatically serve it as /sitemap.xml.
 *
 * -------------------------------------------------------------------------
 * Data source:
 *   Posts are fetched from the admin dashboard's public API:
 *   https://statdoctor-blogposting.vercel.app/api/public/posts
 *
 *   This endpoint returns only status='published' posts, sorted by dateModified
 *   descending. It requires no authentication.
 *
 * Revalidation:
 *   The sitemap is revalidated every 24 hours via Next.js ISR. New articles
 *   published via the approval pipeline will appear in the sitemap within 24h.
 *   If you need faster pickup, call `revalidatePath('/sitemap.xml')` from
 *   the website's revalidation webhook (already planned in ARCHITECTURE_101X.md).
 *
 * Priorities (judgment calls):
 *   / (homepage)                    — 1.0  (most important)
 *   /blog                           — 0.9  (high-traffic index)
 *   /about/dr-anu-ganugapati        — 0.8  (author E-E-A-T page)
 *   /blog/[slug] (guides)           — 0.7  (evergreen content)
 *   /blog/[slug] (news)             — 0.6  (time-sensitive, decays)
 *   /blog/[slug] (company)          — 0.5  (promotional, lower ranking priority)
 *
 * changeFrequency (judgment calls):
 *   /                               — "weekly"   (product changes regularly)
 *   /blog                           — "daily"    (new posts arrive Mon/Wed/Fri/Sat)
 *   /about/dr-anu-ganugapati        — "monthly"  (bio changes rarely)
 *   /blog/[slug] guide              — "monthly"  (evergreen, refreshed quarterly)
 *   /blog/[slug] news               — "weekly"   (may get updated as story develops)
 *   /blog/[slug] company            — "monthly"
 *
 * -------------------------------------------------------------------------
 */

import type { MetadataRoute } from "next";

// ---------------------------------------------------------------------------
// Types — adapt to match the website repo's actual Post type
// ---------------------------------------------------------------------------

// the website repo will import Post from its own types — adapt as needed.
// This inline type matches the shape returned by /api/public/posts.
interface PublicPost {
  slug: string;
  dateModified: string; // ISO 8601 date string, e.g. "2026-04-11"
  content_type: "news" | "guide" | "company";
}

interface PublicPostsResponse {
  posts: PublicPost[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SITE_URL = "https://statdoctor.app";

// The STATDOCTOR_BLOGPOSTING admin dashboard's public posts API.
// This is the single source of truth for published posts.
const PUBLIC_POSTS_API =
  "https://statdoctor-blogposting.vercel.app/api/public/posts";

// ISR revalidation period for the sitemap (seconds).
// 86400 = 24 hours.
export const revalidate = 86400;

// ---------------------------------------------------------------------------
// Priority and changeFrequency helpers
// ---------------------------------------------------------------------------

function getPostPriority(contentType: PublicPost["content_type"]): number {
  switch (contentType) {
    case "guide":
      return 0.7;
    case "news":
      return 0.6;
    case "company":
      return 0.5;
    default:
      return 0.6;
  }
}

function getPostChangeFrequency(
  contentType: PublicPost["content_type"]
): MetadataRoute.Sitemap[number]["changeFrequency"] {
  switch (contentType) {
    case "guide":
      return "monthly";
    case "news":
      return "weekly";
    case "company":
      return "monthly";
    default:
      return "monthly";
  }
}

// ---------------------------------------------------------------------------
// Static routes
// ---------------------------------------------------------------------------

const staticRoutes: MetadataRoute.Sitemap = [
  {
    url: `${SITE_URL}/`,
    lastModified: new Date().toISOString(),
    changeFrequency: "weekly",
    priority: 1.0,
  },
  {
    url: `${SITE_URL}/blog`,
    lastModified: new Date().toISOString(),
    changeFrequency: "daily",
    priority: 0.9,
  },
  {
    url: `${SITE_URL}/about/dr-anu-ganugapati`,
    lastModified: new Date().toISOString(),
    changeFrequency: "monthly",
    priority: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Sitemap generator
// ---------------------------------------------------------------------------

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let dynamicRoutes: MetadataRoute.Sitemap = [];

  try {
    const response = await fetch(PUBLIC_POSTS_API, {
      // Use Next.js fetch cache — revalidate matches the ISR period above.
      next: { revalidate },
    });

    if (!response.ok) {
      console.error(
        `[sitemap] Failed to fetch posts: ${response.status} ${response.statusText}`
      );
      // Return static routes only — don't break the sitemap if the API is down.
      return staticRoutes;
    }

    const data = (await response.json()) as PublicPostsResponse;
    const posts = data.posts ?? [];

    dynamicRoutes = posts.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: post.dateModified,
      changeFrequency: getPostChangeFrequency(post.content_type),
      priority: getPostPriority(post.content_type),
    }));
  } catch (error) {
    console.error("[sitemap] Error fetching posts:", error);
    // Graceful degradation — return static routes only.
    return staticRoutes;
  }

  return [...staticRoutes, ...dynamicRoutes];
}
