/**
 * Ranked ICD-10 search.
 *
 * The catalog grew from a curated 465 entries to the full 10 414 after the
 * neurologist ran out of codes in his first week. That growth breaks naive
 * search rather than helping it: scanning in catalog order and taking the
 * first N matches returns whatever sorts earliest by code, so «мигрень» would
 * answer with chapter A before reaching G43. These tests pin the ranking that
 * replaced it.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeIcdTerm,
  searchIcd10,
  stemRu,
} from "@/server/icd10/search";
import { ICD10_ENTRIES } from "@/server/icd10/data";

const codes = (rows: { code: string }[]) => rows.map((r) => r.code);

describe("ICD-10 catalog", () => {
  it("carries the full classifier, not a curated subset", () => {
    // The curated list was 465. Anything near that means the generator did
    // not run and the doctor is back to missing codes.
    expect(ICD10_ENTRIES.length).toBeGreaterThan(9000);
  });

  it("has real neurology depth — the chapter he actually works in", () => {
    const g = ICD10_ENTRIES.filter((e) => e.code.startsWith("G"));
    expect(g.length).toBeGreaterThan(200);
  });

  it("contains no chapter headings", () => {
    // «A00-B99 Некоторые инфекционные болезни» is not a diagnosis.
    expect(ICD10_ENTRIES.some((e) => e.code.includes("-"))).toBe(false);
  });
});

describe("searchIcd10 — ranking", () => {
  it("puts an exact code first", () => {
    const rows = searchIcd10("G43.0", 10);
    expect(rows[0]?.code).toBe("G43.0");
  });

  it("returns the whole subtree for a code prefix", () => {
    const rows = searchIcd10("G43", 20);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.code.startsWith("G43"))).toBe(true);
  });

  it("finds by name, not just by code", () => {
    const rows = searchIcd10("мигрень", 20);
    expect(rows.length).toBeGreaterThan(0);
    // Migraine lives in G43 — the regression was chapter A winning here.
    expect(codes(rows).some((c) => c.startsWith("G43"))).toBe(true);
  });

  it("prefers a name that starts with the term over one that merely contains it", () => {
    const rows = searchIcd10("мигрень", 20);
    const first = rows[0]?.nameRu.toLowerCase() ?? "";
    expect(first.startsWith("мигрень")).toBe(true);
  });

  it("narrows on a second word instead of widening", () => {
    const one = searchIcd10("мигрень", 50).length;
    const two = searchIcd10("мигрень аура", 50).length;
    expect(two).toBeLessThanOrEqual(one);
    expect(two).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    expect(codes(searchIcd10("МИГРЕНЬ", 5))).toEqual(
      codes(searchIcd10("мигрень", 5)),
    );
  });

  it("treats ё and е as the same letter", () => {
    // Doctors type ё inconsistently; losing a result over a diacritic
    // mid-visit is not acceptable.
    expect(normalizeIcdTerm("Аёв")).toBe("аев");
    const withYo = searchIcd10("новорождённого", 10);
    const withE = searchIcd10("новорожденного", 10);
    expect(codes(withYo)).toEqual(codes(withE));
  });

  it("honours the limit", () => {
    expect(searchIcd10("а", 5).length).toBeLessThanOrEqual(5);
  });

  it("returns nothing for an empty query rather than a misleading default", () => {
    // Catalog order starts at chapter A (infectious disease) — showing that
    // as a default reads as a suggestion.
    expect(searchIcd10("", 12)).toEqual([]);
    expect(searchIcd10("   ", 12)).toEqual([]);
  });

  it("returns nothing for gibberish instead of loose matches", () => {
    expect(searchIcd10("щщщщщщ", 10)).toEqual([]);
  });

  it("is stable — the same query twice gives the same order", () => {
    expect(codes(searchIcd10("гастрит", 10))).toEqual(
      codes(searchIcd10("гастрит", 10)),
    );
  });
});

describe("stemRu — Russian case endings", () => {
  it("brings a word and its inflected form to the same stem", () => {
    // The bug that started this: "аурой" does not contain "аура", so plain
    // substring matching missed «Мигрень с аурой» for the query «аура».
    expect(stemRu("аура")).toBe(stemRu("аурой"));
  });

  it("handles the genitive doctors type constantly", () => {
    expect(stemRu("гастрита")).toBe(stemRu("гастрит"));
    expect(stemRu("перелома")).toBe(stemRu("перелом"));
  });

  it("leaves short words alone — stripping them destroys meaning", () => {
    expect(stemRu("ухо")).toBe("ухо");
    expect(stemRu("оба")).toBe("оба");
  });

  it("never strips below a three-letter stem", () => {
    for (const w of ["коли", "тела", "рака", "боли"]) {
      expect(stemRu(w).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("is idempotent — stemming a stem changes nothing further", () => {
    for (const w of ["мигрень", "аурой", "гастрита", "переломами"]) {
      expect(stemRu(stemRu(w))).toBe(stemRu(w));
    }
  });
});

describe("searchIcd10 — finds inflected forms in the catalog", () => {
  it("«аура» finds «Мигрень с аурой»", () => {
    const rows = searchIcd10("мигрень аура", 20);
    expect(codes(rows)).toContain("G43.1");
  });

  it("«гастрита» finds gastritis despite the genitive", () => {
    const rows = searchIcd10("гастрита", 20);
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.some((r) => r.nameRu.toLowerCase().includes("гастрит")),
    ).toBe(true);
  });

  it("ranks an exact word above one that only matched after stemming", () => {
    const rows = searchIcd10("мигрень", 20);
    // Entries literally starting with «Мигрень» must come before anything
    // reached through inflection.
    expect(rows[0]?.nameRu.toLowerCase().startsWith("мигрень")).toBe(true);
  });
});
