"""Tests for agents/researcher.py — deterministic parts only.

Covers:
- _build_chart_url: numeric extraction, label building, URL encoding
- _load_used_images / _save_used_image: file helpers (tmp dir)
- _search_guardian: HTTP mocked
- _fetch_unsplash_image: HTTP mocked, used-image dedup logic
- research_topic: full flow (HTTP + OpenAI mocked)

No real API calls are made.
"""

import json
import os
import sys
import urllib.parse
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("OPENAI_API_KEY", "sk-test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.researcher import (  # noqa: E402
    _build_chart_url,
    _fetch_unsplash_image,
    _load_used_images,
    _save_used_image,
    _search_guardian,
    research_topic,
)
from models import ContentPillar, TopicBrief  # noqa: E402


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_topic(**kwargs) -> TopicBrief:
    defaults = dict(
        title="How Much Do Locum GPs Earn in Australia?",
        pillar=ContentPillar.PAY_RATES,
        target_keywords=["locum GP pay", "locum doctor salary"],
        secondary_keywords=["GP income"],
        rationale="High-intent keyword.",
        suggested_h2s=["What is the average?"],
        suggested_faqs=["How much per hour?"],
    )
    defaults.update(kwargs)
    return TopicBrief(**defaults)


# ── _build_chart_url ──────────────────────────────────────────────────────────


class TestBuildChartUrl:
    def test_returns_none_when_fewer_than_2_numeric_stats(self):
        stats = ["Only one stat with 42% uptake"]
        result = _build_chart_url(stats, "Test Topic")
        # Single stat: labels == 1 → should return None
        assert result is None

    def test_returns_url_string_with_two_numeric_stats(self):
        stats = [
            "75% of locum GPs work in NSW",
            "A$1850 average daily rate for emergency doctors",
        ]
        result = _build_chart_url(stats, "Locum Rates 2024")
        assert result is not None
        assert result.startswith("https://quickchart.io/chart?c=")

    def test_url_contains_encoded_chart_config(self):
        stats = [
            "75% of locum GPs in NSW",
            "60% prefer marketplace over agency",
        ]
        result = _build_chart_url(stats, "Test Topic")
        assert result is not None
        # Decode and verify it's valid JSON chart config
        qs = result.split("?c=")[1].split("&")[0]
        decoded = urllib.parse.unquote(qs)
        config = json.loads(decoded)
        assert config["type"] == "bar"
        assert "data" in config
        assert "labels" in config["data"]
        assert len(config["data"]["labels"]) >= 2

    def test_handles_dollar_amounts(self):
        stats = [
            "$1850 average daily rate",
            "$140 average hourly rate",
        ]
        result = _build_chart_url(stats, "Pay Rates")
        assert result is not None
        qs = result.split("?c=")[1].split("&")[0]
        config = json.loads(urllib.parse.unquote(qs))
        values = config["data"]["datasets"][0]["data"]
        assert 1850.0 in values
        assert 140.0 in values

    def test_handles_k_multiplier(self):
        stats = [
            "200k doctors registered with AHPRA",
            "50k locum shifts per year",
        ]
        result = _build_chart_url(stats, "Scale")
        assert result is not None
        qs = result.split("?c=")[1].split("&")[0]
        config = json.loads(urllib.parse.unquote(qs))
        values = config["data"]["datasets"][0]["data"]
        assert 200_000.0 in values
        assert 50_000.0 in values

    def test_topic_title_truncated_to_55_chars_in_chart(self):
        long_title = "A" * 100
        stats = [
            "50% of GP shifts are locum",
            "30% growth in platform signups",
        ]
        result = _build_chart_url(stats, long_title)
        assert result is not None
        qs = result.split("?c=")[1].split("&")[0]
        config = json.loads(urllib.parse.unquote(qs))
        title_text = config["options"]["plugins"]["title"]["text"]
        assert len(title_text) <= 55

    def test_returns_none_for_empty_statistics(self):
        assert _build_chart_url([], "Any Topic") is None

    def test_ignores_stats_with_no_numeric_value(self):
        stats = [
            "No numbers here at all",
            "Still nothing numeric",
            "42% gives us one real value",
        ]
        # Only one parseable value → None (need ≥2 labels)
        result = _build_chart_url(stats, "Test")
        assert result is None


# ── _load_used_images / _save_used_image ──────────────────────────────────────


class TestUsedImagesLog:
    def test_load_returns_empty_set_when_file_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", tmp_path / "used.json")
        assert _load_used_images() == set()

    def test_save_and_load_roundtrip(self, tmp_path, monkeypatch):
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", tmp_path / "used.json")
        _save_used_image("photo-abc-123")
        used = _load_used_images()
        assert "photo-abc-123" in used

    def test_save_accumulates_multiple_ids(self, tmp_path, monkeypatch):
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", tmp_path / "used.json")
        _save_used_image("id-1")
        _save_used_image("id-2")
        used = _load_used_images()
        assert "id-1" in used
        assert "id-2" in used


# ── _search_guardian ──────────────────────────────────────────────────────────


_GUARDIAN_RESULTS = [
    {
        "id": "society/001",
        "webTitle": "GP shortage worsens",
        "webUrl": "https://theguardian.com/001",
        "webPublicationDate": "2024-01-01T00:00:00Z",
        "sectionName": "Society",
        "fields": {"trailText": "Trail.", "bodyText": "Body text here."},
    }
]


class TestSearchGuardian:
    def test_returns_empty_when_no_api_key(self, monkeypatch):
        monkeypatch.setattr("agents.researcher.GUARDIAN_API_KEY", "")
        assert _search_guardian("locum doctor") == []

    @patch("agents.researcher.httpx.get")
    def test_returns_parsed_results_on_success(self, mock_get, monkeypatch):
        monkeypatch.setattr("agents.researcher.GUARDIAN_API_KEY", "key")
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"response": {"results": _GUARDIAN_RESULTS}}
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        results = _search_guardian("GP shortage")
        assert len(results) == 1
        assert results[0]["webTitle"] == "GP shortage worsens"

    @patch("agents.researcher.httpx.get")
    def test_returns_empty_on_exception(self, mock_get, monkeypatch):
        monkeypatch.setattr("agents.researcher.GUARDIAN_API_KEY", "key")
        mock_get.side_effect = Exception("timeout")
        assert _search_guardian("query") == []


# ── _fetch_unsplash_image ─────────────────────────────────────────────────────


_UNSPLASH_RESPONSE = {
    "results": [
        {
            "id": "photo-001",
            "urls": {"regular": "https://images.unsplash.com/photo-001"},
            "user": {"name": "Jane Photographer"},
            "description": "Doctors at work",
            "alt_description": None,
        },
        {
            "id": "photo-002",
            "urls": {"regular": "https://images.unsplash.com/photo-002"},
            "user": {"name": "John Snapper"},
            "description": None,
            "alt_description": "Medical team",
        },
    ]
}


class TestFetchUnsplashImage:
    def test_returns_none_triple_when_no_access_key(self, monkeypatch):
        monkeypatch.setattr("agents.researcher.UNSPLASH_ACCESS_KEY", "")
        url, credit, desc = _fetch_unsplash_image("doctor")
        assert url is None
        assert credit is None
        assert desc is None

    @patch("agents.researcher.httpx.get")
    def test_returns_url_credit_description_on_success(self, mock_get, monkeypatch, tmp_path):
        monkeypatch.setattr("agents.researcher.UNSPLASH_ACCESS_KEY", "key")
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", tmp_path / "used.json")
        mock_resp = MagicMock()
        mock_resp.json.return_value = _UNSPLASH_RESPONSE
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        url, credit, desc = _fetch_unsplash_image("doctor australia")

        assert url is not None
        assert "unsplash.com" in url
        assert "Unsplash" in credit
        assert desc is not None

    @patch("agents.researcher.httpx.get")
    def test_skips_already_used_photo(self, mock_get, monkeypatch, tmp_path):
        monkeypatch.setattr("agents.researcher.UNSPLASH_ACCESS_KEY", "key")
        log = tmp_path / "used.json"
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", log)

        # Mark photo-001 as already used
        log.write_text(json.dumps(["photo-001"]))

        mock_resp = MagicMock()
        mock_resp.json.return_value = _UNSPLASH_RESPONSE
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        url, credit, desc = _fetch_unsplash_image("doctor")
        # Should prefer photo-002 (photo-001 is used)
        assert url == "https://images.unsplash.com/photo-002"

    @patch("agents.researcher.httpx.get")
    def test_falls_back_to_used_photo_when_all_used(self, mock_get, monkeypatch, tmp_path):
        monkeypatch.setattr("agents.researcher.UNSPLASH_ACCESS_KEY", "key")
        log = tmp_path / "used.json"
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", log)

        # Mark all photos as used
        log.write_text(json.dumps(["photo-001", "photo-002"]))

        mock_resp = MagicMock()
        mock_resp.json.return_value = _UNSPLASH_RESPONSE
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        url, credit, desc = _fetch_unsplash_image("doctor")
        # Falls back to any photo (results[0] after shuffle)
        assert url is not None

    @patch("agents.researcher.httpx.get")
    def test_returns_none_triple_on_exception(self, mock_get, monkeypatch):
        monkeypatch.setattr("agents.researcher.UNSPLASH_ACCESS_KEY", "key")
        mock_get.side_effect = Exception("timeout")
        url, credit, desc = _fetch_unsplash_image("doctor")
        assert url is None


# ── research_topic (integration with mocks) ───────────────────────────────────


_RESEARCH_RESPONSE_JSON = json.dumps({
    "key_facts": ["Fact one", "Fact two", "Fact three"],
    "statistics": [
        "75% of locum GPs prefer platform-based work — AIHW (2023)",
        "$1850 average daily rate — AMA Survey (2023)",
    ],
    "ahpra_context": "Good Medical Practice requires verification of credentials.",
    "additional_sources": [
        {
            "title": "AHPRA Annual Report 2023",
            "url": "https://www.ahpra.gov.au/annual-report-2023",
            "publisher": "AHPRA",
            "snippet": "Registrations increased by 5% in 2023.",
        }
    ],
})


class TestResearchTopic:
    @patch("agents.researcher.client.chat.completions.create")
    @patch("agents.researcher.httpx.get")
    def test_returns_research_brief_with_expected_fields(
        self, mock_get, mock_create, monkeypatch, tmp_path
    ):
        monkeypatch.setattr("agents.researcher.GUARDIAN_API_KEY", "gkey")
        monkeypatch.setattr("agents.researcher.UNSPLASH_ACCESS_KEY", "")
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", tmp_path / "used.json")

        # Guardian returns one article
        guardian_resp = MagicMock()
        guardian_resp.json.return_value = {"response": {"results": _GUARDIAN_RESULTS}}
        guardian_resp.raise_for_status.return_value = None
        mock_get.return_value = guardian_resp

        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_RESEARCH_RESPONSE_JSON))]
        )

        topic = _make_topic()
        brief = research_topic(topic)

        assert brief.topic.title == topic.title
        assert len(brief.key_facts) == 3
        assert len(brief.statistics) == 2
        assert len(brief.ahpra_context) > 0
        # Guardian article + 1 additional source = 2 total sources
        assert len(brief.sources) == 2

    @patch("agents.researcher.client.chat.completions.create")
    @patch("agents.researcher.httpx.get")
    def test_chart_url_generated_when_statistics_have_numbers(
        self, mock_get, mock_create, monkeypatch, tmp_path
    ):
        monkeypatch.setattr("agents.researcher.GUARDIAN_API_KEY", "")
        monkeypatch.setattr("agents.researcher.UNSPLASH_ACCESS_KEY", "")
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", tmp_path / "used.json")
        mock_get.return_value = MagicMock(
            json=MagicMock(return_value={"response": {"results": []}}),
            raise_for_status=MagicMock(return_value=None),
        )

        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_RESEARCH_RESPONSE_JSON))]
        )

        topic = _make_topic()
        brief = research_topic(topic)
        # Stats have 2 numeric values → chart should be generated
        assert brief.chart_url is not None
        assert "quickchart.io" in brief.chart_url

    @patch("agents.researcher.client.chat.completions.create")
    @patch("agents.researcher.httpx.get")
    def test_image_url_is_none_when_unsplash_key_missing(
        self, mock_get, mock_create, monkeypatch, tmp_path
    ):
        monkeypatch.setattr("agents.researcher.GUARDIAN_API_KEY", "")
        monkeypatch.setattr("agents.researcher.UNSPLASH_ACCESS_KEY", "")
        monkeypatch.setattr("agents.researcher.USED_IMAGES_LOG", tmp_path / "used.json")
        mock_get.return_value = MagicMock(
            json=MagicMock(return_value={"response": {"results": []}}),
            raise_for_status=MagicMock(return_value=None),
        )
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_RESEARCH_RESPONSE_JSON))]
        )

        brief = research_topic(_make_topic())
        assert brief.image_url is None
        assert brief.image_credit is None
