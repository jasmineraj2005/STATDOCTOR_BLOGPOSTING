"""Tests for M16 — AHPRA flag severity assignment.

Severity tiers:
  - "info":  auto-fixed (requires_human_review=False). Non-blocking, surfaced for visibility.
  - "warn":  manual review needed but it's a quality concern, not a compliance violation.
             Today: unsupported_stat (not auto-cited) and missing_disclaimer (not auto-injected).
  - "error": hard AHPRA prohibition — blocks ACCEPT.
             Today: forbidden_claim (regex match) and unknown flag types (fail-safe).

The TS validator gate uses severity to decide whether to fail; this Python module is the
source of truth for the assignment.
"""
from __future__ import annotations

from agents.ahpra import _severity_for
from models import AHPRAFlag


class TestSeverityFor:
    """Pure-function classifier."""

    def test_auto_fixed_flag_is_info(self):
        assert _severity_for("forbidden_claim", requires_review=False) == "info"
        assert _severity_for("missing_disclaimer", requires_review=False) == "info"
        assert _severity_for("unsupported_stat", requires_review=False) == "info"
        assert _severity_for("unknown", requires_review=False) == "info"

    def test_manual_review_forbidden_claim_is_error(self):
        assert _severity_for("forbidden_claim", requires_review=True) == "error"

    def test_manual_review_unsupported_stat_is_warn(self):
        """Stats lacking inline cites are quality, not compliance — yellow not red."""
        assert _severity_for("unsupported_stat", requires_review=True) == "warn"

    def test_manual_review_missing_disclaimer_is_warn(self):
        """If the auto-inject path didn't fire, the disclaimer gap is editorial fixable."""
        assert _severity_for("missing_disclaimer", requires_review=True) == "warn"

    def test_unknown_flag_type_defaults_to_error_fail_safe(self):
        """An unrecognised flag_type must block ACCEPT, not silently pass."""
        assert _severity_for("brand_new_category", requires_review=True) == "error"


class TestAHPRAFlagModelHasSeverity:
    """The Pydantic model must carry the severity field with a safe default."""

    def test_severity_defaults_to_error_when_omitted(self):
        """Back-compat: any code path that constructs an AHPRAFlag without severity
        is treated as an error (fail-safe). New code paths should set severity explicitly."""
        flag = AHPRAFlag(
            flag_type="forbidden_claim",
            excerpt="x",
            fix_applied="y",
            requires_human_review=True,
        )
        assert flag.severity == "error"

    def test_severity_accepts_info_warn_error(self):
        for s in ("info", "warn", "error"):
            flag = AHPRAFlag(
                flag_type="forbidden_claim",
                excerpt="x",
                fix_applied="y",
                requires_human_review=False,
                severity=s,
            )
            assert flag.severity == s

    def test_severity_rejects_invalid_value(self):
        from pydantic import ValidationError
        try:
            AHPRAFlag(
                flag_type="forbidden_claim",
                excerpt="x",
                fix_applied="y",
                requires_human_review=False,
                severity="catastrophic",  # type: ignore[arg-type]
            )
            raise AssertionError("expected ValidationError for severity='catastrophic'")
        except ValidationError:
            pass


class TestCheckAhpraSetsSeverityOnFlags:
    """End-to-end: check_ahpra() must populate severity on every flag it produces."""

    def test_regex_caught_forbidden_phrase_is_severity_error(self, monkeypatch):
        from agents import ahpra as ahpra_mod
        monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", False)

        # Stub GPT scan to return nothing — we want only the regex pass.
        def _no_issues(*args, **kwargs):
            from types import SimpleNamespace
            import json
            return SimpleNamespace(choices=[SimpleNamespace(
                message=SimpleNamespace(content=json.dumps({"issues": [], "assessment": "PASS"}))
            )])
        monkeypatch.setattr(ahpra_mod.client.chat.completions, "create", _no_issues)

        # "Australia's leading" is in validators.json -> regex hit.
        _, flags, _ = ahpra_mod.check_ahpra("We are Australia's leading marketplace for locum doctors. " * 30)

        forbidden = [f for f in flags if f.flag_type == "forbidden_claim"]
        assert forbidden, "regex pass should have produced at least one forbidden_claim flag"
        for f in forbidden:
            assert f.severity == "error", (
                f"regex-caught forbidden_claim must be severity=error, got {f.severity!r}"
            )

    def test_auto_injected_disclaimer_is_severity_info(self, monkeypatch):
        from agents import ahpra as ahpra_mod
        monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", False)

        def _no_issues(*args, **kwargs):
            from types import SimpleNamespace
            import json
            return SimpleNamespace(choices=[SimpleNamespace(
                message=SimpleNamespace(content=json.dumps({"issues": [], "assessment": "PASS"}))
            )])
        monkeypatch.setattr(ahpra_mod.client.chat.completions, "create", _no_issues)

        # Clean content lacking the general disclaimer — triggers auto-inject.
        _, flags, _ = ahpra_mod.check_ahpra("Locum doctors fill gaps. " * 30)
        disclaimer_flags = [f for f in flags if f.flag_type == "missing_disclaimer"]
        assert disclaimer_flags, "missing-disclaimer auto-inject should produce a flag"
        for f in disclaimer_flags:
            assert f.requires_human_review is False
            assert f.severity == "info", (
                f"auto-injected disclaimer flag should be severity=info, got {f.severity!r}"
            )

    def test_gpt_unsupported_stat_without_cite_is_severity_warn(self, monkeypatch):
        from agents import ahpra as ahpra_mod
        monkeypatch.setattr(ahpra_mod, "AHPRA_CHUNKED_SCAN", False)

        def _stat_issue(*args, **kwargs):
            from types import SimpleNamespace
            import json
            return SimpleNamespace(choices=[SimpleNamespace(
                message=SimpleNamespace(content=json.dumps({
                    "issues": [{
                        "flag_type": "unsupported_stat",
                        "excerpt": "75% of locums",
                        "fix_applied": "cite a source",
                        "requires_human_review": True,
                    }],
                    "assessment": "REVIEW",
                }))
            )])
        monkeypatch.setattr(ahpra_mod.client.chat.completions, "create", _stat_issue)

        # No nearby source URLs → B4 doesn't auto-resolve → flag stays manual.
        _, flags, _ = ahpra_mod.check_ahpra(
            "Article body referencing 75% of locums but providing no cite nearby. " * 20
        )
        stat_flags = [f for f in flags if f.flag_type == "unsupported_stat"]
        assert stat_flags
        for f in stat_flags:
            assert f.requires_human_review is True
            assert f.severity == "warn", (
                f"un-auto-cited unsupported_stat should be severity=warn, got {f.severity!r}"
            )
