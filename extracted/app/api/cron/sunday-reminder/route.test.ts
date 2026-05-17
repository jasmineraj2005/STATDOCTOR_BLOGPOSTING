import { describe, it, expect } from "vitest";
import { renderReminderEmail } from "./route";

const baseOpts = {
  pending: 4,
  healing: 0,
  healFailed: 0,
  publishedThisWeek: 3,
  reviewUrl: "https://blog.statdoctor.app/admin/posts",
  siteUrl: "https://blog.statdoctor.app",
};

describe("renderReminderEmail", () => {
  it("Given 4 pending articles, When rendered, Then headline says '4 articles ready'", () => {
    const html = renderReminderEmail(baseOpts);
    expect(html).toContain("4 articles ready for review");
  });

  it("Given 1 pending article, When rendered, Then headline uses singular", () => {
    const html = renderReminderEmail({ ...baseOpts, pending: 1 });
    expect(html).toContain("1 article ready for review");
    expect(html).not.toContain("1 articles");
  });

  it("Given 0 pending and 0 healing, When rendered, Then headline says 'Nothing to review'", () => {
    const html = renderReminderEmail({ ...baseOpts, pending: 0 });
    expect(html).toContain("Nothing to review");
  });

  it("Given a review URL, When rendered, Then it appears in an anchor href", () => {
    const html = renderReminderEmail(baseOpts);
    expect(html).toContain('href="https://blog.statdoctor.app/admin/posts"');
    expect(html).toContain("Open review queue");
  });

  it("Given publishedThisWeek > 0, When rendered, Then includes site link", () => {
    const html = renderReminderEmail({ ...baseOpts, publishedThisWeek: 5 });
    expect(html).toContain("Published this week");
    expect(html).toContain("blog.statdoctor.app");
  });

  it("Given heal_failed > 0, When rendered, Then warns in red", () => {
    const html = renderReminderEmail({ ...baseOpts, healFailed: 2 });
    expect(html).toContain("2 heal-failed");
    expect(html).toContain("manual edit");
  });

  it("Given healing > 0 and heal_failed 0, When rendered, Then shows healing line without divider", () => {
    const html = renderReminderEmail({ ...baseOpts, healing: 3 });
    expect(html).toContain("3 still healing");
    expect(html).not.toContain(" · 0 heal-failed");
  });
});
