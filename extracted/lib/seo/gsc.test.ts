/**
 * gsc.test.ts
 *
 * Tests for the GSC module.
 *
 * Strategy:
 * - Unit-test parseGscRows (pure function extracted from fetchGscYesterday).
 * - Integration-test fetchGscYesterday with googleapis mocked at the module level
 *   and DB mocked via pg-mem.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { newDb } from "pg-mem";
import type { Pool as PgPool } from "pg";
import gscSample from "../../tests/fixtures/seo/gsc-sample.json";

// ── pg-mem setup ─────────────────────────────────────────────────────────────

const memDb = newDb();
const { Pool: MemPool } = memDb.adapters.createPg() as { Pool: new () => PgPool };
const testPool = new MemPool();

const GSC_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS gsc_daily_snapshot (
  date         DATE       NOT NULL,
  query        TEXT       NOT NULL,
  page         TEXT       NOT NULL,
  country      TEXT       NOT NULL DEFAULT '',
  device       TEXT       NOT NULL DEFAULT '',
  clicks       INT        NOT NULL DEFAULT 0,
  impressions  INT        NOT NULL DEFAULT 0,
  position     NUMERIC    NOT NULL DEFAULT 0,
  PRIMARY KEY (date, query, page, country, device)
);
`;

// ── googleapis mock ───────────────────────────────────────────────────────────

// Build a mock that returns gscSample.rows when searchanalytics.query is called.
// The mock is hoisted before any import of gsc.ts.
vi.mock("googleapis", () => {
  const mockQuery = vi.fn().mockResolvedValue({ data: gscSample });
  const mockWebmasters = {
    searchanalytics: { query: mockQuery },
  };
  // JWT must be a proper class (constructable with `new`)
  class MockJWT {
    constructor(_opts: unknown) {}
  }
  return {
    google: {
      auth: {
        JWT: MockJWT,
      },
      webmasters: vi.fn().mockReturnValue(mockWebmasters),
    },
  };
});

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/admin/db", () => ({
  isDbConfigured: () => true,
  sql: async <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }> => {
    let text = "";
    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    const res = await testPool.query<T>(text, values as unknown[]);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { fetchGscYesterday, parseGscRows, type GscFetchSummary } from "./gsc";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await testPool.query(GSC_BOOTSTRAP_SQL);
  // Set required env vars
  process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "test@test-project.iam.gserviceaccount.com",
    private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
  });
  process.env.GSC_SITE_URL = "https://statdoctor.app/";
});

afterAll(async () => {
  delete process.env.GSC_SERVICE_ACCOUNT_JSON;
  delete process.env.GSC_SITE_URL;
  await testPool.end();
});

// ── parseGscRows unit tests ───────────────────────────────────────────────────

describe("parseGscRows", () => {
  const capturedOn = "2026-05-14";

  it("parses full sample rows to correct snapshot shape", () => {
    const result = parseGscRows(gscSample.rows, capturedOn);
    expect(result).toHaveLength(4);

    const first = result[0];
    expect(first.query).toBe("locum doctor pay rates australia");
    expect(first.page).toBe("https://statdoctor.app/blog/locum-pay-rates");
    expect(first.country).toBe("aus");
    expect(first.device).toBe("DESKTOP");
    expect(first.clicks).toBe(42);
    expect(first.impressions).toBe(850);
    expect(first.position).toBeCloseTo(2.3, 1);
    expect(first.date).toBe(capturedOn);
  });

  it("parses second row correctly (mobile, mid-position)", () => {
    const result = parseGscRows(gscSample.rows, capturedOn);
    const second = result[1];
    expect(second.query).toBe("ahpra registration renewal");
    expect(second.clicks).toBe(17);
    expect(second.impressions).toBe(430);
    expect(second.position).toBeCloseTo(8.7, 1);
    expect(second.device).toBe("MOBILE");
  });

  it("returns empty array for empty rows input", () => {
    const result = parseGscRows([], capturedOn);
    expect(result).toHaveLength(0);
  });

  it("handles row with empty query string gracefully", () => {
    // Row index 3 has keys: ["", page, country, device]
    const result = parseGscRows(gscSample.rows, capturedOn);
    const emptyQueryRow = result[3];
    expect(emptyQueryRow.query).toBe("");
    expect(emptyQueryRow.clicks).toBe(0);
    expect(emptyQueryRow.impressions).toBe(50);
  });

  it("rounds fractional clicks to integer", () => {
    const fractionalRows = [
      {
        keys: ["test keyword", "https://example.com/page", "aus", "DESKTOP"],
        clicks: 3.7,
        impressions: 100.4,
        ctr: 0.037,
        position: 5.0,
      },
    ];
    const result = parseGscRows(fractionalRows, capturedOn);
    expect(result[0].clicks).toBe(4);
    expect(result[0].impressions).toBe(100);
  });

  it("fills missing keys fields with empty strings", () => {
    const rowWithNoKeys = [{ keys: undefined, clicks: 1, impressions: 5, ctr: 0.2, position: 3.0 }];
    // Should not throw — should produce a row with empty string fields
    expect(() => parseGscRows(rowWithNoKeys as never, capturedOn)).not.toThrow();
    const result = parseGscRows(rowWithNoKeys as never, capturedOn);
    expect(result[0].query).toBe("");
    expect(result[0].page).toBe("");
  });
});

// ── fetchGscYesterday integration tests ──────────────────────────────────────

describe("fetchGscYesterday", () => {
  it("returns ok:false when env vars are missing", async () => {
    const orig = process.env.GSC_SERVICE_ACCOUNT_JSON;
    delete process.env.GSC_SERVICE_ACCOUNT_JSON;

    const result = await fetchGscYesterday();
    expect(result.ok).toBe(false);
    expect(result.rows).toBe(0);
    expect(result.detail).toMatch(/not set/i);

    process.env.GSC_SERVICE_ACCOUNT_JSON = orig;
  });

  it("returns ok:false when GSC_SERVICE_ACCOUNT_JSON is invalid JSON", async () => {
    const orig = process.env.GSC_SERVICE_ACCOUNT_JSON;
    process.env.GSC_SERVICE_ACCOUNT_JSON = "{ this is not json }";

    const result = await fetchGscYesterday();
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/Bad GSC_SERVICE_ACCOUNT_JSON/i);

    process.env.GSC_SERVICE_ACCOUNT_JSON = orig;
  });

  it("returns ok:true and upserts rows from mocked GSC API", async () => {
    const result: GscFetchSummary = await fetchGscYesterday();
    expect(result.ok).toBe(true);
    expect(result.rows).toBe(4); // 4 rows in fixture
    expect(result.detail).toMatch(/upserted 4/i);
  });

  it("is idempotent — running twice for the same date doesn't double-count", async () => {
    // Call once more (DB already has rows from the previous test via upsert)
    const second = await fetchGscYesterday();
    expect(second.ok).toBe(true);
    expect(second.rows).toBe(4); // still 4, not 8

    // Confirm DB row count is still 4 (ON CONFLICT DO UPDATE)
    const { rows } = await testPool.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM gsc_daily_snapshot"
    );
    expect(Number(rows[0].n)).toBe(4);
  });

  it("returns date field in YYYY-MM-DD format", async () => {
    const result = await fetchGscYesterday();
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
