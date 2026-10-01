/**
 * Audit AC-19 — «Отказался» on the phone is the patient's decision: the
 * patient is told «приём отменён, если передумаете, мы рядом», not the
 * clinic's «отменён, извините за неудобство». Staff cancels keep the staff
 * text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  fired: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: vi.fn((p: Record<string, unknown>) => state.fired.push(p)),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeCaseAppointments: vi.fn(),
}));
vi.mock("@/server/actions/in-clinic", () => ({ retireVisitRiskActions: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev" })),
}));
vi.mock("@/lib/prisma", () => {
  const appointment = {
    findUnique: vi.fn(async () => (state.row ? { ...state.row } : null)),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.row = { ...state.row, ...data };
      return { ...state.row };
    }),
  };
  const prisma = {
    appointment,
    notificationSend: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

import { cancelAppointment } from "@/server/appointments/cancel";
import { applyOutcomeToAppointment } from "@/server/actions/outcome";

beforeEach(() => {
  state.fired = [];
  state.row = {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    cabinetId: null,
    medicalCaseId: null,
    date: new Date(Date.now() + 3 * 60 * 60_000),
    endDate: new Date(Date.now() + 3.5 * 60 * 60_000),
    status: "CONFIRMED",
    queueStatus: "CONFIRMED",
    channel: "PHONE",
  };
});

describe("the cancel notice follows who decided", () => {
  it("«Отказался» from the risk list sends the patient's variant", async () => {
    const res = await applyOutcomeToAppointment({
      outcome: "REFUSED",
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "u_recept",
      note: "передумал",
    });
    expect(res && res.ok).toBe(true);
    expect(state.fired).toEqual([
      { kind: "appointment.cancelled.by-patient", appointmentId: "apt_1" },
    ]);
  });

  it("«Хочет прийти позже» too: the patient will come another day", async () => {
    await applyOutcomeToAppointment({
      outcome: "RETURN_LATER",
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "u_recept",
      note: null,
    });
    expect(state.fired[0]?.kind).toBe("appointment.cancelled.by-patient");
  });

  it("a cancel the clinic decides keeps the clinic's apology", async () => {
    await cancelAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "u_recept",
      reason: "врач заболел",
    });
    expect(state.fired[0]?.kind).toBe("appointment.cancelled.by-staff");
  });
});
