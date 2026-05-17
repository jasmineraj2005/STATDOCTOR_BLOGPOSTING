import { describe, it, expect } from "vitest";
import { bannerMessage } from "./banner-view";

describe("bannerMessage", () => {
  it("Given state kind=none, When called, Then returns null", () => {
    expect(bannerMessage({ kind: "none" })).toBeNull();
  });

  it("Given publish_failed count=2, When called, Then message mentions '2 publish failures'", () => {
    const msg = bannerMessage({ kind: "publish_failed", count: 2 });
    expect(msg).toContain("2");
    expect(msg).toMatch(/publish failures/i);
  });

  it("Given publish_failed count=1, When called, Then uses singular form", () => {
    const msg = bannerMessage({ kind: "publish_failed", count: 1 });
    expect(msg).toContain("1 publish failure");
    expect(msg).not.toContain("failures");
  });

  it("Given cron_stale name=seo-snapshot age=30, When called, Then includes name and hours", () => {
    const msg = bannerMessage({ kind: "cron_stale", cronName: "seo-snapshot", ageHours: 30 });
    expect(msg).toContain("seo-snapshot");
    expect(msg).toContain("30");
  });

  it("Given stale_review days=10, When called, Then mentions day count", () => {
    const msg = bannerMessage({ kind: "stale_review", daysSinceLastReview: 10 });
    expect(msg).toContain("10 days");
  });

  it("Given needs_review_high count=8, When called, Then mentions count", () => {
    const msg = bannerMessage({ kind: "needs_review_high", count: 8 });
    expect(msg).toContain("8");
    expect(msg).toMatch(/waiting/i);
  });
});
