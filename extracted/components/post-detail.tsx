import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { PILLAR_LABELS, type Post } from "@/lib/posts"

export default function PostDetail({ post }: { post: Post }) {
  const pillarLabel = PILLAR_LABELS[post.pillar] ?? post.pillar
  const generated = new Date(post.generated_at).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return (
    <section className="relative z-10 min-h-[calc(100vh-80px)] px-6 pt-24 pb-20">
      <div className="max-w-6xl mx-auto">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 font-light mb-8 transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to posts
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          {/* ── Left: Content ─────────────────────────────────────────────── */}
          <div
            className="rounded-2xl p-8 md:p-10"
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
            }}
          >
            {/* Pillar tag */}
            <span
              className="inline-block text-[10px] font-medium tracking-widest uppercase px-2.5 py-1 rounded-full mb-5"
              style={{
                background: "rgba(139,92,246,0.25)",
                color: "#c4b5fd",
                border: "1px solid rgba(139,92,246,0.35)",
              }}
            >
              {pillarLabel}
            </span>

            {/* Hero image */}
            {post.image_url && (
              <div className="mb-8 -mx-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.image_url}
                  alt={post.og_image_alt}
                  className="w-full rounded-xl"
                  style={{ maxHeight: "420px", objectFit: "cover" }}
                />
                {post.image_credit && (
                  <p className="text-[11px] text-white/35 font-light mt-2 px-2">
                    {post.image_credit}
                  </p>
                )}
              </div>
            )}

            {/* Markdown content */}
            <article className="post-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {post.content_markdown}
              </ReactMarkdown>
            </article>
          </div>

          {/* ── Right: Metadata sidebar ────────────────────────────────────── */}
          <aside className="flex flex-col gap-5">
            <MetaCard title="Generated">
              <p className="text-sm text-white/80 font-light">{generated}</p>
            </MetaCard>

            <MetaCard title="Slug">
              <code className="text-xs text-violet-300 font-mono break-all">
                /blog/{post.slug}
              </code>
            </MetaCard>

            <MetaCard title="Focus keyword">
              <p className="text-sm text-white/80 font-light">
                {post.focus_keyword}
              </p>
            </MetaCard>

            <MetaCard title="Meta title">
              <p className="text-sm text-white/80 font-light leading-relaxed">
                {post.meta_title}
              </p>
              <p className="text-[10px] text-white/30 mt-2">
                {post.meta_title.length} characters
              </p>
            </MetaCard>

            <MetaCard title="Meta description">
              <p className="text-sm text-white/80 font-light leading-relaxed">
                {post.meta_description}
              </p>
              <p className="text-[10px] text-white/30 mt-2">
                {post.meta_description.length} characters
              </p>
            </MetaCard>

            <MetaCard title="Keywords">
              <div className="flex flex-wrap gap-1.5">
                {post.target_keywords.map((kw) => (
                  <span
                    key={kw}
                    className="text-[11px] text-white/70 px-2 py-0.5 rounded-md font-light"
                    style={{
                      background: "rgba(255, 255, 255, 0.06)",
                      border: "1px solid rgba(255, 255, 255, 0.10)",
                    }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </MetaCard>

            <MetaCard title="Stats">
              <div className="flex flex-col gap-2 text-sm text-white/70 font-light">
                <Row label="Words" value={post.word_count.toLocaleString()} />
                <Row
                  label="Reading time"
                  value={`${post.reading_time_minutes} min`}
                />
                <Row label="Sources" value={String(post.sources.length)} />
              </div>
            </MetaCard>

            <MetaCard title="AHPRA compliance">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: post.ahpra_passed ? "#a7f3d0" : "#fcd34d",
                  }}
                />
                <span className="text-sm text-white/85 font-light">
                  {post.ahpra_passed ? "Passed" : "Review needed"}
                </span>
              </div>
              {post.ahpra_flags.length > 0 && (
                <ul className="flex flex-col gap-2 mt-2">
                  {post.ahpra_flags.map((flag, i) => (
                    <li key={i} className="text-[11px] text-white/55 font-light leading-relaxed">
                      <span className="text-white/40">
                        {flag.requires_human_review ? "⚠ " : "✓ "}
                      </span>
                      {flag.fix_applied}
                    </li>
                  ))}
                </ul>
              )}
            </MetaCard>
          </aside>
        </div>
      </div>
    </section>
  )
}

function MetaCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "rgba(255, 255, 255, 0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      <h3 className="text-[10px] font-medium tracking-widest uppercase text-white/40 mb-3">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-white/45 text-xs">{label}</span>
      <span className="text-white/85">{value}</span>
    </div>
  )
}
