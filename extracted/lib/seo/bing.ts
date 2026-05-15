import "server-only";

import { sql, isDbConfigured } from "@/lib/admin/db";

/**
 * Pull yesterday's query stats from Bing Webmaster Tools.
 *
 * Required env:
 *   - BING_WEBMASTER_API_KEY
 *   - BING_SITE_URL  (e.g. "https://statdoctor.app/")
 *
 * Bing's free tier covers everything we need. Slightly behind GSC for AU
 * traffic, but matters because Bing crawls drive ChatGPT search citations.
 */

export type BingFetchSummary = {
  ok: boolean;
  date: string;
  rows: number;
  detail: string;
};

export type BingSnapshotRow = {
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type BingQueryStat = {
  Query: string;
  Clicks: number;
  Impressions: number;
  AvgClickPosition: number;
  AvgImpressionPosition: number;
  Date: string; // "/Date(1747526400000+0000)/" — needs parsing
};

export function parseBingDate(raw: string): string {
  const match = raw.match(/\/Date\((-?\d+)/);
  if (!match) return "";
  return ymd(new Date(Number(match[1])));
}

/**
 * Pure parser: filters raw Bing API rows to only those matching targetDate,
 * and maps them to snapshot rows ready for DB upsert.
 * Exported so it can be unit-tested independently of the API / DB layer.
 */
export function parseBingRows(rows: BingQueryStat[], targetDate: string): BingSnapshotRow[] {
  return rows
    .filter((r) => parseBingDate(r.Date) === targetDate)
    .map((r) => ({
      date: targetDate,
      query: r.Query,
      page: "",
      clicks: r.Clicks,
      impressions: r.Impressions,
      position: r.AvgImpressionPosition,
    }));
}

export async function fetchBingYesterday(): Promise<BingFetchSummary> {
  const apiKey = process.env.BING_WEBMASTER_API_KEY;
  const site = process.env.BING_SITE_URL;
  const yesterday = new Date(Date.now() - 24 * 3600_000);
  const date = ymd(yesterday);

  if (!apiKey || !site) {
    return {
      ok: false,
      date,
      rows: 0,
      detail: "BING_WEBMASTER_API_KEY or BING_SITE_URL not set",
    };
  }
  if (!isDbConfigured()) {
    return { ok: false, date, rows: 0, detail: "POSTGRES_URL not set" };
  }

  const url = `https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl=${encodeURIComponent(site)}&apikey=${apiKey}`;

  let body: { d?: BingQueryStat[] };
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return { ok: false, date, rows: 0, detail: `Bing ${res.status}` };
    }
    body = (await res.json()) as typeof body;
  } catch (e) {
    return {
      ok: false,
      date,
      rows: 0,
      detail: `Bing fetch threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const all = body.d ?? [];
  const filtered = parseBingRows(all, date);
  if (filtered.length === 0) {
    return {
      ok: true,
      date,
      rows: 0,
      detail: `No Bing rows for ${date} (returned ${all.length} total across all dates)`,
    };
  }

  for (const r of filtered) {
    await sql`
      INSERT INTO bing_daily_snapshot (date, query, page, clicks, impressions, position)
      VALUES (
        ${r.date},
        ${r.query},
        ${r.page},
        ${r.clicks},
        ${r.impressions},
        ${r.position}
      )
      ON CONFLICT (date, query, page) DO UPDATE SET
        clicks      = EXCLUDED.clicks,
        impressions = EXCLUDED.impressions,
        position    = EXCLUDED.position
    `;
  }
  return { ok: true, date, rows: filtered.length, detail: `Upserted ${filtered.length} Bing rows for ${date}` };
}
