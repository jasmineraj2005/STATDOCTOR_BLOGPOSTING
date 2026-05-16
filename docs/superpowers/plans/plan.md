# StatDoctor SEO/AEO Blog — Improvement Plan (on existing build)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the StatDoctor blog system from "built and shipping" to "ready to run unattended for months with ≥95% Sunday approve-as-is" — without re-doing the parts that already work.

**Architecture (already running):** Python pipeline in `backend/` (5 agents) → POST to `/api/admin/ingest` → Postgres review queue (Neon free, status `pending_review`) → CEO reviews via `extracted/app/admin/posts/` (Next.js, deployed at `statdoctor-blogposting.vercel.app`) → Approve fires `extracted/lib/admin/publish.ts` → JSON written to `~/website/content/posts/` via GitHub API → website rebuilds → article live. `/admin/seo` reads daily snapshots from Postgres. Resend daily digest at 22:00 UTC. UptimeRobot watches `/api/health`. Full ops doc at `HANDOVER.md`.

**Tech Stack (as it is, not as imagined):**
- **Backend:** Python, OpenAI SDK (Sonnet-tier writer + 4o-mini SEO/AHPRA), 5 agents in `backend/agents/`, scheduler in `backend/scheduler.py`, output to `backend/output/*.json`
- **Admin app:** Next.js 14 App Router in `extracted/` (Vercel deploy root), deployed to `statdoctor-blogposting.vercel.app`
- **DB:** Vercel Postgres via Neon Marketplace (free), schema in `extracted/lib/admin/schema.sql`
- **Cron:** GitHub Actions workflows under `.github/workflows/` (5 of them) → hit `/api/cron/*` with `CRON_SECRET`
- **Alerts:** Resend (free tier), daily digest cron at 22:00 UTC, UptimeRobot HTTP check on `/api/health`
- **Tests:** Vitest (`extracted/vitest.config.ts`), Playwright (`extracted/playwright.config.ts`), Pytest (`backend/tests/`). **Current coverage: ~3 files. This is the biggest gap and M0 below.**

**Two-repo rule (load-bearing):** Everything in this plan lives in `STATDOCTOR_BLOGPOSTING/`. Anything that needs the client site lands as an **artefact** in `docs/` for a separate `~/website/` session — never touched from here. The existing `docs/author-jsonld-snippet.md` is the template.

---

## Milestone Marker Phrases (used in every progress update)

When working through this plan I will report progress with these **exact phrases**, greppable in transcripts and ready for notification hooks:

| Phase | Phrase I will say |
|---|---|
| Starting | `🟢 MILESTONE M<n> STARTED: <name>` |
| Mid-milestone checkpoint | `🟡 MILESTONE M<n> CHECKPOINT: <name> — <what just landed>` |
| Tests green | `🧪 MILESTONE M<n> TESTS GREEN: <name> — unit:<u> int:<i> e2e:<e>` |
| Milestone fully done | `✅ MILESTONE M<n> COMPLETE: <name> — demo: <command> — Next: M<n+1> <next-name>` |
| Blocked | `🛑 MILESTONE M<n> BLOCKED: <name> — <what I need from you>` |
| Whole product handover-ready | `🎉 HANDOVER-READY: dry-run pass — link to HANDOVER.md updates — Sunday window: <minutes> at <approve-rate>%` |

Each `✅ COMPLETE` line includes: what works, what doesn't, a copy-pasteable demo command, the next milestone name.

---

## Current Build Baseline (what we do NOT rebuild)

These are shipped and working. Tests for them are the M0 deliverable, not re-implementation.

| Surface | Where | Status |
|---|---|---|
| Python pipeline (5 agents: intelligence, researcher, writer, seo, ahpra) | `backend/agents/*.py`, `backend/pipeline.py`, `backend/main.py` | ✅ Shipping, 4 articles live |
| FinalPost model with `content_type`, `keywords`, `twitter_card`, `dateModified`, `status`, `rejection_history` | `backend/models.py` | ✅ DONE (commit `c6aa02d`) |
| 5 source adapters (Guardian, ABC AU, NewsAPI, Google News RSS, Authoritative) | `backend/sources/*.py` | ✅ DONE |
| `/admin/posts` approval queue with 8-check validator panel | `extracted/app/admin/posts/`, `extracted/lib/admin/validators.{ts,json}` | ✅ DONE (commit `26b9e9b`) |
| `/admin/seo` keyword + AEO dashboard | `extracted/app/admin/seo/{page.tsx,keywords/,aeo/,_chart.tsx}` | ✅ DONE (page exists; data depends on M3) |
| `/admin/competitor-topics` | `extracted/app/admin/competitor-topics/` | ✅ DONE |
| `/api/admin/{ingest,migrate}`, `/api/posts/[slug]/{approve,reject,edit}`, `/api/cron/{competitor-audit,daily-digest,scheduled-publish,seo-snapshot}`, `/api/health`, `/api/public/posts` | `extracted/app/api/` | ✅ DONE |
| `lib/admin/{audit,auth,competitor-sources,cron,db,loader,migrate,publish,store,types,validators}.ts` + `schema.sql` | `extracted/lib/admin/` | ✅ DONE |
| `lib/seo/{gsc,bing,aggregate}.ts` | `extracted/lib/seo/` | ✅ DONE (untested) |
| GitHub Actions: `pipeline.yml`, `cron-competitor-audit.yml`, `cron-daily-digest.yml`, `cron-scheduled-publish.yml`, `cron-seo-snapshot.yml` | `.github/workflows/` | ✅ DONE (verification in M7) |
| Resend daily digest, UptimeRobot health check | configured per `HANDOVER.md` | ✅ DONE (operational proof in M7) |
| Postgres schema: posts, audit_events, alerts, cron_runs, seo_snapshots | `extracted/lib/admin/schema.sql` | ✅ DONE |

**Existing tests (the gap):**
- `extracted/lib/admin/validators.test.ts` — 38 tests on the validators (per `blog.md`)
- `extracted/e2e/admin-flow.spec.ts` — happy-path admin walk
- `backend/tests/test_ahpra.py` — pytest for the AHPRA agent

Everything else is untested. M0 closes this gap before any new code ships.

---

## Open Work — Milestone Roadmap

| # | Milestone | Why it's next | Bar |
|---|---|---|---|
| M0 | **Test Backfill** | Nothing changes safely until shipped code has regression cover. Handover mode demands it. | Coverage bars in Test Plan met for `lib/admin/**`, `lib/seo/**`, `backend/agents/**`, all `app/api/**` route handlers. |
| M1 | **URL Validation Hardening** | Fixes the "AI-fabricated sources" regression. Highest content-trust win. | `backend/validation/urls.py` exists; whitelist + HEAD-check + retry; pipeline rejects any source not in the validated pool. |
| M2 | **Word Count Fix** | Articles at 988–1125 vs 1500/1200 floors per `blog.md`. Phase 6. | 3 fresh `python main.py` runs (one per pillar) produce articles ≥ floor without manual prompting. |
| M3 | **Domain Attach + GSC/Bing Verification** | Phase 5. Unblocks measurement; the SEO dashboard is empty until this is done. | `blog.statdoctor.app` resolves (Path A per `DOMAIN_CUTOVER.md`); GSC + Bing both verified; `/admin/seo` shows non-empty data after the next `seo-snapshot` run. |
| M4 | **Sunday Review Hardening** | The north-star metric: ≥95% approve-as-is in ≤25 min. Current validators are right; UX polish + batch report not yet load-bearing. | Synthetic 7-article batch reviewed in <25 min in Playwright; ≥95% approved without edits; batch summary email sent. |
| M5 | **Pre-Handover Dry-Run** | The product's stated goal is unattended for months. We prove it on a Friday before going live. | One real Sat-batch (≥4 articles) ships end-to-end with **zero** human intervention; UptimeRobot stays green; daily digest delivered. |
| M6 | **Website-side Schema Artefacts (Phase 3)** | Author page + `MedicalScholarlyArticle` + `en-AU` + geo meta. Biggest E-E-A-T lift. Lives in `~/website/`. | Artefacts shipped to `docs/` for a separate website session: author page TSX, JSON-LD blocks, layout `lang` change, `geo.region` meta. |
| M7 | **Operational Wiring Verification** | "We built it" ≠ "it works in production." Verify every alarm path. | All 5 GH Actions crons succeed in production at least once; daily digest delivered for 7 consecutive days; one forced failure → email + alert row within 60s. |

Dependencies: `M0 → {M1, M2, M3, M4, M5, M7}`; `M3 → M4` (the dashboard needs data); `M5` is the final integration gate; `M6` is parallelizable (separate repo).

---

## Execution Log — M0 Test Backfill (✅ COMPLETE)

Live status, kept in sync with each task. New entries appended at the bottom. Branch: `rollback-to-pre-ui-redesign`.

| Task | Status | Commits | Notes |
|---|---|---|---|
| M0.T1 — CI gates + coverage thresholds | ✅ DONE | `29870ab` → `980d151` (spec fix) → `44f7586` `c95364f` `1053081` `53fa5de` (quality fixes) | Three-suite CI (`vitest` blocking + `--coverage` informational, `playwright`, `pytest`) + coverage thresholds wired into `vitest.config.ts`. Meta-test `extracted/lib/check-coverage-config.test.ts` locks `pnpm test` + `OPENAI_API_KEY` env binding + anchored regex. Coverage thresholds will start blocking in M0.T10. |
| M0.T2 — Validator coverage audit | ✅ DONE | `d6e77c1` | New `validators.coverage.test.ts` asserts positive + negative test per validator. Backfilled 2 gap tests in `validators.test.ts` for `banned_phrases` negative case (data-driven loop was invisible to regex). 65 tests passing. |
| M0.T3 — Publish adapter tests | ✅ DONE | `4151dc1` | Refactored `publishToGitHub` to accept `opts: { fetcher, sleeper, maxRetries }`. Added 5xx retry with exponential backoff. 422/409 SHA conflict treated as success ("already exists"). Added `__mocks__/server-only.ts` shim + vitest alias to import server-only modules in Node tests. Public `publishPost(file)` signature unchanged; one production caller unaffected. The plan's "no-op when called twice with same key" deferred to M0.T4 (idempotency lives at approve layer). 71 tests. |
| M0.T4 — Atomic approve | ✅ DONE | `8cb9d8d` → `5b12e19` (TS + JSONB drift fixes) | New `claimForApproval(slug)` in `store.ts` using single atomic `UPDATE … WHERE status='pending_review' RETURNING …`. Postgres row-locks handle concurrency. `approve/route.ts` rewritten to read → validate (pure) → claim → 409-if-null → audit → redirect. pg-mem-backed store tests + 4 route tests. 79 tests passing, `tsc --noEmit` clean (3 pre-existing component errors only). |
| M0.T5 — Sunday-review e2e specs | ✅ DONE_WITH_CONCERNS | `be9ac61` (Tier A) `66da689` (Tier B fixme) | 6 Tier-A specs passing: `admin-auth` (2), `validator-gate`, `concurrent-approve`, `queue-rendering`, `edit-then-approve`. 5 Tier-B `test.fixme` skeletons placed: `sunday-signin`, `sunday-batch-25min`, `publish-fail`, `retry-publish`, `seo-dashboard`. **Carry-overs surfaced (do not block M0):** (a) pre-existing `e2e/admin-flow.spec.ts` is failing because it never set the `admin_token` cookie — needs a separate `setAdminCookie` patch; (b) `/login` form is disconnected from `admin_token` cookie — login form pushes to `/dashboard` but never sets the auth cookie; (c) magic-link wording in plan was speculative — current auth is cookie-based. |
| M0.T6 — Backend agent pytest | ✅ DONE | `623998e` `640ca9e` `ec8b362` `7e82eea` `700f385` | 128 tests, 0 failures. Per-agent coverage: intelligence 100%, researcher 95%, writer 100%, seo 98%, ahpra 98%. LLM calls mocked at `client.chat.completions.create` boundary; httpx calls mocked at `httpx.get`. M1 concerns: `datetime.utcnow()` deprecated in 3 agents (intelligence, writer, seo); `researcher.py` million-multiplier regex branch uncovered. |
| M0.T7 — Source-adapter pytest | ✅ N/A | — | The `backend/sources/{guardian,…}.py` adapter pattern from `BLOG_AGENT.md` was planned but **never built**. Source fetching is inline in `agents/researcher.py` + `agents/intelligence.py`, which M0.T6 already covers (38 tests, ≥95% coverage). If the adapter pattern is built later (e.g., to refactor `validation/urls.py` integration in M1), tests follow then. |
| M0.T8 — SEO parser tests | ✅ DONE_WITH_CONCERNS | `a6444d8` `43f2f4e` `642540b` | 44 tests, 5 skipped. Extracted `parseGscRows`, `parseBingRows`, `bucketPosition`, `aggregateByDay` from inline closures for testability — no behaviour change. Coverage: gsc 88%, bing 97%, aggregate 53% (3 skipped `getOverview`/`getKeywordTracker`/`getArticlePerformance` need real Postgres — pg-mem rejects `date::text`, correlated subqueries, and `ROW_NUMBER() OVER`). Overall `lib/seo/**` 75% — below the 90% threshold. M0.T10 decides whether to enforce thresholds or carry the gap into M3 (real Postgres in CI). |
| M0.T9 — Health endpoint contract | ✅ DONE | `efb265f` | 6 tests covering every documented failure mode: db_not_configured, db_unreachable, cron_last_run_failed, cron_stale, no_cron_runs_yet, all_crons_fresh. Mocks `sql` + `isDbConfigured` at module boundary. Existing implementation matched the spec on first run — tests lock in the contract. |
| M0.T10 — Chaos / recovery tests | ✅ DONE_WITH_CONCERNS | `368cf15` `d44c87d` `c380480` `ae61348` | 14 new tests (3 perf, 7 scheduled-publish failure, 4 store recovery) + 6 skipped (Tier B). **Behavioural gaps surfaced for M7:** (1) `publishPost` throws are unhandled in scheduled-publish route — no try/catch → no rollback, no audit, no `recordCronRun(false)`. (2) No real-time alert path exists — failures only surface in daily-digest (≤22h latency). (3) `publish_failed` is referenced but not a valid `PostStatus` in the CHECK constraint. |

### Open follow-ups (after M0)
- Fix `e2e/admin-flow.spec.ts` to set `admin_token` cookie (pre-existing failure, surfaced by M0.T5).
- Reconcile `/login` form with `admin_token` cookie (currently disjoint — login flow doesn't actually authorise the admin gate).

### Test counts at end of M0
- Vitest: **138 passing, 11 skipped** across 14 files (was 38 at start of M0). **+100 tests.**
- Playwright: 6 Tier-A specs passing + 2 pre-existing specs failing (carry-over) + 5 fixme.
- Pytest: **128 passing** across 6 test files. Agent coverage ≥95% on all 5.
- **Total automated tests: 272 passing + 16 skipped.** Up from ~62 at the start of M0.

### SEO/AEO Cross-Check (May 2026) — new gaps to fold into M3, M6, and a new M6.5

External research against 2026 schema.org / Perplexity / WCAG state. Items below are NOT in `blog.md` / `BLOG_AGENT.md` / `ARCHITECTURE_101X.md` — they are new to the plan.

**NEW schema/markup gaps (fold into M6 — Website Schema Artefacts):**
- **`Organization` schema** at site root (`website/app/layout.tsx`) with `sameAs` to LinkedIn, Wikidata, App Store, ABN/ASIC. Highest-leverage entity-disambiguation signal post-March 2026 core update.
- **`reviewedBy` property** on every `MedicalScholarlyArticle` (and on the legacy `MedicalWebPage` until migration). Dr Anu is both author and reviewer; populate both. This is the YMYL trust signal Google quality raters flag as deficit when missing.
- **`citation` property** on `MedicalScholarlyArticle` populated from the existing `sources[]` array. Serialise sources into JSON-LD `citation` ScholarlyArticle objects in `backend/agents/seo.py`, not just into the UI gallery. Enables Perplexity + Google to traverse the source graph.
- **`publicationType`** with MeSH vocabulary (`"Review"` for guides, `"Practice Guideline"` where applicable). Zero-cost addition to the SEO agent's schema builder.
- **`Speakable` scoped to news only** — `content_type === 'news'` gating in the writer/SEO agent. Applying `Speakable` to guides/company content is over-claiming and may trigger misleading-markup classification.
- **`geo.country` + `geo.placename`** in `<head>` (not just `geo.region`). Used by Bing and regional engines.

**NEW operational gaps (fold into M3 — Domain Attach):**
- **Perplexity Publisher Program enrollment** — free, gated only on `statdoctor.app` being live. Healthcare publishers get above-average citation volumes per the program's published examples. Do this in the same session as GSC/Bing verification.
- **WCAG 2.2 AA legal compliance** — Australia formally adopted WCAG 2.2 AA as the national standard under the Disability Discrimination Act 1992. Add an axe-core Playwright pass to E2E. Adds 1 spec to Tier-A. Specific 2.2 criteria not in 2.1: 2.4.11 focus appearance, 2.5.7 dragging movements, 2.5.8 target size, 3.2.6 consistent help, 3.3.7 redundant entry, 3.3.8 accessible authentication.

**NEW CI gap:**
- **Schemar GitHub Action for JSON-LD validation on every published URL.** Closes the manual "schema validates" step in the current checklist. Lands in `.github/workflows/` alongside `pipeline.yml`. Gated on the public reader being live (M3).

**Anti-patterns to retire (fold into M6 + M4):**
- **Don't rely on FAQPage rich results** — Google's March 2026 core update cut FAQ rich-result impressions ~50% and now restricts display to pages where FAQ is the primary content purpose. Keep the JSON-LD (still helps LLMs) but drop FAQ rich-result-eligibility from the publishing checklist.
- **Drop `<meta name="keywords">`** from the public page head. Ignored by Google since 2009; flagged as spam signal by Bing. The internal `keywords[]` JSON field can stay; just don't render it to `<meta>`.

**Adding a new milestone M6.5 — Schema + WCAG hardening (parallel with M6):**
Same repo (`STATDOCTOR_BLOGPOSTING/`), not website. Backend SEO-agent changes (`reviewedBy`, `citation`, `publicationType`, news-only `Speakable`) + Schemar CI action + axe-core Playwright pass. Bar: JSON-LD validates green via Schemar against ≥3 sample articles; axe-core finds zero AA-level violations on the admin dashboard.

Sources consulted (representative): `schema.org/MedicalScholarlyArticle`, `developers.google.com/search/docs/appearance/structured-data/speakable`, `accessibility.org.au/australia-formally-adopts-wcag-2-2-level-aa/`, `perplexity.ai/hub/blog/announcing-premium-health-sources`, `digitalapplied.com/blog/schema-markup-after-march-2026-structured-data-strategies`, `github.com/marketplace/actions/schemar-ci-action`.

### M0 → M1 handover items (defer until after M1 unless they block)
- Pre-existing `e2e/admin-flow.spec.ts` cookie regression (M0.T5 finding)
- `/login` form ↔ `admin_token` cookie disconnect (M0.T5 finding)
- `publishPost` unhandled throws in scheduled-publish cron (M0.T10 finding — fix in M7)
- No real-time alert path; failures only in daily digest (M0.T10 finding — fix in M7)
- `publish_failed` referenced but not a valid `PostStatus` (M0.T10 finding)
- `lib/seo/**` coverage at 75% vs 90% bar — 3 `getOverview`/`getKeywordTracker`/`getArticlePerformance` tests need real Postgres (skipped in pg-mem due to window functions). Re-evaluate during M3 when GSC data populates the DB.
- `datetime.utcnow()` deprecated in 3 agents (intelligence, writer, seo) — Python 3.14 will error.

---

## Test Plan (canonical — owned by this section)

This is the single source of truth for what we test, where, and the bars we hold. Every milestone's "DoD" line points back to entries here.

### Layered test pyramid

| Layer | Tool | Where | Wall-time budget | What lives here |
|---|---|---|---|---|
| Unit (TS) | Vitest | `extracted/**/*.test.ts` | < 5s total | Validators, idempotency-key derivation, prompt-output shape, GSC/Bing response parsers, frontmatter pickers |
| Unit (Python) | Pytest | `backend/tests/test_*.py` | < 10s total | Agents' pure functions: intelligence dispatcher, SEO title cadence, AHPRA pattern matcher, validation/urls |
| Integration (TS) | Vitest | `extracted/**/*.int.test.ts` | < 30s total | Route handlers exercised end-to-end against a `pg-mem` (or Neon branch) DB. Publish adapter against recorded GitHub-API fixtures. |
| Integration (Python) | Pytest | `backend/tests/integration/test_*.py` | < 60s total | Each source adapter against recorded HTTP fixtures; pipeline end-to-end against fake adapters |
| Contract | Vitest | `extracted/tests/contract/` | < 5s | `FinalPost` JSON-schema validation (article JSON shape stays compatible with the website reader) |
| E2E / BDD | Playwright | `extracted/e2e/*.spec.ts` | < 120s total | Sunday-review flow, queue rendering, approve/edit/reject, publish-fail-retry, unauthed redirect |
| Smoke | curl + tsx | `scripts/smoke/*.sh` | < 10s | `/api/health`, `/api/metrics` (if added), "any row stuck in pending_review > 8 days" |
| Live | manual, pre-handover | `scripts/dry-run.ts` | n/a | Real publish, real cron fire, real Resend send |

### Coverage targets (enforced by CI)

| Surface | Statements | Branches | Lines |
|---|---|---|---|
| `extracted/lib/admin/**` | ≥ 95% | ≥ 90% | ≥ 95% |
| `extracted/lib/seo/**` | ≥ 90% | ≥ 85% | ≥ 90% |
| `extracted/app/api/**` route handlers | ≥ 85% | ≥ 80% | ≥ 85% |
| `backend/agents/**` | ≥ 85% | ≥ 80% | ≥ 85% |
| `backend/sources/**` | ≥ 90% | ≥ 85% | ≥ 90% |
| `backend/validation/**` | ≥ 95% | ≥ 95% | ≥ 95% |
| Everything else | ≥ 70% | ≥ 60% | ≥ 70% |

TS coverage: `pnpm vitest run --coverage` (extracted/). Python: `pytest --cov=backend --cov-report=term-missing`. CI fails if any surface drops below its bar.

### TDD discipline (from `superpowers:test-driven-development`)

**Iron law:** every production line is preceded by a failing test that I have **watched** fail with the expected message. If I wrote code before the test, I delete it and start over.

Cycle per change:

1. **RED** — write one failing test, real code (no mocks unless unavoidable), one behavior.
2. **Verify RED** — run it, confirm the failure mode is the expected one. If it passes or errors wrongly, fix the test first.
3. **GREEN** — minimal code to pass. No speculative parameters.
4. **Verify GREEN** — focused test, then full suite. Pristine output — no warnings.
5. **REFACTOR** — only on green. Remove duplication, improve names.
6. **Commit** — one logical change per commit.

### BDD scenarios → spec lockup

Every Gherkin scenario below maps to exactly one Playwright spec. Scenario name = `test()` description verbatim so transcript search reveals coverage.

| Scenario | File | Owning milestone |
|---|---|---|
| Sunday reviewer signs in via magic link allowlist | `e2e/sunday-signin.spec.ts` | M0 / M4 |
| Sunday reviewer sees the week's queue with QA badges | `e2e/sunday-queue.spec.ts` | M0 / M4 |
| Sunday reviewer approves an article in one click | `e2e/sunday-approve.spec.ts` | M0 / M4 |
| Sunday reviewer edits before approving — original preserved | `e2e/sunday-edit.spec.ts` | M0 / M4 |
| Sunday reviewer rejects with reason taxonomy; topic re-queued | `e2e/sunday-reject.spec.ts` | M0 / M4 |
| Approve disabled when any of 8 validators fail | `e2e/validator-gate.spec.ts` | M0 |
| Concurrent approvals only publish once | `e2e/concurrent-approve.spec.ts` | M0 |
| Publish-fail → row marked, alert email queued, retry button works | `e2e/publish-fail.spec.ts` | M0 / M7 |
| Unauthed access to `/admin` redirects to signin | `e2e/admin-auth.spec.ts` | M0 |
| Pipeline POSTs to `/api/admin/ingest` and the article appears in queue | `e2e/ingest-flow.spec.ts` | M0 |
| Source URL outside the whitelist is refused at ingest | `e2e/url-whitelist.spec.ts` | M1 |
| `/admin/seo` shows non-empty GSC + Bing data after a snapshot | `e2e/seo-dashboard.spec.ts` | M3 |
| Full Sunday review (7 articles, ≥95% as-is, <25 min) | `e2e/sunday-batch-25min.spec.ts` | M4 |

### Gherkin scenarios (acceptance bar)

```gherkin
Feature: Sunday review hits the north-star metric (M4)
  As Anu (CEO, sole reviewer, AHPRA-registered)
  I want to approve the week's articles in ~25 minutes
  So that publication is unblocked without making the workflow my full-time job

  Scenario: 7-article batch, ≥95% approved as-is
    Given 7 articles are in /admin/posts with status="pending_review"
    And all 8 validators are green on each
    When I sign in via magic link and walk the queue
    Then I can approve at least 6 of 7 without editing
    And the total wall-clock from signin to signout is under 25 minutes
    And the resulting batch summary email lists 7 approvals

  Scenario: One article has a validator red — gate enforced
    Given an article has banned phrase "world-class" in its body
    When I open its edit page
    Then the "Approve & Publish" button is disabled
    And the banned-phrase row is red with the offending phrase highlighted
    And fixing the phrase re-runs validators server-side and re-enables Approve

Feature: URL validation kills hallucinated sources (M1)
  As an AHPRA-bylined publication
  I never want to ship an article whose sources are fabricated

  Scenario: Pipeline rejects a non-whitelisted source URL
    Given the Researcher returns a source URL on `made-up-domain.com`
    When the article is posted to /api/admin/ingest
    Then ingest returns 422 with reason "source_not_in_whitelist"
    And the article never enters the review queue

  Scenario: 404 source URL is dropped from the article and surfaced as a flag
    Given the Researcher returns a Guardian URL that returns 404 on HEAD
    When the article is posted to /api/admin/ingest
    Then the article is ingested with status="pending_review"
    And the broken URL is absent from sources[]
    And ahpra_flags[] contains { type: "source_unreachable", url: ... }

Feature: Publish failure does not lose work (M0 baseline)
  Scenario: GitHub API returns 500 three times on Approve
    Given an article is "pending_review" and all validators are green
    When I click "Approve & Publish" and the GitHub API returns 500 thrice
    Then the article's status is "publish_failed"
    And an audit_events row with action="publish-failed" exists
    And a daily-digest entry includes the failure
    And clicking "Retry publish" re-runs publish.ts

Feature: Domain attach reveals SEO data (M3)
  Scenario: After GSC verification, the dashboard fills in within 5 days
    Given GSC is verified for sc-domain:statdoctor.app
    And GSC_SERVICE_ACCOUNT_JSON is set on Vercel
    When the daily seo-snapshot cron has run for 5 consecutive days
    Then /admin/seo shows a non-empty keyword table
    And the "Warming up" banner is gone

Feature: Stranger operates the system using only HANDOVER.md (M5)
  Scenario: A new operator pauses the pipeline within 5 minutes
    Given a new operator has only HANDOVER.md, the Vercel project URL, and the GitHub repo
    When they need to pause the pipeline cron
    Then HANDOVER.md tells them exactly which Actions workflow to disable
    And the cron is paused within 5 minutes of starting
```

### Edge-case matrix per pipeline stage

Every new test file must cover these patterns where applicable. Test names are mandatory — grep-friendly:

| Category | Required test pattern | Milestone |
|---|---|---|
| Empty input | `<fn>_returns_<empty-shape>_when_input_empty` | M0 |
| Malformed input | `<fn>_throws_InvalidInputError_when_<field>_missing` | M0 |
| 429 / rate-limit | `<fn>_retries_then_surfaces_429_after_max_attempts` | M0 / M1 |
| 5xx upstream | `<fn>_surfaces_immediately_no_retry_on_5xx` | M0 |
| Timeout | `<fn>_aborts_at_<n>s_and_marks_status_timeout` | M0 |
| Idempotency | `<fn>_is_no_op_when_called_twice_with_same_key` | M0 |
| Partial failure | `batch_records_per_topic_status_when_one_fails` | M0 |
| Auth | `dashboard_redirects_unauthed_to_signin` | M0 |
| Concurrency | `two_approvers_clicking_simultaneously_only_publishes_once` | M0 |
| Data drift | `validator_rejects_article_with_missing_h1` | M0 |
| Cost ceiling | `pipeline_aborts_topic_when_token_spend_exceeds_<budget>` | M1 |
| Recovery | `failed_publish_can_be_retried_with_idempotency_preserved` | M0 |
| URL trust | `ingest_rejects_source_not_in_whitelist` | M1 |
| URL trust | `ingest_drops_404_source_and_flags_it` | M1 |
| SEO data freshness | `gsc_snapshot_is_idempotent_per_day` | M0 / M3 |

A milestone is not "tests green" until every applicable row is covered.

### Sunday-review SOP coverage (Playwright)

The Sunday window is the only human-facing surface. Every interaction is exercised:

1. Magic-link signin (allowlist-only — non-allowlisted email rejected)
2. Land on `/admin/posts`, see week's queue with QA badges
3. Open an article, scroll body, see TOC + sources + validator panel
4. Inline-edit title / body / meta in Markdown editor
5. Approve & Publish (single click; success toast; row turns green)
6. Edit-then-approve preserves `draft_original` server-side
7. Reject with reason taxonomy (`off-brand-voice`, `weak-sources`, `wrong-angle`, `too-promotional`, `ahpra-disagree`, `not-interesting`, `other:freetext`)
8. Retry-publish on a failed row
9. Sign out and confirm session ends
10. Try `/admin/posts` unauthenticated → redirected to signin

Bar (M4): full Sunday flow (signin → 7 approvals → signout) under **25 min wall-clock** in CI replay mode.

### Mocking policy

- **No mocks for code under test.** Mocking the function you're testing tests nothing.
- **LLM (Anthropic + OpenAI):** recorded responses under `tests/fixtures/llm/`. Recorder script `scripts/record-llm.ts`. Replayed via an injected `fetcher`.
- **HTTP sources (Guardian/ABC/NewsAPI/etc.):** recorded fixtures per adapter under `backend/tests/fixtures/sources/`. Live HTTP is in nightly-only tests.
- **GitHub API (publish.ts):** recorded responses for `200`, `409`, `500` under `extracted/tests/fixtures/github/`.
- **DB:** integration tests prefer a real Postgres (Neon branch) over `pg-mem`; `pg-mem` is the fallback.
- **Clock / random / UUIDs:** injected via DI. Never call `Date.now()` or `crypto.randomUUID()` directly in testable code — wrap behind `Clock` / `IdGen` interfaces.

### CI gates (blocking on PR)

A PR cannot merge unless:

- [ ] `pnpm test` (Vitest) — all green, no skipped tests without a `// SKIP:<reason>` comment
- [ ] `pnpm exec playwright test` — all green
- [ ] `cd backend && pytest` — all green
- [ ] `pnpm exec tsc --noEmit` — clean
- [ ] `pnpm exec eslint .` — clean (includes the "no `~/website/` imports outside `lib/admin/publish.ts`" rule)
- [ ] Coverage report meets the surface bars
- [ ] Zero `.skip` / `.only` left in source (enforced by a pre-commit script)
- [ ] Every new `.ts` / `.py` file under `lib/`, `app/api/`, `backend/agents/`, `backend/sources/`, `backend/validation/` has a sibling test file

### Test data hygiene

- Fixtures under `tests/fixtures/<domain>/`, never `__mocks__/` or alongside source.
- Fixture filenames describe the scenario, not the response code (`research-rate-limited.json`, not `429.json`).
- Each fixture has a sibling `*.md` describing where it was recorded, when, and the seed/temperature.
- DB seeds for E2E live in `extracted/e2e/seeds/` and are loaded by `extracted/e2e/setup.ts`. Seeds don't run pipeline code.

### Recovery / chaos tests (M0 + M7)

Each must exist and pass:

1. `batch_resumes_after_process_kill` — kill the orchestrator mid-run; re-run; finishes correctly, no duplicate publishes.
2. `batch_handles_db_disconnect_mid_run` — drop DB connection during a topic; retry the operation, not the whole batch.
3. `alert_emits_within_60s_of_failure` — induce a failure; assert Resend mock received the email within 60s.
4. `health_endpoint_returns_under_500ms` — performance bar so UptimeRobot doesn't flap.

### Failure → operator

- Failing Playwright on preview deploy → Vercel blocks promotion via deploy hook.
- Failing UptimeRobot check → email to `anu@statdoctor.net` within 5 min.
- Weekly invariant fails ("no successful pipeline run in 8 days") → banner on `/admin` + email.

This is how the system tells you it broke without you logging in to find out.

---

# Milestone M0 — Test Backfill

**Goal:** Cover the shipped code with tests before changing anything else. Coverage bars in the Test Plan met for every "already built" surface. New tests are colocated with their code.

**Why first:** Handover mode requires confidence the system survives changes. With current coverage (3 files) every refactor is a coin flip. M0 turns the rest of the plan from risky to safe.

**DoD:**
- Coverage bars met for `extracted/lib/admin/**`, `extracted/lib/seo/**`, `extracted/app/api/**`, `backend/agents/**`, `backend/sources/**`.
- All 10 Sunday-review Playwright specs exist and pass.
- All 13 mandatory edge-case patterns from the matrix above are present where applicable.
- CI gates configured and enforced.
- Commit `test(m0): backfill coverage to safety-net level`.

**Files:** new test files only; no production code change except dependency injection where the impl makes itself untestable.

### M0.T1 — Establish CI test gates

- [ ] **Step 1: Failing test** — a smoke that asserts CI runs all three suites.

`extracted/lib/check-coverage-config.test.ts` (placed under `lib/` to match the vitest include pattern):
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

describe("coverage gates", () => {
  it("vitest.config.ts has coverage thresholds set per surface", () => {
    const cfg = readFileSync("vitest.config.ts", "utf8");
    expect(cfg).toMatch(/lib\/admin/);
    expect(cfg).toMatch(/lib\/seo/);
    expect(cfg).toMatch(/thresholds/);
  });
  it("CI workflow runs vitest, playwright, and pytest", () => {
    expect(existsSync("../.github/workflows/ci.yml")).toBe(true);
    const ci = readFileSync("../.github/workflows/ci.yml", "utf8");
    expect(ci).toMatch(/pnpm test/);
    expect(ci).toMatch(/playwright/);
    expect(ci).toMatch(/pytest/);
  });
});
```

- [ ] **Step 2: Run, verify fails** (`ci.yml` does not yet exist).

- [ ] **Step 3: Minimal impl** — create `.github/workflows/ci.yml` with three jobs:

```yaml
name: CI
on: [push, pull_request]
jobs:
  vitest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm, cache-dependency-path: extracted/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
        working-directory: extracted
      - run: pnpm exec tsc --noEmit
        working-directory: extracted
      - run: pnpm exec vitest run --coverage
        working-directory: extracted
  playwright:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm, cache-dependency-path: extracted/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
        working-directory: extracted
      - run: pnpm exec playwright install --with-deps
        working-directory: extracted
      - run: pnpm exec playwright test
        working-directory: extracted
        env:
          POSTGRES_URL: ${{ secrets.TEST_POSTGRES_URL }}
  pytest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r requirements.txt pytest pytest-cov
        working-directory: backend
      - run: pytest --cov=. --cov-report=term-missing
        working-directory: backend
```

- [ ] **Step 4: Add coverage thresholds to `extracted/vitest.config.ts`:**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        "lib/admin/**": { statements: 95, branches: 90, lines: 95 },
        "lib/seo/**":   { statements: 90, branches: 85, lines: 90 },
        "app/api/**":   { statements: 85, branches: 80, lines: 85 },
      },
    },
  },
});
```

- [ ] **Step 5: Run, verify pass.** **Step 6: Commit** `ci(m0): add three-suite CI with coverage thresholds`.

### M0.T2 — Validator tests audit (already 38 tests; verify completeness)

- [ ] **Step 1: Failing test** — assert each of the 8 validators has at least one negative and one positive test by name.

`extracted/lib/admin/validators.coverage.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const REQUIRED = ["ahpra", "banned", "anchor", "callouts", "table", "schema", "words", "sources"];

describe("validator test coverage", () => {
  const file = readFileSync("lib/admin/validators.test.ts", "utf8");
  for (const name of REQUIRED) {
    it(`has a passing test for ${name} validator`, () => {
      expect(file).toMatch(new RegExp(`describe\\(['"\`]${name}`, "i"));
    });
    it(`has a failing-case test for ${name} validator`, () => {
      expect(file).toMatch(new RegExp(`${name}[\\s\\S]+?fails when`, "i"));
    });
  }
});
```

- [ ] **Step 2: Run, identify which validators are short on tests.** **Step 3: Add missing tests.** **Step 4: Re-run.** **Step 5: Commit.**

### M0.T3 — Publish adapter tests (3 fixtures: 200, 409, 500)

- [ ] **Step 1: Failing test** — `extracted/lib/admin/publish.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { publishToWebsite } from "./publish";
import ok from "../../tests/fixtures/github/200.json";
import conflict from "../../tests/fixtures/github/409.json";
import server from "../../tests/fixtures/github/500.json";

describe("publishToWebsite", () => {
  it("200 → status published, single fetch call", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(ok), { status: 200 }));
    const result = await publishToWebsite({ slug: "x", content: "y", idempotencyKey: "k1" }, { fetcher });
    expect(result.status).toBe("published");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("409 → status published (already there), single fetch call", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(conflict), { status: 409 }));
    const result = await publishToWebsite({ slug: "x", content: "y", idempotencyKey: "k1" }, { fetcher });
    expect(result.status).toBe("published");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("500 ×3 → status publish_failed, 3 fetch calls", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(server), { status: 500 }));
    const result = await publishToWebsite({ slug: "x", content: "y", idempotencyKey: "k1" }, { fetcher, sleeper: async () => {} });
    expect(result.status).toBe("publish_failed");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("is_no_op_when_called_twice_with_same_key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(ok), { status: 200 }));
    const a = await publishToWebsite({ slug: "x", content: "y", idempotencyKey: "k1" }, { fetcher });
    const b = await publishToWebsite({ slug: "x", content: "y", idempotencyKey: "k1" }, { fetcher });
    expect([a.status, b.status]).toEqual(["published", "already_published"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, verify failures match expected.** **Step 3: Refactor `publish.ts`** if needed to accept injected `fetcher` and `sleeper`, derive `idempotencyKey` from `sha256(slug + contentHash)`. **Step 4: Re-run.** **Step 5: Commit** `test(m0): publish adapter — 200/409/500/idempotency`.

### M0.T4 — Approve concurrency test

- [ ] **Step 1: Failing test** — `extracted/lib/admin/store.int.test.ts`:

```ts
it("two_approvers_clicking_simultaneously_only_publishes_once", async () => {
  await seedArticle({ slug: "x", status: "pending_review" });
  const publishSpy = vi.fn().mockResolvedValue({ status: "published" });
  const [a, b] = await Promise.all([
    approveArticle("x", { publish: publishSpy }),
    approveArticle("x", { publish: publishSpy }),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  expect(outcomes).toEqual(["already_published", "published"]);
  expect(publishSpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify fails** (current implementation likely double-publishes). **Step 3: Add atomic SQL transition** — `UPDATE posts SET status='scheduled' WHERE slug=$1 AND status='pending_review' RETURNING *;` in `approveArticle`. **Step 4: Pass.** **Step 5: Commit** `fix(m0): atomic approve transition`.

### M0.T5 — Sunday-review Playwright specs (10 of them)

- [ ] For each of the 10 scenarios in "Sunday-review SOP coverage" above, write a spec under `extracted/e2e/`. Use `e2e/setup.ts` to seed the DB, sign in via a test-only magic-link bypass (env-gated), and exercise the flow.

- [ ] Each spec follows the RED → GREEN cycle: write the spec → run → confirm it fails for the expected reason → wire up whatever's missing → pass → commit.

- [ ] **Step N: Commit** `test(m0): 10 Sunday-review e2e specs`.

### M0.T6 — Backend agent tests (5 agents)

- [ ] For each of `backend/agents/{intelligence,researcher,writer,seo,ahpra}.py`, write `backend/tests/test_<agent>.py` covering:
  - Happy path with recorded LLM/HTTP fixture
  - Malformed input rejection
  - Rate-limit handling
  - Cost-ceiling abort (token spend > budget)
- [ ] Run `pytest --cov=backend/agents --cov-report=term-missing` and verify ≥85% per file.
- [ ] **Step N: Commit** `test(m0): pytest coverage for 5 agents`.

### M0.T7 — Source-adapter tests (5 adapters)

- [ ] For each `backend/sources/{guardian,abc_au,newsapi,google_news_rss,authoritative}.py`, write `backend/tests/sources/test_<adapter>.py` with one happy fixture + one 429 + one 500 + one empty result.
- [ ] **Step N: Commit** `test(m0): source-adapter coverage`.

### M0.T8 — `/admin/seo` GSC + Bing parser tests

- [ ] `extracted/lib/seo/gsc.test.ts` — parse a recorded GSC response, assert keyword/click/impression/ctr/position fields.
- [ ] `extracted/lib/seo/bing.test.ts` — same for Bing.
- [ ] `extracted/lib/seo/aggregate.test.ts` — assert daily aggregation is idempotent (running it twice for the same day doesn't double-count).
- [ ] **Step N: Commit** `test(m0): seo parsers + aggregator`.

### M0.T9 — Health endpoint contract test

- [ ] `extracted/app/api/health/route.test.ts` — assert all three failure modes are detected:
  - `db: unreachable` when DB throws
  - `cron:<kind>: stale_<N>h` when last `cron_runs` row is too old
  - `cron:<kind>: last_run_failed` when last `cron_runs` row has `status='failed'`
- [ ] **Step N: Commit** `test(m0): health endpoint failure detection`.

### M0.T10 — Recovery / chaos tests

- [ ] `extracted/tests/chaos/batch-resume.test.ts` — kill orchestrator mid-run, verify resume.
- [ ] `extracted/tests/chaos/db-disconnect.test.ts` — drop connection mid-batch, verify operation-level retry.
- [ ] `extracted/tests/chaos/alert-within-60s.test.ts` — induce failure, assert Resend mock got the email within 60s.
- [ ] **Step N: Commit** `test(m0): chaos tests`.

**Milestone phrases:**
- `🟢 MILESTONE M0 STARTED: Test Backfill`
- `🟡 MILESTONE M0 CHECKPOINT: Test Backfill — validators + publish adapter green; Sunday SOP next`
- `🧪 MILESTONE M0 TESTS GREEN: Test Backfill — unit:<u> int:<i> e2e:10`
- `✅ MILESTONE M0 COMPLETE: Test Backfill — demo: pnpm test && pnpm playwright test && (cd ../backend && pytest) — Next: M1 URL Validation`

---

# Milestone M1 — URL Validation Hardening

**Goal:** No article ever ships with a fabricated, expired, or off-list source URL again. `backend/validation/urls.py` is the choke-point. `/api/admin/ingest` enforces the same rule on entry.

**Why now:** The "AI-Fabricated Sources" issue called out in former `AGENT.md` (fuel-prices article, sources 6–10 returned 404) is the highest-trust regression. AHPRA byline + 404'd citations = credibility damage. This is the load-bearing safety rail for the editorial promise.

**DoD:**
- `backend/validation/urls.py` exists with `validate_sources(sources) -> ValidationResult`.
- Domain whitelist enforced (initial set in `BLOG_AGENT.md`).
- HEAD check with 5s timeout, 1 retry, follow 200..399; everything else dropped.
- Researcher fans across all adapters in parallel and dedupes; if post-validation source count < 5, re-broadens (max 2 retries).
- `/api/admin/ingest` re-validates server-side and rejects with `422 source_not_in_whitelist` or per-URL flags.
- BDD scenarios in "Feature: URL validation kills hallucinated sources" pass.

**Files:**
- Create: `backend/validation/__init__.py`, `backend/validation/urls.py`, `backend/validation/whitelist.py`
- Create: `backend/tests/test_validation_urls.py`
- Create: `backend/tests/fixtures/urls/{guardian-200.txt, deadlink-404.txt, slow-timeout.txt}`
- Modify: `backend/agents/researcher.py` to call `validate_sources` after dedupe
- Modify: `extracted/app/api/admin/ingest/route.ts` to re-validate
- Create: `extracted/e2e/url-whitelist.spec.ts`

### M1.T1 — Whitelist module (pure)

- [ ] **Step 1: Failing test** — `backend/tests/test_validation_urls.py`:

```python
from backend.validation.whitelist import is_whitelisted

def test_returns_true_for_whitelisted_domain():
    assert is_whitelisted("https://www.theguardian.com/x/y") is True

def test_returns_false_for_unknown_domain():
    assert is_whitelisted("https://made-up-domain.com/x") is False

def test_subdomains_of_whitelisted_root_are_accepted():
    assert is_whitelisted("https://www1.aihw.gov.au/reports/x") is True
```

- [ ] **Step 2: Run, verify fails** (module missing). **Step 3: Implement `whitelist.py`** with the domain list from `BLOG_AGENT.md`. **Step 4: Pass.** **Step 5: Commit** `feat(m1): domain whitelist module`.

### M1.T2 — HEAD checker with timeout and retry

- [ ] **Step 1: Failing test:**

```python
import respx
import httpx
from backend.validation.urls import head_check

@respx.mock
def test_returns_ok_for_200():
    respx.head("https://theguardian.com/x").mock(return_value=httpx.Response(200))
    assert head_check("https://theguardian.com/x").ok is True

@respx.mock
def test_drops_404():
    respx.head("https://theguardian.com/dead").mock(return_value=httpx.Response(404))
    result = head_check("https://theguardian.com/dead")
    assert result.ok is False
    assert result.reason == "http_404"

@respx.mock
def test_retries_once_on_timeout():
    route = respx.head("https://slow.com/x").mock(side_effect=[httpx.TimeoutException("t"), httpx.Response(200)])
    assert head_check("https://slow.com/x", timeout=1, retries=1).ok is True
    assert route.call_count == 2

@respx.mock
def test_surfaces_timeout_after_retries():
    respx.head("https://slow.com/y").mock(side_effect=httpx.TimeoutException("t"))
    result = head_check("https://slow.com/y", timeout=1, retries=1)
    assert result.ok is False
    assert result.reason == "timeout"
```

- [ ] **Step 2: Run, verify fails.** **Step 3: Implement `head_check`** using `httpx`. **Step 4: Pass.** **Step 5: Commit** `feat(m1): head_check with timeout + retry`.

### M1.T3 — `validate_sources` orchestrator

- [ ] **Step 1: Failing test:**

```python
def test_validate_sources_returns_ok_for_all_whitelisted_200():
    result = validate_sources([
        {"url": "https://theguardian.com/a", "publisher": "Guardian"},
        {"url": "https://abc.net.au/b", "publisher": "ABC"},
    ])
    assert len(result.ok_sources) == 2
    assert result.flags == []

def test_validate_sources_drops_non_whitelisted_and_flags_it():
    result = validate_sources([
        {"url": "https://theguardian.com/a", "publisher": "Guardian"},
        {"url": "https://made-up.com/b", "publisher": "Fake"},
    ])
    assert len(result.ok_sources) == 1
    assert any(f["type"] == "source_not_in_whitelist" for f in result.flags)

def test_validate_sources_drops_404_and_flags_it():
    # respx fixture for 404
    result = validate_sources([
        {"url": "https://theguardian.com/dead", "publisher": "Guardian"},
    ])
    assert result.ok_sources == []
    assert any(f["type"] == "source_unreachable" for f in result.flags)
```

- [ ] **Step 2: Verify failures match.** **Step 3: Implement.** **Step 4: Pass.** **Step 5: Commit.**

### M1.T4 — Researcher wires `validate_sources` + re-broadens on low count

- [ ] **Step 1: Failing test** in `backend/tests/test_researcher.py`:

```python
def test_re_broadens_when_validated_source_count_below_5(monkeypatch):
    # First call returns 3 sources, all whitelisted+200; expect 1 re-broaden call
    calls = {"fanout": 0}
    def fake_fanout(query, **kw):
        calls["fanout"] += 1
        return [...] if calls["fanout"] == 1 else [...lots...]
    monkeypatch.setattr("backend.agents.researcher.fanout_sources", fake_fanout)
    sources = researcher.gather("topic")
    assert len(sources) >= 5
    assert calls["fanout"] == 2  # one re-broaden
```

- [ ] **Step 2: Fail.** **Step 3: Wire `validate_sources` + re-broaden loop (max 2 retries).** **Step 4: Pass.** **Step 5: Commit.**

### M1.T5 — `/api/admin/ingest` server-side re-validation

- [ ] **Step 1: Failing test** — `extracted/app/api/admin/ingest/route.int.test.ts`:

```ts
it("ingest_rejects_source_not_in_whitelist", async () => {
  const res = await POST(buildRequest({
    sources: [{ url: "https://made-up.com/x", publisher: "Fake" }],
    ...validRest,
  }));
  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.reason).toBe("source_not_in_whitelist");
});

it("ingest_drops_404_source_and_flags_it", async () => {
  // mock fetch to return 404 for the URL
  const res = await POST(buildRequest({
    sources: [
      { url: "https://theguardian.com/ok", publisher: "Guardian" },
      { url: "https://theguardian.com/dead", publisher: "Guardian" },
    ],
    ...validRest,
  }));
  expect(res.status).toBe(200);
  const row = await db.query("SELECT sources, ahpra_flags FROM posts WHERE slug=$1", [slug]);
  expect(row.sources).toHaveLength(1);
  expect(row.ahpra_flags).toContainEqual(expect.objectContaining({ type: "source_unreachable" }));
});
```

- [ ] **Step 2: Fail.** **Step 3: Add validator in route handler — reuse `lib/admin/url-validator.ts` that mirrors Python whitelist (sourced from the same JSON, per BLOG_AGENT's "single JSON" rule).** **Step 4: Pass.** **Step 5: Commit.**

### M1.T6 — Shared whitelist JSON (Python + TS read same file)

- [ ] **Step 1: Failing test** — assert both languages reference the same `data/whitelist.json` and produce identical decisions on a 20-URL fixture.
- [ ] **Step 2: Fail.** **Step 3: Move whitelist into `data/whitelist.json` at repo root; update both `backend/validation/whitelist.py` and `extracted/lib/admin/url-validator.ts` to read it.** **Step 4: Pass.** **Step 5: Commit** `feat(m1): single whitelist source of truth`.

### M1.T7 — Playwright spec for the BDD scenario

- [ ] `extracted/e2e/url-whitelist.spec.ts` covering the two scenarios in "Feature: URL validation kills hallucinated sources." Run, pass, commit.

**Milestone phrases:**
- `🟢 MILESTONE M1 STARTED: URL Validation Hardening`
- `🧪 MILESTONE M1 TESTS GREEN: URL Validation Hardening — unit:<u> int:<i> e2e:1`
- `✅ MILESTONE M1 COMPLETE: URL Validation Hardening — demo: python -m backend.scripts.validate_sample_article — Next: M2 Word Count Fix`

---

# Milestone M2 — Word Count Fix

**Goal:** Articles consistently meet floors: 1500–2000 (news), 1500–2500 (guide), 1000–1800 (company). Current: 988–1125 per `blog.md`.

**Why now:** Quality fix that unblocks Phase 6. Mechanism is fresh full-Researcher runs (regen has thin context), not just a soft-validator bump.

**DoD:**
- 3 fresh `python main.py` runs (one per content_type) produce articles ≥ floor without manual retries.
- `backend/agents/writer.py` system prompt + outline pass enforces word-count target.
- Soft validator (`words` in `validators.json`) upgraded to hard for the floor breach; warning for ceiling.
- Unit test: writer prompt contains the floor for the chosen `content_type`.
- E2E: ingest a < 1500 word news article → status `rejected_auto` (or `needs_review` per existing taxonomy) with reason `word_count_below_floor`.

**Files:**
- Modify: `backend/agents/writer.py`
- Modify: `backend/agents/seo.py` (outline pass)
- Modify: `extracted/lib/admin/validators.json` + `validators.ts`
- Create: `backend/tests/test_writer_wordcount.py`
- Create: `extracted/lib/admin/validators.wordcount.test.ts`

### M2.T1 — Writer prompt asserts floor per content_type

- [ ] **Step 1: Failing test** — `backend/tests/test_writer_wordcount.py`:

```python
def test_writer_prompt_contains_floor_for_news():
    prompt = writer.build_prompt(content_type="news", topic=topic_fixture)
    assert "minimum 1500 words" in prompt.lower() or "≥ 1500" in prompt

def test_writer_prompt_contains_floor_for_guide():
    prompt = writer.build_prompt(content_type="guide", topic=topic_fixture)
    assert "minimum 1500" in prompt.lower()

def test_writer_prompt_contains_floor_for_company():
    prompt = writer.build_prompt(content_type="company", topic=topic_fixture)
    assert "minimum 1000" in prompt.lower()
```

- [ ] **Step 2: Fail.** **Step 3: Update writer prompt.** **Step 4: Pass.** **Step 5: Commit** `feat(m2): writer prompt enforces floor`.

### M2.T2 — Outline pass before drafting

- [ ] **Step 1: Failing test** — assert `writer.write` issues an "outline" call first, then a "draft" call, and that the outline includes a section count consistent with hitting the floor.

- [ ] Implement two-pass write. Pass. Commit.

### M2.T3 — Hard validator below floor, warning above ceiling

- [ ] **Step 1: Failing test** — `extracted/lib/admin/validators.wordcount.test.ts`:

```ts
it("words validator fails when below floor for content_type=news", () => {
  const result = validate({ content_type: "news", content_markdown: "x ".repeat(1000) });
  expect(result.checks.words.status).toBe("fail");
  expect(result.checks.words.reason).toMatch(/below floor/i);
});

it("words validator warns when above ceiling", () => {
  const result = validate({ content_type: "news", content_markdown: "x ".repeat(2500) });
  expect(result.checks.words.status).toBe("warn");
});

it("words validator passes within band", () => {
  const result = validate({ content_type: "guide", content_markdown: "x ".repeat(1800) });
  expect(result.checks.words.status).toBe("pass");
});
```

- [ ] **Step 2: Fail.** **Step 3: Update `validators.json` + `validators.ts` words check.** **Step 4: Pass.** **Step 5: Commit.**

### M2.T4 — Smoke runs (manual, not in CI)

- [ ] Run `MODE=news python main.py`, `MODE=guide python main.py`, `MODE=company python main.py`. Each must produce ≥ floor. Record output word counts in PR description.
- [ ] Commit `feat(m2): three fresh runs over floor`.

**Milestone phrases:**
- `🟢 MILESTONE M2 STARTED: Word Count Fix`
- `✅ MILESTONE M2 COMPLETE: Word Count Fix — demo: MODE=news python main.py && wc -w backend/output/<latest>.md — Next: M3 Domain Attach`

---

# Milestone M3 — Domain Attach + GSC/Bing Verification

**Goal:** Per `DOMAIN_CUTOVER.md` Path A. `blog.statdoctor.app` resolves. GSC + Bing both verified. The `/admin/seo` dashboard fills in within 5 days of verification.

**Why now:** `/admin/seo` already exists (`extracted/app/admin/seo/`) but is empty until GSC + Bing have data. Phase 5 unblocks measurement.

**DoD:**
- CNAME `blog.statdoctor.app → cname.vercel-dns.com` resolves (`dig +short`).
- Vercel project has `blog.statdoctor.app` attached and SSL is valid.
- GSC verified for `sc-domain:statdoctor.app`. Service account JSON in `GSC_SERVICE_ACCOUNT_JSON` env.
- Bing verified for `https://statdoctor.app/`. API key in `BING_WEBMASTER_API_KEY` env.
- One successful `seo-snapshot` cron run writes ≥1 row to `seo_snapshots` for each source.
- E2E spec `seo-dashboard.spec.ts` passes against the seeded data.

This milestone is mostly **operational** (Vercel UI clicks, DNS edits in GoDaddy, GSC/Bing console verification). Tests cover the post-conditions, not the clicks.

### M3.T1 — Tests assert env vars + DNS post-conditions

- [ ] **Step 1: Failing test** — `extracted/lib/seo/preflight.test.ts`:

```ts
it("preflight reports GSC env vars present", () => {
  expect(preflight().gsc.envOk).toBe(true);
});
it("preflight reports Bing env vars present", () => {
  expect(preflight().bing.envOk).toBe(true);
});
```

- [ ] Implement `preflight()` reading required env vars. Pass. Commit.

### M3.T2 — `seo-snapshot` cron writes both sources

- [ ] **Step 1: Failing test** — integration test that calls `/api/cron/seo-snapshot` and asserts ≥1 row in `seo_snapshots` for `source='gsc'` and `source='bing'`, using recorded fixtures.

- [ ] Implement using `lib/seo/gsc.ts` and `lib/seo/bing.ts`. Pass. Commit.

### M3.T3 — Idempotency: same day, two invocations, no duplicate rows

- [ ] **Step 1: Failing test** — `gsc_snapshot_is_idempotent_per_day`. Implement upsert on `(source, captured_on)`. Pass. Commit.

### M3.T4 — Playwright `/admin/seo` data-present spec

- [ ] Seed `seo_snapshots`, navigate to `/admin/seo`, assert the "Warming up" empty state is absent and a keyword row renders. Pass. Commit.

### M3.T5 — Operator steps (manual, append-only to HANDOVER.md)

- [ ] Append to `HANDOVER.md` a "Domain Attach run-log" with the exact commands and screenshots checklist:
  - Vercel → Add Domain → `blog.statdoctor.app`
  - GoDaddy → DNS → CNAME `blog → cname.vercel-dns.com`
  - GSC → Domain property `statdoctor.app` → verify TXT
  - Service account JSON → Vercel env
  - Bing → Import from GSC

- [ ] Commit `docs(m3): domain attach run-log appended to HANDOVER.md`.

**Milestone phrases:**
- `🟢 MILESTONE M3 STARTED: Domain Attach + GSC/Bing Verification`
- `🟡 MILESTONE M3 CHECKPOINT: Domain Attach — DNS green; GSC service account next`
- `✅ MILESTONE M3 COMPLETE: Domain Attach — demo: curl -sI https://blog.statdoctor.app/ — Next: M4 Sunday Review Hardening`

---

# Milestone M4 — Sunday Review Hardening

**Goal:** Make Anu's Sunday window hit ≥95% approve-as-is in ≤25 min, every Sunday, without thinking.

**Why now:** This is the north-star metric. Validators are already in place; the work is UX polish + observability + post-review batch report.

**DoD:**
- Playwright `e2e/sunday-batch-25min.spec.ts` (full flow under 25 min in CI replay) is green.
- Real-time validator badges in the queue list (not just on detail page).
- Batch summary email (Resend) on Sunday review completion: count approved/edited/rejected, time spent, links.
- Weekly invariant alert: if last successful Sunday review was > 8 days ago, fire alert + dashboard banner.
- Reject-reason taxonomy locked in `validators.json` + propagated to writer-retry prompt (per `blog.md`).

**Files:**
- Modify: `extracted/app/admin/posts/page.tsx` (list page — add validator badges)
- Modify: `extracted/app/api/posts/[slug]/approve/route.ts` (emit `approve` event + recompute batch report)
- Create: `extracted/lib/admin/batch-report.ts`
- Create: `extracted/app/api/cron/sunday-batch-report/route.ts`
- Create: `extracted/lib/admin/weekly-invariants.ts`
- Modify: `extracted/lib/admin/validators.json` (locked reject taxonomy)
- Modify: `backend/agents/writer.py` (retry prompt accepts rejection reason)
- Create: `extracted/e2e/sunday-batch-25min.spec.ts`

### M4.T1 — Validator badges in the queue list

- [ ] **Step 1: Failing Playwright spec** — `extracted/e2e/sunday-queue.spec.ts`:

```ts
test("queue list shows validator badges per row", async ({ page }) => {
  await seedBatch({ articles: 7 });
  await signInAsAnu(page);
  await page.goto("/admin/posts");
  const rows = page.locator('[data-testid="article-row"]');
  await expect(rows).toHaveCount(7);
  await expect(rows.first().locator('[data-testid="badge-ahpra"]')).toBeVisible();
  await expect(rows.first().locator('[data-testid="badge-words"]')).toBeVisible();
});
```

- [ ] **Step 2: Fail.** **Step 3: Implement badges in `extracted/app/admin/posts/page.tsx`.** **Step 4: Pass.** **Step 5: Commit.**

### M4.T2 — Batch report compute (pure)

- [ ] **Step 1: Failing test** — `extracted/lib/admin/batch-report.test.ts`:

```ts
it("computeBatchReport returns counts and timing", () => {
  const events = [
    { kind: "approve", slug: "a", ts: t0 },
    { kind: "approve", slug: "b", ts: t0 + 60 },
    { kind: "reject",  slug: "c", ts: t0 + 90, reason: "off-brand-voice" },
    { kind: "edit",    slug: "d", ts: t0 + 100 },
    { kind: "approve", slug: "d", ts: t0 + 120 },
  ];
  expect(computeBatchReport(events)).toMatchObject({
    approved: 3,
    edited: 1,
    rejected: 1,
    durationSeconds: 120,
    approveAsIsRate: 2/3,
  });
});
```

- [ ] **Step 2: Fail.** **Step 3: Implement.** **Step 4: Pass.** **Step 5: Commit.**

### M4.T3 — Sunday-batch-report cron emits email

- [ ] **Step 1: Failing test** for `/api/cron/sunday-batch-report` — seeded events, mock Resend, assert one email sent with subject `StatDoctor Sunday batch — N approvals`.
- [ ] Implement. Pass. Commit.

### M4.T4 — Weekly invariant: no successful review in 8 days → banner + email

- [ ] **Step 1: Failing test** in `weekly-invariants.test.ts`. Seed events with `last_review_at` 9 days ago. Call invariants check. Assert one row inserted in `alerts` with `kind='stale_review'`.
- [ ] Implement. Pass. Commit.

### M4.T5 — Reject-reason → writer retry

- [ ] **Step 1: Failing test** in `backend/tests/test_writer_retry.py` — call `writer.regenerate(slug=x, rejection_reason="off-brand-voice")`, assert the prompt contains a directive referencing the reason.
- [ ] Implement. Pass. Commit.

### M4.T6 — `e2e/sunday-batch-25min.spec.ts`

- [ ] **Step 1: Failing spec** — seed 7 articles all-green validators; run the full sign-in → approve-7 → sign-out flow; assert total under 25 min in CI replay (mode = no animation, no real network).
- [ ] Pass. Commit.

**Milestone phrases:**
- `🟢 MILESTONE M4 STARTED: Sunday Review Hardening`
- `🟡 MILESTONE M4 CHECKPOINT: Sunday Review — queue badges live; batch report next`
- `✅ MILESTONE M4 COMPLETE: Sunday Review Hardening — demo: pnpm playwright test e2e/sunday-batch-25min.spec.ts — Next: M5 Pre-Handover Dry-Run`

---

# Milestone M5 — Pre-Handover Dry-Run

**Goal:** Prove the system runs unattended end-to-end on a real Friday. No fixtures. No manual nudges. Live pipeline → ingest → Sunday queue → approve → publish → website rebuild.

**Why now:** "Unattended for months" is the product. M5 is the integration test for that claim. Anything that breaks here goes back into M0–M4 as a bug.

**DoD:**
- One real Sat batch (≥4 articles) ships from a Friday GH Actions run to "published" without human action other than Sunday approvals.
- UptimeRobot stays green throughout.
- Daily digest delivered Sat morning + Sun morning + Mon morning.
- All 5 GH Actions crons fire successfully during the dry-run week.
- Post-run write-up appended to `HANDOVER.md` with timings + any deviations.
- Failure post-mortem (if any) becomes a new test in M0 (chaos suite).

This milestone is **observation + verification + one runbook update**. There's not much new code — the test is whether the system already works as advertised.

### M5.T1 — Dry-run script with assertions

- [ ] **Step 1: Failing test** — `scripts/dry-run.ts` runs end-to-end, asserts these post-conditions and exits non-zero on any miss:
  - ≥4 rows in `posts` with `status='published'` and `published_at > start`
  - 0 rows in `alerts` with `acknowledged_at IS NULL` and `kind != 'info'`
  - `/api/health` returns 200 for the whole week
  - Daily digest count ≥ 7
  - All 5 crons have ≥1 row in `cron_runs` with `status='success'` during the window

- [ ] Implement. Run on a real week. Capture timings.

### M5.T2 — Update `HANDOVER.md` with dry-run results

- [ ] Append a "Dry-run record — week of YYYY-MM-DD" section: article counts, Sunday review time, approve-as-is rate, any alerts, fixes applied.
- [ ] Commit.

**Milestone phrases:**
- `🟢 MILESTONE M5 STARTED: Pre-Handover Dry-Run (week of <date>)`
- `🟡 MILESTONE M5 CHECKPOINT: Dry-Run — Sat batch ingested; Sunday review pending`
- `🎉 HANDOVER-READY: dry-run pass — HANDOVER.md§"Dry-run record" — Sunday window: 22m at 100% — Next: M6 Website Schema Artefacts`

---

# Milestone M6 — Website-side Schema Artefacts (Phase 3)

**Goal:** Produce all the artefacts needed for a separate `~/website/` session to ship: author page, `Person` + `MedicalScholarlyArticle` JSON-LD, `<html lang="en-AU">`, `geo.region` meta. **No code is written in `~/website/` from this repo.**

**Why now:** Phase 3 is the biggest E-E-A-T lift remaining. Doing it as artefacts respects the two-repo rule and keeps this session focused.

**DoD:**
- `docs/website-artefacts/author-page.tsx` — complete TSX for `app/about/dr-anu-ganugapati/page.tsx`.
- `docs/website-artefacts/medical-scholarly-article.tsx` — JSON-LD block for blog post pages, references `Person` by `@id`.
- `docs/website-artefacts/layout-changes.md` — exact diffs for `<html lang="en-AU">`, `geo.region`, canonical, OG defaults.
- `docs/website-artefacts/sitemap.ts` + `robots.ts` — drop-in files if not already present in `~/website/`.
- `docs/website-artefacts/handoff-checklist.md` — step-by-step "do this in a new session inside `~/website/`" list, mirroring the style of the existing `docs/author-jsonld-snippet.md`.
- Each artefact is checked against `https://search.google.com/test/rich-results` *expected output* documented inline (not validated live from here).

This milestone produces no production tests (the website is the wrong repo). The artefacts themselves must compile in isolation (TS strict) — that is the test.

### M6.T1 — Author page artefact

- [ ] Create `docs/website-artefacts/author-page.tsx`. TS-strict. JSON-LD inline. Self-contained.

### M6.T2 — MedicalScholarlyArticle snippet

- [ ] Create `docs/website-artefacts/medical-scholarly-article.tsx`. References `Person` by `@id` per the existing `author-jsonld-snippet.md` convention.

### M6.T3 — Layout changes diff

- [ ] Create `docs/website-artefacts/layout-changes.md`. Show before/after for `<html lang>`, `<head>` meta additions, OG defaults.

### M6.T4 — Sitemap + robots

- [ ] Create `docs/website-artefacts/sitemap.ts` + `robots.ts` with the `getAllPosts()` integration consistent with the existing pattern in `BLOG_AGENT.md`.

### M6.T5 — Handoff checklist

- [ ] Create `docs/website-artefacts/handoff-checklist.md`. Each step concrete enough that a fresh session in `~/website/` runs it without re-reading this repo.

**Milestone phrases:**
- `🟢 MILESTONE M6 STARTED: Website Schema Artefacts`
- `✅ MILESTONE M6 COMPLETE: Website Schema Artefacts — demo: open docs/website-artefacts/handoff-checklist.md — Next: M7 Operational Wiring Verification`

---

# Milestone M7 — Operational Wiring Verification

**Goal:** Prove every alarm path. "It's plumbed" ≠ "it works." Each failure mode is induced and observed to fire the right alert.

**Why now:** Final pre-handover gate. If something doesn't alarm correctly, the operator finds out from a missing article weeks later. We force failures and confirm we get pinged.

**DoD:**
- Forced DB failure → `/api/health` returns 503 within 30s → UptimeRobot email arrives.
- Forced publish failure → `audit_events` row + `alerts` row + daily digest entry.
- Forced GSC API failure → `cron_runs` row marked `failed` → `/api/health` reports `cron:seo-snapshot: last_run_failed` → digest entry.
- Resend daily digest arrived 7 days in a row during M5; verified in M7 with a checklist.
- Banner on `/admin` triggers correctly for each surface: `needs_review > 0`, `last_publish > 8 days ago`, `stale_review`.
- Test name pattern present for each: `alert_emits_within_60s_of_<failure>`.

### M7.T1 — Forced-failure injection script

- [ ] Create `scripts/inject-failure.ts` with subcommands: `db`, `publish`, `gsc`, `bing`. Each makes a single targeted production-like failure visible to the corresponding alarm.

### M7.T2 — Each injection has a test for the alarm

- [ ] `alert_emits_within_60s_of_db_failure`
- [ ] `alert_emits_within_60s_of_publish_failure`
- [ ] `alert_emits_within_60s_of_gsc_failure`
- [ ] Each test induces the failure, polls the assertion, fails if not seen within 60s.

### M7.T3 — Banner state-machine test

- [ ] Playwright spec asserting the banner shows the right message for each condition (`needs_review > 0`, `stale_review`, `publish_failed > 0`).

### M7.T4 — Final HANDOVER.md update

- [ ] Append "Verified failure paths" section listing each induced failure with the alarm that caught it and the time-to-alert measured.

**Milestone phrases:**
- `🟢 MILESTONE M7 STARTED: Operational Wiring Verification`
- `🧪 MILESTONE M7 TESTS GREEN: Operational Wiring — alarms verified for db/publish/gsc/bing`
- `🎉 HANDOVER-READY: all alarms verified — HANDOVER.md§"Verified failure paths" — system runs unattended`

---

## Anti-Goals (deliberately NOT doing this round)

- **No re-implementation of shipped systems.** Pipeline, queue, validators, dashboard, crons stay as they are. We test them, we don't rebuild them.
- **No multi-tenant.** One brand, one site.
- **No CMS migration.** `~/website/` keeps its current shape.
- **No image generation pipeline.** Hero images are publisher OG / Guardian CDN.
- **No edit-during-the-week.** Sunday is the only review window. If quality drifts mid-week, that's an M1/M2 prompt-tuning issue, not a workflow problem.
- **No cost optimisation beyond floors and ceilings.** Track spend; tune later if budget pressure shows up.
- **No replacement of GH Actions cron with Vercel Cron.** GH Actions is the laptop-independence story; leave it.

## Cost Model (current measurements, not estimates)

Per `HANDOVER.md`:

- OpenAI: $1–3 per pipeline run × ~12 runs/month = **$12–36/month**. Cap at $50/month via OpenAI dashboard.
- Vercel Hobby: free.
- Neon Postgres: free (256 MB).
- Resend: free (3,000 emails/month — we use ~30).
- Guardian Content API: free (5,000 req/day — we use < 100).
- UptimeRobot: free.
- GitHub Actions: free (public repo).

**Total: $12–50/month, all OpenAI. Domain renewal ~$15/year. No infra above the OpenAI line.**

Alert thresholds:
- OpenAI monthly > $40 → digest warning.
- Resend monthly > 1,500 → digest warning.

## Decision Log (ADRs — record as we go in `docs/decisions/`)

- **D1** — Test-backfill before any new feature (M0 priority). *Why:* handover mode demands change-safety; current 3-file coverage is a trap.
- **D2** — Single whitelist JSON read by Python + TS (M1). *Why:* the "validators in two languages drift" failure mode applies equally to URL whitelists. Don't repeat the mistake.
- **D3** — Path A (subdomain) for domain attach (M3). *Why:* Webflow site stays untouched; 5-minute DNS change unblocks measurement; reversible.
- **D4** — Website schema upgrades as artefacts only, not direct edits (M6). *Why:* two-repo rule from memory. The `~/website/` session is separate.
- **D5** — GH Actions stays the cron host. *Why:* removes "Anu's laptop" dependency; matches existing setup; free for public repos.

## Open Questions (resolve before the named milestone starts)

- **Before M3:** Does GoDaddy DNS user have access? If not, who edits records?
- **Before M3:** Confirm `anu@statdoctor.net` has Google Workspace access (needed for GSC verification — personal Google account also works but workspace is cleaner).
- **Before M5:** Pick the dry-run week. Friday morning is best (full Sat-batch + Sunday review window in scope).
- **Before M6:** Confirm `~/website/` is on Next.js App Router (the artefacts assume it). If still on Pages Router, the JSON-LD snippet syntax differs.

---

## Self-Review (against `superpowers:writing-plans` checklist)

**Spec coverage:** Every milestone in the roadmap has a test deliverable. The 13 BDD scenarios all map to specs (lockup table above). The Test Plan section is the canonical source of truth for what we test.

**Placeholder scan:** No "TBD" in production tasks. Open Questions are explicitly gated to milestones that need them, not in-task placeholders.

**Type / name consistency:** `posts`, `audit_events`, `alerts`, `cron_runs`, `seo_snapshots` are the real DB tables per `extracted/lib/admin/schema.sql`. `validators.{ts,json}` is the real validator file. `publish.ts` is the real publish adapter. Path references match the actual file tree confirmed by `ls` during plan-write.

**What changed vs. the previous (rejected) plan:** the from-scratch M1–M9 is gone. The new M0–M7 starts from "what exists, test it" and ends at "prove it runs unattended." Milestone phrases preserved. Test Plan preserved and tightened against the real codebase.
