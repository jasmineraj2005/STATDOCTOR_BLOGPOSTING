import { describe, it, expect } from "vitest";
import { aggregateWeekly, type StatsDb } from "./stats-weekly";

function makeDb(map: Record<string, Array<Record<string, unknown>>>): StatsDb {
  return {
    query: async (text: string) => {
      // Match by keyword fragments in the SQL text.
      if (text.includes("FROM posts")) return { rows: map.weekly ?? [] };
      if (text.includes("FROM gsc_daily_snapshot") && text.includes("GROUP BY query"))
        return { rows: map.top10 ?? [] };
      if (text.includes("FROM gsc_daily_snapshot") && text.includes("GROUP BY date"))
        return { rows: map.gsc_trend ?? [] };
      if (text.includes("FROM bing_daily_snapshot")) return { rows: map.bing_trend ?? [] };
      if (text.includes("FROM aeo_log")) return { rows: map.aeo ?? [] };
      return { rows: [] };
    },
  };
}

describe("aggregateWeekly", () => {
  it("Given empty GSC tables, When aggregated, Then propagating=true and arrays are empty", async () => {
    const out = await aggregateWeekly(makeDb({}));
    expect(out.propagating).toBe(true);
    expect(out.gsc_top10).toEqual([]);
    expect(out.gsc_trend).toEqual([]);
    expect(out.aeo_28d).toBe(0);
  });

  it("Given populated GSC + posts + AEO, When aggregated, Then propagating=false and counts reflect data", async () => {
    const out = await aggregateWeekly(
      makeDb({
        weekly: [
          { week: "2026-05-12", count: 3 },
          { week: "2026-05-05", count: 2 },
        ],
        top10: [
          { query: "locum nsw", clicks: 5, impressions: 200 },
          { query: "locum qld", clicks: 2, impressions: 150 },
        ],
        gsc_trend: [{ date: "2026-05-10", clicks: 1, impressions: 50 }],
        bing_trend: [{ date: "2026-05-10", clicks: 0, impressions: 12 }],
        aeo: [{ count: 12 }],
      }),
    );
    expect(out.propagating).toBe(false);
    expect(out.weekly_published).toHaveLength(2);
    expect(out.weekly_published[0]).toEqual({ week: "2026-05-12", count: 3 });
    expect(out.gsc_top10[0].query).toBe("locum nsw");
    expect(out.aeo_28d).toBe(12);
  });

  it("Given DB throws on a single query, When aggregated, Then that query degrades to empty rows", async () => {
    const flaky: StatsDb = {
      query: async (text: string) => {
        if (text.includes("FROM gsc_daily_snapshot"))
          throw new Error("relation does not exist");
        if (text.includes("FROM bing_daily_snapshot")) return { rows: [] };
        if (text.includes("FROM aeo_log")) return { rows: [{ count: 0 }] };
        return { rows: [{ week: "2026-05-12", count: 1 }] };
      },
    };
    const out = await aggregateWeekly(flaky);
    expect(out.weekly_published).toHaveLength(1);
    expect(out.gsc_top10).toEqual([]);
    expect(out.gsc_trend).toEqual([]);
    expect(out.propagating).toBe(true);
  });

  it("Given week comes back as a Date object, When aggregated, Then ISO date string is emitted", async () => {
    const out = await aggregateWeekly(
      makeDb({ weekly: [{ week: new Date("2026-05-12T00:00:00Z"), count: 4 }] }),
    );
    expect(out.weekly_published[0].week).toBe("2026-05-12");
  });
});
