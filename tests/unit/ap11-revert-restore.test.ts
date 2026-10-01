/**
 * Audit AP-11 — the doctor's «Вернуть» on a cancelled visit or a no-show
 * (`PATCH ?revert=true`, back to a booking):
 *   - never checked the slot: when another patient had taken it, the overlap
 *     constraint threw inside the transaction and the doctor got a 500;
 *   - left live-queue stamps and wrote BOOKED over a confirmed visit;
 *   - told the patient nothing and rebuilt no reminder, though the
 *     cancellation had told him «отменён» and cancelled them all.
 *
 * Pinned:
 *   1. A taken slot answers 409 doctor_busy / cabinet_busy (also when the
 *      constraint has the last word), and nothing is written.
 *   2. A visit the patient cancelled himself in the Mini App is not revived:
 *      409 cancelled_by_patient.
 *   3. A revived visit comes back confirmed if it was, out of the live queue,
 *      and fires `appointment.restored` (notice + reminders).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  apt: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  cancelAudit: null as null | { surface: string | null; actorRole: string | null },
  conflict: { ok: true } as { ok: boolean; reason?: string; until?: string },
  updateThrows: null as unknown,
}));
const spies = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
  detectConflicts: vi.fn(),
}));

vi.mock("@/lib/api-handler", () => {
  const handler =
    (
      opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
      fn: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const parsed = opts.bodySchema?.safeParse(await request.json());
      if (parsed && !parsed.success) return Response.json({ error: "Validation" }, { status: 400 });
      return fn({
        request,
        body: parsed?.data,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u_doc_1", role: "DOCTOR" },
      });
    };
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/services/appointments", () => ({
  applyTime: (date: Date) => date,
  computeEndDate: (start: Date, d: number) => new Date(start.getTime() + d * 60_000),
  detectConflicts: spies.detectConflicts,
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: spies.fireTrigger }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev" })),
}));
vi.mock("@/server/appointments/active-visit", () => ({
  AnotherVisitInProgressError: class AnotherVisitInProgressError extends Error {},
  orActiveVisitConflict: <T,>(run: Promise<T>) => run,
  runStartVisitTx: vi.fn(),
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
  refreshPatientVisitStats: vi.fn(async () => undefined),
}));
vi.mock("@/server/patient/segments", () => ({
  refreshPatientSegment: vi.fn(async () => undefined),
}));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    appointment: {
      findUnique: vi.fn(async () => state.apt),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.updateThrows) throw state.updateThrows;
        state.updates.push(data);
        state.apt = { ...state.apt, ...data };
        return state.apt;
      }),
    },
    auditLog: { findFirst: vi.fn(async () => state.cancelAudit) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

const SLOT = new Date("2026-10-05T06:00:00.000Z");

beforeEach(() => {
  state.apt = {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    cabinetId: "cab_1",
    date: SLOT,
    endDate: new Date(SLOT.getTime() + 30 * 60_000),
    durationMin: 30,
    time: "11:00",
    status: "CANCELLED",
    queueStatus: "CANCELLED",
    channel: "PHONE",
    confirmedAt: null,
    calledAt: new Date("2026-10-05T05:55:00.000Z"),
    queuedAt: new Date("2026-10-05T05:50:00.000Z"),
    startedAt: null,
    completedAt: null,
    cancelledAt: new Date("2026-10-04T10:00:00.000Z"),
    medicalCaseId: null,
    doctor: { userId: "u_doc_1" },
  };
  state.updates = [];
  state.cancelAudit = { surface: "CRM", actorRole: null };
  state.conflict = { ok: true };
  state.updateThrows = null;
  spies.detectConflicts.mockImplementation(async () => state.conflict);
});

async function revert(from: string, to = "BOOKED") {
  state.apt = { ...state.apt, status: from, queueStatus: from };
  const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");
  return PATCH(
    new Request("https://x/api/crm/appointments/apt_1?revert=true", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: to }),
    }),
  );
}

async function reason(res: Response): Promise<string> {
  return ((await res.json()) as { reason?: string }).reason ?? "";
}

describe("AP-11: a taken slot is a busy doctor, not a 500", () => {
  it.each(["CANCELLED", "NO_SHOW"])("%s → 409 doctor_busy when someone holds the slot", async (from) => {
    state.conflict = { ok: false, reason: "doctor_busy", until: "11:30" };
    const res = await revert(from);
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("doctor_busy");
    expect(state.updates).toHaveLength(0);
    expect(spies.fireTrigger).not.toHaveBeenCalled();
    // The revert keeps its time: checked as a slot that does not move.
    expect(spies.detectConflicts).toHaveBeenCalledWith(
      expect.objectContaining({
        doctorId: "doc_1",
        cabinetId: "cab_1",
        startAt: SLOT,
        excludeId: "apt_1",
        currentStartAt: SLOT,
      }),
    );
  });

  it("the cabinet taken by another booking: 409 cabinet_busy", async () => {
    state.conflict = { ok: false, reason: "cabinet_busy" };
    const res = await revert("CANCELLED");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("cabinet_busy");
  });

  it("the overlap constraint has the last word: still 409 doctor_busy", async () => {
    state.updateThrows = Object.assign(new Error("exclusion constraint"), {
      code: "23P01",
    });
    const res = await revert("CANCELLED");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("doctor_busy");
    expect(spies.fireTrigger).not.toHaveBeenCalled();
  });

  it("hours outside the schedule do not block bringing a booked visit back", async () => {
    state.conflict = { ok: false, reason: "outside_schedule" };
    const res = await revert("CANCELLED");
    expect(res.status).toBe(200);
  });

  it("a walk-in holds no slot: nothing to check", async () => {
    state.apt = { ...state.apt, channel: "WALKIN" };
    const res = await revert("NO_SHOW");
    expect(res.status).toBe(200);
    expect(spies.detectConflicts).not.toHaveBeenCalled();
  });
});

describe("AP-11: the patient's own cancellation stays his", () => {
  it("a Mini App self-cancel is not revived: 409 cancelled_by_patient", async () => {
    state.cancelAudit = { surface: "MINIAPP", actorRole: "PATIENT" };
    const res = await revert("CANCELLED");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("cancelled_by_patient");
    expect(state.updates).toHaveLength(0);
  });
});

describe("AP-11: a revived visit comes back whole", () => {
  it("as a booking out of the live queue, and the patient is told", async () => {
    const res = await revert("CANCELLED");
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      status: "BOOKED",
      queueStatus: "BOOKED",
      calledAt: null,
      queuedAt: null,
      cancelledAt: null,
      cancelReason: null,
    });
    expect(spies.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.restored",
      appointmentId: "apt_1",
    });
  });

  it("confirmed if the patient had confirmed it", async () => {
    state.apt = { ...state.apt, confirmedAt: new Date("2026-10-02T09:00:00.000Z") };
    const res = await revert("NO_SHOW");
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      status: "CONFIRMED",
      queueStatus: "CONFIRMED",
    });
  });

  it("SKIPPED → WAITING is not a revival: no slot check, no notice", async () => {
    const res = await revert("SKIPPED", "WAITING");
    expect(res.status).toBe(200);
    expect(spies.detectConflicts).not.toHaveBeenCalled();
    expect(spies.fireTrigger).not.toHaveBeenCalled();
    expect(state.updates[0]).toEqual({ status: "WAITING", queueStatus: "WAITING" });
  });
});
