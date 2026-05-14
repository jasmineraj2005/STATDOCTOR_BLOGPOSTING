import "server-only";

import { sql, isDbConfigured } from "@/lib/admin/db";

export type Headline = {
  impressions_90d: number;
  clicks_90d: number;
  avg_position_90d: number;
  indexed_pages: number;
  ctr_90d: number;
};

export type KeywordBucket = "top3" | "top10" | "top100" | "unranked";

export type KeywordRow = {
  keyword: string;
  pillar: string;
  position: number | null;
  clicks_30d: number;
  impressions_30d: number;
  bucket: KeywordBucket;
};

export type ArticleRow = {
  page: string;
  clicks_90d: number;
  impressions_90d: number;
  avg_position_90d: number;
  top_query: string | null;
};

export type QuickWin = {
  query: string;
  page: string;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number;
};

export type DailyTrendPoint = {
  date: string;
  impressions: number;
  clicks: number;
};

export type SeoOverview = {
  headline: Headline;
  trend: DailyTrendPoint[];
  quick_wins: QuickWin[];
  has_data: boolean;
};

function bucket(position: number | null): KeywordBucket {
  if (position == null) return "unranked";
  if (position <= 3) return "top3";
  if (position <= 10) return "top10";
  if (position <= 100) return "top100";
  return "unranked";
}

/** Empty-state response when GSC hasn't been wired or no snapshots exist yet. */
const EMPTY_OVERVIEW: SeoOverview = {
  headline: {
    impressions_90d: 0,
    clicks_90d: 0,
    avg_position_90d: 0,
    indexed_pages: 0,
    ctr_90d: 0,
  },
  trend: [],
  quick_wins: [],
  has_data: false,
};

export async function getOverview(): Promise<SeoOverview> {
  if (!isDbConfigured()) return EMPTY_OVERVIEW;
  type CountRow = { n: string | number };
  const { rows: countRows } = await sql<CountRow>`
    SELECT COUNT(*) AS n FROM gsc_daily_snapshot
  `;
  if (Number(countRows[0]?.n ?? 0) === 0) return EMPTY_OVERVIEW;

  type HeadRow = {
    impressions_90d: string;
    clicks_90d: string;
    pos_num: string;
    pos_den: string;
    indexed_pages: string;
  };
  const { rows: headRows } = await sql<HeadRow>`
    SELECT
      COALESCE(SUM(impressions), 0)            AS impressions_90d,
      COALESCE(SUM(clicks), 0)                 AS clicks_90d,
      COALESCE(SUM(position * impressions), 0) AS pos_num,
      COALESCE(SUM(impressions), 0)            AS pos_den,
      COALESCE(COUNT(DISTINCT page), 0)        AS indexed_pages
    FROM gsc_daily_snapshot
    WHERE date >= CURRENT_DATE - INTERVAL '90 days'
  `;
  const h = headRows[0];
  const imp = Number(h?.impressions_90d ?? 0);
  const clk = Number(h?.clicks_90d ?? 0);
  const posDen = Number(h?.pos_den ?? 0);
  const headline: Headline = {
    impressions_90d: imp,
    clicks_90d: clk,
    avg_position_90d: posDen ? Number(h.pos_num) / posDen : 0,
    indexed_pages: Number(h?.indexed_pages ?? 0),
    ctr_90d: imp ? clk / imp : 0,
  };

  type TrendRow = { date: string; impressions: string; clicks: string };
  const { rows: trendRows } = await sql<TrendRow>`
    SELECT date::text AS date,
           COALESCE(SUM(impressions), 0)::text AS impressions,
           COALESCE(SUM(clicks), 0)::text      AS clicks
      FROM gsc_daily_snapshot
      WHERE date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY date
      ORDER BY date ASC
  `;
  const trend: DailyTrendPoint[] = trendRows.map((r) => ({
    date: r.date,
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
  }));

  type QWRow = { query: string; page: string; position: string; clicks: string; impressions: string };
  const { rows: qwRows } = await sql<QWRow>`
    SELECT query, page,
           AVG(position)::numeric(10,2)::text  AS position,
           SUM(clicks)::text       AS clicks,
           SUM(impressions)::text  AS impressions
      FROM gsc_daily_snapshot
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY query, page
      HAVING SUM(impressions) >= 50 AND AVG(position) BETWEEN 5 AND 15
      ORDER BY SUM(impressions) DESC
      LIMIT 10
  `;
  const quick_wins: QuickWin[] = qwRows.map((r) => {
    const imp = Number(r.impressions);
    const clk = Number(r.clicks);
    return {
      query: r.query,
      page: r.page,
      position: Number(r.position),
      clicks: clk,
      impressions: imp,
      ctr: imp ? clk / imp : 0,
    };
  });

  return { headline, trend, quick_wins, has_data: true };
}

export async function getKeywordTracker(): Promise<KeywordRow[]> {
  if (!isDbConfigured()) return [];
  type Row = {
    keyword: string;
    pillar: string;
    position: string | null;
    clicks_30d: string;
    impressions_30d: string;
  };
  const { rows } = await sql<Row>`
    SELECT
      t.keyword,
      t.pillar,
      (SELECT AVG(position) FROM gsc_daily_snapshot s
        WHERE s.query = t.keyword AND s.date >= CURRENT_DATE - INTERVAL '7 days')  AS position,
      COALESCE((SELECT SUM(clicks)      FROM gsc_daily_snapshot s
        WHERE s.query = t.keyword AND s.date >= CURRENT_DATE - INTERVAL '30 days'), 0)::text AS clicks_30d,
      COALESCE((SELECT SUM(impressions) FROM gsc_daily_snapshot s
        WHERE s.query = t.keyword AND s.date >= CURRENT_DATE - INTERVAL '30 days'), 0)::text AS impressions_30d
    FROM keyword_targets t
    ORDER BY t.pillar, t.keyword
  `;
  return rows.map((r) => {
    const pos = r.position == null ? null : Number(r.position);
    return {
      keyword: r.keyword,
      pillar: r.pillar,
      position: pos,
      clicks_30d: Number(r.clicks_30d),
      impressions_30d: Number(r.impressions_30d),
      bucket: bucket(pos),
    };
  });
}

export async function getArticlePerformance(): Promise<ArticleRow[]> {
  if (!isDbConfigured()) return [];
  type Row = {
    page: string;
    clicks_90d: string;
    impressions_90d: string;
    avg_position_90d: string;
    top_query: string | null;
  };
  const { rows } = await sql<Row>`
    WITH ranked AS (
      SELECT page, query,
             SUM(clicks)::int                          AS clicks,
             SUM(impressions)::int                     AS impressions,
             ROW_NUMBER() OVER (PARTITION BY page ORDER BY SUM(impressions) DESC) AS rn
        FROM gsc_daily_snapshot
        WHERE date >= CURRENT_DATE - INTERVAL '90 days' AND page LIKE '%/blog/%'
        GROUP BY page, query
    )
    SELECT
      p.page,
      COALESCE(SUM(p.clicks), 0)::text           AS clicks_90d,
      COALESCE(SUM(p.impressions), 0)::text      AS impressions_90d,
      COALESCE(AVG(s.position), 0)::numeric(10,2)::text AS avg_position_90d,
      (SELECT query FROM ranked WHERE page = p.page AND rn = 1) AS top_query
    FROM (
      SELECT page, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions
        FROM gsc_daily_snapshot
        WHERE date >= CURRENT_DATE - INTERVAL '90 days' AND page LIKE '%/blog/%'
        GROUP BY page
    ) p
    LEFT JOIN gsc_daily_snapshot s
      ON s.page = p.page AND s.date >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY p.page
    ORDER BY COALESCE(SUM(p.clicks), 0) DESC, COALESCE(SUM(p.impressions), 0) DESC
    LIMIT 20
  `;
  return rows.map((r) => ({
    page: r.page,
    clicks_90d: Number(r.clicks_90d),
    impressions_90d: Number(r.impressions_90d),
    avg_position_90d: Number(r.avg_position_90d),
    top_query: r.top_query,
  }));
}
