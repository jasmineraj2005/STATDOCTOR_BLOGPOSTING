"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  PILLAR_LABELS,
  type PipelineStats,
  type Post,
} from "@/lib/posts"

export default function AnalyticsDashboard({
  posts,
  stats,
}: {
  posts: Post[]
  stats: PipelineStats
}) {
  return (
    <section className="relative z-10 min-h-[calc(100vh-80px)] px-6 pt-24 pb-20">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1
            className="text-3xl md:text-4xl font-semibold text-white mb-2"
            style={{ letterSpacing: "-0.03em" }}
          >
            Analytics
          </h1>
          <p className="text-sm text-white/50 font-light">
            Pipeline performance and audience insights.
          </p>
        </div>

        {/* ── Pipeline analytics (real data from JSONs) ─────────────────── */}
        <SectionHeading>Pipeline</SectionHeading>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
          <Panel title="Posts by pillar" subtitle="Content coverage across your 6 pillars">
            <PillarChart posts={posts} />
          </Panel>

          <Panel title="Posts over time" subtitle="Generation cadence, last 12 weeks">
            <TimelineChart posts={posts} />
          </Panel>

          <Panel title="Word count per post" subtitle="Length distribution">
            <WordCountChart posts={posts} />
          </Panel>

          <Panel title="Sources cited" subtitle="Authority footprint per post">
            <SourcesChart posts={posts} />
          </Panel>
        </div>

        {/* ── Audience analytics (empty state — needs tracking to be wired) ─ */}
        <SectionHeading>Audience</SectionHeading>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <AudienceStatCard label="Total Views" />
          <AudienceStatCard label="Unique Visitors" />
          <AudienceStatCard label="Avg. Time on Page" />
          <AudienceStatCard label="Click-through Rate" />
        </div>

        <Panel
          title="Top performing posts"
          subtitle="Once tracking is connected, posts will be ranked by engagement here"
        >
          <EmptyAudienceState />
        </Panel>

        <p className="text-[11px] text-white/35 font-light mt-8 text-center max-w-md mx-auto">
          Pipeline data is live from {posts.length} generated post
          {posts.length === 1 ? "" : "s"}. Audience analytics become available
          once the blog is published and a tracker (Google Analytics, Plausible,
          or a self-hosted beacon) is connected.
        </p>
      </div>
    </section>
  )
}

/* ─── Section primitives ──────────────────────────────────────────────── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-medium tracking-widest uppercase text-white/45 mb-4">
      {children}
    </h2>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: "rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
      }}
    >
      <h3 className="text-base font-semibold text-white mb-1" style={{ letterSpacing: "-0.02em" }}>
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-white/45 font-light mb-5">{subtitle}</p>
      )}
      {children}
    </div>
  )
}

function AudienceStatCard({ label }: { label: string }) {
  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={{
        background: "rgba(255, 255, 255, 0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px dashed rgba(255, 255, 255, 0.18)",
      }}
    >
      <div className="text-3xl font-semibold text-white/30" style={{ letterSpacing: "-0.03em" }}>
        —
      </div>
      <div className="text-xs text-white/40 font-light mt-1 tracking-wide">{label}</div>
    </div>
  )
}

function EmptyAudienceState() {
  return (
    <div className="py-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-4"
        style={{
          background: "rgba(255, 255, 255, 0.04)",
          border: "1px dashed rgba(255, 255, 255, 0.2)",
        }}
      >
        <svg className="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </div>
      <p className="text-sm text-white/60 font-light mb-1">No audience data yet</p>
      <p className="text-xs text-white/35 font-light max-w-xs mx-auto">
        Publish posts and connect an analytics provider to see views, engagement, and top performers.
      </p>
    </div>
  )
}

/* ─── Chart components ────────────────────────────────────────────────── */

const VIOLET = "#8b5cf6"
const VIOLET_SOFT = "#c4b5fd"
const AXIS = "rgba(255, 255, 255, 0.3)"
const GRID = "rgba(255, 255, 255, 0.06)"

const PILLAR_ORDER = [
  "locum_pay_rates",
  "how_to_locum",
  "locum_by_location",
  "industry_news",
  "locum_vs_agency",
  "doctor_wellbeing",
] as const

function PillarChart({ posts }: { posts: Post[] }) {
  const counts: Record<string, number> = {}
  for (const p of posts) counts[p.pillar] = (counts[p.pillar] ?? 0) + 1

  const data = PILLAR_ORDER.map((id) => ({
    pillar: PILLAR_LABELS[id],
    short: PILLAR_LABELS[id].split(" ")[0],
    count: counts[id] ?? 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" stroke={AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="pillar"
          stroke={AXIS}
          tick={{ fontSize: 11, fill: "rgba(255,255,255,0.6)" }}
          width={130}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={tooltipStyle}
          labelStyle={{ color: "#fff", fontSize: 12 }}
          itemStyle={{ color: VIOLET_SOFT, fontSize: 12 }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.count === 0 ? "rgba(255,255,255,0.08)" : VIOLET} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function TimelineChart({ posts }: { posts: Post[] }) {
  // Group posts by ISO week, last 12 weeks
  const now = new Date()
  const buckets: { label: string; count: number; date: Date }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    buckets.push({
      label: d.toLocaleDateString("en-AU", { month: "short", day: "numeric" }),
      count: 0,
      date: d,
    })
  }

  for (const p of posts) {
    const pDate = new Date(p.generated_at)
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (pDate >= buckets[i].date) {
        buckets[i].count++
        break
      }
    }
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={buckets} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" stroke={AXIS} tick={{ fontSize: 10 }} interval={1} />
        <YAxis stroke={AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={tooltipStyle}
          labelStyle={{ color: "#fff", fontSize: 12 }}
          itemStyle={{ color: VIOLET_SOFT, fontSize: 12 }}
        />
        <Bar dataKey="count" fill={VIOLET} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function WordCountChart({ posts }: { posts: Post[] }) {
  const data = [...posts].reverse().map((p, i) => ({
    n: `#${i + 1}`,
    words: p.word_count,
    title: p.title,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="n" stroke={AXIS} tick={{ fontSize: 11 }} />
        <YAxis stroke={AXIS} tick={{ fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={tooltipStyle}
          labelFormatter={(_, items) => {
            const d = items?.[0]?.payload as { title?: string } | undefined
            return d?.title ?? ""
          }}
          formatter={(v: number) => [`${v.toLocaleString()} words`, "Length"]}
        />
        <Bar dataKey="words" fill={VIOLET} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function SourcesChart({ posts }: { posts: Post[] }) {
  const data = [...posts].reverse().map((p, i) => ({
    n: `#${i + 1}`,
    sources: p.sources?.length ?? 0,
    title: p.title,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="n" stroke={AXIS} tick={{ fontSize: 11 }} />
        <YAxis stroke={AXIS} tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={tooltipStyle}
          labelFormatter={(_, items) => {
            const d = items?.[0]?.payload as { title?: string } | undefined
            return d?.title ?? ""
          }}
          formatter={(v: number) => [`${v} sources`, "Cited"]}
        />
        <Bar dataKey="sources" fill={VIOLET_SOFT} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

const tooltipStyle: React.CSSProperties = {
  background: "rgba(10, 10, 15, 0.9)",
  border: "1px solid rgba(255, 255, 255, 0.14)",
  borderRadius: 8,
  backdropFilter: "blur(20px)",
  fontSize: 12,
  padding: "8px 12px",
}
