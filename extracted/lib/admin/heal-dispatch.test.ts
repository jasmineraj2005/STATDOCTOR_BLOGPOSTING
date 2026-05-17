import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hasFixableFailures, dispatchHealWorkflow } from "./heal-dispatch";
import type { ValidationResult } from "./validators";

const greenResult = (check: string): ValidationResult => ({
  check: check as ValidationResult["check"],
  label: check,
  status: "pass",
  detail: "ok",
});

const redResult = (check: string): ValidationResult => ({
  check: check as ValidationResult["check"],
  label: check,
  status: "fail",
  detail: "broke",
});

describe("hasFixableFailures", () => {
  it("Given a red word_count, When checked, Then returns true", () => {
    expect(hasFixableFailures([redResult("word_count")])).toBe(true);
  });
  it("Given only a red sources (not fixable), When checked, Then returns false", () => {
    expect(hasFixableFailures([redResult("sources")])).toBe(false);
  });
  it("Given all-green, When checked, Then returns false", () => {
    expect(hasFixableFailures([greenResult("word_count"), greenResult("ahpra")])).toBe(false);
  });
  it("Given a mix of fixable + non-fixable reds, When checked, Then returns true", () => {
    expect(
      hasFixableFailures([redResult("sources"), redResult("banned_phrases")]),
    ).toBe(true);
  });
});

describe("dispatchHealWorkflow", () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.HEAL_DISPATCH_REPO = "owner/repo";
    process.env.HEAL_DISPATCH_REF = "main";
    process.env.HEAL_DISPATCH_TOKEN = "token-123";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Given no fixable failures, When dispatched, Then returns no_op (does not call fetch)", async () => {
    const out = await dispatchHealWorkflow("slug-x", [greenResult("word_count")]);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.dispatched).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Given HEAL_DISPATCH_TOKEN missing, When dispatched with fixable red, Then returns heal_disabled", async () => {
    delete process.env.HEAL_DISPATCH_TOKEN;
    const out = await dispatchHealWorkflow("slug-x", [redResult("word_count")]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("heal_disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Given valid env + fixable red, When dispatched, Then POSTs to GitHub workflow_dispatch and returns dispatched=true", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    const out = await dispatchHealWorkflow("slug-x", [redResult("word_count"), redResult("anchor_text")]);
    expect(out.ok).toBe(true);
    if (out.ok && out.dispatched) {
      expect(out.failures).toEqual(["word_count", "anchor_text"]);
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/owner/repo/actions/workflows/heal.yml/dispatches");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ ref: "main", inputs: { slug: "slug-x" } });
    expect(init.headers.Authorization).toBe("Bearer token-123");
  });

  it("Given GitHub API returns 422, When dispatched, Then returns dispatch_failed with status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => "ref not found" });
    const out = await dispatchHealWorkflow("slug-x", [redResult("word_count")]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("dispatch_failed");
      if (out.reason === "dispatch_failed") {
        expect(out.status).toBe(422);
        expect(out.detail).toContain("ref not found");
      }
    }
  });
});
