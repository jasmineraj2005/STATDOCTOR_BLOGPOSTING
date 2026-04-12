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

from openai import OpenAI

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import OPENAI_API_KEY, FAST_MODEL
from models import AHPRAFlag

client = OpenAI(api_key=OPENAI_API_KEY)

# Regex patterns for hard-blocked terms (AHPRA s.133 advertising prohibited content)
_FORBIDDEN: list[tuple[str, str]] = [
    (r"\bbest doctor\b", "superlative claim — AHPRA s.133(1)(b) prohibits 'best'"),
    (r"\bnumber[\s-]?one\b", "superlative claim — AHPRA prohibits 'number one'"),
    (r"\b#\s?1\b", "superlative claim"),
    (r"\bleading specialist\b", "comparative superlative — AHPRA prohibited"),
    (r"\bmost experienced\b", "comparative superlative — AHPRA prohibited"),
    (r"\bworld[\s-]?class\b", "superlative — AHPRA prohibited"),
    (r"\baustralia'?s? (best|leading|top|premier)\b", "superlative claim — AHPRA prohibited"),
    (r"\bguaranteed? (results?|outcomes?|success)\b", "outcome guarantee — AHPRA prohibited"),
    (r"\bcure[sd]?\b", "cure claim — requires clinical evidence; flag for review"),
    (r"\btestimonial", "patient testimonial — restricted by AHPRA"),
    (r"\bendorsement from (a |my )?(patient|client)\b", "patient endorsement — restricted"),
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

_PAY_TRIGGERS = {"pay rate", "hourly rate", "daily rate", "annual salary", "earn", "income", "remuneration"}


def _has_pay_content(content: str) -> bool:
    lower = content.lower()
    return any(t in lower for t in _PAY_TRIGGERS)


def _inject_before_sources(content: str, text: str) -> str:
    """Insert text before ## Sources, or append at end."""
    if "## Sources" in content:
        return content.replace("## Sources", text + "\n## Sources", 1)
    return content + text


def check_ahpra(content: str) -> tuple[str, list[AHPRAFlag], bool]:
    """
    Run compliance checks.
    Returns (cleaned_content, flags, passed)
    passed=True means no human review required.
    """
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
            ))

    # ── 3. GPT deep-scan (catches nuanced issues regex misses) ────────────────
    prompt = f"""You are an AHPRA (Australian Health Practitioner Regulation Agency) advertising compliance reviewer.

Review this blog post excerpt for compliance with AHPRA's Guidelines for advertising regulated health services.

Key prohibited content:
1. Testimonials or endorsements from patients/clients (s.133(1)(a))
2. Comparative advertising implying superiority ("better than", "Australia's best")
3. Unsubstantiated claims (statistics or outcomes without evidence)
4. Guaranteed results or outcomes
5. Claims that could create unrealistic expectations
6. Superlatives about practitioners ("most experienced", "leading", "top")

Note: This is a MARKETPLACE blog post (not a clinical practice ad), so focus on:
- Marketing superlatives about StatDoctor or doctors on the platform
- Unverified statistics about pay rates, outcomes, or the healthcare system
- Any implied clinical outcome claims

POST EXCERPT (first 2500 chars):
{content[:2500]}

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
            flags.append(AHPRAFlag(
                flag_type=issue.get("flag_type", "unknown"),
                excerpt=issue.get("excerpt", ""),
                fix_applied=issue.get("fix_applied", ""),
                requires_human_review=issue.get("requires_human_review", True),
            ))

        if data.get("notes"):
            print(f"  [AHPRA] GPT assessment: {assessment} — {data['notes']}")

    except Exception as e:
        print(f"  [AHPRA] GPT scan error: {e}")

    needs_review = any(f.requires_human_review for f in flags)
    auto_fixes = [f for f in flags if not f.requires_human_review]
    manual_flags = [f for f in flags if f.requires_human_review]

    print(f"  [AHPRA] {len(auto_fixes)} auto-fixed | {len(manual_flags)} need review")
    passed = not needs_review
    return content, flags, passed
