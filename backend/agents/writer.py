"""
Agent 4: Writer
Produces a 1500–2500 word AEO-optimised blog post in Markdown.

Structure:
  # Title
  *reading time | pillar | date*
  ---
  **TL;DR:** direct answer (gets extracted as AI Overview)
  ---
  ## Question-format H2  (PAA match)
  ## ...
  ## What does this mean for locum doctors in [State]?
  ## Frequently Asked Questions
  [CTA]
  ## Sources

Two-pass approach (M2.T2):
  Pass 1 — Outline: produces H2 structure with per-section word targets
            summing to ≥ floor. Cheap, fast, forces structural commitment.
  Pass 2 — Draft: expands each section to its target count using the outline
            as a hard constraint. The model fills, not wanders.

Word floors (M2.T1) are loaded from validators.json (single source of truth).
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from openai import OpenAI

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agents.ahpra import AHPRA_PROHIBITED_CONTENT_BLOCK
from config import OPENAI_API_KEY, WRITER_MODEL, SITE_URL
from models import BlogPost, ContentPillar, ContentType, ResearchBrief

client = OpenAI(api_key=OPENAI_API_KEY)

_PILLAR_LABELS = {
    "locum_pay_rates": "Locum Pay & Rates",
    "how_to_locum": "Getting Started",
    "locum_by_location": "Locum by Location",
    "industry_news": "Industry News",
    "locum_vs_agency": "Marketplace vs Agency",
    "doctor_wellbeing": "Doctor Wellbeing",
    "company_pov": "Inside StatDoctor",
}

# ── validators.json loader ────────────────────────────────────────────────────
# Walk up from this file's directory to find extracted/lib/admin/validators.json
# The repo layout is:  <root>/backend/agents/writer.py
#                       <root>/extracted/lib/admin/validators.json
_VALIDATORS_JSON_PATH: str = str(
    Path(__file__).resolve().parent.parent.parent
    / "extracted" / "lib" / "admin" / "validators.json"
)

# Module-level cache — populated lazily so tests can monkeypatch the path.
_WORD_FLOORS: dict | None = None
_AHPRA_BANNED: list[dict] | None = None
_EDITORIALLY_BANNED: list[dict] | None = None


def _load_validators() -> dict:
    """Read validators.json fresh. Used by all lazy getters below."""
    import agents.writer as _self
    path = _self._VALIDATORS_JSON_PATH
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _get_word_floors() -> dict:
    """Return the word_floors mapping, loading from validators.json on first call.

    Tests may monkeypatch both ``_VALIDATORS_JSON_PATH`` and ``_WORD_FLOORS``
    to inject sentinel values without touching the real file.
    """
    global _WORD_FLOORS
    if _WORD_FLOORS is not None:
        return _WORD_FLOORS
    _WORD_FLOORS = _load_validators()["word_floors"]
    return _WORD_FLOORS


def _get_ahpra_banned() -> list[dict]:
    """Return the ahpra_banned list from validators.json (single source of truth, M3/B2).

    Each entry has the shape ``{"pattern": "<regex>", "reason": "<doc string>"}``.
    """
    global _AHPRA_BANNED
    if _AHPRA_BANNED is not None:
        return _AHPRA_BANNED
    _AHPRA_BANNED = _load_validators()["ahpra_banned"]
    return _AHPRA_BANNED


def _get_editorially_banned() -> list[dict]:
    """Return the editorially_banned list from validators.json (M3 closes drift with line 287)."""
    global _EDITORIALLY_BANNED
    if _EDITORIALLY_BANNED is not None:
        return _EDITORIALLY_BANNED
    _EDITORIALLY_BANNED = _load_validators()["editorially_banned"]
    return _EDITORIALLY_BANNED


def _pattern_to_human(pattern: str) -> str:
    """Best-effort regex → human-readable phrase for prompt display.

    The regex is the authoritative form (used by validators); the human phrase
    is for the LLM to internalise. Output keeps the meaning while stripping
    common regex tokens (\b word boundaries, character classes, anchor groups).
    """
    s = pattern
    s = re.sub(r"\\b", "", s)                          # word boundaries
    s = re.sub(r"\(\?:[^)]+\)", "", s)                 # non-capturing anchor groups, e.g. (?:^|[^\w])
    s = s.replace(r"[\s-]?", " ").replace(r"[\s-]", " ")
    s = s.replace(r"\s?", " ").replace(r"\s+", " ")
    # Capture-group alternations: (best|leading|top) → best/leading/top
    s = re.sub(r"\(([^)]+)\)", lambda m: m.group(1).replace("|", "/"), s)
    # Drop optional-quantifier markers on plain words: word? → word, word?s → word
    s = re.sub(r"(\w)\?", r"\1", s)
    s = s.replace("\\", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _render_banned_phrases_block() -> str:
    """Render ahpra_banned for the writer prompt — one bullet per pattern.

    Each line includes both the human-readable phrase AND the canonical regex,
    so the LLM has explicit guidance and any prompt-text drift test can still
    grep for the regex pattern from validators.json. Single source of truth.
    """
    lines: list[str] = []
    for entry in _get_ahpra_banned():
        pattern = entry["pattern"]
        human = _pattern_to_human(pattern)
        lines.append(f'  - "{human}" (regex: `{pattern}`)')
    return "\n".join(lines)


def _render_editorially_banned_block() -> str:
    """Render editorially_banned as a comma-separated quoted list."""
    return ", ".join(f'"{_pattern_to_human(e["pattern"])}"' for e in _get_editorially_banned())


def _derive_content_type(pillar: ContentPillar) -> ContentType:
    """Map pillar → content_type (mirrors pipeline._derive_content_type)."""
    if pillar == ContentPillar.NEWS:
        return ContentType.NEWS
    if pillar == ContentPillar.COMPANY:
        return ContentType.COMPANY
    return ContentType.GUIDE


# ── outline prompt ────────────────────────────────────────────────────────────


def _build_outline_prompt(
    *,
    title: str,
    pillar_label: str,
    suggested_h2s: list[str],
    suggested_faqs: list[str],
    floor: int,
    today: str,
) -> str:
    """Return the outline-pass prompt.

    The outline call is deliberately short and cheap — we only ask for an H2
    structure with per-section word targets that sum to >= floor.  The model
    commits to a structure *before* drafting, which prevents wandering short.
    """
    h2s_text = "\n".join(f"- {h}" for h in suggested_h2s)
    faqs_text = "\n".join(f"- {q}" for q in suggested_faqs)

    # How many sections we need depends on the floor:
    # floor ÷ 200 words/section ≈ minimum sections (cap at 9, floor at 5)
    min_sections = max(5, min(9, (floor // 200)))

    return f"""You are planning the structure of a blog post for StatDoctor ({SITE_URL}).

Title: {title}
Pillar: {pillar_label}
Date: {today}

Word floor for this content type: {floor} words.
Articles below this floor are rejected by the validator and re-queued.

Your task: produce an H2 outline only — no body text. Output {min_sections}–9 H2 section headings,
each followed by "(target: N words)" where N is your planned word count for that section.
The section targets must SUM TO AT LEAST {floor} words total.

Rules:
- Use the suggested H2 questions as a starting point; improve them if needed.
- Include a "What does this mean for locum doctors in [AU state]?" section.
- Include a "Frequently Asked Questions" section (target ≥ 350 words for ≥ 6 Q&As).
- Include a "Sources" section at the end (target: 80 words).
- Every H2 must be a question matching how doctors search Google.
- Output ONLY the H2 lines with their targets — no prose, no preamble.

Suggested H2 questions:
{h2s_text}

Suggested FAQ questions:
{faqs_text}

Output the outline now:"""


# ── draft prompt ──────────────────────────────────────────────────────────────


def _build_draft_prompt(
    *,
    title: str,
    pillar_label: str,
    today: str,
    floor: int,
    max_words: int,
    facts_text: str,
    stats_text: str,
    ahpra_context: str,
    sources_text: str,
    chart_instruction: str,
    inline_img_instruction: str,
    outline: str,
) -> str:
    """Return the full draft-pass prompt, embedding the outline as a hard constraint."""
    return f"""You are an expert medical content writer for StatDoctor ({SITE_URL}), Australia's locum doctor marketplace.

═══════════════════════════════════
AHPRA COMPLIANCE (coach-and-scan — non-negotiable)
═══════════════════════════════════
This article will be scanned post-generation by an AHPRA reviewer; passages
violating the rules below are rejected and re-queued. Follow the rules upfront
so the article ships first time.

{AHPRA_PROHIBITED_CONTENT_BLOCK}

═══════════════════════════════════

Write a complete, publication-ready blog post. You MUST write at least {floor} words — this is a hard
requirement, not a suggestion. Articles below {floor} words are rejected by the validator and re-queued
— do not produce drafts shorter than the floor. Target {max_words} words.

**Section-level minimums (non-negotiable):**
- Each body H2 section: ≥ 250 words and ≥ 3 paragraphs
- FAQ section: ≥ 6 Q&A pairs, each answer ≥ 60 words
- "What does this mean for locum doctors in [region]?" section: ≥ 300 words

Do not stop early. A short post is a failed post. If you find yourself at 1200 words, you are not
done — expand the weakest section before finishing.

═══════════════════════════════════
OUTLINE — follow this structure exactly
═══════════════════════════════════
The outline below was produced in a planning pass. Expand EACH section to at least its stated
target word count. Do not skip sections. Do not collapse sections together.

{outline}

═══════════════════════════════════
BRIEF
═══════════════════════════════════
Title: {title}
Pillar: {pillar_label}
Date: {today}

RESEARCH FACTS:
{facts_text}

KEY STATISTICS:
{stats_text}

AHPRA COMPLIANCE NOTES:
{ahpra_context}

SOURCES TO CITE:
{sources_text}

═══════════════════════════════════
FORMAT — follow exactly
═══════════════════════════════════

Line 1:   # [Title]
Line 2:   *[X] min read  |  {pillar_label}  |  {today}*
Line 3:   (blank)
Line 4:   ---
Line 5:   **TL;DR:** [2–3 sentence direct answer to the core question. This gets extracted as the AI Overview answer — make it precise and factual.]
Line 6:   ---
Line 7+:  Body

BODY RULES:
1. Use ## for H2 headings — every H2 must be a question matching how doctors search Google
2. First sentence of each section directly answers the H2 question
3. Support with detail, then cite a stat using inline markdown: [figure](source url)
4. Include a "## What does this mean for locum doctors in [most relevant AU state/region]?" section
5. FAQ section heading: ## Frequently Asked Questions
   Format each FAQ as: **Q: [question]** then newline then A: [answer]
   Use the suggested FAQ questions, improve if needed, add 1–2 of your own
6. CTA paragraph after FAQ: one paragraph, plain text, mentioning StatDoctor with a link [{SITE_URL}]({SITE_URL})
7. Final section: ## Sources — numbered list matching the sources provided

VISUAL RICHNESS — this is mandatory, not optional. The article MUST include the following callout boxes
in the body. A plain-text wall of paragraphs is unacceptable. Mix types for variety, spread them through
the article so every 2–3 H2 sections has a visual element:

REQUIRED CALLOUT QUOTAS:
- 1 × Key Facts box (placed immediately after the TL;DR, before the first H2)
- 1 × Big Stat block (anywhere in the body — the single most striking figure)
- 2 × Insight cards (lime tip cards, scattered through the article)
- 2 × Key Takeaway boxes (at the end of two of the most important sections)
- 1 × Pro Tip (practical advice from an editorial voice)
- 1 × Info / regulatory note (AHPRA, Medicare, or compliance fact)
- 1 × Case Study (only if a genuine real-world example exists; otherwise skip)
- Subtle emoji prefix on 4–5 H2 headings (📍 for location/state sections, 💰 for pay/rate sections,
  📋 for steps/processes, ⚖️ for legal/compliance sections, 🩺 for clinical sections,
  📈 for trend/data sections, 🤝 for marketplace/agency sections)

CALLOUT SYNTAX:

KEY FACTS box (grey card with bullet summary — placed right after TL;DR):
> [KEY FACTS]
> - **Average rate:** $1,850/day for emergency locum (capital cities)
> - **Lead time:** Most shifts booked 2–6 weeks in advance
> - **Top demand:** Rural NSW, regional QLD

BIG STAT block (bold navy card, use once for the single most striking figure):
> [STAT: $1,850/day] Average daily rate for metropolitan locum emergency physicians — AMA Locum Survey 2023

INSIGHT CARD (lime-tinted tip card):
> [INSIGHT: 💡 | Smart Tip | One specific, actionable sentence that helps a locum doctor]

KEY TAKEAWAY (lime summary box at end of an important section):
> [KEY TAKEAWAY] One sentence that encapsulates the core insight of this section.

PRO TIP (indigo callout box):
> [INFO] **Pro tip:** Always negotiate the indemnity coverage before accepting a remote shift — many
> regional hospitals assume locums carry their own.

INFO / regulatory note (indigo callout box):
> [INFO] AHPRA's Good Medical Practice code requires advertised credentials to be verifiable on the
> public register before commencing any locum shift.

CASE STUDY (white card with shadow):
> [CASE STUDY: Organisation or Hospital Name] Two to three sentences describing what happened.

{chart_instruction}

{inline_img_instruction}

CHECKLIST ITEMS — when listing benefits, features, or steps where each item has a title and explanation, use this format:
- **Title of benefit**: One sentence explaining the practical benefit for locum doctors.

WRITING RULES:
- Australian English spelling (organisation, licence, practise, recognise)
- Write for time-poor doctors — no filler, no padding
- Be specific: use real city names, real dollar figures, real regulatory references
- Include at least one markdown comparison table (e.g. tiers × daily rate, location × pay band, agency × fee). Guides without a table fail the validator.
- Forbidden phrases (AHPRA bans — these regexes must not match in your output):
{_render_banned_phrases_block()}
- If giving financial or clinical guidance, include: "This is general information only. Consult a qualified adviser."
- Cite sources inline with markdown links. Do not make up statistics.
- Editorially banned (do not use): {_render_editorially_banned_block()}

Write the complete post now. Output only the markdown — no preamble:"""


# ── public entry point ────────────────────────────────────────────────────────


def write_post(research: ResearchBrief) -> BlogPost:
    """Write the full blog post from research brief.

    Two-pass approach:
      1. Outline pass  — lightweight call that produces an H2 structure with
                          per-section word targets summing to >= floor.
      2. Draft pass    — full call that expands each section to its target.

    Preserves the public signature ``write_post(research: ResearchBrief) -> BlogPost``
    so the pipeline and all callers remain unchanged.
    """
    topic = research.topic
    print(f"[Writer] Writing: {topic.title}")

    # Derive content_type from pillar (same logic as pipeline._derive_content_type)
    content_type = _derive_content_type(topic.pillar)
    word_floors = _get_word_floors()
    floor = word_floors.get(content_type.value, 1500)
    # Max is floor * 1.67 (approx), capped at 2500 for readability
    max_words = min(2500, max(floor + 500, int(floor * 1.5)))

    today = datetime.utcnow().strftime("%B %Y")
    pillar_label = _PILLAR_LABELS.get(topic.pillar.value, topic.pillar.value)

    sources_text = "\n".join(
        f"{i + 1}. [{s.title}]({s.url}) — {s.publisher}"
        for i, s in enumerate(research.sources)
    )
    facts_text = "\n".join(f"- {f}" for f in research.key_facts)
    stats_text = "\n".join(f"- {s}" for s in research.statistics)

    chart_instruction = ""
    if research.chart_url:
        chart_instruction = f"""
INLINE CHART — embed exactly once, after the second H2 section. Use this ready-made URL:
![Key statistics for {topic.title}]({research.chart_url})
"""
    else:
        chart_instruction = "INLINE CHART — no chart URL available for this article. Skip the chart."

    # Inline image instructions (3 total: hero handled separately, 2 inline placements)
    inline_img_instruction = ""
    if research.inline_images:
        img_lines = []
        for idx, url in enumerate(research.inline_images[:2]):
            position = "after the 3rd H2 section" if idx == 0 else "after the 5th H2 section"
            img_lines.append(
                f'![Locum doctors at work in Australia]({url})  ← embed {position}'
            )
        inline_img_instruction = (
            "INLINE IMAGES — you MUST embed these two images at the positions noted. "
            "Use the exact markdown image syntax shown:\n" + "\n".join(img_lines)
        )
    else:
        inline_img_instruction = "INLINE IMAGES — none provided. Skip inline images."

    # ── Pass 1: Outline ───────────────────────────────────────────────────────
    outline_prompt = _build_outline_prompt(
        title=topic.title,
        pillar_label=pillar_label,
        suggested_h2s=topic.suggested_h2s,
        suggested_faqs=topic.suggested_faqs,
        floor=floor,
        today=today,
    )

    outline_response = client.chat.completions.create(
        model=WRITER_MODEL,
        messages=[{"role": "user", "content": outline_prompt}],
        temperature=0.4,
        max_tokens=800,
    )
    outline = outline_response.choices[0].message.content.strip()
    print(f"  [Writer] Outline produced ({len(outline.splitlines())} lines, floor={floor})")

    # ── Pass 2: Draft ─────────────────────────────────────────────────────────
    draft_prompt = _build_draft_prompt(
        title=topic.title,
        pillar_label=pillar_label,
        today=today,
        floor=floor,
        max_words=max_words,
        facts_text=facts_text,
        stats_text=stats_text,
        ahpra_context=research.ahpra_context,
        sources_text=sources_text,
        chart_instruction=chart_instruction,
        inline_img_instruction=inline_img_instruction,
        outline=outline,
    )

    response = client.chat.completions.create(
        model=WRITER_MODEL,
        messages=[{"role": "user", "content": draft_prompt}],
        temperature=0.65,
        max_tokens=6000,
    )

    content = response.choices[0].message.content.strip()
    word_count = len(content.split())
    print(f"  [Writer] First draft — {word_count} words (floor: {floor})")

    # ── One-shot expansion retry if the first draft fell short ────────────────
    # Bounded to avoid runaway cost. Continues the conversation so the model
    # expands rather than rewrites from scratch.
    if word_count < floor:
        shortfall = floor - word_count
        expand_prompt = (
            f"Your draft is {word_count} words but the floor is {floor}. "
            f"You are short by {shortfall} words. Expand the body — DO NOT "
            f"shorten or rewrite anything you already wrote. Pick the 2 weakest "
            f"H2 sections (the ones with fewest paragraphs or thinnest detail) "
            f"and add 2-3 paragraphs each with specific examples, dollar "
            f"figures, and inline citations. Keep the same H2 headings; just "
            f"deepen the content under them. Output the full expanded post."
        )
        response = client.chat.completions.create(
            model=WRITER_MODEL,
            messages=[
                {"role": "user", "content": draft_prompt},
                {"role": "assistant", "content": content},
                {"role": "user", "content": expand_prompt},
            ],
            temperature=0.65,
            max_tokens=6000,
        )
        content = response.choices[0].message.content.strip()
        word_count = len(content.split())
        print(f"  [Writer] After expansion — {word_count} words")

    # Extract TL;DR for the model field
    tldr = ""
    if "**TL;DR:**" in content:
        start = content.index("**TL;DR:**") + len("**TL;DR:**")
        # TL;DR runs until the next blank line or ---
        end = len(content)
        for delimiter in ["\n\n", "\n---"]:
            pos = content.find(delimiter, start)
            if pos != -1 and pos < end:
                end = pos
        tldr = content[start:end].strip()

    post = BlogPost(
        title=topic.title,
        content_markdown=content,
        tldr=tldr,
        word_count=word_count,
    )

    print(f"  [Writer] Done — {word_count} words")
    return post


# ── rejection-reason retry ────────────────────────────────────────────────────

# Human-readable labels for each rejection code (mirrors TS REJECTION_LABELS).
_REJECTION_LABELS: dict[str, str] = {
    "off_brand_voice": "Off-brand voice",
    "weak_sources": "Weak sources / not enough .gov.au",
    "wrong_angle": "Wrong angle / not what we'd say",
    "too_promotional": "Too promotional / breaks honest-marketplace rule",
    "ahpra_disagree": "AHPRA flag I disagree with",
    "topic_uninteresting": "Topic isn't interesting",
    "other": "Other",
}


def regenerate(
    slug: str,
    rejection_reason: str,
    original_content: str,
    extra_instruction: str | None = None,
) -> str:
    """Regenerate a rejected draft, addressing the specific rejection reason.

    Parameters
    ----------
    slug:
        The article slug (used for logging / identification only).
    rejection_reason:
        The rejection_code string (e.g. "off_brand_voice") OR a human-readable
        description of why the draft was rejected.
    original_content:
        The Markdown content of the rejected draft.
    extra_instruction:
        Optional surgical fix directive assembled by heal_agent.build_instruction.
        When present (heal flow, M2/B1) it is appended to the prompt so the LLM
        targets the specific failing validator (banned-phrase removal, word-count
        expansion, etc.) instead of a generic "rejected" rewrite.

    Returns
    -------
    str
        The new Markdown draft content with the rejection issue addressed.
    """
    # Resolve human label if a known code was passed
    human_label = _REJECTION_LABELS.get(rejection_reason, rejection_reason)

    surgical_block = (
        f"\nSPECIFIC FIX REQUIRED:\n{extra_instruction}\n"
        if extra_instruction
        else ""
    )

    prompt = (
        f"Your previous draft was rejected because [{rejection_reason}]: {human_label}. "
        f"Rewrite addressing this specifically.\n\n"
        f"Original draft:\n\n{original_content}\n"
        f"{surgical_block}\n"
        f"Instructions:\n"
        f"- Fix the issue described above throughout the entire article.\n"
        f"- Do not change the structure, headings, or factual claims unless they are the root cause.\n"
        f"- Preserve word count (do not shorten the article) unless the SPECIFIC FIX above asks for expansion.\n"
        f"- Output only the corrected Markdown — no preamble."
    )

    print(f"  [Writer] Regenerating '{slug}' — rejection_reason={rejection_reason!r}")
    response = client.chat.completions.create(
        model=WRITER_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5,
        max_tokens=6000,
    )
    new_content = response.choices[0].message.content.strip()
    print(f"  [Writer] Regenerated '{slug}' — {len(new_content.split())} words")
    return new_content
