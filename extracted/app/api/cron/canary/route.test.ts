import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

beforeEach(() => {
  process.env.CRON_SECRET = "canary-test-secret";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

function req(token: string | null = "canary-test-secret") {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/cron/canary", { headers });
}

describe("GET /api/cron/canary", () => {
  it("Given missing Authorization, When called, Then returns 401", async () => {
    vi.doMock("@/lib/admin/db", () => ({ isDbConfigured: () => true }));
    const { GET } = await import("./route");
    const res = await GET(req(null));
    expect(res.status).toBe(401);
  });

  it("Given DB not configured, When called with valid token, Then returns 503", async () => {
    vi.doMock("@/lib/admin/db", () => ({ isDbConfigured: () => false }));
    const { GET } = await import("./route");
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("Given DB and full path works, When called, Then 200 with all 5 steps in order", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const claim = vi.fn().mockResolvedValue({ post: { slug: "x" } });
    const del = vi.fn().mockResolvedValue(true);
    const recordCron = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue({ emailSent: false, alertId: "n" });

    vi.doMock("@/lib/admin/db", () => ({ isDbConfigured: () => true }));
    vi.doMock("@/lib/admin/store", () => ({
      upsertPost: upsert,
      claimForApproval: claim,
      deletePostBySlug: del,
    }));
    vi.doMock("@/lib/admin/cron", () => ({ recordCronRun: recordCron }));
    vi.doMock("@/lib/alerts/resend", () => ({ dispatchAlert: dispatch }));

    const { GET } = await import("./route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.steps).toEqual(["ingest", "approve", "scheduled", "publish_dry", "delete"]);

    expect(upsert).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledOnce();
    expect(recordCron).toHaveBeenCalledWith("canary", true, expect.stringContaining("canary ok"));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("Given approve step fails, When called, Then dispatchAlert fires and 500 returned", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const claim = vi.fn().mockResolvedValue(null); // simulates approval failure
    const del = vi.fn().mockResolvedValue(true);
    const recordCron = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn().mockResolvedValue({ emailSent: false, alertId: "n" });

    vi.doMock("@/lib/admin/db", () => ({ isDbConfigured: () => true }));
    vi.doMock("@/lib/admin/store", () => ({
      upsertPost: upsert,
      claimForApproval: claim,
      deletePostBySlug: del,
    }));
    vi.doMock("@/lib/admin/cron", () => ({ recordCronRun: recordCron }));
    vi.doMock("@/lib/alerts/resend", () => ({ dispatchAlert: dispatch }));

    const { GET } = await import("./route");
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "canary_failed", severity: "critical" }),
    );
    expect(recordCron).toHaveBeenCalledWith("canary", false, expect.any(String));
  });
});
