import Link from "next/link"
import {
  PILLAR_LABELS,
  timeAgo,
  timeUntil,
  type PipelineStats,
  type Post,
} from "@/lib/posts"
import DashboardStats from "@/components/dashboard-stats"

export default function DashboardCards({
  posts,
  stats,
}: {
  posts: Post[]
  stats: PipelineStats
}) {
  return (
    <section className="relative z-10 flex flex-col items-center min-h-[calc(100vh-80px)] px-6 pt-24 pb-16">
      {/* Welcome header */}
      <div className="w-full max-w-6xl mb-10">
        <h1
          className="text-3xl md:text-4xl font-semibold text-white mb-2"
          style={{ letterSpacing: "-0.03em" }}
        >
          Welcome back, Anu
        </h1>
        <p className="text-sm text-white/50 font-light">
          Last run {timeAgo(stats.last_run)} · Next run {timeUntil(stats.next_run)}
        </p>
      </div>

      {/* Stats row */}
      <DashboardStats stats={stats} />

      {/* Posts grid */}
      {posts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 w-full max-w-6xl">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </section>
  )
}

function PostCard({ post }: { post: Post }) {
  const pillarLabel = PILLAR_LABELS[post.pillar] ?? post.pillar
  return (
    <Link
      href={`/dashboard/posts/${post.slug}`}
      className="rounded-2xl p-7 cursor-pointer group transition-all duration-300 hover:-translate-y-1 hover:scale-[1.03] flex flex-col"
      style={{
        background: "rgba(255, 255, 255, 0.10)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        boxShadow: "0 0 0 0 rgba(139,92,246,0)",
        transition: "transform 0.3s ease, box-shadow 0.3s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 40px rgba(139,92,246,0.22)"
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 0 rgba(139,92,246,0)"
      }}
    >
      {/* Pillar tag */}
      <span
        className="inline-block self-start text-[10px] font-medium tracking-widest uppercase px-2.5 py-1 rounded-full mb-4"
        style={{
          background: "rgba(139,92,246,0.25)",
          color: "#c4b5fd",
          border: "1px solid rgba(139,92,246,0.35)",
        }}
      >
        {pillarLabel}
      </span>

      {/* Title */}
      <h2
        className="text-xl font-semibold text-white mb-3 leading-snug group-hover:text-violet-200 transition-colors duration-200 line-clamp-3"
        style={{ letterSpacing: "-0.02em" }}
      >
        {post.title}
      </h2>

      {/* TL;DR */}
      <p className="text-sm text-white/60 leading-relaxed font-light line-clamp-4 flex-grow">
        {post.tldr || post.meta_description}
      </p>

      {/* Meta line */}
      <div className="mt-5 flex items-center gap-2 text-[11px] text-white/40 font-light">
        <span>{post.word_count.toLocaleString()}w</span>
        <span>·</span>
        <span>{post.reading_time_minutes} min</span>
        <span>·</span>
        <span className={post.ahpra_passed ? "text-white/60" : "text-white/70"}>
          {post.ahpra_passed ? "● Passed" : "⚠ Review"}
        </span>
      </div>

      {/* View link */}
      <div className="mt-4 flex items-center gap-1.5 text-xs text-violet-400 font-medium group-hover:text-violet-300 transition-colors duration-200">
        View post
        <svg
          className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 17L17 7M17 7H7M17 7V17"
          />
        </svg>
      </div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div
      className="rounded-2xl px-10 py-16 text-center max-w-2xl w-full"
      style={{
        background: "rgba(255, 255, 255, 0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      <p className="text-white/70 font-light mb-2">No posts yet.</p>
      <p className="text-xs text-white/40 font-light">
        Run the pipeline from the backend directory:
        <br />
        <code className="text-violet-300">
          cd backend && venv/bin/python3 main.py
        </code>
      </p>
    </div>
  )
}
