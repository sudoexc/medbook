/**
 * Phase 19 Wave 3 — invoice lifecycle (createUpgradeInvoice + markInvoicePaid).
 *
 * Prisma + tenant-context are mocked so the helper can be exercised
 * without a real DB. We assert:
 *   - createUpgradeInvoice writes a DRAFT row, stamps pendingPlanId,
 *     and emits exactly one `INVOICE_CREATED` audit row.
 *   - markInvoicePaid flips status, swaps pendingPlanId → planId,
 *     clears pendingPlanId, and emits exactly one `INVOICE_PAID` row.
 *   - markInvoicePaid is idempotent (second call is a no-op).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface PlanRow {
  id: string;
  slug: string;
  priceMonth: { toString: () => string };
  currency: string;
}

interface InvoiceRow {
  id: string;
  clinicId: string;
  number: string;
  status: "DRAFT" | "ISSUED" | "PAID" | "VOID" | "OVERDUE";
  amountTiins: bigint;
  targetPlanId: string | null;
  paidAt: Date | null;
  paymentRef: string | null;
}

interface SubRow {
  id: string;
  clinicId: string;
  planId: string;
  pendingPlanId: string | null;
  status: string;
}

const state: {
  plans: PlanRow[];
  invoices: InvoiceRow[];
  sub: SubRow;
  audits: Array<{ action: string; entityId: string | null; meta: unknown }>;
  invoiceNumber: string;
} = {
  plans: [
    {
      id: "plan-basic",
      slug: "basic",
      priceMonth: { toString: () => "0" },
      currency: "UZS",
    },
    {
      id: "plan-pro",
      slug: "pro",
      priceMonth: { toString: () => "120000" },
      currency: "UZS",
    },
  ],
  invoices: [],
  sub: {
    id: "sub-1",
    clinicId: "clinic-1",
    planId: "plan-basic",
    pendingPlanId: null,
    status: "TRIAL",
  },
  audits: [],
  invoiceNumber: "INV-2026-0001",
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    plan: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return state.plans.find((p) => p.id === where.id) ?? null;
      }),
    },
    invoice: {
      create: vi.fn(
        async ({
          data,
          select,
        }: {
          data: Record<string, unknown>;
          select?: Record<string, boolean>;
        }) => {
          const row: InvoiceRow = {
            id: "inv-" + (state.invoices.length + 1),
            clinicId: data.clinicId as string,
            number: data.number as string,
            status: (data.status as InvoiceRow["status"]) ?? "DRAFT",
            amountTiins: data.amountTiins as bigint,
            targetPlanId: (data.targetPlanId as string | null) ?? null,
            paidAt: null,
            paymentRef: null,
          };
          state.invoices.push(row);
          if (!select) return row;
          return {
            id: row.id,
            number: row.number,
            amountTiins: row.amountTiins,
          };
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => {
          return state.invoices.find((i) => i.id === where.id) ?? null;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: { not?: string } };
          data: Partial<InvoiceRow>;
        }) => {
          const inv = state.invoices.find((i) => i.id === where.id);
          if (!inv) return { count: 0 };
          if (where.status?.not && inv.status === where.status.not) {
            return { count: 0 };
          }
          Object.assign(inv, data);
          return { count: 1 };
        },
      ),
    },
    subscription: {
      findUnique: vi.fn(async () => state.sub),
      update: vi.fn(
        async ({ data }: { data: Partial<SubRow> }) => {
          Object.assign(state.sub, data);
          return state.sub;
        },
      ),
    },
    auditLog: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { action: string; entityId: string | null; meta: unknown };
        }) => {
          state.audits.push({
            action: data.action,
            entityId: data.entityId,
            meta: data.meta,
          });
          return data;
        },
      ),
    },
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (
    _ctx: unknown,
    fn: () => Promise<unknown>,
  ): Promise<unknown> => fn(),
}));

vi.mock("@/server/billing/invoice-number", () => ({
  nextInvoiceNumber: vi.fn(async () => state.invoiceNumber),
  formatInvoiceNumber: (year: number, counter: number) =>
    `INV-${year}-${String(counter).padStart(4, "0")}`,
  parseInvoiceCounter: (s: string) => {
    const m = /^INV-\d{4}-(\d+)$/.exec(s);
    return m ? parseInt(m[1]!, 10) : null;
  },
}));

import {
  createUpgradeInvoice,
  markInvoicePaid,
} from "@/server/billing/invoice";

describe("createUpgradeInvoice", () => {
  beforeEach(() => {
    state.invoices = [];
    state.audits = [];
    state.sub = {
      id: "sub-1",
      clinicId: "clinic-1",
      planId: "plan-basic",
      pendingPlanId: null,
      status: "TRIAL",
    };
    state.invoiceNumber = "INV-2026-0001";
  });

  it("writes a DRAFT invoice with the destination plan's price", async () => {
    const result = await createUpgradeInvoice({
      clinicId: "clinic-1",
      fromPlanId: "plan-basic",
      toPlanId: "plan-pro",
      now: new Date("2026-05-07T00:00:00Z"),
    });

    expect(state.invoices.length).toBe(1);
    expect(state.invoices[0]!.status).toBe("DRAFT");
    expect(state.invoices[0]!.amountTiins).toBe(BigInt(12_000_000));
    expect(result.invoiceId).toBe("inv-1");
    expect(result.number).toBe("INV-2026-0001");
  });

  it("stamps pendingPlanId on the subscription", async () => {
    await createUpgradeInvoice({
      clinicId: "clinic-1",
      fromPlanId: "plan-basic",
      toPlanId: "plan-pro",
    });
    expect(state.sub.pendingPlanId).toBe("plan-pro");
    // planId is NOT swapped yet — that happens on PAID.
    expect(state.sub.planId).toBe("plan-basic");
  });

  it("emits exactly one INVOICE_CREATED audit row", async () => {
    await createUpgradeInvoice({
      clinicId: "clinic-1",
      fromPlanId: "plan-basic",
      toPlanId: "plan-pro",
    });
    const created = state.audits.filter((a) => a.action === "INVOICE_CREATED");
    expect(created.length).toBe(1);
    expect(created[0]!.entityId).toBe("inv-1");
  });
});

describe("markInvoicePaid", () => {
  beforeEach(() => {
    state.invoices = [
      {
        id: "inv-1",
        clinicId: "clinic-1",
        number: "INV-2026-0001",
        status: "DRAFT",
        amountTiins: BigInt(12_000_000),
        targetPlanId: "plan-pro",
        paidAt: null,
        paymentRef: null,
      },
    ];
    state.audits = [];
    state.sub = {
      id: "sub-1",
      clinicId: "clinic-1",
      planId: "plan-basic",
      pendingPlanId: "plan-pro",
      status: "TRIAL",
    };
  });

  it("flips status to PAID, swaps planId, clears pendingPlanId", async () => {
    await markInvoicePaid("inv-1", "ref-001", {
      now: new Date("2026-05-08T00:00:00Z"),
    });

    const inv = state.invoices.find((i) => i.id === "inv-1")!;
    expect(inv.status).toBe("PAID");
    expect(inv.paymentRef).toBe("ref-001");
    expect(inv.paidAt).toBeInstanceOf(Date);

    expect(state.sub.planId).toBe("plan-pro");
    expect(state.sub.pendingPlanId).toBeNull();
    expect(state.sub.status).toBe("ACTIVE");
  });

  it("upgrades to the invoice's own plan, preserving a newer pending upgrade", async () => {
    // A second upgrade (to enterprise) was queued after this pro invoice.
    state.sub.pendingPlanId = "plan-enterprise";
    await markInvoicePaid("inv-1", "ref-001");

    // Paying the pro invoice grants pro — NOT the newer enterprise upgrade —
    // and leaves the enterprise upgrade pending so its invoice can still pay.
    expect(state.sub.planId).toBe("plan-pro");
    expect(state.sub.pendingPlanId).toBe("plan-enterprise");
  });

  it("rejects a payment whose amount doesn't match the invoice", async () => {
    await expect(
      markInvoicePaid("inv-1", "ref-bad", {
        expectedAmountTiins: BigInt(1),
      }),
    ).rejects.toThrow(/amount mismatch/);

    // Untouched — no flip, no plan swap.
    expect(state.invoices[0]!.status).toBe("DRAFT");
    expect(state.sub.planId).toBe("plan-basic");
  });

  it("emits exactly one INVOICE_PAID audit row", async () => {
    await markInvoicePaid("inv-1", "ref-001");
    const paid = state.audits.filter((a) => a.action === "INVOICE_PAID");
    expect(paid.length).toBe(1);
    expect(paid[0]!.entityId).toBe("inv-1");
  });

  it("is idempotent — second call is a no-op", async () => {
    await markInvoicePaid("inv-1", "ref-001");
    await markInvoicePaid("inv-1", "ref-002");
    const paid = state.audits.filter((a) => a.action === "INVOICE_PAID");
    expect(paid.length).toBe(1);
    // The first paymentRef wins.
    expect(state.invoices[0]!.paymentRef).toBe("ref-001");
  });

  it("leaves the plan unchanged for a non-upgrade invoice (no targetPlanId)", async () => {
    state.invoices[0]!.targetPlanId = null;
    state.sub.pendingPlanId = null;
    await markInvoicePaid("inv-1", "ref-no-plan");
    expect(state.sub.planId).toBe("plan-basic"); // unchanged
    expect(state.sub.pendingPlanId).toBeNull();
    expect(state.invoices[0]!.status).toBe("PAID");
  });
});
