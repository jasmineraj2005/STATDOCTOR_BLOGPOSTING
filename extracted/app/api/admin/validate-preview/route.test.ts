import { describe, it, expect, vi, beforeEach } from "vitest";

import { POST } from "./route";
import type { Post } from "@/lib/admin/types";

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
  return new Request("http://localhost/api/admin/validate-preview", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/validate-preview", () => {
  beforeEach(() => {
    process.env.INGEST_TOKEN = "test-ingest";
  });

  it("returns 401 without a bearer token", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/validate-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post: validPost }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong bearer token", async () => {
    const res = await POST(postReq({ post: validPost }, "wrong-token"));
    expect(res.status).toBe(401);
  });

  it("returns 503 when INGEST_TOKEN is not configured", async () => {
    delete process.env.INGEST_TOKEN;
    const res = await POST(postReq({ post: validPost }, "anything"));
    expect(res.status).toBe(503);
  });

  it("returns 400 on missing post field", async () => {
    const res = await POST(postReq({ not_a_post: true }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/validate-preview", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-ingest",
          "Content-Type": "application/json",
        },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with full validator results for a valid post", async () => {
    const res = await POST(postReq({ post: validPost }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      red_validators: { check: string }[];
      all_validators: { check: string; status: string }[];
    };
    expect(Array.isArray(data.red_validators)).toBe(true);
    expect(Array.isArray(data.all_validators)).toBe(true);
    expect(data.all_validators.length).toBe(8);
    // This minimal post should fail several validators (word_count too low,
    // FAQ shape missing, sources empty) — confirms red_validators is populated.
    expect(data.red_validators.length).toBeGreaterThan(0);
  });

  it("never writes to the DB (pure preview)", async () => {
    // Vitest's @/lib/admin/store import is NOT mocked here. If the route
    // touched the DB, vitest would fail trying to connect. Implicit: no
    // DB-dependent imports in route.ts.
    const res = await POST(postReq({ post: validPost }));
    expect(res.status).toBe(200);
  });
});
