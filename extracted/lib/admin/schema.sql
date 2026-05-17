-- StatDoctor blog admin — review queue + audit log
-- Target: Vercel Postgres (Neon) free hobby tier (256MB). Fallback: Supabase free tier.
-- Apply with: lib/admin/migrate.ts (POST /api/admin/migrate or `node migrate.cjs`)

CREATE TABLE IF NOT EXISTS posts (
  slug TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','pending_heal','heal_failed','approved','scheduled','rejected','published','publish_failed')),
  pillar TEXT NOT NULL,
  content_type TEXT NOT NULL
    CHECK (content_type IN ('news','guide','company')),
  word_count INT NOT NULL DEFAULT 0,
  ahpra_passed BOOLEAN NOT NULL DEFAULT false,
  generated_at TIMESTAMPTZ NOT NULL,
  date_modified TIMESTAMPTZ NOT NULL,
  last_reviewed_at TIMESTAMPTZ,
  data JSONB NOT NULL                       -- the full FinalPost JSON
);

CREATE INDEX IF NOT EXISTS posts_status_idx ON posts (status, generated_at DESC);
-- Fast lookup for the scheduler: oldest scheduled article eligible to publish.
CREATE INDEX IF NOT EXISTS posts_scheduled_idx ON posts (status, last_reviewed_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slug TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('approve','reject','edit','publish','publish-failed')),
  reason_code TEXT,
  reason_text TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_events (ts DESC);
CREATE INDEX IF NOT EXISTS audit_slug_idx ON audit_events (slug, ts DESC);

-- Alerts: append-only log of anything an operator needs to see in the daily digest.
-- Cron failures, auto-publish blocks, publish handoff failures, GSC fetch errors.
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alerts_unack_idx ON alerts (ts DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS alerts_kind_idx ON alerts (kind, ts DESC);

-- Cron run heartbeat — every cron updates its row on every invocation.
-- Powers /api/health (uptime monitor) and the daily-digest email body.
CREATE TABLE IF NOT EXISTS cron_runs (
  kind TEXT PRIMARY KEY,
  last_ok TIMESTAMPTZ,
  last_fail TIMESTAMPTZ,
  last_detail TEXT,
  runs_total BIGINT NOT NULL DEFAULT 0,
  fails_total BIGINT NOT NULL DEFAULT 0
);

-- ── SEO progress tracking ─────────────────────────────────────────────────────
-- Daily snapshots pulled from Google Search Console (gsc_daily_snapshot) and
-- Bing Webmaster Tools (bing_daily_snapshot). Aggregated by /admin/seo.

CREATE TABLE IF NOT EXISTS gsc_daily_snapshot (
  date         DATE       NOT NULL,
  query        TEXT       NOT NULL,
  page         TEXT       NOT NULL,
  country      TEXT       NOT NULL DEFAULT '',
  device       TEXT       NOT NULL DEFAULT '',
  clicks       INT        NOT NULL DEFAULT 0,
  impressions  INT        NOT NULL DEFAULT 0,
  position     NUMERIC    NOT NULL DEFAULT 0,
  PRIMARY KEY (date, query, page, country, device)
);
CREATE INDEX IF NOT EXISTS gsc_date_idx ON gsc_daily_snapshot (date DESC);
CREATE INDEX IF NOT EXISTS gsc_query_idx ON gsc_daily_snapshot (query, date DESC);
CREATE INDEX IF NOT EXISTS gsc_page_idx ON gsc_daily_snapshot (page, date DESC);

CREATE TABLE IF NOT EXISTS bing_daily_snapshot (
  date         DATE       NOT NULL,
  query        TEXT       NOT NULL,
  page         TEXT       NOT NULL DEFAULT '',
  clicks       INT        NOT NULL DEFAULT 0,
  impressions  INT        NOT NULL DEFAULT 0,
  position     NUMERIC    NOT NULL DEFAULT 0,
  PRIMARY KEY (date, query, page)
);
CREATE INDEX IF NOT EXISTS bing_date_idx ON bing_daily_snapshot (date DESC);

-- CEO-curated target keyword list. Per-pillar so the dashboard can filter.
CREATE TABLE IF NOT EXISTS keyword_targets (
  id          BIGSERIAL  PRIMARY KEY,
  keyword     TEXT       NOT NULL UNIQUE,
  pillar      TEXT       NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Manual AEO citation log — periodic CEO checks of "did ChatGPT / Claude /
-- Perplexity cite us for keyword X?" No free API exists for this yet.
CREATE TABLE IF NOT EXISTS aeo_log (
  id          BIGSERIAL  PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  keyword     TEXT       NOT NULL,
  model       TEXT       NOT NULL,  -- 'chatgpt' | 'claude' | 'perplexity' | 'gemini' | 'copilot' | 'other'
  cited       BOOLEAN    NOT NULL,
  snippet     TEXT,
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS aeo_ts_idx ON aeo_log (ts DESC);
CREATE INDEX IF NOT EXISTS aeo_keyword_idx ON aeo_log (keyword, ts DESC);

-- ── M7: publish_failed status migration ───────────────────────────────────────
-- Idempotent: drops the old CHECK constraint and re-adds it with publish_failed
-- + heal-agent statuses included. Safe to run on an existing DB.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check CHECK (status IN ('pending_review','pending_heal','heal_failed','approved','scheduled','rejected','published','publish_failed'));

-- ── Fail-Agent Layer A: pipeline_runs (2026-05-17 PM) ─────────────────────────
-- Every agent run (intelligence, researcher, writer, seo, ahpra) appends a row
-- with status ∈ {ok, fail, retried, aborted}. Operator queries by run_id to
-- debug failed pipeline runs.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_name TEXT NOT NULL
    CHECK (agent_name IN ('intelligence','researcher','writer','seo','ahpra')),
  status TEXT NOT NULL
    CHECK (status IN ('ok','fail','retried','aborted')),
  failure_reason TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pipeline_runs_run_idx ON pipeline_runs (run_id, ts);
CREATE INDEX IF NOT EXISTS pipeline_runs_agent_idx ON pipeline_runs (agent_name, ts DESC);
