/**
 * P1.1 — shared patient-handout parser/renderer.
 *
 * `render-handout.ts` is the single source of block structure for two
 * surfaces (the CRM print route's HTML, the worker's pdfkit PDF), so the
 * line-walker and the two inline forms are pinned here:
 *
 *   - `parseHandoutBlocks` block segmentation (headings flush, bullets group,
 *     soft-wrapped lines join with a space, blank lines separate paragraphs).
 *   - `stripInlineMarkers` (PDF path) drops `**`/`_` but leaves a mid-word
 *     underscore intact — the exact italic boundary rule the HTML path uses.
 *   - `renderHandoutHtml` escapes before re-marking, so a handout that
 *     contains literal HTML can never inject markup into the printed page.
 */
import { describe, expect, it } from "vitest";

import {
  parseHandoutBlocks,
  renderHandoutHtml,
  stripInlineMarkers,
} from "@/server/visit-notes/render-handout";

describe("parseHandoutBlocks", () => {
  it("returns [] for null / empty / whitespace input", () => {
    expect(parseHandoutBlocks(null)).toEqual([]);
    expect(parseHandoutBlocks("")).toEqual([]);
    expect(parseHandoutBlocks("   \n  \n")).toEqual([]);
  });

  it("recognises h1 and h2 headings", () => {
    expect(parseHandoutBlocks("# Title")).toEqual([
      { kind: "h1", text: "Title" },
    ]);
    expect(parseHandoutBlocks("## Subheading")).toEqual([
      { kind: "h2", text: "Subheading" },
    ]);
  });

  it("groups consecutive bullets into one list", () => {
    expect(parseHandoutBlocks("- one\n- two\n- three")).toEqual([
      { kind: "bullets", items: ["one", "two", "three"] },
    ]);
  });

  it("joins soft-wrapped paragraph lines with a single space", () => {
    expect(parseHandoutBlocks("first line\nsecond line")).toEqual([
      { kind: "paragraph", text: "first line second line" },
    ]);
  });

  it("separates paragraphs on a blank line", () => {
    expect(parseHandoutBlocks("para one\n\npara two")).toEqual([
      { kind: "paragraph", text: "para one" },
      { kind: "paragraph", text: "para two" },
    ]);
  });

  it("flushes an open paragraph and bullet list when a heading appears", () => {
    expect(
      parseHandoutBlocks("intro text\n- a\n- b\n# Heading\nafter"),
    ).toEqual([
      { kind: "paragraph", text: "intro text" },
      { kind: "bullets", items: ["a", "b"] },
      { kind: "h1", text: "Heading" },
      { kind: "paragraph", text: "after" },
    ]);
  });
});

describe("stripInlineMarkers", () => {
  it("removes bold markers", () => {
    expect(stripInlineMarkers("take **two** tablets")).toBe(
      "take two tablets",
    );
  });

  it("removes italic markers at word boundaries", () => {
    expect(stripInlineMarkers("rest is _important_ today")).toBe(
      "rest is important today",
    );
  });

  it("leaves a mid-word underscore untouched", () => {
    expect(stripInlineMarkers("see file_name_here")).toBe("see file_name_here");
  });
});

describe("renderHandoutHtml", () => {
  it("returns the em-dash placeholder for empty input", () => {
    expect(renderHandoutHtml("")).toBe(`<p class="empty">—</p>`);
    expect(renderHandoutHtml(null)).toBe(`<p class="empty">—</p>`);
  });

  it("emits the expected tag structure", () => {
    expect(renderHandoutHtml("# H1")).toBe(`<h1 class="md-h1">H1</h1>`);
    expect(renderHandoutHtml("## H2")).toBe(`<h2 class="md-h2">H2</h2>`);
    expect(renderHandoutHtml("- a\n- b")).toBe(
      `<ul class="md-list"><li>a</li><li>b</li></ul>`,
    );
    expect(renderHandoutHtml("just a paragraph")).toBe(
      `<p>just a paragraph</p>`,
    );
  });

  it("re-marks bold and italic inline forms", () => {
    expect(renderHandoutHtml("**bold** and _soft_")).toBe(
      `<p><strong>bold</strong> and <em>soft</em></p>`,
    );
  });

  it("escapes HTML before re-marking (no markup injection)", () => {
    const out = renderHandoutHtml("<script>alert(1)</script>");
    expect(out).toBe(`<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>`);
    expect(out).not.toContain("<script>");
  });
});
