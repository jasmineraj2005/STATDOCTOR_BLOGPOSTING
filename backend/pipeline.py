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
from models import ContentPillar, ContentType, FinalPost
from agents.intelligence import select_topic
from agents.researcher import research_topic
from agents.writer import write_post
from agents.seo import generate_seo
from agents.ahpra import check_ahpra
from agents.fail_agent import (
    log_run,
    new_run_id,
    validate_ahpra,
    validate_researcher,
    validate_seo,
    validate_writer,
)


def _derive_content_type(pillar: ContentPillar) -> ContentType:
    """Map pillar → content_type. News pillar → news; COMPANY pillar → company; else guide.

    Once the Intelligence agent exposes content_type directly (40/40/20 dispatcher),
    swap this for the agent's value. For now, pillar is the only signal available.
    """
    if pillar == ContentPillar.NEWS:
        return ContentType.NEWS
    if pillar == ContentPillar.COMPANY:
        return ContentType.COMPANY
    return ContentType.GUIDE


def run_pipeline() -> FinalPost:
    """Run the full pipeline end-to-end. Returns the assembled FinalPost."""
    _header()
    run_id = new_run_id()
    print(f"  run_id={run_id}\n")

    # Agent 1: Intelligence — pick the topic
    topic = select_topic()
    log_run(run_id, "intelligence", "ok")

    # Agent 3: Researcher — gather facts, sources, image
    research = research_topic(topic)
    _check(run_id, "researcher", validate_researcher(research))

    # Agent 4: Writer — write the post
    post = write_post(research)

    # Decide content_type from pillar before SEO so title cadence varies correctly.
    content_type = _derive_content_type(topic.pillar)

    # Fail-Agent Layer A — validate writer output (uses content_type from pillar)
    writer_payload = {
        "content_type": content_type.value if hasattr(content_type, "value") else str(content_type),
        "word_count": len(post.content_markdown.split()),
        "content_markdown": post.content_markdown,
    }
    _check(run_id, "writer", validate_writer(writer_payload))

    # Agent 5: SEO — metadata + JSON-LD schemas (cadence depends on content_type).
    seo = generate_seo(post, topic, content_type=content_type, image_url=research.image_url)
    _check(run_id, "seo", validate_seo(seo))

    # Agent 6: AHPRA — compliance check, auto-fix, flag issues.
    # Pass sources so unsupported_stat flags can auto-resolve when the citation
    # is right next to the stat in the markdown (M5 / B4).
    cleaned_content, ahpra_flags, ahpra_passed = check_ahpra(
        post.content_markdown, sources=research.sources
    )
    _check(run_id, "ahpra", validate_ahpra(cleaned_content))

    now = datetime.utcnow()

    # Assemble — status defaults to "pending_review"; Approve handler bumps to "published".
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
        content_type=content_type,
        target_keywords=topic.target_keywords,
        keywords=seo.keywords,
        twitter_card=seo.twitter_card,
        word_count=len(cleaned_content.split()),
        reading_time_minutes=seo.reading_time_minutes,
        sources=research.sources,
        image_url=research.image_url,
        image_credit=research.image_credit,
        faq_json_ld=seo.faq_json_ld,
        medical_webpage_schema=seo.medical_webpage_schema,
        ahpra_flags=ahpra_flags,
        ahpra_passed=ahpra_passed,
        status="pending_review",
        generated_at=now,
        dateModified=now,
    )

    _save_outputs(final)
    _push_to_dashboard(final)
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
content_type: "{post.content_type.value}"
status: "{post.status}"
reading_time_minutes: {post.reading_time_minutes}
word_count: {post.word_count}
ahpra_status: "{ahpra_status}"
ahpra_flags: "{flags_summary}"
image_url: "{post.image_url or ''}"
image_credit: "{_esc(post.image_credit or '')}"
generated_at: "{post.generated_at.isoformat()}"
dateModified: "{post.dateModified.isoformat()}"
---

"""
    with open(md_path, "w") as f:
        f.write(frontmatter + post.content_markdown)

    print(f"\n  Saved → {json_path.name}")
    print(f"  Saved → {md_path.name}")


def _push_to_dashboard(post: FinalPost) -> None:
    """If INGEST_URL + INGEST_TOKEN are set, POST the FinalPost JSON to the
    Vercel-deployed dashboard so it shows up in /admin/posts. Silently no-ops
    in local-only setups."""
    import os
    import urllib.request
    import urllib.error

    url = os.environ.get("INGEST_URL")
    token = os.environ.get("INGEST_TOKEN")
    if not url or not token:
        return

    ts = post.generated_at.strftime("%Y%m%d_%H%M%S")
    safe_slug = post.slug[:50]
    filename = f"{ts}_{safe_slug}.json"
    payload = {
        "filename": filename,
        "post": post.model_dump(mode="json"),
    }
    body = json.dumps(payload, default=str).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = resp.getcode()
            print(f"  Pushed to dashboard → HTTP {status}")
    except urllib.error.HTTPError as e:
        print(f"  ⚠  Dashboard push failed: HTTP {e.code} {e.reason}")
    except Exception as e:
        print(f"  ⚠  Dashboard push errored: {e}")


def _check(run_id: str, agent_name: str, result) -> None:
    """Log a fail_agent validation Result and warn (no abort yet — Layer A is
    observability-first; full retry orchestration is a follow-up)."""
    if result.ok:
        log_run(run_id, agent_name, "ok")
        return
    log_run(run_id, agent_name, "fail", result.reason)
    print(f"  ⚠  fail-agent: {agent_name} — {result.reason}")


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
