"""
M1.T2 — Tests for backend/validation/urls.py
TDD: written before implementation.
"""

import os
import sys
import time
import httpx
import pytest
from unittest.mock import MagicMock

# Add the backend dir to sys.path so 'validation.urls' is importable,
# and also add the repo root so 'backend.validation.urls' is importable.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(_BACKEND_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from backend.validation.urls import (
    is_whitelisted,
    head_check,
    validate_sources,
    HeadResult,
    ValidationResult,
)

# ── is_whitelisted ───────────────────────────────────────────────────────────


class TestIsWhitelisted:
    def test_returns_true_for_root_domain(self):
        assert is_whitelisted("https://theguardian.com/x") is True

    def test_returns_true_for_www_prefixed(self):
        assert is_whitelisted("https://www.theguardian.com/x") is True

    def test_returns_true_for_subdomain_of_whitelisted_root(self):
        assert is_whitelisted("https://www1.aihw.gov.au/reports/x") is True

    def test_returns_false_for_unknown_domain(self):
        assert is_whitelisted("https://made-up-domain.example.com/x") is False

    def test_returns_false_for_unparseable_url(self):
        assert is_whitelisted("not a url at all") is False

    def test_is_case_insensitive(self):
        assert is_whitelisted("https://THEGUARDIAN.COM/x") is True

    def test_returns_true_for_non_guardian_subdomain_in_whitelist(self):
        # ncbi.nlm.nih.gov is in the whitelist; this is a direct match
        assert is_whitelisted("https://ncbi.nlm.nih.gov/pubmed/123") is True

    def test_returns_false_for_similar_but_different_domain(self):
        # nottheguardian.com should not match theguardian.com
        assert is_whitelisted("https://nottheguardian.com/x") is False


# ── head_check ───────────────────────────────────────────────────────────────


class TestHeadCheck:
    def test_returns_ok_for_200(self):
        transport = httpx.MockTransport(lambda req: httpx.Response(200))
        client = httpx.Client(transport=transport, follow_redirects=True)
        result = head_check("https://theguardian.com/a", http=client)
        assert result.ok is True
        assert result.status == 200
        assert result.reason == "ok"
        assert result.attempts == 1

    def test_returns_ok_for_301_redirect_then_200(self):
        # MockTransport doesn't simulate redirects in flight; use a router.
        def handler(req: httpx.Request):
            if "redirect" in str(req.url):
                return httpx.Response(301, headers={"Location": "https://theguardian.com/final"})
            return httpx.Response(200)

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport, follow_redirects=True)
        result = head_check("https://theguardian.com/redirect", http=client)
        assert result.ok is True

    def test_drops_404(self):
        transport = httpx.MockTransport(lambda req: httpx.Response(404))
        client = httpx.Client(transport=transport, follow_redirects=True)
        result = head_check("https://theguardian.com/dead", http=client, retries=0)
        assert result.ok is False
        assert result.status == 404
        assert result.reason == "http_404"
        assert result.attempts == 1  # no retry on 404

    def test_retries_5xx_then_succeeds(self):
        calls = {"n": 0}

        def handler(req):
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(500)
            return httpx.Response(200)

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport, follow_redirects=True)
        sleeper = MagicMock()
        result = head_check("https://theguardian.com/x", http=client, retries=1, sleeper=sleeper)
        assert result.ok is True
        assert result.attempts == 2
        sleeper.assert_called_once()

    def test_surfaces_5xx_after_retries(self):
        transport = httpx.MockTransport(lambda req: httpx.Response(503))
        client = httpx.Client(transport=transport, follow_redirects=True)
        sleeper = MagicMock()
        result = head_check("https://theguardian.com/x", http=client, retries=1, sleeper=sleeper)
        assert result.ok is False
        assert result.status == 503
        assert result.reason == "http_5xx"
        assert result.attempts == 2

    def test_retries_429(self):
        transport = httpx.MockTransport(lambda req: httpx.Response(429))
        client = httpx.Client(transport=transport, follow_redirects=True)
        sleeper = MagicMock()
        result = head_check("https://theguardian.com/x", http=client, retries=2, sleeper=sleeper)
        assert result.ok is False
        assert result.status == 429
        assert result.attempts == 3

    def test_surfaces_timeout(self):
        def handler(req):
            raise httpx.TimeoutException("slow")

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport, follow_redirects=True)
        result = head_check("https://theguardian.com/x", http=client, retries=0)
        assert result.ok is False
        assert result.reason == "timeout"
        assert result.status is None

    def test_4xx_no_retry(self):
        """Non-404 4xx should not retry (e.g. 403)."""
        calls = {"n": 0}

        def handler(req):
            calls["n"] += 1
            return httpx.Response(403)

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport, follow_redirects=True)
        sleeper = MagicMock()
        result = head_check("https://theguardian.com/x", http=client, retries=3, sleeper=sleeper)
        assert result.ok is False
        assert result.reason == "http_4xx"
        assert result.attempts == 1
        sleeper.assert_not_called()

    def test_connect_error(self):
        def handler(req):
            raise httpx.ConnectError("refused")

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport, follow_redirects=True)
        result = head_check("https://theguardian.com/x", http=client, retries=0)
        assert result.ok is False
        assert result.reason == "connect_error"
        assert result.status is None

    def test_result_is_head_result_dataclass(self):
        transport = httpx.MockTransport(lambda req: httpx.Response(200))
        client = httpx.Client(transport=transport, follow_redirects=True)
        result = head_check("https://theguardian.com/a", http=client)
        assert isinstance(result, HeadResult)
        assert result.url == "https://theguardian.com/a"

    def test_creates_own_client_when_none(self, monkeypatch):
        """Smoke test: when http=None, a client is created internally.
        We monkeypatch httpx.Client to intercept and return a mock client."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.head.return_value = mock_response

        import backend.validation.urls as urls_mod

        original = urls_mod.httpx.Client

        class FakeClient:
            def __init__(self, **kwargs):
                pass

            def head(self, url, **kwargs):
                return mock_response

            def close(self):
                pass

        monkeypatch.setattr(urls_mod.httpx, "Client", FakeClient)
        result = head_check("https://theguardian.com/a")
        assert result.ok is True
        monkeypatch.setattr(urls_mod.httpx, "Client", original)


# ── validate_sources ─────────────────────────────────────────────────────────


class TestValidateSources:
    @staticmethod
    def _ok_client():
        return httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(200)),
            follow_redirects=True,
        )

    def test_keeps_all_whitelisted_200(self):
        sources = [
            {"url": "https://theguardian.com/a", "publisher": "Guardian"},
            {"url": "https://abc.net.au/b", "publisher": "ABC"},
        ]
        result = validate_sources(sources, http=self._ok_client())
        assert len(result.ok_sources) == 2
        assert result.flags == []
        assert result.total_input == 2
        assert result.total_ok == 2

    def test_drops_non_whitelisted(self):
        sources = [
            {"url": "https://theguardian.com/a", "publisher": "Guardian"},
            {"url": "https://made-up.example.com/b", "publisher": "Fake"},
        ]
        result = validate_sources(sources, http=self._ok_client())
        assert len(result.ok_sources) == 1
        assert any(f["type"] == "source_not_in_whitelist" for f in result.flags)

    def test_drops_404_and_flags_it(self):
        def handler(req):
            if "/dead" in str(req.url):
                return httpx.Response(404)
            return httpx.Response(200)

        client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
        sources = [
            {"url": "https://theguardian.com/ok", "publisher": "Guardian"},
            {"url": "https://theguardian.com/dead", "publisher": "Guardian"},
        ]
        result = validate_sources(sources, http=client)
        assert len(result.ok_sources) == 1
        assert any(f["type"] == "source_unreachable" and "dead" in f["url"] for f in result.flags)

    def test_preserves_input_order(self):
        sources = [
            {"url": "https://abc.net.au/1", "publisher": "ABC"},
            {"url": "https://theguardian.com/2", "publisher": "Guardian"},
            {"url": "https://aihw.gov.au/3", "publisher": "AIHW"},
        ]
        result = validate_sources(sources, http=self._ok_client())
        assert [s["url"] for s in result.ok_sources] == [s["url"] for s in sources]

    def test_returns_validation_result_dataclass(self):
        sources = [{"url": "https://theguardian.com/a", "publisher": "Guardian"}]
        result = validate_sources(sources, http=self._ok_client())
        assert isinstance(result, ValidationResult)

    def test_empty_sources(self):
        result = validate_sources([], http=self._ok_client())
        assert result.ok_sources == []
        assert result.flags == []
        assert result.total_input == 0
        assert result.total_ok == 0

    def test_flag_contains_url_publisher_reason_for_unreachable(self):
        transport = httpx.MockTransport(lambda req: httpx.Response(404))
        client = httpx.Client(transport=transport, follow_redirects=True)
        sources = [{"url": "https://theguardian.com/dead", "publisher": "Guardian"}]
        result = validate_sources(sources, http=client)
        assert len(result.flags) == 1
        flag = result.flags[0]
        assert flag["type"] == "source_unreachable"
        assert flag["url"] == "https://theguardian.com/dead"
        assert flag["publisher"] == "Guardian"
        assert "reason" in flag

    def test_flag_contains_url_publisher_for_not_whitelisted(self):
        sources = [{"url": "https://fake.example.com/x", "publisher": "Fake"}]
        result = validate_sources(sources, http=self._ok_client())
        assert len(result.flags) == 1
        flag = result.flags[0]
        assert flag["type"] == "source_not_in_whitelist"
        assert flag["url"] == "https://fake.example.com/x"
        assert flag["publisher"] == "Fake"

    def test_sources_without_url_field_are_skipped_gracefully(self):
        """Sources missing 'url' should be treated as non-whitelisted and flagged."""
        sources = [{"publisher": "No URL here"}]
        # Should not raise
        result = validate_sources(sources, http=self._ok_client())
        # No url means it can't be whitelisted; should be dropped gracefully
        assert result.total_input == 1
        assert result.total_ok == 0
