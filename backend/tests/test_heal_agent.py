"""Tests for backend/heal_agent.py.

Closes the test-coverage gap for the heal flow. The critical assertion is
`test_heal_passes_instruction_to_regenerate` — it fails today (Bug B1 in
docs/bugs.md) and turns green when M2 is implemented.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

import heal_agent
from heal_agent import build_instruction


# ── build_instruction ─────────────────────────────────────────────────────────


class TestBuildInstruction:
    def test_word_count_failure_produces_expand_message(self):
        result = build_instruction(
            failures=[{"check": "word_count", "detail": "1240 words (floor 1500)"}],
            word_floor=1500,
        )
        assert result is not None
        assert "1500 words" in result
        assert "1240 words (floor 1500)" in result

    def test_banned_phrases_failure_produces_removal_message(self):
        result = build_instruction(
            failures=[{"check": "banned_phrases", "detail": "Found: 'Australia's leading'"}],
            word_floor=1500,
        )
        assert result is not None
        assert "Remove every AHPRA-banned phrase" in result
        assert "'Australia's leading'" in result

    def test_anchor_text_failure_produces_anchor_message(self):
        result = build_instruction(
            failures=[{"check": "anchor_text", "detail": "3 generic anchors found"}],
            word_floor=1500,
        )
        assert result is not None
        assert "anchor text" in result.lower()
        assert "entity name" in result.lower()

    def test_callout_quota_failure_produces_callout_message(self):
        result = build_instruction(
            failures=[{"check": "callout_quota", "detail": "Have 2, need 4"}],
            word_floor=1500,
        )
        assert result is not None
        assert "callout" in result.lower()

    def test_multiple_failures_concatenate(self):
        result = build_instruction(
            failures=[
                {"check": "word_count", "detail": "1240 < 1500"},
                {"check": "banned_phrases", "detail": "Found: 'guaranteed results'"},
            ],
            word_floor=1500,
        )
        assert result is not None
        assert "1500 words" in result
        assert "Remove every AHPRA-banned phrase" in result
        assert "'guaranteed results'" in result

    def test_unfixable_failure_returns_none(self):
        """sources / schema / ahpra are not writer-fixable; build_instruction returns None."""
        result = build_instruction(
            failures=[{"check": "sources", "detail": "2 publishers, need 3"}],
            word_floor=1500,
        )
        assert result is None

    def test_empty_failures_returns_none(self):
        assert build_instruction(failures=[], word_floor=1500) is None


# ── heal() end-to-end with mocked I/O ─────────────────────────────────────────


@pytest.fixture
def heal_fixture_payload() -> dict[str, Any]:
    """A heal-data payload with two fixable validators red."""
    return {
        "post": {
            "slug": "test-slug",
            "content_markdown": "Original draft body.",
            "generated_at": "2026-05-18T12:00:00",
        },
        "validation_failures": [
            {"check": "banned_phrases", "detail": "Found: 'Australia's leading'"},
            {"check": "word_count", "detail": "1240 < 1500"},
        ],
        "word_floor": 1500,
        "heal_attempt": 0,
    }


def _make_heal_runner(payload, monkeypatch):
    """Wire up monkeypatches so heal() runs end-to-end against in-memory fakes.

    Returns a dict that captures (mutates as side effect):
      - regenerate_kwargs: the kwargs writer.regenerate received
      - posted_body: the dict that hit /api/admin/ingest
      - posted_headers: the headers on that POST
    """
    captured: dict[str, Any] = {"regenerate_kwargs": None, "posted_body": None, "posted_headers": None}

    def fake_regenerate(**kwargs):
        captured["regenerate_kwargs"] = kwargs
        return "Regenerated body content."

    def fake_fetch_post(slug: str):
        return payload

    def fake_post_json(url: str, payload_in: dict, headers: dict):
        captured["posted_body"] = payload_in
        captured["posted_headers"] = headers
        return 200, '{"ok":true}'

    monkeypatch.setattr(heal_agent, "writer_regenerate", fake_regenerate)
    monkeypatch.setattr(heal_agent, "fetch_post", fake_fetch_post)
    monkeypatch.setattr(heal_agent, "_http_post_json", fake_post_json)
    monkeypatch.setattr(heal_agent, "INGEST_URL", "http://test/api/admin/ingest")
    monkeypatch.setattr(heal_agent, "INGEST_TOKEN", "test-ingest-token")

    return captured


class TestHealEndToEnd:
    def test_heal_calls_regenerate_with_post_content(self, monkeypatch, heal_fixture_payload):
        captured = _make_heal_runner(heal_fixture_payload, monkeypatch)
        result = heal_agent.heal("test-slug")

        assert result["ok"] is True
        assert captured["regenerate_kwargs"] is not None
        assert captured["regenerate_kwargs"]["slug"] == "test-slug"
        assert captured["regenerate_kwargs"]["original_content"] == "Original draft body."

    def test_heal_posts_patched_post_back_with_heal_header(self, monkeypatch, heal_fixture_payload):
        captured = _make_heal_runner(heal_fixture_payload, monkeypatch)
        heal_agent.heal("test-slug")

        assert captured["posted_body"] is not None
        assert captured["posted_body"]["post"]["slug"] == "test-slug"
        assert captured["posted_body"]["post"]["content_markdown"] == "Regenerated body content."
        # X-Heal-Attempt increments
        assert captured["posted_headers"]["X-Heal-Attempt"] == "1"

    def test_heal_returns_no_fixable_failures_when_only_unfixable(self, monkeypatch):
        payload = {
            "post": {"slug": "x", "content_markdown": "...", "generated_at": "2026-05-18T00:00:00"},
            "validation_failures": [{"check": "sources", "detail": "..."}],
            "word_floor": 1500,
            "heal_attempt": 0,
        }
        _make_heal_runner(payload, monkeypatch)
        result = heal_agent.heal("x")
        assert result["ok"] is False
        assert result["reason"] == "no_fixable_failures"

    def test_heal_passes_instruction_to_regenerate(self, monkeypatch, heal_fixture_payload):
        """M2 / Bug B1: the assembled instruction reaches writer.regenerate via extra_instruction.

        Before M2 the instruction was built but discarded — the LLM saw only
        `rejection_reason="heal_agent"`. After M2, both the banned-phrase
        removal directive and the word-count expansion directive must arrive
        on the kwarg.
        """
        captured = _make_heal_runner(heal_fixture_payload, monkeypatch)
        heal_agent.heal("test-slug")

        kwargs = captured["regenerate_kwargs"]
        assert kwargs is not None
        assert "extra_instruction" in kwargs, (
            "heal_agent did not pass the assembled instruction to writer.regenerate. "
            "Add extra_instruction kwarg in M2."
        )
        instruction = kwargs["extra_instruction"]
        assert "Remove every AHPRA-banned phrase" in instruction
        assert "1500 words" in instruction


# ── fetch_post URL construction ───────────────────────────────────────────────


class TestFetchPostURL:
    """Regression: the heal-data route lives at /api/posts/<slug>/heal-data,
    NOT /api/admin/posts/<slug>/heal-data. Earlier heal_agent built the
    /admin/-prefixed URL and silently 404'd on every dispatch because the
    end-to-end tests monkeypatched fetch_post itself, never exercising the
    real URL string.
    """

    def test_fetch_post_uses_unprefixed_posts_route(self, monkeypatch):
        captured: dict[str, str] = {}

        def fake_get_json(url, headers=None):
            captured["url"] = url
            return {"post": {"slug": "abc"}, "validation_failures": [], "word_floor": 1500}

        monkeypatch.setattr(heal_agent, "CRON_BASE_URL", "https://blog.statdoctor.app")
        monkeypatch.setattr(heal_agent, "HEAL_TOKEN", "test-token")
        monkeypatch.setattr(heal_agent, "_http_get_json", fake_get_json)

        heal_agent.fetch_post("my-slug")

        assert captured["url"] == "https://blog.statdoctor.app/api/posts/my-slug/heal-data"
