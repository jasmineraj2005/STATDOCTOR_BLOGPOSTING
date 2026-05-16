from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ContentPillar(str, Enum):
    PAY_RATES = "locum_pay_rates"
    HOW_TO = "how_to_locum"
    LOCATION = "locum_by_location"
    NEWS = "industry_news"
    VS_AGENCY = "locum_vs_agency"
    WELLBEING = "doctor_wellbeing"
    COMPANY = "company_pov"


class ContentType(str, Enum):
    NEWS = "news"
    GUIDE = "guide"
    COMPANY = "company"


PostStatus = Literal["pending_review", "approved", "rejected", "published"]


RejectionCode = Literal[
    "off_brand_voice",
    "weak_sources",
    "wrong_angle",
    "too_promotional",
    "ahpra_disagree",
    "topic_uninteresting",
    "other",
]


PILLAR_DESCRIPTIONS: dict[ContentPillar, str] = {
    ContentPillar.PAY_RATES: (
        "Locum doctor pay rates, hourly rates, daily rates, annual income, and salary benchmarks "
        "across specialties and states. High commercial intent."
    ),
    ContentPillar.HOW_TO: (
        "How to become a locum doctor in Australia/NZ: AHPRA registration, tax setup, "
        "indemnity insurance, first shift checklist, locum vs permanent decision."
    ),
    ContentPillar.LOCATION: (
        "Locum work in specific cities and regions: Sydney, Melbourne, Brisbane, Perth, "
        "Adelaide, Auckland, rural and remote areas, RRMA incentives."
    ),
    ContentPillar.NEWS: (
        "Healthcare industry news: GP shortages, AHPRA policy changes, Medicare reforms, "
        "workforce data, state health funding. News-hook driven, freshness signal."
    ),
    ContentPillar.VS_AGENCY: (
        "Locum marketplace vs traditional agency: fee structures, hidden costs, "
        "buyout clauses, PAYG vs agency, credential management comparison."
    ),
    ContentPillar.WELLBEING: (
        "Doctor burnout, work-life balance, financial independence, part-time medicine, "
        "travel medicine, lifestyle benefits of locuming."
    ),
}


class Source(BaseModel):
    title: str
    url: str
    publisher: str
    snippet: str


class GuardianArticle(BaseModel):
    id: str
    title: str
    url: str
    published: str
    section: str
    body_preview: Optional[str] = None


class TopicBrief(BaseModel):
    title: str
    pillar: ContentPillar
    target_keywords: list[str]
    secondary_keywords: list[str]
    news_hook: Optional[str] = None
    news_hook_url: Optional[str] = None
    rationale: str
    suggested_h2s: list[str]
    suggested_faqs: list[str]


class ResearchBrief(BaseModel):
    topic: TopicBrief
    key_facts: list[str]
    statistics: list[str]  # "Stat figure — Source (Year)"
    sources: list[Source]
    ahpra_context: str
    image_url: Optional[str] = None
    image_credit: Optional[str] = None
    image_description: Optional[str] = None
    chart_url: Optional[str] = None  # Quickchart.io URL built from statistics
    inline_images: list[str] = []  # Additional Unsplash URLs for in-article placement
    # Abort sentinel — set when research could not be completed safely
    aborted: bool = False
    abort_reason: Optional[str] = None  # "too_few_valid_sources" | "budget_exceeded"


class BlogPost(BaseModel):
    title: str
    content_markdown: str
    tldr: str
    word_count: int


class TwitterCard(BaseModel):
    title: str   # ≤ 70 chars
    description: str  # ≤ 200 chars
    image: Optional[str] = None  # absolute URL, ≥ 1200x675 recommended


class SEOMetadata(BaseModel):
    slug: str
    meta_title: str       # max 60 chars
    meta_description: str  # max 155 chars
    focus_keyword: str
    og_image_alt: str
    reading_time_minutes: int
    # Internal JSON field — used by writer/SEO logic.
    # NOTE: do NOT render as <meta name="keywords"> in the frontend;
    # Google has ignored it since 2009 and Bing spam-flags it.
    keywords: list[str] = []
    twitter_card: Optional[TwitterCard] = None
    faq_json_ld: dict
    medical_webpage_schema: dict
    # New M6.5 schema fields — consumed by the website-repo serialiser (M6).
    # reviewed_by: Person reference — Dr Anu is both author and medical reviewer.
    reviewed_by: Optional[dict] = None
    # citation: array of ScholarlyArticle entries built from sources[].
    citation: list[dict] = []
    # publication_type: MeSH-style type string.
    # "Review" for guides, "News Article" for news, omitted for company posts.
    publication_type: Optional[str] = None
    # speakable: SpeakableSpecification — emitted only for news posts.
    speakable: Optional[dict] = None


class AHPRAFlag(BaseModel):
    flag_type: str  # "forbidden_claim" | "missing_disclaimer" | "unsupported_stat"
    excerpt: str
    fix_applied: str
    requires_human_review: bool


class RejectionEntry(BaseModel):
    ts: datetime
    code: RejectionCode
    text: str = ""


class FinalPost(BaseModel):
    title: str
    slug: str
    meta_title: str
    meta_description: str
    focus_keyword: str
    og_image_alt: str
    content_markdown: str
    tldr: str
    pillar: ContentPillar
    content_type: ContentType = ContentType.GUIDE
    target_keywords: list[str]
    keywords: list[str] = []
    twitter_card: Optional[TwitterCard] = None
    word_count: int
    reading_time_minutes: int
    sources: list[Source]
    image_url: Optional[str] = None
    image_credit: Optional[str] = None
    faq_json_ld: dict
    medical_webpage_schema: dict
    # M6.5 schema fields — mirrors SEOMetadata additions.
    reviewed_by: Optional[dict] = None
    citation: list[dict] = []
    publication_type: Optional[str] = None
    speakable: Optional[dict] = None
    ahpra_flags: list[AHPRAFlag]
    ahpra_passed: bool

    # Review lifecycle — set by the factory's /admin/posts approval handler.
    status: PostStatus = "pending_review"
    last_reviewed_at: Optional[datetime] = None
    rejection_history: list[RejectionEntry] = []

    generated_at: datetime = Field(default_factory=datetime.utcnow)
    # `dateModified` is bumped by Approve and quarterly refreshes; initially mirrors generated_at.
    dateModified: datetime = Field(default_factory=datetime.utcnow)
