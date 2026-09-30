/**
 * Audit PT-15, review of 1b62941: a patient with a visit booked ahead is
 * never «Остывают» or «Потерянные» (`classifyPatientSegment`), and a new
 * booking refreshes the segment at once instead of waiting for the 6-hour
 * pass. Otherwise a patient reception has just booked stays on the
 * «Остывают» call list, and a DORMANT broadcast asks him to come back.
 *
 * This file pins the phone / Mini App booking kernel (`bookAppointment`).
 * The walk-in kernel is pinned in walkin-register.test.ts, a doctor's
 * revert in visit-close-unsigned-draft.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  refresh: vi.fn(async (_patientId: string) => undefined),
  order: [] as string[],
}));

vi.mock("@/server/patient/segments", () => ({
  refreshPatientSegment: h.refresh,
}));
vi.mock("@/server/services/appointments", () => ({
  applyTime: (date: Date) => date,
  computeEndDate: (start: Date, durationMin: number) =>
    new Date(start.getTime() + durationMin * 60_000),
  detectConflicts: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(async () => ({
        id: "doc_1",
        clinicId: "c1",
        cabinetId: "cab_1",
        isActive: true,
        cabinet: { isActive: true },
      })),
    },
    service: { findMany: vi.fn(async () => []) },
    appointment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.order.push("appointment.create");
        return {
          id: "appt_1",
          ...data,
          priceService: data.priceService ?? null,
        };
      }),
    },
    appointmentService: { createMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: { create: vi.fn(async () => ({ id: "a" })) },
    eventOutbox: { create: vi.fn(async () => ({ id: "ob" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const { prisma } = await import("@/lib/prisma");
      return fn(prisma);
    }),
  },
}));

import { bookAppointment } from "@/server/appointments/book";
import { detectConflicts } from "@/server/services/appointments";

function book() {
  return bookAppointment({
    clinicId: "c1",
    patientId: "p_cooling",
    doctorId: "doc_1",
    startAt: new Date("2026-10-07T05:00:00.000Z"),
    durationMin: 20,
    channel: "PHONE",
    autoConfirm: true,
    createdById: "u_desk",
    actor: {
      role: "RECEPTIONIST",
      userId: "u_desk",
      patientId: null,
      onBehalfOfPatientId: null,
      label: "user:u_desk",
    },
    surface: "CRM",
  });
}

beforeEach(() => {
  h.refresh.mockClear();
  h.order = [];
  h.refresh.mockImplementation(async () => {
    h.order.push("refreshPatientSegment");
  });
});

describe("a booking refreshes the patient's segment (PT-15)", () => {
  it("refreshes the booked patient's segment after the booking is saved", async () => {
    const res = await book();
    expect(res.ok).toBe(true);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledWith("p_cooling");
    // After the row exists, so the rule sees the new booking.
    expect(h.order).toEqual(["appointment.create", "refreshPatientSegment"]);
  });

  it("a refused booking changes nothing", async () => {
    vi.mocked(detectConflicts).mockResolvedValueOnce({
      ok: false,
      reason: "doctor_busy",
    } as never);
    const res = await book();
    expect(res.ok).toBe(false);
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
