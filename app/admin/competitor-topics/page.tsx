import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProposedTopic = {
  id: string;
  working_title: string;
  content_type: "guide" | "company";
  pillar: string;
  target_keywords: string[];
  competitor_inspiration: string[];
  source_titles: string[];
};

type AuditResult = {
  ts: string;
  raw_count: number;
  proposed_count: number;
  proposed: ProposedTopic[];
  per_competitor: Record<string, number>;
  errors: { competitor: string; error: string }[];
};

function isAuthorised(): boolean {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return true; // local dev — no token configured
  const provided = cookies().get("admin_token")?.value;
  return provided === adminToken;
}

export default async function CompetitorTopicsAdmin() {
  if (!isAuthorised()) {
    redirect("/admin/login");
  }

  let result: AuditResult | null = null;
  let approvedIds: string[] = [];
  let kvError: string | null = null;

  try {
    result = (await kv.get<AuditResult>("competitor:proposed:latest")) ?? null;
    approvedIds = (await kv.get<string[]>("competitor:approved-ids")) ?? [];
  } catch (e) {
    kvError = String(e);
  }

  const lastRun = result?.ts ? new Date(result.ts).toLocaleString("en-AU") : "never";
  const proposed = result?.proposed ?? [];
  const unapproved = proposed.filter((p) => !approvedIds.includes(p.id));

  return (
    <main className="min-h-screen bg-white pt-24 pb-32 px-6">
      <div className="max-w-[1100px] mx-auto">
        <div className="eyebrow text-ocean mb-3">Editorial admin</div>
        <h1 className="display text-4xl md:text-5xl mb-2">Competitor topic proposals</h1>
        <p className="text-muted text-sm mb-6">
          Last cron run: <span className="font-medium text-ink">{lastRun}</span>
          {result && (
            <>
              {" · "}
              <span>{result.raw_count} raw titles scraped</span>
              {" · "}
              <span>{result.proposed_count} proposed</span>
              {" · "}
              <span>{approvedIds.length} approved</span>
            </>
          )}
        </p>

        {kvError && (
          <div className="mb-6 p-4 rounded-xl bg-ocean/5 border border-ocean/15 text-sm text-ink/80">
            <strong>KV unavailable:</strong> {kvError}. Configure Vercel KV env vars to persist results.
          </div>
        )}

        {result?.errors && result.errors.length > 0 && (
          <div className="mb-6 p-4 rounded-xl bg-electric/15 border border-electric/30 text-sm text-ink/80">
            <strong>Fetch errors:</strong>{" "}
            {result.errors.map((e) => `${e.competitor}: ${e.error}`).join(" · ")}
          </div>
        )}

        {unapproved.length === 0 ? (
          <div className="py-20 text-center">
            <p className="display text-2xl text-muted italic">
              {result
                ? "No new proposals — every cluster is already approved or the cron hasn't found anything new."
                : "No audit run yet. Trigger one with the cron URL or wait for the schedule."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {unapproved.map((p) => (
              <ProposedRow key={p.id} topic={p} />
            ))}
          </ul>
        )}

        {approvedIds.length > 0 && (
          <details className="mt-12 p-5 rounded-2xl bg-lavender/40 border border-ocean/15">
            <summary className="cursor-pointer mono text-xs tracking-widest uppercase text-ocean">
              Approved this cycle ({approvedIds.length}) — copy into evergreen_topics.json
            </summary>
            <pre className="mt-4 text-xs whitespace-pre-wrap text-ink/80 font-mono">
              {JSON.stringify(
                proposed.filter((p) => approvedIds.includes(p.id)),
                null,
                2,
              )}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}

function ProposedRow({ topic }: { topic: ProposedTopic }) {
  const typeChip =
    topic.content_type === "company"
      ? "bg-ocean-soft text-ink"
      : "bg-electric text-ink";

  return (
    <li className="flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-2xl bg-white border border-ink/10 hover:border-ocean/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className={`px-2 py-0.5 rounded mono text-[9px] tracking-widest uppercase ${typeChip}`}>
            {topic.content_type}
          </span>
          <span className="px-2 py-0.5 rounded bg-lavender mono text-[9px] tracking-widest uppercase text-ocean">
            {topic.pillar}
          </span>
          {topic.competitor_inspiration.map((c) => (
            <span
              key={c}
              className="px-2 py-0.5 rounded border border-ink/15 mono text-[9px] tracking-widest uppercase text-muted"
            >
              {c}
            </span>
          ))}
        </div>
        <h3 className="display text-xl leading-tight">{topic.working_title}</h3>
        <p className="mt-1 text-xs text-muted">
          Keywords: {topic.target_keywords.join(", ") || "—"}
        </p>
        {topic.source_titles && topic.source_titles.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink/60 hover:text-ocean">
              Inspired by ({topic.source_titles.length})
            </summary>
            <ul className="mt-2 ml-4 list-disc text-xs text-ink/70 space-y-1">
              {topic.source_titles.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <form action="/api/competitor-topics/approve" method="POST" className="flex gap-2">
        <input type="hidden" name="id" value={topic.id} />
        <button
          type="submit"
          name="action"
          value="approve"
          className="px-4 py-2 rounded-full bg-ocean text-white mono text-[10px] tracking-widest hover:bg-ink transition-colors"
        >
          APPROVE
        </button>
        <button
          type="submit"
          name="action"
          value="reject"
          className="px-4 py-2 rounded-full bg-white border border-ink/20 text-ink mono text-[10px] tracking-widest hover:bg-ink hover:text-white transition-colors"
        >
          REJECT
        </button>
      </form>
    </li>
  );
}
