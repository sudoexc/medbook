/**
 * Reception calling a patient must reach the patient — regression cover for
 * the asymmetry where only the doctor cabinet notified them.
 *
 * Two halves:
 *   1. `PATCH /api/crm/appointments/[id]/queue-status` stamps `patientId` on
 *      its v1 payloads (otherwise the mini-app SSE filter drops them) and
 *      fires the "Вас вызывают" Telegram push on the →IN_PROGRESS flip.
 *   2. The published payloads, run through the real mini-app filter, reach the
 *      called patient and nobody else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { shouldDeliverV1ToMiniApp } from "@/app/api/miniapp/events/route";

// ----- shared state --------------------------------------------------------

type Appt = {
  id: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  status: string;
  queueStatus: string;
  date: Date;
  endDate: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  queueOrder: number | null;
  ticketSeq: number | null;
};

const state = {
  appt: null as Appt | null,
  publishes: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  audits: [] as Array<{ action: string; meta: Record<string, unknown> }>,
  notices: [] as Array<Record<string, unknown>>,
  /** Flip to make the Telegram send report failure. */
  noticeResult: true,
  /** Patient join data returned by the mocked `update({ include })`. */
  telegramId: "tg_owner" as string | null,
  cabinetNumber: "12" as string | null,
};

// ----- mocks ---------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_recept", role: "RECEPTIONIST", clinicId: "c1", email: "r@x.t" },
  })),
}));

vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_recept",
    role: "RECEPTIONIST" as const,
  }),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(
    async (
      _req: Request,
      input: { action: string; meta?: Record<string, unknown> },
    ) => {
      state.audits.push({ action: input.action, meta: input.meta ?? {} });
    },
  ),
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(
    (_clinicId: string, ev: { type: string; payload: Record<string, unknown> }) => {
      state.publishes.push(ev);
    },
  ),
}));

vi.mock("@/server/telegram/call-notice", () => ({
  sendCallNotice: vi.fn(async (input: Record<string, unknown>) => {
    state.notices.push(input);
    return state.noticeResult;
  }),
}));

vi.mock("@/server/appointments/confirm", () => ({
  confirmAppointment: vi.fn(),
}));

vi.mock("@/server/appointments/active-visit", () => ({
  findOtherActiveVisit: vi.fn(async () => null),
}));

vi.mock("@/lib/prisma", () => {
  const appointment = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      state.appt && state.appt.id === where.id ? state.appt : null,
    ),
    update: vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        if (!state.appt) throw new Error("no row");
        state.appt = { ...state.appt, ...(data as Partial<Appt>) };
        // Mirror the route's `include` — the joined blobs it reads for the
        // board signal and the push.
        return {
          ...state.appt,
          patient: {
            fullName: "Иванов Иван Иванович",
            telegramId: state.telegramId,
            preferredLang: "RU",
          },
          doctor: {
            nameRu: "Петрова А. С.",
            cabinet: state.cabinetNumber ? { number: state.cabinetNumber } : null,
          },
          clinic: {
            id: "c1",
            slug: "neurofax",
            tgBotToken: "tok",
            tgBotUsername: "bot",
          },
        };
      },
    ),
    aggregate: vi.fn(async () => ({ _max: { queueOrder: 0 } })),
  };
  return {
    prisma: {
      appointment,
      auditLog: { create: vi.fn(async () => ({ id: "a1" })) },
      $transaction: vi.fn(
        async (fn: (tx: { appointment: typeof appointment }) => Promise<unknown>) =>
          fn({ appointment }),
      ),
    },
  };
});

// ----- helpers -------------------------------------------------------------

async function loadPATCH() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/appointments/[id]/queue-status/route");
  return mod.PATCH as (req: Request) => Promise<Response>;
}

function patchReq(id: string, body: unknown): Request {
  return new Request(`https://x/api/crm/appointments/${id}/queue-status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeAppt(overrides: Partial<Appt> = {}): Appt {
  const start = new Date("2026-06-01T10:00:00.000Z");
  return {
    id: "appt_1",
    clinicId: "c1",
    doctorId: "doc_1",
    patientId: "p_owner",
    status: "WAITING",
    queueStatus: "WAITING",
    date: start,
    endDate: new Date(start.getTime() + 30 * 60_000),
    startedAt: null,
    completedAt: null,
    queueOrder: 3,
    ticketSeq: 3,
    ...overrides,
  };
}

function published(type: string) {
  return state.publishes.filter((p) => p.type === type);
}

beforeEach(() => {
  state.appt = makeAppt();
  state.publishes = [];
  state.audits = [];
  state.notices = [];
  state.noticeResult = true;
  state.telegramId = "tg_owner";
  state.cabinetNumber = "12";
});

// ----- 1. patientId on the v1 payloads -------------------------------------

describe("queue-status v1 events carry patientId", () => {
  it("QN1 — queue.updated names the patient whose status changed", async () => {
    const PATCH = await loadPATCH();
    const res = await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));
    expect(res.status).toBe(200);

    const [ev] = published("queue.updated");
    expect(ev).toBeDefined();
    expect(ev.payload.patientId).toBe("p_owner");
    expect(ev.payload.appointmentId).toBe("appt_1");
  });

  it("QN2 — appointment.statusChanged names the patient too", async () => {
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    const [ev] = published("appointment.statusChanged");
    expect(ev.payload.patientId).toBe("p_owner");
  });

  it("QN3 — appointment.updated (slot shrink on COMPLETED) names the patient", async () => {
    // The shrink branch (the only emitter of appointment.updated here) needs
    // the visit to end EARLY, i.e. `now` before the booked endDate — so the
    // fixture has to start now and run long, not sit in a fixed past date.
    const start = new Date(Date.now() - 60_000);
    state.appt = makeAppt({
      queueStatus: "IN_PROGRESS",
      status: "IN_PROGRESS",
      date: start,
      endDate: new Date(start.getTime() + 6 * 60 * 60_000),
    });
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "COMPLETED" }));

    const [ev] = published("appointment.updated");
    expect(ev).toBeDefined();
    expect(ev.payload.patientId).toBe("p_owner");
  });

  it("QN4 — every v1 payload passes the real mini-app filter for that patient", async () => {
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    const allowed = { clinicId: "c1", patientIds: new Set(["p_owner"]) };
    const deliverable = state.publishes
      .map((ev) => ({ ...ev, clinicId: "c1", at: "2026-06-01T10:00:00.000Z" }))
      .filter((ev) => shouldDeliverV1ToMiniApp(ev, allowed))
      .map((ev) => ev.type);

    expect(deliverable).toContain("queue.updated");
    expect(deliverable).toContain("appointment.statusChanged");
  });

  it("QN5 — queue.called stays PHI-reduced: no patientId, initials only", async () => {
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    const [ev] = published("queue.called");
    expect(ev).toBeDefined();
    // Public waiting-room TV signal — must not name the patient.
    expect(ev.payload.patientId).toBeUndefined();
    expect(ev.payload.patientName).not.toContain("Иванович");
  });
});

// ----- 2. the push ---------------------------------------------------------

describe("reception call sends the patient a Telegram push", () => {
  it("QN6 — →IN_PROGRESS fires sendCallNotice with cabinet + doctor + lang", async () => {
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    expect(state.notices).toHaveLength(1);
    expect(state.notices[0]).toMatchObject({
      telegramId: "tg_owner",
      cabinetNumber: "12",
      doctorName: "Петрова А. С.",
      lang: "RU",
    });
  });

  it("QN7 — the call is audited with notificationSent", async () => {
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    const called = state.audits.find((a) => a.action === "APPOINTMENT_CALLED");
    expect(called).toBeDefined();
    expect(called?.meta.notificationSent).toBe(true);
  });

  it("QN8 — a failed push does not fail the request", async () => {
    state.noticeResult = false;
    const PATCH = await loadPATCH();
    const res = await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    expect(res.status).toBe(200);
    const called = state.audits.find((a) => a.action === "APPOINTMENT_CALLED");
    expect(called?.meta.notificationSent).toBe(false);
  });

  it("QN9 — non-call transitions send nothing (WAITING, COMPLETED)", async () => {
    state.appt = makeAppt({ queueStatus: "BOOKED", status: "BOOKED" });
    let PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "WAITING" }));
    expect(state.notices).toHaveLength(0);

    state.appt = makeAppt({ queueStatus: "IN_PROGRESS", status: "IN_PROGRESS" });
    PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "COMPLETED" }));
    expect(state.notices).toHaveLength(0);
  });

  it("QN10 — re-issuing IN_PROGRESS on an already-started visit doesn't re-push", async () => {
    // Guards against a double-click at the desk buzzing the patient twice.
    state.appt = makeAppt({ queueStatus: "IN_PROGRESS", status: "IN_PROGRESS" });
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));
    expect(state.notices).toHaveLength(0);
  });

  it("QN11 — the response never leaks the clinic bot token", async () => {
    const PATCH = await loadPATCH();
    const res = await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.clinic).toBeUndefined();
    expect(body.patient).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("tgBotToken");
  });
});

// ----- 3. no cross-patient leak --------------------------------------------

describe("an event about patient A never reaches patient B", () => {
  it("QN12 — B's stream drops every payload from A's call", async () => {
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    const bScope = { clinicId: "c1", patientIds: new Set(["p_other"]) };
    for (const ev of state.publishes) {
      const v1 = { ...ev, clinicId: "c1", at: "2026-06-01T10:00:00.000Z" };
      expect(
        shouldDeliverV1ToMiniApp(v1, bScope),
        `${ev.type} leaked to a stranger`,
      ).toBe(false);
    }
  });

  it("QN13 — the patientId is the row's own, not the acting user's", async () => {
    state.appt = makeAppt({ patientId: "p_someone_else" });
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    for (const ev of published("queue.updated")) {
      expect(ev.payload.patientId).toBe("p_someone_else");
    }
  });

  it("QN14 — a matching patientId in another clinic is still dropped", async () => {
    const PATCH = await loadPATCH();
    await PATCH(patchReq("appt_1", { queueStatus: "IN_PROGRESS" }));

    const otherClinic = { clinicId: "c2", patientIds: new Set(["p_owner"]) };
    for (const ev of state.publishes) {
      const v1 = { ...ev, clinicId: "c1", at: "2026-06-01T10:00:00.000Z" };
      expect(shouldDeliverV1ToMiniApp(v1, otherClinic)).toBe(false);
    }
  });
});
