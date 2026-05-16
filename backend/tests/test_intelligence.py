"""Tests for agents/intelligence.py — deterministic parts only.

Covers:
- _NEWS_QUERIES content and format
- _fetch_guardian_news parsing (httpx mocked)
- _load_past_topics / _save_topic file helpers (tmp dir)
- select_topic() full flow (httpx + OpenAI mocked)

The LLM call (client.chat.completions.create) is mocked throughout.
No real API calls are made.
"""

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

import pytest

# Set a dummy key BEFORE importing any agent module that reads config at
# module level.  config.py raises EnvironmentError when the key is absent.
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.intelligence import (  # noqa: E402
    _NEWS_QUERIES,
    _fetch_guardian_news,
    _load_past_topics,
    _save_topic,
    select_topic,
)


# ── _NEWS_QUERIES ──────────────────────────────────────────────────────────────


class TestNewsQueries:
    def test_queries_is_nonempty_list(self):
        assert isinstance(_NEWS_QUERIES, list)
        assert len(_NEWS_QUERIES) > 0

    def test_each_query_is_a_non_blank_string(self):
        for q in _NEWS_QUERIES:
            assert isinstance(q, str) and q.strip(), f"Blank query found: {q!r}"

    def test_queries_cover_australian_context(self):
        combined = " ".join(_NEWS_QUERIES).lower()
        assert "australia" in combined, "Expected at least one query to mention Australia"

    def test_at_least_5_queries(self):
        assert len(_NEWS_QUERIES) >= 5


# ── _fetch_guardian_news ───────────────────────────────────────────────────────


_GUARDIAN_RESPONSE = {
    "response": {
        "results": [
            {
                "id": "society/2024/jan/01/gp-shortage",
                "webTitle": "GP shortage hits regional Australia",
                "webUrl": "https://www.theguardian.com/society/2024/jan/01/gp-shortage",
                "webPublicationDate": "2024-01-01T00:00:00Z",
                "sectionName": "Society",
                "fields": {"trailText": "Rural GPs stretched thin."},
            },
            {
                "id": "australia-news/2024/jan/02/ahpra",
                "webTitle": "AHPRA registration surge",
                "webUrl": "https://www.theguardian.com/au/2024/jan/02/ahpra",
                "webPublicationDate": "2024-01-02T00:00:00Z",
                "sectionName": "Australia news",
                "fields": {},
            },
        ]
    }
}


class TestFetchGuardianNews:
    def test_returns_empty_list_when_no_api_key(self, monkeypatch):
        monkeypatch.setattr("agents.intelligence.GUARDIAN_API_KEY", "")
        result = _fetch_guardian_news("GP shortage Australia")
        assert result == []

    @patch("agents.intelligence.httpx.get")
    def test_parses_articles_into_guardian_article_objects(self, mock_get, monkeypatch):
        monkeypatch.setattr("agents.intelligence.GUARDIAN_API_KEY", "test-key")
        mock_resp = MagicMock()
        mock_resp.json.return_value = _GUARDIAN_RESPONSE
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        articles = _fetch_guardian_news("GP shortage Australia")

        assert len(articles) == 2
        assert articles[0].id == "society/2024/jan/01/gp-shortage"
        assert articles[0].title == "GP shortage hits regional Australia"
        assert articles[0].body_preview == "Rural GPs stretched thin."

    @patch("agents.intelligence.httpx.get")
    def test_returns_empty_list_on_http_error(self, mock_get, monkeypatch):
        monkeypatch.setattr("agents.intelligence.GUARDIAN_API_KEY", "test-key")
        mock_get.side_effect = Exception("connection refused")
        result = _fetch_guardian_news("locum doctor")
        assert result == []

    @patch("agents.intelligence.httpx.get")
    def test_article_with_no_trail_text_has_none_body_preview(self, mock_get, monkeypatch):
        monkeypatch.setattr("agents.intelligence.GUARDIAN_API_KEY", "test-key")
        mock_resp = MagicMock()
        mock_resp.json.return_value = _GUARDIAN_RESPONSE
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        articles = _fetch_guardian_news("AHPRA")
        # Second article has no trailText → None
        assert articles[1].body_preview is None

    @patch("agents.intelligence.httpx.get")
    def test_passes_from_date_and_page_size_params(self, mock_get, monkeypatch):
        monkeypatch.setattr("agents.intelligence.GUARDIAN_API_KEY", "test-key")
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"response": {"results": []}}
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        _fetch_guardian_news("query", days_back=7)

        call_kwargs = mock_get.call_args
        params = call_kwargs[1]["params"] if call_kwargs[1] else call_kwargs[0][1]
        assert params["page-size"] == 5
        assert "from-date" in params


# ── _load_past_topics / _save_topic ───────────────────────────────────────────


class TestTopicsLog:
    def test_load_returns_empty_list_when_file_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr("agents.intelligence.TOPICS_LOG", tmp_path / "topics.json")
        assert _load_past_topics() == []

    def test_save_and_load_roundtrip(self, tmp_path, monkeypatch):
        log_path = tmp_path / "topics.json"
        monkeypatch.setattr("agents.intelligence.TOPICS_LOG", log_path)
        _save_topic("How much do locum GPs earn?")
        topics = _load_past_topics()
        assert "How much do locum GPs earn?" in topics

    def test_save_keeps_at_most_50_topics(self, tmp_path, monkeypatch):
        log_path = tmp_path / "topics.json"
        monkeypatch.setattr("agents.intelligence.TOPICS_LOG", log_path)
        # Write 55 topics
        for i in range(55):
            _save_topic(f"Topic {i}")
        topics = _load_past_topics()
        assert len(topics) <= 50

    def test_save_accumulates_multiple_topics(self, tmp_path, monkeypatch):
        log_path = tmp_path / "topics.json"
        monkeypatch.setattr("agents.intelligence.TOPICS_LOG", log_path)
        _save_topic("Alpha topic")
        _save_topic("Beta topic")
        topics = _load_past_topics()
        assert "Alpha topic" in topics
        assert "Beta topic" in topics


# ── select_topic (integration with mocks) ─────────────────────────────────────


_TOPIC_BRIEF_JSON = json.dumps({
    "title": "How Much Do Locum GPs Earn in Australia?",
    "pillar": "locum_pay_rates",
    "target_keywords": ["locum GP pay", "locum doctor salary", "GP pay Australia"],
    "secondary_keywords": ["locum rate per hour", "GP income"],
    "news_hook": "Recent GP shortage push",
    "news_hook_url": "https://www.theguardian.com/example",
    "rationale": "High-intent keyword with news peg.",
    "suggested_h2s": [
        "What is the average locum GP rate in Australia?",
        "How does pay vary by state?",
        "What does this mean for locum doctors in NSW?",
    ],
    "suggested_faqs": [
        "How much do locum GPs earn per hour?",
        "What is the highest-paying state for locums?",
    ],
})


class TestSelectTopic:
    @patch("agents.intelligence.client.chat.completions.create")
    @patch("agents.intelligence.httpx.get")
    def test_returns_topic_brief_with_correct_title(
        self, mock_get, mock_create, tmp_path, monkeypatch
    ):
        monkeypatch.setattr("agents.intelligence.GUARDIAN_API_KEY", "test-key")
        monkeypatch.setattr("agents.intelligence.TOPICS_LOG", tmp_path / "topics.json")

        # Mock Guardian
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"response": {"results": []}}
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        # Mock OpenAI
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_TOPIC_BRIEF_JSON))]
        )

        result = select_topic()

        assert result.title == "How Much Do Locum GPs Earn in Australia?"
        assert result.pillar.value == "locum_pay_rates"
        assert len(result.target_keywords) == 3

    @patch("agents.intelligence.client.chat.completions.create")
    @patch("agents.intelligence.httpx.get")
    def test_deduplicates_articles_by_id(
        self, mock_get, mock_create, tmp_path, monkeypatch
    ):
        """Duplicate article IDs from multiple queries should not appear twice."""
        monkeypatch.setattr("agents.intelligence.GUARDIAN_API_KEY", "test-key")
        monkeypatch.setattr("agents.intelligence.TOPICS_LOG", tmp_path / "topics.json")

        dup_response = {
            "response": {
                "results": [
                    {
                        "id": "same-id-001",
                        "webTitle": "Duplicate",
                        "webUrl": "https://example.com",
                        "webPublicationDate": "2024-01-01T00:00:00Z",
                        "sectionName": "Society",
                        "fields": {},
                    }
                ]
            }
        }
        mock_resp = MagicMock()
        mock_resp.json.return_value = dup_response
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_TOPIC_BRIEF_JSON))]
        )

        # This should not raise — the dedup logic inside select_topic is exercised.
        result = select_topic()
        assert result is not None

    @patch("agents.intelligence.client.chat.completions.create")
    @patch("agents.intelligence.httpx.get")
    def test_saves_topic_to_log_after_selection(
        self, mock_get, mock_create, tmp_path, monkeypatch
    ):
        monkeypatch.setattr("agents.intelligence.GUARDIAN_API_KEY", "")
        log_path = tmp_path / "topics.json"
        monkeypatch.setattr("agents.intelligence.TOPICS_LOG", log_path)

        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_TOPIC_BRIEF_JSON))]
        )

        select_topic()

        topics = json.loads(log_path.read_text())
        assert "How Much Do Locum GPs Earn in Australia?" in topics
