"""Supplemental tests for agents/ahpra.py — gap-filling on top of test_ahpra.py.

test_ahpra.py covers: _FORBIDDEN regex, _has_pay_content, _inject_before_sources,
and shared-config shape.

This file covers the remaining deterministic surface:
- check_ahpra: regex scan path (no GPT call needed for the regex section)
- check_ahpra: auto-disclaimer injection when general disclaimer missing
- check_ahpra: pay disclaimer injection when pay content present
- check_ahpra: passed=True when no human-review flags exist

The GPT deep-scan inside check_ahpra() is mocked away.
"""

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("OPENAI_API_KEY", "sk-test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.ahpra import (  # noqa: E402
    _GENERAL_DISCLAIMER,
    _PAY_DISCLAIMER,
    check_ahpra,
)


# ── Shared mock helper ─────────────────────────────────────────────────────────

_GPT_PASS = MagicMock(
    choices=[
        MagicMock(
            message=MagicMock(
                content='{"issues": [], "assessment": "PASS", "notes": "No issues found."}'
            )
        )
    ]
)


# ── check_ahpra: regex-triggered forbidden flags ───────────────────────────────


class TestCheckAhpraForbiddenFlags:
    @patch("agents.ahpra.client.chat.completions.create")
    def test_flags_forbidden_term_best_doctor(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = "Find the best doctor in Australia. " + "word " * 200
        _, flags, _ = check_ahpra(content)
        forbidden_flags = [f for f in flags if f.flag_type == "forbidden_claim"]
        assert len(forbidden_flags) >= 1
        assert any("best doctor" in f.fix_applied.lower() or "best" in f.excerpt.lower()
                   for f in forbidden_flags)

    @patch("agents.ahpra.client.chat.completions.create")
    def test_flags_guaranteed_results(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = "Guaranteed results for locum doctors. " + "word " * 200
        _, flags, _ = check_ahpra(content)
        forbidden_flags = [f for f in flags if f.flag_type == "forbidden_claim"]
        assert len(forbidden_flags) >= 1

    @patch("agents.ahpra.client.chat.completions.create")
    def test_no_forbidden_flags_on_clean_content(self, mock_create):
        mock_create.return_value = _GPT_PASS
        clean = (
            "Locum doctors in Australia typically earn between A$120 and A$180 per hour. "
            "Always consult a qualified adviser. Rates are indicative only and vary by location. "
            * 30
        )
        _, flags, _ = check_ahpra(clean)
        forbidden_flags = [f for f in flags if f.flag_type == "forbidden_claim"]
        assert forbidden_flags == []

    @patch("agents.ahpra.client.chat.completions.create")
    def test_forbidden_flag_requires_human_review(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = "Australia's #1 locum platform. " + "word " * 200
        _, flags, _ = check_ahpra(content)
        forbidden_flags = [f for f in flags if f.flag_type == "forbidden_claim"]
        assert all(f.requires_human_review for f in forbidden_flags)

    @patch("agents.ahpra.client.chat.completions.create")
    def test_excerpt_contains_context_around_match(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = "Our platform is world-class for locum doctors. " + "word " * 200
        _, flags, _ = check_ahpra(content)
        forbidden_flags = [f for f in flags if f.flag_type == "forbidden_claim"]
        assert len(forbidden_flags) >= 1
        # Excerpt should include some surrounding context (up to 40 chars either side)
        assert len(forbidden_flags[0].excerpt) > 0


# ── check_ahpra: disclaimer injection ─────────────────────────────────────────


class TestCheckAhpraDisclaimerInjection:
    @patch("agents.ahpra.client.chat.completions.create")
    def test_injects_general_disclaimer_when_absent(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = "## Intro\n\nSome content.\n\n## Sources\n1. AHPRA\n"
        result_content, flags, _ = check_ahpra(content)
        assert "general information" in result_content.lower()
        disclaimer_flags = [
            f for f in flags
            if f.flag_type == "missing_disclaimer" and "general" in f.fix_applied.lower()
        ]
        assert len(disclaimer_flags) == 1
        assert disclaimer_flags[0].requires_human_review is False

    @patch("agents.ahpra.client.chat.completions.create")
    def test_does_not_double_inject_general_disclaimer(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = (
            "This is general information only and does not constitute medical advice.\n"
            "## Sources\n1. AHPRA\n"
        )
        result_content, flags, _ = check_ahpra(content)
        # Count "general information" occurrences — should not be doubled
        count = result_content.lower().count("general information")
        assert count >= 1  # at least one
        # Specifically: no auto-inject flag should be added
        auto_injected = [
            f for f in flags
            if f.flag_type == "missing_disclaimer" and "general" in f.fix_applied.lower()
        ]
        assert len(auto_injected) == 0

    @patch("agents.ahpra.client.chat.completions.create")
    def test_injects_pay_disclaimer_when_pay_content_and_disclaimer_missing(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = (
            "The hourly rate for locum GPs in Australia is A$140. "
            "This is general information only and does not constitute medical advice. "
            "## Sources\n1. AMA\n"
        )
        result_content, flags, _ = check_ahpra(content)
        assert "indicative" in result_content.lower()
        pay_flags = [
            f for f in flags
            if f.flag_type == "missing_disclaimer" and "pay" in f.fix_applied.lower()
        ]
        assert len(pay_flags) == 1
        assert pay_flags[0].requires_human_review is False

    @patch("agents.ahpra.client.chat.completions.create")
    def test_does_not_inject_pay_disclaimer_when_already_present(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = (
            "The hourly rate is A$140. "
            "Figures mentioned are indicative only and vary by location. "
            "This is general information only and does not constitute medical advice. "
            "## Sources\n1. AMA\n"
        )
        _, flags, _ = check_ahpra(content)
        pay_flags = [
            f for f in flags
            if f.flag_type == "missing_disclaimer" and "pay" in f.fix_applied.lower()
        ]
        assert len(pay_flags) == 0


# ── check_ahpra: passed flag ───────────────────────────────────────────────────


class TestCheckAhpraPassed:
    @patch("agents.ahpra.client.chat.completions.create")
    def test_passed_true_when_only_auto_fix_flags(self, mock_create):
        """Auto-fix flags (requires_human_review=False) don't set passed=False."""
        mock_create.return_value = _GPT_PASS
        # Clean content with no disclaimers → will add auto-fix flags, but passed=True
        content = "Locum doctors work across Australia. " + "word " * 200
        _, flags, passed = check_ahpra(content)
        human_review_flags = [f for f in flags if f.requires_human_review]
        assert human_review_flags == []
        assert passed is True

    @patch("agents.ahpra.client.chat.completions.create")
    def test_passed_false_when_forbidden_term_present(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = "We are number one in Australia. " + "word " * 200
        _, flags, passed = check_ahpra(content)
        assert passed is False

    @patch("agents.ahpra.client.chat.completions.create")
    def test_return_tuple_is_content_flags_passed(self, mock_create):
        mock_create.return_value = _GPT_PASS
        content = "Clean content about locum medicine. " + "word " * 200
        result = check_ahpra(content)
        assert len(result) == 3
        assert isinstance(result[0], str)  # content
        assert isinstance(result[1], list)  # flags
        assert isinstance(result[2], bool)  # passed

    @patch("agents.ahpra.client.chat.completions.create")
    def test_gpt_scan_error_does_not_raise(self, mock_create):
        """If the GPT call fails, check_ahpra should still return a result."""
        mock_create.side_effect = Exception("API timeout")
        content = "Locum work in Australia. " + "word " * 200
        result_content, flags, passed = check_ahpra(content)
        assert isinstance(result_content, str)
        # Auto-fix flags may still be present; just must not raise
