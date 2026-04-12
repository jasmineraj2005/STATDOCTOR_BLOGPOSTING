"""
Agent 5: SEO
Generates:
- URL slug
- Meta title (≤60 chars) and meta description (≤155 chars)
- Focus keyword
- Reading time
- FAQ JSON-LD schema (for Google rich results)
- MedicalWebPage schema (for E-E-A-T signals)
"""

import json
import re
import sys
import os
from datetime import datetime

from openai import OpenAI

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import OPENAI_API_KEY, FAST_MODEL, SITE_URL, SITE_NAME
from models import BlogPost, SEOMetadata, TopicBrief

client = OpenAI(api_key=OPENAI_API_KEY)


def _slugify(title: str) -> str:
    slug = title.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")[:80]


def _reading_time(content: str) -> int:
    """200 wpm — professionals read slightly slower on screen."""
    return max(1, round(len(content.split()) / 200))


def generate_seo(post: BlogPost, topic: TopicBrief) -> SEOMetadata:
    """Generate all SEO metadata for the post."""
    print(f"[SEO] Generating metadata...")

    slug = _slugify(post.title)
    reading_time = _reading_time(post.content_markdown)
    canonical_url = f"{SITE_URL}/blog/{slug}"
    today = datetime.utcnow().strftime("%Y-%m-%d")

    # Extract FAQ block from post for schema generation
    faq_section = ""
    if "## Frequently Asked Questions" in post.content_markdown:
        start = post.content_markdown.index("## Frequently Asked Questions")
        # Take up to next ## or end
        rest = post.content_markdown[start:]
        next_h2 = re.search(r"\n## ", rest[3:])
        faq_section = rest[: next_h2.start() + 3] if next_h2 else rest
    faq_section = faq_section[:2000]  # cap tokens

    prompt = f"""You are an SEO specialist for StatDoctor ({SITE_URL}), Australia's locum doctor marketplace.

Generate SEO metadata for this blog post.

TITLE: {post.title}
PRIMARY KEYWORD: {topic.target_keywords[0]}
SECONDARY KEYWORDS: {", ".join(topic.target_keywords[1:] + topic.secondary_keywords)}
CANONICAL URL: {canonical_url}
TL;DR: {post.tldr}
SITE NAME: {SITE_NAME}
DATE: {today}

FAQ SECTION FROM POST:
{faq_section or "(not yet extracted — infer from title and keywords)"}

Return JSON only:
{{
  "meta_title": "Title under 60 chars — include primary keyword — can include | StatDoctor",
  "meta_description": "Under 155 chars — include keyword, explain value, end with soft CTA",
  "focus_keyword": "exact primary keyword phrase",
  "og_image_alt": "Descriptive alt text for hero image — mention topic and Australia, under 125 chars",
  "faq_json_ld": {{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {{
        "@type": "Question",
        "name": "Question from the FAQ section?",
        "acceptedAnswer": {{
          "@type": "Answer",
          "text": "Concise answer under 200 chars"
        }}
      }}
    ]
  }},
  "medical_webpage_schema": {{
    "@context": "https://schema.org",
    "@type": "MedicalWebPage",
    "name": "{post.title}",
    "url": "{canonical_url}",
    "description": "meta description here",
    "about": {{
      "@type": "Thing",
      "name": "Locum medical practice in Australia and New Zealand"
    }},
    "audience": {{
      "@type": "MedicalAudience",
      "audienceType": "Physicians, medical practitioners, locum doctors"
    }},
    "publisher": {{
      "@type": "Organization",
      "name": "{SITE_NAME}",
      "url": "{SITE_URL}"
    }},
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
        temperature=0.2,
    )

    data = json.loads(response.choices[0].message.content)

    seo = SEOMetadata(
        slug=slug,
        meta_title=data["meta_title"][:60],
        meta_description=data["meta_description"][:155],
        focus_keyword=data["focus_keyword"],
        og_image_alt=data.get("og_image_alt", post.title)[:125],
        reading_time_minutes=reading_time,
        faq_json_ld=data["faq_json_ld"],
        medical_webpage_schema=data["medical_webpage_schema"],
    )

    print(f"  [SEO] Slug: /blog/{seo.slug}")
    print(f"  [SEO] Meta title ({len(seo.meta_title)} chars): {seo.meta_title}")
    print(f"  [SEO] Reading time: {seo.reading_time_minutes} min")
    return seo
