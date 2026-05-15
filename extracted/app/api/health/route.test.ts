import { describe, it, expect, vi, beforeEach } from "vitest";

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
});
