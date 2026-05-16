/**
 * Spec: approve_button_disabled_when_any_validator_fails
 *
 * Seeds an article containing "world-class" in the content_markdown. This
 * phrase matches the AHPRA-banned pattern `\bworld[\s-]?class\b`, causing the
 * "Banned phrases" validator to return status="fail". The APPROVE & PUBLISH
 * button on /admin/posts/<slug> must be disabled when any validator fails.
 *
 * How the button is disabled: the page server-component sets disabled={!approvable}
 * on the button. isApprovable() returns false when any validator has status="fail".
 *
 * Validator UI: a coloured dot + label + detail line. The dot carries a CSS class
 * (bg-red-500 for fail, bg-leaf for pass, bg-electric for warn). There is no
 * aria-label on the dot. We assert on the validator label text ("Banned phrases")
 * being visible and the button being disabled — which is what the DOM gives us.
 */

import { test, expect } from "@playwright/test";
import { setAdminCookie, cleanPostPayload } from "./helpers";

test.describe("Validator gate", () => {
  test(
    "approve_button_disabled_when_any_validator_fails",
    async ({ page, context }) => {
      await setAdminCookie(context);

      // 1. Ingest an article with "world-class" — AHPRA-banned phrase.
      const slug = `validator-gate-${Date.now()}`;
      const payload = cleanPostPayload(slug, {
        content_markdown: [
          "**TL;DR:** world-class locum care.",
          "",
          "## Background",
          "This is world-class content from [AHPRA](https://www.ahpra.gov.au/).",
          "",
          "> [KEY FACTS] Figures from AIHW.",
          "",
          "> [INFO] See [AIHW data](https://www.aihw.gov.au/) for context.",
          "",
          "> [AU] [NSW Health](https://www.health.nsw.gov.au/) sets the floor.",
          "",
          "> [KEY TAKEAWAY] Senior locums earn A$1600/day.",
          "",
          "## Pay",
          "",
          "| Tier | Daily |",
          "| --- | --- |",
          "| Junior | A$1100 |",
          "| Senior | A$1600 |",
          "",
          "## FAQ",
          "### Q1?",
          "A1.",
          "### Q2?",
          "A2.",
          "### Q3?",
          "A3.",
          "### Q4?",
          "A4.",
        ].join("\n"),
        // Override word_count to reflect the actual content.
        word_count: 1500,
      });

      const ingestResp = await page.request.post("/api/admin/ingest", {
        headers: { Authorization: "Bearer playwright-ingest" },
        data: {
          filename: `20260514_140000_${slug}.json`,
          post: payload,
        },
      });
      expect(ingestResp.status()).toBe(200);

      // 2. Navigate to the edit/review page.
      await page.goto(`/admin/posts/${slug}`);
      await expect(page).toHaveURL(new RegExp(`/admin/posts/${slug}$`));

      // 3. The "Banned phrases" validator label must be visible.
      await expect(page.getByText("Banned phrases", { exact: true })).toBeVisible();

      // 4. The validator detail must mention the AHPRA-banned hit.
      //    Validators.ts detail for a banned hit: "AHPRA-banned: <reason>"
      await expect(page.getByText(/AHPRA-banned/)).toBeVisible();

      // 5. The APPROVE & PUBLISH button must be disabled.
      const approve = page.getByRole("button", { name: "APPROVE & PUBLISH" });
      await expect(approve).toBeDisabled();
    },
  );
});
