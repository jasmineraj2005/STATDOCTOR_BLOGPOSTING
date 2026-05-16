import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const TEST_FILE = path.resolve(__dirname, "validators.test.ts");
const VALIDATOR_FILE = path.resolve(__dirname, "validators.ts");

const REQUIRED_CHECKS = [
  "ahpra",
  "banned_phrases",
  "anchor_text",
  "callout_quota",
  "comparison_table",
  "schema",
  "word_count",
  "sources",
] as const;

// Map each check constant to the keyword that should appear in a describe
// block that covers it. These are the prose names the existing suite uses.
const DESCRIBE_KEYWORD: Record<(typeof REQUIRED_CHECKS)[number], RegExp> = {
  ahpra:             /\bAHPRA\b/i,
  banned_phrases:    /\bbanned\s+phrases?\b/i,
  anchor_text:       /\banchor\s+text\b/i,
  callout_quota:     /\bcallout\b/i,
  comparison_table:  /\b(comparison\s+table|markdown\s+table)\b/i,
  schema:            /\bschema\b/i,
  word_count:        /\bword\s+count\b/i,
  sources:           /\bsources?\b/i,
};

describe("validator test coverage", () => {
  const file = readFileSync(TEST_FILE, "utf8");
  const validatorSource = readFileSync(VALIDATOR_FILE, "utf8");

  it("validators.ts still exports the 8 known check names (drift guard)", () => {
    for (const name of REQUIRED_CHECKS) {
      expect(validatorSource).toMatch(new RegExp(`["']${name}["']`));
    }
  });

  for (const check of REQUIRED_CHECKS) {
    const kw = DESCRIBE_KEYWORD[check];

    it(`has a describe block covering '${check}'`, () => {
      const re = new RegExp(`describe\\(\\s*["'\`][^"'\`]*${kw.source}`, "i");
      expect(file).toMatch(re);
    });

    it(`has a positive (passes) test for '${check}'`, () => {
      // Locate the describe block for this check, then check for a passing case.
      const blockRe = new RegExp(
        `describe\\(\\s*["'\`][^"'\`]*${kw.source}[\\s\\S]*?\\n\\}\\);`,
        "i",
      );
      const block = file.match(blockRe)?.[0] ?? "";
      expect(block, `no describe block for ${check}`).not.toBe("");
      // A positive test mentions "pass" in its name (passes / passing).
      expect(block).toMatch(/it\(\s*["'\`][^"'\`]*pass/i);
    });

    it(`has a negative (fails/warns) test for '${check}'`, () => {
      const blockRe = new RegExp(
        `describe\\(\\s*["'\`][^"'\`]*${kw.source}[\\s\\S]*?\\n\\}\\);`,
        "i",
      );
      const block = file.match(blockRe)?.[0] ?? "";
      expect(block, `no describe block for ${check}`).not.toBe("");
      // A negative test mentions fail/fails or warn/warns.
      expect(block).toMatch(/it\(\s*["'\`][^"'\`]*(fail|warn)/i);
    });
  }
});
