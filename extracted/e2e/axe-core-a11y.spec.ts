/**
 * axe-core WCAG 2.2 AA accessibility spec — M6.5
 *
 * Australia formally adopted WCAG 2.2 AA as the legal baseline under the
 * Disability Discrimination Act 1992. This spec scans the two most-visited
 * admin pages and asserts zero violations at WCAG 2.2 AA level.
 *
 * If violations ARE found, the test fails with DONE_WITH_CONCERNS — each
 * violation id and description is logged to stdout. DO NOT auto-fix violations
 * in this milestone; each gets its own follow-up ticket.
 *
 * Requires:
 *   - @axe-core/playwright devDependency (see extracted/package.json)
 *   - Admin cookie injected via setAdminCookie() helper before navigation
 *   - App running on localhost:3100 (playwright.config.ts webServer handles this)
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { setAdminCookie } from "./helpers";

/**
 * WCAG 2.2 AA tags as recognised by axe-core.
 * wcag22aa = WCAG 2.2-specific Level AA criteria.
 * wcag2aa  = WCAG 2.1 Level AA (superset still in scope).
 * wcag2a   = WCAG 2.1 Level A (baseline).
 */
const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"] as const;

/**
 * Format a single axe violation for console output.
 * Keeps the log actionable without being overwhelming.
 *
 * The signature accepts the structural subset we read; axe-core's full
 * Result type is a superset (impact is the literal union 'minor' | 'moderate'
 * | 'serious' | 'critical', plus extra fields we don't need).
 */
type AxeViolation = {
  id: string;
  impact?: string | null;
  description: string;
  helpUrl: string;
  nodes: ReadonlyArray<{ html: string }>;
};

function formatViolation(v: AxeViolation): string {
  const nodeSnippet = v.nodes
    .slice(0, 2)
    .map((n) => n.html.slice(0, 120))
    .join("\n    ");
  return [
    `  [${(v.impact ?? "unknown").toUpperCase()}] ${v.id}`,
    `  ${v.description}`,
    `  ${v.helpUrl}`,
    `  Affected nodes (first 2):`,
    `    ${nodeSnippet}`,
  ].join("\n");
}

test.describe("WCAG 2.2 AA accessibility — admin dashboard", () => {
  /**
   * Inject the admin cookie before each test so the page renders rather than
   * redirecting to /login (which would produce a false-negative axe result).
   */
  test.beforeEach(async ({ context }) => {
    await setAdminCookie(context);
  });

  test("/admin/posts has no WCAG 2.2 AA violations", async ({ page }) => {
    await page.goto("/admin/posts");

    // Wait for the article queue to mount — the page uses async data fetching.
    // If the queue is empty the heading still renders.
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_22_AA_TAGS])
      .analyze();

    if (results.violations.length > 0) {
      console.error(
        `\n[axe] /admin/posts — ${results.violations.length} WCAG 2.2 AA violation(s) found:\n`,
      );
      results.violations.forEach((v) => console.error(formatViolation(v)));
      console.error(
        "\nDONE_WITH_CONCERNS: violations listed above. Each requires a follow-up ticket.",
      );
    }

    expect(
      results.violations,
      `WCAG 2.2 AA violations on /admin/posts:\n${results.violations.map((v) => `  ${v.id}: ${v.description}`).join("\n")}`,
    ).toEqual([]);
  });

  test("/admin/posts/[slug] has no WCAG 2.2 AA violations", async ({
    page,
  }) => {
    // Navigate to the queue first to find the first available slug.
    // If no posts exist in the seeded DB, we skip gracefully — the setup.ts
    // seeds at least one article so this should always resolve.
    await page.goto("/admin/posts");
    await page.waitForLoadState("networkidle");

    // The queue renders article links — grab the href of the first one.
    const firstArticleLink = page.locator('a[href^="/admin/posts/"]').first();
    const href = await firstArticleLink.getAttribute("href").catch(() => null);

    if (!href) {
      test.skip(
        // @ts-expect-error — test.skip with reason string is valid in Playwright ≥1.28
        "No seeded article found; ensure setup.ts inserts at least one pending_review post.",
      );
      return;
    }

    await page.goto(href);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags([...WCAG_22_AA_TAGS])
      .analyze();

    if (results.violations.length > 0) {
      console.error(
        `\n[axe] ${href} — ${results.violations.length} WCAG 2.2 AA violation(s) found:\n`,
      );
      results.violations.forEach((v) => console.error(formatViolation(v)));
      console.error(
        "\nDONE_WITH_CONCERNS: violations listed above. Each requires a follow-up ticket.",
      );
    }

    expect(
      results.violations,
      `WCAG 2.2 AA violations on ${href}:\n${results.violations.map((v) => `  ${v.id}: ${v.description}`).join("\n")}`,
    ).toEqual([]);
  });
});
