import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Whitelist loader — walks up from __dirname to find data/url-whitelist.json
// ---------------------------------------------------------------------------

function findWhitelistPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "data", "url-whitelist.json");
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "data/url-whitelist.json not found walking up from " + __dirname
  );
}

const WHITELIST = JSON.parse(readFileSync(findWhitelistPath(), "utf8")) as {
  version: number;
  domains: {
    domain: string;
    tier: string;
    rationale: string;
    added_at: string;
  }[];
};
const WHITELIST_DOMAINS = new Set(
  WHITELIST.domains.map((d) => d.domain.toLowerCase())
);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HeadReason =
  | "ok"
  | "http_404"
  | "http_4xx"
  | "http_5xx"
  | "timeout"
  | "connect_error";

export type HeadResult = {
  url: string;
  ok: boolean;
  status: number | null;
  reason: HeadReason;
  attempts: number;
};

export type HeadOpts = {
  timeoutMs?: number;
  retries?: number;
  fetcher?: typeof fetch;
  sleeper?: (ms: number) => Promise<void>;
};

export type SourceLike = {
  url: string;
  publisher?: string;
  [k: string]: unknown;
};

export type SourceFlag = {
  type: "source_not_in_whitelist" | "source_unreachable";
  url: string;
  publisher?: string;
  reason?: HeadReason;
};

export type ValidationResult = {
  okSources: SourceLike[];
  flags: SourceFlag[];
  totalInput: number;
  totalOk: number;
};

// ---------------------------------------------------------------------------
// isWhitelisted
// ---------------------------------------------------------------------------

/**
 * Return true if url's hostname matches (or is a subdomain of) any
 * whitelisted domain. Case-insensitive. Returns false for unparseable urls.
 * Mirrors Python is_whitelisted().
 */
export function isWhitelisted(url: string): boolean {
  try {
    const parsed = new URL(url);
    let host = parsed.hostname.toLowerCase();
    if (!host) return false;

    // Strip leading www. once
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }

    // Direct match
    if (WHITELIST_DOMAINS.has(host)) return true;

    // Subdomain match: host ends with ".<domain>"
    for (const domain of WHITELIST_DOMAINS) {
      if (host.endsWith("." + domain)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// headCheck
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRIES = 1;

function defaultSleeper(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Issue a HEAD request, retrying on 5xx / 429 / timeout / connect_error.
 * Mirrors Python head_check().
 *
 * - 2xx/3xx → ok=true, reason="ok"
 * - 404 → ok=false, reason="http_404", no retry
 * - other 4xx (not 429) → ok=false, reason="http_4xx", no retry
 * - 5xx or 429 → retry up to `retries`, exponential backoff
 * - Network/timeout error → retry up to `retries`
 */
export async function headCheck(
  url: string,
  opts: HeadOpts = {}
): Promise<HeadResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    fetcher = fetch,
    sleeper = defaultSleeper,
  } = opts;

  const maxAttempts = retries + 1;
  let lastStatus: number | null = null;
  let lastReason: HeadReason = "ok";
  let attempts = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts++;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetcher(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timeoutId);

      lastStatus = resp.status;

      if (lastStatus >= 200 && lastStatus < 400) {
        return {
          url,
          ok: true,
          status: lastStatus,
          reason: "ok",
          attempts,
        };
      } else if (lastStatus === 404) {
        // 404: no retry
        return {
          url,
          ok: false,
          status: lastStatus,
          reason: "http_404",
          attempts,
        };
      } else if (lastStatus === 429 || lastStatus >= 500) {
        // 429 (rate-limited) or 5xx: retryable
        // Note: intermediate reason used during loop; final result mapped below
        lastReason = lastStatus >= 500 ? "http_5xx" : "http_4xx";
        if (attempt < maxAttempts - 1) {
          await sleeper(Math.pow(2, attempt) * 1000);
        }
      } else if (lastStatus >= 400 && lastStatus < 500) {
        // Other 4xx: no retry
        return {
          url,
          ok: false,
          status: lastStatus,
          reason: "http_4xx",
          attempts,
        };
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      lastStatus = null;

      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        lastReason = "timeout";
      } else {
        lastReason = "connect_error";
      }

      if (attempt < maxAttempts - 1) {
        await sleeper(Math.pow(2, attempt) * 1000);
      }
    }
  }

  // Exhausted all attempts — map 429 final reason
  // Python maps 429 to "http_4xx" in final result
  if (lastStatus === 429) {
    lastReason = "http_4xx";
  } else if (lastStatus !== null && lastStatus >= 500) {
    lastReason = "http_5xx";
  }

  return {
    url,
    ok: false,
    status: lastStatus,
    reason: lastReason,
    attempts,
  };
}

// ---------------------------------------------------------------------------
// validateSourcesQuick  (whitelist-only, no HEAD calls)
// ---------------------------------------------------------------------------

/**
 * Fast whitelist-only validation — no HEAD requests.
 *
 * Use this at ingest time (server-side gate) to avoid adding multiple seconds
 * of latency per POST. The Python pipeline performs HEAD checks at generation
 * time (M1.T6) as a productivity layer before the article reaches ingest.
 *
 * Contrast with `validateSources`, which runs the full whitelist + HEAD-check
 * pipeline and is appropriate for auditing / reporting contexts where latency
 * is not a concern.
 */
export function validateSourcesQuick(sources: SourceLike[]): ValidationResult {
  const flags: SourceFlag[] = [];
  const okSources: SourceLike[] = [];

  for (const source of sources) {
    const url = source.url ?? "";
    if (!url || !isWhitelisted(url)) {
      flags.push({
        type: "source_not_in_whitelist",
        url,
        publisher: source.publisher,
      });
    } else {
      okSources.push(source);
    }
  }

  return {
    okSources,
    flags,
    totalInput: sources.length,
    totalOk: okSources.length,
  };
}

// ---------------------------------------------------------------------------
// validateSources
// ---------------------------------------------------------------------------

export type ValidateSourcesOpts = Pick<HeadOpts, "fetcher" | "sleeper">;

/**
 * Validate a list of sources against the whitelist then via HEAD check.
 * Mirrors Python validate_sources().
 *
 * - Non-whitelisted → flagged as source_not_in_whitelist
 * - HEAD check failures → flagged as source_unreachable
 * - Parallel via Promise.all; input order preserved in okSources
 */
export async function validateSources(
  sources: SourceLike[],
  opts: ValidateSourcesOpts = {}
): Promise<ValidationResult> {
  const { fetcher, sleeper } = opts;

  const flags: SourceFlag[] = [];

  // Step 1: whitelist gate
  const whitelisted: Array<{ idx: number; source: SourceLike }> = [];

  for (let idx = 0; idx < sources.length; idx++) {
    const source = sources[idx];
    const url = source.url ?? "";
    if (!url || !isWhitelisted(url)) {
      flags.push({
        type: "source_not_in_whitelist",
        url,
        publisher: source.publisher,
      });
    } else {
      whitelisted.push({ idx, source });
    }
  }

  if (whitelisted.length === 0) {
    return {
      okSources: [],
      flags,
      totalInput: sources.length,
      totalOk: 0,
    };
  }

  // Step 2: parallel HEAD checks — results keyed by original index
  const headResults = await Promise.all(
    whitelisted.map(async ({ idx, source }) => {
      const result = await headCheck(source.url, { fetcher, sleeper });
      return { idx, source, result };
    })
  );

  // Build lookup map
  const resultMap = new Map(
    headResults.map(({ idx, source, result }) => [idx, { source, result }])
  );

  // Step 3: collect preserving input order
  const okSources: SourceLike[] = [];
  for (const { idx, source } of whitelisted) {
    const entry = resultMap.get(idx)!;
    if (entry.result.ok) {
      okSources.push(source);
    } else {
      flags.push({
        type: "source_unreachable",
        url: source.url,
        publisher: source.publisher,
        reason: entry.result.reason,
      });
    }
  }

  return {
    okSources,
    flags,
    totalInput: sources.length,
    totalOk: okSources.length,
  };
}
