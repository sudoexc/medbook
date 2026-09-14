/**
 * Parsing the way this clinic's doctor actually writes patients.
 *
 * Real production strings, taken verbatim from the first 94 patients he
 * entered: «Турматов О 1969», «Абенов  2016» (double space, no initial),
 * «Тажибаева К  1984», «Абдука.мов А 2004» (typo he left in). Reception, on
 * the same base, types «Цой Вадим» with no year at all. Both have to survive.
 */
import { describe, expect, it } from "vitest";

import {
  birthDateFromYear,
  parsePatientIdentity,
} from "@/lib/patients/parse-identity";

/** Frozen "now" so ages don't drift with the calendar. */
const TODAY = new Date("2026-09-14T00:00:00.000Z");

const parse = (s: string) => parsePatientIdentity(s, TODAY);

describe("parsePatientIdentity — the doctor's habit", () => {
  it("splits «Турматов О 1969» into name and year", () => {
    expect(parse("Турматов О 1969")).toEqual({
      fullName: "Турматов О",
      birthYear: 1969,
      age: 57,
      matched: true,
    });
  });

  it("handles the double space he leaves when skipping the initial", () => {
    expect(parse("Абенов  2016")).toEqual({
      fullName: "Абенов",
      birthYear: 2016,
      age: 10,
      matched: true,
    });
  });

  it("handles a double space before the year", () => {
    expect(parse("Тажибаева К  1984").fullName).toBe("Тажибаева К");
  });

  it("leaves his typos alone — they are his data, not ours to fix", () => {
    expect(parse("Абдука.мов А 2004")).toEqual({
      fullName: "Абдука.мов А",
      birthYear: 2004,
      age: 22,
      matched: true,
    });
  });

  it("accepts a full first name with a year", () => {
    expect(parse("Саидназарова Малика 2000")).toEqual({
      fullName: "Саидназарова Малика",
      birthYear: 2000,
      age: 26,
      matched: true,
    });
  });

  it("finds the year even when it leads the string", () => {
    expect(parse("1975 Мовлонова Н")).toEqual({
      fullName: "Мовлонова Н",
      birthYear: 1975,
      age: 51,
      matched: true,
    });
  });
});

describe("parsePatientIdentity — reception's habit still works", () => {
  it("keeps a plain name untouched and reports no year", () => {
    expect(parse("Цой Вадим")).toEqual({
      fullName: "Цой Вадим",
      birthYear: null,
      age: null,
      matched: false,
    });
  });

  it("collapses stray whitespace in a plain name", () => {
    expect(parse("  Жахонгирова   Мадина  ").fullName).toBe("Жахонгирова Мадина");
  });
});

describe("parsePatientIdentity — refuses nonsense years", () => {
  it("ignores a future year", () => {
    const r = parse("Пациент 2099");
    expect(r.birthYear).toBeNull();
    expect(r.fullName).toBe("Пациент 2099");
  });

  it("ignores an implausibly old year", () => {
    expect(parse("Пациент 1823").birthYear).toBeNull();
  });

  it("does not treat a 4-digit fragment of a longer number as a year", () => {
    // A phone typed into the name field must not donate a birth year.
    const r = parse("Пациент 998909038721");
    expect(r.birthYear).toBeNull();
  });

  it("does not strip the year when nothing would be left as a name", () => {
    const r = parse("2007");
    expect(r.matched).toBe(false);
    expect(r.fullName).toBe("2007");
  });

  it("accepts the current year (a newborn)", () => {
    expect(parse("Новорождённый 2026")).toEqual({
      fullName: "Новорождённый",
      birthYear: 2026,
      age: 0,
      matched: true,
    });
  });

  it("returns empty for empty input", () => {
    expect(parse("   ")).toEqual({
      fullName: "",
      birthYear: null,
      age: null,
      matched: false,
    });
  });
});

describe("birthDateFromYear", () => {
  it("pins to 1 January UTC — the year is all we were told", () => {
    expect(birthDateFromYear(1969).toISOString()).toBe("1969-01-01T00:00:00.000Z");
  });
});
