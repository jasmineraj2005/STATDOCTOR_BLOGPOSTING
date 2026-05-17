"""Test the image-source fallback chain: OG-scrape → Wikimedia Commons.

We don't hit the real network — we mock httpx.get and assert the function
selects + filters correctly.
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

from agents.researcher import _fetch_wikimedia_image, _is_blocked_image_url


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


def _wikimedia_response(license_short: str, mime: str = "image/jpeg", artist: str = "Jane Doe"):
    return {
        "query": {
            "pages": {
                "123": {
                    "imageinfo": [
                        {
                            "url": "https://upload.wikimedia.org/example.jpg",
                            "mime": mime,
                            "extmetadata": {
                                "LicenseShortName": {"value": license_short},
                                "Artist": {"value": f"<a href='x'>{artist}</a>"},
                                "ImageDescription": {"value": "An x-ray of a hand"},
                            },
                        }
                    ]
                }
            }
        }
    }


class TestFetchWikimediaImage:
    def test_given_empty_query_when_called_then_returns_none(self):
        assert _fetch_wikimedia_image("") == (None, None, None)

    def test_given_cc_by_license_when_called_then_returns_image_artist_alt(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = _wikimedia_response("CC BY 4.0")
        with patch("agents.researcher.httpx.get", return_value=mock_response):
            url, artist, alt = _fetch_wikimedia_image("x-ray hand")
        assert url == "https://upload.wikimedia.org/example.jpg"
        assert artist == "Jane Doe"
        assert "x-ray of a hand" in alt

    def test_given_restricted_license_when_called_then_returns_none(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = _wikimedia_response("Fair use")
        with patch("agents.researcher.httpx.get", return_value=mock_response):
            assert _fetch_wikimedia_image("anything") == (None, None, None)

    def test_given_svg_mime_when_called_then_returns_none(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = _wikimedia_response("CC0", mime="image/svg+xml")
        with patch("agents.researcher.httpx.get", return_value=mock_response):
            assert _fetch_wikimedia_image("anything") == (None, None, None)

    def test_given_network_error_when_called_then_returns_none_silently(self):
        with patch("agents.researcher.httpx.get", side_effect=Exception("network down")):
            assert _fetch_wikimedia_image("anything") == (None, None, None)

    def test_given_pd_license_when_called_then_returns_image(self):
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = _wikimedia_response("Public Domain")
        with patch("agents.researcher.httpx.get", return_value=mock_response):
            url, _, _ = _fetch_wikimedia_image("x")
        assert url == "https://upload.wikimedia.org/example.jpg"
