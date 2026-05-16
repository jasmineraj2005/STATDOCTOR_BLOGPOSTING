/**
 * Unit tests for preprocessCalloutMarkers — the markdown pre-processor that
 * moves inline callout markers onto their own paragraph so the blockquote
 * renderer can reliably detect and strip them.
 *
 * The function is exported from article-preview-pane so it can be tested
 * independently of the React rendering pipeline.
 */
import { describe, it, expect } from "vitest";
import { preprocessCalloutMarkers } from "./callout-markers";

describe("preprocessCalloutMarkers", () => {
  it("splits an inline marker from its content onto separate lines", () => {
    const input = "> [KEY TAKEAWAY] This is the takeaway text.";
    const result = preprocessCalloutMarkers(input);
    // Marker should be on its own blockquote line, content on next line
    expect(result).toContain("> [KEY TAKEAWAY]");
    expect(result).toContain("> This is the takeaway text.");
    // They should NOT be on the same line
    const lines = result.split("\n");
    const markerLine = lines.find((l) => l.includes("[KEY TAKEAWAY]"))!;
    expect(markerLine.replace("> [KEY TAKEAWAY]", "").trim()).toBe("");
  });

  it("handles [INFO] marker", () => {
    const input = "> [INFO] Smart tip content here.";
    const result = preprocessCalloutMarkers(input);
    expect(result).toContain("> [INFO]");
    expect(result).toContain("> Smart tip content here.");
  });

  it("handles [AU] marker", () => {
    const input = "> [AU] Australian context here.";
    const result = preprocessCalloutMarkers(input);
    expect(result).toContain("> [AU]");
    expect(result).toContain("> Australian context here.");
  });

  it("handles [NZ] marker", () => {
    const input = "> [NZ] New Zealand context here.";
    const result = preprocessCalloutMarkers(input);
    expect(result).toContain("> [NZ]");
    expect(result).toContain("> New Zealand context here.");
  });

  it("handles [TIP] marker", () => {
    const input = "> [TIP] Pro tip content.";
    const result = preprocessCalloutMarkers(input);
    expect(result).toContain("> [TIP]");
    expect(result).toContain("> Pro tip content.");
  });

  it("handles [INTERESTING FACT] marker", () => {
    const input = "> [INTERESTING FACT] Did you know this?";
    const result = preprocessCalloutMarkers(input);
    expect(result).toContain("> [INTERESTING FACT]");
    expect(result).toContain("> Did you know this?");
  });

  it("handles [CASE STUDY: Title] marker", () => {
    const input = "> [CASE STUDY: Royal Melbourne Hospital] They implemented X.";
    const result = preprocessCalloutMarkers(input);
    expect(result).toContain("> [CASE STUDY: Royal Melbourne Hospital]");
    expect(result).toContain("> They implemented X.");
  });

  it("does NOT modify markers already on their own line", () => {
    // Marker on its own line — no trailing content — should pass through unchanged
    const input = "> [KEY TAKEAWAY]\n> \n> The takeaway is already split.";
    const result = preprocessCalloutMarkers(input);
    expect(result).toBe(input);
  });

  it("does NOT modify regular blockquotes without markers", () => {
    const input = "> This is a normal blockquote with no marker.";
    const result = preprocessCalloutMarkers(input);
    expect(result).toBe(input);
  });

  it("handles optional space after >", () => {
    const input = ">[KEY TAKEAWAY] Content without space.";
    const result = preprocessCalloutMarkers(input);
    expect(result).toContain("[KEY TAKEAWAY]");
    expect(result).toContain("Content without space.");
  });

  it("processes multiple markers in the same document", () => {
    const input = [
      "> [INFO] First tip.",
      "",
      "Regular paragraph.",
      "",
      "> [AU] Australian note.",
    ].join("\n");
    const result = preprocessCalloutMarkers(input);
    expect(result).toContain("> [INFO]");
    expect(result).toContain("> First tip.");
    expect(result).toContain("> [AU]");
    expect(result).toContain("> Australian note.");
  });
});
