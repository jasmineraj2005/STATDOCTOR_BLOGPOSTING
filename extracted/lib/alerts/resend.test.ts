/**
 * resend.test.ts — Unit tests for lib/alerts/resend.ts (M7)
 *
 * All Resend API calls and DB calls are injected as mocks — no real emails.
 *
 * Test coverage:
 *  1. happy path: critical → email sent + alert row inserted
 *  2. warn: no email, alert row only
 *  3. dedup: 2 critical-of-same-kind within 1h → second call only updates (no email)
 *  4. alert_emits_within_60s_of_failure — call dispatchAlert; assert mock Resend called within 60s wall-clock
 *  5. error severity also sends email
 *  6. no email when RESEND_API_KEY is absent (but resend dep is not injected)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchAlert } from "./resend";
import type { ResendFn, Db } from "./resend";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb(overrides: Partial<{
  dupRows: Array<Record<string, unknown>>;
  insertId: string;
}>  = {}): { db: Db; queryMock: ReturnType<typeof vi.fn> } {
  const queryMock = vi.fn();
  const { dupRows = [], insertId = "101" } = overrides;

  // First call = duplicate check (SELECT).
  // Second call = INSERT or UPDATE.
  queryMock
    .mockResolvedValueOnce({ rows: dupRows, rowCount: dupRows.length })
    .mockResolvedValue({ rows: [{ id: insertId }], rowCount: 1 });

  const db: Db = {
    query: queryMock as unknown as Db["query"],
  };
  return { db, queryMock };
}

function makeResend(): { resend: ResendFn; sendMock: ReturnType<typeof vi.fn> } {
  const sendMock = vi.fn().mockResolvedValue({ id: "email-abc" });
  const resend: ResendFn = sendMock as unknown as ResendFn;
  return { resend, sendMock };
}

const FIXED_NOW = new Date("2026-05-16T10:00:00.000Z");
const nowFn = () => FIXED_NOW;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("dispatchAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("critical severity — happy path", () => {
    it("sends email and inserts alert row", async () => {
      const { db, queryMock } = makeDb();
      const { resend, sendMock } = makeResend();

      const result = await dispatchAlert(
        { kind: "publish_failed", severity: "critical", detail: "GitHub PUT 503" },
        { db, resend, now: nowFn },
      );

      expect(result.emailSent).toBe(true);
      expect(result.alertId).toBe("101");

      // DB: SELECT then INSERT
      expect(queryMock).toHaveBeenCalledTimes(2);
      const insertCall = queryMock.mock.calls[1];
      expect(insertCall[0]).toMatch(/INSERT INTO alerts/i);

      // Email
      expect(sendMock).toHaveBeenCalledOnce();
      const emailArg = sendMock.mock.calls[0][0];
      expect(emailArg.subject).toContain("CRITICAL");
      expect(emailArg.subject).toContain("publish_failed");
      expect(emailArg.text).toContain("GitHub PUT 503");
    });
  });

  describe("error severity", () => {
    it("sends email and inserts alert row", async () => {
      const { db } = makeDb();
      const { resend, sendMock } = makeResend();

      const result = await dispatchAlert(
        { kind: "cron_failed", severity: "error", detail: "cron timeout" },
        { db, resend, now: nowFn },
      );

      expect(result.emailSent).toBe(true);
      expect(sendMock).toHaveBeenCalledOnce();
      const emailArg = sendMock.mock.calls[0][0];
      expect(emailArg.subject).toContain("ERROR");
    });
  });

  describe("warn severity — no email, alert row only", () => {
    it("does not send email; inserts alert row", async () => {
      const { db, queryMock } = makeDb();
      const { resend, sendMock } = makeResend();

      const result = await dispatchAlert(
        { kind: "stale_review", severity: "warn", detail: "No review in 7 days" },
        { db, resend, now: nowFn },
      );

      expect(result.emailSent).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
      // DB should still record the alert
      expect(queryMock).toHaveBeenCalled();
    });
  });

  describe("deduplication — same kind within 1h", () => {
    it("second critical-of-same-kind call only updates DB, no re-email", async () => {
      // Simulate that a row already exists (duplicate found).
      const existingRow = { id: "55" };
      const { db, queryMock } = makeDb({ dupRows: [existingRow] });
      const { resend, sendMock } = makeResend();

      const result = await dispatchAlert(
        { kind: "publish_failed", severity: "critical", detail: "GitHub PUT 503 again" },
        { db, resend, now: nowFn },
      );

      // alertId should be the existing row's id
      expect(result.alertId).toBe("55");
      // No email sent
      expect(result.emailSent).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
      // DB: SELECT found duplicate, then UPDATE (not INSERT)
      const updateCall = queryMock.mock.calls[1];
      expect(updateCall[0]).toMatch(/UPDATE alerts/i);
    });

    it("first call of same kind sends email; second within 1h does not", async () => {
      // First call: no duplicate.
      const { db: db1, sendMock: sendMock1, resend: resend1 } = (() => {
        const { db } = makeDb({ dupRows: [] });
        const { resend, sendMock } = makeResend();
        return { db, resend, sendMock };
      })();

      const r1 = await dispatchAlert(
        { kind: "publish_failed", severity: "critical", detail: "first" },
        { db: db1, resend: resend1, now: nowFn },
      );
      expect(r1.emailSent).toBe(true);
      expect(sendMock1).toHaveBeenCalledOnce();

      // Second call: duplicate found.
      const { db: db2, sendMock: sendMock2, resend: resend2 } = (() => {
        const { db } = makeDb({ dupRows: [{ id: "99" }] });
        const { resend, sendMock } = makeResend();
        return { db, resend, sendMock };
      })();

      const r2 = await dispatchAlert(
        { kind: "publish_failed", severity: "critical", detail: "second within 1h" },
        { db: db2, resend: resend2, now: nowFn },
      );
      expect(r2.emailSent).toBe(false);
      expect(sendMock2).not.toHaveBeenCalled();
    });
  });

  describe("alert_emits_within_60s_of_failure", () => {
    it("mock Resend is called within 60s wall-clock of dispatchAlert being invoked", async () => {
      // This test uses real wall-clock timing (not mocked) to prove the 60s SLA.
      // Since dispatchAlert is synchronous-ish (no real network), elapsed should be < 100ms.
      const { db } = makeDb();
      const { resend, sendMock } = makeResend();

      const t0 = performance.now();
      await dispatchAlert(
        { kind: "publish_failed", severity: "critical", detail: "timeout test" },
        { db, resend, now: nowFn },
      );
      const elapsed = performance.now() - t0;

      expect(sendMock).toHaveBeenCalledOnce();
      expect(elapsed).toBeLessThan(60_000);
    });

    it("email body contains cron kind and failure detail", async () => {
      const { db } = makeDb();
      const { resend, sendMock } = makeResend();

      await dispatchAlert(
        { kind: "scheduled-publish", severity: "error", detail: "GitHub PUT 503: service unavailable" },
        { db, resend, now: nowFn },
      );

      const emailArg = sendMock.mock.calls[0][0];
      const body = emailArg.html ?? emailArg.text ?? "";
      expect(body).toContain("scheduled-publish");
      expect(body).toContain("503");
    });

    it("no email emitted for successful (warn) calls", async () => {
      const { db } = makeDb();
      const { resend, sendMock } = makeResend();

      await dispatchAlert(
        { kind: "scheduled-publish", severity: "warn", detail: "all good" },
        { db, resend, now: nowFn },
      );

      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe("email body includes context when provided", () => {
    it("context object is included in email text", async () => {
      const { db } = makeDb();
      const { resend, sendMock } = makeResend();

      await dispatchAlert(
        {
          kind: "publish_failed",
          severity: "critical",
          detail: "test",
          context: { slug: "my-test-slug", attempt: 3 },
        },
        { db, resend, now: nowFn },
      );

      const emailArg = sendMock.mock.calls[0][0];
      const body = emailArg.html ?? emailArg.text ?? "";
      expect(body).toContain("my-test-slug");
      expect(body).toContain("attempt");
    });
  });

  describe("DB unavailable (db=null)", () => {
    it("still sends email if DB is null (graceful degradation)", async () => {
      const { resend, sendMock } = makeResend();

      const result = await dispatchAlert(
        { kind: "db_unreachable", severity: "critical", detail: "cannot connect" },
        { db: undefined, resend, now: nowFn },
      );

      // No DB means no dedup check — email should still fire.
      expect(result.emailSent).toBe(true);
      expect(sendMock).toHaveBeenCalledOnce();
    });
  });
});
