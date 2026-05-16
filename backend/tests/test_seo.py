"""Tests for agents/seo.py — deterministic parts only.

Covers:
- _slugify: normalisation, special chars, max length
- _reading_time: 200 wpm calculation, minimum 1
- _TITLE_CADENCES: structure/content checks
- keywords dedup logic (tested via generate_seo with mocked LLM)
- TwitterCard clamping (title/description length limits)
- generate_seo: full flow with mocked OpenAI — output shape and constraints

LLM call is mocked throughout. No real API calls are made.
"""

import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("OPENAI_API_KEY", "sk-test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.seo import _TITLE_CADENCES, _reading_time, _slugify, generate_seo  # noqa: E402
from models import BlogPost, ContentPillar, ContentType, SEOMetadata, Source, TopicBrief  # noqa: E402


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_topic(**kwargs) -> TopicBrief:
    defaults = dict(
        title="How Much Do Locum GPs Earn in Australia?",
        pillar=ContentPillar.PAY_RATES,
        target_keywords=["locum GP pay", "locum doctor salary", "GP pay Australia"],
        secondary_keywords=["GP income", "locum rate per hour"],
        rationale="High-intent.",
        suggested_h2s=["What is the rate?", "How does state affect pay?"],
        suggested_faqs=["How much per hour?"],
    )
    defaults.update(kwargs)
    return TopicBrief(**defaults)


def _make_post(content: str = "", title: str = "How Much Do Locum GPs Earn in Australia?") -> BlogPost:
    if not content:
        content = (
            "# Title\n\n**TL;DR:** Direct answer.\n\n---\n\n"
            "## Frequently Asked Questions\n\n"
            "**Q: How much per hour?**\nA: Around A$140.\n\n"
            "## Sources\n1. AHPRA\n"
        )
    return BlogPost(
        title=title,
        content_markdown=content,
        tldr="Direct answer.",
        word_count=len(content.split()),
    )


def _seo_response_json(
    meta_title="Locum GP Pay Australia 2024",
    meta_description="Locum GPs earn A$140–A$180/hr. See state-by-state breakdown.",
    focus_keyword="locum GP pay",
    keywords=None,
    twitter_title="Locum GP Pay: How Much Can You Earn?",
    twitter_desc="Full breakdown of locum GP pay rates across Australia.",
    image_url="",
) -> str:
    if keywords is None:
        keywords = ["locum GP pay", "locum doctor salary", "AHPRA", "Medicare", "GP income"]
    return json.dumps({
        "meta_title": meta_title,
        "meta_description": meta_description,
        "focus_keyword": focus_keyword,
        "og_image_alt": "Locum doctor reviewing pay rates in Sydney — The Guardian",
        "keywords": keywords,
        "twitter_card": {
            "title": twitter_title,
            "description": twitter_desc,
            "image": image_url,
        },
        "faq_json_ld": {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "How much do locum GPs earn?",
                    "acceptedAnswer": {"@type": "Answer", "text": "Around A$140 per hour."},
                }
            ],
        },
        "medical_webpage_schema": {
            "@context": "https://schema.org",
            "@type": "MedicalWebPage",
            "name": "How Much Do Locum GPs Earn in Australia?",
            "url": "https://statdoctor.app/blog/test",
            "description": meta_description,
        },
    })


# ── _slugify ──────────────────────────────────────────────────────────────────


class TestSlugify:
    def test_lowercases_title(self):
        assert _slugify("Hello World") == "hello-world"

    def test_replaces_spaces_with_hyphens(self):
        assert _slugify("locum GP pay") == "locum-gp-pay"

    def test_removes_special_characters(self):
        assert _slugify("What's the rate?") == "whats-the-rate"

    def test_collapses_multiple_hyphens(self):
        result = _slugify("hello---world")
        assert "--" not in result
        assert result == "hello-world"

    def test_strips_leading_and_trailing_hyphens(self):
        result = _slugify("  Hello World  ")
        assert not result.startswith("-")
        assert not result.endswith("-")

    def test_truncates_to_80_chars_max(self):
        long_title = "A Very Long Title That Goes Way Beyond The Expected Eighty Character Limit Here"
        result = _slugify(long_title)
        assert len(result) <= 80

    def test_australian_question_title(self):
        result = _slugify("How Much Do Locum GPs Earn in Australia?")
        assert result == "how-much-do-locum-gps-earn-in-australia"

    def test_handles_dollars_and_numbers(self):
        result = _slugify("Locum GP rates: A$140–A$180 per hour")
        assert "140" in result or "a140" in result
        assert result == result.lower()

    def test_handles_empty_string(self):
        result = _slugify("")
        assert result == ""


# ── _reading_time ─────────────────────────────────────────────────────────────


class TestReadingTime:
    def test_200_words_returns_1_minute(self):
        text = "word " * 200
        assert _reading_time(text) == 1

    def test_400_words_returns_2_minutes(self):
        text = "word " * 400
        assert _reading_time(text) == 2

    def test_minimum_is_1_even_for_empty_string(self):
        assert _reading_time("") == 1

    def test_minimum_is_1_for_very_short_content(self):
        assert _reading_time("Hello") == 1

    def test_1500_words_returns_8_minutes(self):
        text = "word " * 1500
        # 1500 / 200 = 7.5 → rounds to 8
        assert _reading_time(text) == 8

    def test_1000_words_returns_5_minutes(self):
        text = "word " * 1000
        assert _reading_time(text) == 5


# ── _TITLE_CADENCES ───────────────────────────────────────────────────────────


class TestTitleCadences:
    def test_all_expected_content_types_present(self):
        for ct in ("news", "guide", "company"):
            assert ct in _TITLE_CADENCES, f"Missing content type: {ct}"

    def test_each_type_has_at_least_2_cadences(self):
        for ct, cadences in _TITLE_CADENCES.items():
            assert len(cadences) >= 2, f"{ct} has fewer than 2 cadences"

    def test_cadences_are_nonempty_strings(self):
        for ct, cadences in _TITLE_CADENCES.items():
            for c in cadences:
                assert isinstance(c, str) and c.strip(), f"Empty cadence in {ct}: {c!r}"

    def test_news_type_includes_question_form(self):
        assert "question-form" in _TITLE_CADENCES["news"]

    def test_guide_type_includes_how_to(self):
        assert "how-to" in _TITLE_CADENCES["guide"]


# ── generate_seo: full flow ───────────────────────────────────────────────────


class TestGenerateSeo:
    @patch("agents.seo.client.chat.completions.create")
    def test_returns_seo_metadata_instance(self, mock_create):
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert isinstance(result, SEOMetadata)

    @patch("agents.seo.client.chat.completions.create")
    def test_slug_derived_from_post_title(self, mock_create):
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert result.slug == "how-much-do-locum-gps-earn-in-australia"

    @patch("agents.seo.client.chat.completions.create")
    def test_meta_title_clamped_to_60_chars(self, mock_create):
        long_title = "A" * 70  # 70 chars — should be clamped
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json(meta_title=long_title)))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert len(result.meta_title) <= 60

    @patch("agents.seo.client.chat.completions.create")
    def test_meta_description_clamped_to_155_chars(self, mock_create):
        long_desc = "B" * 200  # 200 chars — should be clamped
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json(meta_description=long_desc)))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert len(result.meta_description) <= 155

    @patch("agents.seo.client.chat.completions.create")
    def test_keywords_deduplicated_case_insensitively(self, mock_create):
        keywords = ["Locum GP Pay", "locum gp pay", "LOCUM GP PAY", "AHPRA", "Medicare"]
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json(keywords=keywords)))]
        )
        result = generate_seo(_make_post(), _make_topic())
        lower_seen = [k.lower() for k in result.keywords]
        assert len(lower_seen) == len(set(lower_seen)), "Duplicate keywords found"

    @patch("agents.seo.client.chat.completions.create")
    def test_keywords_capped_at_8(self, mock_create):
        keywords = [f"keyword-{i}" for i in range(20)]
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json(keywords=keywords)))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert len(result.keywords) <= 8

    @patch("agents.seo.client.chat.completions.create")
    def test_twitter_card_title_clamped_to_70_chars(self, mock_create):
        long_tw_title = "C" * 80
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(
                content=_seo_response_json(twitter_title=long_tw_title)
            ))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert result.twitter_card is not None
        assert len(result.twitter_card.title) <= 70

    @patch("agents.seo.client.chat.completions.create")
    def test_twitter_card_description_clamped_to_200_chars(self, mock_create):
        long_tw_desc = "D" * 250
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(
                content=_seo_response_json(twitter_desc=long_tw_desc)
            ))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert result.twitter_card is not None
        assert len(result.twitter_card.description) <= 200

    @patch("agents.seo.client.chat.completions.create")
    def test_twitter_card_none_when_missing_title_or_description(self, mock_create):
        """If model returns empty title/description, twitter_card should be None."""
        response_data = json.loads(_seo_response_json())
        response_data["twitter_card"] = {"title": "", "description": "", "image": ""}
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps(response_data)))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert result.twitter_card is None

    @patch("agents.seo.client.chat.completions.create")
    def test_reading_time_computed_from_post_content(self, mock_create):
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        long_content = "word " * 1000  # 1000 words → 5 min
        post = _make_post(content=long_content)
        result = generate_seo(post, _make_topic())
        assert result.reading_time_minutes == 5

    @patch("agents.seo.client.chat.completions.create")
    def test_faq_json_ld_schema_present(self, mock_create):
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert result.faq_json_ld["@type"] == "FAQPage"
        assert "mainEntity" in result.faq_json_ld

    @patch("agents.seo.client.chat.completions.create")
    def test_image_url_passed_to_twitter_card_when_provided(self, mock_create):
        img_url = "https://images.unsplash.com/photo-123"
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(
                content=_seo_response_json(image_url=img_url)
            ))]
        )
        result = generate_seo(_make_post(), _make_topic(), image_url=img_url)
        assert result.twitter_card is not None
        assert result.twitter_card.image == img_url

    @patch("agents.seo.client.chat.completions.create")
    def test_non_list_keywords_handled_gracefully(self, mock_create):
        """If LLM returns keywords as a non-list, result should be empty list."""
        response_data = json.loads(_seo_response_json())
        response_data["keywords"] = "not-a-list"
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps(response_data)))]
        )
        result = generate_seo(_make_post(), _make_topic())
        assert result.keywords == []

    @patch("agents.seo.client.chat.completions.create")
    def test_faq_extracted_from_post_markdown_and_included_in_prompt(self, mock_create):
        """FAQ section in post markdown should be extracted and sent in the prompt."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        content = (
            "## Intro\n\nSome text.\n\n"
            "## Frequently Asked Questions\n\n"
            "**Q: How much per hour?**\nA: Around A$140.\n\n"
            "## Sources\n1. AHPRA\n"
        )
        post = _make_post(content=content)
        generate_seo(post, _make_topic())
        prompt_text = mock_create.call_args[1]["messages"][0]["content"]
        assert "Frequently Asked Questions" in prompt_text

    @patch("agents.seo.client.chat.completions.create")
    def test_content_type_guide_used_by_default(self, mock_create):
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        result = generate_seo(_make_post(), _make_topic())
        prompt_text = mock_create.call_args[1]["messages"][0]["content"]
        assert "guide" in prompt_text.lower()


# ── M6.5 schema field tests ───────────────────────────────────────────────────


def _make_sources() -> list[Source]:
    return [
        Source(
            title="AHPRA Registration Standards",
            url="https://www.ahpra.gov.au/registration-standards",
            publisher="AHPRA",
            snippet="AHPRA sets registration standards for medical practitioners.",
        ),
        Source(
            title="AIHW Health Workforce Data",
            url="https://www.aihw.gov.au/reports/workforce/health-workforce",
            publisher="Australian Institute of Health and Welfare",
            snippet="Data on health workforce numbers across Australia.",
        ),
    ]


class TestSchemaM65Fields:
    """M6.5: reviewedBy, citation, publicationType, speakable."""

    @patch("agents.seo.client.chat.completions.create")
    def test_schema_includes_reviewedBy_for_every_article(self, mock_create):
        """Every article regardless of content_type must carry a reviewedBy Person node."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        for ct in ContentType:
            result = generate_seo(_make_post(), _make_topic(), content_type=ct)
            assert result.reviewed_by is not None, f"reviewed_by missing for content_type={ct.value}"
            assert result.reviewed_by.get("@type") == "Person"
            assert "name" in result.reviewed_by, "reviewed_by must have a name"

    @patch("agents.seo.client.chat.completions.create")
    def test_schema_citation_array_serialises_sources_correctly(self, mock_create):
        """citation[] entries map 1:1 with sources, carrying @type, url, name, publisher."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        sources = _make_sources()
        result = generate_seo(_make_post(), _make_topic(), sources=sources)
        assert len(result.citation) == len(sources)
        for entry, src in zip(result.citation, sources):
            assert entry["@type"] == "ScholarlyArticle"
            assert entry["url"] == src.url
            assert entry["name"] == src.title
            assert entry["publisher"]["@type"] == "Organization"
            assert entry["publisher"]["name"] == src.publisher

    @patch("agents.seo.client.chat.completions.create")
    def test_schema_citation_empty_when_no_sources_provided(self, mock_create):
        """When sources is None or empty, citation must be an empty list."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        result = generate_seo(_make_post(), _make_topic(), sources=None)
        assert result.citation == []

        result2 = generate_seo(_make_post(), _make_topic(), sources=[])
        assert result2.citation == []

    @patch("agents.seo.client.chat.completions.create")
    def test_schema_publicationType_review_for_guide(self, mock_create):
        """content_type=guide → publicationType 'Review' (MeSH)."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        result = generate_seo(_make_post(), _make_topic(), content_type=ContentType.GUIDE)
        assert result.publication_type == "Review"

    @patch("agents.seo.client.chat.completions.create")
    def test_schema_publicationType_news_article_for_news(self, mock_create):
        """content_type=news → publicationType 'News Article' (MeSH)."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        result = generate_seo(_make_post(), _make_topic(), content_type=ContentType.NEWS)
        assert result.publication_type == "News Article"

    @patch("agents.seo.client.chat.completions.create")
    def test_schema_publicationType_omitted_for_company(self, mock_create):
        """content_type=company → publicationType must be None (omitted)."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        result = generate_seo(_make_post(), _make_topic(), content_type=ContentType.COMPANY)
        assert result.publication_type is None

    @patch("agents.seo.client.chat.completions.create")
    def test_schema_speakable_only_for_news(self, mock_create):
        """speakable must be emitted ONLY for news; None for guide and company."""
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=_seo_response_json()))]
        )
        # news → speakable present
        news_result = generate_seo(_make_post(), _make_topic(), content_type=ContentType.NEWS)
        assert news_result.speakable is not None
        assert news_result.speakable.get("@type") == "SpeakableSpecification"
        assert ".article-tldr" in news_result.speakable.get("cssSelector", [])

        # guide → speakable absent
        guide_result = generate_seo(_make_post(), _make_topic(), content_type=ContentType.GUIDE)
        assert guide_result.speakable is None

        # company → speakable absent
        company_result = generate_seo(_make_post(), _make_topic(), content_type=ContentType.COMPANY)
        assert company_result.speakable is None
