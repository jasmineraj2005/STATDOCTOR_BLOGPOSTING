"""Test the image-source fallback: OG-scrape only (Wikimedia removed 2026-05-18).

We don't hit the real network — we mock httpx.get and assert the function
filters blocked sources correctly.
"""
from __future__ import annotations

from agents.researcher import _is_blocked_image_url


class TestIsBlockedImageUrl:
    def test_given_unsplash_url_when_checked_then_blocked(self):
        assert _is_blocked_image_url("https://images.unsplash.com/photo-x") is True

    def test_given_quickchart_url_when_checked_then_blocked(self):
        assert _is_blocked_image_url("https://quickchart.io/chart?c=x") is True

    def test_given_svg_url_when_checked_then_blocked(self):
        assert _is_blocked_image_url("https://example.com/img.svg") is True

    def test_given_empty_url_when_checked_then_blocked(self):
        assert _is_blocked_image_url("") is True

    def test_given_guardian_thumbnail_when_checked_then_allowed(self):
        assert _is_blocked_image_url("https://i.guim.co.uk/img.jpg") is False
