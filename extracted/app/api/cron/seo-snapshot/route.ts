import { NextResponse } from "next/server";
import { fetchGscYesterday } from "@/lib/seo/gsc";
import { fetchBingYesterday } from "@/lib/seo/bing";
import { recordCronRun } from "@/lib/admin/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily SEO snapshot — pulls yesterday's GSC + Bing data into the DB.
 * GSC and Bing both have a 2-3 day delay, so backfills happen via the
 * upsert (re-running on a recent date just refreshes the rows).
 *
 *   GET /api/cron/seo-snapshot
 *   Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const [gsc, bing] = await Promise.all([
    fetchGscYesterday().catch((e) => ({
      ok: false,
      date: "",
      rows: 0,
      detail: `GSC threw: ${e instanceof Error ? e.message : String(e)}`,
    })),
    fetchBingYesterday().catch((e) => ({
      ok: false,
      date: "",
      rows: 0,
      detail: `Bing threw: ${e instanceof Error ? e.message : String(e)}`,
    })),
  ]);

  // Cron is considered "ok" if either source succeeded — partial degradation
  // is acceptable. Both failing → record as failure and surface an alert.
  const anyOk = gsc.ok || bing.ok;
  await recordCronRun(
    "seo-snapshot",
    anyOk,
    `GSC: ${gsc.detail} | Bing: ${bing.detail}`,
  );

  return NextResponse.json({ ok: anyOk, gsc, bing });
}
