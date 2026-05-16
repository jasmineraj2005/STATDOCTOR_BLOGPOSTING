/**
 * route.test.ts — Unit tests for POST /api/posts/[slug]/retry-publish (M7)
 *
 * Tests the retry-publish handler with mocked DB and auth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/admin/auth", () => ({
  isAuthorised: vi.fn(),
}));

vi.mock("@/lib/admin/store", () => ({
  getPostBySlug: vi.fn(),
  upsertPost: vi.fn(),
  logAudit: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { isAuthorised } from "@/lib/admin/auth";
import { getPostBySlug, upsertPost, logAudit } from "@/lib/admin/store";
import { POST } from "./route";

const mockIsAuthorised = isAuthorised as unknown as ReturnType<typeof vi.fn>;
const mockGetPostBySlug = getPostBySlug as unknown as ReturnType<typeof vi.fn>;
const mockUpsertPost = upsertPost as unknown as ReturnType<typeof vi.fn>;
const mockLogAudit = logAudit as unknown as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePublishFailedPost(slug: string) {
  return {
    filename: `20260101_090000_${slug}.json`,
    filepath: `/output/20260101_090000_${slug}.json`,
    ts: "20260101_090000",
    post: {
      slug,
      title: "Test Post",
      meta_title: "Test",
      meta_description: "A test.",
      focus_keyword: "test",
      og_image_alt: "test",
      content_markdown: "## Test\n\nContent.",
      tldr: "test",
      pillar: "locum_pay_rates",
      content_type: "guide" as const,
      target_keywords: [],
      word_count: 500,
      reading_time_minutes: 3,
      sources: [],
      image_url: null,
      image_credit: null,
      faq_json_ld: {},
      medical_webpage_schema: {},
      ahpra_flags: [],
      ahpra_passed: true,
      status: "publish_failed" as const,
      generated_at: "2026-01-01T00:00:00.000Z",
      dateModified: "2026-01-01T09:00:00.000Z",
      last_reviewed_at: "2026-01-01T08:00:00.000Z",
    },
  };
}

function makeReq(slug: string): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/posts/${slug}/retry-publish`, { method: "POST" }),
    { params: Promise.resolve({ slug }) },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthorised.mockResolvedValue(true);
  mockUpsertPost.mockResolvedValue(undefined);
  mockLogAudit.mockResolvedValue(undefined);
});

describe("POST /api/posts/[slug]/retry-publish", () => {
  describe("happy path — publish_failed post retried", () => {
    it("returns 200 with { ok: true, slug, status: 'scheduled' }", async () => {
      const slug = "test-retry-slug";
      mockGetPostBySlug.mockResolvedValue(makePublishFailedPost(slug));
      const [req, ctx] = makeReq(slug);

      const res = await POST(req, ctx);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, slug, status: "scheduled" });
    });

    it("calls upsertPost with status='scheduled'", async () => {
      const slug = "test-retry-slug";
      mockGetPostBySlug.mockResolvedValue(makePublishFailedPost(slug));
      const [req, ctx] = makeReq(slug);

      await POST(req, ctx);
      expect(mockUpsertPost).toHaveBeenCalledOnce();
      const updatedPost = mockUpsertPost.mock.calls[0][1];
      expect(updatedPost.status).toBe("scheduled");
    });

    it("logs an audit event", async () => {
      const slug = "test-retry-slug";
      mockGetPostBySlug.mockResolvedValue(makePublishFailedPost(slug));
      const [req, ctx] = makeReq(slug);

      await POST(req, ctx);
      expect(mockLogAudit).toHaveBeenCalledOnce();
      const auditEvent = mockLogAudit.mock.calls[0][0];
      expect(auditEvent.slug).toBe(slug);
    });
  });

  describe("unauthorised request", () => {
    it("returns 401 when isAuthorised returns false", async () => {
      mockIsAuthorised.mockResolvedValue(false);
      const [req, ctx] = makeReq("some-slug");

      const res = await POST(req, ctx);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: "unauthorized" });
    });
  });

  describe("post not found", () => {
    it("returns 404 when slug does not exist", async () => {
      mockGetPostBySlug.mockResolvedValue(null);
      const [req, ctx] = makeReq("nonexistent-slug");

      const res = await POST(req, ctx);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: "not_found" });
    });
  });

  describe("post is not in publish_failed state", () => {
    it("returns 400 when post status is 'scheduled'", async () => {
      const slug = "test-retry-slug";
      const file = makePublishFailedPost(slug);
      // Cast needed: test mutates the narrowly-typed status field.
      (file.post as { status: string }).status = "scheduled";
      mockGetPostBySlug.mockResolvedValue(file);
      const [req, ctx] = makeReq(slug);

      const res = await POST(req, ctx);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: "not_publish_failed" });
    });

    it("returns 400 when post status is 'published'", async () => {
      const slug = "test-retry-slug";
      const file = makePublishFailedPost(slug);
      (file.post as { status: string }).status = "published";
      mockGetPostBySlug.mockResolvedValue(file);
      const [req, ctx] = makeReq(slug);

      const res = await POST(req, ctx);
      expect(res.status).toBe(400);
    });

    it("does NOT call upsertPost when status check fails", async () => {
      const slug = "test-retry-slug";
      const file = makePublishFailedPost(slug);
      (file.post as { status: string }).status = "pending_review";
      mockGetPostBySlug.mockResolvedValue(file);
      const [req, ctx] = makeReq(slug);

      await POST(req, ctx);
      expect(mockUpsertPost).not.toHaveBeenCalled();
    });
  });
});
