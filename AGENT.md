# AGENT.md — Session Handoff

Read this first if you're a fresh Claude (or human) picking up the StatDoctor blog factory project. Captures where we are as of 2026-05-14, what's live, what's not, and the exact next moves.

For deep design see `ARCHITECTURE_101X.md`. For runbook see `HANDOVER.md`. For editorial voice see `blog.md`. For prior session decisions see `BLOG_AGENT.md`.

---

## 30-second briefing

You are working on **StatDoctor's editorial blog factory** — a system that auto-generates locum-doctor articles, lets the CEO (Dr Anu) review them on Sundays, and publishes the approved ones automatically on Tue/Wed/Fri/Sun.

**Two repos. Never mix them.**
- **`STATDOCTOR_BLOGPOSTING/`** (this repo, on GitHub at `jasmineraj2005/STATDOCTOR_BLOGPOSTING`) = the factory: Python pipeline + Next.js admin dashboard at `extracted/`. Deployed to `statdoctor-blogposting.vercel.app`.
- **`~/website/`** + Webflow at `statdoctor.app` = the client-facing public site. **Off-limits unless the user explicitly names a file path.**

**One golden architectural rule from the user (2026-05-14):**
> "this is a handover thing, not smth that i will be access everyday, so it has to be standing by itself for the duration of couple of months"

The CEO will not log in daily. Optimise for autonomy, alerting, and self-documentation. Never silent failure.

---

## What's live (as of 2026-05-14, end of session)

- **GitHub remote:** `jasmineraj2005/STATDOCTOR_BLOGPOSTING`, branch `main`, fully pushed.
- **Vercel deploy:** `statdoctor-blogposting.vercel.app` builds from `extracted/`.
- **DB:** Vercel-Marketplace Neon Postgres (free tier 256MB) connected. Schema applied (`/api/admin/migrate` → 20 statements).
- **Resend:** account `anu@statdoctor.net`, domain `mail.statdoctor.app` verified (DNS at GoDaddy), API key set in Vercel as `RESEND_API_KEY`.
- **Health:** `https://statdoctor-blogposting.vercel.app/api/health` → `{"ok":true,"status":"healthy","checks":{"db":"ok","crons":"not_yet_run"}}`.
- **Auth:** `/login` → `/api/login` → sets `admin_token` cookie → routes to `/admin/posts`. Default credentials `anu@statdoctor.au` / `statdoctor@1` (overridable via `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars). The actual cookie value is `ADMIN_TOKEN` env var.
- **Pipeline ran once** (GitHub Action manual dispatch). One article was generated and ingested into the DB.

---

## Operating cadence (when fully autonomous)

| When (UTC) | Workflow | What it does |
|---|---|---|
| Mon / Wed / Fri / Sat 14:00 | `pipeline.yml` | Python generates 1 article, POSTs to `/api/admin/ingest` |
| Mon / Wed / Fri 14:00 | `cron-competitor-audit.yml` | Scrape 9 competitor blogs for topic ideas |
| Daily 02:00 | `cron-seo-snapshot.yml` | Pull yesterday's GSC + Bing data into Postgres |
| Daily 09:00 | `cron-scheduled-publish.yml` | If today is Tue/Wed/Fri/Sun, publish the oldest queued article |
| Daily 22:00 | `cron-daily-digest.yml` | Email summary to `anu@statdoctor.net` via Resend |

CEO does ~20 min/week on Sunday morning at `/admin/posts` — click ACCEPT / EDIT / DISMISS per article.

---

## The status machine

```
pipeline.py → POST /api/admin/ingest
                    ↓
              pending_review  ← CEO reviews here
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   [ACCEPT]    [EDIT then    [DISMISS]
        │      re-validate]       │
        ▼           │             ▼
   scheduled  ← pending_review  rejected
        │       (back to top)
        ▼
   cron-scheduled-publish (Tue/Wed/Fri/Sun 09:00 UTC)
        ▼
   published → JSON commit to website repo via GitHub API
```

**Approve is NOT immediate publish.** It queues for the next scheduled slot (one publish per slot, FIFO).

---

## What's missing from full handover (rank-ordered)

### Critical — blocks the CEO actually using the system

| # | Task | Effort | Owner |
|---|---|---|---|
| 1 | **Confirm the legacy OpenAI key is rotated.** It was exposed via the `backend/.env` file being opened in the IDE several times. Verify the old key at `platform.openai.com/api-keys` is revoked. | 1 min | user |
| 2 | **Set Vercel env vars that haven't been set yet:** `WEBSITE_REPO_OWNER`, `WEBSITE_REPO_NAME`, `WEBSITE_REPO_BRANCH`, `GITHUB_TOKEN` (PAT with `contents:write` on the website repo). Without these, the Approve → publish step fails. | 5 min | user |
| 3 | **Set GitHub repo secrets:** `OPENAI_API_KEY`, `GUARDIAN_API_KEY`, `INGEST_URL`, `INGEST_TOKEN`, `CRON_BASE_URL`, `CRON_SECRET`. Without these, GitHub Actions can't run the pipeline or cron jobs. | 5 min | user |
| 4 | **UptimeRobot** monitor on `/api/health`. Free tier. | 3 min | user |

### Important — happens before content reaches readers

| # | Task | Effort | Owner |
|---|---|---|---|
| 5 | **GSC verification.** `statdoctor.app` is currently a Webflow site (audit in `DOMAIN_CUTOVER.md`). Verify ownership at <https://search.google.com/search-console>, add the GSC service-account email as Owner, set `GSC_SERVICE_ACCOUNT_JSON` + `GSC_SITE_URL` on Vercel. Without this, the SEO dashboard at `/admin/seo` stays in "Warming up" empty state forever. | 15 min | user |
| 6 | **Bing Webmaster verification + API key.** Same pattern. Set `BING_WEBMASTER_API_KEY` + `BING_SITE_URL`. | 10 min | user |
| 7 | **Cutover decision:** where does the blog actually render? Three paths in `DOMAIN_CUTOVER.md` — Path A (`blog.statdoctor.app` subdomain) is the default recommendation. | thinking + ~5 min DNS | user |

### Code-side outstanding (small, optional)

- The article in the DB from the test pipeline run might still be `pending_review`. CEO can ACCEPT it from `/admin/posts` to test the full path.
- `backend/.env` has the OpenAI key + the GoDaddy/Webflow related env. After rotation, sync the new value.
- Phase 3 (website-side `Person` JSON-LD on `/about`) — copy-paste snippet in `docs/author-jsonld-snippet.md`. Not done yet because the **two-repo rule**: needs the user (or a separate session pointed at the website repo) to actually paste it.

---

## File map

```
STATDOCTOR_BLOGPOSTING/
├── AGENT.md                  ← this file (read first)
├── HANDOVER.md               ← operator runbook (day-1 setup, runbook for failures)
├── ARCHITECTURE_101X.md      ← design north-star + key decisions
├── BLOG_AGENT.md             ← per-phase implementation status table
├── DOMAIN_CUTOVER.md         ← statdoctor.app audit + GSC/Bing setup steps
├── blog.md                   ← editorial voice, content strategy, 40/40/20
├── docs/
│   └── author-jsonld-snippet.md  ← copy-paste for website's /about page
│
├── backend/                  ← Python pipeline
│   ├── main.py               ← entry point (called by GitHub Actions)
│   ├── pipeline.py           ← orchestrator, POSTs to /api/admin/ingest
│   ├── models.py             ← FinalPost + ContentType + PostStatus
│   ├── agents/
│   │   ├── intelligence.py   ← topic selection (40/40/20)
│   │   ├── researcher.py     ← Guardian + facts gathering
│   │   ├── writer.py         ← GPT-4o body + one-shot expansion retry
│   │   ├── seo.py            ← per-pillar title cadence + keywords + twitter_card
│   │   └── ahpra.py          ← loads validators.json; regex + GPT compliance scan
│   ├── output/               ← generated JSONs (NOT in production, dev-only backup)
│   ├── past_topics.json      ← dedupe ledger
│   ├── tests/
│   │   └── test_ahpra.py     ← 26 pytest tests, validators + disclaimer injection
│   └── venv/                 ← Python 3.14 env with pytest installed
│
├── extracted/                ← Next.js admin app (Vercel build root)
│   ├── app/
│   │   ├── login/page.tsx              ← /login UI
│   │   ├── dashboard/                  ← legacy v0, redirects to /admin/*
│   │   ├── admin/
│   │   │   ├── posts/page.tsx          ← review queue (ACCEPT/EDIT/DISMISS)
│   │   │   ├── posts/[slug]/page.tsx   ← edit page with 8 live validators
│   │   │   ├── seo/page.tsx            ← SEO overview
│   │   │   ├── seo/keywords/page.tsx   ← keyword tracker CRUD
│   │   │   ├── seo/aeo/page.tsx        ← manual AEO citation log
│   │   │   └── competitor-topics/      ← competitor topic proposals
│   │   └── api/
│   │       ├── login + logout          ← cookie-based auth
│   │       ├── admin/migrate           ← one-time DB schema apply
│   │       ├── admin/ingest            ← pipeline pushes FinalPost here
│   │       ├── posts/[slug]/{approve,reject,edit}
│   │       ├── cron/
│   │       │   ├── scheduled-publish   ← Tue/Wed/Fri/Sun 09:00 UTC
│   │       │   ├── competitor-audit    ← M/W/F 14:00 UTC
│   │       │   ├── seo-snapshot        ← daily 02:00 UTC
│   │       │   └── daily-digest        ← daily 22:00 UTC
│   │       ├── seo/{keywords,aeo}      ← CRUD for the SEO pages
│   │       ├── public/posts            ← /api/public/posts + /api/public/posts/[slug]
│   │       └── health                  ← uptime-monitor friendly
│   ├── lib/
│   │   ├── admin/
│   │   │   ├── validators.json         ← SINGLE SOURCE OF TRUTH (also read by Python)
│   │   │   ├── validators.ts           ← 8 checks, reads validators.json
│   │   │   ├── auth.ts                 ← isAuthorised() — Next 15 async cookies
│   │   │   ├── store.ts                ← DB or FS fallback for posts + audit
│   │   │   ├── db.ts                   ← pg.Pool singleton, sql tagged-template
│   │   │   ├── migrate.ts              ← reads schema.sql, applies idempotently
│   │   │   ├── schema.sql              ← all tables + indexes
│   │   │   └── cron.ts                 ← recordCronRun heartbeat helper
│   │   └── seo/
│   │       ├── gsc.ts                  ← Google Search Console (googleapis)
│   │       ├── bing.ts                 ← Bing Webmaster Tools (fetch + API key)
│   │       └── aggregate.ts            ← getOverview, getKeywordTracker, getArticlePerformance
│   ├── e2e/
│   │   └── admin-flow.spec.ts          ← 2 Playwright tests covering approve + reject
│   └── playwright.config.ts
│
├── scripts/                  ← every verify-*.sh local-Postgres integration test
│   ├── verify-all.sh         ← one-shot runs everything below
│   ├── verify-db.sh
│   ├── verify-scheduled-publish.sh
│   ├── verify-health-digest.sh
│   └── verify-seo-dashboard.sh
│
└── .github/workflows/
    ├── pipeline.yml                    ← Python pipeline cron + workflow_dispatch
    ├── cron-scheduled-publish.yml
    ├── cron-competitor-audit.yml
    ├── cron-seo-snapshot.yml
    └── cron-daily-digest.yml
```

---

## Conventions / rules that don't bend

1. **Two-repo rule** — never edit `~/website/`. Only this repo + Webflow live under the user's other accounts.
2. **One validator source** — `extracted/lib/admin/validators.json` is read by both Python (`agents/ahpra.py`) and TS (`lib/admin/validators.ts`). Don't add patterns in code. Run `pnpm test` + `pytest` after every change.
3. **The model never invents URLs.** Researcher only emits URLs from the validated adapter pool. (Implementation pending — currently relies on Guardian + GPT honesty.)
4. **No hard deletes.** Use the rejection workflow. After 2 rejections on the same topic, drop it permanently.
5. **AHPRA compliance is a hard block.** Approve button is disabled until all hard validators pass. The cron path enforces the same check.
6. **Approve = scheduled, not published.** Real publish happens at the next Tue/Wed/Fri/Sun 09:00 UTC slot.
7. **Cost-bound everything.** Per-week caps on OpenAI tokens. Writer has a single expansion retry, max. No retry loops.
8. **Alerts beat silence.** Every cron path writes a `cron_runs` row and an `alerts` row on failure. The daily digest summarises both.
9. **Single secret per role.** `ADMIN_TOKEN` for dashboard auth, `CRON_SECRET` for cron endpoints, `INGEST_TOKEN` for pipeline ingest. Never share scopes.

---

## How to verify the system is healthy (60-second check)

```bash
# 1. Public health
curl -sS https://statdoctor-blogposting.vercel.app/api/health | python3 -m json.tool
#   Expect: ok=true, status=healthy, db=ok

# 2. Pipeline can ingest (Bearer is the INGEST_TOKEN)
curl -sS -X POST -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"smoke.json","post":{"slug":"smoke-test","title":"smoke","meta_title":"x","meta_description":"x","focus_keyword":"x","og_image_alt":"x","content_markdown":"","tldr":"","pillar":"locum_pay_rates","content_type":"guide","target_keywords":[],"keywords":[],"word_count":0,"reading_time_minutes":1,"sources":[],"image_url":null,"image_credit":null,"faq_json_ld":{},"medical_webpage_schema":{},"ahpra_flags":[],"ahpra_passed":true,"status":"pending_review","generated_at":"2026-05-14T00:00:00Z","dateModified":"2026-05-14T00:00:00Z"}}' \
  https://statdoctor-blogposting.vercel.app/api/admin/ingest
#   Expect: { "ok": true, "slug": "smoke-test" }

# 3. Public read API
curl -sS https://statdoctor-blogposting.vercel.app/api/public/posts | python3 -m json.tool
#   Expect: { "posts": [], "count": 0, … } until something is published

# 4. Local tests
cd /Users/jasminebaldevraj/Desktop/statdoctor-blog/STATDOCTOR_BLOGPOSTING
./scripts/verify-all.sh      # ~90s, all green
```

---

## Where to start in a fresh chat

If you're a new Claude reading this:

1. **Read** AGENT.md (this file) and HANDOVER.md.
2. **Check** `git log --oneline origin/main -20` to see recent work.
3. **Check** `git status` to see uncommitted changes (there shouldn't be any unless mid-task).
4. **Look at the user's intent** from their most recent message before starting work.
5. **Confirm before code changes** if the user's request is ambiguous. Plain English, short replies. The user has reading-attention limits.

Active memories (in `/Users/jasminebaldevraj/.claude/projects/-Users-jasminebaldevraj-Desktop-statdoctor-blog/memory/`):
- `repo-separation.md` — two-repo rule
- `vercel-deploy-extracted.md` — Vercel builds from `extracted/`
- `db-preference.md` — Vercel Postgres first, Supabase fallback, free tier always
- `handover-mode.md` — system runs unattended for months; default to autonomy

---

## What just happened in the last session (2026-05-14)

- Built `/api/login` + cookie auth that actually works (fixed the chain — old version was a fake client-side check).
- Redirected legacy `/dashboard/*` paths to `/admin/*` equivalents.
- Fixed all `/admin/*` redirects from `/admin/login` → `/login`.
- Redesigned `/admin/posts` cards with ACCEPT / EDIT / DISMISS buttons (per user reference screenshot). Reverted color scheme to the original white card style on user request — kept the new button row.
- Wrote `DOMAIN_CUTOVER.md` after auditing `statdoctor.app` (live Webflow site, Cloudflare CDN, GoDaddy DNS).
- Wrote `docs/author-jsonld-snippet.md` for the website's `/about` page (Person JSON-LD).
- Added word-count expansion retry to `backend/agents/writer.py`.
- Pushed 27 commits to `origin/main`. Vercel rebuilds confirmed live.
- Tested end-to-end: `/api/health` healthy, schema applied (20 statements), redirects working.
- 38 Vitest + 26 pytest + 2 Playwright tests all green.

The system is **deployed and standing**. The user just needs to finish the remaining env-var paperwork (items 1-4 above) and it operates on its own.

---

## Tone with the user

- Plain English. Short sentences. No jargon walls.
- The user has been working through a long setup. Their attention is finite. Lead with the answer.
- Don't over-narrate. State decisions and proceed.
- For destructive or hard-to-reverse actions (push, force, delete) — always explicit confirmation via the literal word.
- When something fails, give 1 likely cause + 1 fix command. Don't dump a debug essay.
