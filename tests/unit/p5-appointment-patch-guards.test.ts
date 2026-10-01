/**
 * Audit AP-03 — the generic appointment PATCH no longer rewrites what it
 * must not.
 *
 *   - `patientId` and `medicalCaseId` are refused (400): the visit's patient
 *     is fixed at booking, a case changes through attach/detach, which check
 *     the case is this patient's;
 *   - `queueStatus` only with the same `status` (400 otherwise): a bare one
 *     skipped the transition and role guards;
 *   - a hand-set price (final price, discount, a line's price) is reception's
 *     and the administrator's: 403 for a doctor, and an audit row for staff.
 *
 * The route runs for real over an in-memory visit (same harness as
 * paid-visit-reprice.test.ts, with the role switchable).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

type Visit = Record<string, unknown> & { id: string; priceFinal: number | null };

const CONSULT = 200_000_00;

const state = vi.hoisted(() => ({
  role: "RECEPTIONIST" as string,
  userId: "u_rec",
  visit: null as Visit | null,
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{ action: string; meta: unknown }>,
}));

function visit(): Visit {
  const start = new Date("2026-09-25T05:00:00.000Z");
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    cabinetId: "cab_1",
    serviceId: "s_consult",
    date: start,
    endDate: new Date(start.getTime() + 30 * 60_000),
    durationMin: 30,
    time: "10:00",
    status: "CONFIRMED",
    queueStatus: "CONFIRMED",
    channel: "PHONE",
    cancelledAt: null,
    startedAt: null,
    completedAt: null,
    medicalCaseId: null,
    priceService: CONSULT,
    priceBase: CONSULT,
    priceFinal: CONSULT,
    discountPct: 0,
    discountAmount: 0,
  };
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: state.userId, role: state.role, clinicId: "c1", email: "x@x.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT" as const, clinicId: "c1", userId: state.userId, role: state.role }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, e: { action: string; meta: unknown }) => {
    state.audits.push({ action: e.action, meta: e.meta });
  }),
}));
vi.mock("@/lib/appointment-transitions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appointment-transitions")>()),
  canTransitionAt: () => ({ ok: true }),
}));
vi.mock("@/lib/prisma", () => {
  const view = () =>
    state.visit
      ? {
          ...state.visit,
          doctor: { userId: "u_doc_1" },
          payments: [],
          services: [
            {
              serviceId: "s_consult",
              priceSnap: CONSULT,
              quantity: 1,
              service: { id: "s_consult", priceBase: CONSULT, freeRepeatDays: null },
            },
          ],
          primaryService: { id: "s_consult", priceBase: CONSULT, freeRepeatDays: null },
        }
      : null;
  const prisma = {
    appointment: {
      findUnique: vi.fn(async () => view()),
      findUniqueOrThrow: vi.fn(async () => view()),
      findMany: vi.fn(async () => (state.visit ? [state.visit] : [])),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        state.visit = { ...state.visit!, ...data } as Visit;
        return view();
      }),
    },
    appointmentService: { deleteMany: vi.fn(), createMany: vi.fn() },
    service: { findMany: vi.fn(async () => [{ id: "s_consult", priceBase: CONSULT }]) },
    serviceOnDoctor: { findMany: vi.fn(async () => []) },
    doctor: { findUnique: vi.fn(async () => ({ cabinetId: "cab_1", isActive: true })) },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    eventOutbox: { create: vi.fn(async () => ({ id: "outbox" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

import { UpdateAppointmentSchema } from "@/server/schemas/appointment";
import { canEditPrice, priceFieldsIn } from "@/lib/appointments/price-edit";

async function patch(body: unknown): Promise<Response> {
  vi.resetModules();
  const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");
  return PATCH(
    new Request("https://x/api/crm/appointments/apt_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.role = "RECEPTIONIST";
  state.userId = "u_rec";
  state.visit = visit();
  state.updates = [];
  state.audits = [];
});

describe("the schema", () => {
  it("refuses the patient and the case, naming why", () => {
    const p = UpdateAppointmentSchema.safeParse({ patientId: "p_other" });
    expect(p.success).toBe(false);
    expect(JSON.stringify(p.error)).toContain("patient_locked");
    const c = UpdateAppointmentSchema.safeParse({ medicalCaseId: "case_x" });
    expect(c.success).toBe(false);
    expect(JSON.stringify(c.error)).toContain("case_change_via_attach");
    // Even a null case (a detach) goes through the detach route.
    expect(UpdateAppointmentSchema.safeParse({ medicalCaseId: null }).success).toBe(false);
  });

  it("takes queueStatus only together with the same status", () => {
    expect(UpdateAppointmentSchema.safeParse({ queueStatus: "COMPLETED" }).success).toBe(false);
    expect(
      UpdateAppointmentSchema.safeParse({ status: "WAITING", queueStatus: "CONFIRMED" }).success,
    ).toBe(false);
    expect(
      UpdateAppointmentSchema.safeParse({ status: "WAITING", queueStatus: "WAITING" }).success,
    ).toBe(true);
    expect(UpdateAppointmentSchema.safeParse({ status: "COMPLETED" }).success).toBe(true);
  });

  it("everything the CRM screens send still passes", () => {
    for (const body of [
      { comments: "перезвонить" },
      { channel: "TELEGRAM" },
      { time: "11:30", date: "2026-09-26", riskOutcome: "RESCHEDULED" },
      { date: "2026-09-26T05:00:00.000Z", time: "10:00", doctorId: "doc_2" },
      { durationMin: 40 },
      { queuePriority: 1 },
      { services: [{ serviceId: "s_consult" }, { serviceId: "s_eeg" }] },
    ]) {
      expect(UpdateAppointmentSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });
});

describe("who may set a price", () => {
  it("names the override fields a body carries", () => {
    expect(priceFieldsIn({})).toEqual([]);
    expect(priceFieldsIn({ services: [{}] })).toEqual([]);
    expect(
      priceFieldsIn({ priceFinal: 0, discountPct: 10, discountAmount: 5, services: [{ priceOverride: 1 }] }),
    ).toEqual(["priceFinal", "discountPct", "discountAmount", "services.priceOverride"]);
    expect(priceFieldsIn({ priceFinal: null })).toEqual(["priceFinal"]);
  });

  it("reception and the administrator, nobody else", () => {
    expect(canEditPrice("ADMIN")).toBe(true);
    expect(canEditPrice("RECEPTIONIST")).toBe(true);
    for (const r of ["DOCTOR", "NURSE", "CALL_OPERATOR", null, undefined]) {
      expect(canEditPrice(r)).toBe(false);
    }
  });
});

describe("PATCH /api/crm/appointments/[id]", () => {
  it("{patientId}: 400, the visit stays with its patient", async () => {
    const res = await patch({ patientId: "p_other_clinic" });
    expect(res.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("{medicalCaseId}: 400, a case changes through attach/detach only", async () => {
    const res = await patch({ medicalCaseId: "case_of_someone_else" });
    expect(res.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("{queueStatus} without status: 400", async () => {
    const res = await patch({ queueStatus: "COMPLETED" });
    expect(res.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("a doctor's {priceFinal: 0} on his own visit: 403, the bill stays", async () => {
    state.role = "DOCTOR";
    state.userId = "u_doc_1";
    const res = await patch({ priceFinal: 0 });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      reason: "role_cannot_edit_price",
      fields: ["priceFinal"],
    });
    expect(state.updates).toEqual([]);
    expect(state.visit!.priceFinal).toBe(CONSULT);
  });

  it("a doctor's line price or discount: 403 too", async () => {
    state.role = "DOCTOR";
    state.userId = "u_doc_1";
    expect((await patch({ services: [{ serviceId: "s_consult", priceOverride: 0 }] })).status).toBe(403);
    expect((await patch({ discountPct: 100 })).status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("reception sets a discount: allowed, and recorded as a price override", async () => {
    const res = await patch({ discountPct: 10 });
    expect(res.status).toBe(200);
    const row = state.audits.find((a) => a.action === "appointment.price_override");
    expect(row).toBeDefined();
    expect(row!.meta).toMatchObject({
      fields: ["discountPct"],
      before: { priceFinal: CONSULT, discountPct: 0, discountAmount: 0 },
      after: { discountPct: 10 },
    });
  });

  it("a change that touches no price writes no override row", async () => {
    const res = await patch({ comments: "позвонить вечером" });
    expect(res.status).toBe(200);
    expect(state.audits.map((a) => a.action)).not.toContain("appointment.price_override");
  });

  it("the route no longer carries a PATCH case move", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/api/crm/appointments/[id]/route.ts"),
      "utf8",
    );
    expect(src).not.toContain("body.medicalCaseId");
    expect(src).not.toContain("body.patientId");
  });
});
