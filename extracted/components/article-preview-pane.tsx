"use client"

/**
 * ArticlePreviewPane — read-only rendered preview of an article for the
 * /admin/posts/[slug] edit page. Shows the article as it would appear on the
 * public site, including hero banner, Who This Is For persona cards,
 * TL;DR summary, TOC sidebar, markdown body with callout boxes, author bio,
 * join CTA, and social share.
 *
 * Accepts Post from @/lib/admin/types (which is a superset of the public Post).
 * Renders in isolation inside a white-background preview pane.
 */

import React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"
import type { Post } from "@/lib/admin/types"
import { PILLAR_LABELS } from "@/lib/admin/types"
import { preprocessCalloutMarkers } from "@/lib/admin/callout-markers"
import WhoThisIsFor from "@/components/who-this-is-for"
import TocSidebar, { type TocItem } from "@/components/toc-sidebar"
import MobileToc from "@/components/mobile-toc"
import FaqAccordion, { type FaqItem } from "@/components/faq-accordion"
import AuthorBio from "@/components/author-bio"
import JoinCTA from "@/components/join-cta"
import SocialShare from "@/components/social-share"
import DisclaimerBanner from "@/components/disclaimer-banner"
import SourceImageGallery, { type SourceWithImage } from "@/components/source-image-gallery"

// ── Text helpers (mirrors post-detail.tsx) ───────────────────────────────────

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

    if (pattern.test(fullText) && fullText.replace(pattern, "").trim() === "") {
      return null
    }

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

function splitByH2(md: string): string[] {
  return md.split(/(?=^## )/m).filter((s) => s.trim())
}

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

// ── Markdown component map (mirrors post-detail.tsx callout rendering) ────────

function buildMdComponents(sourceCount: number): Components {
  return {
    h2: ({ children }) => {
      const text = extractNodeText(children)
      const id = slugify(text)
      return <h2 id={id}>{children}</h2>
    },

    blockquote: ({ children }) => {
      const text = extractNodeText(children)

      // [GRID]
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
                <a href="#sources">{sourceCount} cited below ↓</a>
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
            <div className="callout-content">{filtered}</div>
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
            <div className="callout-content">{filtered}</div>
          </div>
        )
      }

      // [CASE STUDY: Title]
      if (text.match(/\[CASE STUDY/i)) {
        const title = text.match(/\[CASE STUDY:\s*([^\]]+)\]/i)?.[1] ?? "Case Study"
        const filtered = stripMarker(children, /\[CASE STUDY:[^\]]+\]\s*/i)
        const url = extractUrl(text)

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
            <div className="callout-content">{filtered}</div>
          </div>
        )
      }

      // [AU]
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
            <div className="callout-content">{filtered}</div>
          </div>
        )
      }

      // [NZ]
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
            <div className="callout-content">{filtered}</div>
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

      // [INSIGHT] (simple block)
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

    ol: ({ children }) => <ol className="post-numbered-list">{children}</ol>,

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

    p: ({ children }) => <p>{children}</p>,

    img: ({ src, alt }) => {
      if (!src || typeof src !== "string") return null
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
}

// ── Main Preview Component ────────────────────────────────────────────────────

export default function ArticlePreviewPane({ post }: { post: Post }) {
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
  const contentSections = splitByH2(before)

  // Admin preview: no fetched source images — render gallery from source metadata only
  // (imageUrl/inlineImages will be empty stubs; gallery hides itself when no images)
  const sourceImages: SourceWithImage[] = post.sources.map((s) => ({
    ...s,
    imageUrl: null,
    inlineImages: [],
  }))

  const mdComponents = buildMdComponents(post.sources.length)

  return (
    <div className="preview-pane bg-white rounded-2xl shadow-sm overflow-hidden border border-ink/10">
      {/* Label strip */}
      <div className="px-5 py-2.5 bg-lavender/60 border-b border-ink/10 flex items-center justify-between">
        <span className="eyebrow text-ocean text-[10px] tracking-widest uppercase">
          Preview — rendered article
        </span>
        <span className="mono text-[10px] text-muted">
          read-only · public site view
        </span>
      </div>

      <div className="bg-white" style={{ background: "hsl(245, 30%, 98%)" }}>
        {/* Disclaimer */}
        <DisclaimerBanner />

        <div className="px-4 sm:px-6 pt-8 pb-16">
          <div className="max-w-4xl mx-auto">

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

            {/* ── Hero Image (if image_url is set) ────────────────────────── */}
            {post.image_url && (
              <div className="article-hero-img-wrap mb-8">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.image_url}
                  alt={post.og_image_alt ?? post.title}
                  className="article-hero-img"
                  loading="eager"
                />
                {post.image_credit && (
                  <p className="article-hero-img-caption">
                    <strong>Credit:</strong> {post.image_credit}
                  </p>
                )}
              </div>
            )}

            {/* ── TL;DR strip ─────────────────────────────────────────────── */}
            {post.tldr && (
              <div
                className="rounded-xl px-5 py-4 mb-6 flex gap-3 items-start"
                style={{
                  background: "hsl(245, 40%, 96%)",
                  border: "1px solid hsl(245, 30%, 88%)",
                }}
              >
                <span className="text-lg flex-shrink-0" aria-hidden>💡</span>
                <div>
                  <p
                    className="text-[10px] font-semibold tracking-widest uppercase mb-1"
                    style={{ color: "hsl(240, 55%, 55%)", fontFamily: "var(--font-space-grotesk), sans-serif" }}
                  >
                    TL;DR
                  </p>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "hsl(240, 30%, 30%)", fontFamily: "var(--font-montserrat), sans-serif" }}
                  >
                    {post.tldr}
                  </p>
                </div>
              </div>
            )}

            {/* ── Who This Is For ─────────────────────────────────────────── */}
            <WhoThisIsFor />

            {/* ── Mobile TOC ──────────────────────────────────────────────── */}
            <MobileToc items={tocItems} />

            {/* ── Main Grid: content + sidebar ────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">

              {/* Content panel */}
              <div
                className="rounded-2xl p-5 sm:p-8 min-w-0"
                style={{
                  background: "#ffffff",
                  border: "1px solid hsl(245, 25%, 90%)",
                  boxShadow: "0 4px 24px -4px hsl(240 50% 20% / 0.06)",
                }}
              >
                {contentSections.map((section, i) => (
                  <article key={i} className="post-prose">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={mdComponents as Parameters<typeof ReactMarkdown>[0]["components"]}
                    >
                      {section}
                    </ReactMarkdown>
                  </article>
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
                      components={mdComponents as Parameters<typeof ReactMarkdown>[0]["components"]}
                    >
                      {sources}
                    </ReactMarkdown>
                  </article>
                )}

                {/* Source image gallery — will be empty stubs in admin (no fetched images) */}
                <SourceImageGallery sources={sourceImages} />

                {/* Social share */}
                <SocialShare title={post.title} />
              </div>

              {/* Sticky TOC sidebar (desktop) */}
              <aside className="hidden lg:flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
                <TocSidebar items={tocItems} />
              </aside>
            </div>

            {/* ── Author Bio ──────────────────────────────────────────────── */}
            <AuthorBio />

            {/* ── Join CTA ────────────────────────────────────────────────── */}
            <JoinCTA />

          </div>
        </div>
      </div>
    </div>
  )
}
