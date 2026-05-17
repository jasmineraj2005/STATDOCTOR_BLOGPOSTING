/**
 * Layer C — server-side ingest hard-gate.
 *
 * Pure function that returns the list of validation failures for an inbound
 * post. The route caller decides what to do (return 422 in strict mode, log
 * + continue in shadow mode) based on env `FAIL_AGENT_INGEST_GATE`.
 *
 * Strict mode is OFF by default to preserve backwards compatibility with
 * legacy pipeline outputs. Flip `FAIL_AGENT_INGEST_GATE=strict` on Vercel
 * after smoke-testing that real pipeline runs satisfy the floors.
 */
import validators from "@/lib/admin/validators.json";

export type IngestablePost = {
  title?: unknown;
  slug?: unknown;
  meta_title?: unknown;
  meta_description?: unknown;
  content_markdown?: unknown;
  content_type?: string;
  pillar?: unknown;
  word_count?: number;
  sources?: unknown[];
  ahpra_flags?: unknown;
};

export type ValidationError = {
  check: "schema" | "word_count" | "source_count";
  detail: string;
};

const REQUIRED_FIELDS: (keyof IngestablePost)[] = [
  "title",
  "slug",
  "meta_title",
  "meta_description",
  "content_markdown",
  "content_type",
  "pillar",
  "sources",
  "ahpra_flags",
];

const MIN_SOURCES = 5;

function wordFloorFor(contentType: string | undefined): number {
  const floors = (validators as { word_floors?: Record<string, number> }).word_floors ?? {};
  return floors[contentType ?? ""] ?? 1000;
}

export function runIngestGate(post: IngestablePost): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = post[field];
    if (value === undefined || value === null) {
      errors.push({ check: "schema", detail: `missing required field: ${String(field)}` });
    }
  }

  const floor = wordFloorFor(post.content_type);
  const wc = typeof post.word_count === "number" ? post.word_count : 0;
  if (wc < floor) {
    errors.push({
      check: "word_count",
      detail: `word_count ${wc} below floor ${floor} for content_type=${post.content_type ?? "unknown"}`,
    });
  }

  const sourceCount = Array.isArray(post.sources) ? post.sources.length : 0;
  if (sourceCount < MIN_SOURCES) {
    errors.push({
      check: "source_count",
      detail: `sources ${sourceCount} below minimum ${MIN_SOURCES}`,
    });
  }

  return errors;
}

export function gateMode(): "strict" | "shadow" {
  return process.env.FAIL_AGENT_INGEST_GATE === "strict" ? "strict" : "shadow";
}
