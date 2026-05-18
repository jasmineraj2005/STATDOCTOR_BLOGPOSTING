"""Tests for M5 / Bugs B3 + B4: AHPRA chunked scan and source-proximity auto-resolve.

Covers:
- _iter_chunks: single window when AHPRA_CHUNKED_SCAN=off; sliding overlap when on.
- _has_source_near_excerpt: returns URL when within window; None when far.
- check_ahpra: GPT scan now sees the whole article (Bug B3) — caught a planted
  banned phrase at char 8,000 in a 12,000-char post.
- check_ahpra: unsupported_stat auto-resolves when a source URL sits within
  ±200 chars of the flagged excerpt (Bug B4).
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agents import ahpra as ahpra_mod
from agents.ahpra import (
    _has_source_near_excerpt,
    _iter_chunks,
    check_ahpra,
)
from models import Source


# ── _iter_chunks ──────────────────────────────────────────────────────────────


class TestIterChunks:
    def test_single_chunk_when_kill_switch_off(self, monkeypatch):
        monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", False)
        chunks = _iter_chunks("x" * 6000)
        assert len(chunks) == 1
        assert chunks[0][0] == 0
        # Legacy first-2500 behaviour
        assert chunks[0][1] == ahpra_mod.AHPRA_CHUNK_SIZE

    def test_multiple_chunks_with_overlap_when_on(self, monkeypatch):
        monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", True)
        chunks = _iter_chunks("x" * 6000)
        assert len(chunks) > 1
        # Adjacent chunks must overlap by AHPRA_CHUNK_OVERLAP
        step = ahpra_mod.AHPRA_CHUNK_SIZE - ahpra_mod.AHPRA_CHUNK_OVERLAP
        assert chunks[1][0] == step
        # Final chunk ends at content length
        assert chunks[-1][1] == 6000

    def test_short_content_single_chunk(self, monkeypatch):
        monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", True)
        chunks = _iter_chunks("short")
        assert len(chunks) == 1
        assert chunks[0] == (0, len("short"), "short")

    def test_empty_content(self, monkeypatch):
        monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", True)
        assert _iter_chunks("") == []


# ── _has_source_near_excerpt ──────────────────────────────────────────────────


class TestSourceNearExcerpt:
    def test_returns_url_when_within_window(self):
        url = "https://www.abs.gov.au/statistics/health/2023"
        content = (
            "Locum pay rose 12 percent in 2023, with senior emergency rates "
            "topping A$2,000 per shift in capital cities. "
            f"See {url} for the source data."
        )
        result = _has_source_near_excerpt(
            content=content,
            excerpt="Locum pay rose 12 percent in 2023",
            source_urls=[url],
        )
        assert result == url

    def test_returns_none_when_url_is_far(self):
        url = "https://www.abs.gov.au/statistics/health/2023"
        # Pad the URL far away (more than ±200 chars).
        content = (
            "Locum pay rose 12 percent in 2023."
            + ("x" * 500)
            + f"Cited at {url} much later."
        )
        result = _has_source_near_excerpt(
            content=content,
            excerpt="Locum pay rose 12 percent in 2023",
            source_urls=[url],
        )
        assert result is None

    def test_returns_none_for_empty_excerpt(self):
        assert _has_source_near_excerpt("body", "", ["https://x.example"]) is None

    def test_returns_none_for_empty_url_list(self):
        assert _has_source_near_excerpt("body excerpt", "excerpt", []) is None

    def test_returns_none_when_excerpt_not_in_content(self):
        assert _has_source_near_excerpt(
            "body has this", "missing excerpt", ["https://x.example"]
        ) is None


# ── check_ahpra end-to-end (mocked GPT) ───────────────────────────────────────


@pytest.fixture
def mocked_gpt(monkeypatch):
    """Hand-rolled per-test fake. Stores call args so tests can introspect."""
    calls: list[dict] = []

    def make_fake(response_factory):
        """response_factory: callable(prompt_text, chunk_idx) -> dict for JSON response."""

        def fake_create(*args, model=None, messages=None, **kwargs):
            prompt = messages[0]["content"]
            calls.append({"prompt": prompt, "model": model})
            data = response_factory(prompt, len(calls) - 1)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(data)))]
            )

        monkeypatch.setattr(ahpra_mod.client.chat.completions, "create", fake_create)
        return calls

    return make_fake


def test_b3_gpt_scans_full_article_not_just_first_2500(monkeypatch, mocked_gpt):
    """Bug B3: a banned phrase at char 8,000 of a 12,000-char post MUST be seen by GPT.

    Pre-M5: ``content[:2500]`` meant only the first chunk was scanned. Now every
    chunk is scanned and one will contain the planted phrase.
    """
    monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", True)

    # Build a 12,000-char article. Plant a marker at ~char 8,000.
    BANNED_LINE = "We are Australia's leading marketplace for locum doctors."
    body = "Locum doctors fill rostering gaps. " * 200
    assert len(body) > 4000
    # Insert the banned phrase at char ~8000 via a unique marker.
    idx = 8000
    article = body[:idx] + BANNED_LINE + body[idx:]
    article = article[:12000].ljust(12000, " ")  # trim/pad to 12,000
    assert len(article) == 12000

    # The regex scan at step 1 will catch it (since Australia's leading is in
    # validators.json). The GPT scan would NOT catch it pre-M5 because chunk 1
    # ends at 2500. Verify here that the chunking surfaces a GPT scan covering
    # the chunk that contains the planted line.
    def factory(prompt, idx_):
        return {
            "issues": [],
            "assessment": "PASS",
            "notes": f"chunk {idx_} clean",
        }

    calls = mocked_gpt(factory)
    cleaned, flags, _ = check_ahpra(article)

    # GPT was called on every chunk — at least one chunk must cover char 8,000.
    assert len(calls) >= 4, f"expected multiple chunks for 12,000-char post, got {len(calls)}"
    chunk_covering_8000 = any(BANNED_LINE in c["prompt"] for c in calls)
    assert chunk_covering_8000, "no GPT chunk covered the planted banned phrase"


def test_b3_kill_switch_falls_back_to_single_window(monkeypatch, mocked_gpt):
    """When AHPRA_CHUNKED_SCAN=off the legacy single-window behaviour is preserved."""
    monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", False)

    article = "x" * 9000
    calls = mocked_gpt(lambda p, i: {"issues": [], "assessment": "PASS"})
    check_ahpra(article)

    assert len(calls) == 1, "kill switch should produce a single GPT call (legacy behaviour)"


def test_b4_unsupported_stat_auto_resolves_when_source_is_nearby(monkeypatch, mocked_gpt):
    """Bug B4: an unsupported_stat flag whose excerpt sits near a source URL
    auto-resolves to requires_human_review=False.
    """
    monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", False)  # one chunk keeps test simple

    url = "https://www.abs.gov.au/statistics/labour-force/health-workforce/2023"
    article_body = (
        "## Background\n\n"
        "Locum pay rose 12 percent in 2023, with senior emergency rates "
        "topping A$2,000 per shift in capital cities. "
        f"Source: [ABS Labour Force Health Workforce]({url}).\n"
        "\n## Sources\n"
    )
    sources = [
        Source(title="ABS", url=url, publisher="ABS"),
    ]

    def factory(prompt, idx_):
        return {
            "issues": [
                {
                    "flag_type": "unsupported_stat",
                    "excerpt": "Locum pay rose 12 percent in 2023",
                    "fix_applied": "Cite a source.",
                    "requires_human_review": True,
                }
            ],
            "assessment": "REVIEW",
            "notes": "stat needs citation",
        }

    mocked_gpt(factory)
    _, flags, passed = check_ahpra(article_body, sources=sources)

    stat_flags = [f for f in flags if f.flag_type == "unsupported_stat"]
    assert len(stat_flags) == 1
    assert stat_flags[0].requires_human_review is False, (
        "unsupported_stat should auto-resolve when source URL is within ±200 chars"
    )
    assert "Auto-cited" in stat_flags[0].fix_applied
    # passed=True because the only flag is now non-blocking
    assert passed is True


def test_b4_unsupported_stat_stays_flagged_when_no_source_nearby(monkeypatch, mocked_gpt):
    monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", False)

    url = "https://www.abs.gov.au/elsewhere"
    article_body = (
        "## Background\n\n"
        "Locum pay rose 12 percent in 2023.\n\n"
        + ("Filler paragraph. " * 50)  # >200 chars between stat and source
        + f"Source: [ABS]({url})"
    )
    sources = [Source(title="ABS", url=url, publisher="ABS")]

    def factory(prompt, idx_):
        return {
            "issues": [
                {
                    "flag_type": "unsupported_stat",
                    "excerpt": "Locum pay rose 12 percent in 2023",
                    "fix_applied": "Cite a source.",
                    "requires_human_review": True,
                }
            ],
            "assessment": "REVIEW",
            "notes": "stat needs citation",
        }

    mocked_gpt(factory)
    _, flags, passed = check_ahpra(article_body, sources=sources)

    stat_flags = [f for f in flags if f.flag_type == "unsupported_stat"]
    assert stat_flags[0].requires_human_review is True
    assert passed is False  # blocking flag still present


def test_check_ahpra_accepts_no_sources_kwarg_for_back_compat(monkeypatch, mocked_gpt):
    """Older call sites that don't pass `sources=` keep working."""
    monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", False)
    mocked_gpt(lambda p, i: {"issues": [], "assessment": "PASS"})
    cleaned, flags, passed = check_ahpra("Some safe content body.")
    # Disclaimer auto-inject adds a non-blocking flag; passed should still be True.
    assert passed is True


def test_dedup_across_chunk_overlap(monkeypatch, mocked_gpt):
    """If two adjacent chunks both surface the same excerpt, dedup to one flag."""
    monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", True)
    article = "x" * 5500  # at least 2 chunks

    def factory(prompt, idx_):
        return {
            "issues": [
                {
                    "flag_type": "forbidden_claim",
                    "excerpt": "duplicate stub",
                    "fix_applied": "...",
                    "requires_human_review": True,
                }
            ],
            "assessment": "REVIEW",
        }

    mocked_gpt(factory)
    _, flags, _ = check_ahpra(article)
    # Only one flag with that exact excerpt
    matches = [f for f in flags if f.excerpt == "duplicate stub"]
    assert len(matches) == 1
