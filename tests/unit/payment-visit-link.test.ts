/**
 * Audit AN-02: a payment taken in the CRM is filed under its visit.
 *
 * The only payment dialog sent `{ patientId, amount, method }` and never an
 * `appointmentId`, so every visit-level figure read nothing: «Топ врачей»
 * and the doctor's revenue (payment → appointment → doctor), the drawer's
 * «Нет оплат», the «Неоплаченные» filter (`payments: none PAID`), and the
 * paid-visit price lock. The dialog now preselects a visit, and the route
 * checks the visit is this patient's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appointments: {} as Record<string, { patientId: string }>,
  created: [] as Array<Record<string, unknown>>,
  ltvFor: [] as string[],
  triggers: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "RECEPTIONIST" };
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
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: vi.fn((t: Record<string, unknown>) => state.triggers.push(t)),
}));
vi.mock("@/server/services/ltv", () => ({
  recalcLtv: vi.fn(async (id: string) => {
    state.ltvFor.push(id);
    return 0;
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    exchangeRate: { findFirst: vi.fn(async () => ({ rateUsd: 12600 })) },
    // The tenant scope makes another clinic's visit look exactly like a
    // missing one, which is what `null` stands for here.
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.appointments[where.id] ?? null,
      ),
    },
    payment: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: "pay1", ...data };
      }),
    },
  },
}));

beforeEach(() => {
  state.appointments = {
    appt_p1: { patientId: "p1" },
    appt_p2: { patientId: "p2" },
  };
  state.created = [];
  state.ltvFor = [];
  state.triggers = [];
});

function postPayment(body: Record<string, unknown>) {
  return new Request("https://x/api/crm/payments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: 200_000_00, method: "CASH", status: "PAID", ...body }),
  });
}

describe("POST /api/crm/payments with a visit", () => {
  it("the payment carries its appointmentId, so the visit reads as paid", async () => {
    const { POST } = await import("@/app/api/crm/payments/route");
    const res = await POST(postPayment({ patientId: "p1", appointmentId: "appt_p1" }));
    expect(res.status).toBe(201);
    expect(state.created[0]).toMatchObject({ patientId: "p1", appointmentId: "appt_p1" });
    // Pending «payment due» notifications of that visit are cancelled.
    expect(state.triggers).toEqual([{ kind: "payment.paid", appointmentId: "appt_p1" }]);
    expect(state.ltvFor).toEqual(["p1"]);
  });

  it("another patient's visit is refused, nothing is created", async () => {
    const { POST } = await import("@/app/api/crm/payments/route");
    const res = await POST(postPayment({ patientId: "p1", appointmentId: "appt_p2" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "appointment_patient_mismatch" });
    expect(state.created).toEqual([]);
  });

  it("a visit this clinic does not have is refused", async () => {
    const { POST } = await import("@/app/api/crm/payments/route");
    const res = await POST(postPayment({ patientId: "p1", appointmentId: "appt_other_clinic" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "appointment_not_found" });
    expect(state.created).toEqual([]);
  });

  it("a visit alone is enough: the patient comes from it, before the row is written", async () => {
    const { POST } = await import("@/app/api/crm/payments/route");
    const res = await POST(postPayment({ appointmentId: "appt_p2" }));
    expect(res.status).toBe(201);
    expect(state.created[0]).toMatchObject({ patientId: "p2", appointmentId: "appt_p2" });
    expect(state.ltvFor).toEqual(["p2"]);
  });

  it("a deposit without a visit is still allowed", async () => {
    const { POST } = await import("@/app/api/crm/payments/route");
    const res = await POST(postPayment({ patientId: "p1" }));
    expect(res.status).toBe(201);
    expect(state.created[0]).toMatchObject({ patientId: "p1", appointmentId: null });
  });
});

describe("which visit the dialog preselects", () => {
  // 25.09.2026 15:00 in Tashkent.
  const NOW = new Date("2026-09-25T10:00:00Z");
  const visit = (
    id: string,
    iso: string,
    extra: Partial<{ status: string; priceFinal: number | null; payments: Array<{ amount: number; status: string }> }> = {},
  ) => ({
    id,
    date: iso,
    status: "COMPLETED",
    priceFinal: 200_000_00,
    payments: [] as Array<{ amount: number; status: string }>,
    ...extra,
  });

  it("today's unpaid visit nearest to now", async () => {
    const { defaultPaymentVisitId } = await import("@/lib/payments/visit-choice");
    expect(
      defaultPaymentVisitId(
        [
          visit("morning", "2026-09-25T04:00:00Z"),
          visit("afternoon", "2026-09-25T09:30:00Z", { status: "IN_PROGRESS" }),
          visit("yesterday", "2026-09-24T09:30:00Z"),
        ],
        NOW,
      ),
    ).toBe("afternoon");
  });

  it("an early-morning visit counts as today in Tashkent (UTC is still yesterday)", async () => {
    const { defaultPaymentVisitId } = await import("@/lib/payments/visit-choice");
    // 25.09 04:30 Tashkent = 24.09 23:30 UTC.
    expect(
      defaultPaymentVisitId([visit("early", "2026-09-24T23:30:00Z")], NOW),
    ).toBe("early");
  });

  it("skips paid, free, cancelled and no-show visits", async () => {
    const { defaultPaymentVisitId } = await import("@/lib/payments/visit-choice");
    expect(
      defaultPaymentVisitId(
        [
          visit("paid", "2026-09-25T09:00:00Z", {
            payments: [{ amount: 200_000_00, status: "PAID" }],
          }),
          visit("free_repeat", "2026-09-25T09:10:00Z", { priceFinal: 0 }),
          visit("cancelled", "2026-09-25T09:20:00Z", { status: "CANCELLED" }),
          visit("no_show", "2026-09-25T09:30:00Z", { status: "NO_SHOW" }),
          visit("partly_paid", "2026-09-23T09:00:00Z", {
            payments: [{ amount: 50_000_00, status: "PAID" }],
          }),
        ],
        NOW,
      ),
    ).toBe("partly_paid");
  });

  it("nothing today: the latest unpaid visit of the past week; older or future ones are not guessed", async () => {
    const { defaultPaymentVisitId } = await import("@/lib/payments/visit-choice");
    expect(
      defaultPaymentVisitId(
        [visit("last_week", "2026-09-20T06:00:00Z"), visit("earlier", "2026-09-19T06:00:00Z")],
        NOW,
      ),
    ).toBe("last_week");
    expect(defaultPaymentVisitId([visit("old", "2026-09-10T06:00:00Z")], NOW)).toBeNull();
    expect(
      defaultPaymentVisitId([visit("tomorrow", "2026-09-26T06:00:00Z", { status: "BOOKED" })], NOW),
    ).toBeNull();
  });

  it("the amount to prefill is what is still owed", async () => {
    const { outstandingTiyin, isSettled } = await import("@/lib/payments/visit-choice");
    const v = visit("v", "2026-09-25T09:00:00Z", {
      payments: [
        { amount: 50_000_00, status: "PAID" },
        { amount: 10_000_00, status: "REFUNDED" },
      ],
    });
    expect(outstandingTiyin(v)).toBe(150_000_00);
    expect(isSettled(v)).toBe(false);
    expect(isSettled(visit("unpriced", "2026-09-25T09:00:00Z", { priceFinal: null }))).toBe(false);
  });
});

describe("the price lock of a paid visit", () => {
  it("a visit with a linked PAID payment is not re-priced", async () => {
    const { recomputeAppointmentPrice } = await import(
      "@/server/pricing/recompute-appointment-price"
    );
    const update = vi.fn();
    const client = {
      appointment: {
        findUnique: vi.fn(async () => ({
          id: "appt_p1",
          date: new Date("2026-09-25T09:00:00Z"),
          medicalCaseId: null,
          serviceId: "s1",
          priceService: 200_000_00,
          priceBase: 200_000_00,
          priceFinal: 200_000_00,
          discountPct: 0,
          discountAmount: 0,
          payments: [{ id: "pay1" }],
          services: [],
          primaryService: { id: "s1", priceBase: 300_000_00, freeRepeatDays: null },
        })),
        update,
      },
    };
    const r = await recomputeAppointmentPrice(client as never, "appt_p1");
    expect(r.reason).toBe("paid_locked");
    expect(r.priceFinal).toBe(200_000_00);
    expect(update).not.toHaveBeenCalled();
  });
});
