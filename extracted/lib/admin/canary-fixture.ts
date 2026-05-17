import type { Post, PostFile } from "./types";

/**
 * Fail-Agent Layer D — synthetic canary post fixture.
 *
 * Walks the full ingest gate + AHPRA + URL whitelist + word floor checks.
 * Slug prefix `__canary-` is filtered from the public queue views.
 */
const CANARY_SOURCES = [
  {
    url: "https://www.ahpra.gov.au/Registration.aspx",
    title: "AHPRA Registration",
    publisher: "AHPRA",
    snippet: "Registration standards for health practitioners in Australia.",
  },
  {
    url: "https://www.health.gov.au/topics/health-workforce",
    title: "Health Workforce",
    publisher: "Department of Health",
    snippet: "Workforce planning and policy.",
  },
  {
    url: "https://www.racgp.org.au/",
    title: "Royal Australian College of General Practitioners",
    publisher: "RACGP",
    snippet: "Peak body for GPs.",
  },
  {
    url: "https://www.ama.com.au/",
    title: "Australian Medical Association",
    publisher: "AMA",
    snippet: "National peak body representing registered doctors.",
  },
  {
    url: "https://www.aihw.gov.au/",
    title: "Australian Institute of Health and Welfare",
    publisher: "AIHW",
    snippet: "Health and welfare statistics for Australia.",
  },
];

function fillerBody(): { markdown: string; wordCount: number } {
  const paragraph =
    "Locum doctors in Australia operate under AHPRA registration and are bound by professional standards. " +
    "The locum workforce supports rural and remote hospitals, regional general practice, and emergency departments. " +
    "Workforce data published by AIHW shows steady growth in non-permanent medical staffing across the country. ";
  const markdown = (paragraph + "\n\n").repeat(40);
  return { markdown, wordCount: markdown.split(/\s+/).filter(Boolean).length };
}

export function canarySlug(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.T]/g, "").slice(0, 14);
  return `__canary-${stamp}`;
}

export function buildCanaryPost(now: Date): Post {
  const slug = canarySlug(now);
  const { markdown, wordCount } = fillerBody();
  const iso = now.toISOString();
  return {
    title: `Canary — ${iso}`,
    slug,
    meta_title: "Canary article — system health check",
    meta_description:
      "Synthetic canary article generated daily for system health verification.",
    focus_keyword: "system health",
    og_image_alt: "Canary system health check",
    content_markdown: markdown,
    tldr: "Synthetic canary for the StatDoctor pipeline self-test.",
    pillar: "locum_systems",
    content_type: "guide",
    target_keywords: ["system", "canary"],
    word_count: wordCount,
    reading_time_minutes: 5,
    sources: CANARY_SOURCES,
    image_url: null,
    image_credit: null,
    faq_json_ld: {},
    medical_webpage_schema: {},
    ahpra_flags: [],
    ahpra_passed: true,
    status: "pending_review",
    generated_at: iso,
    dateModified: iso,
  } as Post;
}

export function buildCanaryFile(now: Date): PostFile {
  const post = buildCanaryPost(now);
  return {
    filename: `${post.slug}.json`,
    filepath: "",
    ts: now.toISOString().replace(/[-:.T]/g, "").slice(0, 15),
    post,
  };
}
