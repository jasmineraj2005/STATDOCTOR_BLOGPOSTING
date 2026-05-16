/**
 * Drop-in for ~/website/app/robots.ts
 *
 * Next.js App Router robots convention — this file must be named `robots.ts`
 * and placed at the app root: `~/website/app/robots.ts`
 *
 * Next.js will automatically serve it as /robots.txt.
 *
 * -------------------------------------------------------------------------
 * Policy:
 *   - Allow all crawlers by default (public site, everything indexable).
 *   - Disallow /api/* — API routes are not indexable HTML content and should
 *     not appear in search results. Crawl budget on API routes is wasted.
 *   - Reference the sitemap so Google and Bing pick it up automatically on
 *     first crawl.
 *
 * Note: the sitemap URL must be an absolute URL. Using the environment
 * variable NEXT_PUBLIC_SITE_URL is the cleanest approach — it's already
 * set in the admin dashboard's env and should be set in the website's
 * env too. Fall back to the hardcoded production URL.
 *
 * -------------------------------------------------------------------------
 */

import type { MetadataRoute } from "next";

const SITE_URL =
  process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://statdoctor.app";
// NEXT_PUBLIC_SITE_URL should be set in ~/website/.env.local (or Vercel env vars):
//   NEXT_PUBLIC_SITE_URL=https://statdoctor.app
// The NEXT_PUBLIC_ prefix is required for this to be available at build time
// in Next.js App Router.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          // Disallow all API routes — these are server endpoints, not pages.
          // They return JSON, not HTML, and should not appear in search results.
          // Crawl budget on API routes is wasted.
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    // Next.js renders this as "Sitemap: https://statdoctor.app/sitemap.xml"
    // in the robots.txt output. Google and Bing read this on first crawl.
  };
}
