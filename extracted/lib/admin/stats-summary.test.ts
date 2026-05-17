import { describe, it, expect } from "vitest";
import { computeStatsSummary, type StatsSummaryDb } from "./stats-summary";

function makeDb(map: Record<string, number>): StatsSummaryDb {
  return {
    query: async (_text: string, values?: unknown[]) => {
      const status = String(values?.[0] ?? "");
      return { rows: [{ count: map[status] ?? 0 }] };
    },
  };
}

describe("computeStatsSummary", () => {
  it("Given no DB, When summary computed, Then post counts are 0 and constants are present", async () => {
    const summary = await computeStatsSummary(null);
    expect(summary.posts_published).toBe(0);
    expect(summary.posts_pending).toBe(0);
    expect(summary.fail_agent_layers).toBe(4);
    expect(summary.pipeline_agents).toBe(5);
    expect(summary.test_count).toBeGreaterThan(0);
    expect(summary.url_whitelist_size).toBeGreaterThan(0); // real file should exist
  });

  it("Given DB returns published=12, pending=3, When summary computed, Then counters reflect that", async () => {
    const summary = await computeStatsSummary(
      makeDb({ published: 12, pending_review: 3 }),
    );
    expect(summary.posts_published).toBe(12);
    expect(summary.posts_pending).toBe(3);
  });

  it("Given DB throws, When summary computed, Then post counts degrade to 0 without throwing", async () => {
    const flaky: StatsSummaryDb = {
      query: async () => {
        throw new Error("relation posts does not exist");
      },
    };
    const summary = await computeStatsSummary(flaky);
    expect(summary.posts_published).toBe(0);
    expect(summary.posts_pending).toBe(0);
    expect(summary.fail_agent_layers).toBe(4);
  });
});
