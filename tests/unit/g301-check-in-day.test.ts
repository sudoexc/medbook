/**
 * Review of audit G3-01 — a Mini App «Я на месте» belongs to the day it was
 * made, through the real PATCH /api/crm/appointments/[id], the real bulk
 * reschedule and the real check-in route, over an in-memory appointment.
 *
 * The patient tapped on 01.10 at 09:10 and nobody met him; reception moved
 * the visit to 08.10 (the Mini App refuses to move a checked-in visit, so
 * the CRM is the only way). No path cleared `arrivedAt`, so on 08.10 every
 * reception list said «Отметился в приложении в 09:10», the sweep never
 * marked the real no-show, and his real tap on 08.10 answered «already» with
 * no alert at the desk.
 *
 * Pinned:
 *   - a staff move to another clinic day drops the stamp; a move within the
 *     day keeps it (the patient is still in the building);
 *   - the check-in route counts only a stamp from the visit's own day: a
 *     stale one is re-claimed and the desk is told, a same-day one is still
 *     an idempotent repeat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Appointment = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  cabinetId: string | null;
  date: Date;
  endDate: Date;
  durationMin: number;
  time: string | null;
  status: string;
  queueStatus: string;
  channel: string;
  cancelledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelReason: string | null;
  medicalCaseId: string | null;
  priceBase: number | null;
  priceFinal: number | null;
  discountPct: number;
  discountAmount: number;
  queuePriority: number;
  arrivedAt: Date | null;
  doctor: { userId: string };
  patient: { fullName: string };
};

// «Now» is Thu 01.10.2026 11:00 in Tashkent.
const NOW = new Date("2026-10-01T06:00:00.000Z");
// His tap at 09:10 today.
const TAP_TODAY = new Date("2026-10-01T04:10:00.000Z");
// Today 14:00, the visit he tapped for.
const TODAY_14 = new Date("2026-10-01T09:00:00.000Z");

const state = {
  apt: null as Appointment | null,
  updates: [] as Array<Record<string, unknown>>,
  claims: [] as Array<Record<string, unknown>>,
};

const h = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));

function makeAppointment(over: Partial<Appointment> = {}): Appointment {
  const start = over.date ?? TODAY_14;
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    cabinetId: "cab_1",
    date: start,
    endDate: new Date(start.getTime() + 30 * 60_000),
    durationMin: 30,
    time: "14:00",
    status: "BOOKED",
    queueStatus: "BOOKED",
    channel: "PHONE",
    cancelledAt: null,
    startedAt: null,
    completedAt: null,
    cancelReason: null,
    medicalCaseId: null,
    priceBase: 100_000,
    priceFinal: 100_000,
    discountPct: 0,
    discountAmount: 0,
    queuePriority: 0,
    arrivedAt: TAP_TODAY,
    doctor: { userId: "u_doc_1" },
    patient: { fullName: "Рахимов Бекзод" },
    ...over,
  };
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_admin", role: "ADMIN", clinicId: "c1", email: "a@x.t" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_admin",
    role: "ADMIN" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: h.fireTrigger,
}));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_1",
  publishViaOutbox: h.publishViaOutbox,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
// The Mini App side: an authenticated patient acting for himself.
vi.mock("@/server/miniapp/handler", () => ({
  createMiniAppHandler:
    (_opts: unknown, fn: (args: unknown) => Promise<Response>) =>
    (request: Request) =>
      fn({
        request,
        ctx: { clinicId: "c1", patientId: "p1", patient: { preferredLang: "RU" } },
      }),
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
  })),
}));

const sameStamp = (a: unknown, b: Date | null) =>
  a === null ? b === null : a instanceof Date && b !== null && a.getTime() === b.getTime();

vi.mock("@/lib/prisma", () => {
  const prisma = {
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.apt && state.apt.id === where.id ? state.apt : null,
      ),
      findUniqueOrThrow: vi.fn(async () => state.apt),
      findMany: vi.fn(async () => (state.apt ? [state.apt] : [])),
      // The check-in route loads the visit by id; every other lookup is a
      // clash search, and the doctor's grid is otherwise empty.
      findFirst: vi.fn(async ({ where }: { where: { id?: unknown; clinicId?: string } }) =>
        typeof where.id === "string" && where.clinicId && state.apt?.id === where.id
          ? state.apt
          : null,
      ),
      update: vi.fn(
        async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => {
          state.updates.push(data);
          state.apt = { ...state.apt!, ...(data as Partial<Appointment>) };
          return state.apt;
        },
      ),
      // The check-in's atomic claim: lands only on the stamp it read.
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; arrivedAt: Date | null };
          data: Record<string, unknown>;
        }) => {
          state.claims.push({ where, data });
          if (!state.apt || state.apt.id !== where.id) return { count: 0 };
          if (!sameStamp(where.arrivedAt, state.apt.arrivedAt)) return { count: 0 };
          state.apt = { ...state.apt, ...(data as Partial<Appointment>) };
          return { count: 1 };
        },
      ),
    },
    appointmentService: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    service: { findMany: vi.fn(async () => []) },
    doctor: {
      findUnique: vi.fn(async () => ({ cabinetId: "cab_1", isActive: true })),
    },
    doctorSchedule: { findMany: vi.fn(async () => []) },
    doctorTimeOff: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => ({ id: "al" })) },
    eventOutbox: { create: vi.fn(async () => ({ id: "ob" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

async function patch(body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");
  return PATCH(
    new Request("https://x/api/crm/appointments/apt_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function bulkShift(deltaMinutes: number): Promise<Response> {
  const { POST } = await import("@/app/api/crm/appointments/bulk-reschedule/route");
  return POST(
    new Request("https://x/api/crm/appointments/bulk-reschedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["apt_1"], deltaMinutes }),
    }),
  );
}

async function checkIn(): Promise<Response> {
  const { POST } = await import("@/app/api/miniapp/appointments/[id]/checkin/route");
  return POST(
    new Request("https://x/api/miniapp/appointments/apt_1/checkin", { method: "POST" }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.apt = makeAppointment();
  state.updates = [];
  state.claims = [];
  h.fireTrigger.mockClear();
  h.publishViaOutbox.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("G3-01 review: a staff move off the day drops the check-in", () => {
  it("PATCH to 08.10 clears arrivedAt", async () => {
    const res = await patch({ date: "2026-10-08", time: "14:00" });
    expect(res.status).toBe(200);
    expect(state.updates.at(-1)).toMatchObject({ arrivedAt: null });
    expect(state.apt!.arrivedAt).toBeNull();
  });

  it("PATCH to a later hour the same day keeps it: he is still in the building", async () => {
    const res = await patch({ time: "16:00" });
    expect(res.status).toBe(200);
    expect(state.updates.at(-1)).not.toHaveProperty("arrivedAt");
    expect(state.apt!.arrivedAt).toEqual(TAP_TODAY);
  });

  it("a PATCH that does not touch the slot keeps it", async () => {
    const res = await patch({ comments: "ждёт в холле" });
    expect(res.status).toBe(200);
    expect(state.apt!.arrivedAt).toEqual(TAP_TODAY);
  });

  it("a bulk shift across the clinic's midnight clears it, within the day keeps it", async () => {
    const nextDay = await bulkShift(24 * 60);
    expect(nextDay.status).toBe(200);
    expect(state.apt!.arrivedAt).toBeNull();

    state.apt = makeAppointment();
    const later = await bulkShift(60);
    expect(later.status).toBe(200);
    expect(state.apt!.arrivedAt).toEqual(TAP_TODAY);
  });
});

describe("G3-01 review: the Mini App tap counts a stamp from the visit's day only", () => {
  it("a stamp from the day the visit was moved off is re-claimed, and the desk is told", async () => {
    // Moved here before moves dropped the stamp: tapped 24.09, visit today.
    const stale = new Date("2026-09-24T04:10:00.000Z");
    state.apt = makeAppointment({ arrivedAt: stale });

    const res = await checkIn();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The claim is conditional on the stamp it read, not on null.
    expect(state.claims[0]).toMatchObject({ where: { id: "apt_1", arrivedAt: stale } });
    expect(state.apt!.arrivedAt).toEqual(NOW);
    expect(h.publishViaOutbox).toHaveBeenCalledTimes(1);
  });

  it("a repeat tap the same day is still a silent repeat", async () => {
    const res = await checkIn();

    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(state.claims).toEqual([]);
    expect(h.publishViaOutbox).not.toHaveBeenCalled();
  });

  it("a first tap claims from null as before", async () => {
    state.apt = makeAppointment({ arrivedAt: null });

    const res = await checkIn();

    expect(await res.json()).toEqual({ ok: true });
    expect(state.claims[0]).toMatchObject({ where: { id: "apt_1", arrivedAt: null } });
    expect(h.publishViaOutbox).toHaveBeenCalledTimes(1);
  });
});
