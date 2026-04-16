"""
Agent 3: Researcher
Given a TopicBrief, gathers:
- Key facts and verified statistics (Australian context)
- 5-8 citable sources (Guardian articles + well-known AU health bodies)
- An Unsplash hero image
- Relevant AHPRA compliance context for the topic
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

USED_IMAGES_LOG = OUTPUT_DIR / "used_images.json"


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


def _search_guardian(query: str, n: int = 8) -> list[dict]:
    if not GUARDIAN_API_KEY:
        return []
    params = {
        "q": query,
        "api-key": GUARDIAN_API_KEY,
        "page-size": n,
        "show-fields": "trailText,bodyText",
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


def research_topic(topic: TopicBrief) -> ResearchBrief:
    """Gather facts, sources, and a hero image for the given topic."""
    print(f"[Researcher] Researching: {topic.title}")

    # Pull Guardian articles for context
    search_query = " ".join(topic.target_keywords[:2]) + " Australia"
    guardian_results = _search_guardian(search_query)

    guardian_snippets: list[str] = []
    guardian_sources: list[Source] = []
    for item in guardian_results[:6]:
        fields = item.get("fields", {})
        trail = fields.get("trailText") or ""
        body_preview = (fields.get("bodyText") or "")[:400]
        guardian_snippets.append(
            f"Title: {item['webTitle']}\n"
            f"URL: {item['webUrl']}\n"
            f"Preview: {trail}\n"
            f"{body_preview}"
        )
        guardian_sources.append(
            Source(
                title=item["webTitle"],
                url=item["webUrl"],
                publisher="The Guardian",
                snippet=(trail or body_preview)[:250],
            )
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

    data = json.loads(response.choices[0].message.content)

    # Merge sources
    all_sources: list[Source] = list(guardian_sources)
    for s in data.get("additional_sources", [])[:5]:
        all_sources.append(
            Source(
                title=s.get("title", ""),
                url=s.get("url", ""),
                publisher=s.get("publisher", ""),
                snippet=s.get("snippet", ""),
            )
        )

    # Hero image from Unsplash
    image_query = f"doctor Australia medical {topic.target_keywords[0]}"
    image_url, image_credit, image_description = _fetch_unsplash_image(image_query)
    if image_url:
        print(f"  [Researcher] Hero image: {image_credit}")
    else:
        print("  [Researcher] No hero image (UNSPLASH_ACCESS_KEY missing or error)")

    # Additional inline images for mid-article placement
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
        sources=all_sources,
        ahpra_context=data.get("ahpra_context", ""),
        image_url=image_url,
        image_credit=image_credit,
        image_description=image_description,
        chart_url=chart_url,
        inline_images=inline_images,
    )

    print(f"  [Researcher] {len(all_sources)} sources | {len(brief.key_facts)} facts | {len(brief.statistics)} stats")
    return brief
