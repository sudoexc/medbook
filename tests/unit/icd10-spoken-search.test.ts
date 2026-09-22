import { describe, expect, it } from "vitest";

import { expandSynonyms, searchIcd10 } from "@/server/icd10/search";

/**
 * The neurologist reported «не могу найти нужный диагноз». Tracing it showed
 * two causes, both reproduced here:
 *   1. multi-word queries required EVERY word to match, so «остеохондроз
 *      шейного отдела» returned nothing while «остеохондроз» returned 17;
 *   2. spoken forms («цефалгия», «ВСД», «грыжа диска») do not appear in the
 *      classifier at all, and one of them even had loud wrong literal
 *      matches (abdominal hernias for «грыжа»).
 * These tests pin the wording the clinic actually uses.
 */
const first = (q: string, n = 3) =>
  searchIcd10(q, n).map((r) => r.code);

describe("ICD search — the way the doctor speaks", () => {
  it("finds the rubric when the query names a region the classifier omits", () => {
    // M42.x is «Остеохондроз позвоночника»; the classifier never says
    // «шейного отдела» there, but the doctor always does.
    expect(first("остеохондроз шейного отдела")[0]).toMatch(/^M42/);
  });

  it("resolves spoken abbreviations", () => {
    expect(first("ВСД")).toContain("G90.9");
    expect(first("ДЭП")).toContain("I67.9");
  });

  it("resolves spoken synonyms to the right chapter, not a homonym", () => {
    // «грыжа» literally matches every abdominal hernia (K40/K43) — the disc
    // rubric must still win, because that is what the phrase means.
    for (const code of first("грыжа диска")) {
      expect(code).toMatch(/^M5[01]/);
    }
    expect(first("цефалгия")[0]).toMatch(/^G44/);
    expect(first("защемление нерва")[0]).toMatch(/^G55/);
  });

  it("ignores stop words instead of matching everything", () => {
    // «в» used to match every row in the catalog — the search answered
    // «прострел в пояснице» with cholera.
    expect(first("прострел в пояснице")).toEqual(["M54.4"]);
  });

  it("keeps precise queries precise", () => {
    expect(first("мигрень")).toEqual(["G43.0", "G43.1", "G43.9"]);
    expect(first("головная боль")[0]).toMatch(/^(G44|R51)/);
  });

  it("still returns nothing for a query that means nothing", () => {
    expect(searchIcd10("ффффф", 5)).toEqual([]);
    expect(searchIcd10("", 5)).toEqual([]);
  });

  it("marks whole-query synonyms as direct so they outrank partial hits", () => {
    expect(expandSynonyms("грыжа диска")).toEqual({
      terms: ["поражение межпозвоночного диска"],
      direct: true,
    });
    expect(expandSynonyms("мигрень")).toEqual({ terms: [], direct: false });
  });
});
