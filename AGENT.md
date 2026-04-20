# StatDoctor Blog — Agent Handoff Context

## Project Overview
Next.js 15.2.6 / React 19 / TypeScript blog for **StatDoctor** (`https://statdoctor.app`), a locum doctor marketplace connecting hospitals with verified doctors across Australia. The blog covers locum doctor topics (Medicare reforms, fuel prices, rural health, NHS strikes, etc.).

**Working directory:** `extracted/` — this is the Next.js frontend  
**Backend (Python AI pipeline):** `backend/` — 5-agent OpenAI pipeline that generates articles and saves them to `backend/output/*.json`

---

## Architecture

### Key Directories
```
extracted/
  app/
    dashboard/posts/[slug]/page.tsx  ← article page (server component, fetches media)
    globals.css                       ← ALL styles live here
  components/
    post-detail.tsx     ← main article renderer (markdown → React, callout boxes, layout)
    join-cta.tsx        ← CTA box at end of article ("Join Locum Network")
    author-bio.tsx      ← Dr. Anu Ganugapati bio
    source-image-gallery.tsx  ← "As Reported By" section with source images
    related-articles.tsx
    social-share.tsx    ← "use client" — copy link, X, LinkedIn
    disclaimer-banner.tsx
    who-this-is-for.tsx ← 3 persona cards
    toc-sidebar.tsx     ← sticky TOC sidebar
    reading-progress.tsx
  lib/
    posts-server.ts     ← reads JSON posts from backend/output/
    posts.ts            ← Post type definition
  public/
    author-anu.png      ← Dr. Anu's photo
  .env.local            ← GUARDIAN_API_KEY (Guardian Content API)

backend/
  output/               ← Generated article JSON files (loaded by Next.js)
  .env                  ← OPENAI_API_KEY, GUARDIAN_API_KEY, UNSPLASH_ACCESS_KEY
```

### Article Flow
1. Python pipeline generates `backend/output/{timestamp}_{slug}.json`
2. `lib/posts-server.ts` reads all JSON files (excluding `used_images.json`)
3. `app/dashboard/posts/[slug]/page.tsx` fetches media:
   - Guardian URLs → Guardian Content API (`GUARDIAN_API_KEY`)
   - Other URLs → OG image scraping
4. `post-detail.tsx` renders the article with custom callout boxes

---

## Callout Box System

All callout boxes in markdown use `> [TYPE] text` syntax:
- `> [KEY FACTS]` → `.callout-key-facts` (purple header band, bullet list)
- `> [KEY TAKEAWAY]` → `.callout-takeaway` (lime/green header band)
- `> [INFO]` or `> [TIP]` → `.callout-info` (blue left-border, "Smart Tips")
- `> [CASE STUDY: Title]` → `.callout-case-study` (white card with shadow)
- `> [AU]` → `.callout-au` (blue tint, Australian Context)
- `> [NZ]` → `.callout-nz` (green tint, New Zealand Context)

**Important:** `preprocessCalloutMarkers()` splits inline `> [TYPE] text` into separate lines so the marker can be stripped cleanly by `stripMarker()`.

### CSS Callout Rules (globals.css)
- All callouts: `margin: 1.5rem 0`, no `max-width` (fill container)
- Shared content area: `.callout-content { padding: 0.9rem 1.25rem 0.7rem }`
- `.callout-sources-note` inside Key Facts: `margin-top: 0.4rem; margin-bottom: 0`

---

## Image Strategy — "No Image Without Source"

Every image must have attribution. Rules:
- Hero image: only shown when a source's `imageUrl` is available (OG image from Guardian API or scrape)
- Inline images: from Guardian body blocks (signed CDN URLs via API) or source OG images
- **Unsplash, quickchart.io, and generic placeholders are filtered out** in the `img` renderer
- Source images are injected between article sections (after sections 0 and 2)
- "As Reported By" gallery shows up to 3 cards with images

### Guardian Content API
- Key: `GUARDIAN_API_KEY` in `extracted/.env.local` AND `backend/.env`
- Endpoint: `https://content.guardianapis.com/{path}?show-blocks=all&show-fields=thumbnail,main&api-key=KEY`
- Returns signed `i.guim.co.uk` image URLs (safe to hotlink)
- Body blocks give inline images; data-viz captions (chart/graph/price/rate) are prioritized

---

## Known Issues / TODO

### CRITICAL — AI-Fabricated Sources
Sources 6–10 in the fuel prices article are AI-generated 404s:
- `https://www.aihw.gov.au/reports/healthcare-delivery/fuel-price-impact` — 404
- `https://www.abs.gov.au/statistics/economic-impact-fuel-prices` — 404
- `https://www.ama.com.au/policy/locum-support` — 404
- `https://www.energy.gov.au/national-fuel-security-plan` — 404
- `https://www.doh.gov.au/reports/fuel-costs-medical-supply-chains` — domain doesn't exist

**Action needed:** Replace with verified real URLs from AIHW, ABS, RACGP, AMA, Dept of Health.

### Case Study Links
Case study callouts without an explicit URL fall back to a Google search. The AI-generated "Geelong Regional Hospital" case study is fabricated. Real case study sources needed from:
- RACGP: https://www.racgp.org.au/running-a-practice/practice-workforce/
- AIHW rural health workforce reports
- Dept of Health rural incentives

### Pending Features
- **SEO `<head>` meta tags** — `<title>`, `og:image`, `og:description` not wired up
- **Sitemap.xml** — needed for Google indexing
- **Mobile TOC** — hidden on small screens; needs slide-in drawer
- **Dashboard search/filter by pillar**
- **Multi-agency sources** — currently all 6 sources for fuel article are Guardian; need ABC/Reuters/SMH

---

## Design System

- **Brand colors:** `--sd-primary: hsl(240, 55%, 52%)`, lime: `--sd-brand-lime: hsl(68, 85%, 55%)`
- **Fonts:** Varela Round (headings), Montserrat (body), Space Grotesk (labels/UI)
- **Article layout:** `grid grid-cols-1 lg:grid-cols-[1fr_260px]` — content + TOC sidebar
- **Content panel:** white card, `rounded-2xl p-8 md:p-10`, subtle shadow

## Author
**Dr. Anu Ganugapati** — Founder & CEO, StatDoctor  
LinkedIn: `https://www.linkedin.com/in/dr-anu-g-%F0%9F%A9%BA-3b330a248/`  
Photo: `public/author-anu.png`  
Bio: "Medical doctor, entrepreneur, and advocate for healthcare innovation. Founder and CEO of StatDoctor, Growth Development Manager at eMedici, and Head of Integrated Health and Education at Health104."
