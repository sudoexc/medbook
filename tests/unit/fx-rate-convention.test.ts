/**
 * Audit AN-01: one USD rate convention, сум per 1 USD («12600»).
 *
 * The settings screen asked for «12600», the payment route multiplied the
 * тийин amount by it (150 000 сум × 12600 overflowed the int4 snapshot and
 * every payment failed with 500), and LTV divided a USD amount by it. The
 * seed stored the inverse, truncated to 0.0001 (27% off).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rate: null as null | { rateUsd: unknown },
  created: [] as Array<Record<string, unknown>>,
  patientPayments: [] as Array<{ amount: number; currency: string; fxRate: unknown }>,
  patientUpdates: [] as Array<Record<string, unknown>>,
  paymentBefore: null as null | Record<string, unknown>,
  paymentUpdates: [] as Array<Record<string, unknown>>,
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
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));

// Postgres int4, what `Payment.amountUsdSnap` is.
const INT4_MAX = 2_147_483_647;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    exchangeRate: { findFirst: vi.fn(async () => state.rate) },
    appointment: { findUnique: vi.fn(async () => null) },
    payment: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => state.patientPayments),
      findUnique: vi.fn(async () => state.paymentBefore),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.paymentUpdates.push(data);
        return { ...state.paymentBefore, ...data };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const snap = data.amountUsdSnap;
        if (typeof snap === "number" && Math.abs(snap) > INT4_MAX) {
          // What Postgres answers, and what the route turned into a 500.
          throw new Error("value out of range for type integer");
        }
        state.created.push(data);
        return { id: "pay1", status: data.status, ...data };
      }),
    },
    patient: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.patientUpdates.push(data);
        return data;
      }),
    },
  },
}));

beforeEach(() => {
  state.rate = null;
  state.created = [];
  state.patientPayments = [];
  state.patientUpdates = [];
  state.paymentBefore = null;
  state.paymentUpdates = [];
});

function postPayment(body: Record<string, unknown>) {
  return new Request("https://x/api/crm/payments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("src/lib/fx: сум per 1 USD", () => {
  it("150 000 сум at 12600 is about $11.90", async () => {
    const { tiyinToUsdCents } = await import("@/lib/fx");
    expect(tiyinToUsdCents(150_000_00, 12600)).toBe(1190);
  });

  it("$100 at 12600 is 1 260 000 сум", async () => {
    const { usdCentsToTiyin } = await import("@/lib/fx");
    expect(usdCentsToTiyin(100_00, 12600)).toBe(1_260_000_00);
  });

  it("an implausible rate is no rate: the legacy 0.0001, a typo, garbage", async () => {
    const { uzsPerUsd, tiyinToUsdCents, usdCentsToTiyin } = await import("@/lib/fx");
    expect(uzsPerUsd("12600.0000")).toBe(12600);
    expect(uzsPerUsd(0.0001)).toBeNull();
    expect(uzsPerUsd(12.6)).toBeNull();
    expect(uzsPerUsd(1_260_000)).toBeNull();
    expect(uzsPerUsd(null)).toBeNull();
    expect(uzsPerUsd("abc")).toBeNull();
    expect(tiyinToUsdCents(150_000_00, 0.0001)).toBeNull();
    expect(usdCentsToTiyin(100_00, 0.0001)).toBeNull();
  });
});

describe("POST /api/crm/payments: the USD snapshot", () => {
  it("with today's rate typed as 12600, a 150 000 сум payment is created with amountUsdSnap ≈ 1190", async () => {
    state.rate = { rateUsd: "12600.0000" };
    const { POST } = await import("@/app/api/crm/payments/route");
    const res = await POST(
      postPayment({ patientId: "p1", amount: 150_000_00, method: "CASH", status: "PAID" }),
    );
    expect(res.status).toBe(201);
    expect(state.created[0]).toMatchObject({ fxRate: 12600, amountUsdSnap: 1190 });
  });

  it("a USD payment is its own snapshot", async () => {
    state.rate = { rateUsd: 12600 };
    const { POST } = await import("@/app/api/crm/payments/route");
    const res = await POST(
      postPayment({ patientId: "p1", amount: 100_00, currency: "USD", method: "CASH", status: "PAID" }),
    );
    expect(res.status).toBe(201);
    expect(state.created[0]).toMatchObject({ amountUsdSnap: 100_00, fxRate: 12600 });
  });

  it("a legacy rate (0.0001) never blocks a payment: the snapshot stays empty", async () => {
    state.rate = { rateUsd: "0.0001" };
    const { POST } = await import("@/app/api/crm/payments/route");
    const res = await POST(
      postPayment({ patientId: "p1", amount: 150_000_00, method: "CASH", status: "PAID" }),
    );
    expect(res.status).toBe(201);
    expect(state.created[0]).not.toHaveProperty("amountUsdSnap");
    expect(state.created[0]).not.toHaveProperty("fxRate");
  });
});

describe("PATCH /api/crm/payments/[id]: a corrected amount", () => {
  it("re-snapshots at the rate the payment was taken at", async () => {
    state.paymentBefore = {
      id: "pay1",
      currency: "UZS",
      amount: 150_000_00,
      fxRate: "12600.0000",
      amountUsdSnap: 1190,
      status: "PAID",
      patientId: null,
    };
    const { PATCH } = await import("@/app/api/crm/payments/[id]/route");
    const res = await PATCH(
      new Request("https://x/api/crm/payments/pay1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 252_000_00 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.paymentUpdates[0]).toMatchObject({ amount: 252_000_00, amountUsdSnap: 2000 });
  });
});

describe("LTV", () => {
  it("a $100 payment adds 1 260 000 сум at 12600, and a UZS payment its amount", async () => {
    const { computeLtv } = await import("@/server/services/ltv-compute");
    expect(
      computeLtv(
        [
          { amount: 100_00, currency: "USD", fxRate: "12600.0000" },
          { amount: 200_000_00, currency: "UZS", fxRate: null },
        ],
        null,
      ),
    ).toBe(1_260_000_00 + 200_000_00);
  });

  it("a USD payment without its own rate uses the clinic's latest; a legacy rate adds nothing", async () => {
    const { computeLtv } = await import("@/server/services/ltv-compute");
    expect(computeLtv([{ amount: 100_00, currency: "USD", fxRate: null }], 12600)).toBe(
      1_260_000_00,
    );
    expect(computeLtv([{ amount: 100_00, currency: "USD", fxRate: "0.0001" }], null)).toBe(0);
  });

  it("recalcLtv writes the converted LTV and leaves the visit count to the visit paths", async () => {
    state.rate = { rateUsd: 12600 };
    state.patientPayments = [{ amount: 100_00, currency: "USD", fxRate: 12600 }];
    const { recalcLtv } = await import("@/server/services/ltv");
    expect(await recalcLtv("p1")).toBe(1_260_000_00);
    expect(state.patientUpdates).toEqual([{ ltv: 1_260_000_00 }]);
  });
});

describe("CreateExchangeRateSchema", () => {
  it("takes сум per 1 USD and refuses the old «USD per сум» form", async () => {
    const { CreateExchangeRateSchema } = await import("@/server/schemas/exchange-rate");
    expect(
      CreateExchangeRateSchema.safeParse({ date: "2026-09-25", rateUsd: "12600" }).success,
    ).toBe(true);
    expect(
      CreateExchangeRateSchema.safeParse({ date: "2026-09-25", rateUsd: 1 / 12700 }).success,
    ).toBe(false);
    expect(
      CreateExchangeRateSchema.safeParse({ date: "2026-09-25", rateUsd: 126000000 }).success,
    ).toBe(false);
  });
});
