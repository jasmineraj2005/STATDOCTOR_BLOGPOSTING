/**
 * route.perf.test.ts — M0.T10 Chaos/Recovery: health_endpoint_returns_under_500ms
 *
 * Mocks sql and isDbConfigured (same pattern as route.test.ts), calls GET() 5 times,
 * asserts the maximum observed wall-clock duration is under 500ms.
 *
 * Rationale: UptimeRobot pings every 5 min with a 30s timeout, but we want the
 * endpoint to return well within 500ms so any real DB latency budget is preserved.
 * A mocked response should be <10ms; 500ms is the contractual ceiling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock before importing the route.
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

/** Set up a "healthy, all crons fresh" mock for a single GET() call.
 *  The health handler calls sql twice: once for SELECT 1, once for cron_runs. */
function setupHealthyMocks() {
  mockIsDb.mockReturnValue(true);
  // SELECT 1 — db reachable
  mockSql.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
  // cron_runs query
  mockSql.mockImplementationOnce(() =>
    Promise.resolve({
      rows: [
        {
          kind: "scheduled-publish",
          last_ok: new Date(Date.now() - 60_000),
          last_fail: null,
        },
        {
          kind: "daily-digest",
          last_ok: new Date(Date.now() - 60_000),
          last_fail: null,
        },
      ],
    }),
  );
}

describe("health endpoint performance", () => {
  it("health_endpoint_returns_under_500ms across 5 consecutive calls", async () => {
    const TRIALS = 5;
    const MAX_MS = 500;
    const durations: number[] = [];

    for (let i = 0; i < TRIALS; i++) {
      setupHealthyMocks();
      const t0 = performance.now();
      const res = await GET();
      const elapsed = performance.now() - t0;
      durations.push(elapsed);

      // Sanity check: each response must still be correct.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    }

    const maxDuration = Math.max(...durations);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

    // Log for diagnostics even on pass.
    console.info(
      `[perf] health GET — trials=${TRIALS} ` +
        `max=${maxDuration.toFixed(2)}ms avg=${avgDuration.toFixed(2)}ms ` +
        `all=${durations.map((d) => d.toFixed(1)).join(", ")}ms`,
    );

    expect(maxDuration).toBeLessThan(MAX_MS);
  });

  it("health_endpoint_returns_under_500ms when db not configured (early-exit path)", async () => {
    const TRIALS = 5;
    const MAX_MS = 500;
    const durations: number[] = [];

    for (let i = 0; i < TRIALS; i++) {
      mockIsDb.mockReturnValue(false);
      const t0 = performance.now();
      const res = await GET();
      const elapsed = performance.now() - t0;
      durations.push(elapsed);
      expect(res.status).toBe(503);
      mockIsDb.mockReset();
    }

    const maxDuration = Math.max(...durations);
    expect(maxDuration).toBeLessThan(MAX_MS);
  });

  it("health_endpoint_returns_under_500ms when db unreachable (fast-fail path)", async () => {
    const TRIALS = 5;
    const MAX_MS = 500;
    const durations: number[] = [];

    for (let i = 0; i < TRIALS; i++) {
      mockIsDb.mockReturnValue(true);
      mockSql.mockImplementationOnce(() =>
        Promise.reject(new Error("connection refused")),
      );
      const t0 = performance.now();
      const res = await GET();
      const elapsed = performance.now() - t0;
      durations.push(elapsed);
      expect(res.status).toBe(503);
      mockSql.mockReset();
      mockIsDb.mockReset();
    }

    const maxDuration = Math.max(...durations);
    expect(maxDuration).toBeLessThan(MAX_MS);
  });
});
