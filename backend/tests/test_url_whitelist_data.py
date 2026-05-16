import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WHITELIST = ROOT / "data" / "url-whitelist.json"


def test_whitelist_file_exists():
    assert WHITELIST.exists(), f"Whitelist file missing at {WHITELIST}"


def test_whitelist_is_valid_json():
    json.loads(WHITELIST.read_text())


def test_whitelist_has_required_top_level_keys():
    data = json.loads(WHITELIST.read_text())
    assert {"version", "domains", "updated_at"}.issubset(data.keys())


def test_each_domain_has_required_fields():
    data = json.loads(WHITELIST.read_text())
    for d in data["domains"]:
        assert {"domain", "tier", "rationale", "added_at"}.issubset(d.keys()), d


def test_all_tiers_are_in_closed_enum():
    valid = {"gov-au", "gov-nz", "peer-reviewed", "mainstream-news", "mainstream-aus", "professional-body"}
    data = json.loads(WHITELIST.read_text())
    for d in data["domains"]:
        assert d["tier"] in valid, f"unknown tier on {d['domain']}: {d['tier']}"


def test_no_duplicate_domains():
    data = json.loads(WHITELIST.read_text())
    domains = [d["domain"] for d in data["domains"]]
    assert len(domains) == len(set(domains)), "duplicate domain in whitelist"


def test_minimum_set_present():
    data = json.loads(WHITELIST.read_text())
    domains = {d["domain"] for d in data["domains"]}
    required = {"theguardian.com", "ahpra.gov.au", "aihw.gov.au", "racgp.org.au", "ncbi.nlm.nih.gov"}
    missing = required - domains
    assert not missing, f"required whitelist entries missing: {missing}"
