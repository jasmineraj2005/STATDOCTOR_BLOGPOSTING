import { test } from "@playwright/test";

test.describe("Sunday batch review (25-minute SLA)", () => {
  // Blocked: requires magic-link auth (M4) so the CEO can sign in via email
  // and the 25-minute timer starts from a cold-boot signin flow.
  // Also requires a realistic batch of 7 generated articles seeded by the pipeline.
  test.fixme(
    "full_seven_article_sunday_flow_under_25_minutes",
    async ({ page }) => {
      // Future:
      //  1. Signin via magic-link (M4).
      //  2. Seed 7 articles via the pipeline or the ingest API.
      //  3. Time the full approve/reject cycle through all 7 articles.
      //  4. Assert total elapsed time < 25 minutes (1500 s).
      //  5. Assert ≥5 articles are approved (≥95% target).
      void page;
    },
  );
});
