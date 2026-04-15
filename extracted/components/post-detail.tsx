import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import React from "react"
import type { Components } from "react-markdown"
import { PILLAR_LABELS, type Post } from "@/lib/posts"
import TocSidebar, { type TocItem } from "@/components/toc-sidebar"
import FaqAccordion, { type FaqItem } from "@/components/faq-accordion"
import ReadingProgress from "@/components/reading-progress"

// ── Text helpers ─────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .replace(/[*_`[\]()#]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

function extractNodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractNodeText).join("")
  if (React.isValidElement(node)) {
    return extractNodeText((node.props as { children?: React.ReactNode }).children)
  }
  return ""
}

// ── Markdown parsers ─────────────────────────────────────────────────────────

function extractH2s(md: string): TocItem[] {
  return md
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => {
      const raw = l.replace(/^## /, "").trim()
      if (raw.toLowerCase() === "sources") return null
      const text = raw.toLowerCase().includes("frequently asked") ? "FAQ" : raw
      return { id: slugify(raw), text }
    })
    .filter(Boolean) as TocItem[]
}

function extractFaq(md: string): FaqItem[] {
  const heading = "## Frequently Asked Questions"
  const start = md.indexOf(heading)
  if (start === -1) return []

  let section = md.slice(start + heading.length)
  const nextH2 = section.search(/\n## /)
  if (nextH2 > -1) section = section.slice(0, nextH2)

  const pairs: FaqItem[] = []
  // Match **Q: ...** then A: ...
  const re = /\*\*Q:\s*([^*]+?)\*\*\s*\n+A:\s*([\s\S]*?)(?=\n\*\*Q:|$)/g
  let m
  while ((m = re.exec(section)) !== null) {
    const q = m[1].trim()
    const a = m[2].trim()
    if (q && a) pairs.push({ q, a })
  }
  return pairs
}

function splitAtFaq(md: string): { before: string; sources: string } {
  const faqIdx = md.indexOf("\n## Frequently Asked Questions")
  const srcIdx = md.indexOf("\n## Sources")

  if (faqIdx === -1) {
    return { before: md, sources: srcIdx > -1 ? md.slice(srcIdx) : "" }
  }
  return {
    before: md.slice(0, faqIdx),
    sources: srcIdx > -1 ? md.slice(srcIdx) : "",
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PostDetail({ post }: { post: Post }) {
  const pillarLabel = PILLAR_LABELS[post.pillar] ?? post.pillar
  const generated = new Date(post.generated_at).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  const tocItems = extractH2s(post.content_markdown)
  const faqItems = extractFaq(post.content_markdown)
  const { before, sources } = splitAtFaq(post.content_markdown)

  // Custom markdown component renderers
  const mdComponents: Components = {
    // Add anchor IDs to every H2 for TOC scroll-tracking
    h2: ({ children }) => {
      const text = extractNodeText(children)
      const id = slugify(text)
      return <h2 id={id}>{children}</h2>
    },

    // Detect callout box types from blockquote content
    blockquote: ({ children }) => {
      const text = extractNodeText(children)

      // [GRID] — feature card grid
      if (text.includes("[GRID]")) {
        const items = extractNodeText(children)
          .replace("[GRID]", "")
          .split(/\n[-*]\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
        return (
          <div className="feature-card-grid">
            {items.map((item, i) => {
              const [title, ...rest] = item.split(/[:—–]/)
              return (
                <div key={i} className="feature-card">
                  <p className="feature-card-title">{title?.trim()}</p>
                  {rest.length > 0 && (
                    <p className="feature-card-desc">{rest.join(":").trim()}</p>
                  )}
                </div>
              )
            })}
          </div>
        )
      }

      if (text.includes("[KEY TAKEAWAY]")) {
        return (
          <div className="callout-takeaway">
            <span className="callout-label">✓ Key Takeaway</span>
            {children}
          </div>
        )
      }
      if (text.match(/\[INFO\]|\[TIP\]/i)) {
        return (
          <div className="callout-info">
            <span className="callout-label">ℹ Info</span>
            {children}
          </div>
        )
      }
      if (text.match(/\[CASE STUDY/i)) {
        const title = text.match(/\[CASE STUDY:\s*([^\]]+)\]/i)?.[1] ?? "Case Study"
        return (
          <div className="callout-case-study">
            <span className="callout-label">📋 {title}</span>
            {children}
          </div>
        )
      }
      // [STAT: value] — dark navy bold stat block
      if (text.match(/\[STAT:/i)) {
        const match = text.match(/\[STAT:\s*([^\]]+)\]\s*([\s\S]*)/)
        const value = match?.[1]?.trim() ?? ""
        const rest = match?.[2]?.trim() ?? ""
        const [mainLabel, source] = rest.split(/—|–|\|/).map((s) => s.trim())
        return (
          <div className="blog-stat-block">
            <p className="stat-value">{value}</p>
            {mainLabel && <p className="stat-label">{mainLabel}</p>}
            {source && <p className="stat-source">{source}</p>}
          </div>
        )
      }

      // [INSIGHT: icon | title | desc] — lime insight card
      if (text.match(/\[INSIGHT:/i)) {
        const match = text.match(/\[INSIGHT:\s*([^\|]+)\|([^\|]+)\|([^\]]+)\]/)
        const icon = match?.[1]?.trim() ?? "💡"
        const title = match?.[2]?.trim() ?? ""
        const desc = match?.[3]?.trim() ?? ""
        return (
          <div className="blog-insight-card">
            <span className="insight-icon">{icon}</span>
            <div>
              <p className="insight-title">{title}</p>
              <p className="insight-desc">{desc}</p>
            </div>
          </div>
        )
      }

      // Default — disclaimer / note blockquote
      return <blockquote className="post-blockquote">{children}</blockquote>
    },

    // Ordered list — violet numbered circles
    ol: ({ children }) => (
      <ol className="post-numbered-list">{children}</ol>
    ),

    // Unordered list — detect checklist (items starting with bold) vs regular bullets
    ul: ({ children }) => {
      const items = React.Children.toArray(children)
      // Count items where the first p-child's first element is a <strong>
      const boldCount = items.filter((child) => {
        if (!React.isValidElement(child)) return false
        const liChildren = React.Children.toArray(
          ((child as React.ReactElement).props as { children?: React.ReactNode }).children
        )
        const firstChild = liChildren[0]
        if (!React.isValidElement(firstChild) || (firstChild as React.ReactElement).type !== "p") return false
        const pChildren = React.Children.toArray(
          ((firstChild as React.ReactElement).props as { children?: React.ReactNode }).children
        )
        return React.isValidElement(pChildren[0]) && (pChildren[0] as React.ReactElement).type === "strong"
      }).length

      if (boldCount >= 2) {
        return <ul className="post-checklist not-prose">{children}</ul>
      }
      return <ul className="post-bullets">{children}</ul>
    },

    // List item — render checklist card if starts with bold, else normal
    li: ({ children }) => {
      const childArray = React.Children.toArray(children)
      const firstChild = childArray[0]

      // Detect: li > p > strong (react-markdown renders `- **Title**: desc` this way)
      if (React.isValidElement(firstChild) && (firstChild as React.ReactElement).type === "p") {
        const pChildren = React.Children.toArray(
          ((firstChild as React.ReactElement).props as { children?: React.ReactNode }).children
        )
        const firstInP = pChildren[0]
        if (React.isValidElement(firstInP) && (firstInP as React.ReactElement).type === "strong") {
          const title = extractNodeText(firstInP)
          const desc = pChildren
            .slice(1)
            .map((c) => extractNodeText(c as React.ReactNode))
            .join("")
            .replace(/^[：:—–\s]+/, "")
            .trim()
          return (
            <li className="post-checklist-item">
              <div className="post-checklist-circle">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <p className="post-checklist-title">{title}</p>
                {desc && <p className="post-checklist-desc">{desc}</p>}
              </div>
            </li>
          )
        }
      }
      return <li>{children}</li>
    },

    // Paragraph — detect StatDoctor CTA paragraph → full gradient CTA section
    p: ({ children }) => {
      const text = extractNodeText(children)
      if (
        text.toLowerCase().includes("statdoctor") &&
        (text.toLowerCase().includes("fastest-growing") ||
          text.toLowerCase().includes("join") ||
          text.toLowerCase().includes("network") ||
          text.toLowerCase().includes("register"))
      ) {
        return (
          <div className="post-cta-section">
            <h3>Join Australia&apos;s Fastest-Growing Locum Network</h3>
            <p>
              StatDoctor connects hospitals and clinics with verified locum doctors across Australia.
              Streamlined onboarding, instant bookings, and transparent rates — no middlemen.
            </p>
            <div>
              <a href="https://statdoctor.app" className="post-cta-btn">I&apos;m a Doctor — Find Shifts</a>
              <a href="https://statdoctor.app" className="post-cta-btn post-cta-btn-outline">Post a Locum Role</a>
            </div>
            <p className="post-cta-tagline">Free to sign up · No agency fees · Instant matching</p>
          </div>
        )
      }
      return <p>{children}</p>
    },

    // Inline images — styled with caption
    img: ({ src, alt }) => (
      <figure className="post-inline-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src ?? ""} alt={alt ?? ""} loading="lazy" />
        {alt && <figcaption>{alt}</figcaption>}
      </figure>
    ),
  }

  const statStrip = [
    { value: post.word_count.toLocaleString(), label: "words" },
    { value: `${post.reading_time_minutes} min`, label: "read time" },
    { value: String(post.sources.length), label: "sources cited" },
    {
      value: post.ahpra_passed ? "✓" : "⚠",
      label: post.ahpra_passed ? "AHPRA compliant" : "AHPRA review",
    },
  ]

  return (
    <>
      <ReadingProgress />

      <section className="relative z-10 min-h-[calc(100vh-80px)] px-4 sm:px-6 pt-8 pb-24">
        <div className="max-w-6xl mx-auto">

          {/* Back link */}
          <Link
            href="/dashboard"
            className="post-back-link inline-flex items-center gap-1.5 text-sm font-medium mb-6 transition-colors duration-200"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to posts
          </Link>

          {/* ── Hero Banner ─────────────────────────────────────────────── */}
          <div
            className="rounded-2xl p-8 md:p-12 mb-4"
            style={{
              background:
                "linear-gradient(160deg, hsl(250, 60%, 82%), hsl(240, 55%, 55%), hsl(240, 50%, 40%))",
            }}
          >
            <span
              className="inline-block text-[11px] tracking-widest uppercase px-3 py-1 rounded-md mb-5"
              style={{
                background: "hsl(68, 85%, 55%)",
                color: "hsl(240, 50%, 20%)",
                fontFamily: "var(--font-space-grotesk), sans-serif",
                fontWeight: 700,
              }}
            >
              {pillarLabel} · {post.reading_time_minutes} min read
            </span>

            <h1
              className="text-4xl md:text-5xl lg:text-6xl text-white mb-4 leading-tight max-w-3xl"
              style={{
                fontFamily: "var(--font-varela-round), sans-serif",
                fontWeight: 400,
              }}
            >
              {post.title}
            </h1>

            <p
              className="text-base md:text-lg text-white/90 font-light mb-8 max-w-2xl leading-relaxed"
              style={{ fontFamily: "var(--font-montserrat), sans-serif" }}
            >
              {post.meta_description}
            </p>

            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                style={{
                  background: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-space-grotesk), sans-serif",
                }}
              >
                SD
              </div>
              <div style={{ fontFamily: "var(--font-montserrat), sans-serif" }}>
                <p className="text-sm font-medium text-white">StatDoctor Editorial</p>
                <p
                  className="text-xs text-white/70 tracking-widest uppercase mt-0.5"
                  style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}
                >
                  Published {generated}
                </p>
              </div>
            </div>
          </div>

          {/* ── Hero Image ──────────────────────────────────────────────── */}
          {post.image_url && (
            <div className="mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.image_url}
                alt={post.og_image_alt}
                className="w-full rounded-2xl block"
              />
              {post.image_credit && (
                <p
                  className="text-[11px] font-light mt-2 px-1 italic"
                  style={{ color: "hsl(240, 20%, 46%)" }}
                >
                  {post.image_credit}
                </p>
              )}
            </div>
          )}

          {/* ── Stat Strip ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {statStrip.map(({ value, label }) => {
              const isIndigo = label === "read time" || label === "sources cited"
              return (
                <div key={label} className="post-stat-card rounded-2xl p-6 text-center">
                  <p
                    className="text-3xl md:text-4xl font-bold mb-1"
                    style={{
                      color: "hsl(240, 50%, 20%)",
                      fontFamily: "var(--font-varela-round), sans-serif",
                    }}
                  >
                    {value}
                  </p>
                  <p
                    className="text-xs font-semibold tracking-widest uppercase"
                    style={{
                      color: isIndigo ? "hsl(240, 55%, 55%)" : "hsl(240, 20%, 46%)",
                      fontFamily: "var(--font-space-grotesk), sans-serif",
                    }}
                  >
                    {label}
                  </p>
                </div>
              )
            })}
          </div>

          {/* ── Main Grid ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">

            {/* Content panel */}
            <div
              className="rounded-2xl p-8 md:p-10 min-w-0"
              style={{
                background: "#ffffff",
                border: "1px solid hsl(245, 25%, 90%)",
                boxShadow: "0 4px 24px -4px hsl(240 50% 20% / 0.08)",
              }}
            >
              {/* Main article content (before FAQ) */}
              <article className="post-prose">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={mdComponents as any}
                >
                  {before}
                </ReactMarkdown>
              </article>

              {/* FAQ Accordion */}
              {faqItems.length > 0 && (
                <div className="mt-10">
                  <h2
                    id="frequently-asked-questions"
                    className="text-2xl md:text-3xl mb-5"
                    style={{
                      color: "hsl(240, 50%, 20%)",
                      fontFamily: "var(--font-varela-round), sans-serif",
                    }}
                  >
                    Frequently Asked Questions
                  </h2>
                  <FaqAccordion items={faqItems} />
                </div>
              )}

              {/* Sources section */}
              {sources && (
                <article
                  className="post-prose mt-10 pt-8"
                  style={{ borderTop: "1px solid hsl(245, 25%, 90%)" }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={mdComponents as any}
                  >
                    {sources}
                  </ReactMarkdown>
                </article>
              )}
            </div>

            {/* ── Sticky Sidebar ─────────────────────────────────────────── */}
            <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">

              {/* In This Guide */}
              <TocSidebar items={tocItems} />

              {/* Quick Stat */}
              <div
                className="rounded-2xl p-6 text-center"
                style={{
                  background: "hsl(240, 50%, 20%)",
                  color: "#ffffff",
                }}
              >
                <p
                  className="text-xs font-semibold tracking-widest uppercase mb-2"
                  style={{
                    color: "hsl(68, 85%, 55%)",
                    fontFamily: "var(--font-space-grotesk), sans-serif",
                  }}
                >
                  Quick Stat
                </p>
                <p
                  className="text-4xl font-bold mb-1"
                  style={{ fontFamily: "var(--font-varela-round), sans-serif" }}
                >
                  {post.sources.length}
                </p>
                <p
                  className="text-sm font-light leading-snug"
                  style={{
                    color: "rgba(255,255,255,0.8)",
                    fontFamily: "var(--font-montserrat), sans-serif",
                  }}
                >
                  sources verified for this article
                </p>
              </div>

              {/* Focus keyword */}
              <MetaCard title="Focus keyword">
                <p className="text-sm font-medium">{post.focus_keyword}</p>
              </MetaCard>

              {/* Meta title */}
              <MetaCard title="Meta title">
                <p className="text-sm font-light leading-relaxed">{post.meta_title}</p>
                <p className="text-[10px] mt-2" style={{ color: "hsl(240, 20%, 46%)" }}>
                  {post.meta_title.length} chars
                </p>
              </MetaCard>

              {/* Keywords */}
              <MetaCard title="Keywords">
                <div className="flex flex-wrap gap-1.5">
                  {post.target_keywords.map((kw) => (
                    <span
                      key={kw}
                      className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                      style={{
                        background: "hsl(245, 25%, 93%)",
                        color: "hsl(240, 50%, 20%)",
                        border: "1px solid hsl(245, 25%, 90%)",
                      }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </MetaCard>

              {/* AHPRA */}
              <MetaCard title="AHPRA compliance">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: post.ahpra_passed ? "hsl(68, 70%, 40%)" : "#f59e0b" }}
                  />
                  <span className="text-sm font-medium">
                    {post.ahpra_passed ? "Passed" : "Review needed"}
                  </span>
                </div>
                {post.ahpra_flags.length > 0 && (
                  <ul className="flex flex-col gap-1.5 mt-2">
                    {post.ahpra_flags.map((flag, i) => (
                      <li
                        key={i}
                        className="text-[11px] font-light leading-relaxed"
                        style={{ color: "hsl(240, 20%, 46%)" }}
                      >
                        <span style={{ color: "hsl(240, 20%, 46%)" }}>
                          {flag.requires_human_review ? "⚠ " : "✓ "}
                        </span>
                        {flag.fix_applied}
                      </li>
                    ))}
                  </ul>
                )}
              </MetaCard>

              {/* Slug */}
              <MetaCard title="Slug">
                <code
                  className="text-xs font-mono break-all"
                  style={{ color: "hsl(240, 55%, 55%)" }}
                >
                  /blog/{post.slug}
                </code>
              </MetaCard>
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetaCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-2xl p-5 transition-all duration-300"
      style={{
        background: "#ffffff",
        border: "1px solid hsl(245, 25%, 90%)",
        boxShadow: "0 4px 24px -4px hsl(240 50% 20% / 0.08)",
        fontFamily: "var(--font-montserrat), sans-serif",
      }}
    >
      <h3
        className="text-xs font-semibold tracking-widest uppercase mb-3"
        style={{
          color: "hsl(240, 55%, 55%)",
          fontFamily: "var(--font-space-grotesk), sans-serif",
        }}
      >
        {title}
      </h3>
      <div style={{ color: "hsl(240, 50%, 20%)" }}>{children}</div>
    </div>
  )
}
