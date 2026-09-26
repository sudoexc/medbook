import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Audit PT-08: the patient card's «Финансы» summed `priceFinal` over every
 * appointment (cancelled, no-show and next week's booking included) minus
 * only the payments filed under a visit, and «Оплаты», the call-center and
 * Telegram rails and the «должники» filter read `Patient.balance`, a column
 * nothing writes. The clinic records no payments in the CRM, so nearly every
 * patient read «Долг».
 *
 * One formula now: COMPLETED visits cost, every PAID payment counts (filed
 * under a visit or not, net of refunds), and a clinic that records no
 * payments shows no debt at all.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
}));
// The card animates figures from 0 in an effect; render the target.
vi.mock("@/components/atoms/count-up", () => ({
  useCountUp: (target: number) => target,
}));

import {
  balanceBucketOf,
  summarizePatientFinance,
  type PatientFinance,
} from "@/lib/patients/finance";
import {
  loadPatientFinance,
  patientBalanceIdWhere,
} from "@/server/patient/finance";
import { PatientFinanceCard } from "@/app/[locale]/crm/patients/[id]/_components/patient-finance-card";
import type { Patient } from "@/app/[locale]/crm/patients/[id]/_hooks/use-patient";

// ── pure formula ────────────────────────────────────────────────────────────

describe("summarizePatientFinance", () => {
  const FUTURE_AND_CANCELLED = [
    { status: "BOOKED", priceFinal: 30_000_000 },
    { status: "CONFIRMED", priceFinal: 30_000_000 },
    { status: "CANCELLED", priceFinal: 30_000_000 },
    { status: "NO_SHOW", priceFinal: 30_000_000 },
  ];

  it("a future booking and a cancelled visit cost nothing: no debt", () => {
    const f = summarizePatientFinance({
      visits: FUTURE_AND_CANCELLED,
      paidTiyin: 0,
      tracksPayments: true,
    });
    expect(f).toMatchObject({ visitsTotal: 0, completedVisits: 0, debt: 0, balance: 0 });
  });

  it("only COMPLETED visits are charged", () => {
    const f = summarizePatientFinance({
      visits: [...FUTURE_AND_CANCELLED, { status: "COMPLETED", priceFinal: 25_000_000 }],
      paidTiyin: 10_000_000,
      tracksPayments: true,
    });
    expect(f).toEqual({
      visitsTotal: 25_000_000,
      completedVisits: 1,
      paid: 10_000_000,
      tracksPayments: true,
      debt: 15_000_000,
      balance: -15_000_000,
    });
  });

  it("an overpayment is credit, not negative debt", () => {
    const f = summarizePatientFinance({
      visits: [{ status: "COMPLETED", priceFinal: 10_000_000 }],
      paidTiyin: 15_000_000,
      tracksPayments: true,
    });
    expect(f.debt).toBe(0);
    expect(f.balance).toBe(5_000_000);
    expect(balanceBucketOf(f.balance)).toBe("credit");
  });

  it("a clinic that records no payments shows the visits' cost and no debt", () => {
    const f = summarizePatientFinance({
      visits: [
        { status: "COMPLETED", priceFinal: 25_000_000 },
        { status: "COMPLETED", priceFinal: null },
        { status: "BOOKED", priceFinal: 25_000_000 },
      ],
      paidTiyin: 0,
      tracksPayments: false,
    });
    expect(f).toEqual({
      visitsTotal: 25_000_000,
      completedVisits: 2,
      paid: 0,
      tracksPayments: false,
      debt: null,
      balance: 0,
    });
    expect(balanceBucketOf(f.balance)).toBe("zero");
  });
});

// ── server loaders over a fake clinic ───────────────────────────────────────

type Appt = { id: string; clinicId: string; patientId: string; status: string; priceFinal: number | null };
type Pay = {
  clinicId: string;
  patientId: string | null;
  appointmentId: string | null;
  status: string;
  amount: number;
  refundedAmount: number;
  currency: "UZS" | "USD";
  fxRate: number | null;
};

type Where = Record<string, unknown>;

function fakeDb(appts: Appt[], pays: Pay[], rate: number | null = 12_600) {
  const apptById = new Map(appts.map((a) => [a.id, a]));
  const payOwner = (p: Pay) =>
    p.patientId ?? (p.appointmentId ? apptById.get(p.appointmentId)?.patientId ?? null : null);
  const payMatches = (p: Pay, where: Where) => {
    if (where.clinicId !== undefined && p.clinicId !== where.clinicId) return false;
    if (where.status !== undefined && p.status !== where.status) return false;
    const or = where.OR as Array<Where> | undefined;
    if (or) {
      const ok = or.some((c) => {
        if ("patientId" in c) return p.patientId === c.patientId;
        const rel = c.appointment as Where;
        const a = p.appointmentId ? apptById.get(p.appointmentId) : undefined;
        return a?.patientId === rel.patientId;
      });
      if (!ok) return false;
    }
    return true;
  };
  const apptMatches = (a: Appt, where: Where) =>
    (where.clinicId === undefined || a.clinicId === where.clinicId) &&
    (where.patientId === undefined || a.patientId === where.patientId) &&
    (where.status === undefined || a.status === where.status);
  const shape = (p: Pay) => ({
    ...p,
    appointment: p.appointmentId ? { patientId: payOwner({ ...p, patientId: null }) } : null,
  });
  const db = {
    appointment: {
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        appts.filter((a) => apptMatches(a, where)).map(({ status, priceFinal }) => ({ status, priceFinal })),
      ),
      groupBy: vi.fn(async ({ where }: { where: Where }) => {
        const sums = new Map<string, number>();
        for (const a of appts.filter((x) => apptMatches(x, where))) {
          sums.set(a.patientId, (sums.get(a.patientId) ?? 0) + (a.priceFinal ?? 0));
        }
        return [...sums].map(([patientId, s]) => ({ patientId, _sum: { priceFinal: s } }));
      }),
    },
    payment: {
      findFirst: vi.fn(async ({ where }: { where: Where }) =>
        pays.some((p) => payMatches(p, where)) ? { id: "any" } : null,
      ),
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        pays.filter((p) => payMatches(p, where)).map(shape),
      ),
    },
    exchangeRate: {
      findFirst: vi.fn(async () => (rate === null ? null : { rateUsd: rate })),
    },
  };
  return db;
}

const asDb = (db: ReturnType<typeof fakeDb>) => db as never;

const PAID = (over: Partial<Pay>): Pay => ({
  clinicId: "c1",
  patientId: null,
  appointmentId: null,
  status: "PAID",
  amount: 0,
  refundedAmount: 0,
  currency: "UZS",
  fxRate: null,
  ...over,
});

describe("loadPatientFinance", () => {
  const APPTS: Appt[] = [
    { id: "a-next-week", clinicId: "c1", patientId: "p1", status: "BOOKED", priceFinal: 30_000_000 },
    { id: "a-cancelled", clinicId: "c1", patientId: "p1", status: "CANCELLED", priceFinal: 30_000_000 },
  ];

  it("future + cancelled visits, no completed ones: debt 0 (PT-08 acceptance)", async () => {
    // The clinic does record payments (someone else's), so debt is computed.
    const db = fakeDb(APPTS, [PAID({ patientId: "p-other", amount: 1 })]);
    const f = await loadPatientFinance("c1", "p1", asDb(db));
    expect(f.tracksPayments).toBe(true);
    expect(f.debt).toBe(0);
    expect(f.balance).toBe(0);
  });

  it("a payment without a visit (a deposit) reduces the debt", async () => {
    const appts: Appt[] = [
      ...APPTS,
      { id: "a-done", clinicId: "c1", patientId: "p1", status: "COMPLETED", priceFinal: 25_000_000 },
    ];
    const before = await loadPatientFinance(
      "c1",
      "p1",
      asDb(fakeDb(appts, [PAID({ patientId: "p-other", amount: 1 })])),
    );
    expect(before.debt).toBe(25_000_000);

    const after = await loadPatientFinance(
      "c1",
      "p1",
      asDb(
        fakeDb(appts, [
          PAID({ patientId: "p1", appointmentId: null, amount: 10_000_000 }),
          // Filed under the visit only, no patientId on the row.
          PAID({ appointmentId: "a-done", amount: 5_000_000 }),
        ]),
      ),
    );
    expect(after.paid).toBe(15_000_000);
    expect(after.debt).toBe(10_000_000);
    expect(after.balance).toBe(-10_000_000);
  });

  it("nets refunds and converts USD at the payment's rate", async () => {
    const appts: Appt[] = [
      { id: "a-done", clinicId: "c1", patientId: "p1", status: "COMPLETED", priceFinal: 50_000_000 },
    ];
    const f = await loadPatientFinance(
      "c1",
      "p1",
      asDb(
        fakeDb(appts, [
          PAID({ patientId: "p1", amount: 20_000_000, refundedAmount: 5_000_000 }),
          // $10.00 at 12 600 сум: 126 000 сум = 12 600 000 тийин.
          PAID({ patientId: "p1", amount: 1_000, currency: "USD", fxRate: 12_600 }),
        ]),
      ),
    );
    expect(f.paid).toBe(15_000_000 + 12_600_000);
    expect(f.debt).toBe(50_000_000 - 27_600_000);
  });

  it("no payments recorded in this clinic: no debt, even if another clinic records them", async () => {
    const appts: Appt[] = [
      { id: "a-done", clinicId: "c1", patientId: "p1", status: "COMPLETED", priceFinal: 25_000_000 },
    ];
    const db = fakeDb(appts, [PAID({ clinicId: "c2", patientId: "p-elsewhere", amount: 1 })]);
    const f = await loadPatientFinance("c1", "p1", asDb(db));
    expect(f).toMatchObject({ visitsTotal: 25_000_000, tracksPayments: false, debt: null, balance: 0 });
    // The clinic is pinned on every query: the DSAR worker runs unscoped.
    for (const call of db.payment.findFirst.mock.calls) {
      expect(call[0].where.clinicId).toBe("c1");
    }
    for (const call of db.appointment.findMany.mock.calls) {
      expect(call[0].where.clinicId).toBe("c1");
    }
  });
});

describe("patientBalanceIdWhere («должники» filter)", () => {
  const APPTS: Appt[] = [
    // p1: next week's booking and a cancelled visit only.
    { id: "a1", clinicId: "c1", patientId: "p1", status: "BOOKED", priceFinal: 30_000_000 },
    { id: "a2", clinicId: "c1", patientId: "p1", status: "CANCELLED", priceFinal: 30_000_000 },
    // p2: a completed visit, unpaid.
    { id: "a3", clinicId: "c1", patientId: "p2", status: "COMPLETED", priceFinal: 25_000_000 },
    // p3: a completed visit, paid by a deposit without a visit.
    { id: "a4", clinicId: "c1", patientId: "p3", status: "COMPLETED", priceFinal: 25_000_000 },
    // p4: paid more than the visits cost.
    { id: "a5", clinicId: "c1", patientId: "p4", status: "COMPLETED", priceFinal: 10_000_000 },
  ];
  const PAYS: Pay[] = [
    PAID({ patientId: "p3", amount: 25_000_000 }),
    PAID({ appointmentId: "a5", amount: 15_000_000 }),
  ];

  it("lists as debtors only the patients who owe for completed visits", async () => {
    const where = await patientBalanceIdWhere("c1", "debt", asDb(fakeDb(APPTS, PAYS)));
    expect(where).toEqual({ in: ["p2"] });
  });

  it("puts overpayers under credit and everyone else under zero", async () => {
    const db = fakeDb(APPTS, PAYS);
    expect(await patientBalanceIdWhere("c1", "credit", asDb(db))).toEqual({ in: ["p4"] });
    const zero = await patientBalanceIdWhere("c1", "zero", asDb(db));
    expect(zero).toEqual({ notIn: expect.arrayContaining(["p2", "p4"]) });
    expect((zero as { notIn: string[] }).notIn).not.toContain("p1");
    expect((zero as { notIn: string[] }).notIn).not.toContain("p3");
  });

  it("a clinic that records no payments has no debtors", async () => {
    const db = fakeDb(APPTS, []);
    expect(await patientBalanceIdWhere("c1", "debt", asDb(db))).toEqual({ in: [] });
    expect(await patientBalanceIdWhere("c1", "credit", asDb(db))).toEqual({ in: [] });
    expect(await patientBalanceIdWhere("c1", "zero", asDb(db))).toBeNull();
  });
});

// ── the card ────────────────────────────────────────────────────────────────

function cardHtml(finance: PatientFinance): string {
  const patient = { id: "p1", ltv: 0, balance: finance.balance, finance } as unknown as Patient;
  return renderToStaticMarkup(
    React.createElement(PatientFinanceCard, { patient, appointments: [] }),
  );
}

describe("PatientFinanceCard", () => {
  it("without recorded payments: shows the visits' cost, no «Долг», no «Оплачено»", () => {
    const html = cardHtml(
      summarizePatientFinance({
        visits: [{ status: "COMPLETED", priceFinal: 25_000_000 }],
        paidTiyin: 0,
        tracksPayments: false,
      }),
    );
    expect(html).toContain("patientCard.finance.visitsTotal");
    expect(html).toMatch(/250\s000/);
    expect(html).toContain("patientCard.finance.paymentsNotTracked");
    expect(html).not.toContain("patientCard.finance.debt");
    expect(html).not.toContain("patientCard.finance.paid");
  });

  it("with recorded payments: shows what was paid and what is owed", () => {
    const html = cardHtml(
      summarizePatientFinance({
        visits: [{ status: "COMPLETED", priceFinal: 25_000_000 }],
        paidTiyin: 10_000_000,
        tracksPayments: true,
      }),
    );
    expect(html).toContain("patientCard.finance.paid");
    expect(html).toContain("patientCard.finance.debt");
    expect(html).toMatch(/150\s000/);
    expect(html).not.toContain("patientCard.finance.paymentsNotTracked");
  });
});
