import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — drives the admin dashboard in a real browser.
 *
 * Prerequisites: local Postgres running, a database created at
 * postgresql://${USER}@localhost:5432/statdoctor_admin_playwright, and the
 * pre-test setup (e2e/setup.ts) seeds an article into pending_review.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // single seeded DB; sequential is safer
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  globalSetup: "./e2e/setup",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Use port 3100 so we don't collide with whatever the user has on :3000.
    command:
      "POSTGRES_URL=postgresql://$USER@localhost:5432/statdoctor_admin_playwright " +
      "INGEST_TOKEN=playwright-ingest " +
      "CRON_SECRET=playwright-cron " +
      "WEBSITE_POSTS_DIR=/tmp/sd-playwright-publish " +
      "PORT=3100 pnpm dev --port 3100",
    // Root route returns 307 (redirect to v0 home or /admin/posts) — Playwright
    // counts redirects as "server up". /api/health would 503 during the brief
    // window after migrate but before any cron has run, blocking the boot.
    url: "http://localhost:3100/",
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
