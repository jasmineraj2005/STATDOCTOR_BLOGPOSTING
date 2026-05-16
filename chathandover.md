# Chat Handover — StatDoctor Blog Automation

Read this top-to-bottom **first**. Captures every load-bearing thing the previous chat carried that isn't already on disk.

**Date:** 2026-05-16 (late-Saturday)
**Branch:** `main` (fully synced; all 24 PRs from this session merged)
**Repo:** `STATDOCTOR_BLOGPOSTING` (admin + SEO + Python pipeline). `~/website/` is the separate client-facing repo — **never edit it from here**.

---

## 30-second briefing

StatDoctor is an AU locum-doctor marketplace at `statdoctor.app`. The blog system is automated: Python pipeline writes articles (5 agents: intelligence → researcher → writer → SEO → AHPRA), they land in a Postgres review queue, **CEO Anu (anu@statdoctor.net, AHPRA-registered)** reviews on Sundays via a Next.js admin at `extracted/app/admin/posts/`, approves → scheduled cron publishes to the website repo → live.

**Goal:** unattended for months with ≥95% Sunday approve-as-is in ≤25 min.

**User preferences (load-bearing):**
- Plain language over jargon. Anu is a doctor + founder, not a JS engineer.
- Milestone-phrase progress updates: `🟢 STARTED / 🟡 CHECKPOINT / 🧪 TESTS GREEN / ✅ COMPLETE / 🛑 BLOCKED / 🎉 HANDOVER-READY`.
- For destructive ops (push to main, deletions) — always confirm first. Auto-classifier blocks direct push-to-main; use PRs.
- "Decide best steps but get my approval" — propose with trade-offs, wait for "yes".
- Pushing to feature branches IS allowed without prompt.

---

## What's been built (this session — 24 PRs)

### M0 — Test Backfill (✅ DONE — 272 → 329 tests)
Took raw codebase from ~62 → **289 vitest + 40 pytest + 8 Playwright specs**. Found + fixed 4 real bugs along the way:
- Approve race condition → atomic `claimForApproval` in `lib/admin/store.ts` (SQL `UPDATE … WHERE status='pending_review' RETURNING`)
- `publishToGitHub` had no retry → now retries 5xx 3× with exponential backoff via injected sleeper
- CI pytest job was missing `OPENAI_API_KEY` env binding
- TS strictness gaps in test mocks

### M1 — URL Validation Hardening (✅ DONE — AI fabricated URLs killed)
- `data/url-whitelist.json` — 26 domains, 6 tiers (`gov-au`, `gov-nz`, `peer-reviewed`, `mainstream-news`, `mainstream-aus`, `professional-body`), versioned + rationale per entry
- `backend/validation/urls.py` (Python) + `extracted/lib/admin/url-validator.ts` (TS mirror)
- **Server-side gate** at `/api/admin/ingest` — every Python pipeline POST runs whitelist check. All sources off-list → 422 rejected; partial → bad URLs dropped + flagged in `ahpra_flags`
- **Researcher pre-flight** — drops bad URLs at generation time + re-broadens up to 2× + `RESEARCHER_BUDGET_TOKENS` env (default 50k ≈ $0.50/topic) aborts runaway loops
- **Locked-in tests:** 20-case cross-language drift fixture + the 5 historical fuel-prices fabricated URLs as permanent fixtures
- Daily digest now reports `URL validation: N rejected — M not in whitelist, K unreachable`
- `HANDOVER.md` got a URL-validation operator section
- **T4 (HEAD-cache 24h TTL) deferred** — pure perf, ~10s/week saved, not load-bearing

### M2 — Word Count Fix (✅ CODE DONE — partial smoke-run validation)
- Writer prompt now reads `word_floors` from `validators.json` (single source of truth) and states floor explicitly
- Two-pass: outline (5–9 H2s with per-section word targets) → draft (uses outline as hard constraint)
- `word_ceilings` added to `validators.json`; word_count validator now hard-FAILS below floor, WARNS above ceiling
- 12-row boundary table covers all 12 transitions (3 content types × {floor-1, floor, ceiling, ceiling+1})
- **T4 smoke runs** ran today: news 1912 words ✓, guide 1778 ✓, guide 1811 ✓ — **company_pov untested by chance** (Intelligence agent picked freely, didn't pick company in 3 cycles)
- Total OpenAI spend on smoke runs: ~$1.20

### Side-quest 1 — UI restore (✅ DONE)
- `/admin/posts` queue → `<ShaderBackground>` with translucent glassmorphism cards (rgba(255,255,255,0.10) + backdrop-blur, violet `#c4b5fd` pillar chips, purple glow on hover)
- `/admin/posts/[slug]` article edit page → white bg, **preview-first** 2-column layout (rendered article on left, validators + reject panel sticky right, editor form folded behind `<details>`)
- Article preview pane fully restored: hero, TL;DR, persona cards (`WhoThisIsFor`), TOC sidebar, callout boxes (KEY FACTS / TAKEAWAY / INFO / **PRO TIP** / CASE STUDY / AU / NZ / INTERESTING FACT / INSIGHT / DONT WORRY), sources gallery, author bio, JoinCTA
- Validator + Reject panel text contrast fixed (unregistered project tokens `text-muted`, `text-ocean`, `eyebrow`, `mono` were resolving to invisible — swapped to standard Tailwind)
- Login → `admin_token` cookie chain (was disconnected pre-PR-#16)

### Side-quest 2 — PRO TIP callout type (✅ DONE)
Added as a distinct callout. Green theme (HSL 160°), 💡 icon, slightly bolder body. Use: `> [PRO TIP] Always negotiate the indemnity coverage before accepting a remote shift — many regional hospitals assume locums carry their own.`

### Side-quest 3 — Credible-source images + photo credits (✅ DONE)
- `Source` model gained 4 optional fields: `image_url`, `image_credit_publisher`, `image_credit_author`, `image_alt`
- Python researcher fetches Guardian Content API thumbnails (`i.guim.co.uk`) + byline as credit author
- OG-image scrape for non-Guardian sources (ABC, AIHW, RACGP, etc.) with `og:image` → `twitter:image` fallback chain, blocks Unsplash/QuickChart/SVG
- Preview pane renders each image with `<figcaption>` credit: `"Photo: The Guardian / Mike Bowers AAP"` format
- **No stock, no fabricated credits.** Only real Guardian CDN URLs or OG-scraped from actual source publishers

### M3 — Domain Attach + GSC + Bing + Perplexity (📝 RUNBOOK READY)
Click-by-click in `docs/superpowers/m3-domain-attach-runbook.md`. ~17 min user time. **Path A: subdomain CNAME `blog.statdoctor.app` → Vercel.** Webflow site at `statdoctor.app` is untouched.

**The user owns `statdoctor.app` on GoDaddy.** Confirmed via screenshot — 12 statdoctor-* domains in their portfolio. They mentioned wanting to **transfer the Vercel project to their Pro account before starting M3** to avoid redoing env vars/domains. That transfer is the right call (most things follow automatically — domains, env vars, GitHub link, Postgres binding).

### M4 — Sunday Review Hardening (✅ DONE)
- `lib/admin/batch-report.ts` — `computeBatchReport(events)` pure aggregator (approved/edited/rejected/durationSeconds/approveAsIsRate)
- `lib/admin/weekly-invariants.ts` — checks `stale_review` (no Sunday review in 8 days), `low_approve_rate` (4-week avg <0.95), `publish_backlog` (>3 stuck in scheduled >48h). Breaches insert into `alerts`.
- `/api/cron/sunday-batch-report` — fires Monday 09:00 UTC (≈Sunday 18:00 AEST). Sends Resend email summarising the prior Sunday review. Persists to `sunday_batch_reports` (idempotent DDL).
- `writer.regenerate(slug, rejection_reason, original_content)` threads reject-reason into retry prompt via `_REJECTION_LABELS`
- Playwright `sunday-batch-25min.spec.ts` — full 7-article flow under 25 min in CI replay mode

### M6 — Website Schema Artefacts (✅ DONE — for separate ~/website/ session)
`docs/website-artefacts/`:
- `author-page.tsx` — Person schema for `/about/dr-anu-ganugapati`
- `medical-scholarly-article.tsx` — `<MedicalScholarlyArticleSchema>` with `reviewedBy` + `citation` (from sources[]) + `publicationType` (MeSH)
- `organization-schema.tsx` — `MedicalBusiness` for site root
- `layout-changes.md` — en-AU + geo.{region,country,placename} + drop `<meta name="keywords">`
- `sitemap.ts` + `robots.ts` — drop-in for `~/website/app/`
- `handoff-checklist.md` — step-by-step for the website-repo session

### M6.5 — Schema upgrades in THIS repo + WCAG 2.2 AA (✅ DONE)
- SEO agent (`backend/agents/seo.py`) emits `reviewedBy` + `citation` + `publicationType` + news-only `Speakable`
- `<meta name="keywords">` confirmed NOT rendered in any runtime path
- `extracted/e2e/axe-core-a11y.spec.ts` scans `/admin/posts` + `/admin/posts/[slug]` at `wcag2aa` + `wcag22aa`. **Spec exists but hasn't run live yet** — first `pnpm test:e2e` will surface violations. Each will need its own follow-up.

### M7 — Operational Wiring Verification (✅ DONE — 3 M0.T10 bugs closed)
- **`publishPost` throws now caught** in `scheduled-publish/route.ts` → sets status to `publish_failed`, logs audit, `recordCronRun(false)`, dispatches alert
- **Real-time alerts** via `lib/alerts/resend.ts` `dispatchAlert(opts, deps)` — severity-based email gating (≥error sends), 1h dedup, alert-within-60s test. **NEEDS `RESEND_API_KEY` env var on Vercel** to actually send emails. Without it, `tryGetResendSender()` no-ops silently.
- **`publish_failed` PostStatus** added to TS union + DB CHECK constraint + idempotent ALTER migration
- **`/api/posts/[slug]/retry-publish`** — flips `publish_failed` → `scheduled` for next cron pickup
- **`scripts/inject-failure.ts`** — CLI with `db`/`publish`/`gsc`/`bing` subcommands for op verification
- **`lib/admin/banner.ts`** + `/api/admin/banner-state` GET route — state machine with precedence `publish_failed > cron_stale > stale_review > needs_review_high > none`. **NOT YET RENDERED IN UI** — UI wiring is a follow-up.
- **Behaviour change:** failed publishes now stay in `publish_failed` (not auto-retry as `scheduled`). Operator must hit retry-publish. Intentional.

### Bonus — CI Playwright now properly gated (✅)
- `.github/workflows/ci.yml` provisions a `postgres:16` service with healthcheck
- `e2e/setup.ts` uses `pg` client to drop+create+seed (no more hardcoded `/opt/homebrew/postgresql@16` path)
- Removed `continue-on-error: true` — Playwright is blocking again

### Webflow migration (✅ user's work, committed via PR #24)
- `backend/migrate_webflow.py` — Webflow → pipeline-JSON converter
- `backend/output/_webflow_dump.json` — 98-item CMS snapshot (historical reference)
- 4 migrated posts: NSW pay rates, 5-benefits of locum, QLD pay rates, Anaesthetics jobs

---

## Pending — USER ACTIONS (operational, not coded)

| Task | Time | Status | Notes |
|---|---|---|---|
| **Vercel project transfer to Pro account** | ~3 min | 🟡 Pending | Anu mentioned wanting this before M3. Settings → General → Transfer Project. Domains/env vars/Postgres binding all follow automatically. After transfer: smoke test `curl https://statdoctor-blogposting.vercel.app/api/health`. |
| **M3 setup** | ~17 min | 🟡 Pending | Full click-by-click in `docs/superpowers/m3-domain-attach-runbook.md`. Steps: GoDaddy CNAME → Vercel domain attach → GSC verify + service account → Bing import-from-GSC + API key → Vercel env vars (4 of them + `RESEND_API_KEY`) → Perplexity Publisher Program enrolment. |
| **Calendar reminder: +5 days for SEO data** | ~10 sec | 🟡 Pending | GSC reporting lag is 2–3 days, Bing ~24h. `/admin/seo` dashboard shows "Warming up" until day 4–5. Set a reminder for ~Thursday 2026-05-21 to run the 4 verification curls. |
| **Sunday review tomorrow (2026-05-17)** | 25 min | 🟡 Pending | **This IS the M5 pre-handover dry run.** Walk the queue in `/admin/posts`, approve/edit/reject. Capture: total time, approve-as-is rate, surprises. The Saturday batch (fired today at 14:00 UTC via GH Actions) will have populated the queue overnight. |
| **Visual verify glassmorphism + article preview on production** | 2 min | 🟡 Pending | Open `https://statdoctor-blogposting.vercel.app/admin/posts` and `/admin/posts/<any-slug>`. Hard-refresh Cmd+Shift+R. Should show: purple shader bg on queue with translucent cards; white bg on article view with preview pane primary + editor folded. **NOT** the `statdoctor-blogposting-git-rollbac-803f3e-…` URL — that's a stale branch preview. |

---

## Pending — CODE (deferred / low-priority)

| Task | Why deferred | Path forward |
|---|---|---|
| **M1.T4 — HEAD-check cache (24h TTL)** | Pure perf optimization. ~42 HEAD-checks/week ≈ 10s wall-time. Not load-bearing. | Ship when there's measured latency pain. Touches `backend/validation/urls.py` + `extracted/lib/admin/url-validator.ts` + a new DB migration. |
| **M2 follow-up: company_pov floor verification** | Intelligence agent picks freely; didn't pick `company` in 3 smoke runs by chance. Floor is structurally easy (1000 vs unconstrained 1700+). | Verify the first real `company_pov` article that ships organically. |
| **MODE=<type> CLI flag for pipeline** | T4 agent discovered `MODE=news python main.py` doesn't actually work — the env override was documented but never implemented. Workaround: edit Intelligence agent dispatcher. | Add `--mode {news,guide,company}` arg to `backend/main.py` that pins content_type. |
| **WCAG 2.2 AA violations from axe-core** | Spec exists; first run will surface them. Per M6.5 spec, each violation gets its own follow-up — not auto-fixed. | Run `pnpm exec playwright test e2e/axe-core-a11y.spec.ts` once `RESEND_API_KEY` + DB are set; triage violations per WCAG SC. |
| **Banner UI wiring** | M7 built `lib/admin/banner.ts` + the API route but didn't render it in `app/admin/posts/page.tsx` (off-limits to M7 due to file boundaries). | Render `<Banner state={await fetch('/api/admin/banner-state')} />` at the top of the queue page. Small change. |
| **Schemar GitHub Action for JSON-LD validation** | From the SEO/AEO cross-check. Gated on M3 being live (needs a real public URL to validate against). | After M3 lands, add `.github/workflows/schemar.yml` running the action against 3 sample article URLs. |

---

## Critical context

### Two-repo rule (load-bearing)
- **`STATDOCTOR_BLOGPOSTING/`** (this repo) — admin + SEO dashboard + Python pipeline. Deploys to `statdoctor-blogposting.vercel.app`.
- **`~/website/`** (separate repo) — client-facing site at `statdoctor.app` (Webflow currently; will migrate to Next.js later via M6 artefacts).
- **Never edit `~/website/` from here.** Anything for the client site lands as artefacts under `docs/website-artefacts/` for a separate session inside `~/website/`.

### Vercel deploy is from `extracted/`
The Next.js admin lives inside `STATDOCTOR_BLOGPOSTING/extracted/`. Vercel's project Root Directory is set to `extracted`. The Python pipeline at `backend/` runs via GH Actions, not Vercel.

### Branch state
- `main` is the production-deployed branch. Vercel auto-deploys on every merge.
- All 24 PRs from this session are merged to main.
- 0 open PRs at handover.

### Auth model
- Cookie `admin_token` matching env `ADMIN_TOKEN`.
- `/api/login` (POST email+password) sets the cookie. Default creds: `anu@statdoctor.au` / `statdoctor@1`.
- `isAuthorised()` in `lib/admin/auth.ts` gates every admin page.

### Env vars (Vercel)
Required for full functionality (set in Settings → Environment Variables):
- `POSTGRES_URL` — auto-set by Neon integration
- `ADMIN_TOKEN`, `CRON_SECRET`, `INGEST_TOKEN` — random 32+ char strings
- `RESEND_API_KEY` — **NEW from M7. Needed for real-time alerts.** Sign up free at resend.com, paste the key, Vercel auto-redeploys.
- `DIGEST_EMAIL_TO`, `DIGEST_EMAIL_FROM` — set to `anu@statdoctor.net` and `StatDoctor Editorial <digest@mail.statdoctor.app>`
- `WEBSITE_REPO_OWNER`, `WEBSITE_REPO_NAME`, `WEBSITE_REPO_BRANCH` — for publish.ts GitHub-API commit
- `GITHUB_TOKEN` — fine-grained PAT with `contents: write` on the website repo
- `OPENAI_API_KEY` — for any Vercel-side LLM calls (most live in GH Actions)
- `GUARDIAN_API_KEY` — Guardian Content API
- **After M3:** `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL`, `BING_WEBMASTER_API_KEY`, `BING_SITE_URL`
- `RESEARCHER_BUDGET_TOKENS` — optional override, default 50000 (≈$0.50/topic abort threshold)

### GitHub Actions secrets (separate from Vercel)
- `OPENAI_API_KEY`, `GUARDIAN_API_KEY`, `UNSPLASH_ACCESS_KEY`, `NEWSAPI_KEY` — for pipeline runs
- `INGEST_URL`, `INGEST_TOKEN`, `CRON_BASE_URL`, `CRON_SECRET` — for the GH cron workflows to hit Vercel routes
- `TEST_POSTGRES_URL`, `TEST_ADMIN_TOKEN` — for Playwright CI

### Cron schedules (5 GH Actions workflows under `.github/workflows/`)
| Workflow | Schedule (UTC) | What it does |
|---|---|---|
| `pipeline.yml` | Mon/Wed/Fri/Sat 14:00 | `python main.py` — generates an article |
| `cron-competitor-audit.yml` | Mon/Wed/Fri 14:00 | Scrapes 9 competitor blogs |
| `cron-scheduled-publish.yml` | Tue/Wed/Fri/Sun 09:00 | Picks one `scheduled` article, publishes via GitHub API |
| `cron-seo-snapshot.yml` | Daily 02:00 | Pulls GSC + Bing data (idle until M3 done) |
| `cron-daily-digest.yml` | Daily 22:00 | Resend email summary of activity + URL-rejection counts |
| `sunday-batch-report` (Vercel cron, NEW from M4) | Monday 09:00 | Resend email with the prior Sunday review's stats |

### Test counts at handover
- **vitest**: 289 passing, 6 skipped, 27 files
- **pytest**: 40 passing (backend agents + URL validation + writer + image-fetch + AHPRA)
- **Playwright**: 8 specs (sunday-signin, sunday-queue, sunday-approve, sunday-edit, sunday-reject, validator-gate, concurrent-approve, queue-rendering, edit-then-approve, sunday-batch-25min, url-whitelist, article-edit-layout, banner-state, axe-core-a11y, admin-flow — some fixme'd pending live infra)

### Plan doc
`docs/superpowers/plans/plan.md` is the live execution log. M0 / M1 / SEO-AEO-cross-check / UI-restore-side-quest sections all have detailed audit trails with commit SHAs. The fresh chat can grep for any milestone to see what shipped + what was deferred.

### Memory file (per-project, auto-loaded)
`~/.claude/projects/-Users-jasminebaldevraj-Desktop-statdoctor-blog/memory/MEMORY.md` carries 6 user-preference entries that auto-load on every session:
- Two-repo rule
- Vercel deploys from `extracted/`
- Vercel Pro plan
- DB preference (Neon free → Supabase fallback, never paid by default)
- Handover mode (unattended for months, optimise for autonomy)
- Sunday review window (20–30 min, ≥95% approve-as-is target)

---

## Subagent dispatch rhythm (what worked this session)

The previous chat used `superpowers:subagent-driven-development` with **`isolation: "worktree"`** + `run_in_background: true` for parallel agents. Pattern:

1. Define strict file boundaries per agent (you may touch X, must NOT touch Y)
2. Dispatch 4–6 agents in parallel, each in its own worktree
3. Each agent commits to its own branch
4. As each notifies completion, push their branch + open PR + merge
5. Sync local main between merges

**Worktree gotcha (real bug observed):** one agent skipped its assigned worktree and committed onto an unrelated branch. Cherry-pick salvage works; the dispatch prompt now hammers "Confirm `git rev-parse --abbrev-ref HEAD` starts with `worktree-agent-` before your first commit. If not, STOP and report BLOCKED."

**Other lessons:**
- Agent F initially wrote "Dr Anu Baldev" (name confusion with the system user `jasminebaldevraj`). Always grep for "Anu Baldev" before merging schema/JSON-LD work; correct is **Dr Anu Ganugapati**.
- Spec reviewers caught real issues (loose `/pnpm test/` regex; missing `OPENAI_API_KEY` in pytest CI job). The two-stage review (spec → code-quality) is worth the token cost.

---

## Quickstart for the next chat

```bash
# 1. Read this file end-to-end (you're doing it now)
# 2. Skim the plan execution log:
head -200 docs/superpowers/plans/plan.md

# 3. Check git is on main + clean:
git status --short | grep -vE "__pycache__|\.coverage|\.claude"
git log --oneline -5

# 4. Confirm tests still pass:
cd extracted && pnpm test  # expect 289 passing
cd ../backend && source venv/bin/activate && pytest --tb=no -q  # expect 40 passing

# 5. Check no open PRs:
gh pr list --state open  # expect empty

# 6. Read these for context:
#    - HANDOVER.md (operator runbook)
#    - ARCHITECTURE_101X.md (design)
#    - docs/superpowers/m3-domain-attach-runbook.md (next user action)
```

### Most likely first user request

Either:
- **"I did M3 / I'm starting M3, help me with X"** — open the runbook, drop them at the right step. The `/admin/seo` dashboard fills with real data ~5 days after they finish.
- **"How did Sunday review go"** — they did the M5 dry run. Capture the time + approve-as-is rate. Update plan.md M5 section + mark complete.
- **"Add feature X"** — check if it's on the deferred-code list above. If yes, pick up that scope. If no, follow the brainstorming → plan → execute rhythm.

### Most likely first user blocker

The Vercel transfer to Pro might have hiccupped (Postgres binding sometimes needs re-linking; GitHub integration might prompt for re-auth). If they say "/api/health is failing after transfer":
1. Check `POSTGRES_URL` env var on the new account's project
2. Check the Neon Marketplace integration in Vercel Storage tab
3. If lost: re-create the connection (the DB itself is unchanged; just the binding needs rewiring)

---

## Open follow-ups index

Everything not blocked on user action is in the **Pending CODE** table above. Top 3 if you have a quiet moment:

1. **Banner UI wiring** — render `<Banner state={…} />` at the top of `/admin/posts`. Calls `/api/admin/banner-state`. ~30 min agent work.
2. **First axe-core run + violation triage** — `pnpm exec playwright test e2e/axe-core-a11y.spec.ts` once `RESEND_API_KEY` + DB are set. Each violation per its own follow-up.
3. **MODE flag for pipeline** — add `--mode {news,guide,company}` to `backend/main.py`. ~30 min agent work.

Don't proactively do these. Wait for the user to ask OR for them to become blocking.

---

**End of handover. Good luck.**
