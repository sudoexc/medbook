/**
 * Audit DR-02: a doctor's own price and duration for a service
 * (`ServiceOnDoctor.priceOverride` / `durationMinOverride`) are what the
 * visit is booked with.
 *
 * Only the kiosk and the public price sheet read them: the head doctor's
 * consult priced at 300 000 сум was billed 200 000 (the catalog price) and
 * his 45-minute visits were booked 30 minutes apart. Editing the doctors of
 * a service also wiped every override. Pinned here:
 *   - the rule itself (`effectiveServiceTerms`, override over catalog);
 *   - the booking kernel prices and sizes the visit with it, and snapshots
 *     the line at the doctor's price;
 *   - the slot grid sizes the block with the doctor's duration;
 *   - PATCH /api/crm/services/[id] with doctorIds keeps the overrides of the
 *     doctors who stay.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { effectiveServiceTerms } from "@/lib/doctor-service-terms";

const h = vi.hoisted(() => ({
  services: [] as Array<{
    id: string;
    priceBase: number;
    durationMin: number;
    clinicId: string;
    isActive: boolean;
  }>,
  links: [] as Array<{
    doctorId: string;
    serviceId: string;
    priceOverride: number | null;
    durationMinOverride: number | null;
  }>,
  created: null as null | Record<string, unknown>,
  lines: [] as Array<Record<string, unknown>>,
  sodDeleteWhere: null as unknown,
  sodCreate: null as null | { data: unknown; skipDuplicates?: boolean },
}));

vi.mock("@/server/patient/segments", () => ({
  refreshPatientSegment: vi.fn(async () => undefined),
}));
vi.mock("@/server/services/appointments", () => ({
  applyTime: (date: Date) => date,
  computeEndDate: (start: Date, durationMin: number) =>
    new Date(start.getTime() + durationMin * 60_000),
  detectConflicts: vi.fn(async () => ({ ok: true })),
  DEFAULT_SLOT_STEP_MIN: 20,
  findAvailableSlots: vi.fn(async () => ["09:00"]),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/site-prices", () => ({ invalidateSitePrices: vi.fn() }));
vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "admin1", role: "ADMIN" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx,
        }),
    createApiListHandler:
      (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});

vi.mock("@/lib/prisma", () => {
  const inIds = (where: { id?: { in?: string[] } }) => where?.id?.in ?? [];
  const prisma = {
    doctor: {
      findUnique: vi.fn(async () => ({
        id: "doc_head",
        clinicId: "c1",
        cabinetId: "cab_1",
        isActive: true,
        cabinet: { isActive: true },
      })),
      findFirst: vi.fn(async () => ({ id: "doc_head" })),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id })),
      ),
    },
    service: {
      findMany: vi.fn(
        async ({ where }: { where: { id?: { in?: string[] }; clinicId?: string; isActive?: boolean } }) =>
          h.services
            .filter((s) => inIds(where).includes(s.id))
            .filter((s) => where.clinicId === undefined || s.clinicId === where.clinicId)
            .filter((s) => where.isActive === undefined || s.isActive === where.isActive)
            .map(({ id, priceBase, durationMin }) => ({ id, priceBase, durationMin })),
      ),
      findUnique: vi.fn(async () => ({
        id: "svc_consult",
        nameRu: "Консультация",
        nameUz: "Konsultatsiya",
        isActive: true,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "svc_consult",
        ...data,
      })),
    },
    serviceOnDoctor: {
      findMany: vi.fn(
        async ({ where }: { where: { doctorId: string; serviceId: { in: string[] } } }) =>
          h.links
            .filter((l) => l.doctorId === where.doctorId)
            .filter((l) => where.serviceId.in.includes(l.serviceId)),
      ),
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        h.sodDeleteWhere = where;
        return { count: 0 };
      }),
      createMany: vi.fn(async (args: { data: unknown; skipDuplicates?: boolean }) => {
        h.sodCreate = args;
        return { count: 0 };
      }),
    },
    appointment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.created = data;
        return { id: "appt_1", ...data };
      }),
    },
    appointmentService: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        h.lines = data;
        return { count: data.length };
      }),
    },
    auditLog: { create: vi.fn(async () => ({ id: "a" })) },
    eventOutbox: { create: vi.fn(async () => ({ id: "ob" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prisma)),
  };
  return { prisma };
});

import { bookAppointment } from "@/server/appointments/book";
import { findAvailableSlots } from "@/server/services/appointments";

const CONSULT_BASE = 200_000_00; // 200 000 сум in tiyin
const HEAD_PRICE = 300_000_00;

beforeEach(() => {
  h.services = [
    { id: "svc_consult", priceBase: CONSULT_BASE, durationMin: 30, clinicId: "c1", isActive: true },
    { id: "svc_eeg", priceBase: 150_000_00, durationMin: 40, clinicId: "c1", isActive: true },
  ];
  h.links = [
    { doctorId: "doc_head", serviceId: "svc_consult", priceOverride: HEAD_PRICE, durationMinOverride: 45 },
    { doctorId: "doc_head", serviceId: "svc_eeg", priceOverride: null, durationMinOverride: null },
  ];
  h.created = null;
  h.lines = [];
  h.sodDeleteWhere = null;
  h.sodCreate = null;
  vi.mocked(findAvailableSlots).mockClear();
});

describe("effectiveServiceTerms", () => {
  it("the doctor's override wins over the catalog", () => {
    expect(
      effectiveServiceTerms(
        { priceBase: CONSULT_BASE, durationMin: 30 },
        { priceOverride: HEAD_PRICE, durationMinOverride: 45 },
      ),
    ).toEqual({ price: HEAD_PRICE, durationMin: 45 });
  });

  it("a null override or no link falls back to the catalog", () => {
    const svc = { priceBase: CONSULT_BASE, durationMin: 30 };
    expect(
      effectiveServiceTerms(svc, { priceOverride: null, durationMinOverride: null }),
    ).toEqual({ price: CONSULT_BASE, durationMin: 30 });
    expect(effectiveServiceTerms(svc, undefined)).toEqual({
      price: CONSULT_BASE,
      durationMin: 30,
    });
  });

  it("a zero override is a real price (a free consult), not «unset»", () => {
    expect(
      effectiveServiceTerms(
        { priceBase: CONSULT_BASE, durationMin: 30 },
        { priceOverride: 0, durationMinOverride: null },
      ).price,
    ).toBe(0);
  });
});

function bookConsult(extra: Partial<Parameters<typeof bookAppointment>[0]> = {}) {
  return bookAppointment({
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_head",
    startAt: new Date("2026-10-07T05:00:00.000Z"),
    serviceId: "svc_consult",
    services: [{ serviceId: "svc_consult", quantity: 1 }],
    channel: "PHONE",
    actor: {
      role: "RECEPTIONIST",
      userId: "u_desk",
      patientId: null,
      onBehalfOfPatientId: null,
      label: "user:u_desk",
    },
    surface: "CRM",
    ...extra,
  });
}

describe("bookAppointment prices the visit as the doctor charges (DR-02)", () => {
  it("override 300 000 сум, 45 min: the visit and its line carry them", async () => {
    const res = await bookConsult();
    expect(res.ok).toBe(true);
    expect(h.created).toMatchObject({
      priceBase: HEAD_PRICE,
      priceService: HEAD_PRICE,
      priceFinal: HEAD_PRICE,
      durationMin: 45,
    });
    expect(h.lines).toEqual([
      expect.objectContaining({ serviceId: "svc_consult", priceSnap: HEAD_PRICE }),
    ]);
  });

  it("a service without an override keeps the catalog terms", async () => {
    const res = await bookConsult({
      serviceId: "svc_eeg",
      services: [{ serviceId: "svc_eeg" }],
    });
    expect(res.ok).toBe(true);
    expect(h.created).toMatchObject({ priceBase: 150_000_00, durationMin: 40 });
  });

  it("sums the doctor's durations and prices over several services", async () => {
    await bookConsult({
      services: [{ serviceId: "svc_consult" }, { serviceId: "svc_eeg" }],
    });
    expect(h.created).toMatchObject({
      priceBase: HEAD_PRICE + 150_000_00,
      durationMin: 45 + 40,
    });
  });

  it("a service missing from the clinic catalog still refuses the booking", async () => {
    const res = await bookConsult({
      serviceId: "svc_gone",
      services: [{ serviceId: "svc_gone" }],
    });
    expect(res).toEqual({ ok: false, reason: "service_not_found" });
  });
});

describe("the slot grid sizes the block with the doctor's duration (DR-02)", () => {
  it("CRM /slots/available asks for 45 minutes for the head doctor's consult", async () => {
    const { GET } = await import("@/app/api/crm/appointments/slots/available/route");
    const res = await GET(
      new Request(
        "https://x/api/crm/appointments/slots/available?doctorId=doc_head&date=2026-10-07&serviceIds=svc_consult",
      ),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(findAvailableSlots)).toHaveBeenCalledWith(
      expect.objectContaining({ doctorId: "doc_head", slotMin: 45 }),
    );
  });
});

describe("PATCH /api/crm/services/[id] keeps the overrides of doctors who stay (DR-02)", () => {
  it("removes only the doctors who left and adds newcomers without touching the rest", async () => {
    const { PATCH } = await import("@/app/api/crm/services/[id]/route");
    const res = await PATCH(
      new Request("https://x/api/crm/services/svc_consult", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doctorIds: ["doc_head", "doc_new"] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(h.sodDeleteWhere).toEqual({
      serviceId: "svc_consult",
      doctorId: { notIn: ["doc_head", "doc_new"] },
    });
    expect(h.sodCreate?.skipDuplicates).toBe(true);
  });
});
