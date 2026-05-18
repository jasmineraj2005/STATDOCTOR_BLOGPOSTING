import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the db module BEFORE importing the route, otherwise the route's
// `import { sql, isDbConfigured } from "@/lib/admin/db"` resolves to the real one.
vi.mock("@/lib/admin/db", () => {
  return {
    sql: vi.fn(),
    isDbConfigured: vi.fn(),
  };
});

import { sql, isDbConfigured } from "@/lib/admin/db";
import { GET } from "./route";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockIsDb = isDbConfigured as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSql.mockReset();
  mockIsDb.mockReset();
});

describe("/api/health", () => {
  it("returns 503 degraded when db not configured", async () => {
    mockIsDb.mockReturnValue(false);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, status: "degraded", checks: { db: "not_configured" } });
  });

  it("returns 503 failing when db unreachable", async () => {
    mockIsDb.mockReturnValue(true);
    mockSql.mockImplementationOnce(() => Promise.reject(new Error("connection refused")));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, status: "failing", checks: { db: "unreachable" } });
  });

  it("reports cron:<kind>: last_run_failed when last_fail > last_ok", async () => {
    mockIsDb.mockReturnValue(true);
    mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] })); // SELECT 1
    mockSql.mockImplementationOnce(() => Promise.resolve({
      rows: [{ kind: "scheduled-publish", last_ok: new Date(Date.now() - 86400000), last_fail: new Date() }],
    }));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks["cron:scheduled-publish"]).toBe("last_run_failed");
    expect(body.status).toBe("degraded");
  });

  it("reports cron:<kind>: stale_<N>h when last_ok older than threshold", async () => {
    mockIsDb.mockReturnValue(true);
    mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
    // scheduled-publish threshold is 26h; force 50h old to trigger stale.
    mockSql.mockImplementationOnce(() => Promise.resolve({
      rows: [{ kind: "scheduled-publish", last_ok: new Date(Date.now() - 50 * 3600_000), last_fail: null }],
    }));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks["cron:scheduled-publish"]).toMatch(/^stale_\d+h$/);
  });

  it("returns 200 healthy when no cron_runs (fresh install)", async () => {
    mockIsDb.mockReturnValue(true);
    mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
    mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "healthy", checks: { crons: "not_yet_run" } });
  });

  it("returns 200 healthy when all crons fresh and ok", async () => {
    mockIsDb.mockReturnValue(true);
    mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
    mockSql.mockImplementationOnce(() => Promise.resolve({
      rows: [
        { kind: "scheduled-publish", last_ok: new Date(Date.now() - 60_000), last_fail: null },
        { kind: "daily-digest",      last_ok: new Date(Date.now() - 60_000), last_fail: null },
      ],
    }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checks["cron:scheduled-publish"]).toBe("ok");
    expect(body.checks["cron:daily-digest"]).toBe("ok");
  });

  describe("HEALTH_EXPECTED_FAILING_CRONS allowlist (N5)", () => {
    const ORIGINAL = process.env.HEALTH_EXPECTED_FAILING_CRONS;

    beforeEach(() => {
      delete process.env.HEALTH_EXPECTED_FAILING_CRONS;
    });

    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.HEALTH_EXPECTED_FAILING_CRONS;
      else process.env.HEALTH_EXPECTED_FAILING_CRONS = ORIGINAL;
    });

    it("downgrades to 503 when a failing cron is NOT in the allowlist (default behaviour)", async () => {
      mockIsDb.mockReturnValue(true);
      mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
      mockSql.mockImplementationOnce(() => Promise.resolve({
        rows: [{ kind: "seo-snapshot", last_ok: new Date(Date.now() - 86400000), last_fail: new Date() }],
      }));
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.checks["cron:seo-snapshot"]).toBe("last_run_failed");
      expect(body.status).toBe("degraded");
    });

    it("stays 200 healthy when a failing cron IS in the allowlist", async () => {
      process.env.HEALTH_EXPECTED_FAILING_CRONS = "seo-snapshot";
      mockIsDb.mockReturnValue(true);
      mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
      mockSql.mockImplementationOnce(() => Promise.resolve({
        rows: [{ kind: "seo-snapshot", last_ok: new Date(Date.now() - 86400000), last_fail: new Date() }],
      }));
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.checks["cron:seo-snapshot"]).toBe("last_run_failed_tolerated");
    });

    it("tolerates stale crons in the allowlist too", async () => {
      process.env.HEALTH_EXPECTED_FAILING_CRONS = "seo-snapshot";
      mockIsDb.mockReturnValue(true);
      mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
      mockSql.mockImplementationOnce(() => Promise.resolve({
        rows: [{ kind: "seo-snapshot", last_ok: new Date(Date.now() - 200 * 3600_000), last_fail: null }],
      }));
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.checks["cron:seo-snapshot"]).toMatch(/^stale_\d+h_tolerated$/);
    });

    it("only tolerates the explicitly-listed crons", async () => {
      process.env.HEALTH_EXPECTED_FAILING_CRONS = "seo-snapshot";
      mockIsDb.mockReturnValue(true);
      mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
      mockSql.mockImplementationOnce(() => Promise.resolve({
        rows: [
          { kind: "seo-snapshot",      last_ok: new Date(Date.now() - 86400000), last_fail: new Date() },
          { kind: "scheduled-publish", last_ok: new Date(Date.now() - 86400000), last_fail: new Date() },
        ],
      }));
      const res = await GET();
      // scheduled-publish is NOT tolerated → degraded → 503
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.checks["cron:seo-snapshot"]).toBe("last_run_failed_tolerated");
      expect(body.checks["cron:scheduled-publish"]).toBe("last_run_failed");
    });

    it("supports comma-separated list with whitespace", async () => {
      process.env.HEALTH_EXPECTED_FAILING_CRONS = "seo-snapshot, competitor-audit";
      mockIsDb.mockReturnValue(true);
      mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
      mockSql.mockImplementationOnce(() => Promise.resolve({
        rows: [
          { kind: "seo-snapshot",     last_ok: new Date(Date.now() - 86400000), last_fail: new Date() },
          { kind: "competitor-audit", last_ok: new Date(Date.now() - 86400000), last_fail: new Date() },
        ],
      }));
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });
});
