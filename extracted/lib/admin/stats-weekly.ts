/**
 * Growth dashboard aggregator for /admin/stats.
 *
 * Distinct from lib/seo/aggregate.ts (operational keyword/article tracker) —
 * this one shows CEO-level momentum: weekly published count, 8-week trend,
 * AEO citations. Empty-state when GSC data is still propagating.
 */
export type WeeklyPublishedRow = { week: string; count: number };
export type TopQueryRow = { query: string; clicks: number; impressions: number };
export type TrendPoint = { date: string; clicks: number; impressions: number };

export type StatsWeekly = {
  propagating: boolean;
  weekly_published: WeeklyPublishedRow[];
  gsc_top10: TopQueryRow[];
  gsc_trend: TrendPoint[];
  bing_trend: TrendPoint[];
  aeo_28d: number;
};

export type StatsDb = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

async function safeQuery<T>(
  db: StatsDb,
  text: string,
  values?: unknown[],
): Promise<T[]> {
  try {
    const res = await db.query(text, values);
    return res.rows as T[];
  } catch {
    return [];
  }
}

export async function aggregateWeekly(db: StatsDb): Promise<StatsWeekly> {
  const [weekly, top10, gscTrend, bingTrend, aeo] = await Promise.all([
    safeQuery<{ week: Date | string; count: number | string }>(
      db,
      `SELECT date_trunc('week', generated_at) AS week, COUNT(*)::int AS count
         FROM posts
         WHERE status = 'published'
           AND generated_at > NOW() - INTERVAL '8 weeks'
           AND slug NOT LIKE '__canary-%'
         GROUP BY 1
         ORDER BY 1`,
    ),
    safeQuery<{ query: string; clicks: number; impressions: number }>(
      db,
      `SELECT query,
              SUM(clicks)::int      AS clicks,
              SUM(impressions)::int AS impressions
         FROM gsc_daily_snapshot
         WHERE date > CURRENT_DATE - 28
         GROUP BY query
         ORDER BY impressions DESC
         LIMIT 10`,
    ),
    safeQuery<{ date: Date | string; clicks: number; impressions: number }>(
      db,
      `SELECT date,
              SUM(clicks)::int      AS clicks,
              SUM(impressions)::int AS impressions
         FROM gsc_daily_snapshot
         WHERE date > CURRENT_DATE - 56
         GROUP BY date
         ORDER BY date`,
    ),
    safeQuery<{ date: Date | string; clicks: number; impressions: number }>(
      db,
      `SELECT date,
              SUM(clicks)::int      AS clicks,
              SUM(impressions)::int AS impressions
         FROM bing_daily_snapshot
         WHERE date > CURRENT_DATE - 56
         GROUP BY date
         ORDER BY date`,
    ),
    safeQuery<{ count: number }>(
      db,
      `SELECT COUNT(*)::int AS count
         FROM aeo_log
         WHERE cited = true
           AND ts > NOW() - INTERVAL '28 days'`,
    ),
  ]);

  const stringDate = (v: Date | string): string =>
    typeof v === "string" ? v : v.toISOString().slice(0, 10);

  return {
    propagating: top10.length === 0 && gscTrend.length === 0,
    weekly_published: weekly.map((r) => ({
      week: stringDate(r.week),
      count: Number(r.count),
    })),
    gsc_top10: top10.map((r) => ({
      query: r.query,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
    })),
    gsc_trend: gscTrend.map((r) => ({
      date: stringDate(r.date),
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
    })),
    bing_trend: bingTrend.map((r) => ({
      date: stringDate(r.date),
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
    })),
    aeo_28d: aeo[0]?.count ?? 0,
  };
}
