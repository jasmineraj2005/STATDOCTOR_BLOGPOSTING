/**
 * banner.test.ts — Unit tests for lib/admin/banner.ts (M7)
 *
 * Tests each banner state + precedence ordering.
 * All DB calls are injected as mocks — no real DB needed.
 */

import { describe, it, expect, vi } from "vitest";
import { computeBannerState } from "./banner";
import type { BannerDb } from "./banner";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date("2026-05-16T10:00:00.000Z");

/**
 * Build a mock DB that returns specific query results in order.
 * Queries are called in this order by computeBannerState:
 *   1. publish_failed count
 *   2. cron_stale check
 *   3. stale_review check (last_reviewed_at)
 *   4. pending_review count
 */
function makeDb(responses: Array<{ rows: Array<Record<string, unknown>> }>): BannerDb {
  let callIndex = 0;
  const queryMock = vi.fn().mockImplementation(() => {
    const response = responses[callIndex] ?? { rows: [] };
    callIndex++;
    return Promise.resolve(response);
  });
  return { query: queryMock as unknown as BannerDb["query"] };
}

/** Helpers for common DB response patterns */
const NO_PUBLISH_FAILED = { rows: [{ count: 0 }] };
const NO_CRON_STALE = { rows: [] };
const RECENT_REVIEW = { rows: [{ last_review: new Date(FIXED_NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() }] };
const NO_PENDING = { rows: [{ count: 0 }] };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeBannerState", () => {
  describe("publish_failed state (highest priority)", () => {
    it("returns publish_failed when there are publish_failed posts", async () => {
      const db = makeDb([
        { rows: [{ count: 3 }] }, // publish_failed count = 3
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state).toEqual({ kind: "publish_failed", count: 3 });
    });

    it("returns publish_failed even when there are also stale cronsand pending posts", async () => {
      // publish_failed wins over everything
      const db = makeDb([
        { rows: [{ count: 2 }] }, // publish_failed wins → no further queries needed
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).toBe("publish_failed");
    });
  });

  describe("cron_stale state", () => {
    it("returns cron_stale when a cron has not run in > 26h", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        { rows: [{ kind: "scheduled-publish", age_hours: 30 }] }, // stale!
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state).toEqual({
        kind: "cron_stale",
        cronName: "scheduled-publish",
        ageHours: 30,
      });
    });

    it("does NOT return cron_stale when all cronsrun recently", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        RECENT_REVIEW,
        NO_PENDING,
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).not.toBe("cron_stale");
    });

    it("cron_stale beats stale_review", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        { rows: [{ kind: "daily-digest", age_hours: 48 }] }, // cron stale wins
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).toBe("cron_stale");
    });
  });

  describe("stale_review state", () => {
    it("returns stale_review when last review was > 7 days ago", async () => {
      const eightDaysAgo = new Date(FIXED_NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        { rows: [{ last_review: eightDaysAgo.toISOString() }] },
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state).toMatchObject({ kind: "stale_review", daysSinceLastReview: 8 });
    });

    it("returns stale_review with large daysSince when no reviews ever", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        { rows: [{ last_review: null }] },
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).toBe("stale_review");
      if (state.kind === "stale_review") {
        expect(state.daysSinceLastReview).toBeGreaterThan(100);
      }
    });

    it("does NOT return stale_review when review was recent (2 days ago)", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        RECENT_REVIEW,
        NO_PENDING,
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).not.toBe("stale_review");
    });

    it("stale_review beats needs_review_high", async () => {
      const eightDaysAgo = new Date(FIXED_NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        { rows: [{ last_review: eightDaysAgo.toISOString() }] },
        // No need to reach pending check
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).toBe("stale_review");
    });
  });

  describe("needs_review_high state", () => {
    it("returns needs_review_high when pending count > 5", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        RECENT_REVIEW,
        { rows: [{ count: 7 }] }, // > threshold
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state).toEqual({ kind: "needs_review_high", count: 7 });
    });

    it("does NOT return needs_review_high when count <= 5", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        RECENT_REVIEW,
        { rows: [{ count: 5 }] }, // exactly at threshold, not > threshold
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).not.toBe("needs_review_high");
    });
  });

  describe("none state", () => {
    it("returns none when everything is healthy", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        RECENT_REVIEW,
        NO_PENDING,
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state).toEqual({ kind: "none" });
    });
  });

  describe("precedence ordering", () => {
    it("publish_failed > cron_stale", async () => {
      const db = makeDb([
        { rows: [{ count: 1 }] }, // publish_failed wins immediately
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).toBe("publish_failed");
    });

    it("cron_stale > stale_review (when cron stale)", async () => {
      const db = makeDb([
        NO_PUBLISH_FAILED,
        { rows: [{ kind: "daily-digest", age_hours: 27 }] },
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).toBe("cron_stale");
    });

    it("stale_review > needs_review_high", async () => {
      const oldReview = new Date(FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
      const db = makeDb([
        NO_PUBLISH_FAILED,
        NO_CRON_STALE,
        { rows: [{ last_review: oldReview.toISOString() }] }, // stale_review fires here
      ]);
      const state = await computeBannerState(db, FIXED_NOW);
      expect(state.kind).toBe("stale_review");
    });
  });
});
