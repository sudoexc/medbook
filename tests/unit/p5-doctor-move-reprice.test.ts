/**
 * Review of DR-02 (commit 7160d4e1): a visit moved to another doctor takes
 * that doctor's price and length.
 *
 * Booking honours the doctor's own price and duration for a service, but the
 * PATCH only repriced lines when `services` was in the body. The calendar's
 * drag to another doctor's column sends only date, time and doctorId, and
 * the pricing engine then rebuilt the total from the leaving doctor's line
 * snapshots: the head doctor's 300 000 consult dragged to a colleague who
 * charges the catalog 200 000 stayed at 300 000, the reverse move underbilled,
 * and his 45-minute block kept its length.
 *
 * The route test runs the real PATCH handler with the real pricing engine
 * over an in-memory visit, like paid-visit-reprice.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  durationAfterDoctorChange,
  linePricesForDoctor,
  servicesDurationWith,
  type EffectiveServiceTerms,
} from "@/lib/doctor-service-terms";

// ----- in-memory clinic ------------------------------------------------------

type Line = { serviceId: string; priceSnap: number; quantity: number };
type Pay = { id: string; amount: number; status: string };
type Link = {
  doctorId: string;
  serviceId: string;
  priceOverride: number | null;
  durationMinOverride: number | null;
};
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

const CATALOG_CONSULT = 200_000_00;
const HEAD_CONSULT = 300_000_00;
const EEG = 150_000_00;

const h = vi.hoisted(() => ({
  state: {
    visit: null as Visit | null,
    lines: [] as Line[],
    payments: [] as Pay[],
    catalog: new Map<string, { priceBase: number; durationMin: number }>(),
    links: [] as Link[],
  },
  conflictCalls: [] as Array<{ doctorId: string; startAt: Date; endAt: Date }>,
}));
const state = h.state;

function visitAt(overrides: Partial<Visit> = {}): Visit {
  const start = new Date("2026-10-05T05:00:00.000Z");
  const durationMin = overrides.durationMin ?? 45;
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_head",
    cabinetId: "cab_head",
    serviceId: "s_consult",
    date: start,
    endDate: new Date(start.getTime() + durationMin * 60_000),
    durationMin,
    time: "10:00",
    status: "CONFIRMED",
    queueStatus: "CONFIRMED",
    channel: "PHONE",
    cancelledAt: null,
    startedAt: null,
    completedAt: null,
    medicalCaseId: null,
    priceService: HEAD_CONSULT,
    priceBase: HEAD_CONSULT,
    priceFinal: HEAD_CONSULT,
    discountPct: 0,
    discountAmount: 0,
    ...overrides,
  };
}

/** Every select the route and the pricing engine read, built from state. */
function view(v: Visit) {
  const svc = (id: string) => ({
    id,
    priceBase: state.catalog.get(id)?.priceBase ?? 0,
    freeRepeatDays: null,
  });
  return {
    ...v,
    doctor: { userId: `u_${v.doctorId}` },
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
    const [hh, mm] = time.split(":").map((x) => Number.parseInt(x, 10));
    const out = new Date(date);
    out.setUTCHours(hh ?? 0, mm ?? 0, 0, 0);
    return out;
  },
  computeEndDate: (start: Date, durationMin: number) =>
    new Date(start.getTime() + durationMin * 60_000),
  detectConflicts: vi.fn(
    async (a: { doctorId: string; startAt: Date; endAt: Date }) => {
      h.conflictCalls.push({ doctorId: a.doctorId, startAt: a.startAt, endAt: a.endAt });
      return { ok: true };
    },
  ),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/lib/appointment-transitions", async (importOriginal) => ({
  // The real reschedule rule (AP-10): a CONFIRMED visit may move.
  ...(await importOriginal<typeof import("@/lib/appointment-transitions")>()),
  canTransitionAt: () => ({ ok: true }),
}));

vi.mock("@/lib/prisma", () => {
  const byId = (id: string) => {
    if (!h.state.visit || h.state.visit.id !== id) return null;
    return view(h.state.visit);
  };
  const prisma = {
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => byId(where.id)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const v = byId(where.id);
        if (!v) throw new Error("not found");
        return v;
      }),
      findMany: vi.fn(async () => (h.state.visit ? [h.state.visit] : [])),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<Visit> }) => {
          if (!h.state.visit || h.state.visit.id !== where.id) throw new Error("not found");
          h.state.visit = { ...h.state.visit, ...data };
          return view(h.state.visit);
        },
      ),
    },
    appointmentService: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { appointmentId: string; serviceId: string };
          data: { priceSnap: number };
        }) => {
          let count = 0;
          h.state.lines = h.state.lines.map((l) => {
            if (l.serviceId !== where.serviceId) return l;
            count += 1;
            return { ...l, priceSnap: data.priceSnap };
          });
          return { count };
        },
      ),
      deleteMany: vi.fn(async () => {
        const count = h.state.lines.length;
        h.state.lines = [];
        return { count };
      }),
      createMany: vi.fn(async ({ data }: { data: Line[] }) => {
        h.state.lines.push(
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
          .filter((id) => h.state.catalog.has(id))
          .map((id) => ({ id, ...h.state.catalog.get(id)! })),
      ),
    },
    serviceOnDoctor: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { doctorId: string; serviceId: { in: string[] } };
        }) =>
          h.state.links.filter(
            (l) =>
              l.doctorId === where.doctorId &&
              where.serviceId.in.includes(l.serviceId),
          ),
      ),
    },
    doctor: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        cabinetId: `cab_${where.id.replace("doc_", "")}`,
        isActive: true,
      })),
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

/** The calendar's drop: date, time and the column's doctor, nothing else. */
const drag = (doctorId: string) => ({
  date: "2026-10-05T00:00:00.000Z",
  time: "10:00",
  doctorId,
});

const MIN = 60_000;

beforeEach(() => {
  h.conflictCalls = [];
  state.catalog = new Map([
    ["s_consult", { priceBase: CATALOG_CONSULT, durationMin: 30 }],
    ["s_eeg", { priceBase: EEG, durationMin: 40 }],
  ]);
  // The head doctor charges more and takes longer for the consult; the
  // colleague works at the catalog terms.
  state.links = [
    {
      doctorId: "doc_head",
      serviceId: "s_consult",
      priceOverride: HEAD_CONSULT,
      durationMinOverride: 45,
    },
    { doctorId: "doc_col", serviceId: "s_consult", priceOverride: null, durationMinOverride: null },
  ];
  state.visit = visitAt();
  state.lines = [{ serviceId: "s_consult", priceSnap: HEAD_CONSULT, quantity: 1 }];
  state.payments = [];
});

// ----- the route, end to end -------------------------------------------------

describe("PATCH /api/crm/appointments/[id]: a move to another doctor (review of DR-02)", () => {
  it("the head doctor's consult dragged to a colleague is billed and sized at the colleague's terms", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq(drag("doc_col")));
    expect(res.status).toBe(200);
    expect(state.lines).toEqual([
      { serviceId: "s_consult", priceSnap: CATALOG_CONSULT, quantity: 1 },
    ]);
    expect(state.visit!.priceFinal).toBe(CATALOG_CONSULT);
    expect(state.visit!.doctorId).toBe("doc_col");
    expect(state.visit!.durationMin).toBe(30);
    expect(state.visit!.endDate.getTime() - state.visit!.date.getTime()).toBe(30 * MIN);
    const body = (await res.json()) as { priceFinal: number; durationMin: number };
    expect(body.priceFinal).toBe(CATALOG_CONSULT);
    expect(body.durationMin).toBe(30);
  });

  it("the reverse move bills the head doctor's price and checks his longer block for conflicts", async () => {
    state.visit = visitAt({
      doctorId: "doc_col",
      cabinetId: "cab_col",
      durationMin: 30,
      priceService: CATALOG_CONSULT,
      priceBase: CATALOG_CONSULT,
      priceFinal: CATALOG_CONSULT,
    });
    state.lines = [{ serviceId: "s_consult", priceSnap: CATALOG_CONSULT, quantity: 1 }];
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq(drag("doc_head")));
    expect(res.status).toBe(200);
    expect(state.visit!.priceFinal).toBe(HEAD_CONSULT);
    expect(state.visit!.durationMin).toBe(45);
    // The overlap check ran on the block the visit will really occupy.
    expect(h.conflictCalls).toHaveLength(1);
    expect(h.conflictCalls[0]!.doctorId).toBe("doc_head");
    expect(h.conflictCalls[0]!.endAt.getTime() - h.conflictCalls[0]!.startAt.getTime()).toBe(
      45 * MIN,
    );
  });

  it("every line follows the new doctor, and the visit's discount still applies on top", async () => {
    state.visit = visitAt({ durationMin: 85, discountPct: 10 });
    state.lines = [
      { serviceId: "s_consult", priceSnap: HEAD_CONSULT, quantity: 1 },
      { serviceId: "s_eeg", priceSnap: EEG, quantity: 1 },
    ];
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq(drag("doc_col")));
    expect(res.status).toBe(200);
    expect(state.lines.map((l) => l.priceSnap)).toEqual([CATALOG_CONSULT, EEG]);
    expect(state.visit!.priceBase).toBe(CATALOG_CONSULT + EEG);
    expect(state.visit!.priceFinal).toBe(Math.round((CATALOG_CONSULT + EEG) * 0.9));
    // 45 + 40 booked with the head doctor becomes 30 + 40 with the colleague.
    expect(state.visit!.durationMin).toBe(70);
  });

  it("a block staff resized by hand keeps its length; the price still follows the doctor", async () => {
    state.visit = visitAt({ durationMin: 60 });
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq(drag("doc_col")));
    expect(res.status).toBe(200);
    expect(state.visit!.durationMin).toBe(60);
    expect(state.visit!.endDate.getTime() - state.visit!.date.getTime()).toBe(60 * MIN);
    expect(state.visit!.priceFinal).toBe(CATALOG_CONSULT);
  });

  it("a length sent with the move wins over the doctor's", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ ...drag("doc_col"), durationMin: 50 }));
    expect(res.status).toBe(200);
    expect(state.visit!.durationMin).toBe(50);
    expect(state.visit!.endDate.getTime() - state.visit!.date.getTime()).toBe(50 * MIN);
  });

  it("a paid visit keeps its price and lines on a move, its block still follows the doctor", async () => {
    state.payments = [{ id: "pay_1", amount: HEAD_CONSULT, status: "PAID" }];
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq(drag("doc_col")));
    expect(res.status).toBe(200);
    expect(state.lines[0]!.priceSnap).toBe(HEAD_CONSULT);
    expect(state.visit!.priceFinal).toBe(HEAD_CONSULT);
    expect(state.visit!.durationMin).toBe(30);
  });

  it("a stale client resending the same doctor changes nothing", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq(drag("doc_head")));
    expect(res.status).toBe(200);
    expect(state.lines[0]!.priceSnap).toBe(HEAD_CONSULT);
    expect(state.visit!.priceFinal).toBe(HEAD_CONSULT);
    expect(state.visit!.durationMin).toBe(45);
  });

  it("a move that also sends services prices the new lines with the new doctor and keeps the length", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({ ...drag("doc_col"), services: [{ serviceId: "s_consult" }] }),
    );
    expect(res.status).toBe(200);
    expect(state.lines[0]!.priceSnap).toBe(CATALOG_CONSULT);
    expect(state.visit!.priceFinal).toBe(CATALOG_CONSULT);
    expect(state.visit!.durationMin).toBe(45);
  });
});

// ----- the rule --------------------------------------------------------------

describe("doctor-change terms (pure)", () => {
  const terms = (entries: Array<[string, number, number]>) =>
    new Map<string, EffectiveServiceTerms>(
      entries.map(([id, price, durationMin]) => [id, { price, durationMin }]),
    );
  const head = terms([
    ["consult", HEAD_CONSULT, 45],
    ["eeg", EEG, 40],
  ]);
  const colleague = terms([
    ["consult", CATALOG_CONSULT, 30],
    ["eeg", EEG, 40],
  ]);

  it("sums each service once, null when one does not resolve", () => {
    expect(servicesDurationWith(["consult", "eeg", "consult"], head)).toBe(85);
    expect(servicesDurationWith(["consult", "mri"], head)).toBeNull();
    expect(servicesDurationWith([], head)).toBeNull();
  });

  it("a block sized by the leaving doctor's terms takes the new doctor's", () => {
    expect(
      durationAfterDoctorChange({
        durationMin: 85,
        serviceIds: ["consult", "eeg"],
        from: head,
        to: colleague,
      }),
    ).toBe(70);
  });

  it("a hand-sized block, or one whose services do not resolve, keeps its length", () => {
    expect(
      durationAfterDoctorChange({
        durationMin: 90,
        serviceIds: ["consult", "eeg"],
        from: head,
        to: colleague,
      }),
    ).toBe(90);
    expect(
      durationAfterDoctorChange({
        durationMin: 45,
        serviceIds: ["consult", "mri"],
        from: head,
        to: colleague,
      }),
    ).toBe(45);
    expect(
      durationAfterDoctorChange({ durationMin: 20, serviceIds: [], from: head, to: colleague }),
    ).toBe(20);
  });

  it("returns only the lines whose price changes; an unknown service keeps its line", () => {
    expect(
      linePricesForDoctor(
        [
          { serviceId: "consult", priceSnap: HEAD_CONSULT },
          { serviceId: "eeg", priceSnap: EEG },
          { serviceId: "mri", priceSnap: 1 },
        ],
        colleague,
      ),
    ).toEqual([{ serviceId: "consult", priceSnap: CATALOG_CONSULT }]);
  });
});
