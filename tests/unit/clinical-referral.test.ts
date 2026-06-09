/**
 * P2.1 — clinical referral (направление) schema + PDF smoke tests.
 *
 * Two concerns locked here before any DB write / render path runs:
 *   1. `CreateReferralSchema` enforces the internal-XOR-external invariant the
 *      whole feature rests on — the route must always know where the patient is
 *      being sent (a named colleague OR free-text clinic, never both/neither).
 *   2. `renderReferralPdf` produces a valid PDF for both locales without falling
 *      back to Helvetica (which can't render Cyrillic / Uzbek-Latin and throws),
 *      mirroring `conclusion-pdf.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  CreateReferralSchema,
  QueryReferralsSchema,
} from "@/server/schemas/referrals";
import { renderReferralPdf } from "@/server/referrals/referral-pdf";

describe("CreateReferralSchema", () => {
  const base = { patientId: "patient-1", reason: "консультация кардиолога" };

  it("accepts an internal referral (toDoctorId only)", () => {
    const parsed = CreateReferralSchema.safeParse({
      ...base,
      toDoctorId: "user-2",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an external referral (externalTo only)", () => {
    const parsed = CreateReferralSchema.safeParse({
      ...base,
      externalTo: "Республиканский кардиоцентр · кардиолог",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a referral that targets BOTH a colleague and an external clinic", () => {
    const parsed = CreateReferralSchema.safeParse({
      ...base,
      toDoctorId: "user-2",
      externalTo: "Внешняя клиника",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a referral that targets NEITHER", () => {
    const parsed = CreateReferralSchema.safeParse(base);
    expect(parsed.success).toBe(false);
  });

  it("treats a blank externalTo as no target (so toDoctorId is still required)", () => {
    // "   " trims to "" → min(1) fails on externalTo; with no toDoctorId the
    // XOR also fails. Either way the payload must be rejected.
    const parsed = CreateReferralSchema.safeParse({
      ...base,
      externalTo: "   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty / whitespace-only reason", () => {
    const parsed = CreateReferralSchema.safeParse({
      patientId: "patient-1",
      toDoctorId: "user-2",
      reason: "   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("trims reason and externalTo", () => {
    const parsed = CreateReferralSchema.safeParse({
      patientId: "patient-1",
      externalTo: "  Кардиоцентр  ",
      reason: "  нужна консультация  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reason).toBe("нужна консультация");
      expect(parsed.data.externalTo).toBe("Кардиоцентр");
    }
  });

  it("rejects a reason past the 5000-char cap", () => {
    const parsed = CreateReferralSchema.safeParse({
      ...base,
      toDoctorId: "user-2",
      reason: "x".repeat(5001),
    });
    expect(parsed.success).toBe(false);
  });

  it("requires patientId", () => {
    const parsed = CreateReferralSchema.safeParse({
      toDoctorId: "user-2",
      reason: "ok",
    });
    expect(parsed.success).toBe(false);
  });

  it("carries the optional ICD-10 snapshot when present", () => {
    const parsed = CreateReferralSchema.safeParse({
      ...base,
      toDoctorId: "user-2",
      diagnosisCode: "I49.9",
      diagnosisName: "Нарушение сердечного ритма неуточнённое",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.diagnosisCode).toBe("I49.9");
    }
  });
});

describe("QueryReferralsSchema", () => {
  it("defaults limit to 50 when omitted", () => {
    const parsed = QueryReferralsSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(50);
  });

  it("coerces a string limit from the query string", () => {
    const parsed = QueryReferralsSchema.safeParse({ limit: "20" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(20);
  });

  it("accepts the incoming / outgoing scopes", () => {
    expect(QueryReferralsSchema.safeParse({ scope: "incoming" }).success).toBe(
      true,
    );
    expect(QueryReferralsSchema.safeParse({ scope: "outgoing" }).success).toBe(
      true,
    );
  });

  it("rejects an unknown scope and an unknown status", () => {
    expect(QueryReferralsSchema.safeParse({ scope: "sideways" }).success).toBe(
      false,
    );
    expect(QueryReferralsSchema.safeParse({ status: "DONE" }).success).toBe(
      false,
    );
  });
});

describe("renderReferralPdf", () => {
  it("emits a PDF starting with %PDF- and ending with %%EOF (ru, internal)", async () => {
    const buf = await renderReferralPdf({
      clinicName: "NeuroFax",
      clinicAddress: "Ташкент, ул. Амира Темура 1",
      clinicPhone: "+998901234567",
      fromDoctorName: "Каримов А.А.",
      toLabel: "Усманова Г.Р. · кардиолог",
      patientName: "Иван Иванов",
      dateLabel: "7 мая 2026",
      diagnosisCode: "I49.9",
      diagnosisName: "Нарушение сердечного ритма",
      reason: "Консультация кардиолога по поводу нарушения ритма.",
      locale: "ru",
      generatedAt: new Date("2026-05-07T09:30:00Z"),
      brandColor: "#3DD5C0",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.subarray(buf.length - 32).toString("ascii")).toContain("%%EOF");
    expect(buf.length).toBeGreaterThan(2_000);
  });

  it("renders the Uzbek-Latin locale (external target) without crashing", async () => {
    const buf = await renderReferralPdf({
      clinicName: "Klinika",
      toLabel: "Respublika kardiologiya markazi",
      patientName: "Olimjon Karimov",
      dateLabel: "7-may 2026",
      reason: "Yurak ritmi buzilishi bo‘yicha maslahat.",
      locale: "uz",
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders with no diagnosis and no authoring doctor (defensive)", async () => {
    const buf = await renderReferralPdf({
      clinicName: "X",
      toLabel: "—",
      patientName: "Y",
      dateLabel: "—",
      reason: "направление",
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("falls back to the brand default for an invalid colour (no throw)", async () => {
    const buf = await renderReferralPdf({
      clinicName: "X",
      toLabel: "Z",
      patientName: "Y",
      dateLabel: "—",
      reason: "тест",
      brandColor: "not-a-color",
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
