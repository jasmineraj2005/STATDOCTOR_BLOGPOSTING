import { test } from "@playwright/test";

test.describe("Sunday signin (magic link)", () => {
  // Blocked: magic-link auth not yet implemented (current auth = cookie-based ADMIN_TOKEN).
  // Wire up when M4 ships the allowlist-magic-link signin flow.
  test.fixme("magic_link_signin_with_allowlist", async ({ page }) => {
    // Future: navigate to /admin/posts, expect redirect to /signin (or /login),
    // enter anu@statdoctor.net, expect email-sent confirmation screen.
    // Verify that a second email (not in the allowlist) is rejected.
    void page;
  });
});
