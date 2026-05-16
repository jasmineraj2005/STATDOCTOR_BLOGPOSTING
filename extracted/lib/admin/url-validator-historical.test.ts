import { describe, it, expect, vi } from "vitest";
import { isWhitelisted, validateSources } from "./url-validator";

const OFF_LIST_FABRICATED = [
  "https://www.energy.gov.au/national-fuel-security-plan",
  "https://www.doh.gov.au/reports/fuel-costs-medical-supply-chains",
];
const ON_LIST_FAKE_PATH = [
  "https://www.aihw.gov.au/reports/healthcare-delivery/fuel-price-impact",
  "https://www.abs.gov.au/statistics/economic-impact-fuel-prices",
  "https://www.ama.com.au/policy/locum-support",
];

describe("fuel-prices historical regression (TS side)", () => {
  describe.each(OFF_LIST_FABRICATED)("off-whitelist fabricated %s", (url) => {
    it("is rejected by isWhitelisted", () => {
      expect(isWhitelisted(url)).toBe(false);
    });
  });

  describe.each(ON_LIST_FAKE_PATH)("on-whitelist fake-path %s", (url) => {
    it("passes isWhitelisted but is dropped by validateSources on 404", async () => {
      expect(isWhitelisted(url)).toBe(true);
      const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
      const result = await validateSources([{ url, publisher: "Test" }], { fetcher });
      expect(result.okSources).toEqual([]);
      expect(result.flags.some((f) => f.type === "source_unreachable")).toBe(true);
    });
  });

  it("full fuel-prices article: all 5 sources rejected", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const sources = [
      ...OFF_LIST_FABRICATED.map((url) => ({ url, publisher: "Test" })),
      ...ON_LIST_FAKE_PATH.map((url) => ({ url, publisher: "Test" })),
    ];
    const result = await validateSources(sources, { fetcher });
    expect(result.okSources).toEqual([]);
    expect(result.totalInput).toBe(5);
    expect(result.totalOk).toBe(0);
    expect(result.flags.length).toBeGreaterThanOrEqual(5);
  });
});
