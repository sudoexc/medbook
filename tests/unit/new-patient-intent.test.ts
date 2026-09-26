import { describe, expect, it } from "vitest";

import {
  readNewPatientIntent,
  withoutNewPatientParams,
} from "@/lib/patients/new-patient-intent";

/**
 * Audit CM-02: the call center's «Создать карточку» links to
 * /crm/patients?new=true&phone=<caller> and the topbar's «Создать пациента»
 * to /crm/patients?new=true, but the patients page read neither: the
 * operator landed on the plain list mid-call. The page now opens the
 * new-patient dialog from these parameters, with the caller's number, and
 * drops them from the URL.
 */

const params = (qs: string) => new URLSearchParams(qs);

describe("readNewPatientIntent", () => {
  it("opens the dialog with the caller's number from the call center link", () => {
    // Exactly what active-call.tsx builds.
    const phone = "+998 90 123 45 67";
    const qs = `new=true&phone=${encodeURIComponent(phone)}`;
    expect(readNewPatientIntent(params(qs))).toEqual({ phone });
  });

  it("opens an empty dialog from the topbar's «Создать пациента»", () => {
    expect(readNewPatientIntent(params("new=true"))).toEqual({ phone: "" });
  });

  it("does nothing without ?new=true", () => {
    expect(readNewPatientIntent(params(""))).toBeNull();
    expect(readNewPatientIntent(params("phone=%2B998901234567"))).toBeNull();
    expect(readNewPatientIntent(params("new=1"))).toBeNull();
    expect(readNewPatientIntent(null)).toBeNull();
  });

  it("trims the number and caps it at the form's 40 characters", () => {
    expect(readNewPatientIntent(params("new=true&phone=%20%2B998901234567%20"))).toEqual({
      phone: "+998901234567",
    });
    const long = "9".repeat(60);
    expect(readNewPatientIntent(params(`new=true&phone=${long}`))?.phone).toHaveLength(40);
  });
});

describe("withoutNewPatientParams", () => {
  it("drops the deep-link parameters and keeps the list's filters", () => {
    expect(
      withoutNewPatientParams(params("segment=VIP&new=true&phone=%2B998901234567&sort=ltv")),
    ).toBe("segment=VIP&sort=ltv");
    expect(withoutNewPatientParams(params("new=true"))).toBe("");
  });
});
