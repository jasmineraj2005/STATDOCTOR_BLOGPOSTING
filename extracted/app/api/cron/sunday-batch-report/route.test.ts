/**
 * Tests for /api/cron/sunday-batch-report
 *
 * Resend, DB, and invariant checks are all mocked.
 * No real network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── module mocks ──────────────────────────────────────────────────────────────

// Mock the db module so we don't need a real Postgres connection
vi.mock("@/lib/admin/db", () => ({
  isDbConfigured: vi.fn(() => true),
  sql: vi.fn(),
  pool: vi.fn(),
}));

// Mock cron recorder
vi.mock("@/lib/admin/cron", () => ({
  recordCronRun: vi.fn(),
}));

// Mock weekly-invariants
vi.mock("@/lib/admin/weekly-invariants", () => ({
  checkWeeklyInvariants: vi.fn(async () => [
    { name: "stale_review", status: "ok", detail: "5 events in last 8d" },
    { name: "low_approve_rate", status: "ok", detail: "97.5% average" },
    { name: "publish_backlog", status: "ok", detail: "1 article stuck" },
  ]),
}));

import { isDbConfigured, sql } from "@/lib/admin/db";
import { recordCronRun } from "@/lib/admin/cron";
import { checkWeeklyInvariants } from "@/lib/admin/weekly-invariants";

// We import the specific export only (not the route handler GET directly)
// to keep the test independent of Next.js request/response wiring.
import { computeSundayWindow } from "./route";

// ── computeSundayWindow tests ─────────────────────────────────────────────────

describe("computeSundayWindow", () => {
  it("given Monday 09:00 UTC, end is Sunday ~08:00 UTC", () => {
    // Monday 2026-05-18 09:00 UTC
    const monday = new Date("2026-05-18T09:00:00Z");
    const { start, end } = computeSundayWindow(monday);
    // end should be Sunday 2026-05-17 08:00 UTC
    expect(end.toISOString()).toBe("2026-05-17T08:00:00.000Z");
    // start should be 12h before end → Sunday 2026-05-17 20:00-12 = 2026-05-16T20:00 (Sat evening)
    expect(start < end).toBe(true);
    // Window is 12h
    const durationHours = (end.getTime() - start.getTime()) / 3600_000;
    expect(durationHours).toBe(12);
  });

  it("start is always before end", () => {
    const now = new Date("2026-05-25T09:00:00Z");
    const { start, end } = computeSundayWindow(now);
    expect(start < end).toBe(true);
  });
});

// ── GET handler tests ─────────────────────────────────────────────────────────

describe("GET /api/cron/sunday-batch-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default sql mock: return empty audit rows + ignore other queries
    vi.mocked(sql).mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?");
        if (text.includes("audit_events")) {
          return Promise.resolve({ rows: [], rowCount: 0 }) as any;
        }
        // DDL + upsert — silently succeed
        return Promise.resolve({ rows: [], rowCount: 0 }) as any;
      },
    );
    vi.mocked(isDbConfigured).mockReturnValue(true);
    vi.mocked(recordCronRun).mockResolvedValue(undefined);
  });

  it("returns 401 when CRON_SECRET is set and auth header is missing", async () => {
    process.env.CRON_SECRET = "test-secret";
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/sunday-batch-report");
    const res = await GET(req);
    expect(res.status).toBe(401);
    delete process.env.CRON_SECRET;
  });

  it("returns 401 when CRON_SECRET is set and auth header is wrong", async () => {
    process.env.CRON_SECRET = "test-secret";
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/sunday-batch-report", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    delete process.env.CRON_SECRET;
  });

  it("returns ok:false when DB is not configured", async () => {
    vi.mocked(isDbConfigured).mockReturnValue(false);
    delete process.env.CRON_SECRET;
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/sunday-batch-report");
    const res = await GET(req);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.detail).toContain("POSTGRES_URL");
  });

  it("sends email via Resend when RESEND_API_KEY is set", async () => {
    delete process.env.CRON_SECRET;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.SUNDAY_REPORT_EMAIL = "test@example.com";

    // Mock audit rows with some events
    vi.mocked(sql).mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?");
        if (text.includes("audit_events")) {
          return Promise.resolve({
            rows: [
              {
                ts: "2026-05-17T10:00:00Z",
                slug: "article-1",
                action: "approve",
                reason_code: null,
                reason_text: null,
                detail: null,
              },
              {
                ts: "2026-05-17T10:05:00Z",
                slug: "article-2",
                action: "reject",
                reason_code: "off_brand_voice",
                reason_text: null,
                detail: null,
              },
            ],
            rowCount: 2,
          }) as any;
        }
        return Promise.resolve({ rows: [], rowCount: 0 }) as any;
      },
    );

    // Mock Resend fetch
    const mockFetch = vi.fn(async (url: string) => {
      if (url === "https://api.resend.com/emails") {
        return new Response(JSON.stringify({ id: "re-test-id-123" }), {
          status: 200,
        });
      }
      return new Response("", { status: 404 });
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { GET } = await import("./route");
      const req = new Request(
        "http://localhost/api/cron/sunday-batch-report",
      );
      const res = await GET(req);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.sent).toBe(true);
      expect(body.detail).toContain("re-test-id-123");

      // Verify Resend was called with the right structure
      const resendCall = mockFetch.mock.calls.find(
        ([url]) => url === "https://api.resend.com/emails",
      );
      expect(resendCall).toBeDefined();
      const sentBody = JSON.parse(resendCall![1].body as string);
      expect(sentBody.to).toBe("test@example.com");
      expect(sentBody.subject).toContain("Sunday batch");
      expect(sentBody.html).toContain("article-1");
    } finally {
      global.fetch = originalFetch;
      delete process.env.RESEND_API_KEY;
      delete process.env.SUNDAY_REPORT_EMAIL;
    }
  });

  it("does not send email when RESEND_API_KEY is missing (safe dev mode)", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.RESEND_API_KEY;

    const mockFetch = vi.fn();
    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { GET } = await import("./route");
      const req = new Request("http://localhost/api/cron/sunday-batch-report");
      const res = await GET(req);
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.sent).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("email subject includes approved count", async () => {
    delete process.env.CRON_SECRET;
    process.env.RESEND_API_KEY = "re_test_key";

    vi.mocked(sql).mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?");
        if (text.includes("audit_events")) {
          return Promise.resolve({
            rows: [
              {
                ts: "2026-05-17T10:00:00Z",
                slug: "a-1",
                action: "approve",
                reason_code: null,
                reason_text: null,
                detail: null,
              },
              {
                ts: "2026-05-17T10:01:00Z",
                slug: "a-2",
                action: "approve",
                reason_code: null,
                reason_text: null,
                detail: null,
              },
              {
                ts: "2026-05-17T10:02:00Z",
                slug: "a-3",
                action: "approve",
                reason_code: null,
                reason_text: null,
                detail: null,
              },
            ],
            rowCount: 3,
          }) as any;
        }
        return Promise.resolve({ rows: [], rowCount: 0 }) as any;
      },
    );

    let capturedSubject = "";
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.resend.com/emails") {
        const b = JSON.parse(init?.body as string);
        capturedSubject = b.subject;
        return new Response(JSON.stringify({ id: "re-id-ok" }), {
          status: 200,
        });
      }
      return new Response("", { status: 404 });
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { GET } = await import("./route");
      const req = new Request("http://localhost/api/cron/sunday-batch-report");
      await GET(req);
      expect(capturedSubject).toContain("3");
      expect(capturedSubject.toLowerCase()).toContain("sunday batch");
    } finally {
      global.fetch = originalFetch;
      delete process.env.RESEND_API_KEY;
    }
  });

  it("includes approve-as-is rate in response", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.RESEND_API_KEY;

    vi.mocked(sql).mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?");
        if (text.includes("audit_events")) {
          return Promise.resolve({
            rows: [
              {
                ts: "2026-05-17T10:00:00Z",
                slug: "a",
                action: "approve",
                reason_code: null,
                reason_text: null,
                detail: null,
              },
            ],
            rowCount: 1,
          }) as any;
        }
        return Promise.resolve({ rows: [], rowCount: 0 }) as any;
      },
    );

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/sunday-batch-report");
    const res = await GET(req);
    const body = await res.json();
    expect(body.report.approveAsIsRate).toBe(1);
    expect(body.report.approved).toBe(1);
  });

  it("returns invariant statuses in response", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.RESEND_API_KEY;

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/sunday-batch-report");
    const res = await GET(req);
    const body = await res.json();

    expect(Array.isArray(body.invariants)).toBe(true);
    expect(body.invariants).toHaveLength(3);
    expect(body.invariants[0]).toMatchObject({ name: "stale_review" });
  });
});
