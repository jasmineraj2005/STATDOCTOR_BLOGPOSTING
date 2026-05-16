import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const WHITELIST = path.join(ROOT, "data", "url-whitelist.json");

describe("url-whitelist.json", () => {
  it("exists at repo root", () => {
    expect(() => readFileSync(WHITELIST, "utf8")).not.toThrow();
  });
  it("parses as JSON", () => {
    JSON.parse(readFileSync(WHITELIST, "utf8"));
  });
  it("has required top-level keys", () => {
    const data = JSON.parse(readFileSync(WHITELIST, "utf8"));
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("domains");
    expect(data).toHaveProperty("updated_at");
  });
  it("every domain entry has the required fields", () => {
    const data = JSON.parse(readFileSync(WHITELIST, "utf8"));
    for (const d of data.domains) {
      expect(d).toMatchObject({
        domain: expect.any(String),
        tier: expect.any(String),
        rationale: expect.any(String),
        added_at: expect.any(String),
      });
    }
  });
  it("all tiers are in the closed enum", () => {
    const valid = new Set(["gov-au", "gov-nz", "peer-reviewed", "mainstream-news", "mainstream-aus", "professional-body"]);
    const data = JSON.parse(readFileSync(WHITELIST, "utf8"));
    for (const d of data.domains) {
      expect(valid.has(d.tier), `unknown tier on ${d.domain}: ${d.tier}`).toBe(true);
    }
  });
  it("no duplicate domains", () => {
    const data = JSON.parse(readFileSync(WHITELIST, "utf8"));
    const domains = data.domains.map((d: any) => d.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });
  it("minimum set present", () => {
    const data = JSON.parse(readFileSync(WHITELIST, "utf8"));
    const domains = new Set(data.domains.map((d: any) => d.domain));
    for (const required of ["theguardian.com", "ahpra.gov.au", "aihw.gov.au", "racgp.org.au", "ncbi.nlm.nih.gov"]) {
      expect(domains.has(required), `required entry missing: ${required}`).toBe(true);
    }
  });
});
