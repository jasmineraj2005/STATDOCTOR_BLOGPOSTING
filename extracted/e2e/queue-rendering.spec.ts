/**
 * Spec: queue_lists_all_pending_review_articles_with_validator_badges
 *
 * Seeds 3 fresh articles via the ingest API, then navigates to /admin/posts.
 * Asserts all 3 article titles appear in the queue.
 *
 * "Validator badges" in the queue list page (app/admin/posts/page.tsx) are not
 * coloured dot badges — they are text: either "All validators green" or
 * "<N> validator fail(s)". We assert on these text strings per what actually
 * exists in the DOM, not on what might be desired in the future.
 *
 * The seeded article from setup.ts (playwright-locum-sydney) may or may not be
 * in pending_review by the time this spec runs (prior specs may have approved it).
 * We seed 3 *new* articles so the count is predictable. We count only our own
 * titles, not all rows in the queue.
 */

import { test, expect } from "@playwright/test";
import { setAdminCookie, cleanPostPayload } from "./helpers";

test.describe("Queue rendering", () => {
  test(
    "queue_lists_all_pending_review_articles_with_validator_badges",
    async ({ page, context }) => {
      await setAdminCookie(context);

      const ts = Date.now();
      const slugs = [
        `queue-render-a-${ts}`,
        `queue-render-b-${ts}`,
        `queue-render-c-${ts}`,
      ];
      const titles = slugs.map((s, i) => `Queue Render Test ${i + 1} ${s}`);

      // 1. Ingest 3 articles.
      for (let i = 0; i < 3; i++) {
        const slug = slugs[i];
        const payload = cleanPostPayload(slug, {
          title: titles[i],
          meta_title: titles[i].slice(0, 60),
        });

        const resp = await page.request.post("/api/admin/ingest", {
          headers: { Authorization: "Bearer playwright-ingest" },
          data: {
            filename: `20260514_16000${i}_${slug}.json`,
            post: payload,
          },
        });
        expect(resp.status()).toBe(200);
      }

      // 2. Navigate to the queue page.
      await page.goto("/admin/posts");
      await expect(page.locator("h1")).toContainText("Posts review queue");

      // 3. All 3 titles must be visible.
      for (const title of titles) {
        await expect(page.getByText(title)).toBeVisible();
      }

      // 4. Each clean article shows the "All validators green" badge text.
      //    The queue page renders one such span per passing article.
      //    Since all 3 are clean articles (no banned phrases), we expect ≥3 instances.
      const greenBadges = page.getByText("All validators green");
      const count = await greenBadges.count();
      expect(count).toBeGreaterThanOrEqual(3);
    },
  );
});
