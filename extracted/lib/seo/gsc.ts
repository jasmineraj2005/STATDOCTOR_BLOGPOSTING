import "server-only";

import { google, type webmasters_v3 } from "googleapis";
import { sql, isDbConfigured } from "@/lib/admin/db";

/**
 * Pull yesterday's data from Google Search Console and upsert it into
 * gsc_daily_snapshot. Designed to be called from /api/cron/seo-snapshot.
 *
 * Required env:
 *   - GSC_SERVICE_ACCOUNT_JSON  (the entire service account JSON, single line)
 *   - GSC_SITE_URL              (e.g. "https://statdoctor.app/")
 *
 * The service account email must be added as an Owner in the GSC property.
 */

export type GscFetchSummary = {
  ok: boolean;
  date: string;
  rows: number;
  detail: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchGscYesterday(): Promise<GscFetchSummary> {
  const json = process.env.GSC_SERVICE_ACCOUNT_JSON;
  const site = process.env.GSC_SITE_URL;
  const yesterday = new Date(Date.now() - 24 * 3600_000);
  const date = ymd(yesterday);

  if (!json || !site) {
    return {
      ok: false,
      date,
      rows: 0,
      detail: "GSC_SERVICE_ACCOUNT_JSON or GSC_SITE_URL not set",
    };
  }
  if (!isDbConfigured()) {
    return { ok: false, date, rows: 0, detail: "POSTGRES_URL not set" };
  }

  let creds: { client_email: string; private_key: string };
  try {
    creds = JSON.parse(json);
  } catch (e) {
    return { ok: false, date, rows: 0, detail: `Bad GSC_SERVICE_ACCOUNT_JSON: ${String(e)}` };
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const webmasters = google.webmasters({ version: "v3", auth });

  let resp: webmasters_v3.Schema$SearchAnalyticsQueryResponse;
  try {
    const { data } = await webmasters.searchanalytics.query({
      siteUrl: site,
      requestBody: {
        startDate: date,
        endDate: date,
        dimensions: ["query", "page", "country", "device"],
        rowLimit: 25000,
      },
    });
    resp = data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, date, rows: 0, detail: `GSC API error: ${msg}` };
  }

  const rows = resp.rows ?? [];
  if (rows.length === 0) {
    return { ok: true, date, rows: 0, detail: "No rows for this date (GSC has a 2-3 day delay)" };
  }

  // Upsert in chunks of 200 to avoid massive single statements.
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    for (const r of chunk) {
      const [query, page, country, device] = r.keys ?? ["", "", "", ""];
      await sql`
        INSERT INTO gsc_daily_snapshot (date, query, page, country, device, clicks, impressions, position)
        VALUES (
          ${date},
          ${query ?? ""},
          ${page ?? ""},
          ${country ?? ""},
          ${device ?? ""},
          ${Math.round(r.clicks ?? 0)},
          ${Math.round(r.impressions ?? 0)},
          ${r.position ?? 0}
        )
        ON CONFLICT (date, query, page, country, device) DO UPDATE SET
          clicks      = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          position    = EXCLUDED.position
      `;
      upserted += 1;
    }
  }
  return { ok: true, date, rows: upserted, detail: `Upserted ${upserted} rows for ${date}` };
}
