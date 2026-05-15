import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PostFile } from "./types";
// publishToGitHub is currently NOT exported — we export it as part of this task.
import { publishToGitHub } from "./publish";

// Use a tiny PostFile builder
function postFile(slug = "test-slug"): PostFile {
  return {
    filename: `20260101_000000_${slug}.json`,
    filepath: `/tmp/${slug}.json`,
    ts: "20260101_000000",
    post: {
      slug,
      title: "T",
      meta_title: "T",
      meta_description: "A short description for the post.",
      focus_keyword: "test keyword",
      og_image_alt: "test image alt",
      content_markdown: "## Section\n\nContent here.",
      tldr: "tl;dr",
      pillar: "locum_pay_rates",
      content_type: "news",
      target_keywords: [],
      word_count: 100,
      reading_time_minutes: 1,
      sources: [],
      image_url: null,
      image_credit: null,
      faq_json_ld: {},
      medical_webpage_schema: {},
      ahpra_flags: [],
      ahpra_passed: true,
      status: "scheduled",
      generated_at: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("publishToGitHub", () => {
  const ENV = {
    GITHUB_TOKEN: "ghp_test",
    WEBSITE_REPO_OWNER: "x",
    WEBSITE_REPO_NAME: "y",
    WEBSITE_REPO_BRANCH: "main",
  };

  beforeEach(() => {
    Object.assign(process.env, ENV);
  });

  it("publishToGitHub_returns_ok_on_200", async () => {
    let calls = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls++;
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ content: { sha: "abc" } }), { status: 200 });
      }
      // initial GET to read existing sha — 404 means file doesn't exist yet
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const result = await publishToGitHub(postFile(), { fetcher });
    expect(result.ok).toBe(true);
    // 1 GET (file not present) + 1 PUT = 2 calls total
    expect(calls).toBe(2);
  });

  it("publishToGitHub_returns_ok_on_422_treats_sha_conflict_as_published", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ message: "Update is not a fast forward" }), { status: 422 });
      }
      return new Response(JSON.stringify({ sha: "existing-sha" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await publishToGitHub(postFile(), { fetcher });
    // Treat 422 SHA conflict as "already published" — file exists.
    expect(result.ok).toBe(true);
    expect(result.detail.toLowerCase()).toMatch(/already exists|conflict/);
  });

  it("publishToGitHub_returns_not_ok_after_3_retries_on_500", async () => {
    let putCalls = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        putCalls++;
        return new Response("upstream error", { status: 500 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const sleeper = vi.fn(async () => {});
    const result = await publishToGitHub(postFile(), { fetcher, sleeper, maxRetries: 3 });
    expect(result.ok).toBe(false);
    expect(putCalls).toBe(3);
    expect(result.detail).toMatch(/500/);
    // sleeper called between retries — 2 sleeps for 3 attempts
    expect(sleeper).toHaveBeenCalledTimes(2);
  });
});
