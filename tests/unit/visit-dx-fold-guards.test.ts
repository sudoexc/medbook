/**
 * One gesture, one action, around the inline diagnosis block.
 *
 * The first diagnosis folds the diagnosis columns into «+ Диагноз», and
 * everything under the card moves up by some 400px within a frame. The OS
 * counts a double click by position and time, not by element, so the
 * second click of a double click on a diagnosis lands, with detail=2, on
 * whatever is now under the cursor: the «Назначения» header, «Обычно при»,
 * or the prescription picker's columns. The reverse happens on «+ Диагноз»
 * (the columns open where the bar was), and a pick in the opened columns
 * moves them down by one row.
 *
 * So every button in those places either ignores the second click
 * (isRepeatClick) or is listed here as harmless when repeated. A new
 * button that does neither fails this test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isRepeatClick } from "@/app/[locale]/doctor/reception/_hooks/prescription-columns";

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), "src/app/[locale]/doctor", rel), "utf8");

const GUARD = "if (isRepeatClick(e.detail)) return;";

/**
 * The `onClick` expression of every `<button` opening tag in a piece of
 * TSX, in order; null for a button without one. A small scanner, not a
 * parser: it tracks braces and quoted attribute strings, which is all the
 * opening tags of these files use.
 */
function buttonClickHandlers(src: string): Array<string | null> {
  const out: Array<string | null> = [];
  let from = 0;
  for (;;) {
    const start = src.indexOf("<button", from);
    if (start < 0) return out;
    let i = start + "<button".length;
    let depth = 0;
    let quote: string | null = null;
    // Find the end of the opening tag: the first `>` outside braces and
    // outside an attribute string (an arrow's `=>` sits inside braces).
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (depth === 0 && (c === '"' || c === "'")) quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(start, i);
    const at = tag.indexOf("onClick={");
    if (at < 0) {
      out.push(null);
    } else {
      let d = 0;
      let j = at + "onClick=".length;
      const begin = j;
      for (; j < tag.length; j++) {
        if (tag[j] === "{") d++;
        else if (tag[j] === "}" && --d === 0) break;
      }
      out.push(tag.slice(begin + 1, j).trim());
    }
    from = i;
  }
}

/** Handlers that do no harm when they run twice: they set the same state. */
function unguarded(handlers: Array<string | null>, harmless: readonly string[]) {
  return handlers.filter(
    (h): h is string => h !== null && !h.includes(GUARD) && !harmless.includes(h),
  );
}

describe("the scanner", () => {
  it("reads each button's handler, arrows and quoted `>` included", () => {
    const src = `
      <button type="button" className="[&>svg]:size-4" onClick={(e) => {
        ${GUARD}
        go();
      }}>a</button>
      <button disabled onClick={onStar} title={x > 1 ? "a" : "b"}>b</button>
      <button type="submit">c</button>
      <GroupButton onClick={() => open()} />`;
    const handlers = buttonClickHandlers(src);
    expect(handlers).toHaveLength(3);
    expect(handlers[0]).toContain(GUARD);
    expect(handlers[1]).toBe("onStar");
    expect(handlers[2]).toBeNull();
    expect(unguarded(handlers, [])).toEqual(["onStar"]);
  });

  it("the guard lets a click and a keyboard press through and stops the repeat", () => {
    expect(isRepeatClick(0)).toBe(false);
    expect(isRepeatClick(1)).toBe(false);
    expect(isRepeatClick(2)).toBe(true);
  });
});

describe("«Назначения» after the fold: nothing acts on the second click", () => {
  it("the header's «Каталог» and «+ Свой» ignore it", () => {
    const ctor = read("reception/_components/prescription-constructor.tsx");
    expect(ctor).toContain(
      'import { isRepeatClick, onVisitChecker } from "../_hooks/prescription-columns";',
    );
    const header = ctor.slice(
      ctor.indexOf('{t("fields.prescriptions.label")}'),
      ctor.indexOf("{picker ? ("),
    );
    const handlers = buttonClickHandlers(header);
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toContain("onOpenCatalog();");
    expect(handlers[1]).toContain("setCustomOpen(true);");
    expect(unguarded(handlers, [])).toEqual([]);
  });

  it("templates, stars, catalog groups and «add to the base» ignore it in the picker", () => {
    const picker = read("reception/_components/prescription-picker.tsx");
    const handlers = buttonClickHandlers(picker);
    // The template chip, the drug row, the star, the catalog's back and
    // group buttons, «add to the clinic base».
    const guarded = handlers.filter((h) => h?.includes(GUARD));
    expect(guarded.map((h) => h!.split(GUARD)[1]!.trim().split("\n")[0])).toEqual([
      "onPresetClick(p);",
      "onPick();",
      "onStar();",
      "onPath(to);",
      "onClick();",
      "onAddToClinicBase();",
    ]);
    expect(
      unguarded(handlers, [
        // The search's clear and the narrow card's tabs set the same state
        // again; a retry and «show more» (disabled while it loads) refetch.
        '() => setQuery("")',
        "() => setTab(key)",
        "() => void atc.refetch()",
        "() => void atc.fetchNextPage()",
      ]),
    ).toEqual([]);
  });

  it("«Обычно при» was already guarded and stays so", () => {
    const card = read("reception/_components/diagnosis-memory-card.tsx");
    expect(
      unguarded(buttonClickHandlers(card), [
        // Which diagnosis the card speaks of: the same tab again.
        "() => setChosen(o.key)",
      ]),
    ).toEqual([]);
  });
});

describe("the diagnosis columns: the bar's double click and a pick's shift", () => {
  it("the role switch, «Свернуть», the star and the catalog ignore the second click", () => {
    const picker = read("reception/_components/diagnosis-picker.tsx");
    const handlers = buttonClickHandlers(picker);
    const guarded = handlers.filter((h) => h?.includes(GUARD));
    expect(guarded.map((h) => h!.split(GUARD)[1]!.trim().split("\n")[0])).toEqual([
      "setRole(r);",
      "onCollapse();",
      "onPick();",
      "onStar();",
      "onTrail(trail.slice(0, -1));",
      "onClick();",
      "onPick({ code: pair.code, name: pair.name });",
      "onPick({ code: null, name: typed });",
    ]);
    expect(
      unguarded(handlers, [
        '() => setQuery("")',
        "() => setTab(key)",
        "() => void node.refetch()",
      ]),
    ).toEqual([]);
  });

  it("the card's «+ Диагноз» bar keeps its guard", () => {
    const card = read("_components/diagnosis-follow-up-cards.tsx");
    const bar = card.slice(card.indexOf('{addView === "bar" && ('));
    const [handler] = buttonClickHandlers(bar);
    expect(handler).toContain(GUARD);
    expect(handler).toContain("setAdding(true);");
  });
});
