import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { runIngestGate, gateMode, type IngestablePost } from "./gate";

const validPost = (overrides: Partial<IngestablePost> = {}): IngestablePost => ({
  title: "T",
  slug: "t",
  meta_title: "MT",
  meta_description: "MD",
  content_markdown: "...",
  content_type: "guide",
  pillar: "locum",
  word_count: 1700,
  sources: Array.from({ length: 5 }, (_, i) => ({
    url: `https://ahpra.gov.au/x${i}`,
    title: `S${i}`,
  })),
  ahpra_flags: [],
  ...overrides,
});

describe("Layer C — runIngestGate", () => {
  it("Given a fully valid post, When gated, Then returns no errors", () => {
    expect(runIngestGate(validPost())).toEqual([]);
  });

  it("Given word_count below guide floor (1500), When gated, Then returns word_count error", () => {
    const errs = runIngestGate(validPost({ word_count: 1200 }));
    expect(errs.find((e) => e.check === "word_count")).toBeDefined();
    expect(errs[0].detail).toContain("1200");
    expect(errs[0].detail).toContain("1500");
  });

  it("Given 4 sources, When gated, Then returns source_count error", () => {
    const errs = runIngestGate(validPost({ sources: validPost().sources!.slice(0, 4) }));
    expect(errs.find((e) => e.check === "source_count")).toBeDefined();
  });

  it("Given missing meta_title, When gated, Then returns schema error for meta_title", () => {
    const post = validPost();
    delete (post as Partial<IngestablePost>).meta_title;
    const errs = runIngestGate(post);
    expect(
      errs.find((e) => e.check === "schema" && e.detail.includes("meta_title")),
    ).toBeDefined();
  });

  it("Given content_type=company with 1100 words, When gated, Then passes (company floor=1000)", () => {
    expect(runIngestGate(validPost({ content_type: "company", word_count: 1100 }))).toEqual([]);
  });

  it("Given unknown content_type with 1200 words, When gated, Then default floor 1000 — passes", () => {
    expect(runIngestGate(validPost({ content_type: "unknown", word_count: 1200 }))).toEqual([]);
  });

  it("Given multiple violations, When gated, Then returns all of them", () => {
    const errs = runIngestGate(validPost({ word_count: 500, sources: [] }));
    expect(errs.find((e) => e.check === "word_count")).toBeDefined();
    expect(errs.find((e) => e.check === "source_count")).toBeDefined();
  });
});

describe("Layer C — gateMode", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.FAIL_AGENT_INGEST_GATE;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.FAIL_AGENT_INGEST_GATE;
    else process.env.FAIL_AGENT_INGEST_GATE = original;
  });

  it("Given env unset, When called, Then returns 'shadow'", () => {
    delete process.env.FAIL_AGENT_INGEST_GATE;
    expect(gateMode()).toBe("shadow");
  });

  it("Given env='strict', When called, Then returns 'strict'", () => {
    process.env.FAIL_AGENT_INGEST_GATE = "strict";
    expect(gateMode()).toBe("strict");
  });

  it("Given env='log', When called, Then returns 'shadow' (only 'strict' enables)", () => {
    process.env.FAIL_AGENT_INGEST_GATE = "log";
    expect(gateMode()).toBe("shadow");
  });
});
