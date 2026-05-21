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
from typing import Any, Callable, TypeVar

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

T = TypeVar("T")


def run_with_retry(
    *,
    agent_fn: Callable[..., T],
    validator_fn: Callable[[T], str | None],
    max_retries: int = 2,
    agent_kwargs: dict[str, Any] | None = None,
) -> T:
    """M13 closed-loop retry helper.

    Calls ``agent_fn(**agent_kwargs)`` and runs ``validator_fn(result)``.
    If the validator returns ``None`` the result is returned.
    If the validator returns a failure-reason string, the agent is re-invoked
    with that string as the kwarg ``previous_failure`` — up to
    ``max_retries`` additional attempts (so total calls = max_retries + 1).
    Exhausted retries raise ``RuntimeError("pipeline_aborted: <reason>")``;
    the caller is expected to dispatch an alert.
    """
    kwargs = dict(agent_kwargs or {})
    last_failure: str | None = None
    for attempt in range(max_retries + 1):
        if last_failure is not None:
            kwargs["previous_failure"] = last_failure
        result = agent_fn(**kwargs)
        failure = validator_fn(result)
        if failure is None:
            return result
        last_failure = failure
        print(f"  [run_with_retry] attempt {attempt + 1} failed: {failure}")
    raise RuntimeError(f"pipeline_aborted: {last_failure}")


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

    # Decide content_type from pillar before SEO so title cadence varies correctly.
    content_type = _derive_content_type(topic.pillar)

    # ── M13 closed-loop: wrap writer + seo + ahpra in a retry envelope ────────
    # If the assembled FinalPost fails server-side validators, re-invoke the
    # writer with the failure reason as `previous_failure`. Bounded to 2
    # retries (3 total attempts). Exhausted retries fall through with the
    # last-attempt result so operator still sees a red row instead of a
    # silent pipeline abort.
    def _build_finalpost(*, previous_failure: str | None = None) -> FinalPost:
        # Agent 4: Writer — write the post (carries previous_failure on retry).
        post = write_post(research, previous_failure=previous_failure)

        # Fail-Agent Layer A — observability-only validation of writer output.
        writer_payload = {
            "content_type": content_type.value if hasattr(content_type, "value") else str(content_type),
            "word_count": len(post.content_markdown.split()),
            "content_markdown": post.content_markdown,
        }
        _check(run_id, "writer", validate_writer(writer_payload))

        # Agent 5: SEO — metadata + JSON-LD schemas.
        seo = generate_seo(post, topic, content_type=content_type, image_url=research.image_url)
        _check(run_id, "seo", validate_seo(seo))

        # Agent 6: AHPRA — compliance check, auto-fix, flag issues.
        cleaned_content, ahpra_flags, ahpra_passed = check_ahpra(
            post.content_markdown, sources=research.sources
        )
        _check(run_id, "ahpra", validate_ahpra(cleaned_content))

        now = datetime.utcnow()
        return FinalPost(
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

    try:
        final = run_with_retry(
            agent_fn=_build_finalpost,
            validator_fn=_validate_via_preview_endpoint,
            max_retries=2,
        )
    except RuntimeError as e:
        # All retries failed. Log + still produce a result so the operator
        # sees the red article in the queue rather than a silent abort.
        print(f"  ⚠ M13 retry exhausted — last result will ship as red: {e}")
        log_run(run_id, "writer_retry", "exhausted", str(e))
        final = _build_finalpost()

    _save_outputs(final)
    _push_to_dashboard(final)
    _summary(final)
    return final


def _validate_via_preview_endpoint(post: FinalPost) -> str | None:
    """M13 validator function — POSTs the FinalPost to
    /api/admin/validate-preview and returns ``None`` if all validators pass,
    or a failure-reason string summarising the red ones.

    Falls through (returns ``None``) when CRON_BASE_URL / INGEST_TOKEN are
    unset (e.g. local-only dev) or the endpoint is unreachable — the pipeline
    still completes, but without the retry safety net.
    """
    import os
    import urllib.request
    import urllib.error

    base_url = os.environ.get("CRON_BASE_URL")
    token = os.environ.get("INGEST_TOKEN")
    if not base_url or not token:
        return None  # M13 disabled — no preview endpoint configured

    url = base_url.rstrip("/") + "/api/admin/validate-preview"
    payload = {"post": post.model_dump(mode="json")}
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
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"  ⚠ validate-preview unreachable: {e}; skipping retry gate")
        return None

    red = data.get("red_validators") or []
    if not red:
        return None
    parts = [f"{r.get('check')}: {r.get('detail')}" for r in red]
    return "; ".join(parts)


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
