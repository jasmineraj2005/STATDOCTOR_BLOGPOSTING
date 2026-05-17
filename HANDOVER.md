# HANDOVER.md

The operator runbook for the StatDoctor blog system. Read this first if you're picking the project up cold — it's everything you need to operate, monitor, and recover the system without re-reading old conversations.

Read alongside:
- `ARCHITECTURE_101X.md` — *how* the system is designed and why
- `BLOG_AGENT.md` — implementation status per phase
- `blog.md` — editorial system + content strategy

---

## What this is, in one paragraph

A two-system blog factory for `statdoctor.app`:

1. A **Python pipeline** (in `backend/`) generates AHPRA-compliant locum-doctor articles. It runs in **GitHub Actions** on a Mon/Wed/Fri cron.
2. A **Next.js dashboard** (deployed at `https://statdoctor-blogposting.vercel.app`, built from `extracted/`) lets the CEO review and approve each article. Approve = publish — the JSON lands in the website repo, the website rebuilds, the article goes live.

The CEO needs ~20 minutes a week to review the queue. Everything else runs unattended. News posts auto-publish after 48h of CEO inaction. The system emails a daily digest summarising activity and any failures.

---

## System architecture in one diagram

```
                  ┌────────────────────────────────────────────┐
                  │       Vercel Postgres (Neon, free)         │
                  │   posts  audit_events  alerts  cron_runs   │
                  └──┬───────────────────────────────────┬─────┘
                     │                                   │
        ┌────────────┴──────────┐             ┌──────────┴──────────┐
        │ Dashboard (extracted) │             │ Website (separate    │
        │ statdoctor-           │             │ repo, statdoctor.app)│
        │ blogposting.          │             │                      │
        │ vercel.app            │             │ reads JSONs from     │
        │                       │             │ content/posts/ (for  │
        │ /admin/posts          │             │ now — will switch to │
        │ /admin/seo            │             │ /api/public/posts    │
        │ /admin/competitor-…   │             │ in a later session)  │
        │ /api/admin/ingest ◀───┼──── pipeline POST                  │
        │ /api/cron/*           │             │                      │
        │ /api/public/posts     │             │                      │
        │ /api/health           │             │                      │
        └───────────▲───────────┘             └──────────────────────┘
                    │
                    │ daily curl from GH Actions
        ┌───────────┴───────────┐
        │ GitHub Actions        │
        │                       │
        │ pipeline.yml          │  ← Mon/Wed/Fri 14:00 UTC, python main.py
        │ cron-auto-publish…    │  ← daily 03:00 UTC
        │ cron-competitor-audit │  ← M/W/F 14:00 UTC
        │ cron-daily-digest     │  ← daily 22:00 UTC
        └───────────────────────┘
```

---

## Day 1 setup — exact steps

Follow in order. Each step is ~5 minutes.

### 1. Provision the Vercel project

- Vercel dashboard → **Add new** → **Project** → import from GitHub `jasmineraj2005/STATDOCTOR_BLOGPOSTING`.
- **Settings → General → Root Directory:** `extracted` (critical — the Next.js app lives there, not at the repo root).
- **Framework Preset:** Next.js (auto-detected).
- Deploy. The dashboard should be live at `https://<project>.vercel.app/` — you'll see the v0 home page.

### 2. Provision the database

- Vercel project → **Storage** → **Create** → **Marketplace** → search "Neon" → install.
- Create a new Neon Postgres database (free hobby tier, 256 MB).
- Vercel auto-injects `POSTGRES_URL` into the project's env vars. Confirm it appears under **Settings → Environment Variables**.
- Alternative: Supabase free tier works too — paste its connection string as `POSTGRES_URL`.

### 3. Provision Resend (for the daily digest)

- Sign up at `https://resend.com` (free: 3,000 emails/month).
- Verify a domain you control (e.g., `statdoctor.app`). Cleanest is using a subdomain like `mail.statdoctor.app` so the marketing domain stays untouched.
- Create an API key.

### 4. Set env vars on Vercel

Project **Settings → Environment Variables** — paste these (mark as Production + Preview unless noted):

| Name | Value | Notes |
|---|---|---|
| `POSTGRES_URL` | (auto-set by Neon integration) | required |
| `ADMIN_TOKEN` | random 32+ char string | gates `/admin/*` |
| `CRON_SECRET` | random 32+ char string | gates `/api/cron/*` |
| `INGEST_TOKEN` | random 32+ char string | gates `/api/admin/ingest` |
| `RESEND_API_KEY` | the Resend key from step 3 | required for daily digest |
| `DIGEST_EMAIL_TO` | `anu@statdoctor.net` | recipient |
| `DIGEST_EMAIL_FROM` | `StatDoctor Editorial <digest@mail.statdoctor.app>` | must match a Resend-verified domain |
| `WEBSITE_REPO_OWNER` | `jasmineraj2005` | for publishing to the website repo |
| `WEBSITE_REPO_NAME` | `website` | |
| `WEBSITE_REPO_BRANCH` | `main` | |
| `GITHUB_TOKEN` | a GitHub fine-grained PAT with `contents: write` on the website repo | required for the Approve handler's publish step |
| `NEXT_PUBLIC_SITE_URL` | `https://statdoctor-blogposting.vercel.app` | used in digest links |
| `AUTO_PUBLISH_NEWS_HOURS` | `48` | optional — defaults to 48 |
| `OPENAI_API_KEY` | OpenAI key | only needed if you run the competitor-audit cron from Vercel (you don't if it runs from GH Actions, which is the default) |

### 5. Set GitHub repo secrets

GitHub → repo **Settings → Secrets and variables → Actions** → add:

| Name | Value |
|---|---|
| `OPENAI_API_KEY` | OpenAI key (pipeline) |
| `GUARDIAN_API_KEY` | Guardian Content API (free, 5k req/day) |
| `UNSPLASH_ACCESS_KEY` | optional |
| `NEWSAPI_KEY` | optional |
| `INGEST_URL` | `https://<project>.vercel.app/api/admin/ingest` |
| `INGEST_TOKEN` | same value you set on Vercel |
| `CRON_BASE_URL` | `https://<project>.vercel.app` |
| `CRON_SECRET` | same value you set on Vercel |

### 6. Apply the DB migration

One-time. Open a shell on your laptop:

```bash
# Use the ADMIN_TOKEN cookie OR (simpler) hit it once while signed-in-as-admin from /admin
curl -X POST -H "Cookie: admin_token=$ADMIN_TOKEN" \
  https://<project>.vercel.app/api/admin/migrate
# → { ok: true, detail: "Applied N statement(s)." }
```

Or hit it from the browser by setting the `admin_token` cookie manually in DevTools, then visiting `/api/admin/migrate` (POST).

### 7. Verify health

```bash
curl https://<project>.vercel.app/api/health
# → { ok: true, status: "healthy", checks: { db: "ok", crons: "not_yet_run" } }
```

### 8. Trigger the first pipeline run manually

GitHub → **Actions** → **Pipeline — generate an article** → **Run workflow**. Watch the logs. On success, the new article should appear at `/admin/posts` within seconds.

### 9. Set up uptime monitoring (UptimeRobot)

- Sign up `https://uptimerobot.com` (free tier 50 monitors / 5-min checks).
- Add a monitor: HTTP(s) GET `https://<project>.vercel.app/api/health`, interval 5 min, alert contacts: your email.
- This will fire if `/api/health` returns 503 (degraded) or times out.

---

## Day-to-day operation

| When | What | Where |
|---|---|---|
| Mon / Wed / Fri / Sat 14:00 UTC | Pipeline generates an article (4/week) | GitHub Actions → "Pipeline" |
| Mon / Wed / Fri 14:00 UTC | Competitor audit | Dashboard `/admin/competitor-topics` |
| Daily 02:00 UTC | SEO snapshot (GSC + Bing) | Dashboard `/admin/seo` |
| Tue / Wed / Fri / Sun 09:00 UTC | Scheduler publishes one queued article | Live website + audit event |
| Daily 22:00 UTC | Daily digest email | Inbox |
| Continuously | Uptime monitor checks `/api/health` | UptimeRobot dashboard / email alerts |
| Sundays (~20 min) | CEO batch-review queue (4 articles ready) | `/admin/posts` |

**Each generated article lifecycle:**

```
Pipeline run (Mon/Wed/Fri/Sat 14:00 UTC)
    ↓
/api/admin/ingest (inserts as status='pending_review')
    ↓
Waits in /admin/posts for CEO — every article requires manual review.
    ↓
CEO opens /admin/posts/[slug] on Sunday
    ↓
Validators panel (8 checks): AHPRA, banned phrases, anchor text, callouts,
table, schema, words, sources. Approve button enabled only when all green.
    ↓
─── Approve → status='scheduled' (queued, NOT live yet)
─── Reject (with reason taxonomy) → status='rejected'; after 2 rejections
                                    the topic is dropped permanently
─── Edit → re-validates; status back to 'pending_review'
    ↓
Scheduler cron (Tue/Wed/Fri/Sun 09:00 UTC) picks oldest 'scheduled' article
and publishes it. One article per slot — keeps the cadence uniform.
    ↓
publish.ts commits JSON to website repo (GitHub API) → site rebuilds
    ↓
status='published'
```

---

## URL validation (M1)

### What URL validation does

The AI pipeline sometimes fabricates source URLs — in one incident, five completely made-up links appeared in a fuel-prices article. To prevent AHPRA-byline credibility damage, every URL in an article is now checked at ingest time against two gates: it must (1) match a whitelisted domain and (2) return a 2xx or 3xx status on a HEAD request. Any URL failing either check is dropped and recorded in `ahpra_flags` on the `posts` row with `type: "source_not_in_whitelist"` or `type: "source_unreachable"`. Once M1.T5 lands, if the surviving source count falls below 5 after these drops, the article is rejected entirely at ingest — it never enters the review queue.

---

### Where the whitelist lives

**`data/url-whitelist.json`** is the single source of truth — read by both the Python validator (`backend/validation/urls.py`) and the TypeScript mirror (`extracted/lib/admin/url-validator.ts`). It ships with 26 initial domains across 6 tiers:

| Tier | Examples |
|---|---|
| `gov-au` | aph.gov.au, health.gov.au, ahpra.gov.au |
| `gov-nz` | health.govt.nz |
| `peer-reviewed` | pubmed.ncbi.nlm.nih.gov, cochranelibrary.com |
| `mainstream-news` | abc.net.au, bbc.com, reuters.com |
| `mainstream-aus` | smh.com.au, theage.com.au |
| `professional-body` | ama.com.au, racgp.org.au |

Schema: `data/url-whitelist.schema.json`.

---

### How to add a new domain to the whitelist

1. Open `data/url-whitelist.json`.
2. Add a new object to `domains[]`:
   ```json
   {
     "domain": "example.org.au",
     "tier": "professional-body",
     "rationale": "Peak body for X — authoritative primary source for Y topic.",
     "added_at": "2026-05-16"
   }
   ```
   Rules: `domain` is bare (no `https://`, no `www.`). `tier` must be one of the six values above. `rationale` is one sentence explaining WHY we trust it, not what it is.
3. **Open a PR — do not push directly to main.** The whitelist is the security boundary. It requires a review before merge.
4. CI will run `pytest test_url_whitelist_data.py` (Python schema check) and `vitest url-whitelist-data.test.ts` (TS schema check) — both must pass.
5. CI will also run the cross-language drift tests (`test_url_validation_drift.py` / `url-validator-drift.test.ts`) to catch any subdomain edge-case discrepancy between the two validators.

---

### How to read URL-rejection telemetry

**Daily digest (22:00 UTC inbox):** from M1.T10, the email includes a summary line:

```
URL validation (last 7 days): N URLs rejected — M not in whitelist, K unreachable
```

**Per-article — SQL:**

```sql
-- Articles with at least one "not in whitelist" rejection
SELECT slug, ahpra_flags
FROM posts
WHERE jsonb_path_exists(ahpra_flags, '$[*] ? (@.type == "source_not_in_whitelist")');

-- Articles with at least one unreachable-source rejection
SELECT slug, ahpra_flags
FROM posts
WHERE jsonb_path_exists(ahpra_flags, '$[*] ? (@.type == "source_unreachable")');
```

**Admin dashboard:** flags surface in the per-article review page at `/admin/posts/[slug]`. Each flag shows the rejected URL and the reason.

---

### Stuck article? URL flags on a post that should approve

1. Open `/admin/posts/[slug]`. Read the flags panel.
2. **`source_not_in_whitelist`:** the domain isn't whitelisted.
   - If it's a genuinely trustworthy source that matches the editorial standard: add the domain via the PR flow above, then re-run the article through ingest (`/api/admin/ingest`).
   - If it's marginal or low-quality: the pipeline should be citing better sources — replace the URL in the article, or reject and regenerate.
3. **`source_unreachable`:** the HEAD check returned 4xx/5xx or timed out.
   - Confirm the source is actually gone (open it in a browser).
   - If gone: remove it from the article OR swap in an equivalent source that's already whitelisted.
   - If it's flaky / temporarily down: re-run ingest during off-peak hours.
4. **Suspected validator bug** (domain is whitelisted but still flagged): open a GitHub issue with the exact URL and flag JSON. Fall back to manual approval only after you've independently verified the URL loads correctly in a browser.

---

### Anti-patterns

- **Don't disable the validator to ship faster.** The entire point is preventing fabricated sources reaching AHPRA-bylined articles. A bad URL in a published post is reputational damage that can't be un-done by reverting code.
- **Don't add a domain because one article cites it.** The bar for whitelist inclusion is: multiple articles would reasonably cite this source, AND it is editorially authoritative. One-off citation → find an equivalent source that's already whitelisted.
- **Don't push whitelist changes directly to main.** The `domains[]` list is a security boundary. Every addition needs a PR review, even if you wrote the initial list.

---

## Runbook — what to check if X breaks

### Daily digest never arrives

1. UptimeRobot still green? If not — that's the bigger problem; see "health endpoint failing."
2. **Vercel deployment logs** for the `cron-daily-digest` GH Action run. GH Actions tab → Cron — daily-digest → most recent run.
3. Hit the endpoint manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/cron/daily-digest` — read the JSON body.
4. Common causes:
   - `RESEND_API_KEY` or `DIGEST_EMAIL_TO` env var missing on Vercel
   - Resend domain not verified
   - `DIGEST_EMAIL_FROM` doesn't match a Resend-verified domain
   - Resend free-tier quota exhausted (`3,000/mo`)

### `/api/health` returns 503

Read the body. The `checks` object names the failing component:

- `db: unreachable` → check Vercel Postgres integration status; check Neon dashboard.
- `cron:<kind>: stale_<N>h` → the named cron hasn't run in too long. Check the matching GH Actions workflow's recent runs.
- `cron:<kind>: last_run_failed` → look at the corresponding `audit_events` / `alerts` row for detail.

### Articles aren't reaching the website

The Approve handler commits to the website repo via GitHub API. If posts are stuck:

1. Check `audit_events` for `publish-failed` rows: `SELECT * FROM audit_events WHERE action = 'publish-failed' ORDER BY ts DESC LIMIT 10;`
2. Common cause: `GITHUB_TOKEN` env var missing on Vercel, or the PAT has expired / lacks `contents: write` on the website repo.

### The pipeline keeps generating duplicate topics

`backend/past_topics.json` should be growing. Confirm it's being committed back to the repo by the workflow. If GH Actions can't commit (workflow needs `contents: write` permission), add this to `pipeline.yml`:

```yaml
permissions:
  contents: write
```

And a step that commits the updated `past_topics.json` back to main after the run.

### Validator changes need to ship to BOTH Python AND TS

`extracted/lib/admin/validators.json` is the single source of truth. **Don't add patterns in code.** Both `backend/agents/ahpra.py` and `extracted/lib/admin/validators.ts` read this file at startup / build time.

Run `pnpm test` in `extracted/` after any change — Vitest covers the patterns.

---

## Cost ceiling

All free tier, in good faith. If usage exceeds these, you'll get email warnings from each provider.

| Service | Tier | Budget | Used by |
|---|---|---|---|
| Vercel Hobby | free | unlimited builds, 100GB-h compute | dashboard hosting |
| Neon Postgres | free | 256MB DB, unlimited queries | review queue, audit, SEO snapshots |
| OpenAI | pay-as-you-go | typically $1–3 per pipeline run (`gpt-4o` writer + `gpt-4o-mini` SEO/AHPRA) | pipeline |
| Guardian Content API | free | 5,000 req/day | researcher source adapter |
| Unsplash | free | 50 req/hr | researcher hero image |
| Resend | free | 3,000 emails/month | daily digest |
| GitHub Actions | free for public repos | unlimited; 2000 min/mo for private | pipeline + cron dispatchers |
| UptimeRobot | free | 50 monitors, 5-min checks | health monitoring |

**Pipeline cost cap:** at 3 articles/week (~12/month), OpenAI cost is ~$12-36/month. Set a $50/month hard cap in the OpenAI dashboard for safety.

---

## How to pause everything

- **Pipeline only:** disable the `Pipeline — generate an article` workflow (GH Actions → workflow name → ⋯ → Disable).
- **All crons:** same, on each `cron-*.yml`.
- **Whole dashboard (keep DB):** Vercel project → Settings → General → **Pause deployment**.
- **Nuclear:** delete the Vercel project. The DB and GH repo survive.

---

## How to operate manually

If GH Actions is broken or you want to force a run:

```bash
# 1. Run the pipeline locally (laptop must have backend/.env populated)
cd backend
python main.py

# 2. Fire any cron manually
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<project>.vercel.app/api/cron/auto-publish-news
```

```bash
# 3. Sync the local backend/output/ → DB (the same path the cloud pipeline uses)
curl -X POST -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data @backend/output/<filename>.json \
  https://<project>.vercel.app/api/admin/ingest
```

---

## Where the secrets live

- **Vercel project env vars** (production): runtime config for the dashboard.
- **GitHub repo secrets**: pipeline + cron workflow config.
- **Local `backend/.env`** (gitignored): for running the pipeline locally.
- **`scripts/verify-*.sh`**: encode the local development env via `POSTGRES_URL`/`INGEST_TOKEN`/`CRON_SECRET` for testing.

If you rotate `ADMIN_TOKEN` / `CRON_SECRET` / `INGEST_TOKEN`, update the secret in BOTH Vercel AND GitHub.

---

## Where to find logs

- **Pipeline runs**: GitHub Actions tab → `Pipeline — generate an article` → click any run for full logs.
- **Cron runs**: GitHub Actions tab → respective `Cron — *` workflow.
- **Dashboard requests**: Vercel dashboard → project → **Logs**. Real-time tail.
- **DB activity**: Neon dashboard → SQL editor → `SELECT * FROM audit_events ORDER BY ts DESC LIMIT 50;`
- **Alerts**: `SELECT * FROM alerts WHERE acknowledged_at IS NULL ORDER BY ts DESC;`

---

## Fail-Agent System (added 2026-05-17 PM)

Four-layer defence so the system survives months unattended. Each layer is
independent — a failure in one doesn't disable the others.

- **Layer A — Python validators** (`backend/agents/fail_agent.py`): after each
  main agent (researcher / writer / SEO / AHPRA) runs, the matching
  `validate_*` function checks the output against `validators.json` + minimum
  source counts. Every check is logged to the `pipeline_runs` DB table
  (`run_id`, `agent_name`, `status`, `failure_reason`, `retry_count`). The
  current iteration ships as observability-first; full auto-retry with
  re-prompting is the next iteration once each agent accepts a
  `previous_failure` kwarg.
- **Layer B — Workflow recovery** (`.github/actions/recover-and-alert/`):
  composite action wraps every cron's curl. On non-2xx: sleeps 60s, retries
  once, and on second failure POSTs to `/api/alerts/dispatch` (severity=error).
  All six workflows now use it.
- **Layer C — Ingest gate** (`extracted/app/api/admin/ingest/gate.ts`):
  server-side hard-gate on the `/api/admin/ingest` payload. Checks: required
  schema fields, word_count vs floor from `validators.json`, sources ≥ 5.
  Defaults to **shadow mode** (logs `[fail-agent/layer-c] mode=shadow …`).
  Flip `FAIL_AGENT_INGEST_GATE=strict` on Vercel to switch to 422 enforcement
  after smoke-testing.
- **Layer D — Daily canary** (`extracted/app/api/cron/canary/route.ts` +
  `.github/workflows/cron-canary.yml`): 04:00 UTC daily. Builds a synthetic
  article (`buildCanaryPost`), walks ingest → approve → publish-dry → delete.
  Slug prefix `__canary-` is filtered from public queue views. Any step
  failure dispatches a `canary_failed` critical alert with full step context.

To debug a failed pipeline run: `SELECT * FROM pipeline_runs WHERE run_id='<uuid>' ORDER BY ts;`

### New Vercel env vars (Fail-Agent)
- `ALERT_INGEST_TOKEN` — random 32+ chars, also set as GH Actions secret. Auths Layer B's POST to `/api/alerts/dispatch`.
- `FAIL_AGENT_INGEST_GATE` — set to `strict` to enable Layer C 422s. Default unset = shadow mode.
- `CANARY_DRY_RUN` — optional, defaults to dry-run; canary never writes to the website repo regardless.

### Stats + Features pages (2026-05-17 PM)
- `/admin/stats` — CEO-facing growth dashboard (weekly published, GSC top-10, GSC/Bing trends, AEO citations).
- `/admin/features` — "How this is built" marketing-style showcase with live counters. Show to investors/partners.

## Resume from a cold pickup

If a fresh person opens this repo a month from now:

1. Read this file end-to-end.
2. Read `ARCHITECTURE_101X.md` for design context.
3. Read `BLOG_AGENT.md` for the per-phase build status.
4. Hit `https://<project>.vercel.app/api/health` — does it return 200?
5. Open `/admin/posts` (set `admin_token` cookie first) — does it show the queue?
6. Check the daily-digest email in the inbox for the last 7 days. Anything red?
7. If everything green: nothing to do. The system runs itself.
