/**
 * bing.test.ts
 *
 * Tests for the Bing Webmaster Tools module.
 *
 * Strategy:
 * - Unit-test parseBingRows (pure function extracted from fetchBingYesterday).
 * - Integration-test fetchBingYesterday with fetch mocked globally and DB via pg-mem.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { newDb } from "pg-mem";
import type { Pool as PgPool } from "pg";
import bingSample from "../../tests/fixtures/seo/bing-sample.json";

// ── pg-mem setup ─────────────────────────────────────────────────────────────

const memDb = newDb();
const { Pool: MemPool } = memDb.adapters.createPg() as { Pool: new () => PgPool };
const testPool = new MemPool();

const BING_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS bing_daily_snapshot (
  date         DATE       NOT NULL,
  query        TEXT       NOT NULL,
  page         TEXT       NOT NULL DEFAULT '',
  clicks       INT        NOT NULL DEFAULT 0,
  impressions  INT        NOT NULL DEFAULT 0,
  position     NUMERIC    NOT NULL DEFAULT 0,
  PRIMARY KEY (date, query, page)
);
`;

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

import { fetchBingYesterday, parseBingRows, type BingFetchSummary } from "./bing";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await testPool.query(BING_BOOTSTRAP_SQL);
  process.env.BING_WEBMASTER_API_KEY = "test-api-key-abc123";
  process.env.BING_SITE_URL = "https://statdoctor.app/";
});

afterAll(async () => {
  delete process.env.BING_WEBMASTER_API_KEY;
  delete process.env.BING_SITE_URL;
  await testPool.end();
});

// ── parseBingRows unit tests ──────────────────────────────────────────────────

describe("parseBingRows", () => {
  // The fixture date "/Date(1747526400000+0000)/" → 2026-05-18 (UTC)
  // All 3 first rows share this date, the 4th has a different date.
  const targetDate = new Date(1747526400000).toISOString().slice(0, 10);

  it("filters to only rows matching targetDate", () => {
    const result = parseBingRows(bingSample.d, targetDate);
    // Fixture has 3 rows for targetDate and 1 for a different date
    expect(result).toHaveLength(3);
  });

  it("maps Query, Clicks, Impressions, AvgImpressionPosition correctly", () => {
    const result = parseBingRows(bingSample.d, targetDate);
    const first = result[0];
    expect(first.query).toBe("locum doctor pay rates");
    expect(first.clicks).toBe(12);
    expect(first.impressions).toBe(380);
    expect(first.position).toBeCloseTo(3.5, 1); // AvgImpressionPosition
    expect(first.date).toBe(targetDate);
  });

  it("maps second row correctly", () => {
    const result = parseBingRows(bingSample.d, targetDate);
    const second = result[1];
    expect(second.query).toBe("ahpra registration");
    expect(second.clicks).toBe(8);
    expect(second.impressions).toBe(210);
    expect(second.position).toBeCloseTo(7.8, 1);
  });

  it("returns empty array when no rows match the target date", () => {
    const result = parseBingRows(bingSample.d, "2000-01-01");
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    const result = parseBingRows([], targetDate);
    expect(result).toHaveLength(0);
  });

  it("handles malformed Date field gracefully — row is excluded", () => {
    const malformedRows = [
      {
        Query: "test",
        Clicks: 5,
        Impressions: 100,
        AvgClickPosition: 2.0,
        AvgImpressionPosition: 3.0,
        Date: "not-a-valid-bing-date",
      },
    ];
    // parseBingDate returns "" for malformed, which won't match targetDate
    const result = parseBingRows(malformedRows, targetDate);
    expect(result).toHaveLength(0);
  });
});

// ── fetchBingYesterday integration tests ─────────────────────────────────────

describe("fetchBingYesterday", () => {
  // We need yesterday's date to match what we'll set in the mock response.
  // The Bing API returns rows for its own dates, and the function filters by "yesterday".
  // So we craft a fixture response that has rows for yesterday.
  function makeYesterdayFixture() {
    // Bing's parseBingDate uses UTC (via toISOString), so we must anchor to UTC midnight.
    const yesterdayDate = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    const yesterdayMs = new Date(yesterdayDate + "T00:00:00.000Z").getTime();
    return {
      d: [
        {
          Query: "locum pay",
          Clicks: 10,
          Impressions: 200,
          AvgClickPosition: 2.0,
          AvgImpressionPosition: 3.0,
          Date: `/Date(${yesterdayMs}+0000)/`,
        },
        {
          Query: "ahpra fees",
          Clicks: 5,
          Impressions: 90,
          AvgClickPosition: 4.0,
          AvgImpressionPosition: 6.0,
          Date: `/Date(${yesterdayMs}+0000)/`,
        },
      ],
    };
  }

  it("returns ok:false when env vars are missing", async () => {
    const orig = process.env.BING_WEBMASTER_API_KEY;
    delete process.env.BING_WEBMASTER_API_KEY;

    const result = await fetchBingYesterday();
    expect(result.ok).toBe(false);
    expect(result.rows).toBe(0);
    expect(result.detail).toMatch(/not set/i);

    process.env.BING_WEBMASTER_API_KEY = orig;
  });

  it("returns ok:false when Bing API returns non-ok status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 403, statusText: "Forbidden" }),
    );
    const result = await fetchBingYesterday();
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/403/);
  });

  it("returns ok:false when fetch throws", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network failure"));
    const result = await fetchBingYesterday();
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/Network failure/i);
  });

  it("returns ok:true with rows:0 when API returns no rows for yesterday", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ d: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result: BingFetchSummary = await fetchBingYesterday();
    expect(result.ok).toBe(true);
    expect(result.rows).toBe(0);
    expect(result.detail).toMatch(/No Bing rows/i);
  });

  it("returns ok:true and upserts yesterday rows from mocked Bing API", async () => {
    const fixture = makeYesterdayFixture();
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result: BingFetchSummary = await fetchBingYesterday();
    expect(result.ok).toBe(true);
    expect(result.rows).toBe(2);
    expect(result.detail).toMatch(/upserted 2/i);
  });

  it("is idempotent — calling twice for same date keeps row count stable", async () => {
    const fixture = makeYesterdayFixture();
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await fetchBingYesterday(); // first call
    await fetchBingYesterday(); // second call — ON CONFLICT DO UPDATE

    const { rows } = await testPool.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM bing_daily_snapshot",
    );
    // Should still be 2, not 4
    expect(Number(rows[0].n)).toBe(2);
  });

  it("returns date field in YYYY-MM-DD format", async () => {
    const fixture = makeYesterdayFixture();
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await fetchBingYesterday();
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
