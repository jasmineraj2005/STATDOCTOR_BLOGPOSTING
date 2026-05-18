# Launch runbook — Tier 2 canary + pre-flight checklist

> Operator companion to `docs/plan.md`. Use when stepping the system from "tests green locally" to "soft launch".
> Every section is a copy-paste sequence with expected output.
> Prerequisite: `gh` authenticated as a repo collaborator; `vercel` authenticated as project owner; access to anu@statdoctor.net inbox.

---

## A — Tier 1 dry-run (laptop only)

Already exercised by CI on every push. Manual replay:

```bash
cd ~/Desktop/statdoctor-blog/STATDOCTOR_BLOGPOSTING
bash scripts/verify-all.sh
```

**Pass criteria:** final line reads `All green — system is healthy end-to-end.` and exit code 0.

**Known prereq:** Postgres 16 running locally (`brew services start postgresql@16`). If you see `relation "posts" does not exist` after the migrate step, the dev-server boot inherited an `ADMIN_TOKEN` from `extracted/.env.local` and the migrate POST was rejected with 401. The verify-* scripts now explicitly unset `ADMIN_TOKEN` for the child `pnpm dev` to keep `lib/admin/auth.ts:isAuthorised()` in fall-open mode.

**Local pytest path:** `verify-all.sh` looks for `backend/.venv/bin/pytest` (note the dot). The current venv is at `backend/venv/bin/pytest`. If pytest doesn't run automatically, exercise it manually:

```bash
cd backend && venv/bin/pytest -q
```

Expected: `281 passed`.

---

## B — Tier 2 canary (real LLM, no public publish)

Three subcases. Each must complete in ≤120s and leave no `__canary-` row in `posts`.

### B.1 — Happy-path canary

```bash
gh workflow run cron-canary.yml
gh run watch                           # wait for green tick
```

Expected DB:
```sql
SELECT kind, last_ok, last_detail
FROM cron_runs WHERE kind='canary' ORDER BY last_ok DESC LIMIT 1;
-- kind: canary
-- last_ok: within 2 minutes
-- last_detail: contains "ingest→approve→scheduled→publish_dry→delete"

SELECT COUNT(*) FROM posts WHERE slug LIKE '__canary-%';
-- 0
```

**Fail signal:** `last_fail > last_ok` for kind='canary', OR row in `posts` with `slug LIKE '__canary-%'`. Investigate the workflow logs via `gh run view --log`.

### B.2 — Heal-path canary

Proves M2 (the bug-B1 fix) works end-to-end with a real LLM call.

```bash
# Flip Layer C into strict mode just for this run
vercel env add FAIL_AGENT_INGEST_GATE strict production
vercel deploy --prod                   # 2-3 min

# Push a deliberately-broken canary
gh workflow run cron-canary.yml -f mode=heal-broken
gh run watch
```

Expected sequence in `pipeline_runs`:
```sql
SELECT agent_name, status, failure_reason, ts
FROM pipeline_runs
WHERE run_id = (SELECT run_id FROM pipeline_runs ORDER BY ts DESC LIMIT 1)
ORDER BY ts;
-- Multiple rows; one with status='retried', then final 'ok'
```

Expected DB post state:
```sql
SELECT slug, status FROM posts WHERE slug LIKE '__canary-%';
-- (after canary self-cleans) 0 rows
-- (during the run) status flips pending_heal → pending_review → scheduled → published
```

**Cleanup:**
```bash
vercel env rm FAIL_AGENT_INGEST_GATE production
vercel deploy --prod
```

### B.3 — All-4-layers alert proof

Run each `inject-failure.ts` subcommand against the local dev server, then verify the alert chain fires.

```bash
cd ~/Desktop/statdoctor-blog/STATDOCTOR_BLOGPOSTING/extracted
pnpm dev &                             # boot dev server
sleep 5

cd ..
npx tsx scripts/inject-failure.ts db
# Expect:
#   - row in `alerts` table with kind='db_unreachable'
#   - row in `cron_runs.kind='db'` with last_fail > last_ok
#   - email at anu@statdoctor.net within 60s (subject contains "db_unreachable")

npx tsx scripts/inject-failure.ts publish
# Expect HTTP 500 from /api/cron/scheduled-publish + publish_failed alert email
# Banner state on /admin/posts flips to 'publish_failed'

npx tsx scripts/inject-failure.ts gsc
npx tsx scripts/inject-failure.ts bing
# Expect gsc_failed / bing_failed rows in alerts
```

Each test should complete in <60s with the inbox email arriving promptly.

---

## C — Pre-flight 15-item checklist

Walk in order. Block launch if any item is `[ ]`.

### Status snapshot (last walked 2026-05-18)

- ✅ **Item 9** — all P0 fixes merged. Local CI gate: 281 pytest + 369 vitest, 0 failures, 0 regressions.
- ✅ **Item 11** — DNS: `blog.statdoctor.app` resolves to Vercel (cname.vercel-dns.com). Ingest with bad token returns `HTTP/2 401` (auth gate functioning).
- 🟡 **Item 7** — `GET https://blog.statdoctor.app/api/health` returned **HTTP 503** on 2026-05-18. Root cause: `cron:seo-snapshot:last_run_failed` (GSC SA propagation pending — bugs.md O2). Mitigation landed in N5: the route now honours a `HEALTH_EXPECTED_FAILING_CRONS` env-var allowlist. **Operator action:** `vercel env add HEALTH_EXPECTED_FAILING_CRONS seo-snapshot production && vercel deploy --prod`. Remove the env var once GSC SA propagates (bugs.md O2 / plan M25).
- ⏳ **Items 1–6, 8, 10, 12, 14, 15** — require Vercel + gh + prod-DB access. Operator must walk these.
- ⏳ **Item 13** — `inject-failure.ts` × 4. Requires local dev server + DB; runs after verify-all completes.

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | Vercel env vars complete | `vercel env ls` | Every row in `docs/architecture.md` §11 present |
| 2 | GH repo secrets complete | `gh secret list` | Every required secret present |
| 3 | Migration applied | `curl -X POST -H "Cookie: admin_token=$ADMIN_TOKEN" https://blog.statdoctor.app/api/admin/migrate` | `{"ok":true,"detail":"Applied N statement(s)."}` |
| 4 | All crons firing | `psql $POSTGRES_URL -c "SELECT kind, last_ok FROM cron_runs WHERE last_ok IS NULL OR last_ok < NOW() - INTERVAL '36 hours';"` | 0 rows |
| 5 | No publish_failed posts | `psql $POSTGRES_URL -c "SELECT COUNT(*) FROM posts WHERE status='publish_failed';"` | 0 |
| 6 | No unacknowledged critical alerts | `psql $POSTGRES_URL -c "SELECT COUNT(*) FROM alerts WHERE ts > NOW() - INTERVAL '24 hours' AND severity IN ('error','critical') AND acknowledged_at IS NULL;"` | 0 |
| 7 | Public /api/health | `curl -sS https://blog.statdoctor.app/api/health \| jq .ok` | `true` |
| 8 | Banner state clean | `curl -sS -H "Cookie: admin_token=$ADMIN_TOKEN" https://blog.statdoctor.app/api/admin/banner-state \| jq .kind` | `"none"` |
| 9 | All P0 fixes in CI | `gh run list --workflow=ci.yml --limit 3` | 3 consecutive successes |
| 10 | Workflows enabled | `gh workflow list` | All 10 workflows show `active` |
| 11 | DNS + auth surface | `dig +short blog.statdoctor.app A && curl -sSI -X POST https://blog.statdoctor.app/api/admin/ingest -H "Authorization: Bearer bad" \| head -1` | DNS resolves to Vercel; bad token → `HTTP/2 401` |
| 12 | No stray canary rows | `psql $POSTGRES_URL -c "SELECT slug FROM posts WHERE slug LIKE '__canary-%';"` | 0 rows |
| 13 | inject-failure passes × 4 | See B.3 above | All 4 subcommands green |
| 14 | Resend domain verified | open Resend dashboard | `mail.statdoctor.app` shows ✓ verified |
| 15 | Last 3 canaries green | `psql $POSTGRES_URL -c "SELECT last_ok, last_fail FROM cron_runs WHERE kind='canary';"` | `last_ok` < 24h ago, `last_fail` NULL or older than `last_ok` |

---

## D — Launch day-of timeline

Each step here assumes A + B + C are green.

| When | Action | Pass signal |
|---|---|---|
| **T-7d (Mon)** | All P0 PRs merged. Re-run §A locally. | `verify-all.sh` returns 0 |
| **T-3d (Fri)** | Trigger pipeline 3× (`gh workflow run pipeline.yml`) for guide / news / company. Walk pre-flight §C. | All 15 items `[x]` |
| **T-1d (Sat 14:00 UTC)** | Saturday pipeline batch fires automatically | `SELECT COUNT(*) FROM posts WHERE status='pending_review' AND slug NOT LIKE '__canary-%';` ≥ 4 by Sat 20:30 UTC |
| **T-1d (Sat 21:00 UTC)** | Sunday-reminder email | Email subject `"Sunday review ready — N articles queued"` arrives in inbox |
| **T-0 (Sun)** | CEO works queue at /admin/posts | ≤ 25 min wall-clock; all reviewed |
| **T+1d (Mon 09:00 UTC)** | Retrospective email | Body matches `SELECT action, slug FROM audit_events WHERE ts > '<sat-noon>' ORDER BY ts;` |
| **T+7d (next Mon)** | First weekly retrospective | Green-on-arrival rate ≥ 95%; heal events documented |

If anything fails at T-1d or T-0, the pipeline can be paused with `gh workflow disable pipeline.yml` and re-enabled when fixed.

---

## E — Rollback / kill-switches

| Concern | Switch |
|---|---|
| Heal loop burning money | `vercel env add FAIL_AGENT_INGEST_GATE shadow production && vercel deploy --prod` (default shadow = no 422s, no auto-heal at ingest) |
| AHPRA chunked scan unexpectedly expensive | `vercel env add AHPRA_CHUNKED_SCAN off production && vercel deploy --prod` |
| News auto-publish premature (when M8 ships) | `vercel env add NEWS_AUTO_PUBLISH off production && vercel deploy --prod` |
| Full pipeline pause | `gh workflow disable pipeline.yml` |
| All crons pause | `for wf in cron-canary cron-daily-digest cron-competitor-audit cron-seo-snapshot cron-scheduled-publish cron-sunday-batch-report cron-sunday-reminder; do gh workflow disable "${wf}.yml"; done` |
| Whole dashboard down | Vercel → Project → Settings → Pause deployment |
| Database emergency | Pause project as above; DB stays intact; investigate from the Neon console |

---

## F — Known non-blocking issues (do not gate launch)

- **GSC SA propagation** (bugs.md O2 / plan M25): `seo-snapshot` cron writes 0 rows daily until the GCP service account propagates. Retry at `https://search.google.com/search-console/users?resource_id=sc-domain%3Astatdoctor.app`.
- **Stuck May 14–15 articles** (bugs.md O9 / plan M24): Manually `gh workflow run heal.yml -f slug=<slug>` for each after M2 lands, or REJECT them. CEO's call.
- **Public reader still on Webflow** (bugs.md A2+A3 / plan M12): multi-week migration tracked separately. Doesn't block soft launch.
