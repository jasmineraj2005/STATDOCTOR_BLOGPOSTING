import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db BEFORE importing the route.
vi.mock("@/lib/admin/db", () => ({
  sql: vi.fn(),
  isDbConfigured: vi.fn(),
}));

// Mock cron recorder so tests don't touch the DB.
vi.mock("@/lib/admin/cron", () => ({
  recordCronRun: vi.fn().mockResolvedValue(undefined),
}));

// Mock global fetch so Resend calls don't fire real HTTP.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { sql, isDbConfigured } from "@/lib/admin/db";
import { GET } from "./route";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockIsDb = isDbConfigured as unknown as ReturnType<typeof vi.fn>;

/**
 * Helper: sets up mockSql to return results in invocation order.
 * The daily-digest route calls sql in this order:
 *   1. audit_events  (action counts)
 *   2. posts         (status backlog)
 *   3. cron_runs     (heartbeat)
 *   4. alerts        (unacked alerts)
 *   5. url_flags     (URL rejection counts — NEW)
 *
 * After the change, the order will include the new query.
 * We stub them all so the route can finish and we can inspect the body.
 */
function setupMockSql(opts: {
  urlFlagsRows: { type: string; n: number }[];
}) {
  mockSql
    // 1. audit_events
    .mockResolvedValueOnce({ rows: [] })
    // 2. posts status backlog
    .mockResolvedValueOnce({ rows: [{ status: "pending_review", n: 7 }] })
    // 3. cron_runs
    .mockResolvedValueOnce({ rows: [] })
    // 4. alerts
    .mockResolvedValueOnce({ rows: [] })
    // 5. URL-flag counts (NEW query)
    .mockResolvedValueOnce({ rows: opts.urlFlagsRows });
}

beforeEach(() => {
  mockSql.mockReset();
  mockIsDb.mockReset();
  mockFetch.mockReset();
  // Default: Resend succeeds
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ id: "test-email-id" }),
  });
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.DIGEST_EMAIL_TO = "anu@statdoctor.net";
});

describe("daily-digest — URL validation line", () => {
  it("includes rejection counts when some URLs were flagged in the last 7 days", async () => {
    mockIsDb.mockReturnValue(true);
    setupMockSql({
      urlFlagsRows: [
        { type: "source_not_in_whitelist", n: 6 },
        { type: "source_unreachable", n: 2 },
      ],
    });

    // Simulate authorized request
    const req = new Request("http://localhost/api/cron/daily-digest");
    await GET(req);

    // Verify Resend was called and capture the HTML body
    expect(mockFetch).toHaveBeenCalled();
    const [, fetchInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const emailPayload = JSON.parse(fetchInit.body as string) as {
      html: string;
      subject: string;
    };

    expect(emailPayload.html).toContain(
      "URL validation (last 7 days): 8 URLs rejected — 6 not in whitelist, 2 unreachable"
    );
  });

  it("shows clean-pipeline message when no URL rejections in last 7 days", async () => {
    mockIsDb.mockReturnValue(true);
    setupMockSql({ urlFlagsRows: [] });

    const req = new Request("http://localhost/api/cron/daily-digest");
    await GET(req);

    expect(mockFetch).toHaveBeenCalled();
    const [, fetchInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    const emailPayload = JSON.parse(fetchInit.body as string) as {
      html: string;
    };

    expect(emailPayload.html).toContain("no rejections");
    expect(emailPayload.html).toContain("✓");
  });
});
