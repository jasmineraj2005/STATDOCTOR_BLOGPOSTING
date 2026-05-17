import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const TOKEN = "alert-test-token";

beforeEach(() => {
  process.env.ALERT_INGEST_TOKEN = TOKEN;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ALERT_INGEST_TOKEN;
});

function req(body: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/alerts/dispatch", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/alerts/dispatch", () => {
  it("Given missing Authorization, When called, Then returns 401", async () => {
    vi.doMock("@/lib/alerts/resend", () => ({ dispatchAlert: vi.fn() }));
    const { POST } = await import("./route");
    const res = await POST(req({ kind: "x", severity: "error", detail: "y" }, null));
    expect(res.status).toBe(401);
  });

  it("Given ALERT_INGEST_TOKEN unset, When called, Then returns 503", async () => {
    delete process.env.ALERT_INGEST_TOKEN;
    vi.doMock("@/lib/alerts/resend", () => ({ dispatchAlert: vi.fn() }));
    const { POST } = await import("./route");
    const res = await POST(req({ kind: "x", severity: "error", detail: "y" }, ""));
    expect(res.status).toBe(503);
  });

  it("Given missing kind, When called, Then returns 400", async () => {
    vi.doMock("@/lib/alerts/resend", () => ({ dispatchAlert: vi.fn() }));
    const { POST } = await import("./route");
    const res = await POST(req({ severity: "error", detail: "y" }));
    expect(res.status).toBe(400);
  });

  it("Given invalid severity, When called, Then returns 400 with bad_severity", async () => {
    vi.doMock("@/lib/alerts/resend", () => ({ dispatchAlert: vi.fn() }));
    const { POST } = await import("./route");
    const res = await POST(req({ kind: "x", severity: "wat", detail: "y" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_severity");
  });

  it("Given valid payload, When called, Then dispatchAlert is invoked and 200 returned", async () => {
    const mockDispatch = vi.fn().mockResolvedValue({ emailSent: true, alertId: "123" });
    vi.doMock("@/lib/alerts/resend", () => ({ dispatchAlert: mockDispatch }));
    const { POST } = await import("./route");
    const res = await POST(req({ kind: "cron_failed", severity: "error", detail: "oops" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.emailSent).toBe(true);
    expect(mockDispatch).toHaveBeenCalledOnce();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cron_failed", severity: "error", detail: "oops" }),
    );
  });
});
