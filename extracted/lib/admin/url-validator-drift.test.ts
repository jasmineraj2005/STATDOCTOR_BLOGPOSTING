import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isWhitelisted } from "./url-validator";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE = path.join(ROOT, "data", "fixtures", "url-validation-drift.json");

type DriftCase = { url: string; expected_whitelisted: boolean; tier: string | null };
type DriftFixture = { version: number; description: string; cases: DriftCase[] };

describe("url-validator drift fixture (TS side)", () => {
  const data = JSON.parse(readFileSync(FIXTURE, "utf8")) as DriftFixture;

  it("fixture has 20 cases", () => {
    expect(data.cases).toHaveLength(20);
  });

  it("TS validator matches the drift fixture on every case", () => {
    const mismatches: string[] = [];
    for (const c of data.cases) {
      const actual = isWhitelisted(c.url);
      if (actual !== c.expected_whitelisted) {
        mismatches.push(`${JSON.stringify(c.url)}: expected ${c.expected_whitelisted}, got ${actual}`);
      }
    }
    expect(mismatches, "TS validator drift:\n" + mismatches.join("\n")).toEqual([]);
  });
});
