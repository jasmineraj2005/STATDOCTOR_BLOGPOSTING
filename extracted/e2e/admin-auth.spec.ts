/**
 * Spec: dashboard_redirects_unauthed_to_signin
 *
 * lib/admin/auth.ts isAuthorised():
 *  - If ADMIN_TOKEN env is unset → returns true (permissive, local-dev default).
 *  - If ADMIN_TOKEN env IS set → compares cookie `admin_token` to the env value.
 *    Mismatch or missing cookie → returns false → redirect("/login").
 *
 * The .env.local sets ADMIN_TOKEN=local-dev-statdoctor-blog-2026, so the gate
 * IS active on the test server. This spec verifies:
 *
 *  1. Without the admin_token cookie → GET /admin/posts → redirects to /login.
 *  2. With the correct admin_token cookie → GET /admin/posts → renders the queue.
 *
 * Cookie injection: Playwright context.addCookies() lets us set the cookie before
 * navigating, without needing an API endpoint that issues it.
 */

import { test, expect } from "@playwright/test";
import { setAdminCookie } from "./helpers";

test.describe("Admin auth gate", () => {
  test("dashboard_redirects_unauthed_to_signin", async ({ page }) => {
    // No cookie set — browser context starts clean.
    await page.goto("/admin/posts");

    // isAuthorised() returns false → redirect("/login") → Next.js renders /login.
    await expect(page).toHaveURL(/\/login/);
    // The login page has h1 "Welcome back".
    await expect(page.locator("h1")).toContainText("Welcome back");
  });

  test(
    "dashboard_accessible_with_correct_admin_token_cookie",
    async ({ page, context }) => {
      // Inject the correct cookie.
      await setAdminCookie(context);
      await page.goto("/admin/posts");
      // Should render the queue, not redirect to /login.
      await expect(page).toHaveURL(/\/admin\/posts/);
      await expect(page.locator("h1")).toContainText("Posts review queue");
    },
  );
});
