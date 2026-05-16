"""Tests for agents/writer.py — deterministic parts only.

Covers:
- _PILLAR_LABELS mapping completeness
- Prompt builder helpers (sources_text, facts_text, inline_img_instruction)
- TL;DR extraction from generated markdown
- word_count computed in write_post
- Expansion retry logic triggered when word count < MIN_WORDS
- write_post: full flow (OpenAI mocked) — output shape

LLM call is mocked throughout. No real API calls are made.
"""

import os
import sys
from unittest.mock import MagicMock, call, patch

import pytest

os.environ.setdefault("OPENAI_API_KEY", "sk-test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.writer import _PILLAR_LABELS, write_post  # noqa: E402
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
        """No second API call when word count already meets the floor."""
        content = _minimal_markdown(word_target=1600)
        mock_create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=content))]
        )
        write_post(_make_research())
        assert mock_create.call_count == 1

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
