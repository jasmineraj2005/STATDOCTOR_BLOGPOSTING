import { test } from "@playwright/test";

test.describe("Publish failure handling", () => {
  // Blocked: requires the publish adapter + Resend alert wiring (M7).
  // The scheduled-publish cron (app/api/cron/scheduled-publish/route.ts) must
  // write a 'publish-failed' audit event and insert an alerts row when the
  // WEBSITE_POSTS_DIR adapter throws. The UI to surface that failure row in the
  // admin queue is also not yet built.
  test.fixme(
    "publish_fail_marks_row_and_queues_alert",
    async ({ page }) => {
      // Future:
      //  1. Approve an article → status='scheduled'.
      //  2. Trigger /api/cron/scheduled-publish with a misconfigured adapter
      //     (e.g., invalid WEBSITE_POSTS_DIR) so the publish step fails.
      //  3. Assert the posts row has status='publish-failed' (or equivalent).
      //  4. Assert an alerts row was inserted (kind='publish-failed').
      //  5. Assert the daily-digest email (Resend) is queued with the alert.
      void page;
    },
  );
});
