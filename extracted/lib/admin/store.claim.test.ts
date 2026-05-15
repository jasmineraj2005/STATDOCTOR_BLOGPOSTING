/**
 * store.claim.test.ts
 *
 * Tests for claimForApproval() — the atomic approve transition.
 *
 * Strategy: replace the pg Pool used by db.ts with a pg-mem Pool so we exercise
 * the real SQL (UPDATE … WHERE status='pending_review' RETURNING …) without needing
 * a live Postgres instance. Vitest's vi.mock() intercepts the db module before any
 * store module imports run.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { newDb, DataType } from "pg-mem";
import type { Pool as PgPool } from "pg";

// ── pg-mem setup ─────────────────────────────────────────────────────────────

const memDb = newDb();

// Register jsonb_set and to_jsonb — pg-mem doesn't include these natively.
// The real Postgres atomicity correctness proof comes from the WHERE clause filter,
// not the jsonb manipulation; these stubs let the full SQL statement execute.
// pg-mem pre-parses JSONB column values into plain JS objects before passing
// them to registered functions. So 'target' will already be an object, and
// 'value' (the JSONB literal) will be the already-parsed JS value.
// path comes in as a text string like '{status}'.
memDb.public.registerFunction({
  name: "jsonb_set",
  args: [DataType.jsonb, DataType.text, DataType.jsonb],
  returns: DataType.jsonb,
  implementation: (target: unknown, path: unknown, value: unknown) => {
    // path is like '{status}' — extract the key between the braces.
    const key = String(path).replace(/^\{/, "").replace(/\}$/, "");
    const obj: Record<string, unknown> =
      target == null
        ? {}
        : typeof target === "string"
          ? (JSON.parse(target) as Record<string, unknown>)
          : (target as Record<string, unknown>);
    // value arrives pre-parsed by pg-mem — use it directly.
    return { ...obj, [key]: value };
  },
});

memDb.public.registerFunction({
  name: "to_jsonb",
  args: [DataType.text],
  returns: DataType.jsonb,
  // pg-mem passes the text value directly; return it as-is (it will be stored as JSONB).
  implementation: (v: unknown) => v,
});

const { Pool: MemPool } = memDb.adapters.createPg() as { Pool: new () => PgPool };
const testPool = new MemPool();

// Minimal posts table matching schema.sql.
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS posts (
  slug             TEXT PRIMARY KEY,
  filename         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending_review',
  pillar           TEXT NOT NULL,
  content_type     TEXT NOT NULL,
  word_count       INT  NOT NULL DEFAULT 0,
  ahpra_passed     BOOLEAN NOT NULL DEFAULT false,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date_modified    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reviewed_at TIMESTAMPTZ,
  data             JSONB NOT NULL
);
`;

// ── Module mock ──────────────────────────────────────────────────────────────

// Must be declared before any store import so Vitest hoists the mock.
vi.mock("@/lib/admin/db", () => ({
  isDbConfigured: () => true,
  pool: () => testPool,
  sql: async <T extends Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }> => {
    let text = "";
    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i < values.length) text += `$${i + 1}`;
    }
    const res = await testPool.query<T>(text, values as unknown[]);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  },
}));

// Import store after mock is wired.
import { claimForApproval } from "./store";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function insertPendingPost(slug: string) {
  const data = JSON.stringify({
    slug,
    title: "Test post",
    meta_title: "Test post",
    meta_description: "A short description for the post.",
    focus_keyword: "test",
    og_image_alt: "test",
    content_markdown: "## Section\n\nContent.",
    tldr: "tl;dr",
    pillar: "locum_pay_rates",
    content_type: "news",
    target_keywords: [],
    word_count: 200,
    reading_time_minutes: 1,
    sources: [],
    image_url: null,
    image_credit: null,
    faq_json_ld: {},
    medical_webpage_schema: {},
    ahpra_flags: [],
    ahpra_passed: true,
    status: "pending_review",
    generated_at: "2026-01-01T00:00:00.000Z",
  });
  await testPool.query(
    `INSERT INTO posts (slug, filename, status, pillar, content_type, word_count, ahpra_passed, data)
     VALUES ($1, $2, 'pending_review', 'locum_pay_rates', 'news', 200, true, $3::jsonb)
     ON CONFLICT (slug) DO UPDATE SET status = 'pending_review', data = EXCLUDED.data`,
    [slug, `20260101_000000_${slug}.json`, data],
  );
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await testPool.query(BOOTSTRAP_SQL);
});

afterAll(async () => {
  await testPool.end();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("claimForApproval", () => {
  it("claimForApproval_returns_post_on_first_call_for_pending_review_slug", async () => {
    const slug = "claim-test-first-call";
    await insertPendingPost(slug);

    const result = await claimForApproval(slug);

    expect(result).not.toBeNull();
    expect(result!.post.slug).toBe(slug);
    // After claim, status must be 'scheduled'.
    expect(result!.post.status).toBe("scheduled");
    expect(result!.post.last_reviewed_at).toBeTruthy();
  });

  it("claimForApproval_returns_null_on_second_call_for_same_slug", async () => {
    const slug = "claim-test-second-call";
    await insertPendingPost(slug);

    // First call claims the row — status flips to 'scheduled'.
    const first = await claimForApproval(slug);
    expect(first).not.toBeNull();

    // Second call: the WHERE status='pending_review' filter no longer matches.
    const second = await claimForApproval(slug);
    expect(second).toBeNull();
  });

  it("claimForApproval_returns_null_for_nonexistent_slug", async () => {
    const result = await claimForApproval("slug-that-does-not-exist");
    expect(result).toBeNull();
  });
});
