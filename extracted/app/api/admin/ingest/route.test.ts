import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Mock store BEFORE importing the route
vi.mock("@/lib/admin/store", () => ({
  upsertPost: vi.fn().mockResolvedValue(undefined),
  getAllPosts: vi.fn().mockResolvedValue([]),
  getPendingPosts: vi.fn().mockResolvedValue([]),
  getPostBySlug: vi.fn().mockResolvedValue(null),
  claimForApproval: vi.fn().mockResolvedValue(null),
  updateStatus: vi.fn().mockResolvedValue(undefined),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { upsertPost } from "@/lib/admin/store";
import { POST } from "./route";
import type { Post } from "@/lib/admin/types";

const mockUpsertPost = vi.mocked(upsertPost);

// Minimum required Post fields
const validPost: Post = {
  title: "Test Post",
  slug: "test-post",
  meta_title: "Test Post | StatDoctor",
  meta_description: "A test post about medicine.",
  focus_keyword: "test",
  og_image_alt: "Test image",
  content_markdown: "# Test\n\nContent here.",
  tldr: "Short summary.",
  pillar: "industry_news",
  content_type: "news",
  target_keywords: ["test"],
  word_count: 500,
  reading_time_minutes: 3,
  sources: [],
  image_url: null,
  image_credit: null,
  faq_json_ld: {},
  medical_webpage_schema: {},
  ahpra_flags: [],
  ahpra_passed: true,
  status: "pending_review",
  generated_at: "2026-05-15T10:00:00Z",
};

function postReq(body: unknown, token = "test-ingest") {
  return new Request("http://localhost/api/admin/ingest", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/ingest URL whitelist gate", () => {
  beforeAll(() => {
    process.env.INGEST_TOKEN = "test-ingest";
  });

  beforeEach(() => {
    mockUpsertPost.mockClear();
  });

  // ── existing auth behaviour (must not regress) ───────────────────────────

  it("rejects 401 with a bad token", async () => {
    const sources = [{ url: "https://theguardian.com/a", publisher: "Guardian", title: "A", snippet: "s" }];
    const res = await POST(postReq({ filename: "x.json", post: { ...validPost, sources } }, "wrong-token"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("rejects 503 when INGEST_TOKEN env var is not set", async () => {
    const saved = process.env.INGEST_TOKEN;
    delete process.env.INGEST_TOKEN;
    const sources = [{ url: "https://theguardian.com/a", publisher: "Guardian", title: "A", snippet: "s" }];
    const res = await POST(postReq({ filename: "x.json", post: { ...validPost, sources } }, ""));
    expect(res.status).toBe(503);
    process.env.INGEST_TOKEN = saved;
  });

  // ── 422: every source is off-whitelist → do NOT insert ──────────────────

  it("rejects 422 when every source is off-whitelist", async () => {
    const sources = [
      { url: "https://made-up-domain.example.com/a", publisher: "Fake", title: "F", snippet: "s" },
      { url: "https://another-fake.io/b", publisher: "Also Fake", title: "F2", snippet: "s" },
    ];
    const res = await POST(postReq({ filename: "x.json", post: { ...validPost, sources } }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("all_sources_invalid");
    expect(body.flags).toHaveLength(2);
    expect(body.flags[0]).toMatchObject({ type: "source_not_in_whitelist" });
    // Must NOT have called upsertPost — article never enters queue
    expect(mockUpsertPost).not.toHaveBeenCalled();
  });

  // ── 200 + partial drop: some sources off-whitelist ───────────────────────

  it("drops off-whitelist sources and flags them when at least one is valid", async () => {
    const sources = [
      { url: "https://theguardian.com/ok", publisher: "Guardian", title: "Good", snippet: "s" },
      { url: "https://made-up.example.com/bad", publisher: "Fake", title: "Bad", snippet: "s" },
    ];
    const res = await POST(postReq({ filename: "x.json", post: { ...validPost, sources } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dropped).toBe(1);

    // upsertPost must have been called once
    expect(mockUpsertPost).toHaveBeenCalledOnce();
    const [_file, passedPost] = mockUpsertPost.mock.calls[0];

    // sources stripped to only whitelisted one
    expect(passedPost.sources).toHaveLength(1);
    expect(passedPost.sources[0].url).toBe("https://theguardian.com/ok");

    // ahpra_flags should contain one source_not_in_whitelist entry
    // (mapped to AHPRAFlag shape: flag_type, excerpt, fix_applied, requires_human_review)
    expect(passedPost.ahpra_flags).toContainEqual(
      expect.objectContaining({
        flag_type: "source_not_in_whitelist",
      })
    );
  });

  // ── 200: all sources whitelisted → unchanged ─────────────────────────────

  it("passes through unchanged when all sources are whitelisted", async () => {
    const sources = [
      { url: "https://theguardian.com/a", publisher: "Guardian", title: "A", snippet: "s" },
      { url: "https://aihw.gov.au/b", publisher: "AIHW", title: "B", snippet: "s" },
    ];
    const res = await POST(postReq({ filename: "x.json", post: { ...validPost, sources } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dropped ?? 0).toBe(0);

    // upsertPost called with all sources intact
    expect(mockUpsertPost).toHaveBeenCalledOnce();
    const [_file, passedPost] = mockUpsertPost.mock.calls[0];
    expect(passedPost.sources).toHaveLength(2);
    // No source_not_in_whitelist flags added
    const sourceFlags = passedPost.ahpra_flags.filter(
      (f) => f.flag_type === "source_not_in_whitelist"
    );
    expect(sourceFlags).toHaveLength(0);
  });

  // ── edge: post with no sources → passes through (no check needed) ────────

  it("passes through when post has no sources", async () => {
    const res = await POST(postReq({ filename: "x.json", post: { ...validPost, sources: [] } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockUpsertPost).toHaveBeenCalledOnce();
  });
});
