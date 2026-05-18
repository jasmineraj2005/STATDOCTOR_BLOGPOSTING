"""
Agent 6: AHPRA Compliance
Scans every generated post before publish for:
1. Forbidden advertising claims (AHPRA Guidelines for advertising regulated health services)
2. Missing required disclaimers
3. Unsupported statistics or clinical claims

Auto-fixes minor issues; flags critical issues for human review.
Reference: AHPRA Advertising Guidelines (current version)
https://www.ahpra.gov.au/Resources/Advertising-hub/Advertising-guidelines-and-other-resources.aspx
"""

import json
import re
import sys
import os
from pathlib import Path

from openai import OpenAI

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import OPENAI_API_KEY, FAST_MODEL
from models import AHPRAFlag, Source

client = OpenAI(api_key=OPENAI_API_KEY)

# M5 / Bug B3: scan the WHOLE article, not the first 2,500 chars.
# Default on; flip AHPRA_CHUNKED_SCAN=off as a kill switch if costs spike.
AHPRA_CHUNKED_SCAN = os.environ.get("AHPRA_CHUNKED_SCAN", "on").strip().lower() == "on"
AHPRA_CHUNK_SIZE = 2500
AHPRA_CHUNK_OVERLAP = 200
# M5 / Bug B4: if a source URL sits within this window of an unsupported_stat
# excerpt in the markdown, auto-resolve the flag (the citation is right there).
SOURCE_PROXIMITY_WINDOW = 200

# Single source of truth for all editorial validators — shared with the TS
# dashboard at extracted/lib/admin/validators.json. The TS side imports it
# directly; we load it via a stable relative path.
_VALIDATORS_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "extracted"
    / "lib"
    / "admin"
    / "validators.json"
)
with open(_VALIDATORS_PATH) as _f:
    _VALIDATORS = json.load(_f)

# Regex patterns for hard-blocked terms (AHPRA s.133 advertising prohibited content).
_FORBIDDEN: list[tuple[str, str]] = [
    (entry["pattern"], entry["reason"]) for entry in _VALIDATORS["ahpra_banned"]
]

_GENERAL_DISCLAIMER = (
    "\n\n> **Disclaimer:** This content is for general information purposes only "
    "and does not constitute medical, legal, or financial advice. "
    "Always consult a qualified professional for advice specific to your situation.\n"
)

_PAY_DISCLAIMER = (
    "\n\n> **Note on pay rates:** Figures mentioned are indicative only and vary "
    "by location, specialty, employer, and individual enterprise agreement.\n"
)

_PAY_TRIGGERS = set(_VALIDATORS["pay_disclaimer_triggers"])

# M15: AHPRA prohibited-content block — single source of truth for both the
# AHPRA scanner prompt (post-generation safety net) AND the writer prompt
# (pre-generation deterrent). Coach-and-scan: the writer learns the rules
# upfront so violations are deterred at generation cost; AHPRA still scans
# afterwards as a second line of defence.
# M16: severity classifier — single source of truth for how AHPRA flags map
# onto the admin validator gate. Tests live in test_ahpra_severity.py.
def _severity_for(flag_type: str, requires_review: bool) -> str:
    """Return severity (info | warn | error) for a flag.

    Auto-fixed flags (``requires_review=False``) are always ``info`` — they're
    surfaced for visibility but don't block the queue. For manual-review flags:

    - ``forbidden_claim`` → ``error``. Hard AHPRA prohibition (regex hit on
      ``ahpra_banned`` or LLM-detected superlative). Blocks ACCEPT.
    - ``unsupported_stat`` → ``warn``. Quality concern: stat lacks an inline
      cite but the article body cites elsewhere. Surfaced yellow; CEO decides.
    - ``missing_disclaimer`` → ``warn``. The auto-inject path didn't fire;
      the gap is editorial-fixable rather than a compliance violation.
    - Unknown / future flag types → ``error``. Fail-safe: if we don't know
      what it is, we don't let it through.
    """
    if not requires_review:
        return "info"
    if flag_type == "forbidden_claim":
        return "error"
    if flag_type in ("unsupported_stat", "missing_disclaimer"):
        return "warn"
    return "error"


AHPRA_PROHIBITED_CONTENT_BLOCK = """Key prohibited content:
1. Testimonials or endorsements from patients/clients (s.133(1)(a))
2. Comparative advertising implying superiority ("better than", "Australia's best")
3. Unsubstantiated claims (statistics or outcomes without evidence)
4. Guaranteed results or outcomes
5. Claims that could create unrealistic expectations
6. Superlatives about practitioners ("most experienced", "leading", "top")

Note: This is a MARKETPLACE blog post (not a clinical practice ad), so focus on:
- Marketing superlatives about StatDoctor or doctors on the platform
- Unverified statistics about pay rates, outcomes, or the healthcare system
- Any implied clinical outcome claims"""


def _has_pay_content(content: str) -> bool:
    lower = content.lower()
    return any(t in lower for t in _PAY_TRIGGERS)


def _inject_before_sources(content: str, text: str) -> str:
    """Insert text before ## Sources, or append at end."""
    if "## Sources" in content:
        return content.replace("## Sources", text + "\n## Sources", 1)
    return content + text


def _iter_chunks(content: str) -> list[tuple[int, int, str]]:
    """Yield (start, end, chunk_text) tuples for GPT scanning.

    When ``AHPRA_CHUNKED_SCAN`` is off, returns a single window matching the
    legacy behaviour (first 2,500 chars). When on, slides a window with
    ``AHPRA_CHUNK_OVERLAP`` overlap so a phrase straddling the boundary is
    still seen by at least one chunk.
    """
    if not AHPRA_CHUNKED_SCAN:
        return [(0, min(len(content), AHPRA_CHUNK_SIZE), content[:AHPRA_CHUNK_SIZE])]
    chunks: list[tuple[int, int, str]] = []
    start = 0
    n = len(content)
    if n == 0:
        return chunks
    step = AHPRA_CHUNK_SIZE - AHPRA_CHUNK_OVERLAP
    if step <= 0:
        step = AHPRA_CHUNK_SIZE
    while start < n:
        end = min(n, start + AHPRA_CHUNK_SIZE)
        chunks.append((start, end, content[start:end]))
        if end >= n:
            break
        start += step
    return chunks


def _has_source_near_excerpt(
    content: str, excerpt: str, source_urls: list[str], window: int = SOURCE_PROXIMITY_WINDOW
) -> str | None:
    """Return the first source URL appearing within ±window chars of excerpt.

    Returns None if no source URL is near the excerpt. Empty excerpts return None.
    The match is substring-based; both the excerpt and URL are compared
    case-insensitively for robustness against minor formatting differences.
    """
    if not excerpt or not source_urls:
        return None
    needle = excerpt.lower()
    haystack = content.lower()
    idx = haystack.find(needle[:120])  # cap needle to avoid pathological substrings
    if idx == -1:
        return None
    win_start = max(0, idx - window)
    win_end = min(len(content), idx + len(needle) + window)
    window_text = haystack[win_start:win_end]
    for url in source_urls:
        if not url:
            continue
        if url.lower() in window_text:
            return url
    return None


def check_ahpra(
    content: str,
    sources: list[Source] | None = None,
) -> tuple[str, list[AHPRAFlag], bool]:
    """
    Run compliance checks.
    Returns (cleaned_content, flags, passed)
    passed=True means no human review required.

    M5 / Bug B3: GPT scan covers the entire article via chunks with overlap.
    M5 / Bug B4: ``unsupported_stat`` flags are auto-resolved when a source URL
    from ``sources`` appears within ±200 chars of the flagged excerpt in the
    markdown.
    """
    sources = sources or []
    print("[AHPRA] Running compliance check...")
    flags: list[AHPRAFlag] = []

    # ── 1. Regex scan for hard-blocked terms ──────────────────────────────────
    for pattern, reason in _FORBIDDEN:
        for match in re.finditer(pattern, content, re.IGNORECASE):
            ctx_start = max(0, match.start() - 40)
            ctx_end = min(len(content), match.end() + 40)
            excerpt = content[ctx_start:ctx_end].strip()
            flags.append(AHPRAFlag(
                flag_type="forbidden_claim",
                excerpt=excerpt,
                fix_applied=f"Flagged '{match.group()}': {reason}. Remove or rephrase before publish.",
                requires_human_review=True,
                severity=_severity_for("forbidden_claim", True),
            ))

    # ── 2. Auto-inject missing disclaimers ────────────────────────────────────
    has_general_disclaimer = (
        "general information" in content.lower()
        and "does not constitute" in content.lower()
    )
    if not has_general_disclaimer:
        content = _inject_before_sources(content, _GENERAL_DISCLAIMER)
        flags.append(AHPRAFlag(
            flag_type="missing_disclaimer",
            excerpt="(general information disclaimer absent)",
            fix_applied="Auto-injected general information disclaimer.",
            requires_human_review=False,
            severity=_severity_for("missing_disclaimer", False),
        ))

    if _has_pay_content(content):
        has_pay_disclaimer = "indicative" in content.lower()
        if not has_pay_disclaimer:
            content = _inject_before_sources(content, _PAY_DISCLAIMER)
            flags.append(AHPRAFlag(
                flag_type="missing_disclaimer",
                excerpt="(pay rate content detected without disclaimer)",
                fix_applied="Auto-injected pay rates indicative disclaimer.",
                requires_human_review=False,
                severity=_severity_for("missing_disclaimer", False),
            ))

    # ── 3. GPT deep-scan (catches nuanced issues regex misses) ────────────────
    # M5 / Bug B3: iterate the whole article in overlapping chunks. With chunking
    # disabled (kill switch), this reduces to the legacy single-window behaviour.
    chunks = _iter_chunks(content)
    seen_excerpts: set[str] = set()
    for chunk_idx, (chunk_start, chunk_end, chunk_text) in enumerate(chunks):
        prompt = f"""You are an AHPRA (Australian Health Practitioner Regulation Agency) advertising compliance reviewer.

Review this blog post excerpt for compliance with AHPRA's Guidelines for advertising regulated health services.

{AHPRA_PROHIBITED_CONTENT_BLOCK}

POST EXCERPT (chunk {chunk_idx + 1} of {len(chunks)}, chars {chunk_start}-{chunk_end} of {len(content)}):
{chunk_text}

Return JSON only:
{{
  "issues": [
    {{
      "flag_type": "forbidden_claim | missing_disclaimer | unsupported_stat",
      "excerpt": "the specific problematic text (keep short)",
      "fix_applied": "how to fix it",
      "requires_human_review": true
    }}
  ],
  "assessment": "PASS | REVIEW | FAIL",
  "notes": "one-line summary"
}}

If nothing found: {{"issues": [], "assessment": "PASS", "notes": "No issues found."}}"""

        try:
            response = client.chat.completions.create(
                model=FAST_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            data = json.loads(response.choices[0].message.content)
            assessment = data.get("assessment", "PASS")

            for issue in data.get("issues", []):
                excerpt = issue.get("excerpt", "")
                # Dedup across chunks — the overlap window can surface the same
                # excerpt twice if it straddles a boundary.
                if excerpt and excerpt in seen_excerpts:
                    continue
                if excerpt:
                    seen_excerpts.add(excerpt)
                ftype = issue.get("flag_type", "unknown")
                needs_review = issue.get("requires_human_review", True)
                flags.append(AHPRAFlag(
                    flag_type=ftype,
                    excerpt=excerpt,
                    fix_applied=issue.get("fix_applied", ""),
                    requires_human_review=needs_review,
                    severity=_severity_for(ftype, needs_review),
                ))

            if data.get("notes"):
                print(
                    f"  [AHPRA] GPT chunk {chunk_idx + 1}/{len(chunks)} "
                    f"assessment: {assessment} — {data['notes']}"
                )

        except Exception as e:
            print(f"  [AHPRA] GPT scan error (chunk {chunk_idx + 1}/{len(chunks)}): {e}")

    # ── 4. Auto-resolve unsupported_stat when a source is right next to it ────
    # M5 / Bug B4: the AHPRA model defaults to requires_human_review=True for
    # every issue. If a source URL sits within ±200 chars of an unsupported_stat
    # excerpt in the markdown, the citation is already there — flip the flag.
    source_urls = [s.url for s in sources if s and s.url]
    for flag in flags:
        if flag.flag_type != "unsupported_stat" or not flag.requires_human_review:
            continue
        nearby = _has_source_near_excerpt(content, flag.excerpt, source_urls)
        if nearby:
            flag.requires_human_review = False
            flag.severity = _severity_for(flag.flag_type, False)  # M16: downgrade to info
            flag.fix_applied = (
                f"Auto-cited from sources (URL {nearby} appears within "
                f"±{SOURCE_PROXIMITY_WINDOW} chars in the markdown)."
            )

    needs_review = any(f.requires_human_review for f in flags)
    auto_fixes = [f for f in flags if not f.requires_human_review]
    manual_flags = [f for f in flags if f.requires_human_review]

    print(f"  [AHPRA] {len(auto_fixes)} auto-fixed | {len(manual_flags)} need review")
    passed = not needs_review
    return content, flags, passed
