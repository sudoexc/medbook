/**
 * Phase 11 — Doctor↔Cabinet 1:1 binding + per-doctor services invariants.
 *
 * Pure schema tests. The route-level invariants (cabinet-occupied 409,
 * service-orphan 409) live behind Prisma calls and need an integration test;
 * these tests pin down what the wire format is allowed to be so future
 * refactors don't accidentally drop the constraint.
 */
import { describe, expect, it } from "vitest";

import {
  CreateDoctorSchema,
  ReplaceScheduleSchema,
  ScheduleEntrySchema,
} from "@/server/schemas/doctor";
import { CreateServiceSchema } from "@/server/schemas/service";
import {
  DoctorServiceAssignmentSchema,
  UpdateDoctorServicesSchema,
} from "@/server/schemas/doctor-services";

const VALID_DOCTOR = {
  slug: "test-doc",
  nameRu: "Тест",
  nameUz: "Test",
  specializationRu: "Терапевт",
  specializationUz: "Terapevt",
  cabinetId: "cab_1",
};

describe("CreateDoctorSchema — cabinet binding required", () => {
  it("accepts a doctor with cabinetId", () => {
    const r = CreateDoctorSchema.safeParse(VALID_DOCTOR);
    expect(r.success).toBe(true);
  });

  it("rejects a doctor without cabinetId (no headless doctors)", () => {
    const { cabinetId: _drop, ...rest } = VALID_DOCTOR;
    void _drop;
    const r = CreateDoctorSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects empty cabinetId", () => {
    const r = CreateDoctorSchema.safeParse({ ...VALID_DOCTOR, cabinetId: "" });
    expect(r.success).toBe(false);
  });

  it("accepts an inline services array with both overrides", () => {
    const r = CreateDoctorSchema.safeParse({
      ...VALID_DOCTOR,
      services: [
        { serviceId: "svc_1", priceOverride: 150_000, durationMinOverride: 45 },
        { serviceId: "svc_2" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects durationMinOverride below 5 minutes", () => {
    const r = CreateDoctorSchema.safeParse({
      ...VALID_DOCTOR,
      services: [{ serviceId: "svc_1", durationMinOverride: 1 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("CreateServiceSchema — services require ≥1 doctor", () => {
  const VALID_SERVICE = {
    code: "CONSULT_TEST",
    nameRu: "Консультация",
    nameUz: "Konsultatsiya",
    durationMin: 30,
    priceBase: 200_000,
    doctorIds: ["doc_1"],
  };

  it("accepts a service with one doctor", () => {
    const r = CreateServiceSchema.safeParse(VALID_SERVICE);
    expect(r.success).toBe(true);
  });

  it("accepts a service with multiple doctors", () => {
    const r = CreateServiceSchema.safeParse({
      ...VALID_SERVICE,
      doctorIds: ["doc_1", "doc_2", "doc_3"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a service with empty doctorIds", () => {
    const r = CreateServiceSchema.safeParse({
      ...VALID_SERVICE,
      doctorIds: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a service with missing doctorIds key (no nurse-only services)", () => {
    const { doctorIds: _drop, ...rest } = VALID_SERVICE;
    void _drop;
    const r = CreateServiceSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });
});

describe("DoctorServiceAssignmentSchema — per-doctor overrides", () => {
  it("accepts price + duration overrides", () => {
    const r = DoctorServiceAssignmentSchema.safeParse({
      serviceId: "svc_1",
      priceOverride: 250_000,
      durationMinOverride: 60,
    });
    expect(r.success).toBe(true);
  });

  it("accepts null overrides (fall back to Service base values)", () => {
    const r = DoctorServiceAssignmentSchema.safeParse({
      serviceId: "svc_1",
      priceOverride: null,
      durationMinOverride: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative priceOverride", () => {
    const r = DoctorServiceAssignmentSchema.safeParse({
      serviceId: "svc_1",
      priceOverride: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects durationMinOverride above 600 minutes", () => {
    const r = DoctorServiceAssignmentSchema.safeParse({
      serviceId: "svc_1",
      durationMinOverride: 9999,
    });
    expect(r.success).toBe(false);
  });

  it("UpdateDoctorServicesSchema accepts an empty array (used to detach all)", () => {
    // Detaching every service is a recoverable state — the doctor itself is
    // still bound to their cabinet, just temporarily without services.
    // The orphan-prevention check lives at the Service-side, not here.
    const r = UpdateDoctorServicesSchema.safeParse({ assignments: [] });
    expect(r.success).toBe(true);
  });
});

describe("ScheduleEntrySchema — Phase 11 dropped per-shift cabinetId", () => {
  it("accepts a schedule entry without cabinetId", () => {
    const r = ScheduleEntrySchema.safeParse({
      weekday: 1,
      startTime: "09:00",
      endTime: "13:00",
    });
    expect(r.success).toBe(true);
  });

  it("silently strips a stale cabinetId from old clients", () => {
    // zod default is `strip` for unknown keys — the cabinetId never makes it
    // into the create payload, so the doctor's bound cabinet always wins.
    const r = ScheduleEntrySchema.safeParse({
      weekday: 1,
      startTime: "09:00",
      endTime: "13:00",
      cabinetId: "cab_legacy",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("cabinetId");
    }
  });

  it("ReplaceScheduleSchema caps entries at 100 per request", () => {
    const entries = Array.from({ length: 101 }, () => ({
      weekday: 1,
      startTime: "09:00",
      endTime: "10:00",
    }));
    const r = ReplaceScheduleSchema.safeParse({ entries });
    expect(r.success).toBe(false);
  });
});
