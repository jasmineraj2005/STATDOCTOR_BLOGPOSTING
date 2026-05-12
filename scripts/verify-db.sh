#!/usr/bin/env bash
# End-to-end DB verification for the /admin/posts pipeline.
# Assumes: local Postgres running on default port; extracted/ dev server starting fresh.

set -euo pipefail

REPO="/Users/jasminebaldevraj/Desktop/statdoctor-blog/STATDOCTOR_BLOGPOSTING"
DB_NAME="statdoctor_admin_test"
DB_USER="$(whoami)"
POSTGRES_URL="postgresql://${DB_USER}@localhost:5432/${DB_NAME}"
INGEST_TOKEN="test-ingest-token-$$"

echo "==[1] (re)create database ${DB_NAME}"
dropdb --if-exists "${DB_NAME}" 2>&1 || true
createdb "${DB_NAME}"

echo "==[2] boot dev server with POSTGRES_URL + INGEST_TOKEN + WEBSITE_POSTS_DIR"
cd "${REPO}/extracted"
pkill -f "next dev" 2>/dev/null || true
sleep 1
mkdir -p /tmp/sd-publish-test
rm -f /tmp/sd-publish-test/*.json 2>/dev/null || true
: > /tmp/sd-dev.log
POSTGRES_URL="${POSTGRES_URL}" INGEST_TOKEN="${INGEST_TOKEN}" WEBSITE_POSTS_DIR=/tmp/sd-publish-test \
  pnpm dev > /tmp/sd-dev.log 2>&1 &
echo $! > /tmp/sd-dev.pid

until grep -qE "Ready in|Failed|EADDRINUSE" /tmp/sd-dev.log 2>/dev/null; do sleep 1; done
echo "(server ready)"
grep -E "Ready in|Failed|EADDRINUSE" /tmp/sd-dev.log

echo
echo "==[3] apply schema via /api/admin/migrate"
curl -sS -X POST -o /tmp/sd-m.json -w "HTTP %{http_code}\n" http://localhost:3000/api/admin/migrate
cat /tmp/sd-m.json; echo

echo
echo "==[4] confirm tables exist in DB"
psql "${POSTGRES_URL}" -c "\dt" 2>&1 | head -10

echo
echo "==[5] push a fake article via /api/admin/ingest"
cat > /tmp/sd-ingest.json <<'JSON'
{
  "filename": "20260512_120000_sydney-locum-test-post.json",
  "post": {
    "title": "Sydney Locum Test Post",
    "slug": "sydney-locum-test-post",
    "meta_title": "Sydney Locum Test Post",
    "meta_description": "A$1600/day test post for verifying the DB ingest path on the StatDoctor dashboard.",
    "focus_keyword": "locum work sydney",
    "og_image_alt": "Locum doctor at a Sydney public hospital ward — test scene.",
    "content_markdown": "**TL;DR:** test\n\n## Background\n\n[AHPRA registration](https://www.ahpra.gov.au/) is the entry point.\n\n> [KEY FACTS] These figures are placeholders.\n\n> [INFO] Refer to [AIHW data](https://www.aihw.gov.au/) when planning.\n\n> [AU] In NSW the public-sector rate floor is set by [NSW Health](https://www.health.nsw.gov.au/).\n\n> [KEY TAKEAWAY] DB ingest works end-to-end.\n\n## Pay\n\n| Tier | Daily |\n| --- | --- |\n| Junior | A$1100 |\n| Senior | A$1600 |\n\n## FAQ\n\n### Q1?\nAnswer.\n\n### Q2?\nAnswer.\n\n### Q3?\nAnswer.\n\n### Q4?\nAnswer.\n\n## Sources\n1. AHPRA — https://www.ahpra.gov.au/\n2. AIHW — https://www.aihw.gov.au/\n3. NSW Health — https://www.health.nsw.gov.au/\n",
    "tldr": "Test post",
    "pillar": "locum_pay_rates",
    "content_type": "guide",
    "target_keywords": ["locum work sydney"],
    "keywords": ["locum work sydney", "ahpra", "aihw", "nsw"],
    "twitter_card": null,
    "word_count": 1600,
    "reading_time_minutes": 8,
    "sources": [
      {"title": "AHPRA", "url": "https://www.ahpra.gov.au/", "publisher": "AHPRA", "snippet": "x"},
      {"title": "AIHW", "url": "https://www.aihw.gov.au/", "publisher": "AIHW", "snippet": "x"},
      {"title": "NSW Health", "url": "https://www.health.nsw.gov.au/", "publisher": "NSW Health", "snippet": "x"}
    ],
    "image_url": null,
    "image_credit": null,
    "faq_json_ld": {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Q1?","acceptedAnswer":{"@type":"Answer","text":"A1"}},{"@type":"Question","name":"Q2?","acceptedAnswer":{"@type":"Answer","text":"A2"}},{"@type":"Question","name":"Q3?","acceptedAnswer":{"@type":"Answer","text":"A3"}},{"@type":"Question","name":"Q4?","acceptedAnswer":{"@type":"Answer","text":"A4"}}]},
    "medical_webpage_schema": {"@type":"MedicalWebPage"},
    "ahpra_flags": [],
    "ahpra_passed": true,
    "status": "pending_review",
    "generated_at": "2026-05-12T12:00:00Z",
    "dateModified": "2026-05-12T12:00:00Z"
  }
}
JSON
curl -sS -X POST -H "Authorization: Bearer ${INGEST_TOKEN}" -H "Content-Type: application/json" \
  -d @/tmp/sd-ingest.json -o /tmp/sd-iresp.json -w "HTTP %{http_code}\n" \
  http://localhost:3000/api/admin/ingest
cat /tmp/sd-iresp.json; echo

echo
echo "==[6] DB row exists?"
psql "${POSTGRES_URL}" -c "SELECT slug, status, content_type, word_count FROM posts;"

echo
echo "==[7] /admin/posts now lists 5 pending (4 fs + 1 DB)? — actually DB mode means only DB"
curl -sS http://localhost:3000/admin/posts | grep -oE 'class="display text-xl[^"]*">[^<]+' | head -5
echo "(expecting at least 'Sydney Locum Test Post')"

echo
echo "==[8] Approve it"
curl -sS -X POST -o /tmp/sd-app.json -w "HTTP %{http_code}\n" \
  http://localhost:3000/api/posts/sydney-locum-test-post/approve
cat /tmp/sd-app.json; echo

echo
echo "==[9] Post should now be 'published' in DB"
psql "${POSTGRES_URL}" -c "SELECT slug, status, last_reviewed_at IS NOT NULL AS reviewed FROM posts;"

echo
echo "==[10] Approve must have written a JSON to WEBSITE_POSTS_DIR"
ls -la /tmp/sd-publish-test/ 2>&1

echo
echo "==[11] audit_events has 'publish' row"
psql "${POSTGRES_URL}" -c "SELECT action, slug, detail FROM audit_events ORDER BY ts DESC LIMIT 5;"

echo
echo "==[12] cleanup: stop dev"
kill $(cat /tmp/sd-dev.pid 2>/dev/null) 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true

echo
echo "==DONE=="
