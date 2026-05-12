import {
  AUTHORITATIVE_DOMAINS,
  CALLOUT_FLOORS,
  WORD_FLOORS,
  type Post,
} from "./types";

export type ValidationStatus = "pass" | "fail" | "warn";

export type ValidationResult = {
  check:
    | "ahpra"
    | "banned_phrases"
    | "anchor_text"
    | "callout_quota"
    | "comparison_table"
    | "schema"
    | "word_count"
    | "sources";
  label: string;
  status: ValidationStatus;
  detail: string;
};

// Mirror of backend/agents/ahpra.py:_FORBIDDEN — keep in sync.
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bbest doctor\b/i, reason: "superlative 'best doctor' — AHPRA s.133(1)(b)" },
  { pattern: /\bnumber[\s-]?one\b/i, reason: "superlative 'number one'" },
  { pattern: /\b#\s?1\b/i, reason: "superlative '#1'" },
  { pattern: /\bleading specialist\b/i, reason: "comparative superlative" },
  { pattern: /\bmost experienced\b/i, reason: "comparative superlative" },
  { pattern: /\bworld[\s-]?class\b/i, reason: "superlative 'world-class'" },
  {
    pattern: /\baustralia'?s? (best|leading|top|premier)\b/i,
    reason: "superlative 'Australia's best/leading/top/premier'",
  },
  {
    pattern: /\bguaranteed? (results?|outcomes?|success)\b/i,
    reason: "outcome guarantee — AHPRA prohibited",
  },
  { pattern: /\bcure[sd]?\b/i, reason: "'cure' — requires evidence; flag for review" },
  { pattern: /\btestimonial/i, reason: "patient testimonial — AHPRA restricted" },
  {
    pattern: /\bendorsement from (a |my )?(patient|client)\b/i,
    reason: "patient endorsement — AHPRA restricted",
  },
];

// Editorially-banned phrases per blog.md "Voice rules".
const EDITORIALLY_BANNED: RegExp[] = [
  /\bcomprehensive\b/i,
  /\bdelve\b/i,
  /\btoday\b/i,
  /\bgroundbreaking\b/i,
  /\brobust\b/i,
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isAuthoritative(host: string): boolean {
  return AUTHORITATIVE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function countCallouts(md: string): number {
  // Callout markers look like `> [TYPE]` or `> [TYPE: anything]`.
  const matches = md.match(/^>\s*\[[A-Z]/gm);
  return matches ? matches.length : 0;
}

function hasMarkdownTable(md: string): boolean {
  // Heuristic: a header row `| ... | ... |` followed by `| --- | --- |`.
  return /\n\|[^\n]+\|\s*\n\|[\s:-]+\|[\s:-|]+\|/.test(md);
}

function findSourceStyleAnchors(md: string): string[] {
  // Look for `[source](...)`, `[link](...)`, `[click here](...)` — all bad anchor text.
  const re = /\[(source|link|click here|here|read more)\]\(/gi;
  const hits = md.match(re);
  return hits ? Array.from(new Set(hits.map((h) => h.toLowerCase()))) : [];
}

export function runValidators(post: Post): ValidationResult[] {
  const results: ValidationResult[] = [];

  // ── AHPRA ──────────────────────────────────────────────────────────────────
  const reviewFlags = post.ahpra_flags.filter((f) => f.requires_human_review);
  results.push({
    check: "ahpra",
    label: "AHPRA compliance",
    status: post.ahpra_passed && reviewFlags.length === 0 ? "pass" : "fail",
    detail:
      reviewFlags.length === 0
        ? "Passed AHPRA scan; no flags require human review."
        : `${reviewFlags.length} flag(s) need review: ${reviewFlags
            .map((f) => f.flag_type)
            .join(", ")}.`,
  });

  // ── Banned phrases (live regex over current markdown) ─────────────────────
  const bannedHits: string[] = [];
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(post.content_markdown)) bannedHits.push(reason);
  }
  const editorialHits: string[] = [];
  for (const re of EDITORIALLY_BANNED) {
    if (re.test(post.content_markdown)) {
      editorialHits.push(re.source.replace(/\\b/g, "").replace(/[/g\\i]/g, ""));
    }
  }
  results.push({
    check: "banned_phrases",
    label: "Banned phrases",
    status: bannedHits.length > 0 ? "fail" : editorialHits.length > 0 ? "warn" : "pass",
    detail:
      bannedHits.length > 0
        ? `AHPRA-banned: ${bannedHits.join("; ")}`
        : editorialHits.length > 0
          ? `Editorial-banned (warning only): ${editorialHits.join(", ")}`
          : "Clean.",
  });

  // ── Anchor text: no `[source](…)` style ────────────────────────────────────
  const badAnchors = findSourceStyleAnchors(post.content_markdown);
  results.push({
    check: "anchor_text",
    label: "Anchor text",
    status: badAnchors.length > 0 ? "fail" : "pass",
    detail:
      badAnchors.length > 0
        ? `Replace generic anchors with entity names: ${badAnchors.join(", ")}`
        : "Anchors use entity names.",
  });

  // ── Callout quota ──────────────────────────────────────────────────────────
  const callouts = countCallouts(post.content_markdown);
  const calloutFloor = CALLOUT_FLOORS[post.content_type] ?? 3;
  results.push({
    check: "callout_quota",
    label: "Callout quota",
    status: callouts >= calloutFloor ? "pass" : "fail",
    detail: `${callouts} callouts (floor for ${post.content_type}: ${calloutFloor}).`,
  });

  // ── Comparison table present ───────────────────────────────────────────────
  const hasTable = hasMarkdownTable(post.content_markdown);
  results.push({
    check: "comparison_table",
    label: "Comparison table",
    status: hasTable ? "pass" : "warn",
    detail: hasTable
      ? "Markdown table present."
      : "No markdown table found — recommended for guides.",
  });

  // ── Schema shape check ────────────────────────────────────────────────────
  const faq = post.faq_json_ld as { "@type"?: string; mainEntity?: unknown[] };
  const faqOk =
    faq?.["@type"] === "FAQPage" &&
    Array.isArray(faq.mainEntity) &&
    faq.mainEntity.length >= 4;
  results.push({
    check: "schema",
    label: "Schema shape",
    status: faqOk ? "pass" : "fail",
    detail: faqOk
      ? "FAQPage has ≥4 questions; MedicalScholarlyArticle is rendered by the website."
      : "FAQPage missing or has fewer than 4 mainEntity questions.",
  });

  // ── Word count vs content-type floor ──────────────────────────────────────
  const floor = WORD_FLOORS[post.content_type] ?? 1500;
  results.push({
    check: "word_count",
    label: "Word count",
    status: post.word_count >= floor ? "pass" : "warn",
    detail: `${post.word_count} words (floor for ${post.content_type}: ${floor}).`,
  });

  // ── Sources: ≥3 distinct publishers, ≥1 government / peer-reviewed ────────
  const hosts = post.sources.map((s) => hostnameOf(s.url)).filter(Boolean);
  const distinctPublishers = new Set(hosts).size;
  const authoritativeCount = hosts.filter(isAuthoritative).length;
  const sourcesOk = distinctPublishers >= 3 && authoritativeCount >= 1;
  results.push({
    check: "sources",
    label: "Sources",
    status: sourcesOk ? "pass" : "fail",
    detail: `${distinctPublishers} distinct publisher(s); ${authoritativeCount} authoritative. Need ≥3 / ≥1.`,
  });

  return results;
}

/** Convenience: are all hard checks (fail-bearing) passing? Warns don't block. */
export function isApprovable(results: ValidationResult[]): boolean {
  return results.every((r) => r.status !== "fail");
}
