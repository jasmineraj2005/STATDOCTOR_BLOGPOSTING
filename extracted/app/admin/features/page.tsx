import Link from "next/link";
import { redirect } from "next/navigation";
import ShaderBackground from "@/components/shader-background";
import { isAuthorised } from "@/lib/admin/auth";
import { isDbConfigured, pool } from "@/lib/admin/db";
import {
  computeStatsSummary,
  type StatsSummary,
} from "@/lib/admin/stats-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GLASS_CARD: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.10)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
};

const PILLAR_CHIP: React.CSSProperties = {
  background: "rgba(139, 92, 246, 0.25)",
  color: "#c4b5fd",
  border: "1px solid rgba(139, 92, 246, 0.35)",
};

export default async function FeaturesPage() {
  if (!(await isAuthorised())) redirect("/login");

  const summary = await computeStatsSummary(
    isDbConfigured()
      ? {
          query: async (text, values) => {
            const r = await pool().query(text, values as unknown[]);
            return { rows: r.rows };
          },
        }
      : null,
  );

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
                How this is built
              </h1>
            </div>
            <nav className="flex gap-4 text-sm">
              <Link href="/admin/posts" className="text-white/60 hover:text-violet-200">
                Posts
              </Link>
              <Link href="/admin/seo" className="text-white/60 hover:text-violet-200">
                SEO
              </Link>
              <Link href="/admin/stats" className="text-white/60 hover:text-violet-200">
                Growth
              </Link>
              <Link href="/admin/features" className="text-violet-200 font-medium">
                System
              </Link>
            </nav>
          </div>
          <p className="text-white/60 text-sm mb-8 font-light max-w-2xl">
            The StatDoctor blog system is engineered for AHPRA-grade editorial confidence with
            unattended operation. Five agents write each article; four fail-agent layers catch
            problems before they reach print.
          </p>

          <CountersRow summary={summary} />

          <Section title="5-Agent Pipeline" eyebrow="Generation">
            <p className="text-white/70 font-light leading-relaxed mb-4">
              Every article is written by five specialised agents in sequence. Each one&apos;s
              output feeds the next, with hard validators between stages.
            </p>
            <Grid>
              <FeatureCard
                title="Intelligence"
                body="Picks the topic from competitor-audit signals, past-topic dedup, and pillar cadence (40/40/20 news/guide/company)."
              />
              <FeatureCard
                title="Researcher"
                body="Gathers ≥5 authoritative sources (AHPRA, AIHW, Guardian, RACGP). Whitelist-gated. Drops fabricated URLs at generation time."
              />
              <FeatureCard
                title="Writer"
                body="1,500–2,500 word draft. Two-pass: outline → draft. Reads validators.json word floors as hard constraints."
              />
              <FeatureCard
                title="SEO"
                body="Meta tags, focus keyword, JSON-LD schemas (MedicalScholarlyArticle, Person, MedicalBusiness). Schema-validates."
              />
              <FeatureCard
                title="AHPRA"
                body="Compliance scan against banned phrase list (best doctor, guaranteed, world-class…). Auto-fixes or flags for review."
              />
            </Grid>
          </Section>

          <Section title="Fail-Agent System" eyebrow="Self-healing — 4 layers">
            <p className="text-white/70 font-light leading-relaxed mb-4">
              Defence-in-depth so problems either self-recover or page the operator within 60s.
            </p>
            <Grid>
              <FeatureCard
                title="Layer A — Python validators"
                body="After each agent run, fail_agent.py validates the output (source count, word floor, banned phrases, schema). Failures logged to pipeline_runs."
              />
              <FeatureCard
                title="Layer B — Workflow recovery"
                body="Every GitHub Actions cron is wrapped by recover-and-alert composite action. On 2xx miss: retries once after 60s, then dispatches alert via Resend."
              />
              <FeatureCard
                title="Layer C — Ingest gate"
                body="/api/admin/ingest gates on word_count ≥ floor, sources ≥ 5, required schema fields. Strict mode returns 422 with structured validation_errors."
              />
              <FeatureCard
                title="Layer D — Daily canary"
                body="04:00 UTC cron: synthetic article walks ingest → approve → publish-dry → delete. Any step failure pages the operator with full context."
              />
            </Grid>
          </Section>

          <Section title="Compliance" eyebrow="AHPRA-grade">
            <Grid>
              <FeatureCard
                title="AHPRA gate"
                body="Banned-phrase regex set covers superlatives (best, leading, #1, world-class), outcome guarantees, and patient testimonials per s.133(1)(b)."
              />
              <FeatureCard
                title={`URL whitelist (${summary.url_whitelist_size} domains)`}
                body="Six tiers: gov-au, gov-nz, peer-reviewed, mainstream-news, mainstream-aus, professional-body. Versioned in git; PR-only changes."
              />
              <FeatureCard
                title="Sunday review window"
                body="≥95% approve-as-is target in ≤25 minutes. Validator panel blocks Approve until all eight checks green."
              />
              <FeatureCard
                title="WCAG 2.2 AA"
                body="axe-core spec scans /admin/posts and the article view. Violations triaged per success-criterion before launch claim."
              />
            </Grid>
          </Section>

          <Section title="SEO" eyebrow="Structured data">
            <Grid>
              <FeatureCard
                title="MedicalScholarlyArticle"
                body="reviewedBy (Dr Anu Ganugapati AHPRA), citation array from sources[], publicationType (MeSH-aligned)."
              />
              <FeatureCard
                title="Author Person schema"
                body="Renders on each article. AHPRA registration number, affiliation, sameAs LinkedIn."
              />
              <FeatureCard
                title="MedicalBusiness schema"
                body="Org-level at site root. Defines StatDoctor as locum marketplace, served-areas, contact, founders."
              />
              <FeatureCard
                title="Speakable (news only)"
                body="News-type articles emit Speakable schema for voice-assistant excerpting (ChatGPT, Perplexity, voice search)."
              />
            </Grid>
          </Section>

          <Section title="Operational" eyebrow="Unattended for months">
            <Grid>
              <FeatureCard
                title="6 GitHub Actions crons"
                body="pipeline (Mon/Wed/Fri/Sat 14:00), competitor-audit (M/W/F 14:00), scheduled-publish (daily 09:00), seo-snapshot (daily 02:00), daily-digest (22:00), canary (04:00), sunday-batch-report (Mon 09:00)."
              />
              <FeatureCard
                title="Heartbeat monitoring"
                body="Every cron updates cron_runs row. /api/health returns 503 when any cron is stale or last_fail. UptimeRobot fires alerts."
              />
              <FeatureCard
                title="Daily digest email"
                body="22:00 UTC: activity summary + URL-rejection counts + alert digest. Acknowledges alerts so tomorrow's digest doesn't repeat."
              />
              <FeatureCard
                title="Banner state machine"
                body="Top-of-page banner surfaces publish_failed > cron_stale > stale_review > needs_review_high. Operator sees status at a glance."
              />
            </Grid>
          </Section>

          <Section title="Tests" eyebrow="Belt-and-braces">
            <Grid>
              <FeatureCard
                title={`${summary.test_count}+ unit tests`}
                body="Vitest + Pytest. URL-whitelist drift fixture (Python ↔ TypeScript). 5 historical fabricated URLs as permanent fixtures."
              />
              <FeatureCard
                title="Playwright e2e"
                body="Sunday-review flow under 25 min, validator gate, concurrent approve, publish-failed retry, banner-state, axe-core a11y."
              />
              <FeatureCard
                title="G/W/T discipline"
                body="New tests follow Given/When/Then naming. Existing imperative tests preserved; no destructive refactors."
              />
              <FeatureCard
                title="CI blocking"
                body="Vitest + Playwright + Pytest run on every PR. Postgres service for e2e; OPENAI_API_KEY for pytest. No continue-on-error."
              />
            </Grid>
          </Section>

          <div className="mt-12 text-center text-white/40 text-xs font-light">
            <span className="inline-block px-3 py-1 rounded-full" style={PILLAR_CHIP}>
              Built for the long unattended haul
            </span>
          </div>
        </div>
      </main>
    </ShaderBackground>
  );
}

function CountersRow({ summary }: { summary: StatsSummary }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
      <Counter
        testId="counter-published"
        label="Published"
        value={summary.posts_published}
        hint="live articles"
      />
      <Counter
        testId="counter-pending"
        label="In review"
        value={summary.posts_pending}
        hint="Sunday queue"
      />
      <Counter
        testId="counter-whitelist"
        label="Whitelisted domains"
        value={summary.url_whitelist_size}
        hint="trusted sources"
      />
      <Counter
        testId="counter-tests"
        label="Tests passing"
        value={summary.test_count}
        hint="locked-in behaviour"
      />
    </div>
  );
}

function Counter({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: number | string;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="p-5 rounded-2xl" style={GLASS_CARD} data-testid={testId}>
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

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="text-[10px] font-medium tracking-widest uppercase text-violet-300 mb-2">
        {eyebrow}
      </div>
      <h2
        className="text-2xl md:text-3xl font-semibold text-white mb-6"
        style={{ letterSpacing: "-0.015em" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>;
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="p-5 rounded-2xl transition-shadow duration-300 hover:shadow-[0_12px_40px_rgba(139,92,246,0.22)]"
      style={GLASS_CARD}
    >
      <h3 className="text-base font-semibold text-white mb-2" style={{ letterSpacing: "-0.01em" }}>
        {title}
      </h3>
      <p className="text-sm text-white/70 font-light leading-relaxed">{body}</p>
    </div>
  );
}
