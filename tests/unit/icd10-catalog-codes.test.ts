/**
 * Audit CT-02 — codes the catalog could not give.
 *
 * The dump lists the diabetes subcategories once, in the E10-E14 block's
 * note («.4 С неврологическими осложнениями»), so E10…E14 came out as bare
 * three-character leaves: a diabetic polyneuropathy (E11.4 with G63.2*)
 * went into a conclusion as E11. Chapter U (COVID-19) postdates the dump,
 * and a cross-reference the dump split into a row («K91.4,» named «N99.5)»)
 * sat in the typeahead.
 */
import { describe, expect, it } from "vitest";

import { ICD10_ENTRIES } from "@/server/icd10/data";
import { searchIcd10 } from "@/server/icd10/search";

const byCode = new Map(ICD10_ENTRIES.map((e) => [e.code, e.nameRu]));

describe("the catalog's codes", () => {
  it("all have the classifier's shape", () => {
    const bad = ICD10_ENTRIES.filter(
      (e) => !/^[A-Z][0-9]{2}(\.[0-9]{1,2})?[+*]?$/.test(e.code),
    ).map((e) => e.code);
    expect(bad).toEqual([]);
  });

  it("no longer carry the split cross-reference", () => {
    expect(byCode.has("K91.4,")).toBe(false);
    expect(ICD10_ENTRIES.some((e) => e.nameRu === "N99.5)")).toBe(false);
  });

  it("subdivide diabetes by the block's fourth characters", () => {
    expect(byCode.get("E11.4")).toBe(
      "Инсулиннезависимый сахарный диабет с неврологическими осложнениями",
    );
    expect(byCode.get("E10.4")).toBe(
      "Инсулинзависимый сахарный диабет с неврологическими осложнениями",
    );
    expect(byCode.get("E11.9")).toBe("Инсулиннезависимый сахарный диабет без осложнений");
    expect(byCode.get("E12.0")).toBe(
      "Сахарный диабет, связанный с недостаточностью питания, с комой",
    );
    for (const cat of ["E10", "E11", "E12", "E13", "E14"]) {
      const subs = ICD10_ENTRIES.filter((e) => e.code.startsWith(`${cat}.`));
      expect(subs.map((e) => e.code.slice(4))).toEqual([
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
      ]);
      // The category is a heading now, like every other subdivided one.
      expect(byCode.has(cat)).toBe(false);
    }
  });

  it("include the COVID-19 codes of chapter U", () => {
    expect(byCode.get("U07.1")).toBe("COVID-19, вирус идентифицирован");
    expect(byCode.get("U09.9")).toBe("Состояние после COVID-19, неуточненное");
  });
});

describe("searching the new codes", () => {
  it("finds E11.4 by its code", () => {
    expect(searchIcd10("e11.4", 5)[0]?.code).toBe("E11.4");
  });

  it("finds post-COVID by its code and by its words", () => {
    expect(searchIcd10("U09.9", 5)[0]?.code).toBe("U09.9");
    expect(searchIcd10("после covid", 10).map((r) => r.code)).toContain("U09.9");
  });

  it("gives both codes of a diabetic polyneuropathy", () => {
    const codes = searchIcd10("диабетическая полинейропатия", 10).map((r) => r.code);
    expect(codes.slice(0, 2)).toEqual(["G63.2*", "E11.4"]);
  });
});
