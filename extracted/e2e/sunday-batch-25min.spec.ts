/**
 * sunday-batch-25min.spec.ts
 *
 * Playwright spec: full Sunday review flow with 7 all-validators-green articles.
 * Asserts that the CEO can sign in and ACCEPT all 7 articles within 25 minutes
 * wall-clock (SLA gate) in CI replay mode.
 *
 * Design notes:
 * - Seeds 7 articles via /api/admin/ingest (no real pipeline, deterministic).
 * - Uses admin cookie injection (setAdminCookie) for instant sign-in.
 * - test.use({ video: 'off' }) reduces overhead; animations are skipped by
 *   the Next.js server in test mode (no CSS animations in headless Playwright).
 * - Records wall-clock from navigation to /admin/posts through final article.
 * - 25-minute SLA = 1500 seconds; assertion uses 1_500_000 ms ceiling.
 *
 * CI replay mode: runs against the local dev server seeded by e2e/setup.ts.
 * No real network calls (Resend, GitHub, GSC) are exercised by this spec.
 */

import { test, expect } from "@playwright/test";
import { setAdminCookie, cleanPostPayload, getStatusFromDb } from "./helpers";

// Disable video recording — reduces overhead and speeds up CI replay.
test.use({ video: "off" });

// ── constants ─────────────────────────────────────────────────────────────────

/** 7 unique slugs for this batch — use a timestamp suffix to avoid collisions. */
const BATCH_SIZE = 7;
const RUN_ID = `sunday-${Date.now()}`;
const slugs = Array.from(
  { length: BATCH_SIZE },
  (_, i) => `sunday-batch-${RUN_ID}-article-${i + 1}`,
);

/** 25-minute SLA in milliseconds. */
const SLA_MS = 25 * 60 * 1_000; // 1_500_000 ms

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Seed a single article via the ingest API.
 * cleanPostPayload from helpers.ts produces an article that passes
 * all validators (ahpra_passed=true, word_count=1600, correct callout quota, etc.).
 */
async function seedArticle(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
  index: number,
): Promise<void> {
  const payload = cleanPostPayload(slug, {
    title: `Sunday Batch Article ${index + 1} — ${slug}`,
    meta_title: `Sunday Batch ${index + 1}`.slice(0, 60),
  });
  const resp = await request.post("/api/admin/ingest", {
    headers: { Authorization: "Bearer playwright-ingest" },
    data: {
      filename: `20260518_10${String(index).padStart(4, "0")}_${slug}.json`,
      post: payload,
    },
  });
  if (!resp.ok()) {
    throw new Error(
      `Failed to seed article ${slug}: HTTP ${resp.status()} ${await resp.text()}`,
    );
  }
}

// ── spec ──────────────────────────────────────────────────────────────────────

test.describe("Sunday batch review (25-minute SLA)", () => {
  test(
    "full_seven_article_sunday_flow_under_25_minutes",
    async ({ page, context, request }) => {
      // ── Phase 0: Seed 7 articles ─────────────────────────────────────────
      // Seed sequentially (ingest API is synchronous per-article to avoid
      // DB constraint races from parallel inserts of the same-slug rows).
      for (let i = 0; i < BATCH_SIZE; i++) {
        await seedArticle(request, slugs[i], i);
      }

      // ── Phase 1: Sign in (instant via admin cookie) ──────────────────────
      await setAdminCookie(context);

      // ── Phase 2: Start the clock ─────────────────────────────────────────
      const startMs = Date.now();

      // Navigate to queue page — this is the start of the review session.
      await page.goto("/admin/posts");
      await expect(page.locator("h1")).toContainText(
        /Posts (to review|review queue)/,
      );

      // Wait for the queue to populate (all 7 new articles should appear).
      // We look for at least one of our seeded articles being visible.
      await expect(
        page.getByText("Sunday Batch 1"),
      ).toBeVisible({ timeout: 10_000 });

      // ── Phase 3: Approve all 7 articles ──────────────────────────────────
      let approvedCount = 0;

      for (let i = 0; i < BATCH_SIZE; i++) {
        const slug = slugs[i];

        // Navigate directly to the article review page.
        // This is faster than finding the EDIT link in the queue for each one.
        await page.goto(`/admin/posts/${slug}`);
        await expect(page).toHaveURL(new RegExp(`/admin/posts/${slug}$`), {
          timeout: 10_000,
        });

        // Wait for the page to fully render — the APPROVE button must be enabled.
        const approveButton = page.getByRole("button", {
          name: "APPROVE & PUBLISH",
        });

        // If the approve button is disabled (validators failing), log and skip.
        // This should NOT happen for our cleanPostPayload articles, but we
        // handle it gracefully so the test doesn't hang in CI.
        const isEnabled = await approveButton
          .isEnabled({ timeout: 5_000 })
          .catch(() => false);
        if (!isEnabled) {
          const validatorText = await page
            .locator('[data-testid="validator-panel"]')
            .textContent()
            .catch(() => "validator panel not found");
          console.warn(
            `[sunday-batch] Article ${slug} has disabled approve button. Validators: ${validatorText}`,
          );
          continue;
        }

        // Click APPROVE & PUBLISH.
        await approveButton.click();

        // After approve, we're redirected to /admin/posts.
        await expect(page).toHaveURL(/\/admin\/posts$/, { timeout: 10_000 });

        approvedCount++;
      }

      // ── Phase 4: Measure elapsed time ────────────────────────────────────
      const elapsedMs = Date.now() - startMs;
      const elapsedSeconds = Math.round(elapsedMs / 1000);
      const elapsedMinutes = (elapsedMs / 60_000).toFixed(1);

      console.log(
        `[sunday-batch] Approved ${approvedCount}/${BATCH_SIZE} articles in ${elapsedMinutes} min (${elapsedSeconds}s)`,
      );

      // ── Phase 5: Assertions ───────────────────────────────────────────────

      // SLA: entire flow must complete within 25 minutes.
      // In CI replay mode with no real network calls, this should be < 30 seconds.
      expect(
        elapsedMs,
        `Review session took ${elapsedMinutes} min — exceeds 25-minute SLA`,
      ).toBeLessThan(SLA_MS);

      // Approve rate: must be 7/7 since all articles are validators-green.
      expect(
        approvedCount,
        `Expected all ${BATCH_SIZE} articles approved, got ${approvedCount}`,
      ).toBe(BATCH_SIZE);

      // Verify DB state for each approved article.
      for (const slug of slugs) {
        const status = await getStatusFromDb(slug);
        expect(
          status,
          `Expected ${slug} to be 'scheduled' after approve, got '${status}'`,
        ).toBe("scheduled");
      }
    },
  );

  test("queue_renders_pending_review_articles", async ({ page, context, request }) => {
    // Lighter smoke test: seed 2 articles and verify they appear in the queue.
    const smokeSlug1 = `sunday-smoke-${Date.now()}-1`;
    const smokeSlug2 = `sunday-smoke-${Date.now()}-2`;

    await setAdminCookie(context);

    await seedArticle(request, smokeSlug1, 0);
    await seedArticle(request, smokeSlug2, 1);

    await page.goto("/admin/posts");
    await expect(page.locator("h1")).toContainText(
      /Posts (to review|review queue)/,
    );

    // The queue page should list pending_review articles.
    // At least one of our seeded articles must be visible.
    await expect(page.getByText("Sunday Batch 1")).toBeVisible({
      timeout: 10_000,
    });
  });
});
