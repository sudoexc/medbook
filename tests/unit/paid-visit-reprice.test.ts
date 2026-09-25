/**
 * A paid visit keeps its price against repricing nobody asked for, but an
 * explicit change to its own services is billed (review of cf2b6b4, AN-02).
 *
 * Since AN-02 the payment dialog files the consult payment under today's
 * visit, often before the consult. When staff then add an EEG through
 * PATCH /api/crm/appointments/[id] `services`, the pricing engine used to
 * answer "paid_locked": the EEG line sat in the visit, the price stayed at
 * the consult, the visit read as settled and nothing ever asked for the
 * rest. The engine now reprices on an explicit services edit and keeps the
 * lock for every implicit reprice (a moved date, a case cascade).
 *
 * The route test runs the real PATCH handler with the real pricing engine
 * over an in-memory visit, so the whole path (swap the lines, reprice, what
 * the payment dialog and «Неоплаченные» then see) is pinned end to end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- in-memory clinic ------------------------------------------------------

type Line = { serviceId: string; priceSnap: number; quantity: number };
type Pay = { id: string; amount: number; status: string };
type Visit = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  cabinetId: string | null;
  serviceId: string | null;
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
  medicalCaseId: string | null;
  priceService: number | null;
  priceBase: number | null;
  priceFinal: number | null;
  discountPct: number;
  discountAmount: number;
};

const CONSULT = 200_000_00;
const EEG = 300_000_00;

const state = {
  visit: null as Visit | null,
  lines: [] as Line[],
  payments: [] as Pay[],
  catalog: new Map<string, number>(),
};

function paidConsultVisit(overrides: Partial<Visit> = {}): Visit {
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
    ...overrides,
  };
}

/** What the pricing engine's findUnique select reads, built from state. */
function pricingView(v: Visit) {
  const svc = (id: string) => ({
    id,
    priceBase: state.catalog.get(id) ?? 0,
    freeRepeatDays: null,
  });
  return {
    ...v,
    doctor: { userId: "u_doc_1" },
    payments: state.payments
      .filter((p) => p.status === "PAID")
      .map((p) => ({ id: p.id })),
    services: state.lines.map((l) => ({ ...l, service: svc(l.serviceId) })),
    primaryService: v.serviceId ? svc(v.serviceId) : null,
  };
}

// ----- module mocks ----------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_rec", role: "RECEPTIONIST", clinicId: "c1", email: "r@x.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_rec",
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
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/lib/appointment-transitions", () => ({
  canTransitionAt: () => ({ ok: true }),
}));

vi.mock("@/lib/prisma", () => {
  const byId = (id: string) => {
    if (!state.visit || state.visit.id !== id) return null;
    return pricingView(state.visit);
  };
  const prisma = {
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        byId(where.id),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const v = byId(where.id);
        if (!v) throw new Error("not found");
        return v;
      }),
      findMany: vi.fn(async () => (state.visit ? [state.visit] : [])),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<Visit> }) => {
          if (!state.visit || state.visit.id !== where.id) throw new Error("not found");
          state.visit = { ...state.visit, ...data };
          return pricingView(state.visit);
        },
      ),
    },
    appointmentService: {
      deleteMany: vi.fn(async () => {
        const count = state.lines.length;
        state.lines = [];
        return { count };
      }),
      createMany: vi.fn(async ({ data }: { data: Line[] }) => {
        state.lines.push(
          ...data.map((d) => ({
            serviceId: d.serviceId,
            priceSnap: d.priceSnap,
            quantity: d.quantity,
          })),
        );
        return { count: data.length };
      }),
    },
    service: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => state.catalog.has(id))
          .map((id) => ({ id, priceBase: state.catalog.get(id)! })),
      ),
    },
    doctor: {
      findUnique: vi.fn(async () => ({ cabinetId: "cab_1", isActive: true })),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    eventOutbox: { create: vi.fn(async () => ({ id: "outbox" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

async function loadPatch() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/appointments/[id]/route");
  return mod.PATCH;
}

function patchReq(body: unknown): Request {
  return new Request("https://x/api/crm/appointments/apt_1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The visit as the payment dialog and «Неоплаченные» read it. */
function asPaymentVisit() {
  return {
    id: state.visit!.id,
    date: state.visit!.date,
    status: state.visit!.status,
    priceFinal: state.visit!.priceFinal,
    payments: state.payments.map((p) => ({ amount: p.amount, status: p.status })),
  };
}

beforeEach(() => {
  state.catalog = new Map([
    ["s_consult", CONSULT],
    ["s_eeg", EEG],
  ]);
  state.visit = paidConsultVisit();
  state.lines = [{ serviceId: "s_consult", priceSnap: CONSULT, quantity: 1 }];
  // The patient paid for the consult at the desk, filed under the visit.
  state.payments = [{ id: "pay_1", amount: CONSULT, status: "PAID" }];
});

// ----- the route, end to end -------------------------------------------------

describe("PATCH /api/crm/appointments/[id] on a paid visit", () => {
  it("an EEG added after the consult was paid is billed: the rest shows as owed", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({ services: [{ serviceId: "s_consult" }, { serviceId: "s_eeg" }] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { priceFinal: number };
    expect(body.priceFinal).toBe(CONSULT + EEG);
    expect(state.visit!.priceFinal).toBe(CONSULT + EEG);

    // The visit is open again: the dialog preselects it and prefills the EEG.
    const { outstandingTiyin, isSettled, defaultPaymentVisitId } = await import(
      "@/lib/payments/visit-choice"
    );
    expect(outstandingTiyin(asPaymentVisit())).toBe(EEG);
    expect(isSettled(asPaymentVisit())).toBe(false);
    expect(
      defaultPaymentVisitId([asPaymentVisit()], new Date("2026-09-25T07:00:00Z")),
    ).toBe("apt_1");
  });

  it("a partial prepayment does not hide an added service either", async () => {
    state.payments = [{ id: "pay_1", amount: 100_000_00, status: "PAID" }];
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({ services: [{ serviceId: "s_consult" }, { serviceId: "s_eeg" }] }),
    );
    expect(res.status).toBe(200);
    const { outstandingTiyin } = await import("@/lib/payments/visit-choice");
    expect(outstandingTiyin(asPaymentVisit())).toBe(CONSULT + EEG - 100_000_00);
  });

  it("the visit's discount applies to the added service too", async () => {
    state.visit = paidConsultVisit({ discountPct: 10, priceFinal: 180_000_00 });
    state.payments = [{ id: "pay_1", amount: 180_000_00, status: "PAID" }];
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({ services: [{ serviceId: "s_consult" }, { serviceId: "s_eeg" }] }),
    );
    expect(res.status).toBe(200);
    expect(state.visit!.priceFinal).toBe(450_000_00);
  });

  it("moving a paid visit keeps its price even when the catalog price changed since", async () => {
    // A legacy row priced from the primary service only: a reprice would
    // read today's catalog price, which is exactly what the lock prevents.
    state.lines = [];
    state.catalog.set("s_consult", 250_000_00);
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ time: "11:30" }));
    expect(res.status).toBe(200);
    expect(state.visit!.priceFinal).toBe(CONSULT);
    const { isSettled } = await import("@/lib/payments/visit-choice");
    expect(isSettled(asPaymentVisit())).toBe(true);
  });
});

// ----- the engine ------------------------------------------------------------

describe("recomputeAppointmentPrice paid lock", () => {
  function engineClient() {
    const update = vi.fn(async () => ({}));
    return {
      update,
      client: {
        appointment: {
          findUnique: vi.fn(async () => pricingView(state.visit!)),
          findMany: vi.fn(async () => [{ id: state.visit!.id, date: state.visit!.date }]),
          update,
        },
      },
    };
  }

  it("an implicit reprice of a paid visit is refused, an explicit services edit is not", async () => {
    state.lines.push({ serviceId: "s_eeg", priceSnap: EEG, quantity: 1 });
    const { recomputeAppointmentPrice } = await import(
      "@/server/pricing/recompute-appointment-price"
    );

    const locked = engineClient();
    const r1 = await recomputeAppointmentPrice(locked.client as never, "apt_1");
    expect(r1.reason).toBe("paid_locked");
    expect(r1.priceFinal).toBe(CONSULT);
    expect(locked.update).not.toHaveBeenCalled();

    const edited = engineClient();
    const r2 = await recomputeAppointmentPrice(edited.client as never, "apt_1", {
      servicesEdited: true,
    });
    expect(r2.reason).toBe("normal");
    expect(r2.priceFinal).toBe(CONSULT + EEG);
    expect(edited.update).toHaveBeenCalledWith({
      where: { id: "apt_1" },
      data: { priceService: CONSULT + EEG, priceBase: CONSULT + EEG, priceFinal: CONSULT + EEG },
    });
  });

  it("a case cascade never unlocks a paid sibling", async () => {
    state.visit = paidConsultVisit({ medicalCaseId: "case_1" });
    state.lines.push({ serviceId: "s_eeg", priceSnap: EEG, quantity: 1 });
    const { recomputeCaseAppointments } = await import(
      "@/server/pricing/recompute-appointment-price"
    );
    const { client, update } = engineClient();
    const [r] = await recomputeCaseAppointments(client as never, "case_1");
    expect(r.reason).toBe("paid_locked");
    expect(update).not.toHaveBeenCalled();
  });
});
