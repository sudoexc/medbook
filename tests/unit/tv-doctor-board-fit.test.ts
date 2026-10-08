/**
 * The doctor's TV board on the clinic's TCL 32" (owner report 08.10.2026):
 * the TV box shows pages at 960×540, where the fixed pixel sizes left the
 * header and «Сейчас принимается» on the whole screen and the queue cut off.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const board = read("src/app/tv/d/[token]/page.tsx");

describe("the doctor's TV board fits any screen", () => {
  it("sizes everything in rem, and the rem follows the screen", () => {
    expect(board).toContain('const REM = "clamp(6px, min(100vh, 100vw) / 67.5, 40px)";');
    expect(board).toContain("html { font-size: ${REM}; }");
    // No pixel geometry left behind in the tiles.
    expect(board).not.toMatch(/TILE_RADIUS - \d/);
    expect(board).not.toContain("text-[11px]");
    expect(board).not.toContain("minWidth: 108");
  });

  it("«Сейчас принимается» is one compact band", () => {
    const band = board.slice(
      board.indexOf("Now serving: one compact band"),
      board.indexOf("LEFT — live queue"),
    );
    expect(band).toContain('className="flex items-center justify-between gap-6 px-7 py-3.5"');
    expect(band).toContain("text-4xl font-bold");
    expect(band).toContain('<Bi k="doctorBoard.cabinetFree" />');
    expect(band).not.toContain("text-6xl");
  });

  it("a long queue turns its pages instead of being cut", () => {
    expect(board).toContain("const PAGE_MS = 8_000;");
    expect(board).toContain("const queuePager = usePagedRows(data?.queue.waiting ?? []);");
    expect(board).toContain("const upcomingPager = usePagedRows(upcomingSlots);");
    expect(board).toContain("ref={queuePager.boxRef}");
    expect(board).not.toContain("MAX_WAITING_ROWS");
    // The next patient stays highlighted only where he really is first.
    expect(board).toContain("const first = queuePager.offset + i === 0;");
  });

  it("Android TV's automatic dark mode is switched off for the boards", () => {
    expect(read("src/app/tv/layout.tsx")).toContain(
      'export const viewport: Viewport = { colorScheme: "only light" };',
    );
  });
});
