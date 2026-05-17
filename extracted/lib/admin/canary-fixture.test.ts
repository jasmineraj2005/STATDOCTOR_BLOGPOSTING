import { describe, it, expect } from "vitest";
import { buildCanaryPost, canarySlug } from "./canary-fixture";
import { runIngestGate } from "@/app/api/admin/ingest/gate";

describe("Layer D — buildCanaryPost", () => {
  it("Given a date, When fixture built, Then slug starts with '__canary-'", () => {
    const post = buildCanaryPost(new Date("2026-05-17T04:00:00.000Z"));
    expect(post.slug.startsWith("__canary-")).toBe(true);
  });

  it("Given a fixture, When inspected, Then word_count meets guide floor (1500)", () => {
    const post = buildCanaryPost(new Date());
    expect(post.word_count).toBeGreaterThanOrEqual(1500);
  });

  it("Given a fixture, When inspected, Then it has at least 5 authoritative sources", () => {
    const post = buildCanaryPost(new Date());
    expect(post.sources.length).toBeGreaterThanOrEqual(5);
    for (const source of post.sources) {
      expect(source.url).toMatch(/\.(gov\.au|com\.au|org\.au)/);
    }
  });

  it("Given a fixture, When AHPRA-scanned, Then it contains no banned phrases", () => {
    const post = buildCanaryPost(new Date());
    expect(post.content_markdown.toLowerCase()).not.toMatch(
      /best doctor|guarantee|cure|world[\s-]?class/i,
    );
  });

  it("Given a fixture, When pushed through Layer C gate, Then it passes (no validation errors)", () => {
    const post = buildCanaryPost(new Date());
    expect(runIngestGate(post)).toEqual([]);
  });

  it("Given two fixtures built at different timestamps, Then slugs differ", () => {
    const a = canarySlug(new Date("2026-05-17T04:00:00.000Z"));
    const b = canarySlug(new Date("2026-05-17T04:00:01.000Z"));
    expect(a).not.toBe(b);
  });
});
