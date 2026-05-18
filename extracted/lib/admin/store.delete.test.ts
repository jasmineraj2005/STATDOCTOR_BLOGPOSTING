/**
 * store.delete.test.ts (M9)
 *
 * Tests for soft delete + restore + queue-query filtering. Pg-mem is used as
 * an in-process Postgres so we exercise real SQL without a live server. The
 * BOOTSTRAP_SQL includes the new `deleted_at` column + partial index.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { newDb } from "pg-mem";
import type { Pool as PgPool } from "pg";

const memDb = newDb();
const { Pool: MemPool } = memDb.adapters.createPg() as { Pool: new () => PgPool };
const testPool = new MemPool();

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
  deleted_at       TIMESTAMPTZ,
  data             JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slug TEXT NOT NULL,
  action TEXT NOT NULL,
  reason_code TEXT,
  reason_text TEXT,
  detail TEXT
);
`;

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

import {
  getAllPosts,
  getPendingPosts,
  getPostBySlug,
  getPostBySlugIncludingDeleted,
  restorePostBySlug,
  softDeletePostBySlug,
} from "./store";

async function seedPost(slug: string, status = "pending_review") {
  const data = JSON.stringify({
    slug,
    title: `Test ${slug}`,
    meta_title: "T",
    meta_description: "D",
    focus_keyword: "k",
    og_image_alt: "alt",
    content_markdown: "## H\n\nBody.",
    tldr: "t",
    pillar: "locum_pay_rates",
    content_type: "guide",
    target_keywords: [],
    word_count: 1600,
    reading_time_minutes: 8,
    sources: [],
    image_url: null,
    image_credit: null,
    faq_json_ld: {},
    medical_webpage_schema: {},
    ahpra_flags: [],
    ahpra_passed: true,
    status,
    generated_at: "2026-05-18T00:00:00.000Z",
  });
  await testPool.query(
    `INSERT INTO posts (slug, filename, status, pillar, content_type, word_count, ahpra_passed, data)
     VALUES ($1, $2, $3, 'locum_pay_rates', 'guide', 1600, true, $4::jsonb)
     ON CONFLICT (slug) DO UPDATE
       SET status = EXCLUDED.status, data = EXCLUDED.data, deleted_at = NULL`,
    [slug, `${slug}.json`, status, data],
  );
}

async function clear() {
  await testPool.query("DELETE FROM posts");
  await testPool.query("DELETE FROM audit_events");
}

beforeAll(async () => {
  await testPool.query(BOOTSTRAP_SQL);
});

afterAll(async () => {
  await testPool.end();
});

beforeEach(async () => {
  await clear();
});

describe("softDeletePostBySlug", () => {
  it("sets deleted_at and returns true on a live post", async () => {
    await seedPost("delete-me");
    const ok = await softDeletePostBySlug("delete-me");
    expect(ok).toBe(true);

    const { rows } = await testPool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM posts WHERE slug = $1",
      ["delete-me"],
    );
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("returns false for an already-deleted post (idempotent)", async () => {
    await seedPost("delete-twice");
    await softDeletePostBySlug("delete-twice");
    const second = await softDeletePostBySlug("delete-twice");
    expect(second).toBe(false);
  });

  it("returns false for a non-existent slug", async () => {
    const ok = await softDeletePostBySlug("does-not-exist");
    expect(ok).toBe(false);
  });
});

describe("restorePostBySlug", () => {
  it("clears deleted_at on a soft-deleted post and returns true", async () => {
    await seedPost("restore-me");
    await softDeletePostBySlug("restore-me");

    const ok = await restorePostBySlug("restore-me");
    expect(ok).toBe(true);

    const { rows } = await testPool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM posts WHERE slug = $1",
      ["restore-me"],
    );
    expect(rows[0].deleted_at).toBeNull();
  });

  it("returns false for a post that wasn't deleted", async () => {
    await seedPost("not-deleted");
    const ok = await restorePostBySlug("not-deleted");
    expect(ok).toBe(false);
  });

  it("returns false for a non-existent slug", async () => {
    expect(await restorePostBySlug("does-not-exist")).toBe(false);
  });
});

describe("queue queries filter soft-deleted posts", () => {
  it("getAllPosts excludes soft-deleted rows", async () => {
    await seedPost("live-one");
    await seedPost("deleted-one");
    await softDeletePostBySlug("deleted-one");

    const all = await getAllPosts();
    const slugs = all.map((p) => p.post.slug);
    expect(slugs).toContain("live-one");
    expect(slugs).not.toContain("deleted-one");
  });

  it("getPendingPosts excludes soft-deleted rows", async () => {
    await seedPost("pending-live");
    await seedPost("pending-deleted");
    await softDeletePostBySlug("pending-deleted");

    const pending = await getPendingPosts();
    const slugs = pending.map((p) => p.post.slug);
    expect(slugs).toContain("pending-live");
    expect(slugs).not.toContain("pending-deleted");
  });

  it("getPostBySlug returns null for a soft-deleted post", async () => {
    await seedPost("by-slug-deleted");
    await softDeletePostBySlug("by-slug-deleted");
    const got = await getPostBySlug("by-slug-deleted");
    expect(got).toBeNull();
  });

  it("getPostBySlugIncludingDeleted returns the soft-deleted post", async () => {
    await seedPost("by-slug-include");
    await softDeletePostBySlug("by-slug-include");
    const got = await getPostBySlugIncludingDeleted("by-slug-include");
    expect(got).not.toBeNull();
    expect(got!.post.slug).toBe("by-slug-include");
  });

  it("getPostBySlugIncludingDeleted returns live posts too", async () => {
    await seedPost("live-includable");
    const got = await getPostBySlugIncludingDeleted("live-includable");
    expect(got).not.toBeNull();
  });
});
