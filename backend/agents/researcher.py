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
import sys
import os

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
        print(f"  [Researcher] Image found: {image_credit}")
    else:
        print("  [Researcher] No image (UNSPLASH_ACCESS_KEY missing or error)")

    brief = ResearchBrief(
        topic=topic,
        key_facts=data.get("key_facts", []),
        statistics=data.get("statistics", []),
        sources=all_sources,
        ahpra_context=data.get("ahpra_context", ""),
        image_url=image_url,
        image_credit=image_credit,
        image_description=image_description,
    )

    print(f"  [Researcher] {len(all_sources)} sources | {len(brief.key_facts)} facts | {len(brief.statistics)} stats")
    return brief
