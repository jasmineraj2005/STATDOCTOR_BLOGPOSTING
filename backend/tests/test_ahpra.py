"""Adversarial tests for the AHPRA compliance scan.

Covers the deterministic parts of agents/ahpra.py:
- _FORBIDDEN regex patterns (loaded from validators.json — shared with TS)
- _has_pay_content detection
- _inject_before_sources placement

The GPT deep-scan in check_ahpra() is intentionally NOT tested here (would call
the OpenAI API). Manual integration test: run `python main.py` end-to-end.
"""

import re
import sys
import os

# Make backend/ importable when running pytest from repo root or backend/.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.ahpra import (  # noqa: E402
    _FORBIDDEN,
    _GENERAL_DISCLAIMER,
    _PAY_DISCLAIMER,
    _PAY_TRIGGERS,
    _has_pay_content,
    _inject_before_sources,
)


# ── _FORBIDDEN regex patterns ──────────────────────────────────────────────────


def _scan(text: str) -> list[str]:
    """Return the human-readable reasons for every pattern that fires."""
    hits = []
    for pattern, reason in _FORBIDDEN:
        if re.search(pattern, text, re.IGNORECASE):
            hits.append(reason)
    return hits


class TestForbiddenRegex:
    """Adversarial inputs the model might produce. Each should fire ≥1 pattern."""

    def test_best_doctor(self):
        assert _scan("Find the best doctor in Sydney.")

    def test_number_one(self):
        assert _scan("We're number one in locum placements.")
        assert _scan("We're number-one in NSW.")

    def test_hash_one(self):
        assert _scan("Sydney's #1 locum platform.")
        assert _scan("Voted # 1 in the AMA survey.")

    def test_world_class(self):
        assert _scan("World-class clinicians on every shift.")
        assert _scan("world class hospital experience")

    def test_australias_best(self):
        assert _scan("Australia's best locum marketplace.")
        assert _scan("Australia's leading platform for doctors.")
        assert _scan("Australias top medical marketplace.")  # missing apostrophe

    def test_guaranteed_results(self):
        assert _scan("Guaranteed results within 4 weeks.")
        assert _scan("Guaranteed outcomes for every locum.")
        assert _scan("Guarantee success on your first shift.")

    def test_cure(self):
        assert _scan("A cure for the GP shortage.")
        assert _scan("This cures the rural locum gap.")
        assert _scan("Already cured the staffing issue.")

    def test_testimonial(self):
        assert _scan("Read this testimonial from Dr Smith.")
        assert _scan("Patient testimonials are inspiring.")

    def test_patient_endorsement(self):
        assert _scan("An endorsement from a patient who returned.")
        assert _scan("Endorsement from my client about the service.")

    def test_leading_specialist(self):
        assert _scan("Leading specialist in emergency medicine.")

    def test_most_experienced(self):
        assert _scan("The most experienced doctors in Sydney.")

    def test_clean_content_no_hits(self):
        clean = (
            "Locum work in NSW typically pays between A$120 and A$180 per hour. "
            "Doctors should consult [AHPRA registration](https://www.ahpra.gov.au/) "
            "before applying. Rates are indicative only and vary by specialty."
        )
        assert _scan(clean) == []

    def test_substring_inside_url_does_not_misfire(self):
        # Word-boundary anchors should mean "cure" inside a URL fragment
        # like #curepoint doesn't trigger. Spot-check: the regex IS \bcure[sd]?\b,
        # so within a hash fragment the # is a non-word char → boundary at 'c'.
        # If a future pattern change breaks this, the test will surface it.
        url_only = "Visit https://example.com/curepoint for details."
        # Whether this fires depends on the pattern; we just assert behaviour
        # is stable. Snapshotting current behaviour:
        hits = _scan(url_only)
        # The pattern \bcure[sd]?\b would match "cure" inside "curepoint"? No —
        # "curepoint" has no word boundary inside it. So no hit.
        assert "cure" not in " ".join(hits).lower()


# ── _has_pay_content ───────────────────────────────────────────────────────────


class TestPayDetection:
    def test_pay_rate(self):
        assert _has_pay_content("locum doctors earn higher pay rate in NSW")

    def test_hourly_rate(self):
        assert _has_pay_content("The standard hourly rate is A$140.")

    def test_daily_rate(self):
        assert _has_pay_content("Daily rate ranges from A$1,100 to A$1,600.")

    def test_annual_salary(self):
        assert _has_pay_content("annual salary expectations for locums")

    def test_income(self):
        assert _has_pay_content("income for locum GPs in rural areas")

    def test_remuneration(self):
        assert _has_pay_content("remuneration packages for FACEMs")

    def test_no_pay_content(self):
        assert not _has_pay_content("AHPRA registration is a 4-week process.")

    def test_all_known_triggers_covered(self):
        """Every trigger word from validators.json should fire detection."""
        for trigger in _PAY_TRIGGERS:
            assert _has_pay_content(
                f"Sentence with the word {trigger} embedded."
            ), f"trigger '{trigger}' didn't fire _has_pay_content"


# ── _inject_before_sources ────────────────────────────────────────────────────


class TestDisclaimerInjection:
    def test_injects_before_sources_heading(self):
        body = "## Intro\n\nSomething.\n\n## Sources\n1. AHPRA\n"
        result = _inject_before_sources(body, _GENERAL_DISCLAIMER)
        # Disclaimer should appear before "## Sources"
        idx_d = result.find("Disclaimer:")
        idx_s = result.find("## Sources")
        assert idx_d != -1 and idx_s != -1
        assert idx_d < idx_s

    def test_appends_when_no_sources_section(self):
        body = "## Intro\n\nSomething.\n"
        result = _inject_before_sources(body, _PAY_DISCLAIMER)
        assert result.endswith(_PAY_DISCLAIMER)

    def test_only_first_sources_heading_used(self):
        body = "## Sources\nA\n\n## Sources\nB\n"
        result = _inject_before_sources(body, _GENERAL_DISCLAIMER)
        # Disclaimer injected before the FIRST ## Sources only.
        assert result.count("## Sources") == 2
        assert result.index("Disclaimer:") < result.index("## Sources")


# ── Cross-side consistency with TS ────────────────────────────────────────────


class TestSharedConfig:
    """Sanity-check that validators.json loads the patterns the TS side uses."""

    def test_at_least_11_ahpra_patterns(self):
        # If a pattern is dropped accidentally, this catches it.
        assert len(_FORBIDDEN) >= 11

    def test_pay_triggers_cover_core_phrases(self):
        expected = {"pay rate", "hourly rate", "daily rate", "annual salary"}
        assert expected.issubset(_PAY_TRIGGERS)
