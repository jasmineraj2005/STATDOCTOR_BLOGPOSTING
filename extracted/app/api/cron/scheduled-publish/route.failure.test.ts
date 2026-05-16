/**
 * route.failure.test.ts — M0.T10 Chaos/Recovery:
 *   scheduled_publish_marks_cron_run_failed_when_publish_throws
 *
 * Adapted from "batch_handles_db_disconnect_mid_run".
 *
 * Real chaos scenario: publishPost throws or returns !ok. The route must:
 *  1. Roll back the post status to 'scheduled' (via upsertPost rollback call)
 *  2. Log a 'publish-failed' audit event
 *  3. Call recordCronRun("scheduled-publish", false, ...) so cron_runs.last_fail
 *     is updated — making /api/health report `cron:scheduled-publish: last_run_failed`
 *  4. Return HTTP 500 with { ok: false, error: "publish_failed" }
 *
 * This two-stage assertion (cron handler records failure → health endpoint surfaces it)
 * is the chaos+recovery proof for M0.
 *
 * The route imports several modules — we mock them all at the top via vi.mock factory.
 * We use ?force=1 on the request URL to bypass the weekday gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (hoisted by Vitest) ─────────────────────────────────────────

vi.mock("@/lib/admin/db", () => ({
  sql: vi.fn(),
  isDbConfigured: vi.fn(),
}));

vi.mock("@/lib/admin/cron", () => ({
  recordCronRun: vi.fn(),
}));

vi.mock("@/lib/admin/store", () => ({
  upsertPost: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/admin/publish", () => ({
  publishPost: vi.fn(),
}));

vi.mock("@/lib/alerts/resend", () => ({
  dispatchAlert: vi.fn().mockResolvedValue({ emailSent: false, alertId: "mock-alert-id" }),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { sql, isDbConfigured } from "@/lib/admin/db";
import { recordCronRun } from "@/lib/admin/cron";
import { upsertPost, logAudit } from "@/lib/admin/store";
import { publishPost } from "@/lib/admin/publish";
import { dispatchAlert } from "@/lib/alerts/resend";
import { GET } from "./route";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockIsDb = isDbConfigured as unknown as ReturnType<typeof vi.fn>;
const mockRecordCronRun = recordCronRun as unknown as ReturnType<typeof vi.fn>;
const mockUpsertPost = upsertPost as unknown as ReturnType<typeof vi.fn>;
const mockLogAudit = logAudit as unknown as ReturnType<typeof vi.fn>;
const mockPublishPost = publishPost as unknown as ReturnType<typeof vi.fn>;
const mockDispatchAlert = dispatchAlert as unknown as ReturnType<typeof vi.fn>;

// ── Shared fixture ────────────────────────────────────────────────────────────

const SCHEDULED_POST = {
  slug: "chaos-test-slug",
  filename: "20260101_090000_chaos-test-slug.json",
  data: {
    slug: "chaos-test-slug",
    title: "Chaos Test Article",
    meta_title: "Chaos Test",
    meta_description: "A test article for chaos testing.",
    focus_keyword: "chaos",
    og_image_alt: "chaos",
    content_markdown: "## Chaos\n\nThis is chaos.",
    tldr: "chaos",
    pillar: "locum_pay_rates",
    content_type: "news" as const,
    target_keywords: [],
    word_count: 200,
    reading_time_minutes: 1,
    sources: [],
    image_url: null,
    image_credit: null,
    faq_json_ld: {},
    medical_webpage_schema: {},
    ahpra_flags: [],
    ahpra_passed: true,
    status: "scheduled" as const,
    generated_at: "2026-01-01T00:00:00.000Z",
    dateModified: "2026-01-01T00:00:00.000Z",
    last_reviewed_at: "2026-01-01T08:00:00.000Z",
  },
};

/** Build a Request that bypasses the weekday gate (?force=1) and auth (no CRON_SECRET). */
function makeForceRequest(): Request {
  return new Request("http://localhost/api/cron/scheduled-publish?force=1");
}

beforeEach(() => {
  mockSql.mockReset();
  mockIsDb.mockReset();
  mockRecordCronRun.mockReset();
  mockUpsertPost.mockReset();
  mockLogAudit.mockReset();
  mockPublishPost.mockReset();
  mockDispatchAlert.mockReset();
  mockDispatchAlert.mockResolvedValue({ emailSent: false, alertId: "mock-alert-id" });

  // Common base: DB configured, CRON_SECRET unset (no auth gate).
  delete process.env.CRON_SECRET;
  mockIsDb.mockReturnValue(true);
  // sql is called once for the SELECT of scheduled posts.
  mockSql.mockResolvedValue({ rows: [SCHEDULED_POST] });
  // Store and cron functions succeed by default.
  mockUpsertPost.mockResolvedValue(undefined);
  mockLogAudit.mockResolvedValue(undefined);
  mockRecordCronRun.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("scheduled-publish cron — failure handling", () => {
  describe("publishPost returns !ok (e.g. GitHub PUT failed)", () => {
    beforeEach(() => {
      mockPublishPost.mockResolvedValue({
        mode: "github",
        ok: false,
        destination: "",
        detail: "GitHub PUT 503: service unavailable",
      });
    });

    it("returns HTTP 500 with ok=false and error=publish_failed", async () => {
      const res = await GET(makeForceRequest());
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: "publish_failed" });
    });

    it("rolls back post status to 'publish_failed' via second upsertPost call (M7: was 'scheduled' pre-M7)", async () => {
      await GET(makeForceRequest());
      // First upsertPost call: sets status='published' (optimistic update).
      // Second upsertPost call: rolls back to status='publish_failed' so operator can retry.
      expect(mockUpsertPost).toHaveBeenCalledTimes(2);
      const rollbackArg = mockUpsertPost.mock.calls[1][1] as { status: string };
      expect(rollbackArg.status).toBe("publish_failed");
    });

    it("logs a publish-failed audit event", async () => {
      await GET(makeForceRequest());
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "publish-failed" }),
      );
    });

    it("records a FAILED cron run — so /api/health will surface last_run_failed", async () => {
      await GET(makeForceRequest());
      expect(mockRecordCronRun).toHaveBeenCalledWith(
        "scheduled-publish",
        false, // ok=false → last_fail updated in cron_runs
        expect.any(String),
      );
    });

    it("does NOT record a successful cron run when publish fails", async () => {
      await GET(makeForceRequest());
      // Ensure we never called recordCronRun(_, true, _) — only the failure call.
      const successCalls = mockRecordCronRun.mock.calls.filter(
        (c) => c[1] === true,
      );
      expect(successCalls).toHaveLength(0);
    });
  });

  describe("publishPost throws (e.g. uncaught network error mid-run)", () => {
    /**
     * M7 FIX: The route now wraps publishPost in a try/catch. If publishPost
     * throws (vs. returning { ok: false }), the catch handler:
     *  1. Rolls back post status to 'publish_failed'
     *  2. Logs a 'publish-failed' audit event
     *  3. Calls recordCronRun("scheduled-publish", false, ...) so cron_runs.last_fail is updated
     *  4. Calls dispatchAlert for real-time notification
     *  5. Returns HTTP 500 with { ok: false, error: "publish_failed" }
     */
    it("publishPost throw — route catches the throw and records cron failure (M7 fix)", async () => {
      mockPublishPost.mockRejectedValue(new Error("network timeout mid-publish"));
      const res = await GET(makeForceRequest());
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: "publish_failed" });
      expect(mockRecordCronRun).toHaveBeenCalledWith(
        "scheduled-publish",
        false,
        expect.stringContaining("network timeout"),
      );
    });

    it("publishPost throw — audit event logged with action=publish-failed (M7 fix)", async () => {
      mockPublishPost.mockRejectedValue(new Error("network timeout mid-publish"));
      await GET(makeForceRequest());
      expect(mockLogAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "publish-failed" }),
      );
    });

    it("publishPost throw — post is rolled back to publish_failed status (M7 fix)", async () => {
      mockPublishPost.mockRejectedValue(new Error("network timeout mid-publish"));
      await GET(makeForceRequest());
      // Second upsertPost call rolls back with publish_failed.
      expect(mockUpsertPost).toHaveBeenCalledTimes(2);
      const rollbackArg = mockUpsertPost.mock.calls[1][1] as { status: string };
      expect(rollbackArg.status).toBe("publish_failed");
    });

    it("publishPost throw — dispatchAlert is called with severity=error (M7 fix)", async () => {
      mockPublishPost.mockRejectedValue(new Error("network timeout mid-publish"));
      await GET(makeForceRequest());
      expect(mockDispatchAlert).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "publish_failed", severity: "error" }),
      );
    });

    it("recordCronRun(false) is called exactly once when publishPost throws — no success call", async () => {
      mockPublishPost.mockRejectedValue(new Error("connection reset"));
      await GET(makeForceRequest());
      const failCalls = mockRecordCronRun.mock.calls.filter((c) => c[1] === false);
      const successCalls = mockRecordCronRun.mock.calls.filter((c) => c[1] === true);
      expect(failCalls).toHaveLength(1);
      expect(successCalls).toHaveLength(0);
    });
  });

  describe("empty scheduled queue — still records a successful cron run", () => {
    it("returns ok=true with reason=empty_queue and records successful cron run", async () => {
      mockSql.mockResolvedValueOnce({ rows: [] });
      const res = await GET(makeForceRequest());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, reason: "empty_queue" });
      expect(mockRecordCronRun).toHaveBeenCalledWith(
        "scheduled-publish",
        true,
        expect.any(String),
      );
    });
  });

  describe("chaos → recovery two-stage assertion", () => {
    it("cron records failure → health would report last_run_failed for scheduled-publish", async () => {
      // Stage 1 (chaos): publishPost fails → recordCronRun(false) is called.
      mockPublishPost.mockResolvedValue({
        mode: "github",
        ok: false,
        destination: "",
        detail: "503 upstream",
      });
      await GET(makeForceRequest());

      // Verify the failure was recorded.
      expect(mockRecordCronRun).toHaveBeenCalledWith("scheduled-publish", false, expect.any(String));

      // Stage 2 (recovery proof): /api/health checks cron_runs and reports
      // last_run_failed when last_fail > last_ok. This is integration-verified
      // in route.test.ts "reports cron:<kind>: last_run_failed when last_fail > last_ok".
      // Here we assert the causal chain is complete: the cron handler (not the
      // health handler) is responsible for writing the failure signal.
      //
      // If recordCronRun were NOT called (the behaviour gap described in the
      // publishPost-throws tests above), this stage would also fail — which is
      // why the two-stage assertion is a valid chaos+recovery proof.
      const failCalls = mockRecordCronRun.mock.calls.filter((c) => c[1] === false);
      expect(failCalls).toHaveLength(1);
      expect(failCalls[0][0]).toBe("scheduled-publish");
    });
  });
});
