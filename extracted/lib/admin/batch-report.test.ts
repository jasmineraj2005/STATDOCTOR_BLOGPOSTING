import { describe, it, expect } from "vitest";
import type { AuditEvent } from "./audit";
import { computeBatchReport } from "./batch-report";

// ── helpers ───────────────────────────────────────────────────────────────────

function ev(
  slug: string,
  action: AuditEvent["action"],
  ts: string,
  extras: Partial<AuditEvent> = {},
): AuditEvent {
  return { ts, slug, action, ...extras };
}

// ── D1 tests ──────────────────────────────────────────────────────────────────

describe("computeBatchReport", () => {
  it("returns zeros for an empty event array", () => {
    const report = computeBatchReport([]);
    expect(report.approved).toBe(0);
    expect(report.edited).toBe(0);
    expect(report.rejected).toBe(0);
    expect(report.durationSeconds).toBe(0);
    expect(report.approveAsIsRate).toBe(0);
    expect(report.windowStart).toBeNull();
    expect(report.windowEnd).toBeNull();
    expect(report.articleLines).toEqual([]);
  });

  it("counts a single approve-without-edit as approved, not edited, rate=1", () => {
    const events: AuditEvent[] = [
      ev("article-1", "approve", "2026-05-18T10:00:00Z"),
    ];
    const report = computeBatchReport(events);
    expect(report.approved).toBe(1);
    expect(report.edited).toBe(0);
    expect(report.rejected).toBe(0);
    expect(report.approveAsIsRate).toBe(1);
  });

  it("counts a single rejection as rejected, rate=0", () => {
    const events: AuditEvent[] = [
      ev("article-1", "reject", "2026-05-18T10:00:00Z", {
        reason_code: "off_brand_voice",
      }),
    ];
    const report = computeBatchReport(events);
    expect(report.rejected).toBe(1);
    expect(report.approved).toBe(0);
    expect(report.approveAsIsRate).toBe(0);
  });

  it("handles mixed events: 3 approve-as-is, 1 edit+approve, 1 reject", () => {
    const events: AuditEvent[] = [
      // slug-a: approved without edit
      ev("slug-a", "approve", "2026-05-18T10:00:00Z"),
      // slug-b: edited then approved
      ev("slug-b", "edit", "2026-05-18T10:05:00Z"),
      ev("slug-b", "approve", "2026-05-18T10:10:00Z"),
      // slug-c: approved without edit
      ev("slug-c", "approve", "2026-05-18T10:15:00Z"),
      // slug-d: rejected
      ev("slug-d", "reject", "2026-05-18T10:20:00Z", {
        reason_code: "weak_sources",
      }),
      // slug-e: approved without edit
      ev("slug-e", "approve", "2026-05-18T10:25:00Z"),
    ];
    const report = computeBatchReport(events);
    expect(report.approved).toBe(4); // slug-a, slug-b, slug-c, slug-e
    expect(report.edited).toBe(1); // slug-b
    expect(report.rejected).toBe(1); // slug-d
    // pure approves: slug-a, slug-c, slug-e = 3 out of 5 total decisions
    expect(report.approveAsIsRate).toBeCloseTo(3 / 5);
  });

  it("edit-then-approve counts as edited AND approved", () => {
    const events: AuditEvent[] = [
      ev("article-x", "edit", "2026-05-18T11:00:00Z"),
      ev("article-x", "approve", "2026-05-18T11:10:00Z"),
    ];
    const report = computeBatchReport(events);
    expect(report.approved).toBe(1);
    expect(report.edited).toBe(1);
    expect(report.rejected).toBe(0);
    // edited article does NOT count toward pure approves
    expect(report.approveAsIsRate).toBe(0);
  });

  it("durationSeconds is elapsed time from first to last event", () => {
    const events: AuditEvent[] = [
      ev("slug-1", "approve", "2026-05-18T10:00:00Z"),
      ev("slug-2", "approve", "2026-05-18T10:30:00Z"),
    ];
    const report = computeBatchReport(events);
    expect(report.durationSeconds).toBe(30 * 60); // 1800 seconds
  });

  it("windowStart and windowEnd reflect earliest and latest event timestamps", () => {
    const events: AuditEvent[] = [
      ev("slug-1", "approve", "2026-05-18T10:05:00Z"),
      ev("slug-2", "edit", "2026-05-18T10:00:00Z"), // earlier
      ev("slug-3", "reject", "2026-05-18T10:30:00Z"), // latest
    ];
    const report = computeBatchReport(events);
    expect(report.windowStart).toBe("2026-05-18T10:00:00Z");
    expect(report.windowEnd).toBe("2026-05-18T10:30:00Z");
  });

  it("approveAsIsRate is 0 when there are no final decisions", () => {
    const events: AuditEvent[] = [
      ev("slug-1", "edit", "2026-05-18T10:00:00Z"),
      ev("slug-2", "edit", "2026-05-18T10:05:00Z"),
    ];
    const report = computeBatchReport(events);
    expect(report.approveAsIsRate).toBe(0);
    expect(report.approved).toBe(0);
    expect(report.rejected).toBe(0);
  });

  it("publish events don't affect approved/rejected counts", () => {
    const events: AuditEvent[] = [
      ev("slug-1", "approve", "2026-05-18T10:00:00Z"),
      ev("slug-1", "publish", "2026-05-18T10:01:00Z"),
    ];
    const report = computeBatchReport(events);
    expect(report.approved).toBe(1);
    expect(report.rejected).toBe(0);
  });

  it("produces articleLines with one entry per slug", () => {
    const events: AuditEvent[] = [
      ev("slug-a", "approve", "2026-05-18T10:00:00Z"),
      ev("slug-b", "edit", "2026-05-18T10:05:00Z"),
      ev("slug-b", "reject", "2026-05-18T10:10:00Z", {
        reason_code: "off_brand_voice",
      }),
    ];
    const report = computeBatchReport(events);
    expect(report.articleLines).toHaveLength(2);
    expect(report.articleLines[0]).toContain("slug-a");
    expect(report.articleLines[0]).toContain("approved");
    expect(report.articleLines[1]).toContain("slug-b");
    expect(report.articleLines[1]).toContain("edited");
    expect(report.articleLines[1]).toContain("rejected");
    expect(report.articleLines[1]).toContain("off_brand_voice");
  });

  it("handles a single event window with durationSeconds=0", () => {
    const events: AuditEvent[] = [
      ev("slug-1", "approve", "2026-05-18T10:00:00Z"),
    ];
    const report = computeBatchReport(events);
    expect(report.durationSeconds).toBe(0);
  });

  it("when approve and reject both exist for same slug, uses the later one", () => {
    // reject then approve → approved
    const events1: AuditEvent[] = [
      ev("slug-1", "reject", "2026-05-18T10:00:00Z"),
      ev("slug-1", "approve", "2026-05-18T10:10:00Z"),
    ];
    const r1 = computeBatchReport(events1);
    expect(r1.approved).toBe(1);
    expect(r1.rejected).toBe(0);

    // approve then reject → rejected
    const events2: AuditEvent[] = [
      ev("slug-2", "approve", "2026-05-18T10:00:00Z"),
      ev("slug-2", "reject", "2026-05-18T10:10:00Z"),
    ];
    const r2 = computeBatchReport(events2);
    expect(r2.approved).toBe(0);
    expect(r2.rejected).toBe(1);
  });
});
