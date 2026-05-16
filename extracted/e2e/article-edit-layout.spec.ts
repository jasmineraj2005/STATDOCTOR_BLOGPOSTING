/**
 * article-edit-layout.spec.ts
 *
 * Layout assertions for /admin/posts/[slug]:
 *   1. Page background is white (not black)
 *   2. ArticlePreviewPane is in the viewport (above the fold)
 *   3. Editor <details> is collapsed by default
 */

import { test, expect } from "@playwright/test";
import { setAdminCookie, cleanPostPayload, POSTGRES_URL } from "./helpers";
import { Client } from "pg";

const SLUG = "playwright-article-edit-layout";

async function seedPost(): Promise<void> {
  const c = new Client({ connectionString: POSTGRES_URL });
  await c.connect();
  try {
    const payload = cleanPostPayload(SLUG);
    await c.query(
      `INSERT INTO posts (slug, status, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE
         SET status = EXCLUDED.status,
             data   = EXCLUDED.data`,
      [SLUG, "pending_review", JSON.stringify(payload)],
    );
  } finally {
    await c.end();
  }
}

async function deletePost(): Promise<void> {
  const c = new Client({ connectionString: POSTGRES_URL });
  await c.connect();
  try {
    await c.query("DELETE FROM posts WHERE slug = $1", [SLUG]);
  } finally {
    await c.end();
  }
}

test.describe("Article edit page layout", () => {
  test.beforeAll(async () => {
    await seedPost();
  });

  test.afterAll(async () => {
    await deletePost();
  });

  test("white bg, preview above fold, editor folded by default", async ({
    page,
    context,
  }) => {
    await setAdminCookie(context);
    await page.goto(`/admin/posts/${SLUG}`);

    // ── 1. Body background is white (not black) ────────────────────────────
    const bgColor = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    // Acceptable white values: "rgb(255, 255, 255)" or similar.
    // We reject any obviously dark value by checking that it is NOT "rgb(0, 0, 0)".
    expect(bgColor).not.toBe("rgb(0, 0, 0)");

    // Also assert the main element itself has a white-ish background.
    const mainBg = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main ? getComputedStyle(main).backgroundColor : null;
    });
    // bg-white on main → "rgb(255, 255, 255)"
    expect(mainBg).toBe("rgb(255, 255, 255)");

    // ── 2. Preview pane is visible in the viewport (above the fold) ────────
    const previewPane = page.locator('[data-testid="article-preview-pane"]');
    await expect(previewPane).toBeVisible();
    await expect(previewPane).toBeInViewport();

    // ── 3. Editor <details> is collapsed by default ────────────────────────
    const editorFold = page.locator('details[data-testid="editor-fold"]');
    await expect(editorFold).toBeVisible();
    // When closed, <details> must NOT have an "open" attribute.
    await expect(editorFold).not.toHaveAttribute("open", "");
  });
});
