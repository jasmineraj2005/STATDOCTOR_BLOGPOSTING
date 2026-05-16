"""
Agent 3: Researcher
Given a TopicBrief, gathers:
- Key facts and verified statistics (Australian context)
- 5-8 citable sources (Guardian articles + well-known AU health bodies)
- An Unsplash hero image
- Relevant AHPRA compliance context for the topic

M1.T6 additions:
- Calls validate_sources after dedupe; drops off-whitelist / 404 URLs.
- Re-broadens up to MAX_REBROADEN_RETRIES times if post-filter count < MIN_OK_SOURCES.
- Tracks total LLM token spend per topic; aborts if it exceeds BUDGET_TOKENS_PER_TOPIC.
"""

import json
import random
import re
import sys
import os
import urllib.parse

import httpx
from openai import OpenAI

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import (
    OPENAI_API_KEY,
    GUARDIAN_API_KEY,
    UNSPLASH_ACCESS_KEY,
    WRITER_MODEL,
    OUTPUT_DIR,
)
from models import ResearchBrief, Source, TopicBrief
from validation.urls import validate_sources

USED_IMAGES_LOG = OUTPUT_DIR / "used_images.json"

# ── tunable constants ─────────────────────────────────────────────────────────

BUDGET_TOKENS_PER_TOPIC: int = int(os.getenv("RESEARCHER_BUDGET_TOKENS", "50000"))
MIN_OK_SOURCES: int = 5
MAX_REBROADEN_RETRIES: int = 2


def _build_chart_url(statistics: list[str], topic_title: str) -> str | None:
    """Extract numeric data from statistics and return a Quickchart.io bar chart URL."""
    labels: list[str] = []
    values: list[float] = []

    for stat in statistics[:6]:
        # Extract the first number (with optional $ or %) from the stat string
        num_match = re.search(r"\$?([\d,]+(?:\.\d+)?)\s*(%|k|K|m|M)?", stat)
        if not num_match:
            continue
        raw = num_match.group(1).replace(",", "")
        multiplier = {"k": 1000, "K": 1000, "m": 1_000_000, "M": 1_000_000}.get(
            num_match.group(2) or "", 1
        )
        try:
            value = float(raw) * multiplier
        except ValueError:
            continue

        # Build a short label from the stat (first 4 meaningful words)
        words = re.sub(r"[\$%,\d\.]+\w*", "", stat).split()
        label = " ".join(w for w in words if len(w) > 2)[:25].strip()
        if not label:
            continue
        labels.append(label)
        values.append(value)

    if len(labels) < 2:
        return None

    chart_config = {
        "type": "bar",
        "data": {
            "labels": labels,
            "datasets": [
                {
                    "label": "",
                    "data": values,
                    "backgroundColor": "#8b5cf6",
                    "borderRadius": 6,
                }
            ],
        },
        "options": {
            "plugins": {
                "legend": {"display": False},
                "title": {
                    "display": True,
                    "text": topic_title[:55],
                    "font": {"size": 13},
                },
            },
            "scales": {"y": {"beginAtZero": False}},
        },
    }
    encoded = urllib.parse.quote(json.dumps(chart_config))
    return f"https://quickchart.io/chart?c={encoded}&width=600&height=300&bkg=white"


def _load_used_images() -> set[str]:
    if USED_IMAGES_LOG.exists():
        with open(USED_IMAGES_LOG) as f:
            return set(json.load(f))
    return set()


def _save_used_image(photo_id: str) -> None:
    used = _load_used_images()
    used.add(photo_id)
    with open(USED_IMAGES_LOG, "w") as f:
        json.dump(list(used), f)

client = OpenAI(api_key=OPENAI_API_KEY)

GUARDIAN_BASE = "https://content.guardianapis.com/search"
UNSPLASH_BASE = "https://api.unsplash.com/search/photos"


_OG_IMAGE_BLOCKLIST = (
    "unsplash.com",
    "quickchart.io",
)

_OG_SCRAPE_HEADERS = {
    "User-Agent": "StatDoctorBot/1.0 (+https://statdoctor.app)",
}


def _is_blocked_image_url(url: str) -> bool:
    """Return True if the URL is from a blocked source (stock / placeholders / SVG)."""
    if not url:
        return True
    if url.endswith(".svg"):
        return True
    for blocked in _OG_IMAGE_BLOCKLIST:
        if blocked in url:
            return True
    return False


def _scrape_og_image(url: str) -> tuple[str | None, str | None, str | None]:
    """Fetch a non-Guardian source URL and scrape OG/Twitter image + author meta.

    Returns (image_url, author, alt_text). All may be None.
    Silently ignores 4xx/5xx and network errors.
    """
    for attempt in range(2):
        try:
            r = httpx.get(
                url,
                headers=_OG_SCRAPE_HEADERS,
                timeout=5,
                follow_redirects=True,
            )
            if r.status_code >= 400:
                # 4xx — skip, no retry
                if r.status_code < 500:
                    return None, None, None
                # 5xx — retry once
                if attempt == 0:
                    continue
                return None, None, None
            html = r.text
            break
        except Exception:
            return None, None, None
    else:
        return None, None, None

    # Extract og:image / twitter:image
    image_url: str | None = None
    for pattern in (
        r'<meta\s+property=["\']og:image["\']\s+content=["\'](https?://[^"\']+)["\']',
        r'<meta\s+content=["\'](https?://[^"\']+)["\']\s+property=["\']og:image["\']',
        r'<meta\s+name=["\']og:image["\']\s+content=["\'](https?://[^"\']+)["\']',
        r'<meta\s+name=["\']twitter:image["\']\s+content=["\'](https?://[^"\']+)["\']',
        r'<meta\s+property=["\']twitter:image["\']\s+content=["\'](https?://[^"\']+)["\']',
    ):
        m = re.search(pattern, html, re.IGNORECASE)
        if m:
            candidate = m.group(1)
            if not _is_blocked_image_url(candidate):
                image_url = candidate
                break

    # Extract og:image:alt
    alt_text: str | None = None
    m_alt = re.search(
        r'<meta\s+property=["\']og:image:alt["\']\s+content=["\'](.*?)["\']',
        html,
        re.IGNORECASE,
    )
    if m_alt:
        alt_text = m_alt.group(1).strip() or None

    # Extract author meta
    author: str | None = None
    m_author = re.search(
        r'<meta\s+name=["\']author["\']\s+content=["\'](.*?)["\']',
        html,
        re.IGNORECASE,
    )
    if m_author:
        author = m_author.group(1).strip() or None

    return image_url, author, alt_text


def _search_guardian(query: str, n: int = 8) -> list[dict]:
    if not GUARDIAN_API_KEY:
        return []
    params = {
        "q": query,
        "api-key": GUARDIAN_API_KEY,
        "page-size": n,
        "show-fields": "trailText,bodyText,thumbnail,byline",
        "order-by": "relevance",
        "section": "society|australia-news|business|science",
    }
    try:
        r = httpx.get(GUARDIAN_BASE, params=params, timeout=10)
        r.raise_for_status()
        return r.json().get("response", {}).get("results", [])
    except Exception as e:
        print(f"  [Researcher] Guardian error: {e}")
        return []


def _fetch_unsplash_image(
    query: str,
) -> tuple[str | None, str | None, str | None]:
    """Returns (url, credit_string, description). Avoids re-using the same photo."""
    if not UNSPLASH_ACCESS_KEY:
        return None, None, None

    used_ids = _load_used_images()
    params = {
        "query": query,
        "per_page": 10,
        "orientation": "landscape",
        "client_id": UNSPLASH_ACCESS_KEY,
    }
    try:
        r = httpx.get(UNSPLASH_BASE, params=params, timeout=10)
        r.raise_for_status()
        results = r.json().get("results", [])
        random.shuffle(results)

        # Prefer an unused photo; fall back to any if all used
        chosen = next((p for p in results if p["id"] not in used_ids), None)
        if chosen is None and results:
            chosen = results[0]

        if chosen:
            _save_used_image(chosen["id"])
            url = chosen["urls"]["regular"]
            credit = f"Photo by {chosen['user']['name']} on Unsplash"
            description = (
                chosen.get("description")
                or chosen.get("alt_description")
                or query
            )
            return url, credit, description
    except Exception as e:
        print(f"  [Researcher] Unsplash error: {e}")
    return None, None, None


def _sources_to_dicts(sources: list[Source]) -> list[dict]:
    """Convert Source model instances to plain dicts for validate_sources."""
    return [
        {
            "url": s.url,
            "title": s.title,
            "publisher": s.publisher,
            "snippet": s.snippet,
            "image_url": s.image_url,
            "image_credit_publisher": s.image_credit_publisher,
            "image_credit_author": s.image_credit_author,
            "image_alt": s.image_alt,
        }
        for s in sources
    ]


def _gather_sources(
    topic: TopicBrief,
    search_query: str,
    llm_additional: list[dict],
    http_client: httpx.Client,
) -> tuple[list[Source], list[dict]]:
    """
    Fetch Guardian results and merge with LLM-supplied additional_sources.
    Returns (all_sources_as_Source_list, guardian_raw_results).
    """
    guardian_results = _search_guardian(search_query)

    guardian_sources: list[Source] = []
    for item in guardian_results[:6]:
        fields = item.get("fields", {})
        trail = fields.get("trailText") or ""
        body_preview = (fields.get("bodyText") or "")[:400]
        guardian_sources.append(
            Source(
                title=item["webTitle"],
                url=item["webUrl"],
                publisher="The Guardian",
                snippet=(trail or body_preview)[:250],
            )
        )

    all_sources: list[Source] = list(guardian_sources)
    for s in llm_additional[:5]:
        all_sources.append(
            Source(
                title=s.get("title", ""),
                url=s.get("url", ""),
                publisher=s.get("publisher", ""),
                snippet=s.get("snippet", ""),
            )
        )

    return all_sources, guardian_results


def _make_aborted_brief(topic: TopicBrief, reason: str) -> ResearchBrief:
    """Return a sentinel brief signalling that research was aborted."""
    return ResearchBrief(
        topic=topic,
        key_facts=[],
        statistics=[],
        sources=[],
        ahpra_context="",
        aborted=True,
        abort_reason=reason,
    )


def research_topic(
    topic: TopicBrief,
    *,
    http_client: httpx.Client | None = None,
) -> ResearchBrief:
    """Gather facts, sources, and a hero image for the given topic.

    Parameters
    ----------
    topic:
        The TopicBrief to research.
    http_client:
        Optional shared httpx.Client injected for testing.  When None a
        short-lived client is created internally and closed on return.
    """
    print(f"[Researcher] Researching: {topic.title}")

    budget = int(os.getenv("RESEARCHER_BUDGET_TOKENS", str(BUDGET_TOKENS_PER_TOPIC)))
    total_tokens_used: int = 0

    owns_http_client = http_client is None
    if owns_http_client:
        http_client = httpx.Client(follow_redirects=True, timeout=10)

    try:
        # ── Step 1: Pull Guardian articles + LLM research call ───────────────
        search_query = " ".join(topic.target_keywords[:2]) + " Australia"

        # Build Guardian snippets for the prompt (pre-validation, just for LLM context)
        guardian_results_for_prompt = _search_guardian(search_query)
        guardian_snippets: list[str] = []
        for item in guardian_results_for_prompt[:6]:
            fields = item.get("fields", {})
            trail = fields.get("trailText") or ""
            body_preview = (fields.get("bodyText") or "")[:400]
            guardian_snippets.append(
                f"Title: {item['webTitle']}\n"
                f"URL: {item['webUrl']}\n"
                f"Preview: {trail}\n"
                f"{body_preview}"
            )

        snippets_text = (
            "\n\n---\n\n".join(guardian_snippets)
            if guardian_snippets
            else "No Guardian articles retrieved — rely on your knowledge of Australian healthcare."
        )

        prompt = f"""You are a medical content researcher for StatDoctor (statdoctor.app), Australia's locum doctor marketplace.

Research the following topic. Your knowledge of Australian healthcare (AHPRA, Medicare, AMA, AIHW, ABS, state health departments) is authoritative.

TOPIC: {topic.title}
PILLAR: {topic.pillar.value}
TARGET KEYWORDS: {", ".join(topic.target_keywords)}
SECONDARY KEYWORDS: {", ".join(topic.secondary_keywords)}
NEWS HOOK: {topic.news_hook or "N/A"}

GUARDIAN ARTICLES FOUND:
{snippets_text}

Generate a research brief. Return JSON only:
{{
  "key_facts": [
    "Specific, accurate fact 1 relevant to Australian locum doctors",
    "Fact 2",
    "Fact 3",
    "Fact 4",
    "Fact 5",
    "Fact 6",
    "Fact 7",
    "Fact 8"
  ],
  "statistics": [
    "Statistic with figure — Source Organisation (Year)",
    "Another statistic — Source (Year)"
  ],
  "ahpra_context": "Specific AHPRA regulations, registration requirements, or advertising rules relevant to this topic. Be precise about which AHPRA standards apply.",
  "additional_sources": [
    {{
      "title": "Source document or article title",
      "url": "https://real-url.gov.au/or-org/",
      "publisher": "AHPRA / AMA / AIHW / ABS / DoH / State Health Dept / etc.",
      "snippet": "What this source says that's relevant to the topic"
    }}
  ]
}}

Rules:
- Mark any statistic you are not fully certain about with [verify] at the end
- All sources should be real Australian/NZ government bodies, peak medical bodies, or reputable media
- AHPRA context must reference specific standards (e.g. "Good Medical Practice", "Guidelines for registered medical practitioners")
- Aim for 4-6 additional sources beyond Guardian articles
- Statistics should reference: AIHW, ABS, DoH, AHPRA annual report, AMA, MJA where possible"""

        response = client.chat.completions.create(
            model=WRITER_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
        )

        # ── Token budget check ────────────────────────────────────────────────
        usage = getattr(response, "usage", None)
        raw_tokens = getattr(usage, "total_tokens", 0) if usage else 0
        try:
            call_tokens = int(raw_tokens)
        except (TypeError, ValueError):
            call_tokens = 0
        total_tokens_used += call_tokens

        if total_tokens_used > budget:
            print(
                f"  [Researcher] ABORTED topic={topic.title!r} "
                f"tokens_used={total_tokens_used} budget={budget} status=budget_exceeded"
            )
            return _make_aborted_brief(topic, "budget_exceeded")

        data = json.loads(response.choices[0].message.content)

        # ── Step 2: Merge sources (Guardian + LLM additional) ─────────────────
        # Build Guardian sources from the already-fetched results
        guardian_sources: list[Source] = []
        for item in guardian_results_for_prompt[:6]:
            fields = item.get("fields", {})
            trail = fields.get("trailText") or ""
            body_preview = (fields.get("bodyText") or "")[:400]
            thumbnail = fields.get("thumbnail") or None
            byline = fields.get("byline") or None
            guardian_sources.append(
                Source(
                    title=item["webTitle"],
                    url=item["webUrl"],
                    publisher="The Guardian",
                    snippet=(trail or body_preview)[:250],
                    image_url=thumbnail,
                    image_credit_publisher="The Guardian" if thumbnail else None,
                    image_credit_author=byline if thumbnail else None,
                    image_alt=item["webTitle"] if thumbnail else None,
                )
            )

        all_sources: list[Source] = list(guardian_sources)
        for s in data.get("additional_sources", [])[:5]:
            src_publisher = s.get("publisher", "")
            src_url = s.get("url", "")
            # Scrape OG image for non-Guardian sources
            og_image_url: str | None = None
            og_author: str | None = None
            og_alt: str | None = None
            if src_url:
                og_image_url, og_author, og_alt = _scrape_og_image(src_url)
            all_sources.append(
                Source(
                    title=s.get("title", ""),
                    url=src_url,
                    publisher=src_publisher,
                    snippet=s.get("snippet", ""),
                    image_url=og_image_url,
                    image_credit_publisher=src_publisher if og_image_url else None,
                    image_credit_author=og_author if og_image_url else None,
                    image_alt=(og_alt or s.get("title", "")) if og_image_url else None,
                )
            )

        # ── Step 3: validate_sources + re-broaden loop ────────────────────────
        validated_sources: list[Source] = []
        for retry in range(MAX_REBROADEN_RETRIES + 1):
            source_dicts = _sources_to_dicts(all_sources)
            val_result = validate_sources(source_dicts, http=http_client)

            ok_dicts = val_result.ok_sources
            validated_sources = [
                Source(
                    title=d.get("title", ""),
                    url=d.get("url", ""),
                    publisher=d.get("publisher", ""),
                    snippet=d.get("snippet", ""),
                    image_url=d.get("image_url"),
                    image_credit_publisher=d.get("image_credit_publisher"),
                    image_credit_author=d.get("image_credit_author"),
                    image_alt=d.get("image_alt"),
                )
                for d in ok_dicts
            ]

            if len(validated_sources) >= MIN_OK_SOURCES:
                break  # enough — proceed

            if retry < MAX_REBROADEN_RETRIES:
                # Re-broaden: widen the Guardian query and re-fetch
                print(
                    f"  [Researcher] Only {len(validated_sources)} valid sources after validation "
                    f"(need {MIN_OK_SOURCES}), re-broadening (attempt {retry + 1}/{MAX_REBROADEN_RETRIES})…"
                )
                broad_query = " ".join(topic.target_keywords) + " Australia healthcare"
                broad_results = _search_guardian(broad_query, n=12)
                new_guardian: list[Source] = []
                seen_urls = {s.url for s in all_sources}
                for item in broad_results[:10]:
                    url = item["webUrl"]
                    if url in seen_urls:
                        continue
                    seen_urls.add(url)
                    fields = item.get("fields", {})
                    trail = fields.get("trailText") or ""
                    body_preview = (fields.get("bodyText") or "")[:400]
                    thumbnail = fields.get("thumbnail") or None
                    byline = fields.get("byline") or None
                    new_guardian.append(
                        Source(
                            title=item["webTitle"],
                            url=url,
                            publisher="The Guardian",
                            snippet=(trail or body_preview)[:250],
                            image_url=thumbnail,
                            image_credit_publisher="The Guardian" if thumbnail else None,
                            image_credit_author=byline if thumbnail else None,
                            image_alt=item["webTitle"] if thumbnail else None,
                        )
                    )
                all_sources = all_sources + new_guardian
            else:
                # Exhausted retries
                print(
                    f"  [Researcher] ABORTED topic={topic.title!r} "
                    f"valid_sources={len(validated_sources)} status=too_few_valid_sources"
                )
                return _make_aborted_brief(topic, "too_few_valid_sources")

        # ── Step 4: Hero + inline images ──────────────────────────────────────
        image_query = f"doctor Australia medical {topic.target_keywords[0]}"
        image_url, image_credit, image_description = _fetch_unsplash_image(image_query)
        if image_url:
            print(f"  [Researcher] Hero image: {image_credit}")
        else:
            print("  [Researcher] No hero image (UNSPLASH_ACCESS_KEY missing or error)")

        inline_queries = [
            f"hospital workplace Australia {topic.pillar.value.replace('_', ' ')}",
            f"medical professional {topic.target_keywords[-1] if topic.target_keywords else 'healthcare'}",
        ]
        inline_images: list[str] = []
        for q in inline_queries:
            url, _, _ = _fetch_unsplash_image(q)
            if url:
                inline_images.append(url)
        print(f"  [Researcher] {len(inline_images)} inline images fetched")

        stats_list = data.get("statistics", [])
        chart_url = _build_chart_url(stats_list, topic.title)
        if chart_url:
            print(f"  [Researcher] Chart generated for {len(stats_list)} statistics")
        else:
            print("  [Researcher] No chart generated (insufficient numeric stats)")

        brief = ResearchBrief(
            topic=topic,
            key_facts=data.get("key_facts", []),
            statistics=stats_list,
            sources=validated_sources,
            ahpra_context=data.get("ahpra_context", ""),
            image_url=image_url,
            image_credit=image_credit,
            image_description=image_description,
            chart_url=chart_url,
            inline_images=inline_images,
        )

        print(
            f"  [Researcher] {len(validated_sources)} sources | "
            f"{len(brief.key_facts)} facts | {len(brief.statistics)} stats | "
            f"tokens={total_tokens_used} status=ok"
        )
        return brief

    finally:
        if owns_http_client:
            http_client.close()
