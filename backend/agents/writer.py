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
"""

import sys
import os
from datetime import datetime

from openai import OpenAI

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import OPENAI_API_KEY, WRITER_MODEL, MIN_WORDS, MAX_WORDS, SITE_URL
from models import BlogPost, ResearchBrief

client = OpenAI(api_key=OPENAI_API_KEY)

_PILLAR_LABELS = {
    "locum_pay_rates": "Locum Pay & Rates",
    "how_to_locum": "Getting Started",
    "locum_by_location": "Locum by Location",
    "industry_news": "Industry News",
    "locum_vs_agency": "Marketplace vs Agency",
    "doctor_wellbeing": "Doctor Wellbeing",
}


def write_post(research: ResearchBrief) -> BlogPost:
    """Write the full blog post from research brief."""
    topic = research.topic
    print(f"[Writer] Writing: {topic.title}")

    today = datetime.utcnow().strftime("%B %Y")
    pillar_label = _PILLAR_LABELS.get(topic.pillar.value, topic.pillar.value)

    sources_text = "\n".join(
        f"{i + 1}. [{s.title}]({s.url}) — {s.publisher}"
        for i, s in enumerate(research.sources)
    )
    facts_text = "\n".join(f"- {f}" for f in research.key_facts)
    stats_text = "\n".join(f"- {s}" for s in research.statistics)
    h2s_text = "\n".join(f"- {h}" for h in topic.suggested_h2s)
    faqs_text = "\n".join(f"- {q}" for q in topic.suggested_faqs)

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

    prompt = f"""You are an expert medical content writer for StatDoctor ({SITE_URL}), Australia's locum doctor marketplace.

Write a complete, publication-ready blog post. You MUST write at least {MIN_WORDS} words — this is a hard requirement, not a suggestion. Target {MAX_WORDS} words. Each H2 section must have at least 3 paragraphs. The FAQ section must have at least 6 Q&A pairs. Do not stop early — a short post is a failed post.

═══════════════════════════════════
BRIEF
═══════════════════════════════════
Title: {topic.title}
Primary keywords: {", ".join(topic.target_keywords)}
Secondary keywords: {", ".join(topic.secondary_keywords)}
Pillar: {pillar_label}
News hook: {topic.news_hook or "N/A"}
Date: {today}

RESEARCH FACTS:
{facts_text}

KEY STATISTICS:
{stats_text}

AHPRA COMPLIANCE NOTES:
{research.ahpra_context}

SUGGESTED H2 QUESTIONS (improve if needed):
{h2s_text}

SUGGESTED FAQ QUESTIONS:
{faqs_text}

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
- Forbidden words (AHPRA bans): "best doctor", "number one", "#1", "guaranteed", "cure", "leading specialist", "most experienced", "world-class"
- If giving financial or clinical guidance, include: "This is general information only. Consult a qualified adviser."
- Cite sources inline with markdown links. Do not make up statistics.
- Do not use the word "comprehensive" or "delve"

Write the complete post now. Output only the markdown — no preamble:"""

    response = client.chat.completions.create(
        model=WRITER_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.65,
        max_tokens=6000,
    )

    content = response.choices[0].message.content.strip()
    word_count = len(content.split())

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
