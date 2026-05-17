"""Layer A — fail_agent validator tests.

Pure unit tests: no DB, no network. Each test follows Given/When/Then naming.
"""
from __future__ import annotations

from types import SimpleNamespace

from agents.fail_agent import (
    Result,
    check_all,
    validate_ahpra,
    validate_researcher,
    validate_seo,
    validate_writer,
)


def _brief(sources: int = 5) -> dict:
    return {"sources": [{"url": f"https://ahpra.gov.au/x{i}"} for i in range(sources)]}


def _draft(words: int = 1700, content_type: str = "guide") -> dict:
    return {
        "content_type": content_type,
        "word_count": words,
        "content_markdown": "word " * words,
    }


class TestValidateResearcher:
    def test_given_brief_with_4_sources_when_validated_then_fails_source_count(self):
        result = validate_researcher(_brief(sources=4))
        assert result.ok is False
        assert "source_count" in result.reason

    def test_given_brief_with_5_sources_when_validated_then_passes(self):
        assert validate_researcher(_brief(sources=5)).ok is True

    def test_given_brief_as_object_with_sources_attr_when_validated_then_works(self):
        obj = SimpleNamespace(sources=list(range(5)))
        assert validate_researcher(obj).ok is True


class TestValidateWriter:
    def test_given_guide_below_floor_when_validated_then_fails_word_count(self):
        result = validate_writer(_draft(words=800, content_type="guide"))
        assert result.ok is False
        assert "word_count" in result.reason
        assert "1500" in result.reason

    def test_given_guide_above_floor_when_validated_then_passes(self):
        assert validate_writer(_draft(words=1800, content_type="guide")).ok is True

    def test_given_company_with_1100_words_when_validated_then_passes_floor_1000(self):
        assert validate_writer(_draft(words=1100, content_type="company")).ok is True

    def test_given_draft_missing_word_count_when_validated_then_falls_back_to_markdown_split(self):
        draft = {"content_type": "guide", "content_markdown": "x " * 1800}
        assert validate_writer(draft).ok is True


class TestValidateAHPRA:
    def test_given_content_with_best_doctor_when_validated_then_fails(self):
        result = validate_ahpra("She is the best doctor in Sydney.")
        assert result.ok is False
        assert "best doctor" in result.reason.lower()

    def test_given_clean_content_when_validated_then_passes(self):
        assert validate_ahpra("Locum doctors operate under AHPRA registration.").ok is True

    def test_given_empty_content_when_validated_then_fails_schema(self):
        result = validate_ahpra("")
        assert result.ok is False


class TestValidateSEO:
    def test_given_seo_missing_meta_title_when_validated_then_fails_schema(self):
        result = validate_seo({"meta_description": "MD"})
        assert result.ok is False
        assert "meta_title" in result.reason

    def test_given_seo_missing_meta_description_when_validated_then_fails_schema(self):
        result = validate_seo({"meta_title": "MT"})
        assert result.ok is False
        assert "meta_description" in result.reason

    def test_given_complete_seo_when_validated_then_passes(self):
        assert validate_seo({"meta_title": "MT", "meta_description": "MD"}).ok is True


class TestCheckAll:
    def test_given_all_inputs_valid_when_check_all_then_all_results_ok(self):
        results = check_all(
            brief=_brief(),
            draft=_draft(),
            seo={"meta_title": "MT", "meta_description": "MD"},
            ahpra_content="Clean text",
        )
        assert len(results) == 4
        assert all(r.ok for r in results)

    def test_given_writer_below_floor_when_check_all_then_writer_fails_but_others_pass(self):
        results = check_all(
            brief=_brief(),
            draft=_draft(words=400),
            seo={"meta_title": "MT", "meta_description": "MD"},
            ahpra_content="Clean text",
        )
        assert results[0].ok is True
        assert results[1].ok is False
        assert results[2].ok is True
        assert results[3].ok is True

    def test_given_only_brief_when_check_all_then_returns_single_researcher_result(self):
        results = check_all(brief=_brief())
        assert len(results) == 1
        assert results[0].ok is True


def test_result_is_immutable():
    r = Result(True, "ok")
    try:
        r.ok = False  # type: ignore[misc]
    except Exception:
        pass
    # frozen dataclass — attribute reassignment raises; either way ok stays True
    assert r.ok is True
