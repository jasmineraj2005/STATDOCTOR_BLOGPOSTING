import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getKeywordTracker, type KeywordRow } from "@/lib/seo/aggregate";
import { PILLAR_LABELS } from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET_LABEL: Record<KeywordRow["bucket"], string> = {
  top3: "Top 3",
  top10: "Top 4–10",
  top100: "Top 11–100",
  unranked: "Unranked",
};
const BUCKET_CLASS: Record<KeywordRow["bucket"], string> = {
  top3: "bg-leaf text-white",
  top10: "bg-electric text-ink",
  top100: "bg-lavender text-ocean",
  unranked: "bg-ink/10 text-ink/60",
};

export default async function KeywordsPage() {
  if (!(await isAuthorised())) redirect("/admin/login");
  const rows = await getKeywordTracker();

  return (
    <main className="min-h-[calc(100vh-3.5rem)] pt-10 pb-32 px-6">
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="eyebrow text-ocean mb-3">Search performance</div>
            <h1 className="display text-4xl md:text-5xl">Tracked keywords</h1>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin/seo" className="text-ink/60 hover:text-ocean">
              Overview
            </Link>
            <Link href="/admin/seo/keywords" className="text-ocean font-medium">
              Keywords
            </Link>
            <Link href="/admin/seo/aeo" className="text-ink/60 hover:text-ocean">
              AEO log
            </Link>
          </nav>
        </div>
        <p className="text-muted text-sm mb-8">
          Targets you want to rank for. Position is averaged over the last 7 days; clicks +
          impressions are summed over the last 30. Add or remove targets below.
        </p>

        <AddKeywordForm />

        {rows.length === 0 ? (
          <div className="py-10 text-center rounded-2xl border border-dashed border-ink/15">
            <p className="display text-xl text-muted italic">
              No tracked keywords yet. Add some above.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-muted">
                <th className="py-2 pr-3">Keyword</th>
                <th className="py-2 pr-3">Pillar</th>
                <th className="py-2 pr-3">Bucket</th>
                <th className="py-2 pr-3 text-right">Position</th>
                <th className="py-2 pr-3 text-right">Clicks (30d)</th>
                <th className="py-2 pr-3 text-right">Impressions (30d)</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.keyword} className="border-t border-ink/5">
                  <td className="py-2 pr-3">{r.keyword}</td>
                  <td className="py-2 pr-3 text-ink/70">{PILLAR_LABELS[r.pillar] ?? r.pillar}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded mono text-[9px] tracking-widest uppercase ${BUCKET_CLASS[r.bucket]}`}>
                      {BUCKET_LABEL[r.bucket]}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right mono">
                    {r.position == null ? "—" : r.position.toFixed(1)}
                  </td>
                  <td className="py-2 pr-3 text-right mono">{r.clicks_30d}</td>
                  <td className="py-2 pr-3 text-right mono">{r.impressions_30d}</td>
                  <td className="py-2 text-right">
                    <form action="/api/seo/keywords/delete" method="POST">
                      <input type="hidden" name="keyword" value={r.keyword} />
                      <button
                        type="submit"
                        className="mono text-[10px] text-ink/40 hover:text-red-600"
                      >
                        REMOVE
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

function AddKeywordForm() {
  const pillars = Object.keys(PILLAR_LABELS);
  return (
    <form
      action="/api/seo/keywords/add"
      method="POST"
      className="mb-8 p-4 rounded-2xl bg-white border border-ink/10 flex flex-wrap gap-3 items-end"
    >
      <label className="block flex-1 min-w-[220px]">
        <span className="eyebrow text-muted">Keyword</span>
        <input
          name="keyword"
          required
          placeholder="locum gp rates nsw"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-ink/15 bg-white text-sm"
        />
      </label>
      <label className="block w-[220px]">
        <span className="eyebrow text-muted">Pillar</span>
        <select
          name="pillar"
          required
          className="mt-1 w-full px-3 py-2 rounded-lg border border-ink/15 bg-white text-sm"
        >
          {pillars.map((p) => (
            <option key={p} value={p}>
              {PILLAR_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="px-4 py-2 rounded-full bg-ocean text-white mono text-[10px] tracking-widest hover:bg-ink transition-colors"
      >
        ADD
      </button>
    </form>
  );
}
