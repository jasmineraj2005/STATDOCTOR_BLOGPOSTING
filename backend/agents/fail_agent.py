"""Fail-Agent Layer A — per-agent output validators for the StatDoctor pipeline.

After each main agent (researcher, writer, SEO, AHPRA) emits output, the
corresponding validate_* function checks it against validators.json + minimum
source counts. Failures are logged to the `pipeline_runs` table so the
operator can debug.

The full retry orchestration (re-prompting the agent with the failure reason
and aborting after 2 attempts) requires each agent to accept a
`previous_failure` kwarg. That's a follow-up; this module ships the
observability layer first.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

VALIDATORS_PATH = (
    Path(__file__).resolve().parents[2] / "extracted" / "lib" / "admin" / "validators.json"
)

try:
    _CFG: dict[str, Any] = json.loads(VALIDATORS_PATH.read_text())
except FileNotFoundError:
    _CFG = {}

_WORD_FLOORS: dict[str, int] = _CFG.get("word_floors") or {
    # Fallback only if validators.json fails to load; kept in sync with that file (M5b).
    "news": 1000,
    "guide": 1500,
    "company": 1000,
}
_BANNED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(item["pattern"], re.IGNORECASE)
    for item in (_CFG.get("ahpra_banned") or [])
    if isinstance(item, dict) and isinstance(item.get("pattern"), str)
]

MIN_SOURCES = 5


@dataclass(frozen=True)
class Result:
    ok: bool
    reason: str = ""


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Read `key` from obj whether it's a dict or a pydantic model."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def validate_researcher(brief: Any) -> Result:
    """Researcher must return >= MIN_SOURCES authoritative sources."""
    sources = _get(brief, "sources") or []
    n = len(sources) if hasattr(sources, "__len__") else 0
    if n < MIN_SOURCES:
        return Result(False, f"source_count {n} below minimum {MIN_SOURCES}")
    return Result(True)


def validate_writer(draft: Any) -> Result:
    """Writer output must meet content-type-specific word floor."""
    content_type = _get(draft, "content_type") or "guide"
    if hasattr(content_type, "value"):
        content_type = content_type.value
    floor = _WORD_FLOORS.get(str(content_type), 1000)
    word_count = _get(draft, "word_count")
    if not isinstance(word_count, int) or word_count <= 0:
        markdown = _get(draft, "content_markdown") or ""
        word_count = len(markdown.split()) if markdown else 0
    if word_count < floor:
        return Result(
            False, f"word_count {word_count} below floor {floor} for content_type={content_type}"
        )
    return Result(True)


def validate_seo(seo: Any) -> Result:
    """SEO output must include meta_title + meta_description."""
    for field in ("meta_title", "meta_description"):
        value = _get(seo, field)
        if not value or not str(value).strip():
            return Result(False, f"schema: missing {field}")
    return Result(True)


def validate_ahpra(content: str | None) -> Result:
    """AHPRA pass — content must not contain any banned phrase pattern."""
    if not content:
        return Result(False, "schema: empty content_markdown")
    for pattern in _BANNED_PATTERNS:
        match = pattern.search(content)
        if match:
            return Result(False, f"banned phrase: {match.group(0).lower()}")
    return Result(True)


def new_run_id() -> str:
    return uuid.uuid4().hex


def log_run(
    run_id: str,
    agent_name: str,
    status: str,
    reason: str = "",
    retry_count: int = 0,
) -> None:
    """Log a pipeline-run row.

    Two backends, both safe to skip silently on failure:
      1. POST to dashboard /api/admin/pipeline-runs (if env set)
      2. Otherwise stdout (operator reads via GH Actions logs)
    """
    payload = {
        "run_id": run_id,
        "agent_name": agent_name,
        "status": status,
        "failure_reason": reason or None,
        "retry_count": retry_count,
    }
    print(f"[fail-agent] {json.dumps(payload)}")

    base_url = os.environ.get("CRON_BASE_URL")
    token = os.environ.get("INGEST_TOKEN")
    if not base_url or not token:
        return
    try:
        url = base_url.rstrip("/") + "/api/admin/pipeline-runs"
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=10):
            pass
    except (urllib.error.URLError, OSError, ValueError):
        # Logging must never break the pipeline.
        pass


def check_all(
    *,
    brief: Any = None,
    draft: Any = None,
    seo: Any = None,
    ahpra_content: str | None = None,
    run_id: str | None = None,
) -> list[Result]:
    """Run every validator that has input + log each result.

    Returns the list of Result objects (one per validator). Callers can decide
    to raise on any failure, or just observe.
    """
    rid = run_id or new_run_id()
    results: list[Result] = []
    checks: Iterable[tuple[str, Any, Any]] = (
        ("researcher", brief, validate_researcher),
        ("writer", draft, validate_writer),
        ("seo", seo, validate_seo),
        ("ahpra", ahpra_content, validate_ahpra),
    )
    for name, target, fn in checks:
        if target is None:
            continue
        res = fn(target)
        log_run(rid, name, "ok" if res.ok else "fail", res.reason)
        results.append(res)
    return results
