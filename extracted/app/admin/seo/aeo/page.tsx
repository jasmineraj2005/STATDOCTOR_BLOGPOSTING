import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { sql, isDbConfigured } from "@/lib/admin/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AeoRow = {
  id: number;
  ts: Date | string;
  keyword: string;
  model: string;
  cited: boolean;
  snippet: string | null;
  notes: string | null;
};

async function getRecentEntries(): Promise<AeoRow[]> {
  if (!isDbConfigured()) return [];
  const { rows } = await sql<AeoRow>`
    SELECT id, ts, keyword, model, cited, snippet, notes
      FROM aeo_log
      ORDER BY ts DESC
      LIMIT 50
  `;
  return rows;
}

export default async function AeoPage() {
  if (!(await isAuthorised())) redirect("/login");
  const rows = await getRecentEntries();
  const recent = rows.length;
  const recentCited = rows.filter((r) => r.cited).length;
  const cite_rate = recent > 0 ? Math.round((recentCited / recent) * 100) : 0;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] pt-10 pb-32 px-6">
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="eyebrow text-ocean mb-3">Answer-engine optimisation</div>
            <h1 className="display text-4xl md:text-5xl">AEO citation log</h1>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin/seo" className="text-ink/60 hover:text-ocean">
              Overview
            </Link>
            <Link href="/admin/seo/keywords" className="text-ink/60 hover:text-ocean">
              Keywords
            </Link>
            <Link href="/admin/seo/aeo" className="text-ocean font-medium">
              AEO log
            </Link>
          </nav>
        </div>
        <p className="text-muted text-sm mb-8">
          No free API tracks whether ChatGPT / Claude / Perplexity cite StatDoctor.
          You log each check manually — pick a keyword, ask the model, record the result.
          Pattern over time is what matters; aim for one check per tracked keyword per month.
        </p>

        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="p-4 rounded-2xl bg-white border border-ink/10">
            <div className="eyebrow text-muted mb-2">Checks logged (last 50)</div>
            <div className="display text-2xl">{recent}</div>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-ink/10">
            <div className="eyebrow text-muted mb-2">Of those, cited</div>
            <div className="display text-2xl">{recentCited}</div>
          </div>
          <div className="p-4 rounded-2xl bg-white border border-ink/10">
            <div className="eyebrow text-muted mb-2">Citation rate</div>
            <div className="display text-2xl">{cite_rate}%</div>
          </div>
        </div>

        <LogForm />

        {rows.length === 0 ? (
          <div className="py-10 text-center rounded-2xl border border-dashed border-ink/15">
            <p className="display text-xl text-muted italic">
              No checks yet. Try one now — open ChatGPT in another tab, ask for "best locum
              platform Australia 2026", and log whether StatDoctor was named.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="p-3 rounded-xl bg-white border border-ink/10 text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="mono text-[10px] text-muted">
                    {new Date(r.ts).toLocaleString("en-AU")}
                  </span>
                  <span className="px-1.5 py-0.5 rounded mono text-[9px] tracking-widest uppercase bg-lavender text-ocean">
                    {r.model}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded mono text-[9px] tracking-widest uppercase ${
                      r.cited ? "bg-leaf text-white" : "bg-ink/10 text-ink/60"
                    }`}
                  >
                    {r.cited ? "cited" : "not cited"}
                  </span>
                </div>
                <div className="font-medium">{r.keyword}</div>
                {r.snippet && (
                  <div className="mt-1 text-ink/70 italic text-[12px] line-clamp-2">
                    “{r.snippet}”
                  </div>
                )}
                {r.notes && <div className="mt-1 text-ink/60 text-[12px]">{r.notes}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function LogForm() {
  return (
    <form
      action="/api/seo/aeo/log"
      method="POST"
      className="mb-8 p-4 rounded-2xl bg-white border border-ink/10 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="eyebrow text-muted">Keyword you tested</span>
          <input
            name="keyword"
            required
            placeholder="locum gp rates nsw"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-ink/15 bg-white text-sm"
          />
        </label>
        <label className="block">
          <span className="eyebrow text-muted">Model</span>
          <select
            name="model"
            required
            className="mt-1 w-full px-3 py-2 rounded-lg border border-ink/15 bg-white text-sm"
          >
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="perplexity">Perplexity</option>
            <option value="gemini">Gemini</option>
            <option value="copilot">Copilot</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="eyebrow text-muted">Cited StatDoctor?</span>
        <div className="mt-1 flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" name="cited" value="true" required /> Yes
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="cited" value="false" /> No
          </label>
        </div>
      </label>
      <label className="block">
        <span className="eyebrow text-muted">Snippet (optional)</span>
        <textarea
          name="snippet"
          rows={2}
          placeholder="Paste the model's relevant response excerpt"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-ink/15 bg-white text-sm"
        />
      </label>
      <label className="block">
        <span className="eyebrow text-muted">Notes (optional)</span>
        <input
          name="notes"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-ink/15 bg-white text-sm"
        />
      </label>
      <button
        type="submit"
        className="px-4 py-2 rounded-full bg-ocean text-white mono text-[10px] tracking-widest hover:bg-ink transition-colors"
      >
        LOG CHECK
      </button>
    </form>
  );
}
