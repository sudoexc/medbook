/**
 * Audit MA-14 — the booking kernel's `guard` (the Mini App's per-patient
 * limits) runs inside the booking transaction, before the row is written,
 * and a refusal books nothing. Two racing taps both passing the count lose
 * on Serializable: the loser is checked again and gets the limit, not
 * «doctor busy». Staff bookings pass no guard and are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  creates: 0,
  inTx: false,
  guardSawTx: false,
  failWith: null as Error | null,
}));

vi.mock("@/server/services/appointments", () => ({
  applyTime: (d: Date) => d,
  computeEndDate: (start: Date, min: number) => new Date(start.getTime() + min * 60_000),
  detectConflicts: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(),
  recomputeCaseAppointments: vi.fn(),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/appointments/ticket-code", () => ({
  generateTicketCode: vi.fn(async () => "TCK001"),
}));
vi.mock("@/server/patient/segments", () => ({ refreshPatientSegment: vi.fn() }));
vi.mock("@/server/cases/attach", () => ({ autoAttachCase: vi.fn() }));
vi.mock("@/server/referral/apply-reward", () => ({
  findApplicableReferralReward: vi.fn(async () => null),
  markReferralRewardApplied: vi.fn(),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev" })),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    doctor: {
      findUnique: vi.fn(async () => ({
        id: "d1",
        clinicId: "c1",
        cabinetId: "cab1",
        isActive: true,
        cabinet: { isActive: true },
      })),
    },
    // The kernel checks the patient is this clinic's (AP-03) and prices by
    // the doctor's own terms (DR-02); no override here.
    patient: { findFirst: vi.fn(async () => ({ id: "p1" })) },
    serviceOnDoctor: { findMany: vi.fn(async () => []) },
    service: { findMany: vi.fn(async () => [{ id: "s1", priceBase: 100, durationMin: 30 }]) },
    appointment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.creates += 1;
        return { id: "apt_1", ...data };
      }),
    },
    appointmentService: { createMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      state.inTx = true;
      try {
        const out = await fn({ ...prisma, __tx: true });
        if (state.failWith) throw state.failWith;
        return out;
      } finally {
        state.inTx = false;
      }
    }),
  };
  return { prisma };
});

import { bookAppointment, type BookInput } from "@/server/appointments/book";

function input(guard?: BookInput["guard"]): BookInput {
  return {
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    startAt: new Date("2026-10-05T05:00:00Z"),
    serviceId: "s1",
    services: [{ serviceId: "s1", quantity: 1 }],
    channel: "TELEGRAM",
    actor: {
      role: "PATIENT",
      userId: null,
      patientId: "p1",
      onBehalfOfPatientId: null,
      label: "patient:p1",
    },
    surface: "MINIAPP",
    guard,
  };
}

beforeEach(() => {
  state.creates = 0;
  state.guardSawTx = false;
  state.failWith = null;
});

describe("bookAppointment guard", () => {
  it("a refusal inside the transaction books nothing and names the limit", async () => {
    const res = await bookAppointment(
      input(async (tx) => {
        state.guardSawTx = state.inTx && (tx as { __tx?: boolean }).__tx === true;
        return { reason: "booking_limit", limit: "patient_doctor" };
      }),
    );
    expect(res).toEqual({ ok: false, reason: "booking_limit", limit: "patient_doctor" });
    expect(state.guardSawTx).toBe(true);
    expect(state.creates).toBe(0);
  });

  it("a guard that passes lets the booking through", async () => {
    const res = await bookAppointment(input(async () => null));
    expect(res.ok).toBe(true);
    expect(state.creates).toBe(1);
  });

  it("the loser of a serialization race is told the limit, not «busy»", async () => {
    let calls = 0;
    state.failWith = Object.assign(new Error("could not serialize access"), { code: "P2034" });
    const res = await bookAppointment(
      input(async () => {
        calls += 1;
        // In the transaction the count still saw 2; after the race, 3.
        return calls === 1 ? null : { reason: "booking_limit", limit: "patient_total" };
      }),
    );
    expect(res).toEqual({ ok: false, reason: "booking_limit", limit: "patient_total" });
  });

  it("without a guard (staff booking) nothing changes", async () => {
    const res = await bookAppointment(input());
    expect(res.ok).toBe(true);
  });
});
