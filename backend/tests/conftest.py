"""Shared pytest configuration for the backend test suite.

Hoists the sys.path shim that was previously inlined per-file (see
test_url_validation_drift.py:8-13), so every test file can import either
`validation.urls` (backend-relative) or `backend.validation.urls`
(repo-root-relative) without repeating the boilerplate.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(_BACKEND_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


REPO_ROOT = Path(_REPO_ROOT)
VALIDATORS_JSON_PATH = REPO_ROOT / "extracted" / "lib" / "admin" / "validators.json"


@pytest.fixture
def validators_config() -> dict[str, Any]:
    """Loaded validators.json — the single source of truth for editorial rules."""
    import json
    return json.loads(VALIDATORS_JSON_PATH.read_text())


@pytest.fixture
def fake_openai_client() -> MagicMock:
    """A MagicMock shaped like the openai.OpenAI client.

    Tests configure return values per-call:

        fake_openai_client.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content="..."))]
        )
    """
    client = MagicMock()
    client.chat.completions.create = MagicMock()
    return client
