/**
 * Spec: concurrent_approve_returns_409_for_second_call
 *
 * Seeds one fresh article via the ingest API, then fires two POST requests to
 * /api/posts/<slug>/approve simultaneously using Promise.all. The approve route
 * uses claimForApproval() — a single SQL UPDATE … WHERE status='pending_review'
 * RETURNING — which is atomic at the Postgres row level. Only one caller gets
 * the row back; the other gets null and returns 409.
 *
 * Expected result: exactly one response is a success (303 redirect or 200), and
 * exactly one is 409.
 *
 * Implementation note: page.request sends cookies set on the page context, so
 * the admin_token cookie is already present. We use page.request (not
 * page.evaluate/fetch) because page.request correctly handles the same-origin
 * cookie jar and follows redirects. We fire two APIResponse promises in parallel.
 *
 * Redirect handling: page.request follows redirects by default, so a 303 arrives
 * as 200. We accept 200 OR 303 as "success".
 */

import { test, expect } from "@playwright/test";
import { getStatusFromDb, setAdminCookie, cleanPostPayload } from "./helpers";

test.describe("Concurrent approve", () => {
  test("concurrent_approve_returns_409_for_second_call", async ({ page, context }) => {
    await setAdminCookie(context);

    // 1. Seed a fresh article in pending_review status.
    const slug = `concurrent-approve-${Date.now()}`;
    const payload = cleanPostPayload(slug);

    const ingestResp = await page.request.post("/api/admin/ingest", {
      headers: { Authorization: "Bearer playwright-ingest" },
      data: {
        filename: `20260514_150000_${slug}.json`,
        post: payload,
      },
    });
    expect(ingestResp.status()).toBe(200);

    // 2. Fire two approve requests concurrently via page.request.
    //    page.request inherits the browser context cookies (admin_token included).
    const [r1, r2] = await Promise.all([
      page.request.post(`/api/posts/${slug}/approve`),
      page.request.post(`/api/posts/${slug}/approve`),
    ]);

    const status1 = r1.status();
    const status2 = r2.status();
    const statuses = [status1, status2];

    // 3. DB must be 'scheduled' — exactly one approve went through.
    const dbStatus = await getStatusFromDb(slug);
    expect(dbStatus).toBe("scheduled");

    // 4. One response is success (page.request follows 303 → 200), one is 409.
    const successStatuses = [200, 201, 303, 307, 308];
    const successCount = statuses.filter((s) => successStatuses.includes(s)).length;
    const conflictCount = statuses.filter((s) => s === 409).length;

    expect(successCount).toBeGreaterThanOrEqual(1);
    expect(conflictCount).toBeGreaterThanOrEqual(1);
    expect(successCount + conflictCount).toBe(2);
  });
});
