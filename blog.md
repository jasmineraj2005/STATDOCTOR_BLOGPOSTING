# blog.md — StatDoctor editorial system + session handover

The StatDoctor blog exists to rank on page one of Google for high-intent locum
queries and to convert that traffic to doctor sign-ups on the app. Every
editorial decision is graded against those two outcomes.

This doc owns *what we publish and why* plus the **handover state of the project as of 2026-05-12**. Engineering bible: `AGENTS.md`. Pipeline integration bible: `BLOG_AGENT.md`.

---

## TL;DR — where we are right now

- ✅ Two-repo pipeline is built and shipping articles end-to-end
- ✅ 4 articles live at `/blog`, each with hero / table / callouts / source gallery
- ✅ Vercel cron scrapes 9 competitor blogs Mon/Wed/Fri
- ⚠️ Word counts are under spec (988-1125 vs 1500/1200) — needs fresh full-Researcher runs to fix
- ⚠️ Domain `statdoctor.app` (2.5 years old, has existing authority) **not attached yet** — must audit before cutover
- ⚠️ Approval workflow for CEO not built yet — design decisions captured below, build is the next major chunk. **Anu has committed to a 20–30 min Sunday batch-review window (2026-05-12)**, so the build is unblocked.
- ⚠️ Not yet submitted to Google Search Console / Bing Webmaster Tools

---

## Three streams (40 / 40 / 20)

| Stream | Driver | Decay | Example |
|---|---|---|---|
| **News** | News-cycle, Intelligence agent fans out across 5 news adapters | Days | Geelong refinery fire and locum travel costs; Medicare reform impact on locum billing |
| **Guides** | Pillar-coverage gaps, evergreen topic bank | Years | Locum GP rates by state 2026; AHPRA registration step-by-step |
| **Inside StatDoctor** | Founder POV, marketplace mechanics | Years | Why we built StatDoctor; The economics of removing the middleman |

The Intelligence agent runs the 40/40/20 weighting automatically with two override rules:

1. Never run three of the same `content_type` in a row.
2. Force a guide if any of `{Pay & Rates, How-to, Location, Wellbeing}` has zero coverage in the last 12 posts.

Manual override: `MODE=news|guide|company python main.py`.

---

## Pillar map

| Pillar | Content types | Cluster anchor |
|---|---|---|
| `industry_news` | news | "What changed for locums this month" |
| `locum_pay_rates` | guide | "Locum GP rates by state" |
| `how_to_locum` | guide | "AHPRA registration walkthrough" |
| `locum_by_location` | guide | "Locum work in regional NSW" |
| `doctor_wellbeing` | guide | "Burnout in locum medicine" |
| `locum_vs_agency` | guide, company | "Marketplace vs agency fee structures" |
| `company_pov` | company | "Why we built StatDoctor" |

---

## Voice rules

- Australian English (organisation, licence, practise, recognise).
- Doctor-first, not patient-first. Readers are clinicians.
- Marketplace honest about limitations. Don't oversell.
- **AHPRA-banned**: best, number one, #1, guaranteed, cure, leading, world-class, miracle, proven, 100% safe, no side effects.
- **Editorially banned**: comprehensive, delve, today, this week, recently (in guides), groundbreaking, robust, world-class.
- Anchor text on inline citations is the entity name, never `[source]`. Example: "[AHPRA registration requirements](https://www.ahpra.gov.au/...)" — not "[source](...)".
- Currency: `A$` or `AUD` prefix, never bare `$`.
- Dates absolute, never relative (`April 2026`, not `last month`).

---

## Editorial review workflow (decided 2026-05-12)

Dr. Anu is AHPRA-registered and bylined on every article. Legally and reputationally he must own what's published. But "approve every article in real-time" is operationally unsustainable and creates a bottleneck.

**Decision: tiered approval, not one-size-fits-all.**

| Stream | Approval mode | Rationale |
|---|---|---|
| **News** | Auto-publish. CEO can unpublish via one-click email after the fact. | News loses 80% of value if it ships 4 days late. AHPRA agent + writer validators are the safety net. |
| **Guides** | Batch approval — CEO approves a week's worth on Sunday in ~20 min | No time decay on evergreen, so a 6-day queue costs nothing. |
| **Inside StatDoctor** | CEO writes / co-writes. AI assists. Approval is the publish action. | Highest brand-voice risk, lowest volume. |

**Commitment secured (2026-05-12)**: Anu has committed to a **20–30 minute Sunday batch-review window**. This unblocks the dashboard build — the `/admin/posts` review queue is the next major chunk. Without this verbal commitment the right alternative would have been auto-publish-all-with-silent-CEO-oversight (technically YMYL-risky but operationally honest); we don't need that fallback now.

### Why edit-with-validators (not no-edit)

A pure "approve or reject only" gate is too restrictive and will frustrate the CEO. The bad scenario isn't *editing* — it's *unguarded* editing. A non-SEO-trained editor changing "A$1,850/day" to "the best rates in Australia" tanks the article (banned phrase, AHPRA breach).

**The fix**: edit panel re-runs the same validators the writer runs. Approve only goes green when:

- AHPRA agent: passes
- Banned-phrase filter: clean
- Anchor-text rule: no `[source]` style
- Callout quota: met for the content type
- Comparison table: present
- Schema: validates
- Word count: ≥ floor for the content type

Otherwise the CEO sees what's broken and either fixes or rejects.

### Structured rejection taxonomy

Free-form rejection ("I don't like it") makes rewrites blind dice-rolls. Build a small taxonomy so the rejection reason becomes a constraint passed to the regen Writer prompt:

- Off-brand voice
- Weak sources / not enough .gov.au
- Wrong angle / not what we'd say
- Too promotional / breaks the honest-marketplace rule
- AHPRA flag I disagree with
- Topic just isn't interesting
- Other (free text)

**Operational limits to hard-code:**
- After **2 rejections** on the same topic → drop it, pick another. No rewrite spirals.
- Track rejection patterns weekly: >25% sustained = writer prompt needs tuning. <10% = gate is mostly ceremonial.
- The rejection reason flows into the Writer's retry message: *"Your previous draft was rejected because [REASON]. Rewrite addressing this specifically."*

---

## Competitor positioning

Each competitor's blog is a topic source, not a template. We take inspiration on what to cover, not how to write.

| Competitor | Their angle | What they do well | StatDoctor differentiator |
|---|---|---|---|
| [Hopmedic](https://hopmedic.com/) | Marketplace + telehealth | Closest model to ours | We're zero-commission; they take a cut |
| [Go Locum](https://golocum.com.au/) | Web-app for flexible shifts | Remote AU coverage | We have hospital depth; they're rural-thin |
| [Wavelength](https://wave.com.au/) | Largest AU recruiter (agency, since 1999) | Brand authority + content depth | We don't take buyout fees |
| [Medrecruit](https://medrecruit.medworld.com/) | Australasia's largest recruiter | Volume of placements | We're direct, not gatekept |
| [Blugibbon](https://www.blugibbon.com.au/) | Boutique Sydney agency | Personal-service narrative | We scale personal at zero margin |
| [Locumate](https://locumate.ai/) | Multi-vertical AU staffing | Live ROI calculator | We focus on doctors specifically |
| [Patchwork Health](https://patchwork.health) | UK collaborative bank | Strongest brand voice in the category globally | We bring that voice to AU regs |
| [Nomad Health](https://nomadhealth.com) | US travel medicine marketplace | Scroll-driven editorial design | We localise editorially for AU/NZ |
| [ShiftKey](https://www.shiftkey.com) | US per-diem marketplace | Strongest photographic direction | We pair photography with primary-source rigour |

The competitor audit at `app/api/cron/competitor-audit` runs **Mon/Wed/Fri 14:00 UTC** (midnight Sydney AEDT), scrapes each blog index, and proposes additions to the evergreen topic bank. Approvals at `/admin/competitor-topics`.

---

## Quality bar — publishing checklist

Pre-merge, every new post JSON must satisfy:

- [ ] AHPRA agent passed (or flags reviewed by a clinician)
- [ ] ≥3 distinct publishers cited; ≥1 government / peer-reviewed
- [ ] Anchor text uses entity names, never `[source]`
- [ ] Hero image renders in full (no crop) with publisher + title citation
- [ ] Callout quota met (4 guides, 3 news, 3 company)
- [ ] FAQ count met (8+ guides, 6+ news, 4+ company)
- [ ] Internal links present (3–5 guides, 1–2 news, 2–3 company)
- [ ] Schema validates (FAQPage + MedicalScholarlyArticle + BreadcrumbList)
- [ ] Slug ≤ 60 chars; TL;DR ≤ 240 chars
- [ ] meta_title ≤ 60; meta_description ≤ 155
- [ ] Word count in band (1500–2000 news, 1500–2500 guide, 1000–1800 company)

---

## What's shipped vs. pending

### Shipped ✅

**Backend (`/Users/jasminebaldevraj/STATDOCTOR_BLOGPOSTING/backend/`)**
- `ContentType` enum + `COMPANY_POV` pillar in `models.py`
- Intelligence dispatcher with 40/40/20 + override rules in `agents/intelligence.py`
- Writer prompt branching (news / guide / company) in `agents/writer.py`
- Hard validators (callouts + table) with retry; soft validator (word count) with warning
- `--regen <slug>` flag reusing topic+research+sources from existing JSON
- Chart extraction from existing markdown for regen articles
- 5 source adapters: Guardian, ABC, NewsAPI, Google News RSS, Authoritative
- 30-topic evergreen seed bank at `backend/data/evergreen_topics.json`
- Migration scripts (`scripts/migrate_past_topics.py`, `scripts/backfill_content_type.py`)
- Past topics ledger upgraded to structured schema

**Frontend (`/Users/jasminebaldevraj/website/`)**
- `content_type` schema in `lib/blog/posts.ts`
- Two-row filter UI (content_type → pillar) in `app/blog/BlogClient.tsx`
- Per-content-type card variants (ribbon, live dot for news, left border for company)
- Article hero with three-tier fallback (source photo → Unsplash credited → typography)
- `[POV]` callout for company content
- Markdown table styling (`.post-prose table`)
- QuickChart chart figure rendering (`.post-chart-figure`) with caption + credit
- Per-content-type article treatments (chip on hero, disclaimer for news, "last reviewed" for guide)
- `blog.css` callouts on brand palette (ocean / electric / leaf / ink only)
- All beige/bone removed from blog routes
- Posts-server cache invalidates on `content/posts/` mtime

**Automation**
- `vercel.json` cron Mon/Wed/Fri 14:00 UTC
- `app/api/cron/competitor-audit/route.ts` — cheerio scrape + GPT-4o-mini cluster + Vercel KV write
- `app/admin/competitor-topics/page.tsx` — approve/reject UI gated by `ADMIN_TOKEN`
- `app/api/competitor-topics/approve/route.ts` — POST handler
- `lib/competitor/sources.ts` — 9 competitor URLs + selectors
- Sitemap + robots + JSON-LD (FAQPage + MedicalWebPage)

### Pending ⚠️

**Content quality**
- Word counts at 988-1125 (target 1500/1200) — fix by running fresh `python main.py` cycles through full Researcher (regen has thin context)
- Only 2 of 4 articles have charts (others lacked numeric stats)
- Anchor text in shipped articles still has some `[source]` patterns — needs re-regen pass with the new writer prompt

**SEO upgrades (largest ranking impact)**
- Schema is still `MedicalWebPage` — upgrade to `MedicalScholarlyArticle` + `Person(author)` + `Reviewer` + `BreadcrumbList` + `Speakable`
- Author profile page `/about/dr-anu-ganugapati/page.tsx` with AHPRA register `sameAs` link
- `<html lang="en-AU">` (currently `en`)
- `geo.region` meta tag
- `dateModified` field on `FinalPost` for freshness
- Pillar hub pages `/blog/[pillar]/page.tsx`
- Internal linking pass (needs 8+ articles per pillar first)

**AEO upgrades (LLM citation visibility)**
- `llms.txt` file (new convention guiding LLM crawlers)
- Definitional H2 ledes ("X is Y" as first sentence)
- Inline `[Q:][A:]` blocks within body sections (not just FAQ)
- Bing News inclusion (apply via Bing Webmaster Tools)
- Citations to peer-reviewed sources (PubMed, Lancet, MJA) — currently mostly Guardian

**Approval workflow (the CEO's ask)**
- `/admin/posts` review queue page in website
- Article statuses: `pending_review` → `approved` | `rejected` | `edited`
- Validator panel in edit UI (must show all green before Approve enabled)
- Structured rejection taxonomy + rejection-reason-as-Writer-constraint
- Edit history audit log
- "Publish" button that commits JSON to `content/posts/` and triggers `dateModified` update

**Operational**
- Google Search Console verification + sitemap submission
- Bing Webmaster Tools verification
- Vercel KV provisioning (cron runs but doesn't persist proposals)
- `CRON_SECRET` and `ADMIN_TOKEN` env vars in Vercel project settings
- Domain attach: audit what's currently at `statdoctor.app`, build redirect map, plan cutover
- GA4 or Plausible analytics integration

---

## Tracking + measurement stack

### Free, set up today (~30 min total)

- **Google Search Console** — verify ownership, submit sitemap, see queries / impressions / CTR / indexing
- **Bing Webmaster Tools** — same for Bing (also powers ChatGPT search)
- **Google Rich Results Test** — validates schema on every URL before publish
- **GA4 or Plausible** — Plausible is privacy-friendly and AU-hosted, recommended

### Paid (when budget allows, $100-200/mo)

- **Ahrefs** or **SEMrush** — keyword position tracking, competitor backlinks, content gap analysis
- **Ubersuggest** — cheaper alternative (~$30/mo)
- **Surfer SEO** — content optimization scoring

### AEO tracking (emerging space, none mature)

- **Profound** (profound.so) — tracks brand citations in ChatGPT / Claude / Perplexity responses
- **Otterly.ai** / **Goodie AI / AthenaHQ** — alternatives
- Manual monthly check: query Perplexity / ChatGPT / Claude with target keywords, see if StatDoctor is cited

---

## Domain attach — must do before cutover

`statdoctor.app` is **2.5 years old** but not yet attached to this redesigned site. The existing domain may have:

- Accrued backlinks over 2.5 years
- Existing Google rankings for some keywords
- Crawl + indexing history with Google

**Don't blow this away.** Audit before cutover:

1. `curl -I https://statdoctor.app/` — see what's currently served
2. `site:statdoctor.app` on Google — see what's indexed
3. If Search Console history exists for the domain, export the keyword/ranking data
4. Plan 301 redirects for any URLs that change
5. Set `dateModified` on existing JSONs so Google sees the migration as a freshness signal, not a churn signal

The redirect map is the highest-leverage SEO task tied to launch.

---

## Topic bank pointers

- **Evergreen seed**: `backend/data/evergreen_topics.json` (30 cornerstone topics across 6 pillars).
- **Competitor proposals**: Vercel KV `competitor:proposed:latest`, surfaced at `/admin/competitor-topics`.
- **Dedupe ledger**: `backend/past_topics.json` — structured, with `content_type`, `pillar`, `slug`, `ts`.
- **Approved competitor adds**: copied from admin UI into the seed file as a versioned PR. Direct GitHub-API auto-PR is a v2 enhancement.

---

## Operations

| Action | Command |
|---|---|
| News run | `MODE=news python main.py` |
| Guide run | `MODE=guide python main.py` |
| Company run | `MODE=company python main.py` |
| Auto run (40/40/20) | `python main.py` |
| Regenerate single post | `python main.py --regen <slug>` |
| Backfill `content_type` on existing posts | `python -m backend.scripts.backfill_content_type` |
| Migrate `past_topics.json` schema | `python -m backend.scripts.migrate_past_topics` |
| Sync backend output to website | `cp backend/output/*.json /Users/jasminebaldevraj/website/content/posts/` (only newest per slug; old timestamped versions are retained in backend/output) |
| Trigger competitor audit manually | `curl -H "Authorization: Bearer $CRON_SECRET" https://statdoctor.app/api/cron/competitor-audit` |
| Local dev | `cd /Users/jasminebaldevraj/website && npm run dev` |
| Production build | `npm run build` |
| Typecheck | `npx tsc --noEmit` |

---

## Environment variables

### Website (`/Users/jasminebaldevraj/website/.env.local`)

- `NEXT_PUBLIC_MAPBOX_TOKEN` — hero map (existing)
- `GUARDIAN_API_KEY` — Guardian Content API for hero image hydration
- `OPENAI_API_KEY` — competitor audit LLM clustering call
- `UNSPLASH_ACCESS_KEY` + `UNSPLASH_SECRET_KEY` — currently set, available for any image fallback work
- `CRON_SECRET` — **must be set in Vercel** before deploy (auto-injected by Vercel for cron invocations)
- `ADMIN_TOKEN` — **must be set in Vercel** for `/admin` route gating
- `KV_REST_API_URL` + `KV_REST_API_TOKEN` — **must be set after Vercel KV provisioning**

### Backend (`/Users/jasminebaldevraj/STATDOCTOR_BLOGPOSTING/backend/.env`)

- `OPENAI_API_KEY` — pipeline runs (Intelligence / Writer / SEO / AHPRA agents)
- `GUARDIAN_API_KEY` — Guardian source adapter
- `UNSPLASH_ACCESS_KEY` — Researcher hero image fallback
- `NEWSAPI_KEY` — NewsAPI source adapter (optional; if set, adapter activates)

---

## Editorial cadence

Default schedule (when scheduler is enabled): one post every 48 hours, picked by the dispatcher per the 40/40/20 weighting. At that cadence the blog ships ~15 posts/month: ~6 news, ~6 guides, ~3 company.

Quarterly: review every guide for stale figures, update `dateModified`, re-publish. AHPRA fees, pay rates, tax thresholds, and Medicare item numbers are the most common rot.

---

## Resume from a new session — quick start

If you (or a fresh agent) are picking this up cold:

1. **Read these three files in order**, in this order:
   - `/Users/jasminebaldevraj/website/blog.md` (this file)
   - `/Users/jasminebaldevraj/website/BLOG_AGENT.md` (pipeline integration)
   - `/Users/jasminebaldevraj/website/AGENTS.md` (site-wide engineering)

2. **State of the codebase** (as of 2026-05-12):
   - Backend pipeline complete, ships news + guide + company articles
   - Frontend complete, renders all three content types with distinct visual treatments
   - 4 articles live, fully visual (hero / table / callouts / source gallery)
   - Vercel cron running 3×/week, scraping 9 competitors
   - No `/admin/posts` approval queue yet — designed but not built

3. **Highest-leverage next moves** (ranked):
   1. Build the `/admin/posts` approval queue per the Editorial review workflow section above. Needed before the CEO will commit to a publishing cadence.
   2. Schema upgrade (`MedicalScholarlyArticle` + `Person` + `BreadcrumbList`) — biggest YMYL trust lift.
   3. Author profile page `/about/dr-anu-ganugapati` with AHPRA register link.
   4. Domain attach audit + redirect map for existing `statdoctor.app`.
   5. Google Search Console + Bing Webmaster verification.
   6. Run a few fresh `python main.py` cycles to validate the pipeline end-to-end with full Researcher (vs regen).

4. **Open decisions awaiting CEO/user input**:
   - ✅ **RESOLVED 2026-05-12**: Anu has committed to a 20–30 min Sunday batch-review window. Dashboard build is unblocked.
   - Does company-stream content go through the same approval as guides, or does he write it directly?
   - Approve the redirect map for domain attach before cutover.

5. **Files to look at if confused**:
   - Backend writer prompts: `backend/agents/writer.py:_news_rules / _guide_rules / _company_rules`
   - Intelligence dispatcher: `backend/agents/intelligence.py:_decide_mode`
   - Frontend post type: `lib/blog/posts.ts:Post`
   - Per-content-type rendering: `components/blog/PostDetail.tsx` + `app/blog/BlogClient.tsx`
   - Callout CSS: `app/blog/blog.css` (scoped to blog routes only)
   - Cron logic: `app/api/cron/competitor-audit/route.ts`
   - Plan doc from the redesign session: `/Users/jasminebaldevraj/.claude/plans/so-i-want-the-imperative-wall.md`
