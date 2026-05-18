# bugs.md

Open issues, ranked by severity. Updated 2026-05-17 PM after reading all design docs + reviewing the code path that produces today's red-validator articles.

For the system reference: `architecture.md`.

---

## How to read this

- 🔴 **P0** — actively blocks the CEO from approving real articles or causes silent data loss.
- 🟠 **P1** — drift from documented intent; the system works but degrades editorial quality / autonomy.
- 🟡 **P2** — structural mis-couplings; longer-arc cleanup.
- 🟢 **P3** — operational / edge cases.

Each bug has: where (file path + line), why it matters, and a concrete fix sketch.

---

## 🔴 P0 — Bugs (objective failures, fix first)

### B1. Heal-agent throws away its surgical instruction
**Where:** `backend/heal_agent.py:122-128`
**What:** `build_instruction()` assembles a per-validator fix string ("Remove every AHPRA-banned phrase…", "Add 2 more callout blocks…"), then `heal()` calls `writer.regenerate(slug, rejection_reason="heal_agent", original_content=...)`. The instruction is never passed. `writer.regenerate` sees only the literal string `"heal_agent"` which isn't in `_REJECTION_LABELS`, so the LLM prompt becomes:
> "Your previous draft was rejected because [heal_agent]: heal_agent. Rewrite addressing this specifically."

Useless. The LLM has no idea what to fix. This is why clicking HEAL or having articles auto-heal at ingest still produces red validators.

**Fix:** Either (a) add an `extra_instruction: str | None = None` kwarg to `writer.regenerate` that injects the instruction into the prompt; or (b) have heal_agent build the OpenAI prompt directly instead of going through `writer.regenerate`.

**Effort:** 15 min. The single highest-leverage code change in the entire backlog.

---

### B2. Banned-phrase list is drifted three ways
**Where:** `backend/agents/writer.py:284` (8 phrases hardcoded), `extracted/lib/admin/validators.json` (11 patterns), historical editorial spec (mentions `miracle`, `proven`, `100% safe`, `no side effects` — never coded anywhere).

The writer prompt's hardcoded list is **missing 7 of the 11 patterns in validators.json**:
- `\baustralia'?s? (best|leading|top|premier)\b` ← this is what causes the `forbidden_claim` you're seeing
- `\btestimonial\b`
- `\bendorsement from (a |my )?(patient|client)\b`
- different verb forms of "guaranteed"

`AGENT.md:192` explicitly said "Don't add patterns in code. Read validators.json." The writer violates this rule.

**Fix:** Replace the hardcoded list in `writer.py:284` with `json.load(open(VALIDATORS_PATH))["ahpra_banned"]` at module load (the file is already loaded for `word_floors`). Same for `backend/agents/ahpra.py` which has a separate `_FORBIDDEN` regex list.

**Effort:** 20 min. Closes ~50% of `forbidden_claim` flags by teaching the writer the rules at generation time.

---

### B3. AHPRA GPT scan sees only the first 2,500 chars
**Where:** `backend/agents/ahpra.py:138`
**What:** `content[:2500]` is sent to the GPT scanner. A 2,000-word guide is ~12,000 characters — the scan covers ~20%. The regex scan covers the full content but only catches what's in the regex list (see B2 — incomplete).

**Fix:** Chunk the content into 2,500-char windows with 200-char overlap; run the GPT scan against each. Aggregate flags. Increase prompt to acknowledge "this is chunk N of M".

**Effort:** 30 min. Cost: extra GPT calls per article — guide it via `temperature=0.1` and use the cheaper `gpt-4o-mini` (already `FAST_MODEL`).

---

### B4. AHPRA GPT defaults `requires_human_review=True`
**Where:** `backend/agents/ahpra.py:171`
**What:** Even fixable issues (e.g., `unsupported_stat` where the article already cites a source nearby) get flagged as needing human review. This is why every article ships with 3-4 manual-review flags blocking ACCEPT.

**Fix:** Pass the article's `sources[]` into the GPT scan prompt. For `unsupported_stat` results, check if a source URL appears within 200 chars of the stat in the markdown; if so, set `requires_human_review=false` and `fix_applied="auto-cited from sources[N]"`. Only ambiguous / context-required issues stay `True`.

**Effort:** 45 min.

---

### B5. FAQ schema validator undercounts
**Where:** `extracted/lib/admin/validators.ts:160`
**What:** `faq.mainEntity.length >= 4` regardless of `content_type`. Editorial spec was 8+ for guides, 6+ for news, 4+ for company. Guides pass the validator green but ship with too few FAQs to rank competitively.

**Fix:** Read `validators.json` `faq_floors` (add the key) keyed by `content_type`. Same pattern as `word_floors`, `callout_floors`.

**Effort:** 15 min.

---

### B6. Comparison table is `warn` but spec says required
**Where:** `extracted/lib/admin/validators.ts:147` (`status: hasTable ? "pass" : "warn"`)
**What:** Editorial publishing checklist treats comparison_table as required for guides. Validator currently flags `warn` so the ACCEPT button stays enabled. Articles ship without tables.

**Fix:** Change to `status: hasTable ? "pass" : (post.content_type === "guide" ? "fail" : "warn")`. Also add a "Include at least one markdown comparison table" line to the writer prompt (`writer.py:_build_draft_prompt`).

**Effort:** 10 min.

---

### B7. Researcher re-broadens on source count, not publisher distribution
**Where:** `backend/agents/researcher.py:530-535` (the re-broaden loop checks `len(validated_sources) >= MIN_OK_SOURCES`)
**What:** Validator requires ≥3 distinct publishers AND ≥1 authoritative. Researcher only checks total source count. An article with 5 sources all from Guardian passes the researcher but fails the validator.

**Fix:** After source validation, also check `len(set(s.publisher for s in validated_sources)) >= 3` and `any(is_authoritative(s) for s in validated_sources)`. If either fails, re-broaden the Guardian query OR pull from another adapter (see A7 below).

**Effort:** 30 min. Reduces the most common `sources` validator failure.

---

## 🟠 P1 — Architecture drift from documented intent

### A1. News auto-publish-after-48h is not implemented
**Spec:** Per `blog.md` + `ARCHITECTURE_101X.md`, news articles should auto-publish after 48 hours of CEO inaction (defaulted via `AUTO_PUBLISH_NEWS_HOURS=48`). Currently every article requires manual ACCEPT regardless of stream.

**Why it matters:** News loses 80% of its value if shipped 4 days late. The CEO's Sunday batch window means news from earlier in the week is already stale by the time it goes live. The auto-publish path was the entire reason the AHPRA + validator gate is server-side enforceable.

**Fix:** New cron `cron-news-auto-publish.yml` (daily 08:00 UTC). Endpoint `/api/cron/news-auto-publish` runs:
```sql
UPDATE posts SET status='scheduled', last_reviewed_at=NOW()
WHERE status='pending_review' AND content_type='news'
  AND generated_at < NOW() - INTERVAL '48 hours'
  AND slug NOT LIKE '__canary-%'
  AND ahpra_passed=true;
```
Plus a re-validation step server-side before the flip. Email the CEO with an "Unpublish" link per article.

**Effort:** 90 min (route + workflow + tests + email template).

---

### A2. Approve still GitHub-commits to `~/website`
**Spec:** `ARCHITECTURE_101X.md` §3 — Approve = `UPDATE posts SET status='published'` + `revalidateTag(...)`. No GitHub commit. Public reader lives in the same app at `app/(public)/blog/[slug]`.

**Current:** `extracted/lib/admin/publish.ts` commits the JSON to `~/website/content/posts/*.json` via GitHub API. The website rebuilds. Status flips to `published` only after the commit succeeds.

**Why it matters:** Cross-repo runtime coupling. Two Vercel projects to keep in sync. The GitHub API can fail (rate-limit, PAT expiry, target branch protections) — that's exactly the `publish_failed` status retry path. Eliminating the commit removes the whole class of failure.

**Fix:** Add `/api/public/posts` + `/api/public/posts/[slug]` (already exists). Add `app/(public)/blog/[slug]/page.tsx` that reads `WHERE status='published'`. Trigger `revalidateTag(\`post-${slug}\`)` in the Approve handler. Delete `publish.ts` after the website-side cutover.

**Effort:** Multi-day. Coordinated with the domain attach + Webflow → Next.js migration. Not for this Sunday.

---

### A3. Public reader still lives on Webflow / `~/website/`
**Spec:** Same Next.js app should serve both `/admin/*` and `/blog/*` via App Router groups (`app/(public)`, `app/(admin)`).

**Current:** `statdoctor.app` is Webflow; the blog reader is over there. `blog.statdoctor.app` is the admin dashboard.

**Why it matters:** Halves the deploy surface. Public reader picks up DB changes via `revalidateTag` instead of a full GitHub-commit + Vercel rebuild cycle. Ties into A2.

**Fix:** Migrate the Webflow blog reader into `extracted/app/(public)/blog/`. Already specced in `docs/website-artefacts/` artefacts (now consolidated here — those files were `author-jsonld-snippet.md`, `handoff-checklist.md`, `layout-changes.md`).

**Effort:** Multi-week. Tracked but not in scope for immediate cleanup.

---

### A4. `post_revisions` table doesn't exist
**Spec:** `ARCHITECTURE_101X.md` — every edit snapshots prior state to `post_revisions`. Approve is auditable + revertible.

**Current:** Edits overwrite. No version history. The `audit_events` table records that an edit happened but not what changed.

**Fix:** Add to `schema.sql` (idempotent ALTER):
```sql
CREATE TABLE IF NOT EXISTS post_revisions (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES posts(slug),
  data JSONB NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_by TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS post_revisions_slug_idx ON post_revisions (slug, edited_at DESC);
```
Plus modify `/api/posts/[slug]/edit` to write a row before applying the patch.

**Effort:** 45 min.

---

### A5. `deleted_at` soft-delete column doesn't exist
**Spec:** Convention 4 — "no hard deletes". Use `deleted_at TIMESTAMPTZ NULL`. Public reader excludes `WHERE deleted_at IS NULL`.

**Current:** Rejections set `status='rejected'`. There's no recovery if accidentally rejected. There's no way to "remove" an article from the queue without losing its data entirely.

**Fix:** Add column + indexes. Update queue filters to `WHERE deleted_at IS NULL`. Add a "soft restore" endpoint.

**Effort:** 30 min.

---

### A6. Auth is static cookie, not magic-link
**Spec:** Magic-link via Resend + signed JWT cookie (`ARCHITECTURE_101X.md` key decisions table).

**Current:** `ADMIN_TOKEN` env var, `admin_token` cookie equals env value. Same value forever. Cookie-equals-env is documented as a footgun.

**Why it matters:** If the cookie value leaks (browser extension, accidental screenshot, shared screen), every login is compromised until the env var is rotated. Multi-user (e.g., adding an editor) requires another env var. No audit trail of who logged in.

**Fix:** New `/api/login/request` POST endpoint accepting an email; generates a single-use token, emails it via Resend with a 10-min expiry. `/api/login/verify?token=...` validates + sets a signed JWT cookie. Replace `isAuthorised` with JWT verification.

**Effort:** 1-2 days. Touches every admin route's auth check. Not blocking unattended operation today.

---

### A7. Only 1 of 5 source adapters is wired
**Spec:** `BLOG_AGENT.md` §1 — five adapters: Guardian, ABC AU, NewsAPI, Google News RSS, Authoritative (curated AIHW/RACGP/AMA/health.gov.au/ABS/AHPRA).

**Current:** Only Guardian Content API is wired in `researcher.py`. The "additional_sources" come from the LLM, which is gated by the URL whitelist but unreliable (the LLM may hallucinate URLs that happen to match whitelisted domains, or repeat the same Guardian-shaped URL).

**Why it matters:** Articles ship with mostly Guardian sources. The `sources` validator requires ≥3 distinct publishers AND ≥1 authoritative — frequently fails because Guardian is one publisher and the LLM picks may duplicate or be marginal.

**Fix:** Wire `sources/abc_au.py` (RSS feed parser), `sources/newsapi.py` (`NEWSAPI_KEY` is already in env), `sources/google_news_rss.py`, `sources/authoritative.py` (curated query templates for AIHW/RACGP/etc.). Researcher fans out across all configured adapters in parallel, dedups by URL, picks per-pillar.

**Effort:** 1 day per adapter; 4 days total. Massive impact on source quality.

---

## 🟡 P2 — Structural mis-couplings

### S1. Writer doesn't read `callout_floors`, `ahpra_banned`, `editorially_banned`, `bad_anchor_patterns` from validators.json
**Where:** `backend/agents/writer.py`
**What:** Writer loads `word_floors` from validators.json (good) but hardcodes everything else inline (callout types, banned phrases, anchor rules). Drift is guaranteed.

**Fix:** Load the full config once at module init. Inject `cfg["callout_floors"][content_type]`, the full banned list, the anchor rules, into the prompt.

**Effort:** 30 min. Pairs with B2.

---

### S2. AHPRA agent is scan-only, not coach-and-scan
**Where:** `backend/agents/ahpra.py`
**What:** AHPRA catches violations after the fact. The writer prompt doesn't include AHPRA's GPT-scanner's broader prohibitions (comparative implying superiority, unsubstantiated claims, guaranteed outcomes, unrealistic expectations).

**Fix:** Extract the AHPRA "Key prohibited content" block from `ahpra.py:120-135` and inject it into the writer prompt. Writer learns the rules upfront; AHPRA stays as the safety net.

**Effort:** 30 min.

---

### S3. No closed-loop validation in the pipeline
**Where:** `backend/pipeline.py`
**What:** Layer A validators log to `pipeline_runs` but don't ACT. If word_count is below floor after writer, the pipeline shrugs and ships. The full Layer A retry orchestration (re-prompt with failure reason, max 2 retries, abort + alert) was deferred when we shipped PR #26.

**Fix:** Wrap each agent in `run_with_retry(agent_fn, validator_fn, max_retries=2)` that:
1. Calls agent_fn
2. Calls validator_fn(output)
3. If fail and attempts < max: call agent_fn again with `previous_failure=res.reason` kwarg
4. If exhausted: raise RuntimeError → outer try in main.py dispatches `pipeline_aborted` alert

Each agent needs to accept `previous_failure: str | None = None` and inject it into its prompt.

**Effort:** 90 min. Same shape as the heal-agent loop but per-agent.

---

### S4. Heal calls writer for everything
**Where:** `backend/heal_agent.py`
**What:** Heal-agent calls `writer.regenerate` regardless of which validator failed. 5 of 8 validator failures can't be addressed by a writer rewrite:
- `ahpra` forbidden_claim → needs targeted regex replace + ahpra.check_ahpra re-run
- `ahpra` unsupported_stat → needs citation addition (call into seo.py or a dedicated cite_agent)
- `schema` → SEO agent rebuilds faq_json_ld
- `sources` → researcher re-runs for more publishers
- `comparison_table` → could be a deterministic insert based on article topic

**Fix:** Heal-agent routes by validator type to the right agent:
```python
HEAL_HANDLERS = {
    "word_count":      lambda post, detail: writer.regenerate(...),
    "banned_phrases":  lambda post, detail: ahpra.surgical_replace(...),
    "anchor_text":     lambda post, detail: writer.regenerate(...),
    "callout_quota":   lambda post, detail: writer.regenerate(...),
    "schema":          lambda post, detail: seo.rebuild_faq(...),
    "sources":         lambda post, detail: researcher.broaden_publishers(...),
    "comparison_table":lambda post, detail: writer.regenerate(...),
    "ahpra":           lambda post, detail: ahpra.surgical_fix(...),
}
```

**Effort:** 2-3 days (each handler is its own small task).

---

### S5. Validators are in three files; only validators.json is the documented source of truth
**Where:** `extracted/lib/admin/validators.json` (intended source), `extracted/lib/admin/validators.ts` (live regex), `backend/agents/writer.py:284` (hardcoded subset), `backend/agents/ahpra.py:_FORBIDDEN` (separate regex list).

**Fix:** Treat validators.json as immutable. validators.ts compiles the regexes from JSON at import. writer.py and ahpra.py do the same. The cross-language drift test (`test_url_validation_drift.py` / `url-validator-drift.test.ts`) exists for URL whitelist; add an equivalent for banned phrases.

**Effort:** 90 min plus the drift test.

---

### S6. AHPRA flags don't carry severity
**Where:** `backend/models.py:AHPRAFlag` + `extracted/lib/admin/types.ts:AHPRAFlag`
**What:** Flags have `flag_type` (forbidden_claim / missing_disclaimer / unsupported_stat / unknown) and a boolean `requires_human_review`. No notion of "block publish" vs "warn-on-publish".

**Fix:** Add `severity: "info" | "warn" | "error"`. Validator gate uses `error`-severity flags to block; UI shows `warn` as yellow non-blocking.

**Effort:** 1 hr including migration.

---

## 🟢 P3 — Operational / edge cases

### O1. Migration is hand-run
**Where:** `extracted/lib/admin/migrate.ts` is invoked only by `POST /api/admin/migrate` with an admin cookie.

**Why it matters:** PR #26 added `pending_heal` + `heal_failed` statuses. Until the migration runs, the auto-heal path falls back to `pending_review` (we added defensive handling in PR #28). Future schema changes have the same gotcha.

**Fix:** Add a Next.js `instrumentation.ts` server-start hook that runs `applyMigrations()` once per cold start. Idempotent SQL means re-runs are safe. Track via a `_migrations` table.

**Effort:** 1 hr.

---

### O2. `seo-snapshot` has never run successfully
**Where:** Cron has been firing daily 02:00 UTC for days; every run fails because GSC service account isn't yet added to the property (Google directory propagation per the M3 setup notes).

**Why it matters:** No SEO data. `/admin/seo` and `/admin/stats` empty-state. Banner now correctly says "never run successfully" (fixed in PR #28).

**Fix:** User action — retry SA user-add at `<https://search.google.com/search-console/users?resource_id=sc-domain%3Astatdoctor.app>`. Once it propagates, the cron starts working without code change.

**Effort:** 30 seconds of operator action, gated on Google.

---

### O3. Banned-phrase regex over-matches "Australia's leading"
**Where:** `validators.json:11` — `\baustralia'?s? (best|leading|top|premier)\b`

**Why it matters:** Catches both the claim ("StatDoctor is Australia's leading…") and innocuous use ("Australia's leading cause of GP shortage is…"). False positives create false `forbidden_claim` flags.

**Fix:** Narrow the regex — require a positional modifier indicating claim of superiority. E.g., `\baustralia'?s? (best|leading|top|premier)\s+(provider|platform|service|app|marketplace|specialist|doctor|clinic)`. Trade-off: misses non-listed nouns. The cleaner fix is a small classifier (GPT call) for ambiguous matches.

**Effort:** 20 min for the regex; 90 min for the classifier path.

---

### O4. ~~Wikimedia fallback returns loosely-topical images~~ — RESOLVED 2026-05-18 by removal
**Status:** Wikimedia fallback removed entirely (CEO request — see `docs/plan.md` N4). Articles ship without an image when Guardian CDN + OG-scrape both fail, rather than risking a topical-mismatch attribution. Cleaner than a per-image relevance pass and avoids the LLM cost of the originally-planned fix.

---

### O5. Concurrent heals on different slugs can race
**Where:** `.github/workflows/heal.yml` — `concurrency: heal-${{ inputs.slug }}` (per-slug, not global).

**Why it matters:** Two heals on different slugs run in parallel. Both POST patched articles back to `/api/admin/ingest` simultaneously. The ingest is serialised at the DB level (Postgres row-level lock) but each upsert re-validates and may re-fire its own heal. In the worst case: a thundering-herd of heal workflows.

**Fix:** Add a global concurrency limit at the dispatch endpoint level: `heal-dispatch.ts` checks `SELECT COUNT(*) FROM pipeline_runs WHERE agent_name='heal' AND status='retried' AND ts > NOW() - INTERVAL '10 minutes'` and bails if > 5.

**Effort:** 30 min.

---

### O6. Cost cap is implicit, not visible
**Where:** `RESEARCHER_BUDGET_TOKENS` (50000 default) aborts the researcher. No equivalent for writer / SEO / AHPRA. No dashboard surface for daily/weekly OpenAI spend.

**Why it matters:** Each pipeline run is $0.40-$2. Heal triples it. A bug that causes the heal-agent to loop on the same article would burn $10+/article without any alarm.

**Fix:** Add `OPENAI_DAILY_BUDGET_USD` env var. Track usage via the OpenAI API response headers (`x-ratelimit-remaining-tokens` etc.) in a `daily_spend` table. The pipeline + heal abort if today's spend > budget.

**Effort:** 90 min including dashboard tile.

---

### O7. Approve doesn't take an actor identity
**Where:** `extracted/app/api/posts/[slug]/approve/route.ts` writes an `audit_events` row but the `actor` column doesn't exist.

**Why it matters:** "Who approved this on 2026-04-12" cannot be answered. With static-cookie auth there's only one actor anyway, but the schema should be ready for multi-user (when A6 ships).

**Fix:** Add `actor TEXT` to `audit_events`. Read from the JWT (post-A6) or from the cookie value's identifier component.

**Effort:** 15 min schema, blocked on A6 for the real value.

---

### O8. MODE=news|guide|company CLI flag is documented but not wired
**Where:** `backend/main.py` accepts `MODE` env var but the Intelligence dispatcher doesn't honour it.

**Fix:** In `agents/intelligence.py:select_topic`, if `os.environ.get("MODE")` is set, pin `content_type` to that and skip the 40/40/20 weighting.

**Effort:** 15 min.

---

### O9. The 2 articles dated 14-15 May are stuck
**Where:** Dashboard queue.

**What:** Both have red validators. Neither can be ACCEPTed. CEO hasn't manually fixed or rejected them in 2-3 days.

**Why it matters:** Once auto-heal works (B1 + migration applied), red articles never reach `pending_review`. Existing ones don't auto-heal — they need a manual HEAL click or REJECT.

**Fix:** Either trigger heal on each manually (`gh workflow run heal.yml -f slug=<slug>`) or REJECT them and let the next pipeline run repopulate. Decision: CEO's call.

---

## Recommended fix order

If you want articles to come out green from this Sunday onward:

1. **B1** (15 min) — pass the heal instruction to the LLM. Single highest-leverage change.
2. **B2 + S1 + S5** (1 hr) — make writer.py read the full validators.json. Closes ~50% of `forbidden_claim` flags upfront.
3. **B6** (10 min) — comparison_table → `fail` for guides + add to writer prompt.
4. **B5** (15 min) — FAQ floor by content_type.
5. **B4** (45 min) — AHPRA scan stops over-flagging `unsupported_stat` when sources are nearby.
6. **B7** (30 min) — researcher re-broadens on publisher distribution.
7. **A1** (90 min) — news auto-publish after 48h.

Subtotal ≈ 4 hours. After that, the Sunday queue should be majority green-on-arrival, and news doesn't sit waiting for manual approval.

Items A2–A7, S2–S6, and O1–O9 are longer-arc cleanup. They're tracked here so they don't get forgotten.
