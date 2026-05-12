# ARCHITECTURE_101X.md

The north-star architecture for the StatDoctor blog system. This document captures *how it should be built* if we were starting clean — not necessarily where the code is today. Use as a reference for every design decision: "does this commit move us toward or away from the 101x picture?"

Read alongside:
- `BLOG_AGENT.md` — current implementation status + per-phase progress
- `blog.md` — editorial system, voice rules, content strategy
- `AGENT.md` — repo-level conventions

---

## Operating constraint: hands-off for months

**The CEO does not log in daily.** This system is being handed over and must operate unattended for months at a time. Every architectural decision is judged against that constraint first.

Implications that shape the design:

- **No "Anu's laptop" dependency anywhere on the critical path.** Pipeline runs in cloud, on a cron.
- **Tiered approval, not all-or-nothing review.** News auto-publishes after a short window (default 48h) if the CEO hasn't acted on it. Guides queue indefinitely. Company-stream content is CEO-written. (Per `blog.md`.)
- **Alert on every failure path.** Cron failures, ingest failures, publish failures, GSC fetch failures — every one writes a row to `alerts` and sends a daily digest email via Resend. Silent breakage is the worst outcome.
- **Cost-bounded.** Per-week caps on OpenAI calls, Guardian API calls, etc. Hard stops, not warnings. A runaway loop while the user isn't watching is a real-money risk.
- **Pre-flight sanity checks** before every cron run: API keys present, DB reachable, recent run history sane. Fail loudly if not.
- **State visible at a glance.** `/admin` lands on a status panel that answers "is anything broken?" in the first paragraph. Last cron run, last publish, alerts, backlog count.
- **Self-onboarding docs.** `HANDOVER.md` is a first-class artefact. Future-Anu in 3 months should be able to read it and operate the system without re-reading every conversation.
- **Default config = working config.** Env vars have sensible defaults where possible. Missing required ones produce explicit, helpful errors — not silent skip-behaviour.

---

## Mental model

**One product, one database, two surfaces.**

The product is: *publish AHPRA-compliant locum-doctor articles fast enough that they rank on Google page one for high-intent queries, with CEO sign-off, and prove the ranking is happening — all without daily human intervention.*

Everything else — Python pipeline, dashboard, public reader, SEO tracker — is plumbing to make that product reliable on its own.

The two surfaces:
- **Admin** (`/admin/*`) — internal. Editorial review queue, SEO dashboard, competitor topic proposals. Gated.
- **Public reader** (`/blog/*`, `/about/...`) — what doctors actually read. Indexed by Google.

Both surfaces query the same Postgres tables. The DB is the source of truth — no JSON files on disk, no git-commits-per-article.

---

## System diagram

```
                  ┌─────────────────────────────────────────────┐
                  │            Vercel Postgres (Neon)            │
                  │                                              │
                  │   posts          ⟵ source of truth          │
                  │     status: pending_review | approved |      │
                  │             published | rejected             │
                  │   post_revisions ⟵ snapshot per edit        │
                  │   audit_events                               │
                  │   seo_snapshots                              │
                  │   keyword_targets                            │
                  │   competitor_proposals                       │
                  └──┬────────────────────────────────────┬──────┘
                     │                                    │
        ┌────────────┴──────────┐              ┌──────────┴───────────┐
        │  Dashboard (admin)    │              │  Public reader        │
        │  Next.js · App Router │              │  Next.js · App Router │
        │                       │              │                       │
        │  /admin/posts         │              │  /blog                │
        │  /admin/posts/[slug]  │              │  /blog/[slug]         │
        │  /admin/seo           │              │  /about/dr-anu-…      │
        │  /admin/competitor-…  │              │  /sitemap.xml         │
        │                       │              │  /robots.txt          │
        │  /api/admin/ingest    │              │                       │
        │  /api/admin/migrate   │              │  ISR — revalidate     │
        │  /api/cron/seo-snap   │              │  on Approve via       │
        │  /api/cron/competitor │              │  revalidateTag()      │
        │  /api/public/posts ◀──┼─── reader ───┤                       │
        └───────────▲───────────┘  fetches by  └───────────────────────┘
                    │              status=
                    │              'published'
            POST /api/admin/ingest    (Bearer INGEST_TOKEN)
                    │
        ┌───────────┴────────────┐
        │  Python pipeline       │
        │  ─ runs as GitHub      │
        │    Action on cron      │
        │    (NOT on laptop)     │
        │  ─ 5 agents +          │
        │    validation/urls.py  │
        │  ─ writes to laptop    │
        │    FS only as backup   │
        └────────────────────────┘
```

---

## Flow (end-to-end)

1. **GitHub Action** fires Mon/Wed/Fri 14:00 UTC. Spins up Python. Runs `main.py`.
2. **Intelligence agent** picks a topic via 40/40/20 (News / Guides / Inside StatDoctor) with override rules: never 3-of-same content-type in a row; force a guide if any pillar has 0 coverage in the last 12 posts.
3. **Researcher** fans out across 5 source adapters (Guardian, ABC AU, NewsAPI, Google News RSS, Authoritative gov/peer-review). Dedupes by URL. Runs `validation/urls.py` (HEAD-check + domain whitelist). **The model never invents URLs — it selects from the validated adapter pool.**
4. **Writer / SEO / AHPRA** agents produce the FinalPost JSON. Deterministic-ish (low temperature, seeded).
5. **Pipeline POSTs** the JSON to `/api/admin/ingest` with `Authorization: Bearer INGEST_TOKEN`. Idempotent by slug — re-runs upsert, don't duplicate.
6. **Dashboard's `ingest` route** runs the SAME validators that the dashboard UI runs, server-side, and stores the article with `status='pending_review'`. If validators fail catastrophically (e.g., a hard AHPRA term), status defaults to `rejected_auto` instead and the article goes to a "needs human triage" bucket.
7. **CEO opens `/admin/posts`** on Sunday. Sees the queue. Each row: validator badges (8 green dots / red dots). Inline edit for markdown / meta / keywords. Validators re-run on every save. **Approve is disabled until all hard checks pass.**
8. **Approve handler** flips status to `'published'`, writes an `audit_events` row, snapshots the previous state to `post_revisions`, and calls `revalidateTag(\`post-${slug}\`)` so the public reader picks it up within seconds. **No GitHub commits. No website rebuild. No file copies.**
9. **Public reader** at `/blog/[slug]` renders from the DB. It's mostly static (Next.js full-route cache) but invalidates on Approve. Schema.org JSON-LD emitted inline: `MedicalScholarlyArticle` + `Person(author)` + `BreadcrumbList` + `FAQPage`.
10. **SEO cron** runs daily at 02:00 UTC. Pulls GSC + Bing into `seo_snapshots`. The dashboard at `/admin/seo` reads aggregated views from that table — never re-queries GSC at request time.

---

## Key technical decisions

| Decision | Choice | Why |
|---|---|---|
| Number of Next.js apps | **1** with route groups (`app/(public)`, `app/(admin)`) | Two-repo dance doubles deploys, env var sprawl, and creates the GitHub-API-commit-on-Approve mess. |
| Source of truth | **Postgres rows, not JSON files** | Files-on-disk forced the GitHub-commit gymnastics. DB makes Approve a single SQL update. |
| Pipeline location | **GitHub Action on cron**, not laptop | Removes the "Anu's laptop is off" failure mode. Free for public repos. |
| Validators | **Single JSON file** consumed by Python AHPRA agent AND TS validator | No drift. Compliance teeth. |
| DB access | **Drizzle ORM** | End-to-end TS types from schema → query. No string SQL, no row→type mapping by hand. |
| Migrations | **Drizzle Kit `up`** with a `_migrations` history table | Idempotent, diff-aware, rollback-able. |
| Auth | **Magic-link via Resend + signed JWT cookie** | "Cookie equals env var" is a footgun. Magic link is free, supports multi-user, ties audit log to a real identity. |
| Idempotency | **Slug-keyed upsert + content hash** | Pipeline can re-fire safely. Identical content = no-op. |
| Versioning | **`post_revisions` table** — every edit snapshots `data` JSONB | Approve is auditable and revertible. |
| Soft delete | **`deleted_at TIMESTAMPTZ NULL`** | Never hard-delete. Public reader excludes `WHERE deleted_at IS NULL`. |
| Public read freshness | **Next.js full-route cache + `revalidateTag` on Approve** | Static performance + instant freshness. No cache-TTL jank. |
| Observability | **Sentry (errors) + Plausible (traffic) + Vercel Analytics (RUM)** | All free tiers. Three angles you actually need. |
| Tests | **Vitest unit tests for validators + Playwright happy-path for `/admin/posts`** | Validators are pure functions and have compliance teeth. Untested = scary. |
| Background jobs | **Inngest or Trigger.dev** for anything > 60s | Vercel functions have execution caps. Long-running Researcher runs need a job runner. |
| GSC/Bing fetch | **Cached daily snapshots + computed aggregates table** | Re-querying GSC on every dashboard load is slow + rate-limited. |
| AI as subcontractor | **Every model output goes through structured validators before it persists** | The model can hallucinate. The validators can't. |

---

## Boundaries (the rules that don't bend)

1. **The model never produces source URLs.** It selects from the validated adapter pool. Re-introducing free-form URL generation is the regression that brought us to needing `validation/urls.py`.

2. **Approve = `UPDATE posts SET status='published' WHERE slug=…`.** It does *not* commit JSON files anywhere. The "publish target" abstraction (`WEBSITE_POSTS_DIR` / `GITHUB_TOKEN`) is the old shape; the 101x shape is a DB flip + revalidate.

3. **The validators live in ONE file.** `extracted/lib/admin/validators.json` is the source of truth. Python loads it via relative path. TS imports it. If you find yourself editing only one side, you've already drifted.

4. **No hard deletes.** Always `deleted_at`. Always revertible.

5. **Audit every state change.** Approve, reject, edit, publish, publish-fail — every one writes an `audit_events` row with an actor identity. Future "who approved this on 2026-04-12" is just `SELECT`.

6. **AHPRA compliance is not optional.** Every published post must have `ahpra_passed=true` AND no flags with `requires_human_review=true`. The Approve button enforces this server-side, not just in the UI.

7. **The repo-separation rule still applies.** STATDOCTOR_BLOGPOSTING owns generation + admin + (eventually) the blog reader. `~/website/` owns marketing pages. They share data only via the DB or the public read API.

---

## Where the current build stands (2026-05-12)

**On-path:**
- Single repo with admin inside `extracted/` ✓
- Postgres review queue with full TS types ✓
- Server-side validator re-run on Approve ✓
- Pipeline → ingest API (Bearer token, separate from admin) ✓
- AHPRA flags + structured rejection taxonomy ✓
- Audit log table ✓

**In-progress (Phase 2.5b — this commit series):**
- Move banned-phrase list to a single JSON consumed by Python + TS ✓
- Vitest unit tests for validators (38 passing) ✓
- Add `/api/public/posts` and `/api/public/posts/[slug]` read API (forward path)
- Replace raw `sql\`\`` with Drizzle ORM (typesafe queries, proper migrations)

**Transitional state (kept for handover stability, not yet removed):**
- `publish.ts` still commits approved JSON to the website repo via GitHub API. The 101x answer is "drop it; the website fetches from `/api/public/posts`." But since the website-repo is hands-off until a separate session, we keep both paths during the transition. When the website is updated to consume the public API, `publish.ts` becomes dead code and can be deleted.

**Still off-path (work items):**
- Public reader still lives in `~/website/`, not in `extracted/`. Migrating the reader into `extracted/(public)/blog/` collapses three repos to one. (Future phase — out of immediate scope.)
- Pipeline runs on laptop, not GitHub Actions. (Phase 6 territory.)
- No tests beyond the validators (Phase 4 work — Playwright happy-paths once SEO dashboard is in.)
- Auth is a static cookie token, not magic-link. (Phase 5 — when we open access beyond Anu.)
- `validation/urls.py` HEAD-check + whitelist not implemented yet. (Backend hardening item, called out in BLOG_AGENT.md.)

---

## How to use this doc

When proposing a change, ask:
1. **Does this move us closer to the 101x picture, or further from it?**
2. **If further, what's the explicit reason and what's the planned correction?**

Examples:
- *"Let me add another JSON file to track approvals"* → No. Approvals are state on `posts.status`.
- *"Let me commit articles to a separate repo on approve"* → No. Approve is a DB flip.
- *"Let me skip validators for now and reapply later"* → No. Validators run server-side every time. Compliance teeth.
- *"Let me hard-delete a rejected post"* → No. Use `deleted_at`.

Conversely:
- *"Let me add a column to `posts` for tracking who reviewed"* → Yes (and update the migration).
- *"Let me extract the source-domain whitelist out of code"* → Yes, into `validators.json`.

The 101x picture isn't the law. It's the gravitational centre. Drift happens. Periodic resets back toward it are how the system stays maintainable.
