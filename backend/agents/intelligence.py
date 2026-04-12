"""
Agent 1: Intelligence
Selects the best blog topic by analysing recent Guardian AU health news
against StatDoctor's content pillars and past topics written.
"""

import json
from datetime import datetime, timedelta

import httpx
from openai import OpenAI

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import OPENAI_API_KEY, GUARDIAN_API_KEY, WRITER_MODEL, TOPICS_LOG
from models import ContentPillar, GuardianArticle, PILLAR_DESCRIPTIONS, TopicBrief

client = OpenAI(api_key=OPENAI_API_KEY)

GUARDIAN_BASE = "https://content.guardianapis.com/search"

# Search queries to catch relevant AU/NZ healthcare news
_NEWS_QUERIES = [
    "locum doctor Australia",
    "GP shortage Australia",
    "AHPRA registration doctor",
    "healthcare workforce Australia",
    "rural doctor Australia shortage",
    "medical workforce New Zealand",
    "Medicare reform doctor Australia",
]


def _fetch_guardian_news(query: str, days_back: int = 14) -> list[GuardianArticle]:
    if not GUARDIAN_API_KEY:
        return []
    from_date = (datetime.utcnow() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    params = {
        "q": query,
        "api-key": GUARDIAN_API_KEY,
        "from-date": from_date,
        "order-by": "newest",
        "page-size": 5,
        "show-fields": "trailText",
        "section": "society|australia-news|business|science",
    }
    try:
        r = httpx.get(GUARDIAN_BASE, params=params, timeout=10)
        r.raise_for_status()
        results = r.json().get("response", {}).get("results", [])
        articles = []
        for item in results:
            articles.append(GuardianArticle(
                id=item["id"],
                title=item["webTitle"],
                url=item["webUrl"],
                published=item["webPublicationDate"],
                section=item["sectionName"],
                body_preview=item.get("fields", {}).get("trailText"),
            ))
        return articles
    except Exception as e:
        print(f"  [Intelligence] Guardian error for '{query}': {e}")
        return []


def _load_past_topics() -> list[str]:
    if TOPICS_LOG.exists():
        with open(TOPICS_LOG) as f:
            return json.load(f)
    return []


def _save_topic(title: str) -> None:
    topics = _load_past_topics()
    topics.append(title)
    with open(TOPICS_LOG, "w") as f:
        json.dump(topics[-50:], f, indent=2)  # keep last 50


def select_topic() -> TopicBrief:
    """Pick the best topic to write about today."""
    print("[Intelligence] Fetching recent Guardian news...")

    articles: list[GuardianArticle] = []
    for query in _NEWS_QUERIES:
        articles.extend(_fetch_guardian_news(query))

    # Deduplicate by article ID
    seen: set[str] = set()
    unique: list[GuardianArticle] = []
    for a in articles:
        if a.id not in seen:
            seen.add(a.id)
            unique.append(a)

    print(f"  [Intelligence] {len(unique)} unique news articles found")

    past_topics = _load_past_topics()

    # Build prompt context
    articles_text = "\n".join(
        f"- {a.title} ({a.published[:10]}) — {a.section}\n  {a.body_preview or '(no preview)'}"
        for a in unique[:20]
    ) or "No recent articles retrieved — choose an evergreen topic."

    pillars_text = "\n".join(
        f"- {p.value}: {desc}" for p, desc in PILLAR_DESCRIPTIONS.items()
    )

    past_text = (
        "\n".join(f"- {t}" for t in past_topics[-20:])
        if past_topics
        else "None written yet — any topic is fair game."
    )

    pillar_values = [p.value for p in ContentPillar]

    prompt = f"""You are the content strategy lead for StatDoctor (statdoctor.app), Australia's locum doctor marketplace.

Your job: choose ONE blog post topic that will rank on Google, surface in AI Overviews (AEO), and drive Australian and New Zealand locum doctors to StatDoctor.

CONTENT PILLARS (cycle through these for coverage):
{pillars_text}

RECENT GUARDIAN NEWS (use as a hook where possible):
{articles_text}

TOPICS ALREADY WRITTEN (do not repeat):
{past_text}

TODAY: {datetime.utcnow().strftime("%Y-%m-%d")}

Rules:
- Prefer topics with a current news hook — they rank faster
- Target question-format titles (e.g. "How much do locum GPs earn in Australia?")
- Keywords must be things real doctors search for
- Rotate through pillars so no pillar goes more than 2 posts without coverage
- suggested_h2s must be questions (they become Google PAA matches)
- suggested_faqs must be distinct long-tail questions a doctor would ask

Return JSON only — no markdown, no explanation:
{{
  "title": "full blog post title",
  "pillar": one of {pillar_values},
  "target_keywords": ["primary keyword", "second keyword", "third keyword"],
  "secondary_keywords": ["long-tail keyword", "another long-tail"],
  "news_hook": "brief description of the news angle, or null if evergreen",
  "news_hook_url": "Guardian article URL if used, or null",
  "rationale": "one paragraph — why this topic, why now, what gap it fills",
  "suggested_h2s": [
    "Question H2 that matches a search query?",
    "Another question covering a key aspect?",
    "Third angle question?",
    "What does this mean for locum doctors in [State]?"
  ],
  "suggested_faqs": [
    "FAQ question 1?",
    "FAQ question 2?",
    "FAQ question 3?",
    "FAQ question 4?",
    "FAQ question 5?"
  ]
}}"""

    response = client.chat.completions.create(
        model=WRITER_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.7,
    )

    data = json.loads(response.choices[0].message.content)
    topic = TopicBrief(**data)
    _save_topic(topic.title)

    print(f"  [Intelligence] Topic: {topic.title}")
    print(f"  [Intelligence] Pillar: {topic.pillar.value}")
    return topic
