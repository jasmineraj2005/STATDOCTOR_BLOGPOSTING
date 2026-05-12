#!/usr/bin/env bash
# Focused verification for /api/cron/auto-publish-news.
# Prereq: brew services postgresql@16 is running.

set -euo pipefail

REPO="/Users/jasminebaldevraj/Desktop/statdoctor-blog/STATDOCTOR_BLOGPOSTING"
DB_NAME="statdoctor_admin_test"
DB_USER="$(whoami)"
POSTGRES_URL="postgresql://${DB_USER}@localhost:5432/${DB_NAME}"
INGEST_TOKEN="verify-ingest-token-$$"
CRON_SECRET="verify-cron-secret-$$"
PSQL="/opt/homebrew/opt/postgresql@16/bin/psql"

echo "==[1] reset database"
"/opt/homebrew/opt/postgresql@16/bin/dropdb" --if-exists "${DB_NAME}" 2>&1 || true
"/opt/homebrew/opt/postgresql@16/bin/createdb" "${DB_NAME}"

echo "==[2] boot dev server"
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
  AUTO_PUBLISH_NEWS_HOURS=48 \
  pnpm dev > /tmp/sd-dev.log 2>&1 &
echo $! > /tmp/sd-dev.pid
until grep -qE "Ready in|Failed|EADDRINUSE" /tmp/sd-dev.log 2>/dev/null; do sleep 1; done
echo "(server ready)"

echo "==[3] apply migration"
curl -sS -X POST http://localhost:3000/api/admin/migrate
echo

echo "==[4] ingest a NEWS post with generated_at 50h ago"
python3 - > /tmp/sd-stale-news.json <<'PY'
import json
from datetime import datetime, timezone, timedelta
gen = (datetime.now(timezone.utc) - timedelta(hours=50)).strftime("%Y-%m-%dT%H:%M:%SZ")
post = {
    "title": "Geelong Fuel Price Spike Hits Medicare Billing Margins",
    "slug": "geelong-fuel-price-spike-medicare-impact",
    "meta_title": "Geelong Fuel Spike: Locum Margins",
    "meta_description": "A$1.85/L fuel = ~A$140/wk hit for a rural NSW locum in March 2026.",
    "focus_keyword": "geelong fuel locum",
    "og_image_alt": "Geelong refinery aerial at dawn — fuel pricing scene.",
    "content_markdown": "**TL;DR:** test stale news.\n\n## Background\n[AHPRA](https://www.ahpra.gov.au/) regulates fees.\n\n> [KEY FACTS] AIHW workforce data 2026.\n\n> [INFO] See [AIHW](https://www.aihw.gov.au/) reports.\n\n> [AU] [NSW Health](https://www.health.nsw.gov.au/) on rural support.\n\n## Impact\n\n| Tier | Daily |\n| --- | --- |\n| Junior | A$1100 |\n| Senior | A$1600 |\n\n## FAQ\n\n### Q1?\nA1.\n\n### Q2?\nA2.\n\n### Q3?\nA3.\n\n### Q4?\nA4.\n\n## Sources\n",
    "tldr": "Stale news test.",
    "pillar": "industry_news",
    "content_type": "news",
    "target_keywords": ["geelong fuel locum"],
    "keywords": ["geelong fuel locum", "ahpra", "aihw"],
    "twitter_card": None,
    "word_count": 1700,
    "reading_time_minutes": 8,
    "sources": [
        {"title": "AHPRA", "url": "https://www.ahpra.gov.au/", "publisher": "AHPRA", "snippet": ""},
        {"title": "AIHW", "url": "https://www.aihw.gov.au/", "publisher": "AIHW", "snippet": ""},
        {"title": "NSW Health", "url": "https://www.health.nsw.gov.au/", "publisher": "NSW Health", "snippet": ""}
    ],
    "image_url": None,
    "image_credit": None,
    "faq_json_ld": {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": "Q1?", "acceptedAnswer": {"@type": "Answer", "text": "A1"}},
        {"@type": "Question", "name": "Q2?", "acceptedAnswer": {"@type": "Answer", "text": "A2"}},
        {"@type": "Question", "name": "Q3?", "acceptedAnswer": {"@type": "Answer", "text": "A3"}},
        {"@type": "Question", "name": "Q4?", "acceptedAnswer": {"@type": "Answer", "text": "A4"}},
    ]},
    "medical_webpage_schema": {"@type": "MedicalWebPage"},
    "ahpra_flags": [],
    "ahpra_passed": True,
    "status": "pending_review",
    "generated_at": gen,
    "dateModified": gen,
}
print(json.dumps({"filename": "20260510_120000_geelong-fuel-price-spike-medicare-impact.json", "post": post}))
PY
curl -sS -X POST -H "Authorization: Bearer ${INGEST_TOKEN}" -H "Content-Type: application/json" \
  -d @/tmp/sd-stale-news.json -o /tmp/sd-stale-resp.json -w "HTTP %{http_code}\n" \
  http://localhost:3000/api/admin/ingest
cat /tmp/sd-stale-resp.json; echo

echo "==[5] confirm row inserted as pending_review"
"$PSQL" "${POSTGRES_URL}" -c "SELECT slug, status, content_type, generated_at < NOW() - INTERVAL '48 hours' AS stale FROM posts;"

echo "==[6] hit auto-publish-news WITHOUT auth (expect 401)"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/cron/auto-publish-news

echo "==[7] hit auto-publish-news with correct token"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" \
  -o /tmp/sd-ap.json -w "HTTP %{http_code}\n" \
  http://localhost:3000/api/cron/auto-publish-news
cat /tmp/sd-ap.json; echo

echo "==[8] status should now be 'published', JSON should exist in publish dir"
"$PSQL" "${POSTGRES_URL}" -c "SELECT slug, status, last_reviewed_at IS NOT NULL AS reviewed FROM posts;"
ls -la /tmp/sd-publish-test/

echo "==[9] audit_events should have a publish row with 'auto-publish' detail"
"$PSQL" "${POSTGRES_URL}" -c "SELECT action, slug, LEFT(detail, 80) AS detail_preview FROM audit_events ORDER BY ts DESC LIMIT 5;"

echo "==[10] running it again should be a no-op (no candidates)"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/auto-publish-news
echo

echo "==[11] cleanup"
kill $(cat /tmp/sd-dev.pid 2>/dev/null) 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true

echo
echo "==DONE=="
