"""
Webflow → FinalPost migration.

Reads the Webflow Blog Posts dump at output/_webflow_dump.json, converts each
published HTML post to a FinalPost JSON in the same shape the AI pipeline
produces, and writes it to output/{YYYYMMDD_HHMMSS}_{slug}.json (+ .md).

Two passes per post:
  1) Mechanical — HTML → Markdown + meta/refs mapped from Webflow fieldData
  2) LLM rewrite — restructure into the SEO blog format (TL;DR, callouts,
     question H2s, FAQ, sources block) per blog.md voice rules

Usage:
    cd backend
    source venv/bin/activate
    python migrate_webflow.py --limit 1                  # one post, smoke test
    python migrate_webflow.py --slug 5-benefits-of-locum-work-beyond-money
    python migrate_webflow.py --all                      # all 33 published
    python migrate_webflow.py --all --mechanical-only    # skip LLM pass
    python migrate_webflow.py --all --push               # also POST /api/admin/ingest
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import httpx

sys.path.insert(0, os.path.dirname(__file__))

from openai import OpenAI

from config import OPENAI_API_KEY, OUTPUT_DIR, UNSPLASH_ACCESS_KEY, WRITER_MODEL
from models import (
    AHPRAFlag,
    ContentPillar,
    ContentType,
    FinalPost,
    Source,
)

UNSPLASH_BASE = "https://api.unsplash.com/search/photos"
USED_IMAGES_LOG = OUTPUT_DIR / "used_images.json"


# ── Webflow ref maps (resolved earlier from Webflow CMS) ──────────────────────
_CATEGORY_BY_ID = {
    "68e35c8605bd3ca3978ccc99": "health",
    "68e4b097f65f6d07c50e5a36": "startups",
}
_AUTHOR_BY_ID = {
    "68e360c1b6fe0fae2425baeb": "Anu Ganugapati",
    "68e38d1fa2d6bda6231599cc": "StatDoctor",
}
_TAG_BY_ID = {
    "68e4e878a5f9a6757115dd28": "locum",
    "68e4e86e32b26df83ccb5a14": "medicine",
    "68e4e7526ae55881cec8f0ca": "tips",
}

# Slug fragment → pillar. Falls back to PAY_RATES (most common in source set).
_PILLAR_RULES: list[tuple[re.Pattern[str], ContentPillar]] = [
    (re.compile(r"\b(pay|rate|salary|income|tax|abn|super|fbt|hecs)\b", re.I), ContentPillar.PAY_RATES),
    (re.compile(r"\b(victoria|nsw|queensland|sa|western|tasmania|wa|qld|rural)\b", re.I), ContentPillar.LOCATION),
    (re.compile(r"\b(how[- ]to|start|step|guide|register|cpd|provider[- ]number|reference|insurance)\b", re.I), ContentPillar.HOW_TO),
    (re.compile(r"\b(burnout|mental[- ]health|wellbeing|balance)\b", re.I), ContentPillar.WELLBEING),
    (re.compile(r"\b(agency|cost|statdoctor|marketplace|difference)\b", re.I), ContentPillar.VS_AGENCY),
    (re.compile(r"\b(news|reform|medicare|policy|shortage|bulk[- ]billing|strike|election)\b", re.I), ContentPillar.NEWS),
]


def _pillar_for(slug: str, title: str) -> ContentPillar:
    haystack = f"{slug} {title}"
    for pattern, pillar in _PILLAR_RULES:
        if pattern.search(haystack):
            return pillar
    return ContentPillar.PAY_RATES


def _content_type_for(pillar: ContentPillar) -> ContentType:
    if pillar == ContentPillar.NEWS:
        return ContentType.NEWS
    if pillar == ContentPillar.COMPANY:
        return ContentType.COMPANY
    return ContentType.GUIDE


# ── HTML → Markdown (minimal, dependency-free) ────────────────────────────────


class _HTMLToMarkdown(HTMLParser):
    """Just enough HTML→Markdown for Webflow's RichText output.

    Handles: p, h1-h6, strong/b, em/i, a, ul/ol/li, br, img, blockquote,
    code/pre, hr, figure/figcaption. Unknown tags are dropped, their text
    kept. Output is normalised to single blank lines between blocks.
    """

    BLOCK = {"p", "div", "section", "article", "blockquote", "pre", "ul", "ol",
             "li", "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6",
             "hr", "br"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.list_stack: list[tuple[str, int]] = []  # ("ul"|"ol", counter)
        self.link_href: str | None = None
        self.in_code = False
        self.in_pre = False

    # ── helpers ──────────────────────────────────────────────────────────
    def _write(self, s: str) -> None:
        self.parts.append(s)

    def _attr(self, attrs: list[tuple[str, str | None]], name: str) -> str:
        for k, v in attrs:
            if k == name and v is not None:
                return v
        return ""

    # ── tags ─────────────────────────────────────────────────────────────
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("strong", "b"):
            self._write("**")
        elif tag in ("em", "i"):
            self._write("*")
        elif tag == "a":
            self.link_href = self._attr(attrs, "href")
            self._write("[")
        elif tag == "code":
            self.in_code = True
            if not self.in_pre:
                self._write("`")
        elif tag == "pre":
            self.in_pre = True
            self._write("\n\n```\n")
        elif tag == "br":
            self._write("  \n")
        elif tag == "hr":
            self._write("\n\n---\n\n")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._write("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "p":
            self._write("\n\n")
        elif tag == "blockquote":
            self._write("\n\n> ")
        elif tag == "ul":
            self.list_stack.append(("ul", 0))
            self._write("\n\n")
        elif tag == "ol":
            self.list_stack.append(("ol", 0))
            self._write("\n\n")
        elif tag == "li" and self.list_stack:
            kind, n = self.list_stack[-1]
            n += 1
            self.list_stack[-1] = (kind, n)
            indent = "  " * (len(self.list_stack) - 1)
            marker = "- " if kind == "ul" else f"{n}. "
            self._write(f"\n{indent}{marker}")
        elif tag == "img":
            src = self._attr(attrs, "src")
            alt = self._attr(attrs, "alt") or ""
            if src:
                self._write(f"\n\n![{alt}]({src})\n\n")
        elif tag == "figure":
            self._write("\n\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("strong", "b"):
            self._write("**")
        elif tag in ("em", "i"):
            self._write("*")
        elif tag == "a" and self.link_href is not None:
            self._write(f"]({self.link_href})")
            self.link_href = None
        elif tag == "code":
            self.in_code = False
            if not self.in_pre:
                self._write("`")
        elif tag == "pre":
            self.in_pre = False
            self._write("\n```\n\n")
        elif tag in ("ul", "ol") and self.list_stack:
            self.list_stack.pop()
            self._write("\n")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote"):
            self._write("\n")

    def handle_data(self, data: str) -> None:
        if self.in_pre:
            self._write(data)
            return
        # Collapse whitespace inside text nodes but preserve content
        self._write(re.sub(r"[ \t]+", " ", data))

    def result(self) -> str:
        text = "".join(self.parts)
        # Tighten 3+ newlines to exactly 2
        text = re.sub(r"\n{3,}", "\n\n", text)
        # Drop leading/trailing whitespace
        return text.strip()


def html_to_markdown(html: str) -> str:
    if not html:
        return ""
    p = _HTMLToMarkdown()
    p.feed(html)
    return p.result()


# ── Unsplash image fetcher ────────────────────────────────────────────────────


def _load_used_images() -> set[str]:
    if USED_IMAGES_LOG.exists():
        try:
            return set(json.loads(USED_IMAGES_LOG.read_text()))
        except Exception:
            return set()
    return set()


def _save_used_image(image_id: str) -> None:
    used = _load_used_images()
    used.add(image_id)
    USED_IMAGES_LOG.write_text(json.dumps(list(used)))


def _fetch_unsplash_image(
    query: str, *, exclude_ids: set[str] | None = None, strict_unique: bool = True
) -> tuple[str | None, str | None, str | None, str | None]:
    """Returns (url, credit_string, description, photo_id).

    Tracks `output/used_images.json` to avoid re-using a photo across runs and
    honours `exclude_ids` to avoid duplicates within a single post.

    - strict_unique=True (default): return None if every result is already used.
      Right for inline images where a duplicate is worse than a missing image.
    - strict_unique=False: fall back to a random result if every result is
      already used. Right for the hero — every post must have a hero.
    """
    if not UNSPLASH_ACCESS_KEY:
        return None, None, None, None
    used_ids = _load_used_images() | (exclude_ids or set())
    params = {
        "query": query,
        "per_page": 20,
        "orientation": "landscape",
        "client_id": UNSPLASH_ACCESS_KEY,
    }
    try:
        r = httpx.get(UNSPLASH_BASE, params=params, timeout=10)
        r.raise_for_status()
        results = r.json().get("results", [])
        random.shuffle(results)
        chosen = next((p for p in results if p["id"] not in used_ids), None)
        if chosen is None and not strict_unique and results:
            chosen = random.choice(results)
        if chosen:
            _save_used_image(chosen["id"])
            url = chosen["urls"]["regular"]
            credit = f"Photo by {chosen['user']['name']} on Unsplash"
            description = chosen.get("description") or chosen.get("alt_description") or query
            return url, credit, description, chosen["id"]
    except Exception as e:
        print(f"  [Unsplash] error: {e}")
    return None, None, None, None


def _image_query_for(title: str, pillar: ContentPillar) -> str:
    """Build a generic-but-relevant Unsplash query from the title."""
    base = title.split(":", 1)[0]
    base = re.sub(r"[^\w\s]", " ", base)
    keywords = " ".join(base.split()[:5])
    suffix = {
        ContentPillar.PAY_RATES: "Australian hospital doctor",
        ContentPillar.HOW_TO: "doctor stethoscope clinic Australia",
        ContentPillar.LOCATION: "Australia city skyline hospital",
        ContentPillar.NEWS: "Australian medical news",
        ContentPillar.VS_AGENCY: "doctor business meeting",
        ContentPillar.WELLBEING: "doctor coffee break wellness",
        ContentPillar.COMPANY: "medical team collaboration",
    }.get(pillar, "Australian medical")
    return f"{keywords} {suffix}"


def _embed_inline_images(md: str, images: list[tuple[str, str]]) -> str:
    """Embed inline images before the 4th and 6th H2 sections.

    images is a list of (url, alt) tuples, max 2. We insert bottom-up so the
    earlier insertion doesn't shift the index of the later one.
    """
    if not images:
        return md
    lines = md.split("\n")
    h2_indices = [i for i, ln in enumerate(lines) if ln.startswith("## ")]
    slots: list[int] = []
    if len(h2_indices) >= 4:
        slots.append(h2_indices[3])
    if len(h2_indices) >= 6 and len(images) > 1:
        slots.append(h2_indices[5])
    # Walk bottom-up so earlier indices stay valid after we insert
    for slot, (url, alt) in reversed(list(zip(slots, images))):
        lines.insert(slot, f"![{alt}]({url})\n")
    return "\n".join(lines)


# ── Sources from inline links ─────────────────────────────────────────────────


_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")


def _extract_inline_sources(md: str) -> list[Source]:
    """Pull (anchor, url) pairs out of the markdown body and synthesise Source
    rows. Publisher = url host. Snippet = anchor text. The /api/admin/ingest
    whitelist gate then filters off-list domains."""
    seen: set[str] = set()
    sources: list[Source] = []
    for anchor, url in _LINK_RE.findall(md):
        # Skip the marketplace self-link — that's a CTA, not a source.
        if "statdoctor.app" in url:
            continue
        key = url.split("#", 1)[0]
        if key in seen:
            continue
        seen.add(key)
        host = re.sub(r"^https?://(www\.)?", "", url).split("/", 1)[0]
        sources.append(
            Source(
                title=anchor.strip()[:200] or host,
                url=url,
                publisher=host,
                snippet=anchor.strip()[:240] or "",
            )
        )
    return sources


# ── FAQ JSON-LD scaffold ──────────────────────────────────────────────────────


_FAQ_QA_RE = re.compile(r"\*\*Q:\s*(.+?)\*\*\s*\n+\s*(?:A:\s*)?(.+?)(?=\n\s*\*\*Q:|\n*##|$)", re.S | re.I)


def _faq_json_ld_from_markdown(md: str) -> dict:
    qas = []
    for m in _FAQ_QA_RE.finditer(md):
        question = m.group(1).strip()
        answer = re.sub(r"\s+", " ", m.group(2)).strip()
        if question and answer:
            qas.append(
                {
                    "@type": "Question",
                    "name": question,
                    "acceptedAnswer": {"@type": "Answer", "text": answer},
                }
            )
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": qas}


# ── LLM reformat pass ─────────────────────────────────────────────────────────


_REFORMAT_SYSTEM = """You are the StatDoctor editorial agent. You rewrite an existing blog post into the StatDoctor SEO format used at https://statdoctor.app.

Voice: Australian English. Doctor-first (readers are clinicians). Honest about the marketplace. No banned phrases (best, number one, #1, guaranteed, leading, world-class, cure, miracle, robust, groundbreaking, comprehensive, delve). Currency as "A$" not bare "$". Absolute dates only.

Output a single Markdown document with this exact structure:

# {Title}
*[N min read  |  {Pillar Label}  |  {Month Year}]*

---

**TL;DR:** One paragraph (3-5 sentences) directly answering the title. End with a cited source link in `[Publisher Name](https://...)` format.

---

> [KEY FACTS]
> - Concrete, plain-language fact (no leading bold label — just the fact)
> - Concrete, plain-language fact
> - Concrete, plain-language fact

## {Question H2} (question phrasing, matches People-Also-Ask)

3-5 paragraphs. Cite at least one source per H2 using full publisher names as anchor text — never `[source]` or `[here]`. Example: `[AHPRA registration requirements](https://www.ahpra.gov.au/...)`.

> [BIG STAT] **A$X,XXX/day** description — Publisher (Year)

## {Question H2}

3-5 paragraphs. Inline cites.

> [INSIGHT: 💡 | Smart Tip | one sentence of actionable advice goes here.]

**INSIGHT format is strict** — the line must be exactly `> [INSIGHT: <emoji> | <Title 2-4 words> | <one sentence>]` with the closing `]` AFTER the description, three pipe-separated parts inside one set of brackets. Anything else renders as an empty card.

## What does this mean for locum doctors in {State}?

3-5 paragraphs grounding the topic in one Australian state.

> [KEY TAKEAWAY] one-sentence summary of the section.

## Frequently Asked Questions

**Q: ...?**
A: 2-4 sentence answer.

**Q: ...?**
A: 2-4 sentence answer.

(6+ Q&A pairs total. Answers ≥ 60 words each.)

Close with one short paragraph mentioning StatDoctor by name with a link to https://statdoctor.app.

> **Disclaimer:** This content is for general information purposes only and does not constitute medical, legal, or financial advice. Always consult a qualified professional for advice specific to your situation.

> **Note on pay rates:** Figures mentioned are indicative only and vary by location, specialty, employer, and individual enterprise agreement.

## Sources

1. [Source title](url) — Publisher
2. ...

Hard rules:
- Total length: 1500–2500 words (this is enforced by validators — under 1500 is rejected).
- At least 4 callout blocks total (KEY FACTS, BIG STAT, INSIGHT, KEY TAKEAWAY, INFO, or PRO TIP).
- Every H2 must be a question.
- Preserve all factual claims, statistics, and source URLs from the input. You may rewrite, restructure, expand, and improve flow but never invent new statistics.
- Output Markdown only — no preamble, no JSON, no code fences around the whole document."""


_REFORMAT_USER_TMPL = """Rewrite the following blog post into the StatDoctor SEO format.

TITLE: {title}
PILLAR: {pillar_label}
TODAY: {today}

EXISTING SUMMARY:
{summary}

EXISTING BODY (markdown — preserve facts and source URLs but improve structure):

{body}
"""


def llm_reformat(*, title: str, summary: str, body_md: str, pillar: ContentPillar, client: OpenAI) -> str:
    today = datetime.utcnow().strftime("%B %Y")
    pillar_label = {
        ContentPillar.PAY_RATES: "Locum Pay & Rates",
        ContentPillar.HOW_TO: "Getting Started",
        ContentPillar.LOCATION: "Locum by Location",
        ContentPillar.NEWS: "Industry News",
        ContentPillar.VS_AGENCY: "Marketplace vs Agency",
        ContentPillar.WELLBEING: "Doctor Wellbeing",
        ContentPillar.COMPANY: "Inside StatDoctor",
    }[pillar]

    user = _REFORMAT_USER_TMPL.format(
        title=title, pillar_label=pillar_label, today=today,
        summary=summary or "(none)", body=body_md,
    )

    resp = client.chat.completions.create(
        model=WRITER_MODEL,
        messages=[
            {"role": "system", "content": _REFORMAT_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.4,
    )
    return resp.choices[0].message.content.strip()


# ── Final assembly ────────────────────────────────────────────────────────────


def _slug_to_title_keyword(slug: str, title: str) -> str:
    """Cheap focus keyword: first 4 meaningful words of the slug."""
    words = [w for w in slug.split("-") if w and w not in {"the", "a", "an", "and", "of", "for", "in", "to", "is", "are", "with"}]
    return " ".join(words[:4]) or title.split(":", 1)[0].strip().lower()


def _read_unsplash_image(field: dict | None) -> tuple[str | None, str | None]:
    if not field:
        return None, None
    url = field.get("url")
    alt = field.get("alt") or None
    return url, alt


def build_final_post(
    *,
    item: dict,
    content_markdown: str,
    hero_image: tuple[str | None, str | None, str | None] | None = None,
) -> FinalPost:
    fd = item["fieldData"]
    title = (fd.get("name") or "").strip()
    slug = (fd.get("slug") or "").strip()
    summary = (fd.get("post-summary") or "").strip()
    pillar = _pillar_for(slug, title)
    content_type = _content_type_for(pillar)
    # Prefer Webflow's original main-image; fall back to fetched Unsplash hero.
    image_url, image_alt = _read_unsplash_image(fd.get("main-image"))
    image_credit: str | None = None
    if not image_url and hero_image:
        image_url, image_credit, image_desc = hero_image
        image_alt = image_alt or image_desc
    author_name = _AUTHOR_BY_ID.get(fd.get("author") or "", "StatDoctor")

    sources = _extract_inline_sources(content_markdown)
    faq_ld = _faq_json_ld_from_markdown(content_markdown)
    words = len(re.findall(r"\b\w+\b", content_markdown))
    reading = max(1, round(words / 230))

    meta_title = title if len(title) <= 60 else (title[:57].rstrip() + "...")
    meta_desc = summary if 0 < len(summary) <= 155 else (summary[:152].rstrip() + "..." if summary else f"{title} — practical guidance for locum doctors in Australia.")
    focus_kw = _slug_to_title_keyword(slug, title)

    medical_schema = {
        "@context": "https://schema.org",
        "@type": "MedicalWebPage",
        "headline": title,
        "description": meta_desc,
        "author": {"@type": "Person", "name": author_name},
        "datePublished": (item.get("lastPublished") or datetime.utcnow().isoformat()),
        "publisher": {"@type": "Organization", "name": "StatDoctor", "url": "https://statdoctor.app"},
    }

    published_iso = item.get("lastPublished") or datetime.utcnow().isoformat()
    try:
        generated_at = datetime.fromisoformat(published_iso.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
    except ValueError:
        generated_at = datetime.utcnow()

    return FinalPost(
        title=title,
        slug=slug,
        meta_title=meta_title,
        meta_description=meta_desc,
        focus_keyword=focus_kw,
        og_image_alt=image_alt or f"{title} — StatDoctor",
        content_markdown=content_markdown,
        tldr=summary or "",
        pillar=pillar,
        content_type=content_type,
        target_keywords=[focus_kw],
        keywords=[focus_kw, "locum doctor", "australia"],
        word_count=words,
        reading_time_minutes=reading,
        sources=sources,
        image_url=image_url,
        image_credit=image_credit,
        faq_json_ld=faq_ld,
        medical_webpage_schema=medical_schema,
        ahpra_flags=[
            AHPRAFlag(
                flag_type="migrated_content",
                excerpt="Imported from Webflow — please re-check banned phrases & disclaimers.",
                fix_applied="manual_review_required",
                requires_human_review=True,
            )
        ],
        ahpra_passed=False,
        status="pending_review",
        generated_at=generated_at,
        dateModified=generated_at,
    )


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace('"', '\\"')


def write_post_files(post: FinalPost) -> tuple[Path, Path]:
    ts = post.generated_at.strftime("%Y%m%d_%H%M%S")
    base = f"{ts}_{post.slug[:50]}"
    json_path = OUTPUT_DIR / f"{base}.json"
    md_path = OUTPUT_DIR / f"{base}.md"
    json_path.write_text(json.dumps(post.model_dump(mode="json"), indent=2, default=str))
    frontmatter = (
        "---\n"
        f"title: \"{_esc(post.title)}\"\n"
        f"slug: \"{post.slug}\"\n"
        f"meta_title: \"{_esc(post.meta_title)}\"\n"
        f"meta_description: \"{_esc(post.meta_description)}\"\n"
        f"focus_keyword: \"{_esc(post.focus_keyword)}\"\n"
        f"pillar: \"{post.pillar.value}\"\n"
        f"content_type: \"{post.content_type.value}\"\n"
        f"status: \"{post.status}\"\n"
        f"reading_time_minutes: {post.reading_time_minutes}\n"
        f"word_count: {post.word_count}\n"
        f"image_url: \"{post.image_url or ''}\"\n"
        f"image_credit: \"{_esc(post.image_credit or '')}\"\n"
        f"og_image_alt: \"{_esc(post.og_image_alt)}\"\n"
        f"generated_at: \"{post.generated_at.isoformat()}\"\n"
        f"dateModified: \"{post.dateModified.isoformat()}\"\n"
        "---\n\n"
    )
    md_path.write_text(frontmatter + post.content_markdown + "\n")
    return json_path, md_path


def push_to_dashboard(post: FinalPost, filename: str) -> int | None:
    url = os.environ.get("INGEST_URL")
    token = os.environ.get("INGEST_TOKEN")
    if not url or not token:
        return None
    payload = {"filename": filename, "post": post.model_dump(mode="json")}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, default=str).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.getcode()
    except urllib.error.HTTPError as e:
        print(f"  ⚠  ingest HTTP {e.code} {e.reason}: {e.read().decode()[:300]}")
        return e.code


# ── main ──────────────────────────────────────────────────────────────────────


def load_published_items(dump_path: Path) -> list[dict]:
    items = json.loads(dump_path.read_text())
    return [it for it in items if not it.get("isDraft") and not it.get("isArchived")]


def migrate_one(
    item: dict, *, mechanical_only: bool, with_images: bool, client: OpenAI | None
) -> FinalPost:
    fd = item["fieldData"]
    title = fd.get("name") or ""
    slug = fd.get("slug") or ""
    summary = fd.get("post-summary") or ""
    html_body = fd.get("post-body") or ""

    body_md = html_to_markdown(html_body)
    if not body_md and summary:
        body_md = summary  # very short posts (e.g. "testing") still need a body

    pillar = _pillar_for(slug, title)

    if not mechanical_only and client is not None and len(body_md) > 200:
        print(f"  · LLM reformat ({len(body_md):,} chars → SEO format)…")
        body_md = llm_reformat(
            title=title, summary=summary, body_md=body_md, pillar=pillar, client=client
        )

    hero: tuple[str | None, str | None, str | None] | None = None
    if with_images and UNSPLASH_ACCESS_KEY and not fd.get("main-image"):
        q = _image_query_for(title, pillar)
        print(f"  · Unsplash hero  ({q!r})")
        url, credit, desc, photo_id = _fetch_unsplash_image(q, strict_unique=False)
        if url:
            hero = (url, credit, desc)

        post_used: set[str] = {photo_id} if photo_id else set()

        # Use deliberately different queries so Unsplash returns a different
        # result set (varying just one word usually surfaces the same photos).
        inline_queries = [
            "Australian doctor patient consultation",
            "hospital corridor Australia healthcare",
        ]
        inline: list[tuple[str, str]] = []
        for variant in inline_queries:
            u2, _c2, d2, pid2 = _fetch_unsplash_image(variant, exclude_ids=post_used)
            if u2:
                inline.append((u2, d2 or "Locum doctors at work in Australia"))
                if pid2:
                    post_used.add(pid2)
        if inline:
            body_md = _embed_inline_images(body_md, inline)

    return build_final_post(item=item, content_markdown=body_md, hero_image=hero)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", default=str(OUTPUT_DIR / "_webflow_dump.json"))
    ap.add_argument("--slug", help="Migrate only this Webflow slug")
    ap.add_argument("--limit", type=int, help="Migrate at most N posts")
    ap.add_argument("--all", action="store_true", help="Migrate all published posts")
    ap.add_argument("--mechanical-only", action="store_true", help="Skip the LLM reformat pass")
    ap.add_argument("--no-images", action="store_true", help="Skip Unsplash image fetch")
    ap.add_argument("--push", action="store_true", help="POST each post to /api/admin/ingest (needs INGEST_URL/INGEST_TOKEN)")
    ap.add_argument(
        "--push-website",
        nargs="?",
        const=str(Path.home() / "website" / "content" / "posts"),
        help="Also copy each post JSON into the frontend repo's content/posts/ "
        "directory (default: ~/website/content/posts). After running, "
        "git commit + push that repo to ship the posts to statdoctor-frontend.vercel.app.",
    )
    args = ap.parse_args()

    if not (args.slug or args.limit or args.all):
        ap.error("Pick one of --slug, --limit N, or --all")

    items = load_published_items(Path(args.dump))
    if args.slug:
        items = [it for it in items if it["fieldData"].get("slug") == args.slug]
        if not items:
            sys.exit(f"No published item with slug={args.slug}")
    if args.limit:
        items = items[: args.limit]

    client = OpenAI(api_key=OPENAI_API_KEY) if (not args.mechanical_only) else None

    print(f"Migrating {len(items)} post(s) → {OUTPUT_DIR}")
    for idx, item in enumerate(items, 1):
        slug = item["fieldData"].get("slug", "?")
        print(f"\n[{idx}/{len(items)}] {slug}")
        post = migrate_one(
            item,
            mechanical_only=args.mechanical_only,
            with_images=not args.no_images,
            client=client,
        )
        jp, mp = write_post_files(post)
        print(f"  ✓ {jp.name}  ({post.word_count} words, {len(post.sources)} sources)")
        if args.push:
            code = push_to_dashboard(post, jp.name)
            print(f"  → ingest HTTP {code}" if code else "  → push skipped (no INGEST_URL/TOKEN)")
        if args.push_website:
            website_dir = Path(args.push_website)
            website_dir.mkdir(parents=True, exist_ok=True)
            dst = website_dir / jp.name
            dst.write_text(json.dumps(post.model_dump(mode="json"), indent=2, default=str))
            print(f"  → website {dst}")


if __name__ == "__main__":
    main()
