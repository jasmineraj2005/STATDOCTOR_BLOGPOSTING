"""
StatDoctor Blog Automation Pipeline — Orchestrator

Flow:
  Agent 1 (Intelligence) → topic selection
  Agent 3 (Researcher)   → facts, sources, image
  Agent 4 (Writer)       → 1500–2500 word AEO post
  Agent 5 (SEO)          → meta tags, schemas, slug
  Agent 6 (AHPRA)        → compliance check + auto-fix

Output: JSON + Markdown files in backend/output/
"""

import json
from datetime import datetime

from config import OUTPUT_DIR
from models import FinalPost
from agents.intelligence import select_topic
from agents.researcher import research_topic
from agents.writer import write_post
from agents.seo import generate_seo
from agents.ahpra import check_ahpra


def run_pipeline() -> FinalPost:
    """Run the full pipeline end-to-end. Returns the assembled FinalPost."""
    _header()

    # Agent 1: Intelligence — pick the topic
    topic = select_topic()

    # Agent 3: Researcher — gather facts, sources, image
    research = research_topic(topic)

    # Agent 4: Writer — write the post
    post = write_post(research)

    # Agent 5: SEO — metadata + JSON-LD schemas
    seo = generate_seo(post, topic)

    # Agent 6: AHPRA — compliance check, auto-fix, flag issues
    cleaned_content, ahpra_flags, ahpra_passed = check_ahpra(post.content_markdown)

    # Assemble
    final = FinalPost(
        title=post.title,
        slug=seo.slug,
        meta_title=seo.meta_title,
        meta_description=seo.meta_description,
        focus_keyword=seo.focus_keyword,
        og_image_alt=seo.og_image_alt,
        content_markdown=cleaned_content,
        tldr=post.tldr,
        pillar=topic.pillar,
        target_keywords=topic.target_keywords,
        word_count=len(cleaned_content.split()),
        reading_time_minutes=seo.reading_time_minutes,
        sources=research.sources,
        image_url=research.image_url,
        image_credit=research.image_credit,
        faq_json_ld=seo.faq_json_ld,
        medical_webpage_schema=seo.medical_webpage_schema,
        ahpra_flags=ahpra_flags,
        ahpra_passed=ahpra_passed,
    )

    _save_outputs(final)
    _summary(final)
    return final


def _save_outputs(post: FinalPost) -> None:
    """Write JSON and Markdown files to output/."""
    ts = post.generated_at.strftime("%Y%m%d_%H%M%S")
    safe_slug = post.slug[:50]

    # ── JSON — full post data ─────────────────────────────────────────────────
    json_path = OUTPUT_DIR / f"{ts}_{safe_slug}.json"
    with open(json_path, "w") as f:
        json.dump(post.model_dump(mode="json"), f, indent=2, default=str)

    # ── Markdown — blog content with YAML frontmatter ─────────────────────────
    md_path = OUTPUT_DIR / f"{ts}_{safe_slug}.md"

    # Escape quotes in frontmatter values
    def _esc(s: str) -> str:
        return s.replace('"', '\\"')

    ahpra_status = "passed" if post.ahpra_passed else "needs_review"
    flags_summary = (
        ", ".join(f.flag_type for f in post.ahpra_flags) if post.ahpra_flags else "none"
    )

    frontmatter = f"""---
title: "{_esc(post.title)}"
slug: "{post.slug}"
meta_title: "{_esc(post.meta_title)}"
meta_description: "{_esc(post.meta_description)}"
focus_keyword: "{_esc(post.focus_keyword)}"
pillar: "{post.pillar.value}"
reading_time_minutes: {post.reading_time_minutes}
word_count: {post.word_count}
ahpra_status: "{ahpra_status}"
ahpra_flags: "{flags_summary}"
image_url: "{post.image_url or ''}"
image_credit: "{_esc(post.image_credit or '')}"
generated_at: "{post.generated_at.isoformat()}"
---

"""
    with open(md_path, "w") as f:
        f.write(frontmatter + post.content_markdown)

    print(f"\n  Saved → {json_path.name}")
    print(f"  Saved → {md_path.name}")


def _header() -> None:
    print("\n" + "═" * 62)
    print(f"  StatDoctor Blog Pipeline  —  {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print("═" * 62 + "\n")


def _summary(post: FinalPost) -> None:
    ahpra_line = "✓ PASSED" if post.ahpra_passed else "⚠  NEEDS REVIEW"
    sources_count = len(post.sources)

    print("\n" + "═" * 62)
    print("  PIPELINE COMPLETE")
    print("═" * 62)
    print(f"  Title          {post.title}")
    print(f"  URL            /blog/{post.slug}")
    print(f"  Pillar         {post.pillar.value}")
    print(f"  Keywords       {', '.join(post.target_keywords)}")
    print(f"  Words          {post.word_count}")
    print(f"  Reading time   {post.reading_time_minutes} min")
    print(f"  Sources        {sources_count}")
    print(f"  Image          {post.image_url or 'none'}")
    print(f"  AHPRA          {ahpra_line}")
    if post.ahpra_flags:
        for f in post.ahpra_flags:
            marker = "  ⚠ " if f.requires_human_review else "  ✓ "
            print(f"{marker}[{f.flag_type}] {f.fix_applied[:70]}")
    print("═" * 62 + "\n")
