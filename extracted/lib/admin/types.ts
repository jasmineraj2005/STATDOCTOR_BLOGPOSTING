/**
 * Mirrors backend/models.py:FinalPost. Keep field names in sync — the JSON
 * file on disk is the contract between the Python pipeline and this admin.
 */

export type PostStatus = "pending_review" | "approved" | "rejected" | "published";

export type RejectionCode =
  | "off_brand_voice"
  | "weak_sources"
  | "wrong_angle"
  | "too_promotional"
  | "ahpra_disagree"
  | "topic_uninteresting"
  | "other";

export type ContentType = "news" | "guide" | "company";

export type AHPRAFlag = {
  flag_type: string;
  excerpt: string;
  fix_applied: string;
  requires_human_review: boolean;
};

export type Source = {
  title: string;
  url: string;
  publisher: string;
  snippet: string;
};

export type TwitterCard = {
  title: string;
  description: string;
  image?: string | null;
};

export type RejectionEntry = {
  ts: string;
  code: RejectionCode;
  text: string;
};

export type Post = {
  title: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  focus_keyword: string;
  og_image_alt: string;
  content_markdown: string;
  tldr: string;
  pillar: string;
  content_type: ContentType;
  target_keywords: string[];
  keywords?: string[];
  twitter_card?: TwitterCard;
  word_count: number;
  reading_time_minutes: number;
  sources: Source[];
  image_url: string | null;
  image_credit: string | null;
  faq_json_ld: Record<string, unknown>;
  medical_webpage_schema: Record<string, unknown>;
  ahpra_flags: AHPRAFlag[];
  ahpra_passed: boolean;
  status: PostStatus;
  last_reviewed_at?: string | null;
  rejection_history?: RejectionEntry[];
  generated_at: string;
  dateModified?: string;
};

/** File on disk (filename + timestamp + post). */
export type PostFile = {
  filename: string; // e.g. "20260411_131738_how-will-medicare-reforms-impact-locum-doctors-in-.json"
  filepath: string; // absolute path
  ts: string; // YYYYMMDD_HHMMSS prefix
  post: Post;
};

export const PILLAR_LABELS: Record<string, string> = {
  locum_pay_rates: "Locum Pay & Rates",
  how_to_locum: "Getting Started",
  locum_by_location: "Locum by Location",
  industry_news: "Industry News",
  locum_vs_agency: "Marketplace vs Agency",
  doctor_wellbeing: "Doctor Wellbeing",
  company_pov: "Inside StatDoctor",
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  news: "News",
  guide: "Guide",
  company: "Inside StatDoctor",
};

export const REJECTION_LABELS: Record<RejectionCode, string> = {
  off_brand_voice: "Off-brand voice",
  weak_sources: "Weak sources / not enough .gov.au",
  wrong_angle: "Wrong angle / not what we'd say",
  too_promotional: "Too promotional / breaks honest-marketplace rule",
  ahpra_disagree: "AHPRA flag I disagree with",
  topic_uninteresting: "Topic isn't interesting",
  other: "Other",
};

/** Government / peer-reviewed authoritative domains, used by the source check. */
export const AUTHORITATIVE_DOMAINS = [
  "aihw.gov.au",
  "abs.gov.au",
  "health.gov.au",
  "racgp.org.au",
  "ama.com.au",
  "ahpra.gov.au",
  "medicalboard.gov.au",
  "rcna.org.nz",
  "health.govt.nz",
  "rnzcgp.org.nz",
  "who.int",
  "ncbi.nlm.nih.gov",
  "nature.com",
  "thelancet.com",
  "mja.com.au",
  "bmj.com",
];

/** Per-content_type word-count floors. Soft warning, not a hard block. */
export const WORD_FLOORS: Record<ContentType, number> = {
  news: 1500,
  guide: 1500,
  company: 1000,
};

/** Per-content_type callout-count floors. */
export const CALLOUT_FLOORS: Record<ContentType, number> = {
  news: 3,
  guide: 4,
  company: 3,
};
