/**
 * Phase 17 Wave 3 — bundle builder.
 *
 * Pure function: pass synthetic patient data, get a normalised bundle
 * back. Verifies:
 *  - Top-level meta carries the expected counts (matches the input
 *    array lengths).
 *  - Collections come back sorted oldest-first (chronological history),
 *    even when the input is shuffled.
 *  - bundleToJson serialises Date instances as ISO strings.
 */
import { describe, it, expect } from "vitest";

import {
  type DsarAppointmentInput,
  type DsarBundleInput,
  type DsarMedicalCaseInput,
  type DsarMessageInput,
  type DsarPatientInput,
  type DsarPaymentInput,
  type DsarPrescriptionInput,
  type DsarReviewInput,
  buildDsarBundle,
  bundleToJson,
} from "@/server/dsar/bundle";

function makePatient(): DsarPatientInput {
  return {
    id: "p_1",
    clinicId: "c_1",
    fullName: "Иван Иванов",
    phone: "+998 90 000 00 00",
    phoneNormalized: "998900000000",
    birthDate: new Date("1990-01-01"),
    gender: "M",
    passport: null,
    address: null,
    telegramId: "tg_1",
    telegramUsername: "ivanov",
    preferredChannel: "TELEGRAM",
    preferredLang: "RU",
    segment: "ACTIVE",
    tags: [],
    notes: null,
    ltv: 0,
    visitsCount: 0,
    balance: 0,
    consentMarketing: true,
    marketingOptOut: false,
    marketingOptOutAt: null,
    marketingOptOutSource: null,
    summaryCache: null,
    summaryCacheUpdatedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

const D = (s: string) => new Date(s);

describe("buildDsarBundle", () => {
  it("populates meta.counts from input array lengths", () => {
    const input: DsarBundleInput = {
      generatedAt: D("2026-05-07T00:00:00Z"),
      jobId: "job_42",
      clinic: { id: "c_1", nameRu: "Клиника", nameUz: "Klinika", slug: "neurofax" },
      patient: makePatient(),
      appointments: [
        { id: "a1", startAt: D("2026-02-01"), endAt: D("2026-02-01"), status: "COMPLETED", doctorName: null, serviceName: null, price: null, notes: null },
      ] as DsarAppointmentInput[],
      payments: [
        { id: "pay1", amount: 100, currency: "UZS", status: "PAID", paidAt: D("2026-02-01"), method: "CASH", appointmentId: "a1" },
      ] as DsarPaymentInput[],
      reviews: [] as DsarReviewInput[],
      prescriptions: [] as DsarPrescriptionInput[],
      messages: [] as DsarMessageInput[],
      medicalCases: [] as DsarMedicalCaseInput[],
    };
    const out = buildDsarBundle(input);
    expect(out.meta.schemaVersion).toBe(1);
    expect(out.meta.jobId).toBe("job_42");
    expect(out.meta.clinicId).toBe("c_1");
    expect(out.meta.clinicNameRu).toBe("Клиника");
    expect(out.meta.clinicNameUz).toBe("Klinika");
    expect(out.meta.clinicSlug).toBe("neurofax");
    expect(out.meta.patientId).toBe("p_1");
    expect(out.meta.counts.appointments).toBe(1);
    expect(out.meta.counts.payments).toBe(1);
    expect(out.meta.counts.reviews).toBe(0);
    expect(out.meta.counts.prescriptions).toBe(0);
    expect(out.meta.counts.messages).toBe(0);
    expect(out.meta.counts.medicalCases).toBe(0);
  });

  it("sorts appointments by startAt ascending", () => {
    const a1: DsarAppointmentInput = { id: "a1", startAt: D("2026-03-01"), endAt: D("2026-03-01"), status: "COMPLETED", doctorName: null, serviceName: null, price: null, notes: null };
    const a2: DsarAppointmentInput = { id: "a2", startAt: D("2026-01-01"), endAt: D("2026-01-01"), status: "COMPLETED", doctorName: null, serviceName: null, price: null, notes: null };
    const a3: DsarAppointmentInput = { id: "a3", startAt: D("2026-02-01"), endAt: D("2026-02-01"), status: "COMPLETED", doctorName: null, serviceName: null, price: null, notes: null };
    const out = buildDsarBundle({
      generatedAt: D("2026-05-07"),
      jobId: "job_42",
      clinic: { id: "c_1", nameRu: "x", nameUz: "x", slug: "x" },
      patient: makePatient(),
      appointments: [a1, a2, a3],
      payments: [],
      reviews: [],
      prescriptions: [],
      messages: [],
      medicalCases: [],
    });
    expect(out.appointments.map((a) => a.id)).toEqual(["a2", "a3", "a1"]);
  });

  it("sorts created-at collections oldest-first", () => {
    const m1: DsarMessageInput = { id: "m1", channel: "TELEGRAM", direction: "OUT", body: "later", createdAt: D("2026-02-15") };
    const m2: DsarMessageInput = { id: "m2", channel: "TELEGRAM", direction: "IN", body: "earlier", createdAt: D("2026-02-01") };
    const out = buildDsarBundle({
      generatedAt: D("2026-05-07"),
      jobId: "job_42",
      clinic: { id: "c_1", nameRu: "x", nameUz: "x", slug: "x" },
      patient: makePatient(),
      appointments: [],
      payments: [],
      reviews: [],
      prescriptions: [],
      messages: [m1, m2],
      medicalCases: [],
    });
    expect(out.messages.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("does not mutate the caller's arrays", () => {
    const messages: DsarMessageInput[] = [
      { id: "m1", channel: "TELEGRAM", direction: "OUT", body: "later", createdAt: D("2026-02-15") },
      { id: "m2", channel: "TELEGRAM", direction: "IN", body: "earlier", createdAt: D("2026-02-01") },
    ];
    const before = messages.map((m) => m.id);
    buildDsarBundle({
      generatedAt: D("2026-05-07"),
      jobId: "job_42",
      clinic: { id: "c_1", nameRu: "x", nameUz: "x", slug: "x" },
      patient: makePatient(),
      appointments: [],
      payments: [],
      reviews: [],
      prescriptions: [],
      messages,
      medicalCases: [],
    });
    expect(messages.map((m) => m.id)).toEqual(before);
  });

  it("bundleToJson serialises Dates as ISO strings", () => {
    const out = buildDsarBundle({
      generatedAt: D("2026-05-07T00:00:00.000Z"),
      jobId: "job_42",
      clinic: { id: "c_1", nameRu: "x", nameUz: "x", slug: "x" },
      patient: makePatient(),
      appointments: [],
      payments: [],
      reviews: [],
      prescriptions: [],
      messages: [],
      medicalCases: [],
    });
    const json = bundleToJson(out);
    expect(json).toContain('"generatedAt": "2026-05-07T00:00:00.000Z"');
    // The patient.createdAt also has to be ISO — it was a Date in the
    // input.
    expect(json).toContain('"createdAt": "2026-01-01T00:00:00.000Z"');
    // Confirm valid JSON.
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
