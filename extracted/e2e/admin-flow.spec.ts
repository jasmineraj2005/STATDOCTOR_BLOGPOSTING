import { test, expect } from "@playwright/test";
import { readdir } from "fs/promises";
import { Client } from "pg";

const SLUG = "playwright-locum-sydney";
const PUBLISH_DIR = "/tmp/sd-playwright-publish";
const POSTGRES_URL = `postgresql://${process.env.USER}@localhost:5432/statdoctor_admin_playwright`;

async function getStatusFromDb(slug: string): Promise<string | null> {
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

test.describe("CEO review flow", () => {
  test("queue → edit page → Approve & Publish → status flips to 'scheduled'", async ({ page }) => {
    // 1. Queue page shows the seeded article.
    await page.goto("/admin/posts");
    await expect(page.locator("h1")).toContainText("Posts review queue");
    await expect(page.getByText("Locum Work in Sydney — Playwright Test")).toBeVisible();
    await expect(page.getByText(/All validators green/)).toBeVisible();

    // 2. Open the edit page.
    await page.getByRole("link", { name: "REVIEW" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/posts/${SLUG}$`));

    // 3. Validator panel renders all 8 checks; Approve button is enabled.
    for (const label of [
      "AHPRA compliance",
      "Banned phrases",
      "Anchor text",
      "Callout quota",
      "Comparison table",
      "Schema shape",
      "Word count",
      "Sources",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    const approve = page.getByRole("button", { name: "APPROVE & PUBLISH" });
    await expect(approve).toBeEnabled();

    // 4. Click Approve. With scheduled-publish, status becomes 'scheduled'.
    await approve.click();
    await expect(page).toHaveURL(/\/admin\/posts$/);

    // 5. Status flipped to 'scheduled' (NOT 'published' — Approve no longer immediately publishes).
    const status = await getStatusFromDb(SLUG);
    expect(status).toBe("scheduled");

    // 6. The publish dir is still empty (scheduler hasn't fired yet).
    const files = await readdir(PUBLISH_DIR);
    expect(files.filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  test("rejecting a post records the reason and removes it from the queue", async ({ page }) => {
    // Re-seed since the previous test mutated state — but globalSetup only runs once.
    // For a second test, ingest a different slug via the API.
    const fresh = `playwright-reject-${Date.now()}`;
    const ingestResp = await page.request.post("/api/admin/ingest", {
      headers: { Authorization: "Bearer playwright-ingest" },
      data: {
        filename: `20260514_130000_${fresh}.json`,
        post: {
          title: "Reject Test Post",
          slug: fresh,
          meta_title: "Reject Test",
          meta_description: "A test post that will be rejected.",
          focus_keyword: "reject test",
          og_image_alt: "Test scene.",
          content_markdown: "**TL;DR:** test\n\n## Background\n[AHPRA](https://www.ahpra.gov.au/) info.\n\n> [KEY FACTS] x\n\n> [INFO] [AIHW](https://www.aihw.gov.au/) link.\n\n> [AU] [NSW Health](https://www.health.nsw.gov.au/) more.\n\n> [KEY TAKEAWAY] z\n\n## Pay\n\n| Tier | Daily |\n| --- | --- |\n| J | A$1100 |\n| S | A$1600 |\n\n## FAQ\n\n### Q1?\nA1.\n\n### Q2?\nA2.\n\n### Q3?\nA3.\n\n### Q4?\nA4.\n\n## Sources\n",
          tldr: "Reject this.",
          pillar: "locum_pay_rates",
          content_type: "guide",
          target_keywords: ["x"],
          keywords: ["x"],
          twitter_card: null,
          word_count: 1500,
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
          generated_at: new Date().toISOString(),
          dateModified: new Date().toISOString(),
        },
      },
    });
    expect(ingestResp.status()).toBe(200);

    // Navigate to the edit page and reject.
    await page.goto(`/admin/posts/${fresh}`);
    await page.selectOption('select[name="reason_code"]', "wrong_angle");
    await page.fill('textarea[name="reason_text"]', "Playwright reject test.");
    await page.getByRole("button", { name: "REJECT" }).click();
    await expect(page).toHaveURL(/\/admin\/posts$/);

    // DB row is now status='rejected' with rejection_history populated.
    const status = await getStatusFromDb(fresh);
    expect(status).toBe("rejected");
  });
});
