import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("coverage gates", () => {
  it("vitest.config.ts has coverage thresholds set per surface", () => {
    const cfg = readFileSync(path.join(REPO_ROOT, "extracted/vitest.config.ts"), "utf8");
    expect(cfg).toMatch(/lib\/admin/);
    expect(cfg).toMatch(/lib\/seo/);
    expect(cfg).toMatch(/thresholds/);
  });
  it("CI workflow runs vitest, playwright, and pytest", () => {
    const ciPath = path.join(REPO_ROOT, ".github/workflows/ci.yml");
    expect(existsSync(ciPath)).toBe(true);
    const ci = readFileSync(ciPath, "utf8");
    expect(ci).toMatch(/pnpm test/);
    expect(ci).toMatch(/playwright/);
    expect(ci).toMatch(/pytest/);
  });
});
