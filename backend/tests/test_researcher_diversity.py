"""Tests for M6 / Bug B7: researcher publisher-diversity gate.

The admin-side `sources` validator requires:
- ≥3 distinct publishers, AND
- ≥1 authoritative source (host in validators.json authoritative_domains).

Pre-M6 the researcher only checked `len(sources) >= MIN_OK_SOURCES`, so it
shipped articles with 5 Guardian-only sources that then failed the validator
silently and stuck the queue. This test suite exercises the new gate helpers
directly (they are pure functions; the larger re-broaden integration is exercised
in the existing test_researcher.py fixtures).
"""
from __future__ import annotations

import pytest

from agents import researcher as r
from agents.researcher import (
    _diversity_gate_passed,
    _distinct_publishers,
    _hostname_of,
    _is_authoritative,
)
from models import Source


def _src(publisher: str, url: str, title: str = "T") -> Source:
    return Source(title=title, url=url, publisher=publisher)


# ── _hostname_of ──────────────────────────────────────────────────────────────


class TestHostnameOf:
    def test_strips_www_and_lowercases(self):
        assert _hostname_of("https://www.AIHW.GOV.AU/data/x") == "aihw.gov.au"

    def test_handles_paths_and_queries(self):
        assert (
            _hostname_of("https://racgp.org.au/news/2024?ref=stat")
            == "racgp.org.au"
        )

    def test_invalid_url_returns_empty(self):
        assert _hostname_of("not a url") == ""
        assert _hostname_of("") == ""


# ── _is_authoritative ─────────────────────────────────────────────────────────


class TestIsAuthoritative:
    def test_top_level_authoritative_domain(self):
        assert _is_authoritative(_src("AIHW", "https://www.aihw.gov.au/x")) is True
        assert _is_authoritative(_src("AHPRA", "https://www.ahpra.gov.au/y")) is True

    def test_subdomain_of_authoritative_domain(self):
        # Subdomains of authoritative domains count (e.g., apo.health.gov.au).
        assert _is_authoritative(
            _src("Department of Health", "https://apo.health.gov.au/study")
        ) is True

    def test_non_authoritative_domain(self):
        assert _is_authoritative(_src("The Guardian", "https://www.theguardian.com/x")) is False
        assert _is_authoritative(_src("ABC", "https://www.abc.net.au/news/y")) is False

    def test_blank_url_is_not_authoritative(self):
        assert _is_authoritative(_src("X", "")) is False


# ── _distinct_publishers ──────────────────────────────────────────────────────


class TestDistinctPublishers:
    def test_counts_unique_publishers(self):
        sources = [
            _src("The Guardian", "https://www.theguardian.com/1"),
            _src("The Guardian", "https://www.theguardian.com/2"),
            _src("AIHW", "https://www.aihw.gov.au/x"),
            _src("AHPRA", "https://www.ahpra.gov.au/y"),
        ]
        assert _distinct_publishers(sources) == 3

    def test_strips_whitespace_and_ignores_empty(self):
        sources = [
            _src("  The Guardian  ", "https://x.example/1"),
            _src("The Guardian", "https://x.example/2"),
            _src("", "https://x.example/3"),
            _src("   ", "https://x.example/4"),
        ]
        assert _distinct_publishers(sources) == 1


# ── _diversity_gate_passed ────────────────────────────────────────────────────


class TestDiversityGate:
    def test_five_guardian_only_fails(self):
        """Pre-M6 the researcher would proceed here; post-M6 it re-broadens."""
        sources = [
            _src("The Guardian", f"https://www.theguardian.com/{i}") for i in range(5)
        ]
        passed, reason = _diversity_gate_passed(sources)
        assert passed is False
        assert "distinct publisher" in reason.lower()

    def test_five_mixed_publishers_no_authoritative_fails(self):
        sources = [
            _src("The Guardian", "https://www.theguardian.com/1"),
            _src("ABC", "https://www.abc.net.au/2"),
            _src("SMH", "https://www.smh.com.au/3"),
            _src("Reuters", "https://www.reuters.com/4"),
            _src("BBC", "https://www.bbc.com/5"),
        ]
        passed, reason = _diversity_gate_passed(sources)
        assert passed is False
        assert "authoritative" in reason.lower()

    def test_diverse_with_authoritative_passes(self):
        sources = [
            _src("The Guardian", "https://www.theguardian.com/1"),
            _src("ABC", "https://www.abc.net.au/2"),
            _src("AIHW", "https://www.aihw.gov.au/3"),
            _src("AHPRA", "https://www.ahpra.gov.au/4"),
            _src("RACGP", "https://www.racgp.org.au/5"),
        ]
        passed, _ = _diversity_gate_passed(sources)
        assert passed is True

    def test_below_min_ok_sources_fails_even_with_authority(self):
        sources = [
            _src("AIHW", "https://www.aihw.gov.au/1"),
            _src("AHPRA", "https://www.ahpra.gov.au/2"),
            _src("RACGP", "https://www.racgp.org.au/3"),
        ]
        passed, reason = _diversity_gate_passed(sources)
        assert passed is False
        assert "5" in reason  # mentions MIN_OK_SOURCES
