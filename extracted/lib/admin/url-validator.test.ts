import { describe, it, expect, vi } from "vitest";
import { isWhitelisted, headCheck, validateSources } from "./url-validator";

// ── isWhitelisted ─────────────────────────────────────────────────────────────

describe("isWhitelisted", () => {
  it("returns true for root domain", () => {
    expect(isWhitelisted("https://theguardian.com/x")).toBe(true);
  });
  it("returns true for www-prefixed", () => {
    expect(isWhitelisted("https://www.theguardian.com/x")).toBe(true);
  });
  it("returns true for subdomain of whitelisted root", () => {
    expect(isWhitelisted("https://www1.aihw.gov.au/reports/x")).toBe(true);
  });
  it("returns false for unknown domain", () => {
    expect(isWhitelisted("https://made-up-domain.example.com/x")).toBe(false);
  });
  it("returns false for unparseable URL", () => {
    expect(isWhitelisted("not a url at all")).toBe(false);
  });
  it("is case insensitive", () => {
    expect(isWhitelisted("https://THEGUARDIAN.COM/x")).toBe(true);
  });
});

// ── headCheck ─────────────────────────────────────────────────────────────────

describe("headCheck", () => {
  it("returns ok for 200", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const r = await headCheck("https://theguardian.com/a", { fetcher });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.reason).toBe("ok");
    expect(r.attempts).toBe(1);
  });

  it("drops 404 without retry", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const r = await headCheck("https://theguardian.com/dead", { fetcher, retries: 1, sleeper: async () => {} });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.reason).toBe("http_404");
    expect(r.attempts).toBe(1);
  });

  it("retries 5xx then succeeds", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const sleeper = vi.fn(async () => {});
    const r = await headCheck("https://theguardian.com/x", { fetcher, retries: 1, sleeper });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(sleeper).toHaveBeenCalledTimes(1);
  });

  it("surfaces 5xx after retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const sleeper = vi.fn(async () => {});
    const r = await headCheck("https://theguardian.com/x", { fetcher, retries: 1, sleeper });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.reason).toBe("http_5xx");
    expect(r.attempts).toBe(2);
  });

  it("retries 429", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    const sleeper = vi.fn(async () => {});
    const r = await headCheck("https://theguardian.com/x", { fetcher, retries: 2, sleeper });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(r.attempts).toBe(3);
  });

  it("surfaces timeout", async () => {
    const fetcher = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const r = await headCheck("https://theguardian.com/x", { fetcher, retries: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout");
    expect(r.status).toBeNull();
  });

  it("surfaces generic connect_error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const r = await headCheck("https://theguardian.com/x", { fetcher, retries: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("connect_error");
  });
});

// ── validateSources ───────────────────────────────────────────────────────────

describe("validateSources", () => {
  const okFetcher = () => vi.fn().mockResolvedValue(new Response("", { status: 200 }));

  it("keeps all whitelisted 200", async () => {
    const sources = [
      { url: "https://theguardian.com/a", publisher: "Guardian" },
      { url: "https://abc.net.au/b", publisher: "ABC" },
    ];
    const r = await validateSources(sources, { fetcher: okFetcher() });
    expect(r.okSources).toHaveLength(2);
    expect(r.flags).toEqual([]);
    expect(r.totalInput).toBe(2);
    expect(r.totalOk).toBe(2);
  });

  it("drops non-whitelisted", async () => {
    const sources = [
      { url: "https://theguardian.com/a", publisher: "Guardian" },
      { url: "https://made-up.example.com/b", publisher: "Fake" },
    ];
    const r = await validateSources(sources, { fetcher: okFetcher() });
    expect(r.okSources).toHaveLength(1);
    expect(r.flags.some((f) => f.type === "source_not_in_whitelist")).toBe(true);
  });

  it("drops 404 and flags it", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      return new Response("", { status: u.includes("/dead") ? 404 : 200 });
    });
    const sources = [
      { url: "https://theguardian.com/ok", publisher: "Guardian" },
      { url: "https://theguardian.com/dead", publisher: "Guardian" },
    ];
    const r = await validateSources(sources, { fetcher });
    expect(r.okSources).toHaveLength(1);
    expect(r.flags.some((f) => f.type === "source_unreachable" && f.url.includes("dead"))).toBe(true);
  });

  it("preserves input order in okSources", async () => {
    const sources = [
      { url: "https://abc.net.au/1", publisher: "ABC" },
      { url: "https://theguardian.com/2", publisher: "Guardian" },
      { url: "https://aihw.gov.au/3", publisher: "AIHW" },
    ];
    const r = await validateSources(sources, { fetcher: okFetcher() });
    expect(r.okSources.map((s) => s.url)).toEqual(sources.map((s) => s.url));
  });
});
