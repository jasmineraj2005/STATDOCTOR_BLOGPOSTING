/**
 * Heal-Agent end-to-end smoke test (offline).
 *
 * Walks a deliberately-broken article through every code path the production
 * flow will hit:
 *   1. Layer C ingest gate (word_count + sources + schema check)
 *   2. runValidators (full 8-validator panel)
 *   3. hasFixableFailures (which reds the heal-agent can patch)
 *   4. dispatchHealWorkflow with mocked fetch — verify GH API call shape
 *   5. canary fixture passes Layer C (sanity-check the green path)
 *
 * No network. No OpenAI spend. Just code paths.
 *
 * Run: npx vitest run scripts/heal-smoke.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runValidators } from "@/lib/admin/validators";
import { hasFixableFailures, dispatchHealWorkflow } from "@/lib/admin/heal-dispatch";
import { runIngestGate } from "@/app/api/admin/ingest/gate";
import { buildCanaryPost } from "@/lib/admin/canary-fixture";
import type { Post } from "@/lib/admin/types";

const BROKEN_POST: Post = {
  title: "Locum work in NSW: pay, rates and hotspots",
  slug: "smoketest-broken-2026-05-17",
  meta_title: "Locum NSW pay",
  meta_description: "About locum work in NSW.",
  focus_keyword: "locum nsw",
  og_image_alt: "NSW hospital",
  // ↓ deliberately under guide floor (1500), with banned phrase, bad anchor,
  //   no callouts, no table, weak FAQ.
  content_markdown:
    "Locum doctors are the best doctor option for regional NSW. " +
    "Read [here](https://example.com/rates) for rates. " +
    "Click here for more info on [source](https://racgp.org.au/locum). " +
    "Pay varies. ".repeat(40),
  tldr: "Short summary",
  pillar: "locum_work",
  content_type: "guide",
  target_keywords: ["locum", "nsw"],
  word_count: 600, // ← below guide floor 1500
  reading_time_minutes: 3,
  sources: [
    { url: "https://ahpra.gov.au/x", title: "AHPRA", publisher: "AHPRA", snippet: "s" },
    { url: "https://racgp.org.au/y", title: "RACGP", publisher: "RACGP", snippet: "s" },
  ],
  image_url: null,
  image_credit: null,
  faq_json_ld: { "@type": "FAQPage", mainEntity: [] }, // ← no questions
  medical_webpage_schema: {},
  ahpra_flags: [],
  ahpra_passed: false, // ← AHPRA flagged this
  status: "pending_review",
  generated_at: "2026-05-17T10:00:00Z",
  dateModified: "2026-05-17T10:00:00Z",
} as Post;

describe("HEAL SMOKE 1 — Layer C ingest gate catches deliberate breaks", () => {
  it("Given a broken post, When gated, Then word_count + source_count fire", () => {
    const errs = runIngestGate(BROKEN_POST);
    const checks = errs.map((e) => e.check);
    console.log("\n[smoke/1] Layer C gate errors on broken post:", JSON.stringify(errs, null, 2));
    expect(checks).toContain("word_count");
    expect(checks).toContain("source_count");
  });
});

describe("HEAL SMOKE 2 — runValidators marks the right validators red", () => {
  it("Given a broken post, When runValidators, Then the 8-panel surfaces all expected fails", () => {
    const results = runValidators(BROKEN_POST);
    const reds = results.filter((r) => r.status === "fail").map((r) => r.check);
    console.log("\n[smoke/2] runValidators results on broken post:");
    results.forEach((r) => console.log(`  ${r.status.toUpperCase().padEnd(4)} ${r.check.padEnd(20)} ${r.detail}`));
    expect(reds).toContain("word_count");
    expect(reds).toContain("banned_phrases");
    expect(reds).toContain("anchor_text");
    expect(reds).toContain("callout_quota");
    expect(reds).toContain("schema");
    expect(reds).toContain("sources");
  });
});

describe("HEAL SMOKE 3 — hasFixableFailures distinguishes fixable vs non-fixable", () => {
  it("Given the 8-panel results, When checked, Then auto-heal would fire (fixables present)", () => {
    const results = runValidators(BROKEN_POST);
    const fixable = hasFixableFailures(results);
    console.log(
      "\n[smoke/3] hasFixableFailures =",
      fixable,
      "(would auto-fire heal? yes if true)",
    );
    expect(fixable).toBe(true);
  });
});

describe("HEAL SMOKE 4 — dispatchHealWorkflow fires the right GH API call", () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.HEAL_DISPATCH_REPO = "jasmineraj2005/STATDOCTOR_BLOGPOSTING";
    process.env.HEAL_DISPATCH_REF = "main";
    process.env.HEAL_DISPATCH_TOKEN = "fake-pat-for-smoke-test";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("Given broken post + token, When dispatched, Then POSTs to GitHub with the right body", async () => {
    const results = runValidators(BROKEN_POST);
    const outcome = await dispatchHealWorkflow(BROKEN_POST.slug, results);

    console.log("\n[smoke/4] Dispatch outcome:", JSON.stringify(outcome, null, 2));

    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.dispatched) {
      expect(outcome.failures).toEqual(
        expect.arrayContaining(["word_count", "banned_phrases", "anchor_text", "callout_quota"]),
      );
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    console.log("[smoke/4] GitHub API URL:", url);
    console.log("[smoke/4] GitHub API body:", init.body);
    expect(url).toBe(
      "https://api.github.com/repos/jasmineraj2005/STATDOCTOR_BLOGPOSTING/actions/workflows/heal.yml/dispatches",
    );
    expect(JSON.parse(init.body)).toEqual({
      ref: "main",
      inputs: { slug: BROKEN_POST.slug },
    });
    expect(init.headers.Authorization).toBe("Bearer fake-pat-for-smoke-test");
  });
});

describe("HEAL SMOKE 5 — canary fixture is the green-path reference", () => {
  it("Given the synthetic canary post, When gated, Then NO Layer C errors", () => {
    const canary = buildCanaryPost(new Date("2026-05-17T04:00:00Z"));
    const gateErrors = runIngestGate(canary);
    console.log(
      "\n[smoke/5] canary fixture Layer C errors:",
      gateErrors.length === 0 ? "NONE (green path ✓)" : gateErrors,
    );
    expect(gateErrors).toEqual([]);
  });

  it("Given the canary post, When runValidators, Then mostly green (some warns ok)", () => {
    const canary = buildCanaryPost(new Date("2026-05-17T04:00:00Z"));
    const results = runValidators(canary);
    const reds = results.filter((r) => r.status === "fail").map((r) => r.check);
    console.log("\n[smoke/5] canary runValidators reds:", reds.length === 0 ? "NONE" : reds);
    // Canary is intentionally minimal; ahpra/banned/anchor/word/sources should pass.
    // It might fail callout_quota or schema since it's filler — that's expected.
    expect(reds).not.toContain("word_count");
    expect(reds).not.toContain("banned_phrases");
    expect(reds).not.toContain("anchor_text");
    expect(reds).not.toContain("sources");
  });
});
