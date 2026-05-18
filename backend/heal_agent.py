"""Heal-Agent — re-run failing-validator fixes on a queued post.

CEO clicks the "Heal" button on /admin/posts/[slug]; the Vercel function
fires this script via workflow_dispatch on `.github/workflows/heal.yml`.

Flow:
  1. GET /api/posts/[slug]/heal-data from the dashboard (needs INGEST_TOKEN; uses CRON_BASE_URL)
  2. Read validation_failures payload from the dashboard's runValidators check
  3. For each red validator, build a fix instruction and call writer.regenerate
  4. POST patched post back via /api/admin/ingest

Validators fixable today (calls writer.regenerate):
  - word_count    → "expand to at least N words"
  - banned_phrases → "remove these specific phrases: ..."
  - anchor_text   → "replace generic anchors with entity names"
  - callout_quota → "add at least N callout blocks of these types"

Out of scope for v1 (need researcher / seo re-run, not just writer):
  - sources       (researcher)
  - schema        (seo)
  - ahpra         (ahpra agent — currently emits flags during gen)

Run locally:
  python heal_agent.py <slug>
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

from agents.writer import regenerate as writer_regenerate


CRON_BASE_URL = os.environ.get("CRON_BASE_URL") or ""
INGEST_URL = os.environ.get("INGEST_URL") or (CRON_BASE_URL.rstrip("/") + "/api/admin/ingest")
INGEST_TOKEN = os.environ.get("INGEST_TOKEN") or ""
HEAL_TOKEN = os.environ.get("HEAL_TOKEN") or INGEST_TOKEN  # heal endpoint reuses ingest token


def _http_get_json(url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET", headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body)


def _http_post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={**headers, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.getcode(), resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def _current_heal_attempt(post: dict[str, Any]) -> int:
    """The dashboard returns the current heal_attempt counter via heal-data."""
    return int(post.get("heal_attempt") or 0)


def fetch_post(slug: str) -> dict[str, Any]:
    if not CRON_BASE_URL:
        raise SystemExit("CRON_BASE_URL not set; can't fetch post")
    if not HEAL_TOKEN:
        raise SystemExit("INGEST_TOKEN not set; can't authenticate")
    url = f"{CRON_BASE_URL.rstrip('/')}/api/posts/{slug}/heal-data"
    headers = {"Authorization": f"Bearer {HEAL_TOKEN}"}
    data = _http_get_json(url, headers=headers)
    if not data or not data.get("post"):
        raise SystemExit(f"heal-data response missing post: {data}")
    return data


def build_instruction(failures: list[dict[str, Any]], word_floor: int) -> str | None:
    """Combine all fixable failures into one heal prompt for writer.regenerate.

    Returns None if no failure is writer-fixable.
    """
    parts: list[str] = []
    for f in failures:
        check = f.get("check") or ""
        detail = f.get("detail") or ""
        if check == "word_count":
            parts.append(f"Expand the article to at least {word_floor} words. {detail}")
        elif check == "banned_phrases":
            parts.append(f"Remove every AHPRA-banned phrase. {detail}")
        elif check == "anchor_text":
            parts.append(
                f"Replace every generic anchor text (source/link/here/click here/read more) "
                f"with the actual entity name. {detail}"
            )
        elif check == "callout_quota":
            parts.append(
                f"Add 2 more callout blocks (e.g. [KEY FACTS], [PRO TIP], [TAKEAWAY]) "
                f"to meet the floor. {detail}"
            )
    if not parts:
        return None
    return " ".join(parts)


def heal(slug: str) -> dict[str, Any]:
    print(f"[heal] slug={slug}")
    payload = fetch_post(slug)
    post = payload["post"]
    failures = payload.get("validation_failures") or []
    word_floor = int(payload.get("word_floor") or 1500)

    print(f"[heal] {len(failures)} red validator(s): {[f.get('check') for f in failures]}")
    instruction = build_instruction(failures, word_floor=word_floor)
    if not instruction:
        return {"ok": False, "reason": "no_fixable_failures", "failures": failures}

    new_content = writer_regenerate(
        slug=slug,
        rejection_reason="heal_agent",
        original_content=post["content_markdown"],
        extra_instruction=instruction,
    )

    patched = dict(post)
    patched["content_markdown"] = new_content
    patched["word_count"] = len(new_content.split())

    ts = post.get("generated_at", "").replace("-", "").replace(":", "").replace("T", "_")[:15]
    filename = f"{ts or 'heal'}_{slug[:50]}.json"
    body = {"filename": filename, "post": patched}

    # X-Heal-Attempt increments each round-trip so /api/admin/ingest can stop
    # the heal loop after MAX_HEAL_ATTEMPTS and land the post as heal_failed.
    prior_attempts = _current_heal_attempt(payload)
    status, response = _http_post_json(
        INGEST_URL,
        body,
        {
            "Authorization": f"Bearer {INGEST_TOKEN}",
            "X-Heal-Attempt": str(prior_attempts + 1),
        },
    )
    print(f"[heal] ingest response: {status} {response[:200]}")
    return {"ok": 200 <= status < 300, "status": status, "instruction": instruction}


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python heal_agent.py <slug>")
        return 2
    result = heal(sys.argv[1])
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
