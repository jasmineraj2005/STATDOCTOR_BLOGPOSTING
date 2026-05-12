#!/usr/bin/env bash
# Verifies /api/health + /api/cron/daily-digest + cron_runs heartbeat.
# Prereq: brew services postgresql@16 running.

set -euo pipefail

REPO="/Users/jasminebaldevraj/Desktop/statdoctor-blog/STATDOCTOR_BLOGPOSTING"
DB_NAME="statdoctor_admin_test"
DB_USER="$(whoami)"
POSTGRES_URL="postgresql://${DB_USER}@localhost:5432/${DB_NAME}"
INGEST_TOKEN="health-verify-$$"
CRON_SECRET="cron-verify-$$"
PG="/opt/homebrew/opt/postgresql@16/bin"

echo "==[1] reset database"
"${PG}/dropdb" --if-exists "${DB_NAME}" 2>&1 || true
"${PG}/createdb" "${DB_NAME}"

echo "==[2] boot dev server (no Resend keys → digest will skip safely)"
cd "${REPO}/extracted"
pkill -f "next dev" 2>/dev/null || true
sleep 1
mkdir -p /tmp/sd-publish-test
rm -f /tmp/sd-publish-test/*.json 2>/dev/null || true
: > /tmp/sd-dev.log
POSTGRES_URL="${POSTGRES_URL}" \
  INGEST_TOKEN="${INGEST_TOKEN}" \
  CRON_SECRET="${CRON_SECRET}" \
  WEBSITE_POSTS_DIR=/tmp/sd-publish-test \
  pnpm dev > /tmp/sd-dev.log 2>&1 &
echo $! > /tmp/sd-dev.pid
until grep -qE "Ready in|Failed|EADDRINUSE" /tmp/sd-dev.log 2>/dev/null; do sleep 1; done
echo "(server ready)"

echo "==[3] migrate"
curl -sS -X POST http://localhost:3000/api/admin/migrate
echo

echo "==[4] /api/health when no crons have run (expect status=healthy or degraded)"
curl -sS -o /tmp/sd-h1.json -w "HTTP %{http_code}\n" http://localhost:3000/api/health
cat /tmp/sd-h1.json | python3 -m json.tool
echo

echo "==[5] run auto-publish-news cron — should write to cron_runs"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" \
  -o /tmp/sd-ap.json -w "HTTP %{http_code}\n" \
  http://localhost:3000/api/cron/auto-publish-news
cat /tmp/sd-ap.json; echo

echo "==[6] cron_runs row exists"
"${PG}/psql" "${POSTGRES_URL}" -c "SELECT kind, last_ok IS NOT NULL AS has_ok, last_detail FROM cron_runs;"

echo "==[7] /api/health now (expect 'ok' for auto-publish-news, others 'not_yet_run')"
curl -sS -o /tmp/sd-h2.json -w "HTTP %{http_code}\n" http://localhost:3000/api/health
cat /tmp/sd-h2.json | python3 -m json.tool
echo

echo "==[8] simulate a stale cron — push auto-publish-news last_ok 30h ago"
"${PG}/psql" "${POSTGRES_URL}" -c "UPDATE cron_runs SET last_ok = NOW() - INTERVAL '30 hours' WHERE kind = 'auto-publish-news';"
curl -sS -o /tmp/sd-h3.json -w "HTTP %{http_code}\n" http://localhost:3000/api/health
cat /tmp/sd-h3.json | python3 -m json.tool
echo

echo "==[9] /api/cron/daily-digest (no Resend keys — should skip safely, mark heartbeat)"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" \
  -o /tmp/sd-d.json -w "HTTP %{http_code}\n" \
  http://localhost:3000/api/cron/daily-digest
cat /tmp/sd-d.json | python3 -m json.tool
echo

echo "==[10] cron_runs has digest heartbeat"
"${PG}/psql" "${POSTGRES_URL}" -c "SELECT kind, last_ok IS NOT NULL AS has_ok, LEFT(last_detail, 60) AS detail FROM cron_runs ORDER BY kind;"

echo "==[11] /api/health unauth check is fine (no token needed)"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/health

echo "==[12] cleanup"
kill $(cat /tmp/sd-dev.pid 2>/dev/null) 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true

echo
echo "==DONE=="
