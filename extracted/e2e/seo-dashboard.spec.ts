import { test } from "@playwright/test";

test.describe("SEO dashboard", () => {
  // Blocked: Google Search Console and Bing Webmaster Tools API credentials
  // not yet wired up (M3 — GSC/Bing data pipeline). The gsc_daily_snapshot and
  // bing_daily_snapshot tables exist in the schema but the snapshot cron
  // (app/api/cron/seo-snapshot) has no credentials in the test environment, so
  // there is no data to assert on.
  test.fixme(
    "admin_seo_shows_non_empty_data_after_snapshot",
    async ({ page }) => {
      // Future:
      //  1. Seed gsc_daily_snapshot with mock rows (or trigger the snapshot
      //     cron with test credentials).
      //  2. Navigate to /admin/seo.
      //  3. Assert ≥1 keyword row is visible with clicks/impressions values.
      //  4. Assert the sparkline chart is rendered (via canvas or SVG element).
      void page;
    },
  );
});
