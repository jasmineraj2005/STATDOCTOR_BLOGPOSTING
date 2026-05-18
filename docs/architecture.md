# architecture.md

The complete reference for the StatDoctor blog system. Replaces AGENT.md, ARCHITECTURE_101X.md, BLOG_AGENT.md, blog.md, HANDOVER.md, README.md, DOMAIN_CUTOVER.md, chathandover.md, webflow.md. Current state of 2026-05-17 PM.

For the open ticket list: `bugs.md`.

---

## 1 — What this is

StatDoctor is an AU locum-doctor marketplace at `statdoctor.app`. This repo is the **editorial blog factory**: a Python pipeline generates AHPRA-compliant locum-doctor articles, the CEO (Dr Anu Ganugapati, AHPRA-registered) reviews them in a Next.js admin dashboard, and approved articles are auto-published to the public site.

**The single operating constraint**: the CEO must spend ≤ 25–30 minutes per Sunday and the rest of the week is unattended. Every architectural decision is judged against that constraint first. Silent failure is the worst outcome.

**Two repos, never mix.**
- `STATDOCTOR_BLOGPOSTING/` (this repo) — factory: Python pipeline + Next.js admin. Deploys to `blog.statdoctor.app`.
- `~/website/` + Webflow at `statdoctor.app` — public site. Off-limits unless the user explicitly names a file path.

---

## 2 — Operating cadence

| When (UTC) | Workflow | What it does |
|---|---|---|
| Mon / Wed / Fri / Sat 14:00 | `pipeline.yml` | Python generates 1 article, POSTs to `/api/admin/ingest` |
| Sat 20:00 (= 07:00 AEST Sun) | `pipeline.yml` | Same — adds a fresh article right before review |
| Mon / Wed / Fri 14:00 | `cron-competitor-audit.yml` | Scrape 9 competitor blogs for topic ideas |
| Daily 02:00 | `cron-seo-snapshot.yml` | Pull GSC + Bing data into Postgres |
| Daily 04:00 | `cron-canary.yml` | Layer D synthetic article walks ingest → approve → publish-dry → delete |
| Daily 09:00 | `cron-scheduled-publish.yml` | If today is Tue/Wed/Fri/Sun, publish the oldest queued article |
| Daily 22:00 | `cron-daily-digest.yml` | Email activity summary + alerts to anu@statdoctor.net |
| Mon 09:00 | `cron-sunday-batch-report.yml` | Email retrospective of the prior Sunday review |
| Sat 21:00 (= 07:00 AEST Sun) | `cron-sunday-reminder.yml` | Email: queue ready, with `Open review queue →` link |

CEO does ~25 min/week at `https://blog.statdoctor.app/admin/posts` — ACCEPT / EDIT / DISMISS per article.

---

## 3 — The status machine

```
pipeline.py → POST /api/admin/ingest
                    ↓
              runValidators(post)
                    ↓
        ┌───────────┴────────────┐
        ▼                        ▼
     all green              red + fixable
        │                        │
        │                        ▼
        │              save status='pending_heal'
        │              fire heal workflow_dispatch
        │              heal_agent.py runs
        │              POSTs patched post back
        │              re-validate → green = pending_review
        │                                red+attempts<2 = heal_failed
        ▼
   pending_review  ← CEO reviews here (visible in queue)
        │
        ├──[ACCEPT]──► scheduled ──► cron-scheduled-publish (Tue/Wed/Fri/Sun 09:00 UTC)
        │                                  ↓
        │                            publishPost (GitHub API commit to ~/website)
        │                                  ↓
        │                            status = 'published' | 'publish_failed'
        ├──[EDIT]──► (re-validates, returns to pending_review)
        └──[DISMISS / REJECT]──► rejected (2 rejections on same topic = drop permanently)
```

**Approve is NOT immediate publish.** It queues for the next Tue/Wed/Fri/Sun 09:00 UTC slot.

**Status enum (DB CHECK constraint):**
`pending_review | pending_heal | heal_failed | approved | scheduled | rejected | published | publish_failed`

---

## 4 — Pipeline (5 + 1 agents)

GitHub Action `pipeline.yml` runs `backend/main.py` → `pipeline.run_pipeline()` →

1. **Intelligence** (`backend/agents/intelligence.py`) — picks topic via 40/40/20 weighting (news/guides/Inside StatDoctor) with override rules: never 3 same content_type in a row; force a guide if any pillar has zero coverage in the last 12 posts.
2. **Researcher** (`backend/agents/researcher.py`) — gathers ≥5 authoritative sources. **The model never produces source URLs.** It selects from the validated adapter pool. Today: Guardian Content API + LLM-suggested additional_sources, gated by `data/url-whitelist.json` (26 domains, 6 tiers). Spec called for 5 adapters; only Guardian is wired (see `bugs.md` A7).
3. **Writer** (`backend/agents/writer.py`) — two-pass: outline (5–9 H2s with word targets) → draft. Word floors loaded from `validators.json`. Has expansion retry if draft falls short.
4. **SEO** (`backend/agents/seo.py`) — per-pillar title cadence + meta tags + JSON-LD schemas (`MedicalScholarlyArticle` with `reviewedBy` + `citation` + `publicationType`; `Person` for author; news-only `Speakable`).
5. **AHPRA** (`backend/agents/ahpra.py`) — regex scan against `_FORBIDDEN` list + GPT scan of first 2,500 chars + auto-injects disclaimers (general info, pay rates indicative).

**Fail-agent Layer A** (`backend/agents/fail_agent.py`) runs after each main agent: validates output (researcher source count, writer word floor, SEO schema, AHPRA banned phrases) and logs every check to the `pipeline_runs` table for operator debugging via `SELECT * FROM pipeline_runs WHERE run_id='<uuid>'`. Current iteration is observability-first; full re-prompt-on-fail orchestration is a follow-up (see `bugs.md` S3).

Pipeline POSTs the assembled `FinalPost` JSON to `/api/admin/ingest` with `Authorization: Bearer INGEST_TOKEN`. Idempotent by slug.

---

## 5 — Fail-Agent system (4 layers)

Defence-in-depth so the system survives months unattended.

| Layer | Where | What it does |
|---|---|---|
| **A — Python validators** | `backend/agents/fail_agent.py` | After each main agent, validates output. Logs every check to `pipeline_runs`. Failures currently observed not auto-retried. |
| **B — Workflow recovery** | `.github/actions/recover-and-alert/action.yml` | Composite Action wraps every cron's curl. On non-2xx: 60s retry, then POST `/api/alerts/dispatch` (severity=error). Used by all 6 workflows. |
| **C — Ingest gate** | `extracted/app/api/admin/ingest/gate.ts` + auto-heal in route | Runs `runValidators(post)`. If any fail AND fixable: status=`pending_heal`, fire heal workflow. If fail + non-fixable / retries exhausted: status=`heal_failed`. If schema CHECK rejects (migration not yet applied), falls back to `pending_review`. Layer C hard-gate in shadow mode by default (`FAIL_AGENT_INGEST_GATE=strict` to enable 422s). |
| **D — Daily canary** | `extracted/app/api/cron/canary/route.ts` + `cron-canary.yml` | 04:00 UTC: builds synthetic post, walks ingest → approve → publish-dry → delete. Slug prefix `__canary-` is filtered from queue views. On failure → `canary_failed` critical alert. |

**Heal-agent** (`backend/heal_agent.py`): when an article is `pending_heal` OR the CEO clicks HEAL on `/admin/posts/[slug]`, dispatches `heal.yml` workflow with the slug. The agent calls `GET /api/posts/[slug]/heal-data`, builds a fix instruction from the red validators, calls `writer.regenerate`, POSTs the patched post back via `/api/admin/ingest` with `X-Heal-Attempt: N+1`. Re-validates server-side. Max 2 attempts then status=`heal_failed`. **Today fixes only word_count + banned_phrases + anchor_text + callout_quota** — see `bugs.md` B1 + S4 for the bug where the instruction is built but not actually passed to the LLM.

---

## 6 — Editorial bar (voice, validators, content quality)

### Voice rules
- Australian English (organisation, licence, practise, recognise)
- Doctor-first, not patient-first. Readers are clinicians.
- Marketplace honest about limitations. Don't oversell.
- Anchor text on inline citations is the entity name, never `[source]`. Example: `[AHPRA registration requirements](https://www.ahpra.gov.au/...)` — not `[source](...)`.
- Currency: `A$` or `AUD` prefix, never bare `$`.
- Dates absolute, never relative (`April 2026`, not `last month`).

### Banned phrases (intended single source of truth: `extracted/lib/admin/validators.json`)
**Currently drifted across 3 places — see `bugs.md` B2.**

| Pattern | Where banned |
|---|---|
| `\bbest doctor\b` | validators.json ✓ · writer.py ✓ |
| `\bnumber[\s-]?one\b` | validators.json ✓ · writer.py ✓ |
| `#1` (with word boundary) | validators.json ✓ · writer.py ✓ |
| `\bleading specialist\b` | validators.json ✓ · writer.py ✓ |
| `\bmost experienced\b` | validators.json ✓ · writer.py ✓ |
| `\bworld[\s-]?class\b` | validators.json ✓ · writer.py ✓ |
| `\baustralia'?s? (best\|leading\|top\|premier)\b` | validators.json ✓ · **writer.py missing** |
| `\bguaranteed? (results?\|outcomes?\|success)\b` | validators.json ✓ · writer.py partial |
| `\bcure[sd]?\b` | validators.json ✓ · writer.py ✓ |
| `\btestimonial\b` | validators.json ✓ · **writer.py missing** |
| `\bendorsement from (a \|my )?(patient\|client)\b` | validators.json ✓ · **writer.py missing** |
| `miracle / proven / 100% safe / no side effects` | **none — only in editorial spec, never coded** |

### Editorially banned (warn-only)
`comprehensive`, `delve`, `groundbreaking`, `robust`, `today`, `this week`, `recently` (in guides), `world-class`.

### Validators (`extracted/lib/admin/validators.ts:runValidators`)
8 checks. Order matters: ACCEPT button is disabled until all `fail`s are green.

| Check | Pass criterion | Notes |
|---|---|---|
| `ahpra` | `ahpra_passed=true` AND no flag with `requires_human_review=true` | AHPRA agent produces flags |
| `banned_phrases` | Live regex over markdown matches nothing in `ahpra_banned` | Catches edits that re-introduce |
| `anchor_text` | No `[source]`, `[link]`, `[here]`, `[click here]`, `[read more]` markdown links | Per voice rule |
| `callout_quota` | `≥ callout_floors[content_type]` callouts in body | guide=4, news=3, company=3 |
| `comparison_table` | At least one markdown table | **`warn` only — bug B6, should be `fail` for guides per blog spec** |
| `schema` | `faq_json_ld.@type='FAQPage'` AND `mainEntity.length >= 4` | **B5: spec says 8 for guides, 6 for news** |
| `word_count` | Within `word_floors[content_type]` to `word_ceilings[content_type]` | news 1500-2000, guide 1500-2500, company 1000-1800 |
| `sources` | ≥3 distinct publishers AND ≥1 authoritative | URL whitelist tier ∈ {gov-au, gov-nz, peer-reviewed, professional-body} |

### Pillars + content types
- `industry_news` → news
- `locum_pay_rates` → guide
- `how_to_locum` → guide
- `locum_by_location` → guide
- `doctor_wellbeing` → guide
- `locum_vs_agency` → guide or company
- `company_pov` → company

**40/40/20 dispatcher** (`backend/agents/intelligence.py`) — never 3 same content_type in a row; force a guide if any pillar has zero in last 12.

### Three streams, three approval modes (design intent per blog.md; only Guides currently implemented)
| Stream | Approval mode | Rationale | Status |
|---|---|---|---|
| **News** | Auto-publish after 48h CEO inaction. CEO can unpublish via one-click email. | News loses 80% of value if shipped 4 days late. AHPRA agent + validators are the safety net. | **Not implemented** — `bugs.md` A1 |
| **Guides** | Batch approval — CEO reviews a week's worth on Sunday in 20-25 min | Evergreen content; 6-day queue costs nothing. | ✓ Live |
| **Inside StatDoctor** | CEO writes / co-writes. AI assists. Approval is the publish action. | Highest brand-voice risk, lowest volume. | Manual workflow |

---

## 7 — URL whitelist + source tiers

`data/url-whitelist.json` — single source of truth for both the Python pipeline (`backend/validation/urls.py`) and the TS ingest gate (`extracted/lib/admin/url-validator.ts`). Bundled into the Vercel function via static `import`.

26 initial domains, 6 tiers:
- `gov-au`: aph.gov.au, health.gov.au, ahpra.gov.au, aihw.gov.au, abs.gov.au, medicalboard.gov.au
- `gov-nz`: health.govt.nz
- `peer-reviewed`: pubmed.ncbi.nlm.nih.gov, cochranelibrary.com, nature.com, thelancet.com, bmj.com, mja.com.au, ncbi.nlm.nih.gov
- `mainstream-news`: abc.net.au, bbc.com, reuters.com, theguardian.com, apnews.com
- `mainstream-aus`: smh.com.au, theage.com.au, news.com.au, sbs.com.au, afr.com, 9news.com.au
- `professional-body`: ama.com.au, racgp.org.au, rcna.org.nz, rnzcgp.org.nz, who.int

Adding a domain: edit `data/url-whitelist.json`, open PR (don't push to main), `pytest test_url_whitelist_data.py` + `vitest url-whitelist-data.test.ts` must pass + cross-language drift tests must pass.

---

## 8 — Image sources (3-tier fallback)

Researcher attempts in order; first non-null wins; otherwise `image_url = null` (better no image than a fake one).

1. **Guardian Content API** — direct CDN thumbnail (`i.guim.co.uk`) + Guardian byline.
2. **OG-scrape** of any non-Guardian source URL — pulls `og:image` / `twitter:image` meta tags. Blocks Unsplash, quickchart, plain SVGs.
3. **Wikimedia Commons** — keyword search filtered to CC-BY / CC0 / public-domain licences only, with proper artist attribution.

`Source` model fields: `image_url`, `image_credit_publisher`, `image_credit_author`, `image_alt`.

---

## 9 — Repo layout

```
STATDOCTOR_BLOGPOSTING/
├── architecture.md                    ← this file
├── bugs.md                            ← open issue list
│
├── backend/                           Python pipeline (runs in GH Actions)
│   ├── main.py                        entry point
│   ├── pipeline.py                    orchestrator → POSTs to /api/admin/ingest
│   ├── heal_agent.py                  CEO-triggered self-fix (Layer A heal)
│   ├── models.py                      FinalPost, ContentType, ContentPillar enums
│   ├── config.py                      env loading
│   ├── agents/
│   │   ├── intelligence.py            topic selection, 40/40/20 dispatcher
│   │   ├── researcher.py              Guardian + OG-scrape + Wikimedia fallback
│   │   ├── writer.py                  GPT-4o body, outline → draft, expansion retry
│   │   ├── seo.py                     per-pillar title cadence + meta + JSON-LD
│   │   ├── ahpra.py                   regex + GPT scan + auto-injected disclaimers
│   │   └── fail_agent.py              Layer A validators + run_id logging
│   ├── validation/
│   │   └── urls.py                    HEAD-check + whitelist gate (Python side)
│   └── tests/                         pytest — fail_agent, ahpra, researcher, writer, SEO, image_sources, URL whitelist + drift
│
├── extracted/                         Next.js admin (Vercel root)
│   ├── app/
│   │   ├── admin/
│   │   │   ├── posts/page.tsx         queue: pending_review + Healing + Heal failed + Scheduled + Published + Rejected
│   │   │   ├── posts/[slug]/page.tsx  edit page: 8-validator panel + ACCEPT / HEAL / EDIT / DISMISS / REJECT taxonomy
│   │   │   ├── seo/                   GSC + Bing dashboard
│   │   │   ├── stats/                 CEO growth view (Recharts: weekly published, GSC trends, AEO citations)
│   │   │   ├── features/              "How this is built" marketing page with live counters
│   │   │   └── competitor-topics/     competitor proposal approval UI
│   │   ├── api/
│   │   │   ├── admin/migrate          POST applies schema.sql idempotently
│   │   │   ├── admin/ingest           pipeline pushes FinalPost here (auto-heal at ingest)
│   │   │   ├── admin/pipeline-runs    Layer A run logger
│   │   │   ├── admin/banner-state     status banner state machine
│   │   │   ├── admin/stats-weekly     growth aggregation
│   │   │   ├── admin/stats-summary    feature-page counters
│   │   │   ├── alerts/dispatch        Layer B inbound alert POST
│   │   │   ├── posts/[slug]/{approve,edit,reject,retry-publish,heal,heal-data}
│   │   │   ├── cron/
│   │   │   │   ├── scheduled-publish  daily 09:00 UTC (Tue/Wed/Fri/Sun publishes)
│   │   │   │   ├── competitor-audit   M/W/F 14:00 UTC
│   │   │   │   ├── seo-snapshot       daily 02:00 UTC
│   │   │   │   ├── daily-digest       daily 22:00 UTC
│   │   │   │   ├── canary             daily 04:00 UTC (Layer D)
│   │   │   │   ├── sunday-batch-report  Mon 09:00 UTC retrospective
│   │   │   │   └── sunday-reminder    Sat 21:00 UTC review-ready email
│   │   │   ├── public/posts           read API (forward-path: replace GitHub-commit publish)
│   │   │   └── health                 uptime-monitor friendly
│   │   ├── login/                     /api/login sets admin_token cookie
│   │   └── dashboard/                 legacy v0, redirects to /admin/*
│   │
│   ├── components/
│   │   ├── admin/banner.tsx           live operator banner (publish_failed > cron_stale > stale_review > needs_review_high)
│   │   └── …                          glassmorphism cards, callout renderers, shader background
│   │
│   ├── lib/
│   │   ├── admin/
│   │   │   ├── validators.json        SINGLE SOURCE OF TRUTH for word_floors, callout_floors, ahpra_banned, editorially_banned, bad_anchor_patterns, authoritative_domains
│   │   │   ├── validators.ts          runValidators(post) → ValidationResult[]
│   │   │   ├── auth.ts                isAuthorised() — async cookie check
│   │   │   ├── store.ts               getAllPosts, getPendingPosts, claimForApproval, upsertPost, deletePostBySlug, etc. Filters slug NOT LIKE '__canary-%'.
│   │   │   ├── db.ts                  pg Pool singleton, sql tagged template
│   │   │   ├── migrate.ts             reads schema.sql, applies idempotently
│   │   │   ├── schema.sql             all DDL — posts, audit_events, alerts, cron_runs, gsc_daily_snapshot, bing_daily_snapshot, keyword_targets, aeo_log, pipeline_runs
│   │   │   ├── banner.ts              computeBannerState — precedence machine
│   │   │   ├── heal-dispatch.ts       hasFixableFailures + dispatchHealWorkflow
│   │   │   ├── canary-fixture.ts      buildCanaryPost — synthetic article that passes all gates
│   │   │   ├── stats-weekly.ts        growth aggregation (8-week published trend + GSC/Bing/AEO)
│   │   │   ├── stats-summary.ts       feature-page counters (test count, whitelist size, etc.)
│   │   │   ├── cron.ts                recordCronRun heartbeat helper
│   │   │   └── url-validator.ts       whitelist gate (TS side, static-imported JSON)
│   │   ├── alerts/resend.ts           dispatchAlert with severity gate + 1h dedup
│   │   └── seo/
│   │       ├── gsc.ts                 Google Search Console (googleapis)
│   │       ├── bing.ts                Bing Webmaster Tools
│   │       └── aggregate.ts           SEO dashboard pages
│   │
│   ├── e2e/                           Playwright — admin-flow, sunday-* specs, validator-gate, axe-core a11y, canary, banner-state
│   └── playwright.config.ts
│
└── .github/
    ├── actions/recover-and-alert/     Layer B composite action
    └── workflows/
        ├── pipeline.yml               cron + workflow_dispatch
        ├── heal.yml                   workflow_dispatch with slug input
        ├── cron-scheduled-publish.yml
        ├── cron-competitor-audit.yml
        ├── cron-seo-snapshot.yml
        ├── cron-daily-digest.yml
        ├── cron-canary.yml
        ├── cron-sunday-batch-report.yml
        ├── cron-sunday-reminder.yml
        └── ci.yml                     vitest + playwright + pytest gating
```

---

## 10 — Database schema (current, post-PR #26)

```sql
posts                                 -- canonical store; status drives the lifecycle
  slug PK, filename, status, pillar, content_type, word_count, ahpra_passed,
  generated_at, date_modified, last_reviewed_at, data JSONB
  status ∈ (pending_review, pending_heal, heal_failed, approved, scheduled,
            rejected, published, publish_failed)

audit_events                          -- append-only state changes (approve/reject/edit/publish/publish-failed)
alerts                                -- daily-digest source + 1h dedup
cron_runs                             -- heartbeat (last_ok, last_fail, runs_total, fails_total) per kind
gsc_daily_snapshot, bing_daily_snapshot   -- SEO trends (2–3 day Google reporting lag)
keyword_targets                       -- CEO-curated tracker keywords
aeo_log                               -- manual ChatGPT/Claude/Perplexity citation log
pipeline_runs                         -- Layer A every-agent-run row (run_id, agent_name, status, failure_reason, retry_count)
```

**Missing per `bugs.md` A4–A5:** `post_revisions` (snapshot per edit), `deleted_at TIMESTAMPTZ` (soft delete). Both were in the 101x spec.

---

## 11 — Env vars

### Vercel (project: `jasmine-rajs-projects/statdoctor-blogposting`, Hobby plan)
| Var | Used for | Required? |
|---|---|---|
| `POSTGRES_URL` | auto-set by Neon Marketplace integration | yes |
| `ADMIN_TOKEN` | admin cookie value | yes |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | login override (defaults `anu@statdoctor.au` / `statdoctor@1`) | optional |
| `CRON_SECRET` | gates `/api/cron/*` | yes |
| `INGEST_TOKEN` | gates `/api/admin/ingest` + pipeline-runs + heal-data | yes |
| `RESEND_API_KEY` | sends digest + alerts + sunday reminder | required for emails |
| `ALERT_EMAIL` | `dispatchAlert` recipient (defaults `anu@statdoctor.net`) | optional |
| `ALERT_INGEST_TOKEN` | gates `/api/alerts/dispatch` (used by Layer B composite action) | required for alerts |
| `DIGEST_EMAIL_TO` | digest + sunday-reminder recipient | yes (`anu@statdoctor.net`) |
| `DIGEST_EMAIL_FROM` | `StatDoctor Editorial <digest@mail.statdoctor.app>` | yes |
| `WEBSITE_REPO_OWNER` / `WEBSITE_REPO_NAME` / `WEBSITE_REPO_BRANCH` | publish handler GitHub-API commit | yes |
| `GITHUB_TOKEN` | fine-grained PAT, `contents: write` on website repo | yes |
| `OPENAI_API_KEY` | Vercel-side LLM calls (most live in GH Actions) | optional |
| `GUARDIAN_API_KEY` | Guardian Content API | yes |
| `GSC_SERVICE_ACCOUNT_JSON` | `seo-snapshot` cron — GCP SA JSON single-line | yes once GSC SA propagates |
| `GSC_SITE_URL` | `sc-domain:statdoctor.app` | yes |
| `BING_WEBMASTER_API_KEY` | Bing Webmaster Tools | yes |
| `BING_SITE_URL` | `https://blog.statdoctor.app/` | yes |
| `FAIL_AGENT_INGEST_GATE` | `strict` enables Layer C 422s; unset = shadow | optional |
| `CANARY_DRY_RUN` | unset = dry run (default); canary never writes to website regardless | optional |
| `HEAL_DISPATCH_REPO` | `jasmineraj2005/STATDOCTOR_BLOGPOSTING` | yes for heal |
| `HEAL_DISPATCH_REF` | `main` | yes for heal |
| `HEAL_DISPATCH_TOKEN` | fine-grained PAT, Actions read+write on the repo | yes for heal |
| `RESEARCHER_BUDGET_TOKENS` | default 50000 (~$0.50/topic abort threshold) | optional |
| `NEXT_PUBLIC_SITE_URL` | `https://blog.statdoctor.app` | optional |
| `AUTO_PUBLISH_NEWS_HOURS` | default 48 — pending news auto-publish window | optional (logic not built yet — bug A1) |

### GitHub repo secrets (Actions)
`OPENAI_API_KEY`, `GUARDIAN_API_KEY`, `UNSPLASH_ACCESS_KEY`, `NEWSAPI_KEY`, `INGEST_URL`, `INGEST_TOKEN`, `CRON_BASE_URL`, `CRON_SECRET`, `ALERT_INGEST_TOKEN`, `TEST_POSTGRES_URL`, `TEST_ADMIN_TOKEN`.

---

## 12 — Conventions (rules that don't bend)

1. **Two-repo rule** — never edit `~/website/` from here. Off-limits unless the user explicitly names a path.
2. **One validator source** — `extracted/lib/admin/validators.json` is shared by Python (`backend/agents/ahpra.py`, writer.py, fail_agent.py) and TS (`lib/admin/validators.ts`, ingest gate). **Currently drifted — see `bugs.md` B2.**
3. **The model never invents URLs.** Researcher picks from the validated adapter pool only.
4. **No hard deletes.** Use the rejection workflow. After 2 rejections on the same topic, drop it permanently. Soft-delete column was specced (`deleted_at`) but isn't in current schema — see `bugs.md` A5.
5. **AHPRA compliance is a hard block.** Approve button disabled until all hard validators pass; cron path enforces the same check server-side.
6. **Approve = scheduled, not published.** Real publish happens at the next Tue/Wed/Fri/Sun 09:00 UTC slot.
7. **Cost-bound everything.** Per-week caps on OpenAI tokens. Writer has single expansion retry. Heal has 2 retries. No infinite loops.
8. **Alerts beat silence.** Every cron path writes a `cron_runs` row; failures write an `alerts` row and trigger Layer B email. Daily digest summarises.
9. **Single secret per role.** `ADMIN_TOKEN` for dashboard auth, `CRON_SECRET` for crons, `INGEST_TOKEN` for pipeline ingest, `ALERT_INGEST_TOKEN` for the alert endpoint, `HEAL_DISPATCH_TOKEN` for heal workflow dispatch. Never share scopes.

---

## 13 — Day-1 health check (60 seconds)

```bash
# Public health (CDN-friendly)
curl -sS https://blog.statdoctor.app/api/health | python3 -m json.tool

# Ingest auth (should be 401, not 500)
curl -sSI -X POST https://blog.statdoctor.app/api/admin/ingest -H "Authorization: Bearer bad" | head -3

# Pipeline-run trigger (no-op except DB row)
gh workflow run pipeline.yml

# DB schema currency
curl -X POST -H "Cookie: admin_token=$ADMIN_TOKEN" https://blog.statdoctor.app/api/admin/migrate
# Expect: { ok: true, detail: "Applied N statement(s)." }

# Open the queue
open https://blog.statdoctor.app/admin/posts
```

---

## 14 — How to operate manually

```bash
# Local pipeline run (laptop must have backend/.env populated)
cd backend && source venv/bin/activate && python main.py

# Force a content stream
MODE=news python main.py            # or: MODE=guide / MODE=company
# Note: MODE flag is documented but not wired — `bugs.md` future item

# Regenerate one article
python main.py --regen <slug>

# Trigger a heal manually
gh workflow run heal.yml -f slug=<slug>

# Force a cron
curl -H "Authorization: Bearer $CRON_SECRET" https://blog.statdoctor.app/api/cron/daily-digest
```

---

## 15 — How to pause everything

- **Pipeline only:** disable `pipeline.yml` (GH Actions → workflow → ⋯ → Disable).
- **All crons:** same on each `cron-*.yml`.
- **Whole dashboard (keep DB):** Vercel → project → Settings → General → Pause deployment.
- **Nuclear:** delete the Vercel project. DB + GH repo survive.

---

## 16 — Memory + handover convention

Project-specific memory at `~/.claude/projects/-Users-jasminebaldevraj-Desktop-statdoctor-blog/memory/` (auto-loaded per session). Holds:
- Two-repo rule
- Vercel deploys from `extracted/`
- DB preference (Neon free → Supabase fallback, never paid by default)
- Handover mode (unattended for months)
- Sunday review window (20-25 min, ≥95% approve-as-is target)

This file (`architecture.md`) and `bugs.md` are the two repo-level docs. Everything else has been consolidated.
