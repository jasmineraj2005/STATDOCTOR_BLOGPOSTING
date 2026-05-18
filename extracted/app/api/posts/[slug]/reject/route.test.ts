/**
 * reject/route.test.ts (M9 finish)
 *
 * Exercises the reject endpoint's HTTP contract, including the new
 * auto-soft-delete-on-2nd-reject behaviour (convention 4 in
 * docs/architecture.md §12).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Post, PostFile } from "@/lib/admin/types";

type AuditEvent = {
  ts: string;
  slug: string;
  action: string;
  reason_code?: string;
  reason_text?: string;
  detail?: string;
};

const {
  mockGetPostBySlug,
  mockUpsertPost,
  mockLogAudit,
  mockSoftDeletePostBySlug,
  mockIsAuthorised,
} = vi.hoisted(() => ({
  mockGetPostBySlug: vi.fn<(slug: string) => Promise<PostFile | null>>(),
  mockUpsertPost: vi.fn<(file: PostFile, post: Post) => Promise<void>>(async () => {}),
  mockLogAudit: vi.fn<(event: AuditEvent) => Promise<void>>(async () => {}),
  mockSoftDeletePostBySlug: vi.fn<(slug: string) => Promise<boolean>>(async (_slug: string) => true),
  mockIsAuthorised: vi.fn<() => Promise<boolean>>(async () => true),
}));

vi.mock("@/lib/admin/auth", () => ({
  isAuthorised: mockIsAuthorised,
}));

vi.mock("@/lib/admin/store", () => ({
  getPostBySlug: mockGetPostBySlug,
  upsertPost: mockUpsertPost,
  logAudit: mockLogAudit,
  softDeletePostBySlug: mockSoftDeletePostBySlug,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${url};303;`;
    throw err;
  }),
}));

import { POST } from "./route";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    slug: "test-reject",
    title: "Test",
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
    status: "pending_review",
    generated_at: "2026-05-18T00:00:00.000Z",
    ...overrides,
  } as Post;
}

function makeFile(post: Post): PostFile {
  return {
    filename: `${post.slug}.json`,
    filepath: `/tmp/${post.slug}.json`,
    ts: "20260518_000000",
    post,
  };
}

function makeRequest(reasonCode: string, reasonText = ""): Request {
  const fd = new FormData();
  fd.append("reason_code", reasonCode);
  if (reasonText) fd.append("reason_text", reasonText);
  return new Request("http://localhost/api/posts/test-reject/reject", {
    method: "POST",
    body: fd,
  });
}

const CTX = { params: Promise.resolve({ slug: "test-reject" }) };

beforeEach(() => {
  mockGetPostBySlug.mockReset();
  mockUpsertPost.mockReset();
  mockLogAudit.mockReset();
  mockSoftDeletePostBySlug.mockReset();
  mockSoftDeletePostBySlug.mockImplementation(async () => true);
  mockIsAuthorised.mockReset();
  mockIsAuthorised.mockImplementation(async () => true);
});

describe("POST /api/posts/[slug]/reject", () => {
  it("first_reject_does_not_soft_delete", async () => {
    mockGetPostBySlug.mockResolvedValueOnce(makeFile(makePost()));
    await expect(POST(makeRequest("off_brand_voice", "voice off"), CTX))
      .rejects.toThrow(/NEXT_REDIRECT/);

    expect(mockUpsertPost).toHaveBeenCalledOnce();
    expect(mockSoftDeletePostBySlug).not.toHaveBeenCalled();
    const audit = mockLogAudit.mock.calls[0][0];
    expect(audit.action).toBe("reject");
    expect(audit.detail).toMatch(/regen/i);
  });

  it("second_reject_on_same_topic_soft_deletes", async () => {
    const postWithOneReject = makePost({
      rejection_history: [
        { ts: "2026-05-17T12:00:00.000Z", code: "off_brand_voice", text: "first" },
      ],
    });
    mockGetPostBySlug.mockResolvedValueOnce(makeFile(postWithOneReject));

    await expect(POST(makeRequest("topic_uninteresting", "second time"), CTX))
      .rejects.toThrow(/NEXT_REDIRECT/);

    expect(mockUpsertPost).toHaveBeenCalledOnce();
    expect(mockSoftDeletePostBySlug).toHaveBeenCalledOnce();
    expect(mockSoftDeletePostBySlug).toHaveBeenCalledWith("test-reject");

    const audit = mockLogAudit.mock.calls[0][0];
    expect(audit.detail).toMatch(/soft-deleted/i);
    expect(audit.detail).toMatch(/restorable/i);
  });

  it("third_reject_still_soft_deletes_idempotently", async () => {
    // If somehow a post was restored after final rejection and rejected again,
    // we should soft-delete again. softDeletePostBySlug is idempotent (returns
    // false when already deleted) so this is a no-op DB-side.
    const postWithTwoRejects = makePost({
      rejection_history: [
        { ts: "2026-05-15T12:00:00.000Z", code: "off_brand_voice", text: "first" },
        { ts: "2026-05-16T12:00:00.000Z", code: "topic_uninteresting", text: "second" },
      ],
    });
    mockGetPostBySlug.mockResolvedValueOnce(makeFile(postWithTwoRejects));

    await expect(POST(makeRequest("other", "third"), CTX))
      .rejects.toThrow(/NEXT_REDIRECT/);

    expect(mockSoftDeletePostBySlug).toHaveBeenCalledOnce();
  });

  it("upsert_writes_new_rejection_history_with_appended_entry", async () => {
    mockGetPostBySlug.mockResolvedValueOnce(makeFile(makePost()));
    await expect(POST(makeRequest("wrong_angle", "wrong"), CTX))
      .rejects.toThrow(/NEXT_REDIRECT/);

    const [, updated] = mockUpsertPost.mock.calls[0];
    expect(updated.status).toBe("rejected");
    expect(updated.rejection_history).toHaveLength(1);
    expect(updated.rejection_history![0].code).toBe("wrong_angle");
    expect(updated.rejection_history![0].text).toBe("wrong");
  });

  it("returns_401_when_unauthorised", async () => {
    mockIsAuthorised.mockImplementationOnce(async () => false);
    const res = await POST(makeRequest("other"), CTX);
    expect(res.status).toBe(401);
    expect(mockUpsertPost).not.toHaveBeenCalled();
  });

  it("returns_404_when_post_not_found", async () => {
    mockGetPostBySlug.mockResolvedValueOnce(null);
    const res = await POST(makeRequest("other"), CTX);
    expect(res.status).toBe(404);
    expect(mockSoftDeletePostBySlug).not.toHaveBeenCalled();
  });
});
