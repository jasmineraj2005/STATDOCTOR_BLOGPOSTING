/**
 * Drift test: validators.ts compiles its FORBIDDEN list directly from
 * validators.json. Mirrors backend/tests/test_banned_phrase_drift.py on the
 * TypeScript side. Closes Bug B2 (docs/bugs.md).
 *
 * Pre-M3: Python writer.py hardcoded a subset of the JSON patterns.
 * Post-M3: both languages read from validators.json as single source of truth.
 * This test enforces the TS side stays wired.
 */
import { describe, expect, it } from "vitest";
import validatorsConfig from "./validators.json";
import { runValidators } from "./validators";
import type { Post } from "./types";

const EXPECTED_AHPRA_BANNED_COUNT = 11;
const EXPECTED_EDITORIALLY_BANNED_COUNT = 4;

const CANONICAL_PHRASES_THAT_MUST_BE_FLAGGED: { name: string; phrase: string }[] = [
  { name: "best doctor", phrase: "We're the best doctor in town." },
  { name: "number one", phrase: "We're number one in Sydney." },
  { name: "#1", phrase: "Sydney's #1 locum platform." },
  { name: "leading specialist", phrase: "Meet our leading specialist." },
  { name: "most experienced", phrase: "Our most experienced clinicians." },
  { name: "world-class", phrase: "World-class clinicians here." },
  { name: "Australia's leading", phrase: "Australia's leading marketplace." },
  { name: "guaranteed results", phrase: "We deliver guaranteed results." },
  { name: "cure", phrase: "A cure for the GP shortage." },
  { name: "testimonial", phrase: "Read this testimonial from a patient." },
  { name: "endorsement from patient", phrase: "An endorsement from a patient." },
];

function makePost(overrides: Partial<Post> = {}): Post {
  const base: Post = {
    title: "Locum Drift Test",
    slug: "drift-test",
    meta_title: "Drift",
    meta_description: "Drift body.",
    focus_keyword: "locum drift",
    og_image_alt: "alt",
    content_markdown: [
      "**TL;DR:** test",
      "",
      "## Background",
      "",
      "[AHPRA registration](https://www.ahpra.gov.au/) is the entry point.",
      "",
      "> [KEY FACTS] facts.",
      "",
      "> [INFO] info.",
      "",
      "> [AU] [NSW Health](https://www.health.nsw.gov.au/) sets the floor.",
      "",
      "> [KEY TAKEAWAY] tk.",
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
    tldr: "Test",
    pillar: "locum_pay_rates",
    content_type: "guide",
    target_keywords: ["locum drift"],
    keywords: ["locum drift"],
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
    generated_at: "2026-05-18T00:00:00Z",
    dateModified: "2026-05-18T00:00:00Z",
  };
  return { ...base, ...overrides };
}

describe("banned-phrase drift", () => {
  it("validators.json has the documented 11 ahpra_banned patterns", () => {
    expect(validatorsConfig.ahpra_banned.length).toBe(EXPECTED_AHPRA_BANNED_COUNT);
  });

  it("validators.json has the documented 4 editorially_banned patterns", () => {
    expect(validatorsConfig.editorially_banned.length).toBe(EXPECTED_EDITORIALLY_BANNED_COUNT);
  });

  it("every pattern in validators.json compiles to a valid JS RegExp", () => {
    for (const entry of validatorsConfig.ahpra_banned) {
      expect(() => new RegExp(entry.pattern, "i")).not.toThrow();
    }
    for (const entry of validatorsConfig.editorially_banned) {
      expect(() => new RegExp(entry.pattern, "i")).not.toThrow();
    }
  });

  for (const c of CANONICAL_PHRASES_THAT_MUST_BE_FLAGGED) {
    it(`runValidators flags ${c.name}`, () => {
      const post = makePost({
        content_markdown:
          makePost().content_markdown + "\n\n## Stray section\n\n" + c.phrase,
      });
      const res = runValidators(post).find((r) => r.check === "banned_phrases");
      expect(res?.status).toBe("fail");
    });
  }
});
