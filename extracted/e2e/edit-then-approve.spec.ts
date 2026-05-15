/**
 * Spec: editing_body_before_approve_persists_changes_and_preserves_status_flow
 *
 * Flow:
 *  1. Ingest a fresh article (pending_review).
 *  2. Navigate to /admin/posts/<slug>.
 *  3. Edit the meta_title field in the form.
 *  4. Submit "SAVE EDITS & RE-VALIDATE" — the edit handler (app/api/posts/[slug]/edit)
 *     upserts the post with the new meta_title and redirects to /admin/posts/<slug>.
 *  5. Assert the page shows the new meta_title in the form input.
 *  6. Click "APPROVE & PUBLISH" — the approve handler claims the row and redirects
 *     to /admin/posts.
 *  7. Assert DB row: status = 'scheduled', data.meta_title = new value.
 *
 * Note: The edit handler resets status to 'pending_review' (even if it was already
 * pending_review). The approve handler requires status='pending_review', so this
 * sequence always works regardless of the previous state.
 *
 * Note on draft_original: the schema.sql has no draft_original column. The edit
 * is stored directly in the data JSONB column and the row-level columns. We
 * assert on data.meta_title via a DB query, not on a separate draft_original field.
 */

import { test, expect } from "@playwright/test";
import { getStatusFromDb, getDataFromDb, setAdminCookie, cleanPostPayload } from "./helpers";

test.describe("Edit then approve", () => {
  test(
    "editing_body_before_approve_persists_changes_and_preserves_status_flow",
    async ({ page, context }) => {
      await setAdminCookie(context);

      // 1. Ingest a fresh article.
      const slug = `edit-then-approve-${Date.now()}`;
      const payload = cleanPostPayload(slug);

      const ingestResp = await page.request.post("/api/admin/ingest", {
        headers: { Authorization: "Bearer playwright-ingest" },
        data: {
          filename: `20260514_170000_${slug}.json`,
          post: payload,
        },
      });
      expect(ingestResp.status()).toBe(200);

      // 2. Navigate to the review page.
      await page.goto(`/admin/posts/${slug}`);
      await expect(page).toHaveURL(new RegExp(`/admin/posts/${slug}$`));

      // 3. Edit meta_title.
      const newMetaTitle = `Edited Title For ${slug}`.slice(0, 60);
      await page.fill('input[name="meta_title"]', newMetaTitle);

      // 4. Submit the edit form.
      await page.getByRole("button", { name: "SAVE EDITS & RE-VALIDATE" }).click();

      // After edit, the handler redirects back to /admin/posts/<slug>.
      await expect(page).toHaveURL(new RegExp(`/admin/posts/${slug}$`));

      // 5. The form now shows the updated meta_title.
      await expect(page.locator('input[name="meta_title"]')).toHaveValue(newMetaTitle);

      // 6. All validators must still pass (we didn't introduce any banned phrases).
      const approve = page.getByRole("button", { name: "APPROVE & PUBLISH" });
      await expect(approve).toBeEnabled();

      // 7. Approve.
      await approve.click();
      await expect(page).toHaveURL(/\/admin\/posts$/);

      // 8. DB: status is 'scheduled'.
      const status = await getStatusFromDb(slug);
      expect(status).toBe("scheduled");

      // 9. DB: data.meta_title reflects the edit.
      const data = await getDataFromDb(slug);
      expect(data?.meta_title).toBe(newMetaTitle);
    },
  );
});
