"""Drift test: writer prompt must reflect every banned phrase in validators.json.

Mirrors test_url_validation_drift.py — guards against the writer prompt drifting
from the validators.json single source of truth (Bug B2 in docs/bugs.md).

Failed before M3 (writer.py:284 hardcoded 8 of 11 patterns). After M3 the writer
loads ahpra_banned + editorially_banned from validators.json and renders both
into the prompt; this test enforces the wiring stays correct.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from agents.writer import (
    _get_ahpra_banned,
    _get_editorially_banned,
    _render_banned_phrases_block,
    _render_editorially_banned_block,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATORS_JSON = REPO_ROOT / "extracted" / "lib" / "admin" / "validators.json"
WRITER_PATH = REPO_ROOT / "backend" / "agents" / "writer.py"


def _validators_data() -> dict:
    return json.loads(VALIDATORS_JSON.read_text())


def test_validators_json_has_eleven_ahpra_banned_patterns():
    """Sanity: 11 patterns documented in architecture.md §6. Update both when changed."""
    patterns = _validators_data()["ahpra_banned"]
    assert len(patterns) == 11, (
        f"validators.json has {len(patterns)} ahpra_banned patterns, expected 11. "
        f"Update architecture.md §6 banned-phrase table if intentional."
    )


def test_get_ahpra_banned_matches_validators_json():
    """writer._get_ahpra_banned must return the same list as validators.json."""
    expected = _validators_data()["ahpra_banned"]
    actual = _get_ahpra_banned()
    assert actual == expected


def test_get_editorially_banned_matches_validators_json():
    expected = _validators_data()["editorially_banned"]
    actual = _get_editorially_banned()
    assert actual == expected


def test_rendered_banned_block_contains_every_ahpra_pattern():
    """M3 / Bug B2: the rendered prompt block must include every ahpra_banned pattern.

    Before M3 only 8 of 11 patterns were mentioned in writer.py (the prompt
    hardcoded a subset). After M3 the block is computed from validators.json
    and includes the regex pattern verbatim so drift cannot recur.
    """
    block = _render_banned_phrases_block()
    missing: list[str] = []
    for entry in _validators_data()["ahpra_banned"]:
        if entry["pattern"] not in block:
            missing.append(entry["pattern"])
    assert not missing, (
        "Rendered writer prompt block is missing patterns from validators.json:\n"
        + "\n".join(f"  - {p}" for p in missing)
    )


def test_rendered_banned_block_contains_human_readable_phrase():
    """Spot-check the human-readable rendering for a handful of canonical phrases."""
    block = _render_banned_phrases_block()
    for must_appear in [
        "best doctor",
        "leading specialist",
        "australia",
        "guaranteed",
        "testimonial",
        "endorsement",
    ]:
        assert must_appear in block.lower(), (
            f"human-readable signal {must_appear!r} not in rendered banned block:\n{block}"
        )


def test_rendered_editorially_banned_block_includes_all_four():
    """Editorially banned: comprehensive, delve, groundbreaking, robust. All four."""
    block = _render_editorially_banned_block().lower()
    for phrase in ["comprehensive", "delve", "groundbreaking", "robust"]:
        assert phrase in block, (
            f"editorially_banned signal {phrase!r} missing from rendered block:\n{block}"
        )


def test_writer_source_no_longer_hardcodes_legacy_phrase_list():
    """After M3, the legacy hardcoded list at writer.py:284 should be gone.

    The pre-M3 line literally contained: 'best doctor", "number one", "#1"'.
    If this substring reappears, someone is drifting back to a hardcoded list.
    """
    src = WRITER_PATH.read_text()
    assert '"best doctor", "number one", "#1"' not in src, (
        "writer.py reintroduced a hardcoded banned-phrase list. "
        "Always read from validators.json via _render_banned_phrases_block()."
    )
