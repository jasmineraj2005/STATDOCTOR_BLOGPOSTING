import json
import os
import sys
from pathlib import Path

# Add the backend dir to sys.path so 'validation.urls' is importable,
# and also add the repo root so 'backend.validation.urls' is importable.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(_BACKEND_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from backend.validation.urls import is_whitelisted

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "data" / "fixtures" / "url-validation-drift.json"

def test_drift_fixture_exists_and_has_20_cases():
    data = json.loads(FIXTURE.read_text())
    assert len(data["cases"]) == 20

def test_python_validator_matches_drift_fixture():
    data = json.loads(FIXTURE.read_text())
    mismatches = []
    for case in data["cases"]:
        actual = is_whitelisted(case["url"])
        if actual != case["expected_whitelisted"]:
            mismatches.append(f"{case['url']!r}: expected {case['expected_whitelisted']}, got {actual}")
    assert not mismatches, "Python validator drift:\n" + "\n".join(mismatches)
