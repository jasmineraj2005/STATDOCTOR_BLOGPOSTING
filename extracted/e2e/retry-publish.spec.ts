import { test } from "@playwright/test";

test.describe("Retry publish", () => {
  // Blocked: retry-publish button and adapter not yet built (M7).
  // The queue UI currently has no "RETRY" action for publish-failed rows.
  // Wire up once M7 ships the retry-publish API endpoint and queue-row button.
  test.fixme(
    "retry_publish_re_runs_adapter_and_clears_failure",
    async ({ page }) => {
      // Future:
      //  1. Put an article into publish-failed state (see publish-fail.spec.ts).
      //  2. Fix the adapter config (e.g., restore a valid WEBSITE_POSTS_DIR).
      //  3. Click the RETRY button on the queue row.
      //  4. Assert the file appears in WEBSITE_POSTS_DIR.
      //  5. Assert the DB row status flips to 'published'.
      //  6. Assert the alerts row is acknowledged.
      void page;
    },
  );
});
