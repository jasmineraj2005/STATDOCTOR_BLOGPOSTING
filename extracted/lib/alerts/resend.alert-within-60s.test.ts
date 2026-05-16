/**
 * resend.alert-within-60s.test.ts — M7 activation of previously-skipped tests.
 *
 * These tests were SKIPPED in M0 because the real-time alert path did not exist.
 * M7 adds lib/alerts/resend.ts and wires it into the cron failure path.
 *
 * Tests verify that dispatchAlert (which is called from the scheduled-publish cron
 * failure handler) emits a Resend email within the 60s SLA.
 */

import { describe, it, expect, vi } from "vitest";
import { dispatchAlert } from "./resend";
import type { ResendFn, Db } from "./resend";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockDb(): Db {
  const queryMock = vi.fn();
  // No duplicate → fresh insert
  queryMock
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValue({ rows: [{ id: "42" }], rowCount: 1 });
  return { query: queryMock as unknown as Db["query"] };
}

function makeMockResend(): { resend: ResendFn; sendMock: ReturnType<typeof vi.fn> } {
  const sendMock = vi.fn().mockResolvedValue({ id: "test-email-id" });
  return { resend: sendMock as unknown as ResendFn, sendMock };
}

const FIXED_NOW = new Date("2026-05-16T10:00:00.000Z");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("real-time alert — alert_emits_within_60s_of_failure", () => {
  it("Resend.send is called within 60s wall-clock after dispatchAlert is invoked (M7)", async () => {
    const db = makeMockDb();
    const { resend, sendMock } = makeMockResend();

    const t0 = performance.now();
    await dispatchAlert(
      { kind: "scheduled-publish", severity: "error", detail: "GitHub PUT 503: service unavailable" },
      { db, resend, now: () => FIXED_NOW },
    );
    const elapsed = performance.now() - t0;

    expect(sendMock).toHaveBeenCalledOnce();
    expect(elapsed).toBeLessThan(60_000);

    // Verify the email subject contains the cron kind
    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toContain("scheduled-publish");
  });

  it("no alert emitted for successful cron runs (warn severity = no email)", async () => {
    const db = makeMockDb();
    const { resend, sendMock } = makeMockResend();

    await dispatchAlert(
      { kind: "scheduled-publish", severity: "warn", detail: "all good" },
      { db, resend, now: () => FIXED_NOW },
    );

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("alert email body contains cron kind and failure detail (M7)", async () => {
    const db = makeMockDb();
    const { resend, sendMock } = makeMockResend();

    await dispatchAlert(
      { kind: "daily-digest", severity: "error", detail: "Resend API 429: rate limited" },
      { db, resend, now: () => FIXED_NOW },
    );

    const call = sendMock.mock.calls[0][0];
    const body = call.html ?? call.text ?? "";
    expect(body).toContain("daily-digest");
    expect(body).toContain("rate limited");
  });
});
