import { describe, expect, it } from "vitest";

import {
  birthYearOf,
  foldNameToken,
  nameTokens,
  probeFromTyped,
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

  it("the owner typed the doctor's way (surname + initial) is her", () => {
    expect(samePersonLikely(probeFromTyped("Каримова Д", TODAY), mother)).toBe(true);
    expect(samePersonLikely(probeFromTyped("Каримова Дилноза 1985", TODAY), mother)).toBe(true);
    expect(samePersonLikely(probeFromTyped("Karimova Dilnoza", TODAY), mother)).toBe(true);
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

  it("an unknown birth date on either side does not block a name match", () => {
    const noDate = { fullName: "Каримова Дилноза", birthDate: null };
    expect(samePersonLikely(probeFromTyped("Каримова Дилноза 1985", TODAY), noDate)).toBe(true);
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
