/**
 * Audit AN-12 (invoice numbers unique per clinic, not globally) and AN-13
 * (Payme / Click webhooks that answered «ok» to everything and could never
 * complete a payment: now clearly not connected, fail safe, never marking an
 * invoice paid; Click's form body is read).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

type Inv = {
  id: string;
  clinicId: string;
  number: string;
  status: string;
  amountTiins: bigint;
  targetPlanId: string | null;
  dueAt: Date;
  periodEnd: Date;
  createdAt: Date;
};

const st = vi.hoisted(() => ({
  invoices: [] as Inv[],
  failNextCreate: 0,
  sub: null as null | Record<string, unknown>,
  subUpdates: [] as Array<Record<string, unknown>>,
  markPaid: [] as string[],
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    plan: {
      findUnique: vi.fn(async () => ({
        priceMonth: { toString: () => "1500000" },
        slug: "pro",
        currency: "UZS",
      })),
    },
    invoice: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          // The number lookup: highest number of this clinic's year series.
          const num = where.number as { startsWith?: string } | undefined;
          if (num?.startsWith) {
            const mine = st.invoices
              .filter((i) => i.clinicId === where.clinicId && i.number.startsWith(num.startsWith!))
              .sort((a, b) => (a.number < b.number ? 1 : -1));
            return mine[0] ? { number: mine[0].number } : null;
          }
          // The open-invoice lookup.
          const open = st.invoices.find(
            (i) =>
              i.clinicId === where.clinicId &&
              i.targetPlanId === where.targetPlanId &&
              (i.status === "DRAFT" || i.status === "ISSUED") &&
              i.dueAt > (where.dueAt as { gt: Date }).gt,
          );
          return open ? { id: open.id, number: open.number, amountTiins: open.amountTiins } : null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (st.failNextCreate > 0) {
          st.failNextCreate -= 1;
          throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        }
        // The new composite unique index.
        if (st.invoices.some((i) => i.clinicId === data.clinicId && i.number === data.number)) {
          throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        }
        const row: Inv = {
          id: `inv${st.invoices.length + 1}`,
          clinicId: data.clinicId as string,
          number: data.number as string,
          status: "DRAFT",
          amountTiins: data.amountTiins as bigint,
          targetPlanId: data.targetPlanId as string,
          dueAt: data.dueAt as Date,
          periodEnd: data.periodEnd as Date,
          createdAt: new Date(),
        };
        st.invoices.push(row);
        return { id: row.id, number: row.number, amountTiins: row.amountTiins };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const i = st.invoices.find((x) => x.id === where.id);
        return i ? { ...i } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const i = st.invoices.find((x) => x.id === where.id && x.status !== "PAID");
        if (!i) return { count: 0 };
        Object.assign(i, data);
        return { count: 1 };
      }),
    },
    subscription: {
      findUnique: vi.fn(async () => st.sub),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        st.subUpdates.push(data);
        st.sub = { ...st.sub, ...data };
        return st.sub;
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

import { createUpgradeInvoice, markInvoicePaid, paidPeriodEnd } from "@/server/billing/invoice";

beforeEach(() => {
  st.invoices = [];
  st.failNextCreate = 0;
  st.sub = { id: "s1", planId: "plan_basic", pendingPlanId: null, status: "PAST_DUE" };
  st.subUpdates = [];
  st.markPaid = [];
});

describe("AN-12: invoice numbers per clinic", () => {
  const now = new Date("2026-06-01T07:00:00Z");

  it("two clinics each issue their first invoice of the year without an error", async () => {
    const a = await createUpgradeInvoice({ clinicId: "c1", fromPlanId: "b", toPlanId: "pro", now });
    const b = await createUpgradeInvoice({ clinicId: "c2", fromPlanId: "b", toPlanId: "pro", now });
    expect(a.number).toBe("INV-2026-0001");
    expect(b.number).toBe("INV-2026-0001");
  });

  it("a number taken by a concurrent invoice is retried, not a 500", async () => {
    st.failNextCreate = 1;
    const a = await createUpgradeInvoice({ clinicId: "c1", fromPlanId: "b", toPlanId: "pro", now });
    expect(a.number).toBe("INV-2026-0001");
  });

  it("another click on the same upgrade hands back the open invoice", async () => {
    const a = await createUpgradeInvoice({ clinicId: "c1", fromPlanId: "b", toPlanId: "pro", now });
    const again = await createUpgradeInvoice({ clinicId: "c1", fromPlanId: "b", toPlanId: "pro", now });
    expect(again.invoiceId).toBe(a.invoiceId);
    expect(st.invoices).toHaveLength(1);
  });

  it("the year is the clinic's: 01:00 on 1 January in Tashkent is the new year", async () => {
    const r = await createUpgradeInvoice({
      clinicId: "c1",
      fromPlanId: "b",
      toPlanId: "pro",
      now: new Date("2026-12-31T20:00:00Z"),
    });
    expect(r.number).toBe("INV-2027-0001");
  });

  it("the database agrees: (clinicId, number) is the unique key", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model Invoice {"));
    const body = model.slice(0, model.indexOf("\n}"));
    expect(body).toContain("@@unique([clinicId, number])");
    expect(body).not.toMatch(/number\s+String\s+@unique/);
    const sql = read("prisma/migrations/20261001110000_payments_billing_platform/migration.sql");
    expect(sql).toContain('DROP INDEX "Invoice_number_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "Invoice_clinicId_number_key"');
  });
});

describe("G5-02: a paid invoice buys its period", () => {
  it("the subscription becomes ACTIVE until the period's end, grace cleared", async () => {
    const periodEnd = new Date("2026-07-01T00:00:00Z");
    st.invoices.push({
      id: "inv9",
      clinicId: "c1",
      number: "INV-2026-0009",
      status: "DRAFT",
      amountTiins: BigInt(150_000_000),
      targetPlanId: "plan_pro",
      dueAt: new Date("2026-06-08T00:00:00Z"),
      periodEnd,
      createdAt: new Date(),
    });
    await markInvoicePaid("inv9", "ref1", { now: new Date("2026-06-02T00:00:00Z") });
    expect(st.subUpdates[0]).toMatchObject({
      planId: "plan_pro",
      status: "ACTIVE",
      graceEndsAt: null,
      currentPeriodEndsAt: periodEnd,
    });
  });

  it("an invoice paid after its period still buys a full period from the payment", () => {
    const now = new Date("2026-08-01T00:00:00Z");
    expect(paidPeriodEnd(new Date("2026-07-01T00:00:00Z"), now)).toEqual(
      new Date("2026-08-31T00:00:00Z"),
    );
  });
});

// ── AN-13 ────────────────────────────────────────────────────────────────

vi.mock("@/server/billing/invoice", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    markInvoicePaid: vi.fn(async (id: string, ...rest: unknown[]) => {
      st.markPaid.push(id);
      return (real.markInvoicePaid as (...a: unknown[]) => Promise<void>)(id, ...rest);
    }),
  };
});

describe("AN-13: Payme webhook, not connected and fail safe", () => {
  const SECRET = "payme-secret";
  const auth = "Basic " + Buffer.from(`Paycom:${SECRET}`).toString("base64");
  const rpc = (method: string, params: Record<string, unknown>) =>
    JSON.stringify({ jsonrpc: "2.0", id: 7, method, params });

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("an authentic PerformTransaction is answered «not connected» and marks nothing paid", async () => {
    vi.stubEnv("PAYME_SECRET_KEY", SECRET);
    const { POST } = await import("@/app/api/webhooks/billing/payme/route");
    const res = await POST(
      new Request("https://x/api/webhooks/billing/payme", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: rpc("PerformTransaction", { id: "t1", account: { invoice_id: "inv1" } }),
      }),
    );
    expect(res.status).toBe(200); // Payme reads errors from HTTP 200 only
    const body = (await res.json()) as { id: number; error: { code: number; message: { ru: string } } };
    expect(body.id).toBe(7);
    expect(body.error.code).toBe(-32400);
    expect(body.error.message.ru).toContain("не подключён");
    expect(st.markPaid).toEqual([]);
  });

  it("without the secret, or with a wrong one, it is an auth error, never «ok»", async () => {
    const { POST } = await import("@/app/api/webhooks/billing/payme/route");
    const res = await POST(
      new Request("https://x/api/webhooks/billing/payme", {
        method: "POST",
        body: rpc("CheckPerformTransaction", { account: { invoice_id: "inv1" } }),
      }),
    );
    const body = (await res.json()) as { error: { code: number }; result?: unknown };
    expect(body.error.code).toBe(-32504);
    expect(body.result).toBeUndefined();
  });
});

describe("AN-13: Click webhook reads the form body and fails safe", () => {
  const SECRET = "click-secret";
  const form = (fields: Record<string, string>) =>
    new Request("https://x/api/webhooks/billing/click", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("a form-urlencoded Prepare is read and answered in Click's shape, with an error", async () => {
    const { POST } = await import("@/app/api/webhooks/billing/click/route");
    const res = await POST(
      form({
        click_trans_id: "555",
        service_id: "1",
        merchant_trans_id: "inv1",
        amount: "1500000",
        action: "0",
        sign_time: "2026-10-01 10:00:00",
        sign_string: "x",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.click_trans_id).toBe("555");
    expect(body.merchant_trans_id).toBe("inv1");
    expect(body.error).toBe(-8);
    expect(st.markPaid).toEqual([]);
  });

  it("a correctly signed Complete is still not a payment: nothing is marked paid", async () => {
    vi.stubEnv("CLICK_SECRET_KEY", SECRET);
    const fields = {
      click_trans_id: "555",
      service_id: "1",
      merchant_trans_id: "inv1",
      merchant_prepare_id: "9",
      amount: "1500000",
      action: "1",
      sign_time: "2026-10-01 10:00:00",
    };
    const sign = createHash("md5")
      .update(`555${"1"}${SECRET}inv19${"1500000"}1${fields.sign_time}`)
      .digest("hex");
    const { POST } = await import("@/app/api/webhooks/billing/click/route");
    const res = await POST(form({ ...fields, sign_string: sign }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe(-8);
    expect(st.markPaid).toEqual([]);
  });

  it("a wrong signature is SIGN CHECK FAILED", async () => {
    vi.stubEnv("CLICK_SECRET_KEY", SECRET);
    const { POST } = await import("@/app/api/webhooks/billing/click/route");
    const res = await POST(
      form({ click_trans_id: "1", merchant_trans_id: "inv1", action: "1", sign_string: "bad" }),
    );
    expect(((await res.json()) as { error: number }).error).toBe(-1);
  });

  it("Complete signs merchant_prepare_id, Prepare does not (Click's recipe)", async () => {
    const { computeClickSignature } = await import("@/server/billing/payments/click");
    const base = {
      click_trans_id: "1",
      service_id: "2",
      merchant_trans_id: "inv",
      amount: "100",
      sign_time: "t",
      merchant_prepare_id: "77",
    };
    const md5 = (s: string) => createHash("md5").update(s).digest("hex");
    expect(computeClickSignature({ ...base, action: "1" }, "S")).toBe(md5("12Sinv771001t"));
    expect(computeClickSignature({ ...base, action: "0" }, "S")).toBe(md5("12Sinv1000t"));
  });
});

describe("AN-13: no checkout that cannot complete", () => {
  it("both providers are reported not connected", async () => {
    const { isOnlinePaymentConnected } = await import(
      "@/server/billing/payments/online-payments"
    );
    expect(isOnlinePaymentConnected("click")).toBe(false);
    expect(isOnlinePaymentConnected("payme")).toBe(false);
  });

  it("the charge route refuses and the pay page shows a note instead of buttons", () => {
    const charge = read("src/app/api/crm/billing/invoices/[id]/charge/route.ts");
    expect(charge).toContain('err("OnlinePaymentNotConnected", 503');
    const page = read(
      "src/app/[locale]/crm/settings/billing/pay/[id]/_components/pay-stub-client.tsx",
    );
    expect(page).toContain('t("pay.onlineNotConnected")');
    expect(page).toContain("props.onlineProviders.click ?");
  });
});
