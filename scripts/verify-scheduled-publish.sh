#!/usr/bin/env bash
# Verifies the approve → scheduled → scheduled-publish flow.

set -euo pipefail

REPO="/Users/jasminebaldevraj/Desktop/statdoctor-blog/STATDOCTOR_BLOGPOSTING"
DB_NAME="statdoctor_admin_test"
DB_USER="$(whoami)"
POSTGRES_URL="postgresql://${DB_USER}@localhost:5432/${DB_NAME}"
INGEST_TOKEN="sched-verify-$$"
CRON_SECRET="sched-cron-$$"
PG="/opt/homebrew/opt/postgresql@16/bin"

echo "==[1] reset DB"
"${PG}/dropdb" --if-exists "${DB_NAME}" 2>&1 || true
"${PG}/createdb" "${DB_NAME}"

echo "==[2] boot dev"
cd "${REPO}/extracted"
pkill -f "next dev" 2>/dev/null || true
sleep 1
mkdir -p /tmp/sd-publish-test; rm -f /tmp/sd-publish-test/*.json 2>/dev/null || true
: > /tmp/sd-dev.log
POSTGRES_URL="${POSTGRES_URL}" \
  INGEST_TOKEN="${INGEST_TOKEN}" \
  CRON_SECRET="${CRON_SECRET}" \
  WEBSITE_POSTS_DIR=/tmp/sd-publish-test \
  ADMIN_TOKEN= \
  pnpm dev > /tmp/sd-dev.log 2>&1 &
echo $! > /tmp/sd-dev.pid
until grep -qE "Ready in|Failed|EADDRINUSE" /tmp/sd-dev.log 2>/dev/null; do sleep 1; done
echo "(ready)"

echo "==[3] migrate"
curl -sS -X POST http://localhost:3000/api/admin/migrate; echo

echo "==[4] ingest a clean post (validators all pass)"
python3 - > /tmp/sd-ingest.json <<'PY'
import json
from datetime import datetime, timezone
gen = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
post = {
    "title": "Locum Work in Sydney — A Test Post",
    "slug": "locum-work-in-sydney-test",
    "meta_title": "Locum Work in Sydney",
    "meta_description": "A$1600/day senior locum rates in Sydney for 2026.",
    "focus_keyword": "locum work sydney",
    "og_image_alt": "Sydney public hospital ward.",
    "content_markdown": "**TL;DR:** test\n\n## Background\n[AHPRA](https://www.ahpra.gov.au/) is the entry point.\n\n> [KEY FACTS] These figures come from AIHW.\n\n> [INFO] Refer to [AIHW data](https://www.aihw.gov.au/).\n\n> [AU] [NSW Health](https://www.health.gov.au/) sets the floor.\n\n> [KEY TAKEAWAY] DB ingest works.\n\n## Pay\n\n| Tier | Daily |\n| --- | --- |\n| Junior | A$1100 |\n| Senior | A$1600 |\n\n## FAQ\n\n### Q1?\nA1.\n\n### Q2?\nA2.\n\n### Q3?\nA3.\n\n### Q4?\nA4.\n\n## Sources\n",
    "tldr": "Test post",
    "pillar": "locum_pay_rates",
    "content_type": "guide",
    "target_keywords": ["locum work sydney"],
    "keywords": ["locum work sydney", "ahpra", "aihw"],
    "twitter_card": None,
    "word_count": 1600,
    "reading_time_minutes": 8,
    "sources": [
        {"title": "AHPRA", "url": "https://www.ahpra.gov.au/", "publisher": "AHPRA", "snippet": ""},
        {"title": "AIHW", "url": "https://www.aihw.gov.au/", "publisher": "AIHW", "snippet": ""},
        {"title": "Department of Health", "url": "https://www.health.gov.au/", "publisher": "Department of Health", "snippet": ""},
        {"title": "The Guardian", "url": "https://www.theguardian.com/society/locum-rates", "publisher": "The Guardian", "snippet": ""},
    ],
    "image_url": None, "image_credit": None,
    "faq_json_ld": {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        # 8 entries — meets the guide floor (validators.json faq_floors.guide=8, M4 / B5).
        {"@type": "Question", "name": f"Q{i}?", "acceptedAnswer": {"@type": "Answer", "text": f"A{i}"}}
        for i in range(1, 9)
    ]},
    "medical_webpage_schema": {"@type": "MedicalWebPage"},
    "ahpra_flags": [], "ahpra_passed": True,
    "status": "pending_review", "generated_at": gen, "dateModified": gen,
}
print(json.dumps({"filename": "20260514_120000_locum-work-in-sydney-test.json", "post": post}))
PY
curl -sS -X POST -H "Authorization: Bearer ${INGEST_TOKEN}" -H "Content-Type: application/json" \
  -d @/tmp/sd-ingest.json http://localhost:3000/api/admin/ingest; echo

echo "==[5] approve — should land in 'scheduled', NOT 'published'"
curl -sS -X POST -w "HTTP %{http_code}\n" http://localhost:3000/api/posts/locum-work-in-sydney-test/approve
"${PG}/psql" "${POSTGRES_URL}" -c "SELECT slug, status FROM posts;"

echo "==[6] check the publish target is EMPTY (no immediate publish)"
ls /tmp/sd-publish-test/

echo "==[7] hit scheduler — should no-op on non-publish weekday"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/scheduled-publish; echo

echo "==[8] hit scheduler with ?force=1 — should publish"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" "http://localhost:3000/api/cron/scheduled-publish?force=1"; echo
"${PG}/psql" "${POSTGRES_URL}" -c "SELECT slug, status FROM posts;"
ls /tmp/sd-publish-test/

echo "==[8a] running force again — queue is empty, should report empty_queue"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" "http://localhost:3000/api/cron/scheduled-publish?force=1"; echo

echo "==[9] cleanup"
kill $(cat /tmp/sd-dev.pid 2>/dev/null) 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
echo "==DONE=="
