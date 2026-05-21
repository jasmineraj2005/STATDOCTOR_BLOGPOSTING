"""Tests for pipeline.run_with_retry — the M13 closed-loop retry helper.

Closes the gap where the pipeline writes once and ships. With this helper,
the writer is re-invoked with the validator's failure reason as
`previous_failure`, up to a bounded number of retries. Exhausted retries
abort the pipeline (caller dispatches alert).
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pipeline import run_with_retry


class TestRunWithRetry:
    def test_passes_on_first_attempt_returns_immediately(self):
        calls: list[dict] = []

        def agent_fn(**kwargs):
            calls.append(kwargs)
            return {"output": "first"}

        def validator_fn(result):
            return None  # always pass

        result = run_with_retry(agent_fn=agent_fn, validator_fn=validator_fn)
        assert result == {"output": "first"}
        assert len(calls) == 1
        # First call must not carry previous_failure
        assert "previous_failure" not in calls[0]

    def test_retries_with_previous_failure_kwarg(self):
        calls: list[dict] = []
        results = [{"output": "bad1"}, {"output": "good"}]

        def agent_fn(**kwargs):
            calls.append(kwargs)
            return results.pop(0)

        # First validation fails, second passes
        validations = ["FAQ short by 1 — needs 6, got 5", None]

        def validator_fn(result):
            return validations.pop(0)

        result = run_with_retry(agent_fn=agent_fn, validator_fn=validator_fn)
        assert result == {"output": "good"}
        assert len(calls) == 2
        # Retry call must include previous_failure with the validator's reason
        assert calls[1].get("previous_failure") == "FAQ short by 1 — needs 6, got 5"
        # First call still bare
        assert "previous_failure" not in calls[0]

    def test_exhausted_retries_raises_pipeline_aborted(self):
        def agent_fn(**kwargs):
            return {"output": "never-good"}

        def validator_fn(result):
            return "still red — schema FAQ short"

        with pytest.raises(RuntimeError) as excinfo:
            run_with_retry(
                agent_fn=agent_fn, validator_fn=validator_fn, max_retries=2
            )
        msg = str(excinfo.value)
        assert "pipeline_aborted" in msg
        assert "schema FAQ short" in msg

    def test_respects_max_retries_count(self):
        """max_retries=2 means 1 initial attempt + 2 retries = 3 total calls."""
        calls = []

        def agent_fn(**kwargs):
            calls.append(kwargs)
            return {}

        def validator_fn(result):
            return "always red"

        with pytest.raises(RuntimeError):
            run_with_retry(
                agent_fn=agent_fn, validator_fn=validator_fn, max_retries=2
            )
        assert len(calls) == 3

    def test_agent_kwargs_passed_through(self):
        captured: list[dict] = []

        def agent_fn(**kwargs):
            captured.append(kwargs)
            return "ok"

        def validator_fn(result):
            return None

        run_with_retry(
            agent_fn=agent_fn,
            validator_fn=validator_fn,
            agent_kwargs={"topic": "X", "floor": 1000},
        )
        assert captured[0] == {"topic": "X", "floor": 1000}

    def test_max_retries_zero_means_no_retry(self):
        """max_retries=0 means a single attempt — no retry on failure."""
        calls = []

        def agent_fn(**kwargs):
            calls.append(kwargs)
            return {}

        def validator_fn(result):
            return "red"

        with pytest.raises(RuntimeError):
            run_with_retry(
                agent_fn=agent_fn, validator_fn=validator_fn, max_retries=0
            )
        assert len(calls) == 1
