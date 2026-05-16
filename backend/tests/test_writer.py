"""Tests for agents/writer.py — deterministic parts only.

Covers:
- _PILLAR_LABELS mapping completeness
- Prompt builder helpers (sources_text, facts_text, inline_img_instruction)
- TL;DR extraction from generated markdown
- word_count computed in write_post
- Expansion retry logic triggered when word count < MIN_WORDS
- write_post: full flow (OpenAI mocked) — output shape
- M2.T1: per-content_type word floor in prompt (loaded from validators.json)
- M2.T2: two-pass outline → draft structure

LLM call is mocked throughout. No real API calls are made.
"""

import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

os.environ.setdefault("OPENAI_API_KEY", "sk-test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.writer import _PILLAR_LABELS, _REJECTION_LABELS, write_post, regenerate  # noqa: E402
from models import (  # noqa: E402
    BlogPost,
    ContentPillar,
    ResearchBrief,
    Source,
    TopicBrief,
)


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_topic(**kwargs) -> TopicBrief:
    defaults = dict(
        title="How Much Do Locum GPs Earn in Australia?",
        pillar=ContentPillar.PAY_RATES,
        target_keywords=["locum GP pay", "locum doctor salary"],
        secondary_keywords=["GP income"],
        rationale="High-intent keyword.",
        suggested_h2s=[
            "What is the average locum GP rate?",
            "How does pay vary by state?",
            "What does this mean for locum doctors in NSW?",
        ],
        suggested_faqs=[
            "How much do locum GPs earn per hour?",
            "Which state pays the most?",
        ],
    )
    defaults.update(kwargs)
    return TopicBrief(**defaults)


def _make_research(**kwargs) -> ResearchBrief:
    topic = kwargs.pop("topic", _make_topic())
    defaults = dict(
        topic=topic,
        key_facts=["Fact one.", "Fact two."],
        statistics=["75% prefer platform — AIHW (2023)"],
        sources=[
            Source(
                title="AHPRA Annual Report",
                url="https://ahpra.gov.au/annual",
                publisher="AHPRA",
                snippet="Registrations rose.",
            )
        ],
        ahpra_context="Good Medical Practice requires verification.",
        chart_url=None,
        inline_images=[],
    )
    defaults.update(kwargs)
    return ResearchBrief(**defaults)


def _minimal_markdown(title="Test", word_target=1600) -> str:
    """Return a minimal markdown string that looks like a blog post."""
    body_words = " ".join(["word"] * word_target)
    return (
        f"# {title}\n\n"
        "*5 min read | Locum Pay & Rates | May 2024*\n\n"
        "---\n"
        "**TL;DR:** Locum GPs in Australia earn between A$120 and A$180 per hour depending on specialty.\n"
        "---\n\n"
        f"## What is the average locum GP rate?\n\n{body_words}\n\n"
        "## Frequently Asked Questions\n\n"
        "**Q: How much per hour?**\nA: Around A$140.\n\n"
        "## Sources\n1. [AHPRA](https://ahpra.gov.au/annual) — AHPRA\n"
    )


# ── _PILLAR_LABELS ────────────────────────────────────────────────────────────


class TestPillarLabels:
    def test_all_content_pillars_have_a_label(self):
        """Every ContentPillar value should have a corresponding label."""
        for pillar in ContentPillar:
            assert pillar.value in _PILLAR_LABELS, (
                f"Missing label for pillar: {pillar.value}"
            )

    def test_labels_are_nonempty_strings(self):
        for key, label in _PILLAR_LABELS.items():
            assert isinstance(label, str) and label.strip(), (
                f"Empty label for pillar: {key}"
            )

    def test_expected_label_for_pay_rates_pillar(self):
        assert _PILLAR_LABELS["locum_pay_rates"] == "Locum Pay & Rates"

    def test_expected_label_for_how_to_pillar(self):
        assert _PILLAR_LABELS["how_to_locum"] == "Getting Started"


# ── write_post: mocked LLM ────────────────────────────────────────────────────


class TestWritePost:
    @patch("agents.writer.client.chat.completions.create")
    def test_returns_blog_post_with_correct_title(self, mock_create):
        content = _minimal_markdown()
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        research = _make_research()
        post = write_post(research)
        assert post.title == research.topic.title

    @patch("agents.writer.client.chat.completions.create")
    def test_word_count_matches_actual_content(self, mock_create):
        content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        post = write_post(_make_research())
        expected = len(content.split())
        assert post.word_count == expected

    @patch("agents.writer.client.chat.completions.create")
    def test_tldr_extracted_correctly_when_present(self, mock_create):
        content = _minimal_markdown()
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        post = write_post(_make_research())
        assert "Locum GPs in Australia" in post.tldr
        assert post.tldr.endswith("specialty.")

    @patch("agents.writer.client.chat.completions.create")
    def test_tldr_empty_when_marker_absent(self, mock_create):
        content = "# Title\n\nNo TL;DR here.\n\n## Sources\n1. src"
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        post = write_post(_make_research())
        assert post.tldr == ""

    @patch("agents.writer.client.chat.completions.create")
    def test_expansion_retry_triggered_when_below_min_words(self, mock_create):
        """If the first draft is below MIN_WORDS, a second create() call is made."""
        short_content = "# T\n\n**TL;DR:** Short.\n---\nshort draft " * 3
        full_content = _minimal_markdown(word_target=1600)

        mock_create.side_effect = [
            MagicMock(choices=[MagicMock(message=MagicMock(content=short_content))]),
            MagicMock(choices=[MagicMock(message=MagicMock(content=full_content))]),
        ]

        post = write_post(_make_research())
        assert mock_create.call_count == 2
        # The final post should reflect the expanded content word count
        assert post.word_count == len(full_content.split())

    @patch("agents.writer.client.chat.completions.create")
    def test_no_expansion_retry_when_above_min_words(self, mock_create):
        """No expansion retry call when word count already meets the floor.
        With two-pass (outline + draft), there are exactly 2 calls — not 3."""
        outline_content = "## Section One (target: 800 words)\n## Section Two (target: 800 words)\n"
        content = _minimal_markdown(word_target=1600)
        mock_create.side_effect = [
            MagicMock(choices=[MagicMock(message=MagicMock(content=outline_content))]),
            MagicMock(choices=[MagicMock(message=MagicMock(content=content))]),
        ]
        write_post(_make_research())
        # Two calls: outline pass + draft pass. No third expansion call.
        assert mock_create.call_count == 2

    @patch("agents.writer.client.chat.completions.create")
    def test_chart_instruction_embedded_in_prompt_when_chart_url_present(self, mock_create):
        """When research has a chart_url, the prompt includes the chart markdown."""
        content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        research = _make_research(
            chart_url="https://quickchart.io/chart?c=test&width=600&height=300&bkg=white"
        )
        write_post(research)
        # The prompt passed to the LLM should contain the chart URL
        first_call_messages = mock_create.call_args[1]["messages"]
        prompt_text = first_call_messages[0]["content"]
        assert "quickchart.io" in prompt_text

    @patch("agents.writer.client.chat.completions.create")
    def test_inline_image_instruction_included_when_images_present(self, mock_create):
        content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        research = _make_research(
            inline_images=[
                "https://images.unsplash.com/photo-001",
                "https://images.unsplash.com/photo-002",
            ]
        )
        write_post(research)
        prompt_text = mock_create.call_args[1]["messages"][0]["content"]
        assert "photo-001" in prompt_text
        assert "photo-002" in prompt_text

    @patch("agents.writer.client.chat.completions.create")
    def test_inline_image_skip_instruction_when_no_images(self, mock_create):
        content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        research = _make_research(inline_images=[])
        write_post(research)
        prompt_text = mock_create.call_args[1]["messages"][0]["content"]
        assert "Skip inline images" in prompt_text

    @patch("agents.writer.client.chat.completions.create")
    def test_returns_blog_post_model_instance(self, mock_create):
        content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        post = write_post(_make_research())
        assert isinstance(post, BlogPost)
        assert isinstance(post.content_markdown, str)
        assert post.word_count > 0


# ── TL;DR extraction edge cases ───────────────────────────────────────────────


class TestTldrExtraction:
    """Test the TL;DR parsing logic via write_post with controlled markdown."""

    @patch("agents.writer.client.chat.completions.create")
    def test_tldr_stops_at_double_newline(self, mock_create):
        content = (
            "# Title\n\n"
            "*meta*\n\n"
            "---\n"
            "**TL;DR:** First sentence. Second sentence.\n\n"
            "rest of content " * 200
        )
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        post = write_post(_make_research())
        assert "rest of content" not in post.tldr
        assert "First sentence." in post.tldr

    @patch("agents.writer.client.chat.completions.create")
    def test_tldr_stops_at_dash_delimiter(self, mock_create):
        content = (
            "# Title\n\n"
            "*meta*\n\n"
            "---\n"
            "**TL;DR:** Compact answer here.\n"
            "---\n"
            "rest of content " * 200
        )
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        post = write_post(_make_research())
        assert "rest of content" not in post.tldr
        assert "Compact answer here." in post.tldr


# ── M2.T1: word floor in prompt ───────────────────────────────────────────────


def _make_mock_response(content: str) -> MagicMock:
    """Return a MagicMock that mimics a real OpenAI response object."""
    return MagicMock(
        choices=[MagicMock(message=MagicMock(content=content))],
        usage=MagicMock(total_tokens=500),
    )


def _outline_content() -> str:
    """Minimal outline text returned by the first (outline) LLM call."""
    return (
        "## What is the average locum GP rate? (target: 300 words)\n"
        "## How does pay vary by state? (target: 300 words)\n"
        "## What does this mean for locum doctors in NSW? (target: 300 words)\n"
        "## Frequently Asked Questions (target: 300 words)\n"
        "## Sources (target: 100 words)\n"
    )


class TestWriterPromptFloor:
    """M2.T1 — draft prompt explicitly states per-content_type word floor."""

    @patch("agents.writer.client.chat.completions.create")
    def test_writer_prompt_contains_floor_for_news(self, mock_create):
        """Prompt for a news-pillar topic must mention 1500 (the news floor)."""
        full_content = _minimal_markdown(word_target=1600)
        mock_create.side_effect = [
            _make_mock_response(_outline_content()),
            _make_mock_response(full_content),
        ]
        news_topic = _make_topic(pillar=ContentPillar.NEWS)
        write_post(_make_research(topic=news_topic))

        # The draft call is the second call; check its messages for the floor.
        assert mock_create.call_count >= 2
        draft_messages = mock_create.call_args_list[-1][1]["messages"]
        combined = " ".join(m["content"] for m in draft_messages)
        assert "1500" in combined, (
            "Expected the word floor '1500' for content_type=news to appear in the draft prompt"
        )

    @patch("agents.writer.client.chat.completions.create")
    def test_writer_prompt_contains_floor_for_guide(self, mock_create):
        """Prompt for a guide-pillar topic must mention 1500 (the guide floor)."""
        full_content = _minimal_markdown(word_target=1600)
        mock_create.side_effect = [
            _make_mock_response(_outline_content()),
            _make_mock_response(full_content),
        ]
        guide_topic = _make_topic(pillar=ContentPillar.HOW_TO)
        write_post(_make_research(topic=guide_topic))

        assert mock_create.call_count >= 2
        draft_messages = mock_create.call_args_list[-1][1]["messages"]
        combined = " ".join(m["content"] for m in draft_messages)
        assert "1500" in combined, (
            "Expected the word floor '1500' for content_type=guide to appear in the draft prompt"
        )

    @patch("agents.writer.client.chat.completions.create")
    def test_writer_prompt_contains_floor_for_company(self, mock_create):
        """Prompt for a company-pillar topic must mention 1000 (the company floor)."""
        full_content = _minimal_markdown(word_target=1100)
        mock_create.side_effect = [
            _make_mock_response(_outline_content()),
            _make_mock_response(full_content),
        ]
        company_topic = _make_topic(pillar=ContentPillar.COMPANY)
        write_post(_make_research(topic=company_topic))

        assert mock_create.call_count >= 2
        draft_messages = mock_create.call_args_list[-1][1]["messages"]
        combined = " ".join(m["content"] for m in draft_messages)
        assert "1000" in combined, (
            "Expected the word floor '1000' for content_type=company to appear in the draft prompt"
        )

    @patch("agents.writer.client.chat.completions.create")
    def test_writer_loads_word_floors_from_validators_json_not_hardcoded(
        self, mock_create, monkeypatch, tmp_path
    ):
        """Stubbing validators.json with sentinel floors proves the writer loads them
        dynamically — if the floors were hardcoded in Python the sentinel values would
        never appear in the prompt."""
        # Write a sentinel validators.json to tmp_path
        sentinel_floors = {"news": 9999, "guide": 8888, "company": 7777}
        fake_validators = {"word_floors": sentinel_floors}
        fake_json_path = tmp_path / "validators.json"
        fake_json_path.write_text(json.dumps(fake_validators))

        # Patch the loader used by the writer module to return our fake path
        import agents.writer as writer_mod
        monkeypatch.setattr(writer_mod, "_VALIDATORS_JSON_PATH", str(fake_json_path))
        # Also patch the cached floors dict so the module reloads from the stub
        monkeypatch.setattr(writer_mod, "_WORD_FLOORS", None)

        full_content = _minimal_markdown(word_target=9999)
        mock_create.side_effect = [
            _make_mock_response(_outline_content()),
            _make_mock_response(full_content),
        ]
        news_topic = _make_topic(pillar=ContentPillar.NEWS)
        write_post(_make_research(topic=news_topic))

        assert mock_create.call_count >= 2
        draft_messages = mock_create.call_args_list[-1][1]["messages"]
        combined = " ".join(m["content"] for m in draft_messages)
        assert "9999" in combined, (
            "Expected sentinel floor '9999' to appear in prompt — "
            "this fails if floors are hardcoded in Python rather than loaded from JSON"
        )


# ── M2.T2: two-pass outline → draft ──────────────────────────────────────────


class TestWriterTwoPass:
    """M2.T2 — writer makes an outline call then a draft call."""

    @patch("agents.writer.client.chat.completions.create")
    def test_writer_two_pass_outline_then_draft(self, mock_create):
        """The writer must call the LLM twice: first for an outline, then for
        the full draft. The draft call's messages must contain text from the
        outline returned by the first call."""
        outline_text = _outline_content()
        full_content = _minimal_markdown(word_target=1600)

        mock_create.side_effect = [
            _make_mock_response(outline_text),
            _make_mock_response(full_content),
        ]

        research = _make_research()
        post = write_post(research)

        # Two calls minimum (outline + draft); expansion retry is a third if needed
        assert mock_create.call_count >= 2, (
            f"Expected at least 2 LLM calls (outline + draft), got {mock_create.call_count}"
        )

        # The second call's messages must include text from the outline
        draft_call_messages = mock_create.call_args_list[1][1]["messages"]
        draft_combined = " ".join(m["content"] for m in draft_call_messages)
        # The outline contains a distinctive phrase; verify it's in the draft prompt
        assert "target:" in draft_combined or "## What is the average" in draft_combined, (
            "The draft call's prompt should contain content from the outline returned by "
            "the first (outline) LLM call"
        )


# ── M4: regenerate (rejection-reason retry) ───────────────────────────────────


class TestRegenerate:
    """D4 — writer.regenerate threads rejection_reason into the retry prompt."""

    @patch("agents.writer.client.chat.completions.create")
    def test_regenerate_includes_rejection_code_in_prompt(self, mock_create):
        """rejection_code string must appear in the prompt sent to the LLM."""
        new_content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=new_content))]
        )
        result = regenerate(
            slug="test-slug",
            rejection_reason="off_brand_voice",
            original_content="# Old draft\n\nShort content.",
        )
        assert mock_create.call_count == 1
        prompt = mock_create.call_args[1]["messages"][0]["content"]
        assert "off_brand_voice" in prompt

    @patch("agents.writer.client.chat.completions.create")
    def test_regenerate_includes_human_label_in_prompt(self, mock_create):
        """Human-readable label for the rejection code must appear in the prompt."""
        new_content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=new_content))]
        )
        regenerate(
            slug="test-slug",
            rejection_reason="off_brand_voice",
            original_content="# Old draft\n\nSome content.",
        )
        prompt = mock_create.call_args[1]["messages"][0]["content"]
        assert "Off-brand voice" in prompt

    @patch("agents.writer.client.chat.completions.create")
    def test_regenerate_includes_rewrite_instruction(self, mock_create):
        """Prompt must tell the model to rewrite addressing the rejection reason."""
        new_content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=new_content))]
        )
        regenerate(
            slug="test-slug",
            rejection_reason="wrong_angle",
            original_content="# Old draft\n\nSome content.",
        )
        prompt = mock_create.call_args[1]["messages"][0]["content"]
        # Must contain the key instruction phrase
        assert "Rewrite addressing this specifically" in prompt

    @patch("agents.writer.client.chat.completions.create")
    def test_regenerate_returns_new_content_string(self, mock_create):
        """regenerate() must return the new content as a string."""
        new_content = "# New Title\n\n**TL;DR:** Better.\n\n## Updated section\n\nFixed content."
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=new_content))]
        )
        result = regenerate(
            slug="test-slug",
            rejection_reason="weak_sources",
            original_content="# Old draft\n\nBad sources.",
        )
        assert result == new_content

    @patch("agents.writer.client.chat.completions.create")
    def test_regenerate_unknown_code_uses_code_as_label(self, mock_create):
        """If rejection_reason is not a known code, it is still included as-is."""
        new_content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=new_content))]
        )
        regenerate(
            slug="test-slug",
            rejection_reason="custom_editorial_note",
            original_content="# Old draft\n\nContent.",
        )
        prompt = mock_create.call_args[1]["messages"][0]["content"]
        assert "custom_editorial_note" in prompt

    def test_rejection_labels_include_all_known_codes(self):
        """_REJECTION_LABELS must map all 7 known rejection codes."""
        known_codes = [
            "off_brand_voice",
            "weak_sources",
            "wrong_angle",
            "too_promotional",
            "ahpra_disagree",
            "topic_uninteresting",
            "other",
        ]
        for code in known_codes:
            assert code in _REJECTION_LABELS, f"Missing label for code: {code}"
            assert _REJECTION_LABELS[code].strip(), f"Empty label for code: {code}"
