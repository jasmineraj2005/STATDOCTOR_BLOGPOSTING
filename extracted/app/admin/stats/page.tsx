import Link from "next/link";
import { redirect } from "next/navigation";
import ShaderBackground from "@/components/shader-background";
import { isAuthorised } from "@/lib/admin/auth";
import { isDbConfigured, pool } from "@/lib/admin/db";
import { aggregateWeekly, type StatsWeekly } from "@/lib/admin/stats-weekly";
import { TrendChart, WeeklyPublishedChart } from "./_charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GLASS_CARD: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.10)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
};

const EMPTY_STATS: StatsWeekly = {
  propagating: true,
  weekly_published: [],
  gsc_top10: [],
  gsc_trend: [],
  bing_trend: [],
  aeo_28d: 0,
};

export default async function StatsPage() {
  if (!(await isAuthorised())) redirect("/login");

  const data = isDbConfigured()
    ? await aggregateWeekly({
        query: async (text, values) => {
          const r = await pool().query(text, values as unknown[]);
          return { rows: r.rows };
        },
      })
    : EMPTY_STATS;

  const totalPublished8w = data.weekly_published.reduce((acc, w) => acc + w.count, 0);
  const totalImpressions = data.gsc_trend.reduce((acc, p) => acc + p.impressions, 0);
  const totalClicks = data.gsc_trend.reduce((acc, p) => acc + p.clicks, 0);

  return (
    <ShaderBackground>
      <main className="relative z-10 min-h-screen pt-14 pb-32 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="flex items-baseline justify-between mb-2">
            <div>
              <div className="text-[10px] font-medium tracking-widest uppercase text-violet-300 mb-3">
                Editorial admin
              </div>
              <h1
                className="text-4xl md:text-5xl font-semibold text-white mb-2"
                style={{ letterSpacing: "-0.02em" }}
              >
                Growth
              </h1>
            </div>
            <nav className="flex gap-4 text-sm">
              <Link href="/admin/posts" className="text-white/60 hover:text-violet-200">
                Posts
              </Link>
              <Link href="/admin/seo" className="text-white/60 hover:text-violet-200">
                SEO
              </Link>
              <Link href="/admin/stats" className="text-violet-200 font-medium">
                Growth
              </Link>
              <Link href="/admin/features" className="text-white/60 hover:text-violet-200">
                System
              </Link>
            </nav>
          </div>
          <p className="text-white/60 text-sm mb-8 font-light">
            CEO-facing growth snapshot. SEO data has a 2–3 day Google reporting lag.
          </p>

          {data.propagating && totalPublished8w === 0 ? (
            <EmptyState />
          ) : (
            <>
              <TilesRow
                published8w={totalPublished8w}
                impressions={totalImpressions}
                clicks={totalClicks}
                aeo28d={data.aeo_28d}
              />

              <section className="mt-10 p-5 rounded-2xl" style={GLASS_CARD}>
                <h2 className="text-[10px] font-medium tracking-widest uppercase text-violet-300 mb-3">
                  Published per week (last 8 weeks)
                </h2>
                <WeeklyPublishedChart rows={data.weekly_published} />
              </section>

              {data.gsc_trend.length > 0 && (
                <section className="mt-6 p-5 rounded-2xl" style={GLASS_CARD}>
                  <h2 className="text-[10px] font-medium tracking-widest uppercase text-violet-300 mb-3">
                    GSC impressions + clicks (last 56 days)
                  </h2>
                  <TrendChart points={data.gsc_trend} label="GSC" />
                </section>
              )}

              {data.bing_trend.length > 0 && (
                <section className="mt-6 p-5 rounded-2xl" style={GLASS_CARD}>
                  <h2 className="text-[10px] font-medium tracking-widest uppercase text-violet-300 mb-3">
                    Bing impressions + clicks (last 56 days)
                  </h2>
                  <TrendChart points={data.bing_trend} label="Bing" />
                </section>
              )}

              {data.gsc_top10.length > 0 && (
                <section className="mt-6 p-5 rounded-2xl" style={GLASS_CARD}>
                  <h2 className="text-[10px] font-medium tracking-widest uppercase text-violet-300 mb-3">
                    Top 10 queries (last 28 days)
                  </h2>
                  <TopQueriesTable rows={data.gsc_top10} />
                </section>
              )}

              {data.propagating && (
                <div className="mt-6 text-white/60 text-sm italic font-light">
                  GSC data takes 2–3 days to propagate after sitemap submission. Check back
                  Friday for the first populated keyword table.
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </ShaderBackground>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="p-5 rounded-2xl" style={GLASS_CARD}>
      <div className="text-[10px] font-medium tracking-widest uppercase text-violet-300 mb-2">
        {label}
      </div>
      <div className="text-3xl font-semibold text-white" style={{ letterSpacing: "-0.01em" }}>
        {value}
      </div>
      {hint && <div className="text-xs text-white/50 mt-1 font-light">{hint}</div>}
    </div>
  );
}

function TilesRow({
  published8w,
  impressions,
  clicks,
  aeo28d,
}: {
  published8w: number;
  impressions: number;
  clicks: number;
  aeo28d: number;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Tile label="Published (8 wks)" value={published8w} hint="across all pillars" />
      <Tile label="Impressions" value={impressions.toLocaleString()} hint="last 56 days, GSC" />
      <Tile label="Clicks" value={clicks.toLocaleString()} hint="last 56 days, GSC" />
      <Tile label="AEO citations" value={aeo28d} hint="last 28 days, logged" />
    </div>
  );
}

function TopQueriesTable({
  rows,
}: {
  rows: Array<{ query: string; clicks: number; impressions: number }>;
}) {
  return (
    <table data-testid="top-queries" className="w-full text-sm">
      <thead>
        <tr className="text-left text-white/50 text-xs uppercase tracking-widest">
          <th className="pb-2 font-medium">Query</th>
          <th className="pb-2 font-medium text-right">Impressions</th>
          <th className="pb-2 font-medium text-right">Clicks</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.query} className="border-t border-white/10">
            <td className="py-2 text-white/85">{row.query}</td>
            <td className="py-2 text-right text-white/85 font-mono">
              {row.impressions.toLocaleString()}
            </td>
            <td className="py-2 text-right text-white/85 font-mono">
              {row.clicks.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState() {
  return (
    <div
      className="py-20 text-center rounded-2xl"
      style={{
        background: "rgba(255, 255, 255, 0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px dashed rgba(255, 255, 255, 0.20)",
      }}
    >
      <p className="text-2xl text-white/70 italic font-light">Nothing to chart yet.</p>
      <p className="text-white/50 text-sm mt-3 font-light max-w-md mx-auto">
        Once articles publish (Tue/Wed/Fri/Sun 09:00 UTC) and Google indexes them, growth
        numbers populate automatically. Expected first data: about a week after launch.
      </p>
    </div>
  );
}
