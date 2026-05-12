-- StatDoctor blog admin — review queue + audit log
-- Target: Vercel Postgres (Neon) free hobby tier (256MB). Fallback: Supabase free tier.
-- Apply with: lib/admin/migrate.ts (POST /api/admin/migrate or `node migrate.cjs`)

CREATE TABLE IF NOT EXISTS posts (
  slug TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','published')),
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
