import { describe, expect, it } from "vitest";
import { runValidators, isApprovable } from "./validators";
import type { Post } from "./types";

/** Build a minimal Post that passes every validator by default. Tests override
 *  fields to focus on the single check under exam. */
function makePost(overrides: Partial<Post> = {}): Post {
  const base: Post = {
    title: "Locum Work in Sydney — A Test Post",
    slug: "locum-work-in-sydney",
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
      // 8 entries — meets the guide floor introduced in M4 (validators.json faq_floors.guide=8).
      // Tests that need fewer/more questions override this field directly.
      mainEntity: Array.from({ length: 8 }, (_, i) => ({
        "@type": "Question",
        name: `Q${i + 1}?`,
        acceptedAnswer: { "@type": "Answer", text: `A${i + 1}` },
      })),
    },
    medical_webpage_schema: { "@type": "MedicalWebPage" },
    ahpra_flags: [],
    ahpra_passed: true,
    status: "pending_review",
    generated_at: "2026-05-12T00:00:00Z",
    dateModified: "2026-05-12T00:00:00Z",
  };
  return { ...base, ...overrides };
}

function result(post: Post, check: string) {
  return runValidators(post).find((r) => r.check === check)!;
}

describe("AHPRA compliance", () => {
  it("passes when ahpra_passed and no review flags", () => {
    expect(result(makePost(), "ahpra").status).toBe("pass");
  });
  it("fails when a flag requires human review (legacy back-compat — no severity)", () => {
    const p = makePost({
      ahpra_flags: [
        {
          flag_type: "forbidden_claim",
          excerpt: "world-class",
          fix_applied: "",
          requires_human_review: true,
        },
      ],
    });
    expect(result(p, "ahpra").status).toBe("fail");
  });
  it("fails when ahpra_passed is false", () => {
    expect(result(makePost({ ahpra_passed: false }), "ahpra").status).toBe("fail");
  });

  // M16: severity-aware gate.
  it("fails when any flag is severity=error", () => {
    const p = makePost({
      ahpra_flags: [
        {
          flag_type: "forbidden_claim",
          excerpt: "Australia's leading",
          fix_applied: "remove",
          requires_human_review: true,
          severity: "error",
        },
      ],
    });
    expect(result(p, "ahpra").status).toBe("fail");
  });

  it("warns (doesn't block) when only severity=warn flags exist", () => {
    const p = makePost({
      ahpra_flags: [
        {
          flag_type: "unsupported_stat",
          excerpt: "75% of locums",
          fix_applied: "add citation",
          requires_human_review: true,
          severity: "warn",
        },
      ],
    });
    expect(result(p, "ahpra").status).toBe("warn");
  });

  it("passes when only severity=info flags exist (auto-fixed)", () => {
    const p = makePost({
      ahpra_flags: [
        {
          flag_type: "missing_disclaimer",
          excerpt: "(auto-inject)",
          fix_applied: "Auto-injected general disclaimer.",
          requires_human_review: false,
          severity: "info",
        },
        {
          flag_type: "unsupported_stat",
          excerpt: "75% of locums",
          fix_applied: "auto-cited",
          requires_human_review: false,
          severity: "info",
        },
      ],
    });
    expect(result(p, "ahpra").status).toBe("pass");
  });

  it("error trumps warn when both present", () => {
    const p = makePost({
      ahpra_flags: [
        {
          flag_type: "unsupported_stat",
          excerpt: "stat",
          fix_applied: "",
          requires_human_review: true,
          severity: "warn",
        },
        {
          flag_type: "forbidden_claim",
          excerpt: "world-class",
          fix_applied: "",
          requires_human_review: true,
          severity: "error",
        },
      ],
    });
    expect(result(p, "ahpra").status).toBe("fail");
  });

  it("isApprovable allows warns through (M16: warn != block)", () => {
    const p = makePost({
      ahpra_flags: [
        {
          flag_type: "unsupported_stat",
          excerpt: "stat",
          fix_applied: "",
          requires_human_review: true,
          severity: "warn",
        },
      ],
    });
    // ahpra check returns "warn"; isApprovable should still be true since no
    // validators are failing.
    expect(isApprovable(runValidators(p))).toBe(true);
  });
});

describe("Banned phrases", () => {
  const cases: { name: string; md: string; expected: "fail" | "warn" }[] = [
    { name: "AHPRA 'best doctor'", md: "We're the best doctor in town.", expected: "fail" },
    { name: "AHPRA 'number one'", md: "We're number one in Sydney.", expected: "fail" },
    { name: "AHPRA '#1'", md: "Sydney's #1 locum platform.", expected: "fail" },
    { name: "AHPRA 'world-class'", md: "World-class clinicians.", expected: "fail" },
    { name: "AHPRA 'Australia's best'", md: "Australia's best marketplace.", expected: "fail" },
    { name: "AHPRA 'guaranteed results'", md: "We promise guaranteed results.", expected: "fail" },
    { name: "AHPRA 'cure'", md: "A cure for the GP shortage.", expected: "fail" },
    { name: "AHPRA 'testimonial'", md: "Read this testimonial from a patient.", expected: "fail" },
    { name: "Editorial 'comprehensive'", md: "Our comprehensive guide.", expected: "warn" },
    { name: "Editorial 'groundbreaking'", md: "A groundbreaking approach.", expected: "warn" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const p = makePost({ content_markdown: makePost().content_markdown + "\n\n" + c.md });
      expect(result(p, "banned_phrases").status).toBe(c.expected);
    });
  }

  it("fails when AHPRA-banned phrase is present", () => {
    const p = makePost({
      content_markdown: makePost().content_markdown + "\n\nWe are the best doctor in Sydney.",
    });
    expect(result(p, "banned_phrases").status).toBe("fail");
  });

  it("warns when only an editorial-banned phrase is present", () => {
    const p = makePost({
      content_markdown: makePost().content_markdown + "\n\nA comprehensive overview.",
    });
    expect(result(p, "banned_phrases").status).toBe("warn");
  });

  it("passes on clean content", () => {
    expect(result(makePost(), "banned_phrases").status).toBe("pass");
  });
});

describe("Anchor text", () => {
  const bad = ["source", "link", "click here", "here", "read more"];
  for (const anchor of bad) {
    it(`fails on '[${anchor}](...)'`, () => {
      const p = makePost({
        content_markdown:
          makePost().content_markdown + `\n\nSee [${anchor}](https://example.com).`,
      });
      expect(result(p, "anchor_text").status).toBe("fail");
    });
  }
  it("passes on entity-named anchors", () => {
    expect(result(makePost(), "anchor_text").status).toBe("pass");
  });
});

describe("Callout quota", () => {
  it("passes guide with ≥4 callouts", () => {
    expect(result(makePost({ content_type: "guide" }), "callout_quota").status).toBe("pass");
  });
  it("fails guide with 2 callouts", () => {
    const md = "## H\n\n> [KEY FACTS] one\n\n> [INFO] two\n";
    expect(
      result(makePost({ content_type: "guide", content_markdown: md }), "callout_quota")
        .status,
    ).toBe("fail");
  });
  it("passes news with 3 callouts", () => {
    const md = "## H\n\n> [KEY FACTS] one\n\n> [INFO] two\n\n> [AU] three\n";
    expect(
      result(makePost({ content_type: "news", content_markdown: md }), "callout_quota")
        .status,
    ).toBe("pass");
  });
});

describe("Comparison table", () => {
  it("passes when a markdown table is present", () => {
    expect(result(makePost(), "comparison_table").status).toBe("pass");
  });
  it("fails when absent for guide content_type (M4 / B6)", () => {
    const md = makePost().content_markdown.replace(/\|.*\n/g, "");
    expect(
      result(makePost({ content_type: "guide", content_markdown: md }), "comparison_table")
        .status,
    ).toBe("fail");
  });
  it("warns when absent for news content_type", () => {
    const md = makePost().content_markdown.replace(/\|.*\n/g, "");
    expect(
      result(makePost({ content_type: "news", content_markdown: md }), "comparison_table")
        .status,
    ).toBe("warn");
  });
  it("warns when absent for company content_type", () => {
    const md = makePost().content_markdown.replace(/\|.*\n/g, "");
    expect(
      result(makePost({ content_type: "company", content_markdown: md }), "comparison_table")
        .status,
    ).toBe("warn");
  });
});

function faqEntities(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    "@type": "Question",
    name: `Q${i + 1}?`,
    acceptedAnswer: { "@type": "Answer", text: `A${i + 1}` },
  }));
}

describe("Schema shape", () => {
  it("passes when guide has ≥8 FAQs (floor)", () => {
    // makePost default is 8 FAQs + content_type=guide.
    expect(result(makePost(), "schema").status).toBe("pass");
  });

  it("fails when guide has <8 FAQs (M4 / B5)", () => {
    const p = makePost({
      content_type: "guide",
      faq_json_ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqEntities(5),
      },
    });
    expect(result(p, "schema").status).toBe("fail");
  });

  it("passes when news has ≥6 FAQs (floor)", () => {
    const p = makePost({
      content_type: "news",
      faq_json_ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqEntities(6),
      },
    });
    expect(result(p, "schema").status).toBe("pass");
  });

  it("fails when news has <6 FAQs", () => {
    const p = makePost({
      content_type: "news",
      faq_json_ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqEntities(5),
      },
    });
    expect(result(p, "schema").status).toBe("fail");
  });

  it("passes when company has ≥4 FAQs (floor)", () => {
    const p = makePost({
      content_type: "company",
      faq_json_ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqEntities(4),
      },
    });
    expect(result(p, "schema").status).toBe("pass");
  });

  it("fails when company has <4 FAQs", () => {
    const p = makePost({
      content_type: "company",
      faq_json_ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqEntities(3),
      },
    });
    expect(result(p, "schema").status).toBe("fail");
  });

  it("fails when @type is wrong", () => {
    const p = makePost({
      faq_json_ld: { "@type": "WebPage", mainEntity: faqEntities(8) },
    });
    expect(result(p, "schema").status).toBe("fail");
  });
});

describe("Word count", () => {
  it("passes guide at floor (1500)", () => {
    expect(result(makePost({ content_type: "guide", word_count: 1500 }), "word_count").status)
      .toBe("pass");
  });
  it("fails guide under floor", () => {
    expect(result(makePost({ content_type: "guide", word_count: 1200 }), "word_count").status)
      .toBe("fail");
  });
  it("passes company at floor (1000)", () => {
    expect(result(makePost({ content_type: "company", word_count: 1000 }), "word_count").status)
      .toBe("pass");
  });

  it("words validator fails when below floor for content_type=news (floor 1000 after M5b)", () => {
    const r = result(makePost({ content_type: "news", word_count: 800 }), "word_count");
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/below floor/i);
  });

  it("words validator warns when above ceiling", () => {
    const r = result(makePost({ content_type: "news", word_count: 2500 }), "word_count");
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/above ceiling/i);
  });

  it("words validator passes within band for guide", () => {
    const r = result(makePost({ content_type: "guide", word_count: 1800 }), "word_count");
    expect(r.status).toBe("pass");
  });

  // Boundary tests at floor & ceiling exact values (M5b: news lowered to 1000–1500):
  it.each([
    ["news",     999, "fail"],
    ["news",    1000, "pass"],
    ["news",    1500, "pass"],
    ["news",    1501, "warn"],
    ["guide",   1499, "fail"],
    ["guide",   1500, "pass"],
    ["guide",   2500, "pass"],
    ["guide",   2501, "warn"],
    ["company",  999, "fail"],
    ["company", 1000, "pass"],
    ["company", 1800, "pass"],
    ["company", 1801, "warn"],
  ])("word_count boundary: %s @ %d words → %s", (contentType, words, expected) => {
    const r = result(
      makePost({ content_type: contentType as "news" | "guide" | "company", word_count: words }),
      "word_count",
    );
    expect(r.status).toBe(expected);
  });
});

describe("Sources", () => {
  it("passes with 3 distinct + ≥1 authoritative", () => {
    expect(result(makePost(), "sources").status).toBe("pass");
  });
  it("fails with only 2 distinct publishers", () => {
    const p = makePost({
      sources: [
        { title: "A", url: "https://aihw.gov.au/x", publisher: "AIHW", snippet: "" },
        { title: "A2", url: "https://aihw.gov.au/y", publisher: "AIHW", snippet: "" },
        { title: "A3", url: "https://aihw.gov.au/z", publisher: "AIHW", snippet: "" },
      ],
    });
    expect(result(p, "sources").status).toBe("fail");
  });
  it("fails with 3 distinct but 0 authoritative", () => {
    const p = makePost({
      sources: [
        { title: "A", url: "https://example.com/a", publisher: "Example", snippet: "" },
        { title: "B", url: "https://example.org/b", publisher: "Example", snippet: "" },
        { title: "C", url: "https://news.com.au/c", publisher: "News", snippet: "" },
      ],
    });
    expect(result(p, "sources").status).toBe("fail");
  });
  it("recognises subdomains of authoritative domains", () => {
    const p = makePost({
      sources: [
        { title: "A", url: "https://www.aihw.gov.au/a", publisher: "AIHW", snippet: "" },
        { title: "B", url: "https://reports.health.gov.au/b", publisher: "Health", snippet: "" },
        { title: "C", url: "https://news.com.au/c", publisher: "News", snippet: "" },
      ],
    });
    expect(result(p, "sources").status).toBe("pass");
  });
});

describe("isApprovable", () => {
  it("is true when no validator fails", () => {
    expect(isApprovable(runValidators(makePost()))).toBe(true);
  });
  it("is false when any validator fails (warns ok)", () => {
    const p = makePost({ ahpra_passed: false });
    expect(isApprovable(runValidators(p))).toBe(false);
  });
  it("is true even with warns (e.g. comparison table missing on news)", () => {
    const md = makePost().content_markdown.replace(/\|.*\n/g, "");
    // News + company warn (not fail) when no table. Guide fails after M4 / B6.
    const p = makePost({
      content_type: "news",
      content_markdown: md,
      // News floor for FAQs is 6 — make sure schema still passes by trimming.
      faq_json_ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqEntities(6),
      },
    });
    expect(result(p, "comparison_table").status).toBe("warn");
    expect(isApprovable(runValidators(p))).toBe(true);
  });
});
