# BLOG_AGENT.md — StatDoctor Blog Integration

Handoff doc for the blog/AEO integration work. Read this together with `AGENTS.md` (site-wide conventions) and the local `AGENT.md` in this repo.

The active plan file (point-in-time spec) lives at:
`~/.claude/plans/lets-go-back-to-splendid-hare.md`

(Predecessor: `~/.claude/plans/okay-what-you-see-ticklish-lamport.md` — superseded.)

---

## What this is

**Two-repo system:**

- **Factory** (this repo, `STATDOCTOR_BLOGPOSTING/`) — the Python pipeline at `backend/` generates AU/NZ locum-doctor articles as JSON; a Next.js admin at the repo root (`app/`) gates approvals before anything is published, and a CEO-facing SEO dashboard (`/admin/seo`) tracks page-one progress via GSC + Bing.
- **Website** (`/Users/jasminebaldevraj/website/`) — pure rendering surface. Only sees approved JSON in `content/posts/`.

The standalone Next.js viewer at `extracted/` was a v0 throwaway and is deprecated (kept on disk only until a clean delete; gitignored).

Goals of the current build (per the active plan):

1. **Approval gate.** The factory hosts `/admin/posts` so the CEO can review every article (Sunday batch window, 20–30 min) before it lands on the website. Approve = publish (fs cp in local dev; GitHub API commit in prod).
2. **SEO schema upgrade.** Articles emit `MedicalScholarlyArticle` + `Person` + `BreadcrumbList` + `FAQPage` JSON-LD with AHPRA-register `sameAs` on the author. `<html lang="en-AU">` and geo meta on the website.
3. **CEO progress dashboard.** Free Ahrefs-lite at `/admin/seo` powered by GSC + Bing Webmaster + a manual AEO log. Daily snapshots to Vercel Postgres; trend charts, keyword tracker, quick-wins panel.
4. **No cross-repo runtime dependency.** The website still just reads JSON from `content/posts/`. The approval handler is what writes it.

---

## Architecture (current)

```
STATDOCTOR_BLOGPOSTING/                  ← factory: generate + gate + measure
  backend/                                Python pipeline
    agents/                               intelligence, researcher, writer, seo, ahpra
    output/                               JSON drops here as status="pending_review"
  app/                                    Next.js (factory admin)
    layout.tsx + globals.css              admin shell
    page.tsx                              redirects to /admin/posts
    admin/
      posts/                              approval queue + edit panel (in progress)
      seo/                                CEO SEO dashboard (planned)
      competitor-topics/                  competitor topic proposals (live)
    api/
      posts/[slug]/{approve,reject,edit}/ post lifecycle (planned)
      cron/seo-snapshot/                  daily GSC + Bing pull (planned)
      cron/competitor-audit/              competitor scrape M/W/F (live)
  lib/
    posts/{loader,validators,publish}.ts  (planned)
    seo/{gsc,bing,db,aggregate}.ts        (planned)
    competitor/sources.ts                 (live)
  vercel.json                             cron schedule

website/                                  ← rendering surface only
  app/blog/                               list + dynamic [slug]
  app/about/dr-anu-ganugapati/            author page (planned)
  app/layout.tsx                          en-AU + geo meta + GSC/Bing verify
  components/blog/, lib/blog/
  content/posts/                          ← approved JSON arrives here
  app/sitemap.ts, app/robots.ts
```

### Data flow

```
Python pipeline ─► backend/output/*.json
                        │  (or directly via OUTPUT_DIR)
                        ▼
              website/content/posts/*.json
                        │
                        ▼ (server component, fs read)
       lib/blog/posts-server.ts ─► getAllPosts(), getPostBySlug()
                        │
                        ▼
        app/blog/[slug]/page.tsx
        ├─ generateMetadata()  ←  meta_title, og:image, twitter_card
        ├─ <PostDetail />      ←  markdown + callouts + TOC + share
        └─ <script ld+json>    ←  faq_json_ld + medical_webpage_schema
```

---

## JSON contract (the boundary)

Articles are JSON files under `content/posts/`. The schema is owned by `backend/models.py:FinalPost`. The frontend treats this contract as authoritative — never mutate fields, only render them.

Required fields used by the frontend:

| Field | Used in | Notes |
|---|---|---|
| `slug` | route, sitemap | kebab-case |
| `title`, `tldr`, `content_markdown` | `<PostDetail>` | markdown contains callouts: `> [TYPE] text` |
| `meta_title`, `meta_description` | `generateMetadata` | ≤60 / ≤155 chars |
| `og_image_alt` | OG image alt | ≤125 chars |
| `image_url` | hero + OG image | OG-scraped or Guardian CDN |
| `pillar` | category chip | one of 6 enum values |
| `target_keywords`, **`keywords`** | meta keywords | `keywords` is NEW in this plan |
| `sources[]` | "As Reported By" gallery | each has `publisher`, `url`, `snippet` |
| `faq_json_ld`, `medical_webpage_schema` | `<script ld+json>` | injected into `<head>` |
| **`twitter_card`** | twitter meta | NEW in this plan |
| `generated_at` | `<time>`, sitemap `lastmod` | ISO 8601 |
| `ahpra_passed`, `ahpra_flags` | disclaimer banner trigger | compliance |

Anything not listed above is informational; touching it is fair game from the writer side.

---

## Backend changes (in `STATDOCTOR_BLOGPOSTING/backend/`)

### 1. Pluggable news sources (`backend/sources/`)

```
sources/
  base.py              NewsSourceAdapter Protocol + Article dataclass
  guardian.py          extracted from current intelligence/researcher
  abc_au.py            ABC News Australia RSS (no key)
  newsapi.py           NewsAPI.org → Reuters/AP/SMH/Age/News.com.au (NEWSAPI_KEY)
  google_news_rss.py   Broad multi-publisher fallback (no key)
  authoritative.py     Curated AIHW/RACGP/AMA/health.gov.au/ABS/AHPRA anchors
```

Each adapter exposes `search(query, days_back, limit) → list[Article]`. Researcher fans out across all configured adapters in parallel and de-duplicates by URL.

**The model never produces URLs.** It selects from the validated adapter pool only.

### 2. URL validation (`backend/validation/urls.py`)

Domain whitelist + HEAD request (5s timeout, 1 retry, follow redirects, 200..399 only). If post-filter source count drops below 5, researcher re-broadens its queries (max 2 retries). Failures surface into `ahpra_flags` for human review.

Whitelist (initial set, expandable):
```
theguardian.com, abc.net.au, reuters.com, apnews.com,
smh.com.au, theage.com.au, news.com.au, 9news.com.au,
sbs.com.au, afr.com,
aihw.gov.au, abs.gov.au, health.gov.au, racgp.org.au,
ama.com.au, ahpra.gov.au, medicalboard.gov.au,
rcna.org.nz, health.govt.nz, rnzcgp.org.nz,
who.int, ncbi.nlm.nih.gov, nature.com, thelancet.com,
mja.com.au, bmj.com
```

### 3. SEO variation (`backend/agents/seo.py`)

Currently every article reads with the same title cadence. Rewrite the prompt so:

- Title pattern is **chosen per-pillar** from a pool: how-to / explainer / numerical-hook / question-form / news-update.
- `meta_description` leads with a **concrete value** (a stat, a $-figure, a date) drawn from the article body — not a generic intro sentence.
- `og_image_alt` references **specific imagery** of the chosen hero (publisher + scene), not "doctor in hospital."
- Add `keywords[]` (5–8 strings) and `twitter_card { title, description, image }` to the JSON output. Update `models.py` accordingly.

### 4. Env

`backend/.env`:
```
OPENAI_API_KEY=...
GUARDIAN_API_KEY=...
UNSPLASH_ACCESS_KEY=...
NEWSAPI_KEY=...                      # NEW
OUTPUT_DIR=../../website/content/posts  # for local dev
```

---

## Frontend changes (in `website/`)

### Components lifted from `extracted/components/` → `components/blog/`

`PostDetail.tsx`, `Callouts.tsx`, `TocSidebar.tsx`, `ReadingProgress.tsx`, `SocialShare.tsx`, `AuthorBio.tsx`, `JoinCta.tsx`, `SourceImageGallery.tsx`, `DisclaimerBanner.tsx`, `WhoThisIsFor.tsx`, `RelatedArticles.tsx`.

Token swaps applied to every lifted file:
- `Varela Round` → `Cormorant Garamond` (display headings)
- `Montserrat` → `Inter` (body)
- `Space Grotesk` → `Inter` with `tracking-wide uppercase` (UI labels)
- `--sd-primary` → `theme(colors.ocean)` (`#3232ff`)
- `--sd-brand-lime` → `theme(colors.electric)` (`#cde35d`)

**Callout CSS** (the `.callout-*` block from the old `globals.css`) is moved into a scoped `app/blog/blog.css` and imported only from blog routes — it must not bleed into marketing pages.

The `preprocessCalloutMarkers` and `stripMarker` helpers in `post-detail.tsx` are kept verbatim; only Tailwind classes change.

### Routes

`app/blog/page.tsx` (server) → `getAllPosts()` → `<BlogClient posts={…} />` (replaces hardcoded `POSTS`). Category chips derive from `post.pillar`.

`app/blog/[slug]/page.tsx` (server, NEW):
```ts
export async function generateStaticParams() {
  return getAllSlugs().map(slug => ({ slug }));
}

export async function generateMetadata({ params }): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);
  return {
    title: post.meta_title,
    description: post.meta_description,
    keywords: post.keywords,
    openGraph: {
      title: post.meta_title,
      description: post.meta_description,
      images: [{ url: post.image_url, alt: post.og_image_alt }],
      type: "article",
      publishedTime: post.generated_at,
    },
    twitter: { card: "summary_large_image", ...post.twitter_card },
    alternates: { canonical: `https://statdoctor.app/blog/${post.slug}` },
  };
}
```

JSON-LD is injected into the page via `<script type="application/ld+json">` for both `faq_json_ld` and `medical_webpage_schema`.

### Sitemap + robots

`app/sitemap.ts` enumerates static routes plus every blog slug from `getAllPosts()` (using `generated_at` for `lastmod`). `app/robots.ts` is allow-all and points at `/sitemap.xml`.

### Env

`website/.env.local`:
```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.…
GUARDIAN_API_KEY=…       # NEW: for OG-image hydration on Guardian sources
```

---

## Conventions specific to the blog surface

- **Markdown is the source of truth.** All structure (callouts, TOC anchors, FAQs) is encoded in the markdown body. No layout decisions live in the post JSON outside the listed fields.
- **No image without a source.** `<PostDetail>` filters out Unsplash, quickchart.io, and generic placeholders. Every visible image must carry attribution.
- **Hotlink, don't mirror.** Guardian (`i.guim.co.uk`) and major publishers' OG images are safe to hotlink. Don't add a CDN/mirror layer until a publisher actually blocks us.
- **No comments shim.** When a post is removed from `content/posts/`, the route 404s — no redirect map, no `_deprecated.json`. Add one only if a real-world incoming link warrants it.
- **AHPRA flags drive the disclaimer banner.** Don't render the banner unconditionally; check `ahpra_passed` and the `flag_type`s.

---

## Implementation status

Last updated: 2026-05-12 (Phase 1 + 2 of current plan complete and committed; not pushed yet).

**Important repo rule** — see [[repo-separation]] in memory: the Next.js dashboard lives **inside `extracted/`** (the Vercel deploy root). All new admin work goes there, not at the repo root. The client-facing site `~/website/` is a separate repo and off-limits unless explicitly named.

| Task | Status |
|---|---|
| **Phase 1** — Backend: `FinalPost` + `ContentType` enum + `keywords` + `twitter_card` + `dateModified` + `status` + `rejection_history` + `COMPANY` pillar | DONE (commit `c6aa02d`) |
| **Phase 1** — `agents/seo.py` per-pillar title cadence + `keywords` + `twitter_card` emission | DONE (commit `c6aa02d`) |
| **Phase 1** — `pipeline.py` writes `status="pending_review"`, derives `content_type` from pillar | DONE (commit `c6aa02d`) |
| **Phase 2** — `/admin/posts` approval queue inside `extracted/` (loader, 8-check validator panel, edit, approve = publish via fs/GH API, structured rejection taxonomy) | DONE (commit `26b9e9b`) |
| **Phase 2** — `lib/admin/{loader,validators,publish,audit,auth,types,competitor-sources}.ts` | DONE (commit `26b9e9b`) |
| **Phase 2** — Competitor-topics admin + cron moved INTO `extracted/` (they were sitting at the repo root, invisible to Vercel) | DONE (commit `26b9e9b`) |
| **Phase 2** — `extracted/package.json` deps: `@vercel/kv`, `openai`, `cheerio` | DONE (commit `26b9e9b`) |
| Local smoke tests: `/admin/posts`, `/admin/posts/{slug}`, `/admin/competitor-topics` → 200; `POST /api/posts/{slug}/approve` re-validates and refuses on fail | DONE |
| **Phase 3** — Website `app/about/dr-anu-ganugapati/` with `Person` JSON-LD + AHPRA `sameAs` | TODO (separate website repo) |
| **Phase 4** — `/admin/seo` dashboard in `extracted/` (GSC + Bing + AEO log, Postgres-backed) | TODO |
| **Phase 5** — Domain attach audit + GSC/Bing verification + sitemap submission | TODO |
| **Phase 6** — Word count fix via fresh full-Researcher runs | TODO |
| Push `main` → origin (3 commits ahead) and verify Vercel build of `extracted/` | TODO — user approval gated |
| `sources/` adapter package (pluggable news) | DONE per `blog.md` (5 adapters live) |
| `validation/urls.py` HEAD-check + whitelist | TODO (carry-over from previous plan) |

---

## Verification checklist

1. `python main.py --regen <slug>` — every source URL returns 200/3xx; ≥3 distinct publishers; ≥1 government/authoritative body.
2. Generate 3 articles across different pillars; titles + descriptions follow distinct patterns.
3. Copy 3 JSON files into `website/content/posts/`; `npm run dev` → `/blog` lists them; click into one and verify callouts, TOC, gallery, share, JSON-LD.
4. View source on a post: `<title>`, `og:image`, `og:description`, `<script type="application/ld+json">` (FAQPage + MedicalWebPage) present.
5. `/sitemap.xml` and `/robots.txt` resolve.
6. `npm run build` — clean; `generateStaticParams` produces a route per slug.
7. Lighthouse SEO ≥95 on a post page.
8. Schema validators: https://search.google.com/test/rich-results and https://validator.schema.org/ on the rendered JSON-LD.

---

## Things NOT to do

- **Don't extend `extracted/`.** It's the deprecated v0 viewer. All new frontend work lands in `website/`.
- **Don't let GPT generate source URLs.** It must select from the validated pool only. Re-introducing free-form URL generation is the regression that brought us here.
- **Don't import the blog's old fonts** (Varela Round / Montserrat / Space Grotesk) into the website's global CSS. The integration deliberately uses the site's existing typography.
- **Don't widen the domain whitelist without justification.** Each addition is one more class of URL that bypasses the source-credibility ceiling.
- **Don't bypass `ahpra_flags`.** If the disclaimer banner is hidden, the article is non-compliant.
- **Don't add a runtime fetch from the blog repo.** The contract is JSON files in `content/posts/`. Cross-repo runtime coupling defeats the purpose of the integration.

---

## Open follow-ups (out of scope for this round)

- CI workflow that auto-PRs generated JSON from the blog repo into the website repo.
- Pipeline scheduling (daily/weekly cron).
- Mobile TOC drawer (currently hidden on small screens).
- Dashboard search/filter by pillar.
- Image mirroring/CDN if hotlinking starts failing.
