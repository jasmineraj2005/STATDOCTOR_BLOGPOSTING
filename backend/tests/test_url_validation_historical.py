"""Regression test for the historical 'fuel-prices' fabricated-source incident.

A real published article (former AGENT.md flagged 2026-05) had 5 source URLs
that the AI had hallucinated. They were 404s or off-whitelist gov domains. Locking
them in as fixtures means we cannot silently re-introduce the same regression.
"""
import os
import sys

import httpx
import pytest

# Ensure both backend dir and repo root are importable
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(_BACKEND_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from backend.validation.urls import is_whitelisted, validate_sources

# ── URLs that should be rejected by is_whitelisted (off-list domains) ───────

OFF_LIST_FABRICATED = [
    "https://www.energy.gov.au/national-fuel-security-plan",  # energy.gov.au not whitelisted
    "https://www.doh.gov.au/reports/fuel-costs-medical-supply-chains",  # doh.gov.au doesn't exist
]

@pytest.mark.parametrize("url", OFF_LIST_FABRICATED)
def test_off_whitelist_fabricated_url_is_rejected(url):
    assert is_whitelisted(url) is False, f"REGRESSION: {url} is whitelisted, but it's a historical fabrication"

# ── URLs on whitelisted domains but with fake paths (HEAD-check would 404) ──

ON_LIST_FAKE_PATH = [
    "https://www.aihw.gov.au/reports/healthcare-delivery/fuel-price-impact",
    "https://www.abs.gov.au/statistics/economic-impact-fuel-prices",
    "https://www.ama.com.au/policy/locum-support",
]

@pytest.mark.parametrize("url", ON_LIST_FAKE_PATH)
def test_on_whitelist_fake_path_passes_whitelist_but_fails_head_check(url):
    """These URLs are on whitelisted domains so is_whitelisted is True, but
    HEAD-check returns 404 — validate_sources must drop them."""
    assert is_whitelisted(url) is True, f"Expected {url} on whitelist (test premise)"
    transport = httpx.MockTransport(lambda req: httpx.Response(404))
    client = httpx.Client(transport=transport, follow_redirects=True)
    result = validate_sources(
        [{"url": url, "publisher": "Test"}],
        http=client,
    )
    assert result.ok_sources == [], f"REGRESSION: {url} not dropped despite 404 HEAD"
    assert any(f["type"] == "source_unreachable" for f in result.flags), f"missing flag for {url}"

# ── End-to-end: full fuel-prices article should produce zero ok sources ─────

def test_full_fuel_prices_article_all_5_sources_rejected():
    """The original incident article had 5 sources, all fabricated. The validator
    must reject every single one (mix of whitelist-rejection and HEAD-404)."""
    sources = [
        {"url": u, "publisher": p}
        for u, p in [
            ("https://www.aihw.gov.au/reports/healthcare-delivery/fuel-price-impact", "AIHW"),
            ("https://www.abs.gov.au/statistics/economic-impact-fuel-prices", "ABS"),
            ("https://www.ama.com.au/policy/locum-support", "AMA"),
            ("https://www.energy.gov.au/national-fuel-security-plan", "Dept of Energy"),
            ("https://www.doh.gov.au/reports/fuel-costs-medical-supply-chains", "Dept of Health"),
        ]
    ]
    transport = httpx.MockTransport(lambda req: httpx.Response(404))
    client = httpx.Client(transport=transport, follow_redirects=True)
    result = validate_sources(sources, http=client)
    assert result.ok_sources == [], "REGRESSION: at least one fuel-prices source passed validation"
    assert result.total_input == 5
    assert result.total_ok == 0
    # Each fabricated URL produces a flag (either source_not_in_whitelist or source_unreachable).
    assert len(result.flags) >= 5
