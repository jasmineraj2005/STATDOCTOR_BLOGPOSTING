/**
 * Shared dispatcher for the heal workflow.
 *
 * Used by:
 *  - POST /api/admin/ingest — auto-fires when an inbound article has red
 *    validators (server-side healing before the queue ever sees it).
 *  - POST /api/posts/[slug]/heal — manual CEO override button.
 *
 * Returns a structured result so the caller can serialise it.
 */
import "server-only";

import type { ValidationResult } from "./validators";

const HEAL_FIXABLE_CHECKS = new Set([
  "word_count",
  "banned_phrases",
  "anchor_text",
  "callout_quota",
]);

export type HealDispatchOutcome =
  | { ok: true; dispatched: true; failures: string[] }
  | { ok: true; dispatched: false; reason: "no_fixable_failures"; failures: string[] }
  | { ok: false; reason: "heal_disabled"; detail: string }
  | { ok: false; reason: "dispatch_failed"; status: number; detail: string };

/** Are any of the post's red validators auto-fixable by the heal workflow? */
export function hasFixableFailures(results: ValidationResult[]): boolean {
  return results.some(
    (r) => r.status === "fail" && HEAL_FIXABLE_CHECKS.has(r.check),
  );
}

/** Fire `workflow_dispatch` on heal.yml with the slug. */
export async function dispatchHealWorkflow(
  slug: string,
  results: ValidationResult[],
): Promise<HealDispatchOutcome> {
  const fixableFailures = results
    .filter((r) => r.status === "fail" && HEAL_FIXABLE_CHECKS.has(r.check))
    .map((r) => r.check);

  if (fixableFailures.length === 0) {
    return {
      ok: true,
      dispatched: false,
      reason: "no_fixable_failures",
      failures: results.filter((r) => r.status === "fail").map((r) => r.check),
    };
  }

  const repo = process.env.HEAL_DISPATCH_REPO;
  const ref = process.env.HEAL_DISPATCH_REF ?? "main";
  const token = process.env.HEAL_DISPATCH_TOKEN;
  if (!repo || !token) {
    return {
      ok: false,
      reason: "heal_disabled",
      detail:
        "HEAL_DISPATCH_REPO + HEAL_DISPATCH_TOKEN env vars not set on Vercel. " +
        "See HANDOVER.md §Heal-Agent.",
    };
  }

  const url = `https://api.github.com/repos/${repo}/actions/workflows/heal.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref, inputs: { slug } }),
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: "dispatch_failed",
      status: res.status,
      detail: await res.text(),
    };
  }

  return { ok: true, dispatched: true, failures: fixableFailures };
}
