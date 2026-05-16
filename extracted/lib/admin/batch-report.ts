/**
 * batch-report.ts — pure function: AuditEvent[] → BatchReport
 *
 * Computes the Sunday review batch report from a window of audit events.
 * No I/O — all DB + time concerns belong to the caller.
 */

import type { AuditEvent } from "./audit";

export type BatchReport = {
  /** Number of articles where the final decision was "approve". */
  approved: number;
  /** Number of articles that were edited at least once before approval (or edited without final approval). */
  edited: number;
  /** Number of articles where the final decision was "reject". */
  rejected: number;
  /** Total wall-clock duration from the first to last event in the window, in seconds. */
  durationSeconds: number;
  /**
   * Approve-as-is rate = approves_without_prior_edit / total_decisions.
   * "total_decisions" = articles that received a final approve or reject.
   * Returns 0 if there are no decisions.
   */
  approveAsIsRate: number;
  /** ISO timestamp of the first event in the window, or null if no events. */
  windowStart: string | null;
  /** ISO timestamp of the last event in the window, or null if no events. */
  windowEnd: string | null;
  /** Per-article one-liner strings for email body. */
  articleLines: string[];
};

/**
 * computeBatchReport
 *
 * Given an array of AuditEvents from a single review window, compute the
 * Sunday batch report metrics.
 *
 * Rules:
 * - "approve" action → the final decision for that slug is "approved"
 * - "reject" action → the final decision for that slug is "rejected"
 * - "edit" action → that slug was edited (may or may not have a final decision)
 * - An article that was edited THEN approved counts as: edited=true, approved=true
 * - An article that was approved WITHOUT any prior edit: contributes to approveAsIsRate numerator
 * - durationSeconds: time from earliest event to latest event in the window
 * - approveAsIsRate: pure_approves / (approved + rejected), 0 if no decisions
 */
export function computeBatchReport(events: AuditEvent[]): BatchReport {
  if (events.length === 0) {
    return {
      approved: 0,
      edited: 0,
      rejected: 0,
      durationSeconds: 0,
      approveAsIsRate: 0,
      windowStart: null,
      windowEnd: null,
      articleLines: [],
    };
  }

  // Sort events by timestamp ascending
  const sorted = [...events].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );

  const windowStart = sorted[0].ts;
  const windowEnd = sorted[sorted.length - 1].ts;
  const durationSeconds = Math.round(
    (new Date(windowEnd).getTime() - new Date(windowStart).getTime()) / 1000,
  );

  // Group events by slug, preserving order
  const bySlug = new Map<string, AuditEvent[]>();
  for (const ev of sorted) {
    if (!bySlug.has(ev.slug)) bySlug.set(ev.slug, []);
    bySlug.get(ev.slug)!.push(ev);
  }

  let approved = 0;
  let edited = 0;
  let rejected = 0;
  let pureApproves = 0; // approves with no prior edit for that slug
  const articleLines: string[] = [];

  for (const [slug, slugEvents] of bySlug) {
    const hadEdit = slugEvents.some((e) => e.action === "edit");
    const finalApprove = slugEvents.findLast?.((e) => e.action === "approve") ??
      [...slugEvents].reverse().find((e) => e.action === "approve");
    const finalReject = slugEvents.findLast?.((e) => e.action === "reject") ??
      [...slugEvents].reverse().find((e) => e.action === "reject");

    // Determine final decision: whichever of approve/reject came last
    let decision: "approved" | "rejected" | "none" = "none";
    if (finalApprove && finalReject) {
      decision =
        new Date(finalApprove.ts).getTime() >=
        new Date(finalReject.ts).getTime()
          ? "approved"
          : "rejected";
    } else if (finalApprove) {
      decision = "approved";
    } else if (finalReject) {
      decision = "rejected";
    }

    if (decision === "approved") {
      approved++;
      if (!hadEdit) {
        pureApproves++;
      }
    }
    if (decision === "rejected") {
      rejected++;
    }
    if (hadEdit) {
      edited++;
    }

    // Build per-article one-liner
    const parts: string[] = [slug];
    if (hadEdit) parts.push("edited");
    if (decision !== "none") parts.push(decision);
    else parts.push("no-decision");
    if (finalReject?.reason_code) parts.push(`[${finalReject.reason_code}]`);
    articleLines.push(parts.join(" · "));
  }

  const totalDecisions = approved + rejected;
  const approveAsIsRate =
    totalDecisions === 0 ? 0 : pureApproves / totalDecisions;

  return {
    approved,
    edited,
    rejected,
    durationSeconds,
    approveAsIsRate,
    windowStart,
    windowEnd,
    articleLines,
  };
}
