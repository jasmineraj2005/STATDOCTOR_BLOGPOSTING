#!/usr/bin/env bash
# Verifies /admin/seo (empty-state + with-data), keyword CRUD, AEO log.

set -euo pipefail

REPO="/Users/jasminebaldevraj/Desktop/statdoctor-blog/STATDOCTOR_BLOGPOSTING"
DB_NAME="statdoctor_admin_test"
DB_USER="$(whoami)"
POSTGRES_URL="postgresql://${DB_USER}@localhost:5432/${DB_NAME}"
CRON_SECRET="seo-verify-$$"
PG="/opt/homebrew/opt/postgresql@16/bin"

echo "==[1] reset DB"
"${PG}/dropdb" --if-exists "${DB_NAME}" 2>&1 || true
"${PG}/createdb" "${DB_NAME}"

echo "==[2] boot dev"
cd "${REPO}/extracted"
pkill -f "next dev" 2>/dev/null || true
sleep 1
: > /tmp/sd-dev.log
POSTGRES_URL="${POSTGRES_URL}" CRON_SECRET="${CRON_SECRET}" pnpm dev > /tmp/sd-dev.log 2>&1 &
echo $! > /tmp/sd-dev.pid
until grep -qE "Ready in|Failed|EADDRINUSE" /tmp/sd-dev.log 2>/dev/null; do sleep 1; done
echo "(ready)"

echo "==[3] migrate (creates SEO tables)"
curl -sS -X POST http://localhost:3000/api/admin/migrate; echo

echo "==[4] /admin/seo empty-state — expect 200 + 'Warming up'"
curl -sS http://localhost:3000/admin/seo | grep -oE 'Warming up|SEO progress' | head -3
echo

echo "==[5] /admin/seo/keywords — empty state"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/admin/seo/keywords

echo "==[6] add a keyword via form POST"
curl -sS -X POST -d "keyword=locum gp rates nsw&pillar=locum_pay_rates" \
  -w "HTTP %{http_code}\n" http://localhost:3000/api/seo/keywords/add

echo "==[7] DB has the keyword"
"${PG}/psql" "${POSTGRES_URL}" -c "SELECT keyword, pillar FROM keyword_targets;"

echo "==[8] /admin/seo/keywords now shows it"
curl -sS http://localhost:3000/admin/seo/keywords | grep -oE 'locum gp rates nsw' | head -1
echo

echo "==[9] /admin/seo/aeo — empty state"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/admin/seo/aeo

echo "==[10] log an AEO check"
curl -sS -X POST \
  -d "keyword=locum gp rates nsw&model=chatgpt&cited=true&snippet=StatDoctor was listed third&notes=test" \
  -w "HTTP %{http_code}\n" http://localhost:3000/api/seo/aeo/log

echo "==[11] aeo_log row exists"
"${PG}/psql" "${POSTGRES_URL}" -c "SELECT keyword, model, cited, LEFT(snippet, 30) FROM aeo_log;"

echo "==[12] insert mock GSC snapshots so /admin/seo shows real data"
"${PG}/psql" "${POSTGRES_URL}" <<'SQL'
INSERT INTO gsc_daily_snapshot (date, query, page, country, device, clicks, impressions, position)
VALUES
  (CURRENT_DATE - 2, 'locum gp rates nsw', 'https://statdoctor.app/blog/sydney-locum-test', 'aus', 'DESKTOP', 3, 145, 8.4),
  (CURRENT_DATE - 2, 'ahpra registration time', 'https://statdoctor.app/blog/ahpra-guide',     'aus', 'MOBILE',  1,  62, 11.2),
  (CURRENT_DATE - 1, 'locum gp rates nsw', 'https://statdoctor.app/blog/sydney-locum-test', 'aus', 'DESKTOP', 5, 220, 6.9),
  (CURRENT_DATE - 1, 'medicare reforms 2026', 'https://statdoctor.app/blog/medicare-reforms', 'aus', 'DESKTOP', 0,  30, 22.0);
SQL

echo "==[13] /admin/seo with data — expect tiles + chart, not Warming up"
curl -sS http://localhost:3000/admin/seo | grep -oE 'SEO progress|Warming up|Impressions \(90d\)|Quick wins' | sort -u | head -10
echo

echo "==[14] /admin/seo/keywords now shows the position bucket"
curl -sS http://localhost:3000/admin/seo/keywords | grep -oE 'Top 4|Top 3|Top 11|Unranked' | head -3 || true
echo

echo "==[15] /api/cron/seo-snapshot no auth (expect 401)"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/cron/seo-snapshot

echo "==[16] /api/cron/seo-snapshot with auth (no GSC env, expect ok=false but heartbeat recorded)"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" -w "HTTP %{http_code}\n" \
  http://localhost:3000/api/cron/seo-snapshot
echo

echo "==[17] cron_runs has seo-snapshot heartbeat"
"${PG}/psql" "${POSTGRES_URL}" -c "SELECT kind, fails_total, LEFT(last_detail, 60) FROM cron_runs WHERE kind = 'seo-snapshot';"

echo "==[18] cleanup"
kill $(cat /tmp/sd-dev.pid 2>/dev/null) 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
echo "==DONE=="
