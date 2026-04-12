import type { PipelineStats } from "@/lib/posts"

type StatItem = { label: string; value: string }

function buildStats(stats: PipelineStats): StatItem[] {
  return [
    { label: "Total Posts", value: String(stats.total_posts) },
    { label: "This Week", value: String(stats.posts_this_week) },
    { label: "Keywords Tracked", value: String(stats.keywords_tracked) },
    { label: "Avg Words", value: stats.avg_word_count.toLocaleString() },
  ]
}

export default function DashboardStats({ stats }: { stats: PipelineStats }) {
  const items = buildStats(stats)
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-6xl mb-10">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl px-5 py-4"
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
          }}
        >
          <div
            className="text-3xl font-semibold text-white"
            style={{ letterSpacing: "-0.03em" }}
          >
            {item.value}
          </div>
          <div className="text-xs text-white/50 font-light mt-1 tracking-wide">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  )
}
