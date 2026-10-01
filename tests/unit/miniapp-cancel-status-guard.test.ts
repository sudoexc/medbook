/**
 * Audit MA-15 — a patient can no longer cancel a visit already on the
 * doctor's table.
 *
 * The Mini App DELETE went straight to `cancelAppointment`, which refused
 * only COMPLETED: a tap on a stale ✕ after «Начать приём» made the visit
 * CANCELLED, the current patient vanished from the doctor's queue and the
 * started exam hung on a cancelled row. Now the kernel lets a PATIENT cancel
 * only BOOKED, CONFIRMED, WAITING or SKIPPED, re-checked inside the write.
 * Staff cancels are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  /** Status the row has by the time the conditional write runs. */
  statusAtWrite: null as string | null,
  updateMany: [] as Array<Record<string, unknown>>,
  update: [] as Array<Record<string, unknown>>,
  fired: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/miniapp/handler", () => {
  const wrap =
    (_opts: unknown, handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        body: undefined,
        ctx: {
          clinicId: "c1",
          clinicSlug: "neurofax",
          patientId: "p1",
          patient: { id: "p1", fullName: "Dilnoza", preferredLang: "RU" },
        },
      });
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    preferredLang: "RU",
    ownerPatientId: "p1",
  })),
}));
vi.mock("@/server/appointments/patient-reschedule", () => ({
  reschedulePatientAppointment: vi.fn(),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeCaseAppointments: vi.fn(),
}));
vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: vi.fn((p: Record<string, unknown>) => state.fired.push(p)),
}));
vi.mock("@/server/actions/in-clinic", () => ({ retireVisitRiskActions: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev" })),
}));

vi.mock("@/lib/prisma", () => {
  const appointment = {
    findFirst: vi.fn(async () => (state.row ? { id: state.row.id } : null)),
    findUnique: vi.fn(async () => (state.row ? { ...state.row } : null)),
    findUniqueOrThrow: vi.fn(async () => ({ ...state.row })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.update.push(data);
      state.row = { ...state.row, ...data };
      return { ...state.row };
    }),
    updateMany: vi.fn(
      async ({ where, data }: { where: { status: { in: string[] } }; data: Record<string, unknown> }) => {
        state.updateMany.push({ where, data });
        const status = state.statusAtWrite ?? (state.row!.status as string);
        if (!where.status.in.includes(status)) {
          state.row = { ...state.row, status };
          return { count: 0 };
        }
        state.row = { ...state.row, ...data };
        return { count: 1 };
      },
    ),
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
import { DELETE } from "@/app/api/miniapp/appointments/[id]/route";

function row(status: string): Record<string, unknown> {
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    cabinetId: "cab1",
    medicalCaseId: null,
    date: new Date("2026-10-01T05:00:00Z"),
    endDate: new Date("2026-10-01T05:30:00Z"),
    status,
    queueStatus: status,
    channel: "TELEGRAM",
  };
}

const byPatient = {
  appointmentId: "apt_1",
  clinicId: "c1",
  actorId: null,
  actorRole: "PATIENT" as const,
  actorPatientId: "p1",
  surface: "MINIAPP" as const,
};

beforeEach(() => {
  state.row = null;
  state.statusAtWrite = null;
  state.updateMany = [];
  state.update = [];
  state.fired = [];
});

describe("DELETE /api/miniapp/appointments/[id]", () => {
  it("a visit IN_PROGRESS answers 409 and its status does not change", async () => {
    state.row = row("IN_PROGRESS");
    const res = await DELETE(
      new Request("http://x/api/miniapp/appointments/apt_1?clinicSlug=neurofax", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_cancellable" });
    expect(state.row!.status).toBe("IN_PROGRESS");
    expect(state.updateMany).toHaveLength(0);
    expect(state.fired).toHaveLength(0);
  });

  it("a booked visit is cancelled", async () => {
    state.row = row("BOOKED");
    const res = await DELETE(
      new Request("http://x/api/miniapp/appointments/apt_1?clinicSlug=neurofax", {
        method: "DELETE",
        body: JSON.stringify({ reason: "patient:cant_come" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.row!.status).toBe("CANCELLED");
    expect(state.fired).toContainEqual({
      kind: "appointment.cancelled.by-patient",
      appointmentId: "apt_1",
    });
  });
});

describe("cancelAppointment by the patient", () => {
  it("refuses a no-show instead of calling it «already cancelled»", async () => {
    state.row = row("NO_SHOW");
    expect(await cancelAppointment(byPatient)).toEqual({ ok: false, reason: "not_cancellable" });
  });

  it("lets a queued or skipped patient leave", async () => {
    for (const status of ["CONFIRMED", "WAITING", "SKIPPED"]) {
      state.row = row(status);
      const res = await cancelAppointment(byPatient);
      expect(res.ok, status).toBe(true);
    }
  });

  it("a second tap on a cancelled visit is still a quiet success", async () => {
    state.row = row("CANCELLED");
    const res = await cancelAppointment(byPatient);
    expect(res).toMatchObject({ ok: true, alreadyCancelled: true });
  });

  it("the doctor starting the visit between the read and the write wins", async () => {
    state.row = row("WAITING");
    state.statusAtWrite = "IN_PROGRESS";
    expect(await cancelAppointment(byPatient)).toEqual({ ok: false, reason: "not_cancellable" });
    expect(state.row!.status).toBe("IN_PROGRESS");
    expect(state.fired).toHaveLength(0);
    // The write was conditional on a cancellable status.
    expect(state.updateMany[0]!.where).toMatchObject({
      status: { in: ["BOOKED", "CONFIRMED", "WAITING", "SKIPPED"] },
    });
  });
});

describe("a double tap", () => {
  it("losing to the first tap's cancel is still a success", async () => {
    state.row = row("BOOKED");
    state.statusAtWrite = "CANCELLED";
    const res = await cancelAppointment(byPatient);
    expect(res).toMatchObject({ ok: true, alreadyCancelled: true });
    expect(state.fired).toHaveLength(0);
  });
});

describe("staff cancels are unchanged", () => {
  it("reception may still cancel a visit in progress", async () => {
    state.row = row("IN_PROGRESS");
    const res = await cancelAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "u_desk",
    });
    expect(res.ok).toBe(true);
    expect(state.update).toHaveLength(1);
    expect(state.updateMany).toHaveLength(0);
  });
});
