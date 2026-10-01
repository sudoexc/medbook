/**
 * Audit AN-11 (correcting and refunding a recorded payment; revenue net of
 * refunds; LTV follows every money change) and AN-23 («150.000» typed into
 * the payment dialog was saved as 150 сум).
 *
 * Payments are not recorded in the CRM yet (Clinic.paymentsTrackedSince
 * NULL); these pin the behaviour for the day they are switched on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_SUM_INPUT, parseSumInput } from "@/lib/money-input";
import { planPaymentUpdate } from "@/server/payments/payment-update";
import {
  collectedWhere,
  refundedWhere,
  revenueMoves,
  sumNetRevenue,
} from "@/server/analytics/net-revenue";
import { refundInstantFor } from "@/lib/payments/refund-date";
import { paidNetTiyin } from "@/server/services/ltv-compute";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// ── AN-23 ────────────────────────────────────────────────────────────────

describe("AN-23: a typed amount in сум", () => {
  it("«150.000», «150,000» and «150 000» are all 150 000 сум", () => {
    for (const raw of ["150.000", "150,000", "150 000", "150 000", "150000"]) {
      expect(parseSumInput(raw)).toEqual({ ok: true, sum: 150_000, tiyin: 15_000_000 });
    }
  });

  it("thousands groups of any length: «1.500.000» is 1 500 000", () => {
    expect(parseSumInput("1.500.000")).toMatchObject({ ok: true, sum: 1_500_000 });
    expect(parseSumInput("1,500,000")).toMatchObject({ ok: true, sum: 1_500_000 });
  });

  it("anything that is not digits in thousands groups is an error, not a guess", () => {
    for (const raw of ["150.5", "1,5", "150к", "abc", "15.00.000", "-150000", "150 000 сум"]) {
      expect(parseSumInput(raw)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(parseSumInput("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("an amount the Int тийин column cannot hold is too large", () => {
    expect(parseSumInput(String(MAX_SUM_INPUT))).toMatchObject({ ok: true });
    expect(parseSumInput(String(MAX_SUM_INPUT + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("the payment dialog saves through the parser and shows what will be saved", () => {
    const src = read("src/components/payments/add-payment-dialog.tsx");
    expect(src).toContain("parseSumInput(amount)");
    expect(src).toContain('t("amountPreview"');
    expect(src).not.toContain('amount.replace(/[\\s\\u00a0\\u202f]/g, "")');
  });
});

// ── AN-11: the rules of a change ─────────────────────────────────────────

const NOW = new Date("2026-10-05T09:00:00.000Z");
const PAID_AT = new Date("2026-10-01T06:00:00.000Z");
const paid = {
  status: "PAID" as const,
  amount: 1_500_000_00,
  refundedAmount: 0,
  refundedAt: null,
  paidAt: PAID_AT,
};

describe("AN-11: what a payment change may do", () => {
  it("an ADMIN corrects a mistyped amount; the money changed, so LTV is stale", () => {
    const plan = planPaymentUpdate(paid, { amount: 150_000_00 }, "ADMIN", NOW);
    expect(plan).toEqual({ ok: true, data: { amount: 150_000_00 }, moneyChanged: true });
  });

  it("reception cannot correct an amount", () => {
    expect(planPaymentUpdate(paid, { amount: 1 }, "RECEPTIONIST", NOW)).toMatchObject({
      ok: false,
      status: 403,
      reason: "amount_admin_only",
    });
  });

  it("a partial refund keeps the payment PAID and records when it was given back", () => {
    const plan = planPaymentUpdate(paid, { refundedAmount: 500_000_00 }, "RECEPTIONIST", NOW);
    expect(plan).toEqual({
      ok: true,
      data: { refundedAmount: 500_000_00, refundedAt: NOW },
      moneyChanged: true,
    });
  });

  it("a full refund makes it REFUNDED, on the day chosen", () => {
    const at = new Date("2026-10-03T18:59:00.000Z");
    const plan = planPaymentUpdate(
      paid,
      { refundedAmount: paid.amount, refundedAt: at },
      "ADMIN",
      NOW,
    );
    expect(plan).toMatchObject({
      ok: true,
      data: { refundedAmount: paid.amount, refundedAt: at, status: "REFUNDED" },
    });
  });

  it("one refund per payment, never more than the amount, dated between payment and now", () => {
    const refunded = { ...paid, refundedAmount: 100_00, refundedAt: NOW };
    expect(planPaymentUpdate(refunded, { refundedAmount: 200_00 }, "ADMIN", NOW)).toMatchObject({
      ok: false,
      reason: "already_refunded",
    });
    expect(
      planPaymentUpdate(paid, { refundedAmount: paid.amount + 1 }, "ADMIN", NOW),
    ).toMatchObject({ ok: false, reason: "refund_exceeds_amount" });
    expect(
      planPaymentUpdate(
        paid,
        { refundedAmount: 100_00, refundedAt: new Date("2026-09-30T00:00:00Z") },
        "ADMIN",
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: "refund_date_invalid" });
    expect(
      planPaymentUpdate(
        paid,
        { refundedAmount: 100_00, refundedAt: new Date(NOW.getTime() + 86_400_000) },
        "ADMIN",
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: "refund_date_invalid" });
  });

  it("an amount refunded against cannot be corrected afterwards", () => {
    const refunded = { ...paid, refundedAmount: 100_00, refundedAt: NOW };
    expect(planPaymentUpdate(refunded, { amount: 1_000 }, "ADMIN", NOW)).toMatchObject({
      ok: false,
      reason: "amount_locked_after_refund",
    });
  });

  it("REFUNDED is final and PAID leaves only through a refund", () => {
    const refunded = { ...paid, status: "REFUNDED" as const, refundedAmount: paid.amount };
    expect(planPaymentUpdate(refunded, { status: "PAID" }, "ADMIN", NOW)).toMatchObject({
      ok: false,
      reason: "status_move_not_allowed",
    });
    expect(planPaymentUpdate(paid, { status: "UNPAID" }, "ADMIN", NOW)).toMatchObject({
      ok: false,
      reason: "status_move_not_allowed",
    });
    expect(planPaymentUpdate(paid, { status: "REFUNDED" }, "ADMIN", NOW)).toMatchObject({
      ok: false,
      reason: "refund_needs_amount",
    });
  });

  it("UNPAID becomes PAID with today's date; a note edit does not touch the money", () => {
    const unpaid = { ...paid, status: "UNPAID" as const, paidAt: null };
    expect(planPaymentUpdate(unpaid, { status: "PAID" }, "RECEPTIONIST", NOW)).toEqual({
      ok: true,
      data: { paidAt: NOW, status: "PAID" },
      moneyChanged: true,
    });
    expect(
      planPaymentUpdate(paid, { receiptNumber: "R-1" }, "RECEPTIONIST", NOW),
    ).toEqual({ ok: true, data: { receiptNumber: "R-1" }, moneyChanged: false });
  });
});

describe("AN-11: the refund date picked in the dialog", () => {
  it("today means now; an earlier day is that day's 23:59 in Tashkent", () => {
    expect(refundInstantFor("2026-10-05", "2026-10-05", PAID_AT)).toEqual({
      ok: true,
      refundedAt: null,
    });
    const r = refundInstantFor("2026-10-03", "2026-10-05", PAID_AT);
    expect(r).toEqual({ ok: true, refundedAt: new Date("2026-10-03T18:59:00.000Z") });
  });

  it("not before the payment's day, not after today", () => {
    expect(refundInstantFor("2026-09-30", "2026-10-05", PAID_AT).ok).toBe(false);
    expect(refundInstantFor("2026-10-06", "2026-10-05", PAID_AT).ok).toBe(false);
    // Same Tashkent day as the payment is fine.
    expect(refundInstantFor("2026-10-01", "2026-10-05", PAID_AT).ok).toBe(true);
  });
});

// ── AN-11: revenue and LTV ───────────────────────────────────────────────

describe("AN-11: revenue is net of refunds, by the day the refund was given", () => {
  it("the refund lowers the refund day; the paid day keeps its amount", () => {
    const moves = revenueMoves(
      [{ amount: 300_000_00, paidAt: PAID_AT }],
      [{ refundedAmount: 100_000_00, refundedAt: NOW }],
    );
    expect(moves).toEqual([
      { at: PAID_AT, amount: 300_000_00 },
      { at: NOW, amount: -100_000_00 },
    ]);
  });

  it("collected counts PAID and REFUNDED by paidAt; refunds count by refundedAt", () => {
    const w = { from: PAID_AT, to: NOW };
    expect(collectedWhere(w)).toEqual({
      status: { in: ["PAID", "REFUNDED"] },
      paidAt: { gte: PAID_AT, lt: NOW },
    });
    expect(refundedWhere(w)).toEqual({
      status: { in: ["PAID", "REFUNDED"] },
      refundedAmount: { gt: 0 },
      refundedAt: { gte: PAID_AT, lt: NOW },
    });
  });

  it("sumNetRevenue is taken minus given back, both narrowed the same way", async () => {
    const wheres: Array<Record<string, unknown>> = [];
    const db = {
      payment: {
        aggregate: async (args: { where: Record<string, unknown>; _sum: Record<string, boolean> }) => {
          wheres.push(args.where);
          return args._sum.refundedAmount
            ? { _sum: { refundedAmount: 40_00 } }
            : { _sum: { amount: 100_00 } };
        },
      },
    };
    const net = await sumNetRevenue(db as never, { from: PAID_AT, to: NOW }, { currency: "UZS" });
    expect(net).toBe(60_00);
    expect(wheres).toHaveLength(2);
    for (const w of wheres) expect(w).toMatchObject({ currency: "UZS" });
  });

  it("every revenue figure goes through the net rule", () => {
    expect(read("src/app/api/crm/analytics/route.ts")).toContain("refundedWhere(");
    expect(read("src/app/api/crm/dashboard/route.ts")).toContain("sumNetRevenue(");
    expect(read("src/server/analytics/financial-pace-resolver.ts")).toContain("sumNetRevenue(");
    expect(read("src/server/revenue/loss-data.ts")).toContain("sumNetRevenue(");
    const mv = read("prisma/migrations/20261001110000_payments_billing_platform/migration.sql");
    expect(mv).toContain('-p."refundedAmount"');
    expect(mv).toContain('"refundedAt" AT TIME ZONE');
  });

  it("LTV is the payments net of what was refunded", () => {
    expect(
      paidNetTiyin(
        [
          { amount: 300_000_00, currency: "UZS", fxRate: null, refundedAmount: 100_000_00 },
          { amount: 50_000_00, currency: "UZS", fxRate: null, refundedAmount: 0 },
        ],
        null,
      ),
    ).toBe(250_000_00);
    expect(read("src/server/services/ltv.ts")).toContain("paidNetTiyin(payments");
  });

  it("existing refunds keep their effect: dated on their paid day by the migration", () => {
    const sql = read("prisma/migrations/20261001110000_payments_billing_platform/migration.sql");
    expect(sql).toContain(`SET "refundedAmount" = "amount"`);
    expect(sql).toContain(`SET "refundedAt" = COALESCE("paidAt", "updatedAt")`);
  });
});

// ── AN-11: the route ─────────────────────────────────────────────────────

const route = vi.hoisted(() => ({
  role: "RECEPTIONIST",
  before: null as Record<string, unknown> | null,
  writeCount: 1,
  updateManyArgs: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  ltvFor: [] as string[],
}));

vi.mock("@/lib/api-handler", () => ({
  createApiHandler:
    (
      opts: { bodySchema?: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) =>
      handler({
        request,
        body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: route.role },
      }),
  createApiListHandler: () => async () => new Response(null),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/actions/settled-debt", () => ({ retireSettledDebt: vi.fn() }));
vi.mock("@/server/services/ltv", () => ({
  recalcLtv: vi.fn(async (id: string) => {
    route.ltvFor.push(id);
    return 0;
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: {
      findUnique: vi.fn(async () => route.before),
      updateMany: vi.fn(
        async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          route.updateManyArgs.push(args);
          if (route.writeCount > 0 && route.before) {
            route.before = { ...route.before, ...args.data };
          }
          return { count: route.writeCount };
        },
      ),
    },
  },
}));

function patch(body: Record<string, unknown>) {
  return new Request("https://x/api/crm/payments/pay1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("AN-11: PATCH /api/crm/payments/[id]", () => {
  beforeEach(() => {
    route.role = "RECEPTIONIST";
    route.writeCount = 1;
    route.updateManyArgs = [];
    route.ltvFor = [];
    route.before = {
      id: "pay1",
      currency: "UZS",
      amount: 300_000_00,
      fxRate: null,
      status: "PAID",
      refundedAmount: 0,
      refundedAt: null,
      paidAt: PAID_AT,
      patientId: "p1",
      appointmentId: null,
    };
  });

  it("a refund is written on the values it was planned from and recalculates LTV", async () => {
    const { PATCH } = await import("@/app/api/crm/payments/[id]/route");
    const res = await PATCH(patch({ refundedAmount: 100_000_00 }));
    expect(res.status).toBe(200);
    expect(route.updateManyArgs[0]!.where).toEqual({
      id: "pay1",
      status: "PAID",
      amount: 300_000_00,
      refundedAmount: 0,
    });
    expect(route.updateManyArgs[0]!.data).toMatchObject({ refundedAmount: 100_000_00 });
    expect(route.ltvFor).toEqual(["p1"]);
  });

  it("an amount correction recalculates LTV too (it used to need a status flip)", async () => {
    route.role = "ADMIN";
    const { PATCH } = await import("@/app/api/crm/payments/[id]/route");
    const res = await PATCH(patch({ amount: 30_000_00 }));
    expect(res.status).toBe(200);
    expect(route.ltvFor).toEqual(["p1"]);
  });

  it("a concurrent change makes the second write a 409, not a double refund", async () => {
    route.writeCount = 0;
    const { PATCH } = await import("@/app/api/crm/payments/[id]/route");
    const res = await PATCH(patch({ refundedAmount: 100_000_00 }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason?: string }).reason).toBe("payment_changed");
    expect(route.ltvFor).toEqual([]);
  });

  it("refusals carry the reason the dialog shows", async () => {
    const { PATCH } = await import("@/app/api/crm/payments/[id]/route");
    const res = await PATCH(patch({ amount: 1 }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason?: string }).reason).toBe("amount_admin_only");
    expect(route.updateManyArgs).toHaveLength(0);
  });

  it("the patient card offers «Исправить» and «Возврат» on a paid row", () => {
    const src = read("src/app/[locale]/crm/patients/[id]/_components/tabs/payments-tab.tsx");
    expect(src).toContain('setAdjust({ mode: "amount", row })');
    expect(src).toContain('setAdjust({ mode: "refund", row })');
    const dialog = read("src/components/payments/payment-adjust-dialog.tsx");
    expect(dialog).toContain("/api/crm/payments/${payment.id}");
    expect(dialog).toContain("parseSumInput(amount)");
  });
});
