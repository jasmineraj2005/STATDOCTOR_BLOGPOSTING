"""
backend/validation/urls.py — M1.T2

Three entry-points:
  is_whitelisted(url)              — fast whitelist gate (subdomain-aware)
  head_check(url, ...)             — injectable HEAD request with retry + reasons
  validate_sources(sources, ...)   — parallel whitelist + reachability filter
"""

from __future__ import annotations

import concurrent.futures
import json
import time as _time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional
from urllib.parse import urlparse

import httpx

# ---------------------------------------------------------------------------
# Module-level: load whitelist once at import time
# ---------------------------------------------------------------------------

def _find_whitelist() -> Path:
    """Walk up from this file until data/url-whitelist.json is found."""
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        candidate = parent / "data" / "url-whitelist.json"
        if candidate.exists():
            return candidate
    raise ImportError(
        "Could not find data/url-whitelist.json by walking up from "
        f"{__file__}. Make sure the repo root contains data/url-whitelist.json "
        "(created in M1.T1, commit 492c4d1)."
    )


_WHITELIST_PATH = _find_whitelist()
_WHITELIST_DATA = json.loads(_WHITELIST_PATH.read_text())
# Set of bare domain strings for O(1) lookup, all lower-case
_WHITELISTED_DOMAINS: frozenset[str] = frozenset(
    entry["domain"].lower() for entry in _WHITELIST_DATA["domains"]
)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class HeadResult:
    url: str
    ok: bool
    status: Optional[int]
    reason: str   # "ok" | "http_404" | "http_4xx" | "http_5xx" | "timeout" | "connect_error"
    attempts: int


@dataclass
class ValidationResult:
    ok_sources: List[dict]
    flags: List[dict]
    total_input: int
    total_ok: int


# ---------------------------------------------------------------------------
# is_whitelisted
# ---------------------------------------------------------------------------

def is_whitelisted(url: str) -> bool:
    """Return True if url's hostname matches (or is a subdomain of) any
    whitelisted domain. Case-insensitive. Returns False for unparseable urls.
    """
    try:
        parsed = urlparse(url)
        host = parsed.hostname  # None for un-parseable / scheme-less strings
        if not host:
            return False
        host = host.lower()
        # Strip leading www. once
        if host.startswith("www."):
            host = host[4:]
        # Direct match
        if host in _WHITELISTED_DOMAINS:
            return True
        # Subdomain match: host ends with ".<domain>"
        for domain in _WHITELISTED_DOMAINS:
            if host.endswith("." + domain):
                return True
        return False
    except Exception:
        return False


# ---------------------------------------------------------------------------
# head_check
# ---------------------------------------------------------------------------

def head_check(
    url: str,
    *,
    timeout: float = 5.0,
    retries: int = 1,
    http: Optional[httpx.Client] = None,
    sleeper: Optional[Callable[[float], None]] = None,
) -> HeadResult:
    """Issue a HEAD request, retrying on 5xx / 429 / timeout / connect_error.

    Parameters
    ----------
    url:      Target URL.
    timeout:  Per-request timeout in seconds.
    retries:  How many *extra* attempts to make after the first failure
              (so total attempts = retries + 1 at most).
    http:     Inject an httpx.Client (enables deterministic tests). If None,
              a fresh client is created with follow_redirects=True.
    sleeper:  Callable used for backoff sleep (default: time.sleep). Inject a
              MagicMock() in tests to avoid real sleeping.
    """
    _sleeper = sleeper if sleeper is not None else _time.sleep
    _owns_client = http is None
    if _owns_client:
        http = httpx.Client(follow_redirects=True, timeout=timeout)

    max_attempts = retries + 1
    last_status: Optional[int] = None
    last_reason: str = "ok"
    attempts = 0

    try:
        for attempt in range(max_attempts):
            attempts += 1
            try:
                resp = http.head(url, timeout=timeout)
                last_status = resp.status_code

                if 200 <= last_status < 400:
                    return HeadResult(
                        url=url,
                        ok=True,
                        status=last_status,
                        reason="ok",
                        attempts=attempts,
                    )
                elif last_status == 404:
                    # 404: no retry
                    return HeadResult(
                        url=url,
                        ok=False,
                        status=last_status,
                        reason="http_404",
                        attempts=attempts,
                    )
                elif last_status == 429 or last_status >= 500:
                    # 429 (rate-limited) or 5xx: retryable
                    last_reason = "http_5xx" if last_status >= 500 else "http_4xx"
                    # Will retry if attempts remain; sleep with exponential backoff
                    if attempt < max_attempts - 1:
                        _sleeper(2 ** attempt)
                elif 400 <= last_status < 500:
                    # Other 4xx (e.g. 403, 401): no retry
                    return HeadResult(
                        url=url,
                        ok=False,
                        status=last_status,
                        reason="http_4xx",
                        attempts=attempts,
                    )

            except httpx.TimeoutException:
                last_status = None
                last_reason = "timeout"
                if attempt < max_attempts - 1:
                    _sleeper(2 ** attempt)

            except httpx.ConnectError:
                last_status = None
                last_reason = "connect_error"
                if attempt < max_attempts - 1:
                    _sleeper(2 ** attempt)

        # Exhausted all attempts
        # Map 429 reason for final reporting
        if last_status == 429:
            last_reason = "http_4xx"  # keep 429 as 4xx in final result (rate-limited)
        elif last_status is not None and last_status >= 500:
            last_reason = "http_5xx"

        return HeadResult(
            url=url,
            ok=False,
            status=last_status,
            reason=last_reason,
            attempts=attempts,
        )
    finally:
        if _owns_client:
            http.close()


# ---------------------------------------------------------------------------
# validate_sources
# ---------------------------------------------------------------------------

def validate_sources(
    sources: List[dict],
    *,
    http: Optional[httpx.Client] = None,
    sleeper: Optional[Callable[[float], None]] = None,
) -> ValidationResult:
    """Validate a list of source dicts against the whitelist and via HEAD check.

    Sources are processed with whitelist first (synchronous, cheap) then
    reachability checks in parallel via ThreadPoolExecutor(max_workers=10).
    Input order is preserved in ok_sources.

    Parameters
    ----------
    sources:  List of dicts, each expected to have a 'url' key.
    http:     Shared httpx.Client to inject (tests). All threads share it
              (httpx.Client is thread-safe).
    sleeper:  Injected sleep callable (tests).
    """
    flags: List[dict] = []
    # Step 1: whitelist gate (synchronous)
    whitelisted: List[tuple[int, dict]] = []  # (original_index, source)
    for idx, source in enumerate(sources):
        url = source.get("url", "")
        if not url or not is_whitelisted(url):
            flags.append({
                "type": "source_not_in_whitelist",
                "url": url,
                "publisher": source.get("publisher", ""),
                "reason": "domain not in whitelist",
            })
        else:
            whitelisted.append((idx, source))

    if not whitelisted:
        return ValidationResult(
            ok_sources=[],
            flags=flags,
            total_input=len(sources),
            total_ok=0,
        )

    # Step 2: parallel HEAD checks
    # Use a dict to preserve order: original_index -> (source, head_result | None)
    results: dict[int, tuple[dict, Optional[HeadResult]]] = {}

    def _check(item: tuple[int, dict]) -> tuple[int, dict, HeadResult]:
        orig_idx, src = item
        result = head_check(
            src["url"],
            http=http,
            sleeper=sleeper,
        )
        return orig_idx, src, result

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(_check, item): item for item in whitelisted}
        for future in concurrent.futures.as_completed(futures):
            orig_idx, src, head_result = future.result()
            results[orig_idx] = (src, head_result)

    # Step 3: collect, preserving input order
    ok_sources: List[dict] = []
    for orig_idx, source in whitelisted:
        src, head_result = results[orig_idx]
        if head_result.ok:
            ok_sources.append(src)
        else:
            flags.append({
                "type": "source_unreachable",
                "url": src.get("url", ""),
                "publisher": src.get("publisher", ""),
                "reason": head_result.reason,
            })

    return ValidationResult(
        ok_sources=ok_sources,
        flags=flags,
        total_input=len(sources),
        total_ok=len(ok_sources),
    )
