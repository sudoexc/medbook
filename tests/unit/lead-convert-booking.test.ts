/**
 * Audit LD-01 / TZ §7.2 — converting a site request: reception books the
 * person from the «Заявки» screen and the booking passes `leadId`.
 *
 * bookAppointment must, in the booking transaction: claim the lead only if
 * it belongs to this clinic and has no visit yet, mark it CONVERTED with the
 * patient, link the appointment to it and emit `lead.updated`. A foreign or
 * already-converted lead is not linked, and the booking still succeeds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Envelope = { type: string; payload: Record<string, unknown> };

const state = {
  createCalls: [] as Array<Record<string, unknown>>,
  leadFindFirst: [] as Array<Record<string, unknown>>,
  leadClaims: [] as Array<Record<string, unknown>>,
  outbox: [] as Envelope[],
  leadExists: true,
  claimCount: 1,
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_desk", role: "RECEPTIONIST", clinicId: "c1", email: "r@x.t" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_desk",
    role: "RECEPTIONIST" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/server/services/appointments", () => ({
  applyTime: (date: Date, time: string | null | undefined) => {
    if (!time) return date;
    const [h, m] = time.split(":").map((v) => Number.parseInt(v, 10));
    const out = new Date(date);
    out.setUTCHours(h ?? 0, m ?? 0, 0, 0);
    return out;
  },
  computeEndDate: (start: Date, durationMin: number) =>
    new Date(start.getTime() + durationMin * 60_000),
  detectConflicts: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

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
    lead: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        state.leadFindFirst.push(args);
        return state.leadExists ? { id: "lead_1" } : null;
      }),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        state.leadClaims.push(args);
        return { count: state.claimCount };
      }),
    },
    appointment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.createCalls.push(data);
        return {
          id: "appt_1",
          clinicId: data.clinicId,
          doctorId: data.doctorId,
          patientId: data.patientId,
          cabinetId: data.cabinetId,
          status: data.status,
          queueStatus: data.queueStatus,
          date: data.date,
          endDate: data.endDate,
          time: data.time,
          durationMin: data.durationMin,
          priceBase: data.priceBase,
          priceService: data.priceService,
          priceFinal: data.priceFinal,
          discountPct: data.discountPct,
          discountAmount: data.discountAmount,
        };
      }),
    },
    appointmentService: { createMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: { create: vi.fn(async () => ({ id: "a" })) },
    action: { updateMany: vi.fn(async () => ({ count: 0 })) },
    eventOutbox: {
      create: vi.fn(async ({ data }: { data: { envelope: Envelope } }) => {
        state.outbox.push(data.envelope);
        return { id: "ob" };
      }),
    },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const { prisma } = await import("@/lib/prisma");
      return fn(prisma);
    }),
  },
}));

async function book(extra: Record<string, unknown>) {
  vi.resetModules();
  const { POST } = await import("@/app/api/crm/appointments/route");
  return POST(
    new Request("https://x/api/crm/appointments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patientId: "p1",
        doctorId: "doc_1",
        date: "2026-10-01T00:00:00.000Z",
        time: "10:00",
        durationMin: 20,
        channel: "WEBSITE",
        ...extra,
      }),
    }),
  );
}

beforeEach(() => {
  state.createCalls = [];
  state.leadFindFirst = [];
  state.leadClaims = [];
  state.outbox = [];
  state.leadExists = true;
  state.claimCount = 1;
});

describe("booking a site request converts the lead", () => {
  it("claims the lead (CONVERTED + patient), links it and emits lead.updated", async () => {
    const res = await book({ leadId: "lead_1" });
    expect(res.status).toBe(201);

    // Clinic-scoped lookup: a lead id from another clinic never resolves.
    expect(state.leadFindFirst[0]).toMatchObject({
      where: { id: "lead_1", clinicId: "c1" },
    });
    expect(state.leadClaims).toHaveLength(1);
    expect(state.leadClaims[0]).toMatchObject({
      where: { id: "lead_1", clinicId: "c1", appointment: { is: null } },
      data: { status: "CONVERTED", patientId: "p1" },
    });
    expect(state.createCalls[0].leadId).toBe("lead_1");

    const leadEvents = state.outbox.filter((e) => e.type === "lead.updated");
    expect(leadEvents).toHaveLength(1);
    expect(leadEvents[0].payload).toMatchObject({
      leadId: "lead_1",
      status: "CONVERTED",
    });
  });

  it("does not link a lead from another clinic, but still books", async () => {
    state.leadExists = false;
    const res = await book({ leadId: "lead_foreign" });
    expect(res.status).toBe(201);
    expect(state.leadClaims).toHaveLength(0);
    expect(state.createCalls[0].leadId).toBeNull();
    expect(state.outbox.some((e) => e.type === "lead.updated")).toBe(false);
  });

  it("does not link a lead that already has its visit", async () => {
    state.claimCount = 0;
    const res = await book({ leadId: "lead_1" });
    expect(res.status).toBe(201);
    expect(state.createCalls[0].leadId).toBeNull();
    expect(state.outbox.some((e) => e.type === "lead.updated")).toBe(false);
  });

  it("an ordinary booking never touches Lead", async () => {
    const res = await book({});
    expect(res.status).toBe(201);
    expect(state.leadFindFirst).toHaveLength(0);
    expect(state.leadClaims).toHaveLength(0);
  });
});
