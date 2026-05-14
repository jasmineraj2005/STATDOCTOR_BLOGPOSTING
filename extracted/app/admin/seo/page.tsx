import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import {
  getOverview,
  getArticlePerformance,
  type SeoOverview,
} from "@/lib/seo/aggregate";
import { SeoTrendChart } from "./_chart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SeoOverviewPage() {
  if (!(await isAuthorised())) redirect("/admin/login");

  const [overview, articles] = await Promise.all([
    getOverview(),
    getArticlePerformance(),
  ]);

  return (
    <main className="min-h-[calc(100vh-3.5rem)] pt-10 pb-32 px-6">
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="eyebrow text-ocean mb-3">Search performance</div>
            <h1 className="display text-4xl md:text-5xl">SEO progress</h1>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin/seo" className="text-ocean font-medium">
              Overview
            </Link>
            <Link href="/admin/seo/keywords" className="text-ink/60 hover:text-ocean">
              Keywords
            </Link>
            <Link href="/admin/seo/aeo" className="text-ink/60 hover:text-ocean">
              AEO log
            </Link>
          </nav>
        </div>
        <p className="text-muted text-sm mb-8">
          Daily snapshot of Google Search Console + Bing Webmaster data. Page-one progress
          takes weeks — check back weekly, not hourly.
        </p>

        {!overview.has_data ? (
          <EmptyState />
        ) : (
          <>
            <TilesRow overview={overview} />
            <section className="mt-10 p-5 rounded-2xl bg-white border border-ink/10">
              <h2 className="eyebrow text-muted mb-3">Impressions + clicks (last 90 days)</h2>
              <SeoTrendChart points={overview.trend} />
            </section>
            <QuickWins overview={overview} />
            <ArticlesTable rows={articles} />
          </>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="py-14 px-6 rounded-2xl border border-dashed border-ink/20 bg-lavender/30">
      <h2 className="display text-2xl mb-2">Warming up</h2>
      <p className="text-sm text-ink/80 max-w-xl mb-4">
        No Google Search Console data yet. Two things need to happen:
      </p>
      <ol className="list-decimal pl-5 text-sm space-y-2 text-ink/80">
        <li>
          Verify <span className="mono">statdoctor.app</span> ownership in{" "}
          <a
            href="https://search.google.com/search-console"
            className="text-ocean underline"
          >
            Google Search Console
          </a>{" "}
          and submit your sitemap.
        </li>
        <li>
          Add the service-account email (from{" "}
          <span className="mono">GSC_SERVICE_ACCOUNT_JSON</span>) as an Owner of the property.
        </li>
        <li>
          Wait 2-3 days for GSC's reporting lag — then the daily{" "}
          <span className="mono">seo-snapshot</span> cron populates this page.
        </li>
      </ol>
      <p className="mt-4 text-xs text-muted">
        See <span className="mono">HANDOVER.md</span> for the full day-1 setup.
      </p>
    </div>
  );
}

function TilesRow({ overview }: { overview: SeoOverview }) {
  const tiles = [
    {
      label: "Impressions (90d)",
      value: overview.headline.impressions_90d.toLocaleString(),
    },
    { label: "Clicks (90d)", value: overview.headline.clicks_90d.toLocaleString() },
    { label: "Avg position", value: overview.headline.avg_position_90d.toFixed(1) },
    { label: "CTR", value: `${(overview.headline.ctr_90d * 100).toFixed(1)}%` },
    { label: "Indexed pages", value: overview.headline.indexed_pages.toString() },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="p-4 rounded-2xl bg-white border border-ink/10">
          <div className="eyebrow text-muted mb-2">{t.label}</div>
          <div className="display text-2xl tracking-tight">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

function QuickWins({ overview }: { overview: SeoOverview }) {
  if (overview.quick_wins.length === 0) return null;
  return (
    <section className="mt-10 p-5 rounded-2xl bg-electric/10 border border-electric/40">
      <h2 className="eyebrow text-ocean mb-1">Quick wins</h2>
      <p className="text-xs text-muted mb-3">
        Queries ranking 5–15 with ≥50 impressions in the last 30 days. Rewriting the meta
        description or title tag often moves these onto page one.
      </p>
      <ul className="space-y-2">
        {overview.quick_wins.map((q) => (
          <li
            key={q.query + q.page}
            className="flex items-center gap-3 py-1 text-sm"
          >
            <span className="mono text-[10px] text-muted w-10">#{q.position.toFixed(1)}</span>
            <span className="flex-1 truncate" title={q.query}>
              {q.query}
            </span>
            <span className="mono text-[10px] text-muted">
              {q.impressions} imp · {q.clicks} clk · {(q.ctr * 100).toFixed(1)}% CTR
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticlesTable({
  rows,
}: {
  rows: {
    page: string;
    clicks_90d: number;
    impressions_90d: number;
    avg_position_90d: number;
    top_query: string | null;
  }[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10 p-5 rounded-2xl bg-white border border-ink/10">
      <h2 className="eyebrow text-muted mb-3">Article performance (last 90d)</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-widest text-muted">
            <th className="py-2 pr-3">Page</th>
            <th className="py-2 pr-3">Top query</th>
            <th className="py-2 pr-3 text-right">Clicks</th>
            <th className="py-2 pr-3 text-right">Impressions</th>
            <th className="py-2 text-right">Avg position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.page} className="border-t border-ink/5">
              <td
                className="py-2 pr-3 truncate max-w-[260px]"
                title={r.page}
              >
                {r.page}
              </td>
              <td
                className="py-2 pr-3 truncate max-w-[220px] text-ink/70"
                title={r.top_query ?? ""}
              >
                {r.top_query ?? "—"}
              </td>
              <td className="py-2 pr-3 text-right mono">{r.clicks_90d}</td>
              <td className="py-2 pr-3 text-right mono">{r.impressions_90d}</td>
              <td className="py-2 text-right mono">{r.avg_position_90d.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
