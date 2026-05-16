"""
Agent 5: SEO
Generates:
- URL slug
- Meta title (≤60 chars) and meta description (≤155 chars)
- Focus keyword
- Reading time
- keywords[] (5–8 supplementary keywords — internal only, NOT rendered as <meta name="keywords">)
- twitter_card { title, description, image }
- FAQ JSON-LD schema (for Google rich results)
- MedicalWebPage schema (legacy — website now also emits MedicalScholarlyArticle)

M6.5 additions (SEO/AEO cross-check, May 2026):
- reviewedBy: Person reference (Dr Anu is both author and medical reviewer)
- citation[]: ScholarlyArticle entries built from post.sources[]
- publicationType (MeSH): "Review" for guides, "News Article" for news, omitted for company
- speakable: SpeakableSpecification emitted ONLY for news posts (.article-tldr selector)

NOTE: <meta name="keywords"> is intentionally NOT emitted from this repo's frontend.
Google has ignored that tag since 2009; Bing has been known to spam-flag pages that use it.
The keywords[] field is retained internally for writer/SEO logic only.
"""

import json
import re
import sys
import os
from datetime import datetime

from openai import OpenAI

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import OPENAI_API_KEY, FAST_MODEL, SITE_URL, SITE_NAME
from models import BlogPost, ContentType, SEOMetadata, TopicBrief, TwitterCard, Source

client = OpenAI(api_key=OPENAI_API_KEY)


# Per-(content_type, pillar) title cadence pool. The model is told to pick one
# of the allowed shapes for the post being written. This prevents every article
# from reading "How will X impact Y?" — see BLOG_AGENT.md "SEO variation".
_TITLE_CADENCES: dict[str, list[str]] = {
    "news": [
        "numerical-hook",   # "A$1,850/day: how the Geelong refinery fire moved locum costs"
        "news-update",      # "Medicare reform 2026: what changed for locum billing"
        "question-form",    # "Will the rural workforce strategy lift regional rates?"
    ],
    "guide": [
        "how-to",           # "How to register with AHPRA as an overseas-trained locum"
        "explainer",        # "Locum GP rates by state — what to expect in 2026"
        "numerical-hook",
        "question-form",
    ],
    "company": [
        "explainer",
        "question-form",
    ],
}


# ── M6.5 schema helpers ───────────────────────────────────────────────────────

# Dr Anu is both author and medical reviewer for all StatDoctor content.
_DR_ANU_PERSON = {
    "@type": "Person",
    "name": "Dr Anu Baldev",
    "url": "https://statdoctor.net/about",
    "jobTitle": "Medical Director",
    "affiliation": {"@type": "Organization", "name": "StatDoctor"},
}

# MeSH publicationType mapping by content_type.
# "company" posts are omitted entirely (overclaiming risk).
_PUBLICATION_TYPE_MAP: dict[str, str] = {
    "guide": "Review",
    "news": "News Article",
    # "company" key deliberately absent — field is omitted
}

_SPEAKABLE_SPEC = {
    "@type": "SpeakableSpecification",
    "cssSelector": [".article-tldr"],
}


def _build_reviewed_by() -> dict:
    """Return a reviewedBy Person node (Dr Anu is author + medical reviewer)."""
    return _DR_ANU_PERSON.copy()


def _build_citation(sources: list[Source]) -> list[dict]:
    """Convert sources[] to ScholarlyArticle citation entries."""
    citations = []
    for src in sources:
        entry: dict = {
            "@type": "ScholarlyArticle",
            "url": src.url,
            "name": src.title,
            "publisher": {
                "@type": "Organization",
                "name": src.publisher,
            },
        }
        citations.append(entry)
    return citations


def _build_publication_type(content_type: ContentType) -> str | None:
    """Return MeSH publicationType string, or None for company posts."""
    return _PUBLICATION_TYPE_MAP.get(content_type.value)


def _build_speakable(content_type: ContentType) -> dict | None:
    """Return SpeakableSpecification only for news posts; None otherwise.

    Emitting speakable for non-news overclaims — Google may penalise.
    """
    if content_type == ContentType.NEWS:
        return _SPEAKABLE_SPEC.copy()
    return None


def _slugify(title: str) -> str:
    slug = title.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")[:80]


def _reading_time(content: str) -> int:
    """200 wpm — professionals read slightly slower on screen."""
    return max(1, round(len(content.split()) / 200))


def generate_seo(
    post: BlogPost,
    topic: TopicBrief,
    content_type: ContentType = ContentType.GUIDE,
    image_url: str | None = None,
    sources: list[Source] | None = None,
) -> SEOMetadata:
    """Generate all SEO metadata for the post."""
    print(f"[SEO] Generating metadata (content_type={content_type.value})...")

    slug = _slugify(post.title)
    reading_time = _reading_time(post.content_markdown)
    canonical_url = f"{SITE_URL}/blog/{slug}"
    today = datetime.utcnow().strftime("%Y-%m-%d")

    # Extract FAQ block from post for schema generation
    faq_section = ""
    if "## Frequently Asked Questions" in post.content_markdown:
        start = post.content_markdown.index("## Frequently Asked Questions")
        rest = post.content_markdown[start:]
        next_h2 = re.search(r"\n## ", rest[3:])
        faq_section = rest[: next_h2.start() + 3] if next_h2 else rest
    faq_section = faq_section[:2000]

    cadences = _TITLE_CADENCES.get(content_type.value, _TITLE_CADENCES["guide"])
    cadences_text = ", ".join(cadences)

    prompt = f"""You are an SEO specialist for StatDoctor ({SITE_URL}), Australia's locum doctor marketplace.

Generate SEO metadata for this blog post.

TITLE: {post.title}
CONTENT TYPE: {content_type.value}
PRIMARY KEYWORD: {topic.target_keywords[0]}
SECONDARY KEYWORDS: {", ".join(topic.target_keywords[1:] + topic.secondary_keywords)}
CANONICAL URL: {canonical_url}
TL;DR: {post.tldr}
SITE NAME: {SITE_NAME}
DATE: {today}
HERO IMAGE URL: {image_url or '(none — twitter_card.image stays null)'}

FAQ SECTION FROM POST:
{faq_section or "(not yet extracted — infer from title and keywords)"}

CRITICAL RULES — pillar variation:
1. meta_title MUST follow ONE of these cadences: {cadences_text}. Pick the one that fits the topic best. Do NOT default to "How will X impact Y?" for every article.
2. meta_description MUST lead with a concrete value — a stat, a dollar figure, or a date — drawn from the post body. Do NOT open with a generic intro sentence.
3. og_image_alt MUST reference specific imagery: the publisher (if known) + the scene. Avoid "doctor in hospital", "stethoscope on desk", or any generic stock-photo phrasing.
4. keywords[] is 5–8 strings: include the primary keyword, 2–3 long-tail variants, and 1–2 entity terms (e.g., "AHPRA", "Medicare BB rebate").
5. twitter_card.title may be looser than meta_title (up to 70 chars) and can be more punchy / curious.

Return JSON only:
{{
  "meta_title": "≤60 chars — primary keyword present — follows the chosen cadence",
  "meta_description": "≤155 chars — opens with a concrete value — ends with a soft CTA",
  "focus_keyword": "exact primary keyword phrase",
  "og_image_alt": "≤125 chars — specific scene + publisher if applicable",
  "keywords": ["primary keyword", "longtail 1", "longtail 2", "entity 1", "..."],
  "twitter_card": {{
    "title": "≤70 chars — can be punchier than meta_title",
    "description": "≤200 chars — concrete + curious",
    "image": "{image_url or ''}"
  }},
  "faq_json_ld": {{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {{
        "@type": "Question",
        "name": "Question from the FAQ section?",
        "acceptedAnswer": {{ "@type": "Answer", "text": "Concise answer under 200 chars" }}
      }}
    ]
  }},
  "medical_webpage_schema": {{
    "@context": "https://schema.org",
    "@type": "MedicalWebPage",
    "name": "{post.title}",
    "url": "{canonical_url}",
    "description": "meta description here",
    "about": {{ "@type": "Thing", "name": "Locum medical practice in Australia and New Zealand" }},
    "audience": {{ "@type": "MedicalAudience", "audienceType": "Physicians, medical practitioners, locum doctors" }},
    "publisher": {{ "@type": "Organization", "name": "{SITE_NAME}", "url": "{SITE_URL}" }},
    "datePublished": "{today}",
    "dateModified": "{today}",
    "inLanguage": "en-AU",
    "isAccessibleForFree": true
  }}
}}

FAQ schema rules:
- Include 4–6 questions extracted from the post's FAQ section
- Answer text must be under 200 characters (Google truncates longer answers)
- Questions should match real search queries doctors type"""

    response = client.chat.completions.create(
        model=FAST_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.3,
    )

    data = json.loads(response.choices[0].message.content)

    # Build TwitterCard if the model produced one; otherwise leave None.
    tw_raw = data.get("twitter_card") or {}
    twitter_card: TwitterCard | None = None
    if tw_raw.get("title") and tw_raw.get("description"):
        twitter_card = TwitterCard(
            title=tw_raw["title"][:70],
            description=tw_raw["description"][:200],
            image=tw_raw.get("image") or image_url or None,
        )

    keywords_raw = data.get("keywords", [])
    if not isinstance(keywords_raw, list):
        keywords_raw = []
    # Clamp to 5–8 strings, de-dup case-insensitively.
    seen: set[str] = set()
    keywords: list[str] = []
    for k in keywords_raw:
        if not isinstance(k, str):
            continue
        clean = k.strip()
        low = clean.lower()
        if clean and low not in seen:
            seen.add(low)
            keywords.append(clean)
        if len(keywords) >= 8:
            break

    # ── M6.5 schema fields ────────────────────────────────────────────────────
    reviewed_by = _build_reviewed_by()
    citation = _build_citation(sources or [])
    publication_type = _build_publication_type(content_type)
    speakable = _build_speakable(content_type)

    seo = SEOMetadata(
        slug=slug,
        meta_title=data["meta_title"][:60],
        meta_description=data["meta_description"][:155],
        focus_keyword=data["focus_keyword"],
        og_image_alt=data.get("og_image_alt", post.title)[:125],
        reading_time_minutes=reading_time,
        keywords=keywords,
        twitter_card=twitter_card,
        faq_json_ld=data["faq_json_ld"],
        medical_webpage_schema=data["medical_webpage_schema"],
        reviewed_by=reviewed_by,
        citation=citation,
        publication_type=publication_type,
        speakable=speakable,
    )

    print(f"  [SEO] Slug: /blog/{seo.slug}")
    print(f"  [SEO] Meta title ({len(seo.meta_title)} chars): {seo.meta_title}")
    print(f"  [SEO] Keywords ({len(seo.keywords)}): {', '.join(seo.keywords[:5])}…")
    print(f"  [SEO] Reading time: {seo.reading_time_minutes} min")
    return seo
