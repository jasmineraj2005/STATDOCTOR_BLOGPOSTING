import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkWeeklyInvariants,
  type DbLike,
  type Invariant,
} from "./weekly-invariants";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal DbLike mock that returns canned responses per query snippet. */
function buildDb(responses: Map<string, { rows: Record<string, unknown>[] }>): DbLike & {
  insertedAlerts: { kind: string; detail: string }[];
} {
  const insertedAlerts: { kind: string; detail: string }[] = [];

  return {
    insertedAlerts,
    async query(text: string, values?: unknown[]) {
      // Route to appropriate mock response based on query keywords
      if (text.includes("audit_events")) {
        const r = responses.get("audit_events") ?? { rows: [{ n: 0 }] };
        return { rows: r.rows, rowCount: r.rows.length };
      }
      if (text.includes("sunday_batch_reports")) {
        const r = responses.get("sunday_batch_reports") ?? { rows: [] };
        return { rows: r.rows, rowCount: r.rows.length };
      }
      if (text.includes("posts") && text.includes("scheduled")) {
        const r = responses.get("posts_scheduled") ?? { rows: [{ n: 0 }] };
        return { rows: r.rows, rowCount: r.rows.length };
      }
      if (text.includes("INSERT INTO alerts")) {
        const kind = (values as string[])[0];
        const detail = (values as string[])[1];
        insertedAlerts.push({ kind, detail });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const NOW = new Date("2026-05-18T19:00:00Z");

// ── stale_review ──────────────────────────────────────────────────────────────

describe("checkWeeklyInvariants — stale_review", () => {
  it("returns ok when there are recent review events", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 5 }] }],
        ["posts_scheduled", { rows: [{ n: 0 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    const inv = results.find((r: Invariant) => r.name === "stale_review")!;
    expect(inv.status).toBe("ok");
    expect(db.insertedAlerts.some((a) => a.kind === "invariant:stale_review")).toBe(false);
  });

  it("returns breach and inserts alert when no recent review events", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 0 }] }],
        ["posts_scheduled", { rows: [{ n: 0 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    const inv = results.find((r: Invariant) => r.name === "stale_review")!;
    expect(inv.status).toBe("breach");
    expect(db.insertedAlerts.some((a) => a.kind === "invariant:stale_review")).toBe(true);
  });
});

// ── low_approve_rate ──────────────────────────────────────────────────────────

describe("checkWeeklyInvariants — low_approve_rate", () => {
  it("returns ok with fewer than 4 history rows (not enough data)", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 10 }] }],
        [
          "sunday_batch_reports",
          { rows: [{ approve_as_is_rate: 0.9 }, { approve_as_is_rate: 0.85 }] },
        ],
        ["posts_scheduled", { rows: [{ n: 0 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    const inv = results.find((r: Invariant) => r.name === "low_approve_rate")!;
    expect(inv.status).toBe("ok");
    expect(inv.detail).toContain("2");
  });

  it("returns breach when average of last 4 batches < 0.95", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 10 }] }],
        [
          "sunday_batch_reports",
          {
            rows: [
              { approve_as_is_rate: 0.8 },
              { approve_as_is_rate: 0.85 },
              { approve_as_is_rate: 0.9 },
              { approve_as_is_rate: 0.88 },
            ],
          },
        ],
        ["posts_scheduled", { rows: [{ n: 0 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    const inv = results.find((r: Invariant) => r.name === "low_approve_rate")!;
    expect(inv.status).toBe("breach");
    expect(inv.detail).toContain("85.8%"); // (0.8+0.85+0.9+0.88)/4 = 0.8575 → 85.8%
    expect(db.insertedAlerts.some((a) => a.kind === "invariant:low_approve_rate")).toBe(true);
  });

  it("returns ok when average >= 0.95", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 10 }] }],
        [
          "sunday_batch_reports",
          {
            rows: [
              { approve_as_is_rate: 0.95 },
              { approve_as_is_rate: 1.0 },
              { approve_as_is_rate: 0.96 },
              { approve_as_is_rate: 0.98 },
            ],
          },
        ],
        ["posts_scheduled", { rows: [{ n: 0 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    const inv = results.find((r: Invariant) => r.name === "low_approve_rate")!;
    expect(inv.status).toBe("ok");
  });

  it("treats missing sunday_batch_reports table as ok (pre-first-deploy)", async () => {
    // db that throws on sunday_batch_reports query
    const insertedAlerts: { kind: string; detail: string }[] = [];
    const db: DbLike & { insertedAlerts: typeof insertedAlerts } = {
      insertedAlerts,
      async query(text: string, values?: unknown[]) {
        if (text.includes("sunday_batch_reports")) {
          throw new Error("relation does not exist");
        }
        if (text.includes("audit_events")) {
          return { rows: [{ n: 5 }], rowCount: 1 };
        }
        if (text.includes("INSERT INTO alerts")) {
          const kind = (values as string[])[0];
          const detail = (values as string[])[1];
          insertedAlerts.push({ kind, detail });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [{ n: 0 }], rowCount: 1 };
      },
    };
    const results = await checkWeeklyInvariants({ now: NOW, db });
    const inv = results.find((r: Invariant) => r.name === "low_approve_rate")!;
    expect(inv.status).toBe("ok");
  });
});

// ── publish_backlog ───────────────────────────────────────────────────────────

describe("checkWeeklyInvariants — publish_backlog", () => {
  it("returns ok when 3 or fewer articles stuck in scheduled > 48h", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 5 }] }],
        ["posts_scheduled", { rows: [{ n: 3 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    const inv = results.find((r: Invariant) => r.name === "publish_backlog")!;
    expect(inv.status).toBe("ok");
  });

  it("returns breach and inserts alert when more than 3 articles stuck", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 5 }] }],
        ["posts_scheduled", { rows: [{ n: 4 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    const inv = results.find((r: Invariant) => r.name === "publish_backlog")!;
    expect(inv.status).toBe("breach");
    expect(inv.detail).toContain("4");
    expect(db.insertedAlerts.some((a) => a.kind === "invariant:publish_backlog")).toBe(true);
  });
});

// ── overall shape ────────────────────────────────────────────────────────────

describe("checkWeeklyInvariants — result shape", () => {
  it("always returns 3 invariants in order: stale_review, low_approve_rate, publish_backlog", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 5 }] }],
        ["sunday_batch_reports", { rows: [] }],
        ["posts_scheduled", { rows: [{ n: 0 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    expect(results).toHaveLength(3);
    expect(results[0].name).toBe("stale_review");
    expect(results[1].name).toBe("low_approve_rate");
    expect(results[2].name).toBe("publish_backlog");
  });

  it("each invariant has name, status ('ok'|'breach'), and non-empty detail", async () => {
    const db = buildDb(
      new Map([
        ["audit_events", { rows: [{ n: 5 }] }],
        ["posts_scheduled", { rows: [{ n: 0 }] }],
      ]),
    );
    const results = await checkWeeklyInvariants({ now: NOW, db });
    for (const inv of results) {
      expect(typeof inv.name).toBe("string");
      expect(["ok", "breach"]).toContain(inv.status);
      expect(inv.detail.length).toBeGreaterThan(0);
    }
  });
});
