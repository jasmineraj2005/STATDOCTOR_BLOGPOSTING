/**
 * store.revisions.test.ts (M9)
 *
 * Tests for addPostRevision + getPostRevisions. Pg-mem backed.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { newDb } from "pg-mem";
import type { Pool as PgPool } from "pg";
import type { Post } from "./types";

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
CREATE TABLE IF NOT EXISTS post_revisions (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES posts(slug) ON DELETE CASCADE,
  data JSONB NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_by TEXT,
  reason TEXT
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

import { addPostRevision, getPostRevisions } from "./store";

function makePost(slug: string, contentMarkdown = "## H\n\nBody."): Post {
  return {
    slug,
    title: `Test ${slug}`,
    meta_title: "T",
    meta_description: "D",
    focus_keyword: "k",
    og_image_alt: "alt",
    content_markdown: contentMarkdown,
    tldr: "t",
    pillar: "locum_pay_rates",
    content_type: "guide",
    target_keywords: [],
    word_count: contentMarkdown.split(/\s+/).filter(Boolean).length,
    reading_time_minutes: 8,
    sources: [],
    image_url: null,
    image_credit: null,
    faq_json_ld: {},
    medical_webpage_schema: {},
    ahpra_flags: [],
    ahpra_passed: true,
    status: "pending_review",
    generated_at: "2026-05-18T00:00:00.000Z",
  } as Post;
}

async function seedPost(slug: string) {
  const post = makePost(slug);
  await testPool.query(
    `INSERT INTO posts (slug, filename, status, pillar, content_type, word_count, ahpra_passed, data)
     VALUES ($1, $2, 'pending_review', 'locum_pay_rates', 'guide', 1600, true, $3::jsonb)
     ON CONFLICT (slug) DO UPDATE SET data = EXCLUDED.data`,
    [slug, `${slug}.json`, JSON.stringify(post)],
  );
}

beforeAll(async () => {
  await testPool.query(BOOTSTRAP_SQL);
});

afterAll(async () => {
  await testPool.end();
});

beforeEach(async () => {
  await testPool.query("DELETE FROM post_revisions");
  await testPool.query("DELETE FROM posts");
});

describe("addPostRevision", () => {
  it("inserts a revision row for the given slug", async () => {
    await seedPost("rev-test-1");
    await addPostRevision("rev-test-1", makePost("rev-test-1"));

    const { rows } = await testPool.query<{ slug: string }>(
      "SELECT slug FROM post_revisions WHERE slug = $1",
      ["rev-test-1"],
    );
    expect(rows.length).toBe(1);
  });

  it("preserves the snapshot data so a later edit doesn't mutate history", async () => {
    await seedPost("rev-test-2");
    const original = makePost("rev-test-2", "## Original\n\nFirst body.");
    await addPostRevision("rev-test-2", original);

    // Imitate an edit by inserting a second revision with new content
    await addPostRevision("rev-test-2", makePost("rev-test-2", "## Edited\n\nSecond body."));

    const revisions = await getPostRevisions("rev-test-2");
    expect(revisions.length).toBe(2);
    // Newest first
    expect(revisions[0].data.content_markdown).toContain("Edited");
    expect(revisions[1].data.content_markdown).toContain("Original");
  });

  it("records edited_by + reason when provided", async () => {
    await seedPost("rev-test-3");
    await addPostRevision("rev-test-3", makePost("rev-test-3"), {
      editedBy: "anu@statdoctor.net",
      reason: "manual fix",
    });

    const revs = await getPostRevisions("rev-test-3");
    expect(revs[0].edited_by).toBe("anu@statdoctor.net");
    expect(revs[0].reason).toBe("manual fix");
  });

  it("getPostRevisions returns empty list for slug with no revisions", async () => {
    await seedPost("rev-test-empty");
    const revs = await getPostRevisions("rev-test-empty");
    expect(revs).toEqual([]);
  });
});
