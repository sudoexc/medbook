import { describe, expect, it } from "vitest";

import {
  birthYearOf,
  foldNameToken,
  nameOrders,
  nameTokens,
  probeFromTyped,
  sameNameLikely,
  samePersonLikely,
} from "@/lib/patients/identity-match";

/**
 * Audit Q-03: a walk-in typed as name + phone used to land in whichever card
 * held the number. The comparison that now guards it must say «same» only
 * when it is very likely, because a false «same» writes a child's diagnosis
 * into his mother's record, while a false «different» costs one click.
 */
const TODAY = new Date("2026-09-25T12:00:00Z");

describe("foldNameToken / nameTokens", () => {
  it("folds Cyrillic and Latin spellings of one name together", () => {
    expect(foldNameToken("Каримова")).toBe(foldNameToken("Karimova"));
    expect(foldNameToken("Юсупова")).toBe(foldNameToken("Yusupova"));
    expect(foldNameToken("Ғофур")).toBe(foldNameToken("G'ofur"));
    expect(foldNameToken("Хасанов")).toBe(foldNameToken("Khasanov"));
  });

  it("drops initials' dots, apostrophes and digits", () => {
    expect(nameTokens("Турматов О. 1969")).toEqual(["turmatov", "o"]);
  });
});

describe("samePersonLikely", () => {
  const mother = { fullName: "Каримова Дилноза Рустамовна", birthDate: new Date(Date.UTC(1985, 0, 1)) };

  it("the audit scenario: a son typed with his mother's phone is NOT her", () => {
    expect(samePersonLikely(probeFromTyped("Каримов Тимур 2012", TODAY), mother)).toBe(false);
  });

  it("the owner written out in full, with her birth year, is her (either alphabet)", () => {
    expect(samePersonLikely(probeFromTyped("Каримова Дилноза 1985", TODAY), mother)).toBe(true);
    expect(samePersonLikely(probeFromTyped("Karimova Dilnoza 1985", TODAY), mother)).toBe(true);
    expect(
      samePersonLikely(probeFromTyped("Каримова Дилноза Р 1985", TODAY), mother),
    ).toBe(true);
  });

  it("an initial is «not sure», never «same»: it fits the whole family", () => {
    // Surname + initial is how the doctor writes, and exactly how a father
    // and his son look alike.
    expect(samePersonLikely(probeFromTyped("Каримова Д 1985", TODAY), mother)).toBe(false);
    expect(samePersonLikely(probeFromTyped("Каримова Д. 1985", TODAY), mother)).toBe(false);
  });

  it("a surname alone is never enough: relatives share it", () => {
    expect(samePersonLikely(probeFromTyped("Каримова", TODAY), mother)).toBe(false);
  });

  it("a different given name or patronymic is a different person", () => {
    expect(samePersonLikely(probeFromTyped("Каримова Лола", TODAY), mother)).toBe(false);
    expect(
      samePersonLikely(probeFromTyped("Каримова Дилноза Анваровна", TODAY), mother),
    ).toBe(false);
  });

  it("the same name with another birth year is another person (father / son)", () => {
    const father = { fullName: "Каримов Рустам", birthDate: new Date(Date.UTC(1975, 0, 1)) };
    expect(samePersonLikely(probeFromTyped("Каримов Рустам 2005", TODAY), father)).toBe(false);
    expect(samePersonLikely(probeFromTyped("Каримов Рустам 1975", TODAY), father)).toBe(true);
  });

  it("a birth year known on one side only is «not sure»", () => {
    const noDate = { fullName: "Каримова Дилноза", birthDate: null };
    expect(samePersonLikely(probeFromTyped("Каримова Дилноза 1985", TODAY), noDate)).toBe(false);
    expect(samePersonLikely(probeFromTyped("Каримова Дилноза", TODAY), mother)).toBe(false);
    // Neither side knows the year: the full name decides.
    expect(samePersonLikely(probeFromTyped("Каримова Дилноза", TODAY), noDate)).toBe(true);
  });

  it("review Q-03 family cases: none of them is silently the same person", () => {
    // The son typed the doctor's way against his father's dateless card.
    const father = { fullName: "Каримов Тахир", birthDate: null };
    expect(samePersonLikely(probeFromTyped("Каримов Т 2012", TODAY), father)).toBe(false);
    // The son written out against a dateless card that holds only an initial.
    const initialCard = { fullName: "Каримов Т", birthDate: null };
    expect(samePersonLikely(probeFromTyped("Каримов Тимур 2012", TODAY), initialCard)).toBe(false);
    // A daughter-in-law typed with an initial against the mother-in-law.
    const motherInLaw = {
      fullName: "Каримова Дильбар Анваровна",
      birthDate: new Date(Date.UTC(1975, 0, 1)),
    };
    expect(samePersonLikely(probeFromTyped("Каримова Д", TODAY), motherInLaw)).toBe(false);
  });
});

describe("sameNameLikely", () => {
  it("compares names only: surname and full given name, patronymic when both have one", () => {
    expect(sameNameLikely("Karimova Dilnoza", "Каримова Дилноза Рустамовна")).toBe(true);
    expect(sameNameLikely("Каримова Дилноза Р.", "Каримова Дилноза Рустамовна")).toBe(true);
    expect(sameNameLikely("Каримова Дилноза Анваровна", "Каримова Дилноза Рустамовна")).toBe(false);
    expect(sameNameLikely("Каримов Тимур", "Каримова Дилноза")).toBe(false);
    expect(sameNameLikely("Каримова Д", "Каримова Дилноза")).toBe(false);
    expect(sameNameLikely("Dilnoza", "Каримова Дилноза")).toBe(false);
  });

  it("a one-letter Cyrillic initial that folds to two Latin letters is still an initial", () => {
    // «Ш» → "sh": without counting written letters it would pass as a name.
    expect(sameNameLikely("Юсупов Ш", "Юсупов Ш")).toBe(false);
    expect(sameNameLikely("Yusupov Sh.", "Yusupov Sh.")).toBe(false);
    expect(sameNameLikely("Юсупов Шерзод", "Yusupov Sherzod")).toBe(true);
  });
});

describe("nameOrders", () => {
  it("adds the surname-first order of a Telegram-style name", () => {
    expect(nameOrders("Dilnoza Karimova")).toEqual(["Dilnoza Karimova", "Karimova Dilnoza"]);
    expect(nameOrders("  Dilnoza  ")).toEqual(["Dilnoza"]);
  });
});

describe("birthYearOf", () => {
  it("reads the stored UTC year and tolerates null / garbage", () => {
    expect(birthYearOf(new Date(Date.UTC(1969, 0, 1)))).toBe(1969);
    expect(birthYearOf("2012-01-01T00:00:00.000Z")).toBe(2012);
    expect(birthYearOf(null)).toBeNull();
    expect(birthYearOf("nope")).toBeNull();
  });
});
