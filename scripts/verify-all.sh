#!/usr/bin/env bash
# One-shot end-to-end verification. Runs every verify-*.sh in sequence
# against the local Postgres. Exits non-zero on the first failure.
#
# Prereq: brew services postgresql@16 running.
# Use:    ./scripts/verify-all.sh

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS=(
  "verify-db.sh"
  "verify-scheduled-publish.sh"
  "verify-health-digest.sh"
  "verify-seo-dashboard.sh"
)

passed=0
failed=()
started=$(date -u +%s)

echo
echo "════════════════════════════════════════════════════════════════"
echo "  StatDoctor blog — end-to-end verification"
echo "════════════════════════════════════════════════════════════════"

for s in "${SCRIPTS[@]}"; do
  echo
  echo "──────────────────────────────────────────────────────────────"
  echo "  ▶ ${s}"
  echo "──────────────────────────────────────────────────────────────"
  if bash "${REPO}/scripts/${s}" > "/tmp/sd-verify-${s}.log" 2>&1; then
    passed=$((passed + 1))
    echo "  ✓ ${s} passed"
  else
    failed+=("${s}")
    echo "  ✗ ${s} FAILED — last 30 lines:"
    tail -30 "/tmp/sd-verify-${s}.log" | sed 's/^/    /'
  fi
done

echo
echo "── Vitest (unit tests for validators) ────────────────────────"
if (cd "${REPO}/extracted" && pnpm test 2>&1 | tail -10); then
  passed=$((passed + 1))
  echo "  ✓ vitest passed"
else
  failed+=("vitest")
  echo "  ✗ vitest FAILED"
fi

# pytest is optional — only run if backend/.venv exists with pytest installed.
if [ -x "${REPO}/backend/.venv/bin/pytest" ] || command -v pytest >/dev/null 2>&1; then
  echo
  echo "── pytest (backend AHPRA agent) ──────────────────────────────"
  if (cd "${REPO}/backend" && python3 -m pytest -q 2>&1 | tail -20); then
    passed=$((passed + 1))
    echo "  ✓ pytest passed"
  else
    failed+=("pytest")
    echo "  ✗ pytest FAILED"
  fi
else
  echo
  echo "── pytest (skipped — install with: pip install pytest in backend/) ──"
fi

elapsed=$(( $(date -u +%s) - started ))
echo
echo "════════════════════════════════════════════════════════════════"
echo "  ${passed} passed · ${#failed[@]} failed · ${elapsed}s"
if [ ${#failed[@]} -gt 0 ]; then
  echo "  failures: ${failed[*]}"
  echo "════════════════════════════════════════════════════════════════"
  exit 1
fi
echo "  All green — system is healthy end-to-end."
echo "════════════════════════════════════════════════════════════════"
