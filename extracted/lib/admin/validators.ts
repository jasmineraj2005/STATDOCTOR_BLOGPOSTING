import type { ContentType, Post } from "./types";
import validatorsConfig from "./validators.json";

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

// ── Config (single source of truth — shared with backend/agents/ahpra.py) ─────

type ValidatorsConfig = {
  ahpra_banned: { pattern: string; reason: string }[];
  editorially_banned: { pattern: string; reason: string }[];
  bad_anchor_patterns: string[];
  callout_floors: Record<ContentType, number>;
  word_floors: Record<ContentType, number>;
  word_ceilings: Record<ContentType, number>;
  pay_disclaimer_triggers: string[];
  authoritative_domains: string[];
};

const cfg = validatorsConfig as unknown as ValidatorsConfig;

const FORBIDDEN: { pattern: RegExp; reason: string }[] = cfg.ahpra_banned.map(
  (entry) => ({ pattern: new RegExp(entry.pattern, "i"), reason: entry.reason }),
);

const EDITORIALLY_BANNED: { pattern: RegExp; reason: string }[] =
  cfg.editorially_banned.map((entry) => ({
    pattern: new RegExp(entry.pattern, "i"),
    reason: entry.reason,
  }));

const BAD_ANCHOR_RE = new RegExp(
  `\\[(${cfg.bad_anchor_patterns
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\]\\(`,
  "gi",
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isAuthoritative(host: string): boolean {
  return cfg.authoritative_domains.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}

function countCallouts(md: string): number {
  // Callout markers look like `> [TYPE]` or `> [TYPE: anything]`.
  const matches = md.match(/^>\s*\[[A-Z]/gm);
  return matches ? matches.length : 0;
}

function hasMarkdownTable(md: string): boolean {
  // A header row `| ... | ... |` immediately followed by a delimiter row that
  // contains only `|`, `-`, `:`, and whitespace. Multiline `m` flag so `^/$`
  // anchor per line.
  return /^\|.+\|\s*$\n^\|[\s:|\-]+\|\s*$/m.test(md);
}

function findSourceStyleAnchors(md: string): string[] {
  const hits = md.match(BAD_ANCHOR_RE);
  return hits ? Array.from(new Set(hits.map((h) => h.toLowerCase()))) : [];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function runValidators(post: Post): ValidationResult[] {
  const results: ValidationResult[] = [];

  // AHPRA scan flags from the Python agent.
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

  // Live regex over current markdown — catches edits that re-introduced banned terms.
  const bannedHits: string[] = [];
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(post.content_markdown)) bannedHits.push(reason);
  }
  const editorialHits: string[] = [];
  for (const { pattern, reason } of EDITORIALLY_BANNED) {
    if (pattern.test(post.content_markdown)) editorialHits.push(reason);
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

  const callouts = countCallouts(post.content_markdown);
  const calloutFloor = cfg.callout_floors[post.content_type] ?? 3;
  results.push({
    check: "callout_quota",
    label: "Callout quota",
    status: callouts >= calloutFloor ? "pass" : "fail",
    detail: `${callouts} callouts (floor for ${post.content_type}: ${calloutFloor}).`,
  });

  const hasTable = hasMarkdownTable(post.content_markdown);
  results.push({
    check: "comparison_table",
    label: "Comparison table",
    status: hasTable ? "pass" : "warn",
    detail: hasTable
      ? "Markdown table present."
      : "No markdown table found — recommended for guides.",
  });

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

  const floor = cfg.word_floors[post.content_type] ?? 1500;
  const ceiling = cfg.word_ceilings[post.content_type] ?? 2500;
  const wc = post.word_count;
  let wcStatus: ValidationStatus;
  let wcDetail: string;
  if (wc < floor) {
    wcStatus = "fail";
    wcDetail = `${wc} words — below floor for ${post.content_type} (${floor})`;
  } else if (wc > ceiling) {
    wcStatus = "warn";
    wcDetail = `${wc} words — above ceiling for ${post.content_type} (${ceiling})`;
  } else {
    wcStatus = "pass";
    wcDetail = `${wc} words — within band for ${post.content_type} (${floor}-${ceiling})`;
  }
  results.push({
    check: "word_count",
    label: "Word count",
    status: wcStatus,
    detail: wcDetail,
  });

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
