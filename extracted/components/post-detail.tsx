import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import React from "react"
import type { Components } from "react-markdown"
import { PILLAR_LABELS, type Post } from "@/lib/posts"
import TocSidebar, { type TocItem } from "@/components/toc-sidebar"
import FaqAccordion, { type FaqItem } from "@/components/faq-accordion"
import ReadingProgress from "@/components/reading-progress"
import DisclaimerBanner from "@/components/disclaimer-banner"
import WhoThisIsFor from "@/components/who-this-is-for"
import AuthorBio from "@/components/author-bio"
import RelatedArticles from "@/components/related-articles"
import SocialShare from "@/components/social-share"
import SourceImageGallery, { type SourceWithImage, type InlineImage } from "@/components/source-image-gallery"
import JoinCTA from "@/components/join-cta"

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

function stripMarker(children: React.ReactNode, pattern: RegExp): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child
    const childEl = child as React.ReactElement<{ children?: React.ReactNode }>
    const fullText = extractNodeText(childEl.props?.children ?? null).trim()

    // Entire child is just the marker — drop it
    if (pattern.test(fullText) && fullText.replace(pattern, "").trim() === "") {
      return null
    }

    // Marker embedded at start of a <p> — strip it from string children
    if (childEl.type === "p" && pattern.test(fullText)) {
      const newPChildren = React.Children.map(childEl.props?.children, (pChild) => {
        if (typeof pChild === "string") {
          return pChild.replace(pattern, "").replace(/^\s*/, "")
        }
        return pChild
      })
      return React.cloneElement(childEl, {}, newPChildren)
    }

    return child
  })?.filter(Boolean) ?? []
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)>\]"']+/)
  return match ? match[0] : null
}

// Move inline callout markers (> [TYPE] content) onto their own paragraph line
// so stripMarker can reliably detect and remove the standalone marker.
function preprocessCalloutMarkers(md: string): string {
  return md.replace(
    /^(> ?)\[(KEY TAKEAWAY|INFO|TIP|AU|NZ|INTERESTING FACT|INSIGHT|DONT WORRY|REASSURANCE|CASE STUDY:[^\]]+)\] +(.+)$/gm,
    (_match, prefix, type, content) =>
      `${prefix}[${type}]\n${prefix}\n${prefix}${content}`
  )
}

// Split markdown into sections at each H2 boundary (keeps H2 with its section).
function splitByH2(md: string): string[] {
  return md.split(/(?=^## )/m).filter((s) => s.trim())
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

export default function PostDetail({
  post,
  relatedPosts = [],
  sourceImages = [],
}: {
  post: Post
  relatedPosts?: Post[]
  sourceImages?: SourceWithImage[]
}) {
  const pillarLabel = PILLAR_LABELS[post.pillar] ?? post.pillar
  const generated = new Date(post.generated_at).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  const processed = preprocessCalloutMarkers(post.content_markdown)
  const tocItems = extractH2s(processed)
  const faqItems = extractFaq(processed)
  const { before, sources } = splitAtFaq(processed)

  // Split article body into sections so we can inject source images between them
  const contentSections = splitByH2(before)

  // Build a flat list of attributed images for inline injection.
  // Prefer inline chart/graphic images over OG cover images — they're more data-rich.
  type AttributedImg = { src: string; caption: string; url: string; publisher: string; title: string }

  const allInlineImgs: AttributedImg[] = []
  for (const s of sourceImages) {
    for (const img of s.inlineImages) {
      allInlineImgs.push({ src: img.src, caption: img.caption, url: s.url, publisher: s.publisher, title: s.title })
    }
  }
  // Fall back to OG images if no inline images were found
  const sourcesWithOg = sourceImages.filter((s) => s.imageUrl)
  if (allInlineImgs.length < 2) {
    for (const s of sourcesWithOg.slice(1)) {
      if (allInlineImgs.length >= 2) break
      allInlineImgs.push({ src: s.imageUrl!, caption: s.snippet ?? s.title, url: s.url, publisher: s.publisher, title: s.title })
    }
  }

  const heroSource = sourcesWithOg[0] ?? null
  const inlineImgs = allInlineImgs.slice(0, 2)

  const mdComponents: Components = {
    h2: ({ children }) => {
      const text = extractNodeText(children)
      const id = slugify(text)
      return <h2 id={id}>{children}</h2>
    },

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

      // [KEY FACTS]
      if (text.includes("[KEY FACTS]")) {
        const filtered = stripMarker(children, /\[KEY FACTS\]/i)
        return (
          <div className="callout-key-facts">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>📌</span>
                <span>Key Facts</span>
              </div>
            </div>
            <div className="callout-content">
              {filtered}
              <p className="callout-sources-note">
                Sources:{" "}
                <a href="#sources">
                  {post.sources.length} cited below ↓
                </a>
              </p>
            </div>
          </div>
        )
      }

      // [KEY TAKEAWAY]
      if (text.includes("[KEY TAKEAWAY]")) {
        const filtered = stripMarker(children, /\[KEY TAKEAWAY\]\s*/i)
        return (
          <div className="callout-takeaway">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>✓</span>
                <span>Key Takeaway</span>
              </div>
            </div>
            <div className="callout-content">
              {filtered}
            </div>
          </div>
        )
      }

      // [INFO] or [TIP]
      if (text.match(/\[INFO\]|\[TIP\]/i)) {
        const filtered = stripMarker(children, /\[(INFO|TIP)\]\s*/i)
        return (
          <div className="callout-info">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>ℹ</span>
                <span>Info</span>
              </div>
            </div>
            <div className="callout-content">
              {filtered}
            </div>
          </div>
        )
      }

      // [CASE STUDY: Title]
      if (text.match(/\[CASE STUDY/i)) {
        const title = text.match(/\[CASE STUDY:\s*([^\]]+)\]/i)?.[1] ?? "Case Study"
        const filtered = stripMarker(children, /\[CASE STUDY:[^\]]+\]\s*/i)
        const url = extractUrl(text)

        // No real source URL — render as Key Insight instead of empty case study
        if (!url) {
          return (
            <div className="callout-insight">
              <div className="callout-header-band">
                <div className="callout-header-band-left">
                  <span>🔍</span>
                  <span>Key Insight</span>
                </div>
              </div>
              <div className="callout-content">{filtered}</div>
            </div>
          )
        }

        return (
          <div className="callout-case-study">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>📋</span>
                <span>{title}</span>
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="callout-header-band-link"
                style={{ color: "#ffffff" }}
              >
                Read case study →
              </a>
            </div>
            <div className="callout-content">
              {filtered}
            </div>
          </div>
        )
      }

      // [AU] — Australian Context
      if (text.match(/\[AU\]/i)) {
        const filtered = stripMarker(children, /\[AU\]\s*/i)
        return (
          <div className="callout-au">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>🇦🇺</span>
                <span>Australian Context</span>
              </div>
            </div>
            <div className="callout-content">
              {filtered}
            </div>
          </div>
        )
      }

      // [NZ] — New Zealand Context
      if (text.match(/\[NZ\]/i)) {
        const filtered = stripMarker(children, /\[NZ\]\s*/i)
        return (
          <div className="callout-nz">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>🇳🇿</span>
                <span>New Zealand Context</span>
              </div>
            </div>
            <div className="callout-content">
              {filtered}
            </div>
          </div>
        )
      }

      // [STAT: value]
      if (text.match(/\[STAT:/i)) {
        const match = text.match(/\[STAT:\s*([^\]]+)\]\s*([\s\S]*)/)
        const value = match?.[1]?.trim() ?? ""
        const rest = match?.[2]?.trim() ?? ""
        const parts = rest.split(/—|–|\|/).map((s) => s.trim())
        const mainLabel = parts[0] ?? ""
        const sourceText = parts[1] ?? ""
        const sourceUrl = extractUrl(sourceText) ?? extractUrl(rest)
        return (
          <div className="blog-stat-block">
            <p className="stat-value">{value}</p>
            {mainLabel && <p className="stat-label">{mainLabel}</p>}
            {sourceText && (
              <p className="stat-source">
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.7)", textDecoration: "underline" }}>
                    Source: {sourceText.replace(sourceUrl, "").trim() || sourceText}
                  </a>
                ) : (
                  <>Source: {sourceText}</>
                )}
              </p>
            )}
          </div>
        )
      }

      // [INSIGHT: icon | title | desc]
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

      // [INTERESTING FACT]
      if (text.match(/\[INTERESTING FACT\]/i)) {
        const filtered = stripMarker(children, /\[INTERESTING FACT\]\s*/i)
        return (
          <div className="callout-fact">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>⚡</span>
                <span>Interesting Fact</span>
              </div>
            </div>
            <div className="callout-content">{filtered}</div>
          </div>
        )
      }

      // [INSIGHT] — simple block (not the card format [INSIGHT: icon|title|desc])
      if (text.match(/^\[INSIGHT\]/i)) {
        const filtered = stripMarker(children, /\[INSIGHT\]\s*/i)
        return (
          <div className="callout-insight">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>🔍</span>
                <span>Insight</span>
              </div>
            </div>
            <div className="callout-content">{filtered}</div>
          </div>
        )
      }

      // [DONT WORRY] / [REASSURANCE]
      if (text.match(/\[DONT WORRY\]|\[REASSURANCE\]/i)) {
        const filtered = stripMarker(children, /\[(DONT WORRY|REASSURANCE)\]\s*/i)
        return (
          <div className="callout-reassure">
            <div className="callout-header-band">
              <div className="callout-header-band-left">
                <span>🙌</span>
                <span>Don&apos;t Worry</span>
              </div>
            </div>
            <div className="callout-content">{filtered}</div>
          </div>
        )
      }

      return <blockquote className="post-blockquote">{children}</blockquote>
    },

    ol: ({ children }) => (
      <ol className="post-numbered-list">{children}</ol>
    ),

    ul: ({ children }) => {
      const items = React.Children.toArray(children)
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

    li: ({ children }) => {
      const childArray = React.Children.toArray(children)
      const firstChild = childArray[0]

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

    img: ({ src, alt }) => {
      if (!src || typeof src !== "string") return null
      // Filter generic stock photos and chart services — source images injected separately
      if (
        src.includes("quickchart.io") ||
        src.includes("placeholder") ||
        src.includes("unsplash.com")
      ) return null
      return (
        <figure className="post-inline-img">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt ?? ""} loading="lazy" />
          {alt && <figcaption>{alt}</figcaption>}
        </figure>
      )
    },
  }

  return (
    <>
      <ReadingProgress />

      {/* Disclaimer — full-width amber bar */}
      <DisclaimerBanner />

      <section
        className="relative z-10 min-h-[calc(100vh-80px)] px-4 sm:px-6 pt-8 pb-24"
        style={{ background: "hsl(245, 30%, 98%)" }}
      >
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
            className="rounded-2xl p-5 md:p-8 mb-6"
            style={{
              background: "linear-gradient(160deg, hsl(250, 60%, 82%), hsl(240, 55%, 55%), hsl(240, 50%, 40%))",
            }}
          >
            <span
              className="inline-block text-[10px] tracking-widest uppercase px-2.5 py-0.5 rounded-md mb-3"
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
              className="text-2xl md:text-3xl text-white mb-2 leading-tight max-w-3xl"
              style={{
                fontFamily: "var(--font-varela-round), sans-serif",
                fontWeight: 400,
                letterSpacing: "-0.01em",
              }}
            >
              {post.title}
            </h1>

            <p
              className="text-xs md:text-sm text-white/85 font-light mb-4 max-w-2xl leading-relaxed"
              style={{ fontFamily: "var(--font-montserrat), sans-serif" }}
            >
              {post.meta_description}
            </p>

            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0"
                style={{
                  background: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-space-grotesk), sans-serif",
                }}
              >
                AG
              </div>
              <div style={{ fontFamily: "var(--font-montserrat), sans-serif" }}>
                <p className="text-xs font-medium text-white leading-tight">Dr. Anu Ganugapati</p>
                <p
                  className="text-[10px] text-white/70 tracking-widest uppercase mt-0.5"
                  style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}
                >
                  Published {generated}
                </p>
              </div>
            </div>
          </div>

          {/* ── Hero Image — only shown when a source-attributed image is available ── */}
          {heroSource?.imageUrl && (
            <div className="article-hero-img-wrap mb-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroSource.imageUrl}
                alt={heroSource.title}
                className="article-hero-img"
                loading="eager"
              />
              <p className="article-hero-img-caption">
                <strong>Source:</strong>{" "}
                <a href={heroSource.url} target="_blank" rel="noopener noreferrer">
                  {heroSource.publisher}
                </a>
                {" — "}
                {heroSource.title}
              </p>
            </div>
          )}

          {/* ── Who This Is For ─────────────────────────────────────────── */}
          <WhoThisIsFor />

          {/* ── Mobile TOC — shown above content on small/medium screens ── */}
          {tocItems.length > 0 && (
            <div className="block lg:hidden mb-6">
              <div
                className="rounded-2xl p-5"
                style={{
                  background: "#ffffff",
                  border: "1px solid hsl(245, 25%, 90%)",
                  boxShadow: "0 4px 24px -4px hsl(240 50% 20% / 0.08)",
                }}
              >
                <p
                  className="text-xs font-semibold tracking-widest uppercase mb-3"
                  style={{
                    color: "hsl(240, 55%, 55%)",
                    fontFamily: "var(--font-space-grotesk), sans-serif",
                  }}
                >
                  In This Guide
                </p>
                <nav className="flex flex-col space-y-0.5">
                  {tocItems.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }}
                      className="block text-sm py-1.5 leading-snug"
                      style={{
                        color: "hsl(240, 20%, 46%)",
                        fontFamily: "var(--font-montserrat), sans-serif",
                      }}
                    >
                      {item.text}
                    </a>
                  ))}
                </nav>
              </div>
            </div>
          )}

          {/* ── Main Grid ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-8">

            {/* Content panel */}
            <div
              className="rounded-2xl p-5 sm:p-8 md:p-10 min-w-0"
              style={{
                background: "#ffffff",
                border: "1px solid hsl(245, 25%, 90%)",
                boxShadow: "0 4px 24px -4px hsl(240 50% 20% / 0.06)",
              }}
            >
              {contentSections.map((section, i) => (
                <React.Fragment key={i}>
                  <article className="post-prose">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={mdComponents as any}
                    >
                      {section}
                    </ReactMarkdown>
                  </article>

                  {/* Inject source image after section 0 and section 2 */}
                  {(i === 0 || i === 2) && (() => {
                    const img = inlineImgs[i === 0 ? 0 : 1]
                    if (!img) return null
                    return (
                      <figure className="post-source-figure">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.src} alt={img.caption} loading="lazy" />
                        <figcaption>
                          {img.caption && <span>{img.caption}</span>}
                          <span style={{ marginLeft: img.caption ? "0.5rem" : 0 }}>
                            <strong>Source:</strong>{" "}
                            <a href={img.url} target="_blank" rel="noopener noreferrer">
                              {img.publisher}
                            </a>
                          </span>
                        </figcaption>
                      </figure>
                    )
                  })()}
                </React.Fragment>
              ))}

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
                  id="sources"
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

              {/* Source image gallery — embedded coverage */}
              <SourceImageGallery sources={sourceImages} />

              {/* Social share */}
              <SocialShare title={post.title} />
            </div>

            {/* ── Sticky Sidebar — TOC only (desktop only) ────────────── */}
            <aside className="hidden lg:flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
              <TocSidebar items={tocItems} />
            </aside>
          </div>

          {/* ── Author Bio ──────────────────────────────────────────────── */}
          <AuthorBio />

          {/* ── Join CTA ────────────────────────────────────────────────── */}
          <JoinCTA />

          {/* ── Related Articles ────────────────────────────────────────── */}
          <RelatedArticles posts={relatedPosts} />

          {/* ── Bottom Nav ──────────────────────────────────────────────── */}
          <nav className="article-bottom-nav">
            <Link href="/dashboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to all posts
            </Link>
            <a href="#top">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7 7 7M12 3v18" />
              </svg>
              Back to top
            </a>
          </nav>

        </div>
      </section>
    </>
  )
}
