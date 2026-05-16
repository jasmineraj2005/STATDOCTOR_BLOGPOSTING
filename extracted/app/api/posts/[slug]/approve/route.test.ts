/**
 * route.test.ts — approve endpoint
 *
 * Exercises the HTTP contract of POST /api/posts/[slug]/approve.
 * Store and auth are mocked; this is an integration test of the
 * route's control flow, not the SQL layer (that's store.claim.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PostFile } from "@/lib/admin/types";

// ── Module mocks ─────────────────────────────────────────────────────────────

// vi.mock() factories are hoisted to the top of the file, so variables declared
// outside them cannot be referenced inside them unless created with vi.hoisted().
const {
  mockGetPostBySlug,
  mockClaimForApproval,
  mockLogAudit,
  mockIsAuthorised,
} = vi.hoisted(() => ({
  mockGetPostBySlug: vi.fn<(slug: string) => Promise<PostFile | null>>(),
  mockClaimForApproval: vi.fn<(slug: string) => Promise<PostFile | null>>(),
  mockLogAudit: vi.fn(async () => {}),
  mockIsAuthorised: vi.fn(async () => true),
}));

vi.mock("@/lib/admin/auth", () => ({
  isAuthorised: mockIsAuthorised,
}));

vi.mock("@/lib/admin/store", () => ({
  getPostBySlug: mockGetPostBySlug,
  claimForApproval: mockClaimForApproval,
  logAudit: mockLogAudit,
}));

// next/navigation redirect throws a Next.js-specific error in server components.
// In tests we capture the thrown redirect target.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // Simulate Next.js redirect throw so the route handler short-circuits.
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { digest: string };
    err.digest = `NEXT_REDIRECT;replace;${url};303;`;
    throw err;
  }),
}));

// ── Test helpers ─────────────────────────────────────────────────────────────

import type { Post } from "@/lib/admin/types";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    slug: "test-post",
    title: "Locum Work in Sydney — A Test Post",
    meta_title: "Locum Work in Sydney",
    meta_description: "A$1600/day senior locum rates in Sydney.",
    focus_keyword: "locum work sydney",
    og_image_alt: "Sydney public hospital ward.",
    content_markdown: [
      "**TL;DR:** test",
      "",
      "## Background",
      "",
      "[AHPRA registration](https://www.ahpra.gov.au/) is the entry point.",
      "",
      "> [KEY FACTS] These figures come from AIHW.",
      "",
      "> [INFO] Refer to [AIHW data](https://www.aihw.gov.au/) for context.",
      "",
      "> [AU] [NSW Health](https://www.health.nsw.gov.au/) sets the floor.",
      "",
      "> [KEY TAKEAWAY] DB ingest works.",
      "",
      "## Pay",
      "",
      "| Tier | Daily |",
      "| --- | --- |",
      "| Junior | A$1100 |",
      "| Senior | A$1600 |",
      "",
      "## FAQ",
      "",
      "### Q1?\nA1.",
      "### Q2?\nA2.",
      "### Q3?\nA3.",
      "### Q4?\nA4.",
    ].join("\n"),
    tldr: "Test post",
    pillar: "locum_pay_rates",
    content_type: "guide",
    target_keywords: ["locum work sydney"],
    keywords: ["locum work sydney", "ahpra", "aihw"],
    word_count: 1600,
    reading_time_minutes: 8,
    sources: [
      { title: "AHPRA", url: "https://www.ahpra.gov.au/", publisher: "AHPRA", snippet: "" },
      { title: "AIHW", url: "https://www.aihw.gov.au/", publisher: "AIHW", snippet: "" },
      { title: "NSW Health", url: "https://www.health.nsw.gov.au/", publisher: "NSW Health", snippet: "" },
    ],
    image_url: null,
    image_credit: null,
    faq_json_ld: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q1?", acceptedAnswer: { "@type": "Answer", text: "A1" } },
        { "@type": "Question", name: "Q2?", acceptedAnswer: { "@type": "Answer", text: "A2" } },
        { "@type": "Question", name: "Q3?", acceptedAnswer: { "@type": "Answer", text: "A3" } },
        { "@type": "Question", name: "Q4?", acceptedAnswer: { "@type": "Answer", text: "A4" } },
      ],
    },
    medical_webpage_schema: { "@type": "MedicalWebPage" },
    ahpra_flags: [],
    ahpra_passed: true,
    status: "pending_review",
    generated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFile(slug: string, overrides: Partial<Post> = {}): PostFile {
  return {
    filename: `20260101_000000_${slug}.json`,
    filepath: `/tmp/${slug}.json`,
    ts: "20260101_000000",
    post: makePost({ slug, ...overrides }),
  };
}

function makeRequest(slug: string): [Request, { params: Promise<{ slug: string }> }] {
  return [
    new Request(`http://localhost/api/posts/${slug}/approve`, { method: "POST" }),
    { params: Promise.resolve({ slug }) },
  ];
}

// ── Import route after mocks are set ─────────────────────────────────────────

import { POST } from "./route";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/posts/[slug]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve_pending_review_post_redirects_303_and_calls_claimForApproval_once", async () => {
    const slug = "test-post";
    const pendingFile = makeFile(slug, { status: "pending_review" });
    const claimedFile = makeFile(slug, {
      status: "scheduled",
      last_reviewed_at: "2026-01-02T00:00:00.000Z",
    });

    mockGetPostBySlug.mockResolvedValue(pendingFile);
    mockClaimForApproval.mockResolvedValue(claimedFile);

    let redirectUrl: string | undefined;
    try {
      await POST(...makeRequest(slug));
    } catch (err) {
      // Extract redirect target from the Next.js redirect error.
      const msg = (err as Error).message ?? "";
      if (msg.startsWith("NEXT_REDIRECT:")) {
        redirectUrl = msg.replace("NEXT_REDIRECT:", "");
      } else {
        throw err;
      }
    }

    expect(redirectUrl).toBe("/admin/posts");
    expect(mockClaimForApproval).toHaveBeenCalledTimes(1);
    expect(mockClaimForApproval).toHaveBeenCalledWith(slug);
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ slug, action: "approve" }),
    );
  });

  it("approve_already_scheduled_post_returns_409", async () => {
    const slug = "already-scheduled";
    // getPostBySlug returns the post (validators pass), but claimForApproval
    // returns null because the row's status is no longer 'pending_review'.
    mockGetPostBySlug.mockResolvedValue(makeFile(slug, { status: "pending_review" }));
    mockClaimForApproval.mockResolvedValue(null);

    const [req, ctx] = makeRequest(slug);
    const response = await POST(req, ctx);

    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("already_approved_or_not_found");
    expect(mockClaimForApproval).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("approve_nonexistent_post_returns_404", async () => {
    mockGetPostBySlug.mockResolvedValue(null);

    const [req, ctx] = makeRequest("no-such-post");
    const response = await POST(req, ctx);

    expect(response.status).toBe(404);
    expect(mockClaimForApproval).not.toHaveBeenCalled();
  });

  it("approve_invalid_post_returns_400_without_calling_claim", async () => {
    const slug = "invalid-post";
    // ahpra_passed=false will fail the AHPRA validator
    mockGetPostBySlug.mockResolvedValue(makeFile(slug, { ahpra_passed: false }));

    const [req, ctx] = makeRequest(slug);
    const response = await POST(req, ctx);

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("validators_failed");
    // Critical: claimForApproval must NOT be called when validators fail.
    expect(mockClaimForApproval).not.toHaveBeenCalled();
  });
});
