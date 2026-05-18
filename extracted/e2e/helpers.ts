/**
 * Shared helpers for Sunday-review Playwright specs.
 *
 * Keep this file lean — only extract to helpers when a function is used in 3+
 * spec files. Everything else lives inline in the spec.
 */

import { Client } from "pg";
import type { BrowserContext } from "@playwright/test";

/**
 * Postgres connection for Playwright tests.
 *
 * - In CI the workflow sets POSTGRES_URL=postgresql://postgres:postgres@... so
 *   tests connect with credentials matching the postgres service container.
 * - In local dev there's typically no auth on the laptop's Postgres, so we
 *   build a passwordless URL from $USER.
 */
export const POSTGRES_URL =
  process.env.POSTGRES_URL ??
  `postgresql://${process.env.USER}@localhost:5432/statdoctor_admin_playwright`;

/**
 * The ADMIN_TOKEN value that isAuthorised() (lib/admin/auth.ts) compares the
 * `admin_token` cookie against. Must match whatever the dev server was booted
 * with — in CI that's whatever the workflow env block sets, locally it's the
 * value in extracted/.env.local. Reading from env keeps the two in lock-step.
 */
export const ADMIN_TOKEN =
  process.env.ADMIN_TOKEN ?? "local-dev-statdoctor-blog-2026";

/**
 * Inject the admin_token cookie into a browser context so admin pages pass
 * isAuthorised() without going through the login form.
 * Call this before navigating to any /admin/* page.
 */
export async function setAdminCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "admin_token",
      value: ADMIN_TOKEN,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

export async function getStatusFromDb(slug: string): Promise<string | null> {
  const c = new Client({ connectionString: POSTGRES_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{ status: string }>(
      "SELECT status FROM posts WHERE slug = $1",
      [slug],
    );
    return rows[0]?.status ?? null;
  } finally {
    await c.end();
  }
}

export async function getDataFromDb(
  slug: string,
): Promise<Record<string, unknown> | null> {
  const c = new Client({ connectionString: POSTGRES_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{ data: Record<string, unknown> }>(
      "SELECT data FROM posts WHERE slug = $1",
      [slug],
    );
    return rows[0]?.data ?? null;
  } finally {
    await c.end();
  }
}

/** Minimal clean article payload for ingest — no banned phrases, passes all validators. */
export function cleanPostPayload(slug: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    title: `Test Article ${slug}`,
    slug,
    meta_title: `Test Article ${slug}`.slice(0, 60),
    meta_description: "A clean test article for Playwright specs.",
    focus_keyword: "test article",
    og_image_alt: "Test scene.",
    content_markdown: [
      "**TL;DR:** test",
      "",
      "## Background",
      "[AHPRA](https://www.ahpra.gov.au/) is the entry point.",
      "",
      "> [KEY FACTS] Figures from AIHW.",
      "",
      "> [INFO] See [AIHW data](https://www.aihw.gov.au/) for context.",
      "",
      "> [AU] [NSW Health](https://www.health.nsw.gov.au/) sets the floor.",
      "",
      "> [KEY TAKEAWAY] Senior locums earn A$1600/day.",
      "",
      "## Pay",
      "",
      "| Tier | Daily |",
      "| --- | --- |",
      "| Junior | A$1100 |",
      "| Senior | A$1600 |",
      "",
      "## FAQ",
      "### Q1?",
      "A1.",
      "### Q2?",
      "A2.",
      "### Q3?",
      "A3.",
      "### Q4?",
      "A4.",
    ].join("\n"),
    tldr: "Clean test post.",
    pillar: "locum_pay_rates",
    content_type: "guide",
    target_keywords: ["test"],
    keywords: ["test"],
    twitter_card: null,
    word_count: 1600,
    reading_time_minutes: 8,
    sources: [
      { title: "AHPRA", url: "https://www.ahpra.gov.au/", publisher: "AHPRA", snippet: "" },
      { title: "AIHW", url: "https://www.aihw.gov.au/", publisher: "AIHW", snippet: "" },
      { title: "NSW Health", url: "https://www.health.nsw.gov.au/", publisher: "NSW Health", snippet: "" },
    ],
    image_url: null,
    image_credit: null,
    faq_json_ld: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q1?", acceptedAnswer: { "@type": "Answer", text: "A1" } },
        { "@type": "Question", name: "Q2?", acceptedAnswer: { "@type": "Answer", text: "A2" } },
        { "@type": "Question", name: "Q3?", acceptedAnswer: { "@type": "Answer", text: "A3" } },
        { "@type": "Question", name: "Q4?", acceptedAnswer: { "@type": "Answer", text: "A4" } },
      ],
    },
    medical_webpage_schema: { "@type": "MedicalWebPage" },
    ahpra_flags: [],
    ahpra_passed: true,
    status: "pending_review",
    generated_at: now,
    dateModified: now,
    ...overrides,
  };
}
