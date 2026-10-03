/**
 * The reception tablet's phone keypad and «Новый пациент» form
 * (src/lib/reception-tablet/phone.ts, new-patient.ts).
 */
import { describe, expect, it } from "vitest";

import {
  formatFull,
  formatLocal,
  isCompleteLocal,
  KEYPAD_ROWS,
  localDigitsFrom,
  phoneSearchTerm,
  phoneTail,
  pressKey,
  toE164,
} from "@/lib/reception-tablet/phone";
import {
  birthYearInput,
  draftFromSearch,
  EMPTY_NEW_PATIENT,
  nameWithoutYear,
  newPatientFullName,
  parseBirthYear,
  validateNewPatient,
} from "@/lib/reception-tablet/new-patient";
import { parsePatientIdentity } from "@/lib/patients/parse-identity";
import { normalizePhone } from "@/lib/phone";

const NOW = new Date("2026-10-03T09:00:00+05:00");

describe("keypad", () => {
  it("is a phone's layout: 1 2 3 on top, clear 0 backspace at the bottom", () => {
    expect(KEYPAD_ROWS[0]).toEqual(["1", "2", "3"]);
    expect(KEYPAD_ROWS[3]).toEqual(["clear", "0", "back"]);
    expect(KEYPAD_ROWS.flat()).toHaveLength(12);
  });

  it("types digits, deletes the last one and clears", () => {
    let v = "";
    for (const k of ["9", "0", "1"] as const) v = pressKey(v, k);
    expect(v).toBe("901");
    expect(pressKey(v, "back")).toBe("90");
    expect(pressKey("", "back")).toBe("");
    expect(pressKey(v, "clear")).toBe("");
  });

  it("stops at nine national digits", () => {
    expect(pressKey("901234567", "8")).toBe("901234567");
  });
});

describe("formatting as the digits arrive", () => {
  it("groups 2 3 2 2 behind the fixed +998", () => {
    expect(formatLocal("")).toBe("");
    expect(formatLocal("9")).toBe("9");
    expect(formatLocal("901")).toBe("90 1");
    expect(formatLocal("9012345")).toBe("90 123 45");
    expect(formatLocal("901234567")).toBe("90 123 45 67");
    expect(formatFull("")).toBe("+998");
    expect(formatFull("901234567")).toBe("+998 90 123 45 67");
  });

  it("formatting carries no dash: the tablet's texts are dash free", () => {
    expect(formatFull("901234567")).not.toMatch(/[—–-]/);
  });
});

describe("what lands in the field", () => {
  it("a paste of the whole number loses the country code", () => {
    expect(localDigitsFrom("+998 90 123-45-67")).toBe("901234567");
    expect(localDigitsFrom("998901234567")).toBe("901234567");
  });

  it("a short run starting with 998 is a local number (operator 99)", () => {
    expect(localDigitsFrom("99812")).toBe("99812");
    expect(localDigitsFrom("998123456")).toBe("998123456");
  });

  it("the formatted value read back gives the same digits", () => {
    expect(localDigitsFrom(formatLocal("901234567"))).toBe("901234567");
    expect(localDigitsFrom(null)).toBe("");
  });
});

describe("complete number", () => {
  it("needs nine digits and a real operator or area code", () => {
    expect(isCompleteLocal("901234567")).toBe(true);
    expect(isCompleteLocal("331234567")).toBe(true);
    expect(isCompleteLocal("90123456")).toBe(false);
    expect(isCompleteLocal("012345678")).toBe(false);
    expect(isCompleteLocal("112345678")).toBe(false);
  });

  it("goes to the API in the shape the server stores", () => {
    expect(toE164("901234567")).toBe("+998901234567");
    expect(normalizePhone(toE164("901234567")!)).toBe("+998901234567");
    expect(toE164("9012")).toBeNull();
  });
});

describe("search while typing", () => {
  it("starts at four digits and sends the national digits", () => {
    expect(phoneSearchTerm("901")).toBeNull();
    expect(phoneSearchTerm("9012")).toBe("9012");
    expect(phoneSearchTerm("901234567")).toBe("901234567");
  });

  it("shows only the tail of a card's number", () => {
    expect(phoneTail("+998901234567")).toBe("45 67");
    expect(phoneTail("contact:abc")).toBe("");
    expect(phoneTail(null)).toBe("");
  });
});

describe("«Новый пациент»", () => {
  it("birth year: four digits in a plausible range, or empty", () => {
    expect(parseBirthYear("", NOW)).toBeNull();
    expect(parseBirthYear("1985", NOW)).toBe(1985);
    expect(parseBirthYear("198", NOW)).toBe("invalid");
    expect(parseBirthYear("1899", NOW)).toBe("invalid");
    expect(parseBirthYear("2027", NOW)).toBe("invalid");
    expect(birthYearInput("19a85x7")).toBe("1985");
  });

  it("the year travels in the name, the way both create routes read it", () => {
    const name = newPatientFullName("  Каримов   Тимур ", 2012);
    expect(name).toBe("Каримов Тимур 2012");
    const parsed = parsePatientIdentity(name, NOW);
    expect(parsed.fullName).toBe("Каримов Тимур");
    expect(parsed.birthYear).toBe(2012);
  });

  it("screens show the name without the year that travels with it", () => {
    expect(nameWithoutYear("Каримов Тимур 2012")).toBe("Каримов Тимур");
    expect(nameWithoutYear("Цой Вадим")).toBe("Цой Вадим");
  });

  it("a year typed into the name by habit is not doubled", () => {
    expect(newPatientFullName("Турматов О 1969", 1969)).toBe("Турматов О 1969");
    expect(newPatientFullName("Турматов О 1969", null)).toBe("Турматов О 1969");
  });

  it("validates name, phone and year, and says which is wrong", () => {
    const empty = validateNewPatient(EMPTY_NEW_PATIENT, NOW);
    expect(empty).toEqual({ ok: false, errors: { fullName: "required", phone: "required" } });

    const bad = validateNewPatient(
      { fullName: "1", phoneLocal: "9012", birthYear: "85", gender: null },
      NOW,
    );
    expect(bad).toEqual({
      ok: false,
      errors: { fullName: "short", phone: "incomplete", birthYear: "invalid" },
    });

    const good = validateNewPatient(
      { fullName: "Ли Анна", phoneLocal: "901234567", birthYear: "1990", gender: "FEMALE" },
      NOW,
    );
    expect(good).toEqual({
      ok: true,
      value: {
        fullName: "Ли Анна 1990",
        phone: "+998901234567",
        birthYear: 1990,
        gender: "FEMALE",
      },
    });
  });

  it("a year typed into the name counts when the year field is empty", () => {
    const v = validateNewPatient(
      { fullName: "Турматов О 1969", phoneLocal: "901234567", birthYear: "", gender: null },
      NOW,
    );
    expect(v.ok && v.value).toMatchObject({ fullName: "Турматов О 1969", birthYear: 1969 });
  });

  it("the year is optional", () => {
    const v = validateNewPatient(
      { fullName: "Ли Анна", phoneLocal: "901234567", birthYear: "", gender: null },
      NOW,
    );
    expect(v.ok && v.value).toMatchObject({ fullName: "Ли Анна", birthYear: null });
  });

  it("carries the search into the form: digits to the phone, words and year to the name", () => {
    expect(draftFromSearch({ phoneLocal: "901234567" })).toMatchObject({
      phoneLocal: "901234567",
      fullName: "",
    });
    expect(draftFromSearch({ nameQuery: " Турматов  1969 " })).toMatchObject({
      fullName: "Турматов",
      birthYear: "1969",
    });
    expect(draftFromSearch({ nameQuery: "Цой Вадим" })).toMatchObject({
      fullName: "Цой Вадим",
      birthYear: "",
    });
  });
});
