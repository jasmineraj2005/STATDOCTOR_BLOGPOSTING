/**
 * BDD spec — M1.T9: URL whitelist gate at ingest
 *
 * Exercises the full validation chain:
 *   POST /api/admin/ingest  →  validateSourcesQuick  →  DB row
 *
 * Scenario 1 (REJECT): every source is off-whitelist
 *   → 422 all_sources_invalid, no DB row created.
 *
 * Scenario 2 (PARTIAL): mix of whitelisted + fabricated sources
 *   → 200, bad source dropped, flag written into ahpra_flags in DB,
 *     article stored with status=pending_review and filtered source list.
 */

import { test, expect } from "@playwright/test";
import { POSTGRES_URL, getDataFromDb, getStatusFromDb } from "./helpers";
import { Client } from "pg";

// ---------------------------------------------------------------------------
// DB helper — reads full row including status + data columns
// ---------------------------------------------------------------------------

async function getPostRowFromDb(
  slug: string,
): Promise<{ status: string; data: Record<string, unknown> } | null> {
  const c = new Client({ connectionString: POSTGRES_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{
      status: string;
      data: Record<string, unknown>;
    }>("SELECT status, data FROM posts WHERE slug = $1", [slug]);
    return rows[0] ?? null;
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------
// Payload builder — matches FinalPost shape (Source requires title + snippet)
// ---------------------------------------------------------------------------

type SourceInput = { url: string; publisher: string; title?: string; snippet?: string };

function payload(
  slug: string,
  sources: SourceInput[],
): Record<string, unknown> {
  const now = new Date().toISOString();
  const normalised = sources.map((s) => ({
    title: s.title ?? s.publisher,
    url: s.url,
    publisher: s.publisher,
    snippet: s.snippet ?? "",
  }));
  return {
    filename: `20260516_120000_${slug}.json`,
    post: {
      title: "Test Article",
      slug,
      meta_title: "Test Article",
      meta_description: "A test article for URL-whitelist Playwright spec.",
      focus_keyword: "test",
      og_image_alt: "Test scene.",
      content_markdown: [
        "**TL;DR:** test",
        "",
        "## Background",
        "[AHPRA](https://www.ahpra.gov.au/) info.",
        "",
        "> [KEY FACTS] x",
        "",
        "> [INFO] info.",
        "",
        "> [AU] au.",
        "",
        "> [KEY TAKEAWAY] z",
        "",
        "## Pay",
        "",
        "| Tier | Daily |",
        "| --- | --- |",
        "| J | A$1100 |",
        "| S | A$1600 |",
        "",
        "## FAQ",
        "",
        "### Q1?",
        "A1.",
        "",
        "### Q2?",
        "A2.",
        "",
        "### Q3?",
        "A3.",
        "",
        "### Q4?",
        "A4.",
      ].join("\n"),
      tldr: "Test.",
      pillar: "industry_news",
      content_type: "news",
      target_keywords: ["x"],
      keywords: ["x"],
      twitter_card: null,
      word_count: 1500,
      reading_time_minutes: 8,
      sources: normalised,
      image_url: null,
      image_credit: null,
      faq_json_ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Q1?",
            acceptedAnswer: { "@type": "Answer", text: "A1" },
          },
          {
            "@type": "Question",
            name: "Q2?",
            acceptedAnswer: { "@type": "Answer", text: "A2" },
          },
          {
            "@type": "Question",
            name: "Q3?",
            acceptedAnswer: { "@type": "Answer", text: "A3" },
          },
          {
            "@type": "Question",
            name: "Q4?",
            acceptedAnswer: { "@type": "Answer", text: "A4" },
          },
        ],
      },
      medical_webpage_schema: { "@type": "MedicalWebPage" },
      ahpra_flags: [],
      ahpra_passed: true,
      status: "pending_review",
      generated_at: now,
      dateModified: now,
    },
  };
}

// ---------------------------------------------------------------------------
// BDD scenarios
// ---------------------------------------------------------------------------

test.describe("URL whitelist gate at ingest", () => {
  /**
   * Scenario 1 — all sources off-whitelist.
   *
   * Given an article whose every source URL is fabricated (not in
   * data/url-whitelist.json), When the pipeline POSTs it to /api/admin/ingest,
   * Then the endpoint returns 422 all_sources_invalid and the article is never
   * written to the DB.
   */
  test("rejects an article whose every source is off-whitelist", async ({
    request,
  }) => {
    const slug = `playwright-whitelist-reject-${Date.now()}`;

    // Three URLs that do not appear in data/url-whitelist.json.
    // made-up-domain.example.com, another-fake.io, and doh.gov.au are all absent.
    const allBad: SourceInput[] = [
      { url: "https://made-up-domain.example.com/a", publisher: "Fake1" },
      { url: "https://another-fake.io/b", publisher: "Fake2" },
      { url: "https://www.doh.gov.au/reports/x", publisher: "Fake3" },
    ];

    const res = await request.post("/api/admin/ingest", {
      headers: { Authorization: "Bearer playwright-ingest" },
      data: payload(slug, allBad),
    });

    // Gate must reject with 422 and error=all_sources_invalid.
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("all_sources_invalid");
    expect(Array.isArray(body.flags)).toBe(true);
    expect((body.flags as unknown[]).length).toBeGreaterThanOrEqual(1);

    // No DB row must exist — the article never entered the review queue.
    const row = await getPostRowFromDb(slug);
    expect(row).toBeNull();
  });

  /**
   * Scenario 2 — partial whitelist (good + bad sources mixed).
   *
   * Given an article with two whitelisted sources (theguardian.com, aihw.gov.au)
   * and one fabricated source, When the pipeline POSTs it to /api/admin/ingest,
   * Then the endpoint returns 200 with dropped=1, the article is written to DB
   * with status=pending_review, only the 2 good sources are stored, and
   * ahpra_flags contains at least one flag with flag_type=source_not_in_whitelist.
   */
  test("drops bad sources, flags them, ingests the article when at least one source is valid", async ({
    request,
  }) => {
    const slug = `playwright-whitelist-partial-${Date.now()}`;

    // Two whitelisted sources + one fabricated URL.
    const mixed: SourceInput[] = [
      {
        url: "https://theguardian.com/au-news/article",
        publisher: "Guardian",
        title: "Guardian Article",
      },
      {
        url: "https://www.aihw.gov.au/reports/x",
        publisher: "AIHW",
        title: "AIHW Report",
      },
      {
        url: "https://made-up-domain.example.com/bad",
        publisher: "Fake",
        title: "Fake Source",
      },
    ];

    const res = await request.post("/api/admin/ingest", {
      headers: { Authorization: "Bearer playwright-ingest" },
      data: payload(slug, mixed),
    });

    // Gate must accept the request and report one dropped source.
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dropped).toBe(1);

    // Article must exist in the DB.
    const row = await getPostRowFromDb(slug);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending_review");

    // Only the 2 good sources should be stored.
    const storedSources = (row!.data.sources ?? []) as Array<{
      url: string;
    }>;
    expect(storedSources).toHaveLength(2);
    const storedUrls = storedSources.map((s) => s.url);
    expect(storedUrls).toContain("https://theguardian.com/au-news/article");
    expect(storedUrls).toContain("https://www.aihw.gov.au/reports/x");
    expect(storedUrls).not.toContain(
      "https://made-up-domain.example.com/bad",
    );

    // ahpra_flags must contain a source_not_in_whitelist flag for the dropped URL.
    const flags = (row!.data.ahpra_flags ?? []) as Array<{
      flag_type: string;
      excerpt?: string;
    }>;
    expect(flags.length).toBeGreaterThanOrEqual(1);
    const whitelistFlag = flags.find(
      (f) => f.flag_type === "source_not_in_whitelist",
    );
    expect(whitelistFlag).toBeDefined();
  });
});
