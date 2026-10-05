/**
 * The age on the doctor's visit screen (owner request 05.10.2026): it never
 * showed, because the queue did not carry the birth date; under a year it
 * counts months.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import { ageFromBirth } from "@/lib/patient-age";

const NOW = new Date(2026, 9, 5, 12, 0); // 05.10.2026, local time

describe("ageFromBirth", () => {
  it("full years, the birthday itself included", () => {
    expect(ageFromBirth("1990-10-05T00:00:00", NOW)?.years).toBe(36);
    expect(ageFromBirth("1990-10-06T00:00:00", NOW)?.years).toBe(35);
    expect(ageFromBirth("1990-11-01T00:00:00", NOW)?.years).toBe(35);
  });

  it("months under a year", () => {
    expect(ageFromBirth("2026-02-05T00:00:00", NOW)).toEqual({ years: 0, months: 8 });
    expect(ageFromBirth("2026-09-20T00:00:00", NOW)).toEqual({ years: 0, months: 0 });
  });

  it("nothing for a missing, broken or future date", () => {
    expect(ageFromBirth(null, NOW)).toBeNull();
    expect(ageFromBirth(undefined, NOW)).toBeNull();
    expect(ageFromBirth("", NOW)).toBeNull();
    expect(ageFromBirth("not a date", NOW)).toBeNull();
    expect(ageFromBirth("2027-01-01T00:00:00", NOW)).toBeNull();
  });
});

describe("wiring", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("the doctor's queue carries the birth date", () => {
    expect(read("src/app/api/crm/appointments/route.ts")).toContain(
      "select: { id: true, fullName: true, phone: true, photoUrl: true, birthDate: true }",
    );
    const card = read("src/app/[locale]/doctor/reception/_components/active-patient-card.tsx");
    expect(card).toContain("ageFromBirth(p.birthDate)");
    expect(card).not.toContain("as unknown as { birthDate");
  });

  it("years decline in Russian, months have words in both languages", () => {
    const ruA = ru.doctor.reception.activePatient;
    const uzA = uz.doctor.reception.activePatient;
    expect(ruA.ageYears).toBe("{age, plural, one {# год} few {# года} many {# лет} other {# лет}}");
    expect(ruA.ageMonths).toContain("{months, plural,");
    expect(uzA.ageYears).toContain("{age}");
    expect(uzA.ageMonths).toContain("{months}");
  });
});
