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
 * under a visit or not, net of refunds), and a clinic that has not turned on
 * «Учёт оплат в CRM» shows no debt at all. Payments never switch it on (one
 * payment entered in the drawer used to), and visits before the moment an
 * admin turned it on are not charged.
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
  isBilledVisit,
  isOwedVisit,
  summarizePatientFinance,
  type PatientFinance,
} from "@/lib/patients/finance";
import {
  billedVisitWhere,
  loadPatientFinance,
  patientBalanceIdWhere,
} from "@/server/patient/finance";
import { PatientFinanceCard } from "@/app/[locale]/crm/patients/[id]/_components/patient-finance-card";
import type { Patient } from "@/app/[locale]/crm/patients/[id]/_hooks/use-patient";

// ── pure formula ────────────────────────────────────────────────────────────

/** Long before any visit below: the clinic recorded payments all along. */
const EARLY = new Date("2026-01-01T05:00:00Z");
/** A visit day after EARLY. */
const LATER = new Date("2026-09-20T06:00:00Z");

describe("summarizePatientFinance", () => {
  const FUTURE_AND_CANCELLED = [
    { status: "BOOKED", priceFinal: 30_000_000, date: LATER },
    { status: "CONFIRMED", priceFinal: 30_000_000, date: LATER },
    { status: "CANCELLED", priceFinal: 30_000_000, date: LATER },
    { status: "NO_SHOW", priceFinal: 30_000_000, date: LATER },
  ];

  it("a future booking and a cancelled visit cost nothing: no debt", () => {
    const f = summarizePatientFinance({
      visits: FUTURE_AND_CANCELLED,
      paidTiyin: 0,
      billingSince: EARLY,
    });
    expect(f).toMatchObject({ visitsTotal: 0, completedVisits: 0, debt: 0, balance: 0 });
  });

  it("only COMPLETED visits are charged", () => {
    const f = summarizePatientFinance({
      visits: [
        ...FUTURE_AND_CANCELLED,
        { status: "COMPLETED", priceFinal: 25_000_000, date: LATER, completedAt: LATER },
      ],
      paidTiyin: 10_000_000,
      billingSince: EARLY,
    });
    expect(f).toEqual({
      visitsTotal: 25_000_000,
      completedVisits: 1,
      unbilledVisits: 0,
      paid: 10_000_000,
      tracksPayments: true,
      billingSince: EARLY.toISOString(),
      debt: 15_000_000,
      balance: -15_000_000,
    });
  });

  it("an overpayment is credit, not negative debt", () => {
    const f = summarizePatientFinance({
      visits: [{ status: "COMPLETED", priceFinal: 10_000_000, date: LATER }],
      paidTiyin: 15_000_000,
      billingSince: EARLY,
    });
    expect(f.debt).toBe(0);
    expect(f.balance).toBe(5_000_000);
    expect(balanceBucketOf(f.balance)).toBe("credit");
  });

  it("a clinic that records no payments shows the visits' cost and no debt", () => {
    const f = summarizePatientFinance({
      visits: [
        { status: "COMPLETED", priceFinal: 25_000_000, date: LATER },
        { status: "COMPLETED", priceFinal: null, date: LATER },
        { status: "BOOKED", priceFinal: 25_000_000, date: LATER },
      ],
      paidTiyin: 0,
      billingSince: null,
    });
    expect(f).toEqual({
      visitsTotal: 25_000_000,
      completedVisits: 2,
      unbilledVisits: 0,
      paid: 0,
      tracksPayments: false,
      billingSince: null,
      debt: null,
      balance: 0,
    });
    expect(balanceBucketOf(f.balance)).toBe("zero");
  });

  it("visits completed before the first recorded payment are not charged", () => {
    const since = new Date("2026-10-05T09:00:00Z");
    const f = summarizePatientFinance({
      visits: [
        // Paid at the till before the clinic started entering payments.
        { status: "COMPLETED", priceFinal: 25_000_000, date: LATER, completedAt: LATER },
        // Completed after: charged.
        {
          status: "COMPLETED",
          priceFinal: 20_000_000,
          date: new Date("2026-10-06T06:00:00Z"),
          completedAt: new Date("2026-10-06T06:30:00Z"),
        },
      ],
      paidTiyin: 0,
      billingSince: since,
    });
    expect(f).toMatchObject({
      visitsTotal: 20_000_000,
      completedVisits: 1,
      unbilledVisits: 1,
      tracksPayments: true,
      billingSince: since.toISOString(),
      debt: 20_000_000,
      balance: -20_000_000,
    });
  });
});

describe("isBilledVisit", () => {
  const since = new Date("2026-10-05T09:00:00Z");
  const before = new Date("2026-10-05T08:59:59Z");

  it("never bills anything while payments are not recorded", () => {
    expect(
      isBilledVisit({ status: "COMPLETED", priceFinal: 1, date: LATER, hasPaidPayment: true }, null),
    ).toBe(false);
  });

  it("bills from the first recorded payment on, by completion time", () => {
    const v = { status: "COMPLETED", priceFinal: 1, date: before };
    expect(isBilledVisit({ ...v, completedAt: before }, since)).toBe(false);
    expect(isBilledVisit({ ...v, completedAt: since }, since)).toBe(true);
    // No completion time on an older row: the visit's start counts.
    expect(isBilledVisit({ ...v, completedAt: null }, since)).toBe(false);
    expect(isBilledVisit({ ...v, completedAt: null, date: since }, since.toISOString())).toBe(true);
  });

  it("bills an earlier visit that has a payment filed under it", () => {
    expect(
      isBilledVisit(
        { status: "COMPLETED", priceFinal: 1, date: before, completedAt: before, hasPaidPayment: true },
        since,
      ),
    ).toBe(true);
  });

  it("never bills a visit that is not COMPLETED", () => {
    expect(
      isBilledVisit({ status: "BOOKED", priceFinal: 1, date: since, hasPaidPayment: true }, since),
    ).toBe(false);
  });
});

describe("isOwedVisit («Долг» in the «Визиты» tab)", () => {
  const since = new Date("2026-10-05T09:00:00Z");
  const done = (completedAt: Date, hasPaidPayment = false) => ({
    status: "COMPLETED",
    priceFinal: 25_000_000,
    date: completedAt,
    completedAt,
    hasPaidPayment,
  });

  it("a completed visit before the first recorded payment is not «Долг»", () => {
    expect(isOwedVisit(done(new Date("2026-10-04T06:00:00Z")), since)).toBe(false);
  });

  it("an unpaid completed visit after it is; a paid one is not", () => {
    const after = new Date("2026-10-06T06:00:00Z");
    expect(isOwedVisit(done(after), since)).toBe(true);
    expect(isOwedVisit(done(after, true), since)).toBe(false);
  });

  it("nothing is «Долг» while payments are not recorded", () => {
    expect(isOwedVisit(done(new Date("2026-10-06T06:00:00Z")), null)).toBe(false);
  });
});

// ── server loaders over a fake clinic ───────────────────────────────────────

type Appt = {
  id: string;
  clinicId: string;
  patientId: string;
  status: string;
  priceFinal: number | null;
  date: Date;
  completedAt: Date | null;
};
type Pay = {
  id: string;
  clinicId: string;
  patientId: string | null;
  appointmentId: string | null;
  status: string;
  amount: number;
  refundedAmount: number;
  currency: "UZS" | "USD";
  fxRate: number | null;
  externalRef: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
};
type PatientRow = { id: string; tags: string[] };

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
const cmp = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));

/**
 * A small Prisma `where` interpreter, so the tests run the loaders' real
 * filters instead of a hand-written copy of them. A comparison with a NULL
 * column is false, as in SQL.
 */
function evalWhere(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Where[]).every((w) => evalWhere(row, w));
    if (key === "OR") return (cond as Where[]).some((w) => evalWhere(row, w));
    if (key === "NOT") return !evalWhere(row, cond as Where);
    const v = row[key];
    if (cond === null) return v === null || v === undefined;
    if (!isPlainObject(cond)) return v === cond;
    if ("some" in cond) {
      return Array.isArray(v) && v.some((x) => evalWhere(x as Row, cond.some as Where));
    }
    if (isPlainObject(v)) return evalWhere(v, cond);
    if (v === null || v === undefined) return false;
    return Object.entries(cond).every(([op, x]) => {
      switch (op) {
        case "equals":
          return v === x;
        case "not":
          return v !== x;
        case "gte":
          return cmp(v) >= cmp(x);
        case "gt":
          return cmp(v) > cmp(x);
        case "lte":
          return cmp(v) <= cmp(x);
        case "lt":
          return cmp(v) < cmp(x);
        case "in":
          return (x as unknown[]).includes(v);
        case "startsWith":
          return String(v).startsWith(String(x));
        case "has":
          return Array.isArray(v) && v.includes(x);
        default:
          throw new Error(`fake db: unsupported filter ${op}`);
      }
    });
  });
}

type Select = Record<string, true | { select?: Select; where?: Where; take?: number }>;

function project(row: Row, select: Select | undefined): Row {
  if (!select) return row;
  const out: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    const v = row[key];
    if (spec === true) out[key] = v;
    else if (Array.isArray(v)) {
      let list = v.filter((x) => evalWhere(x as Row, spec.where));
      if (spec.take !== undefined) list = list.slice(0, spec.take);
      out[key] = list.map((x) => project(x as Row, spec.select));
    } else out[key] = isPlainObject(v) ? project(v, spec.select) : null;
  }
  return out;
}

function fakeDb(
  appts: Appt[],
  pays: Pay[],
  patients: PatientRow[] = [],
  rate: number | null = 12_600,
  /** c1's «Учёт оплат в CRM» moment; null: off. c2 always tracks. */
  trackedSince: Date | null = EARLY,
) {
  const clinics: Record<string, Date | null> = { c1: trackedSince, c2: EARLY };
  const apptRow = (a: Appt): Row => ({
    ...a,
    payments: pays.filter((p) => p.appointmentId === a.id),
  });
  const payRow = (p: Pay): Row => {
    const a = p.appointmentId ? appts.find((x) => x.id === p.appointmentId) : undefined;
    const patient = p.patientId ? patients.find((x) => x.id === p.patientId) : undefined;
    return {
      ...p,
      appointment: a ? { ...a } : null,
      // A payment on a card the fixture does not list is a real patient's.
      patient: patient ?? (p.patientId ? { id: p.patientId, tags: [] } : null),
    };
  };
  type Args = {
    where?: Where;
    select?: Select;
    orderBy?: Record<string, "asc" | "desc">;
  };
  const sortBy = (rows: Row[], orderBy: Args["orderBy"]) => {
    if (!orderBy) return rows;
    const [[field, dir]] = Object.entries(orderBy);
    return [...rows].sort((x, y) => (cmp(x[field]) - cmp(y[field])) * (dir === "asc" ? 1 : -1));
  };
  const db = {
    appointment: {
      findMany: vi.fn(async ({ where, select }: Args) =>
        appts.map(apptRow).filter((r) => evalWhere(r, where)).map((r) => project(r, select)),
      ),
      groupBy: vi.fn(async ({ where }: Args) => {
        const sums = new Map<string, number>();
        for (const r of appts.map(apptRow).filter((x) => evalWhere(x, where))) {
          const id = r.patientId as string;
          sums.set(id, (sums.get(id) ?? 0) + ((r.priceFinal as number | null) ?? 0));
        }
        return [...sums].map(([patientId, s]) => ({ patientId, _sum: { priceFinal: s } }));
      }),
    },
    payment: {
      findFirst: vi.fn(async ({ where, select, orderBy }: Args) => {
        const hit = sortBy(pays.map(payRow).filter((r) => evalWhere(r, where)), orderBy)[0];
        return hit ? project(hit, select) : null;
      }),
      findMany: vi.fn(async ({ where, select }: Args) =>
        pays.map(payRow).filter((r) => evalWhere(r, where)).map((r) => project(r, select)),
      ),
    },
    exchangeRate: {
      findFirst: vi.fn(async () => (rate === null ? null : { rateUsd: rate })),
    },
    clinic: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id in clinics ? { paymentsTrackedSince: clinics[where.id] } : null,
      ),
    },
  };
  return db;
}

const asDb = (db: ReturnType<typeof fakeDb>) => db as never;

let payIds = 0;
const PAID = (over: Partial<Pay>): Pay => ({
  id: `pay-${++payIds}`,
  clinicId: "c1",
  patientId: null,
  appointmentId: null,
  status: "PAID",
  amount: 0,
  refundedAmount: 0,
  currency: "UZS",
  fxRate: null,
  externalRef: null,
  idempotencyKey: null,
  createdAt: EARLY,
  ...over,
});

const APPT = (over: Partial<Appt> & Pick<Appt, "id" | "patientId" | "status">): Appt => ({
  clinicId: "c1",
  priceFinal: 25_000_000,
  date: LATER,
  completedAt: over.status === "COMPLETED" ? LATER : null,
  ...over,
});

describe("loadPatientFinance", () => {
  const APPTS: Appt[] = [
    APPT({ id: "a-next-week", patientId: "p1", status: "BOOKED", priceFinal: 30_000_000 }),
    APPT({ id: "a-cancelled", patientId: "p1", status: "CANCELLED", priceFinal: 30_000_000 }),
  ];

  it("future + cancelled visits, no completed ones: debt 0 (PT-08 acceptance)", async () => {
    // The clinic tracks payments (the fake's default), so debt is computed.
    const db = fakeDb(APPTS, [PAID({ patientId: "p-other", amount: 1 })]);
    const f = await loadPatientFinance("c1", "p1", asDb(db));
    expect(f.tracksPayments).toBe(true);
    expect(f.debt).toBe(0);
    expect(f.balance).toBe(0);
  });

  it("a payment without a visit (a deposit) reduces the debt", async () => {
    const appts: Appt[] = [
      ...APPTS,
      APPT({ id: "a-done", patientId: "p1", status: "COMPLETED", priceFinal: 25_000_000 }),
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
      APPT({ id: "a-done", patientId: "p1", status: "COMPLETED", priceFinal: 50_000_000 }),
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

  it("payments not tracked in this clinic: no debt, even if another clinic tracks them", async () => {
    const appts: Appt[] = [
      APPT({ id: "a-done", patientId: "p1", status: "COMPLETED", priceFinal: 25_000_000 }),
    ];
    const db = fakeDb(
      appts,
      [PAID({ clinicId: "c2", patientId: "p-elsewhere", amount: 1 })],
      [],
      12_600,
      null,
    );
    const f = await loadPatientFinance("c1", "p1", asDb(db));
    expect(f).toMatchObject({ visitsTotal: 25_000_000, tracksPayments: false, debt: null, balance: 0 });
    // The clinic is pinned on every query: the DSAR worker runs unscoped.
    expect(db.clinic.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" } }),
    );
    for (const call of db.appointment.findMany.mock.calls) {
      expect(call[0].where?.clinicId).toBe("c1");
    }
  });
});

// Final review of PT-08: «does this clinic record payments» was inferred
// from its first real PAID payment. The clinic takes money at the till, so
// one card payment a receptionist entered in the visit drawer turned every
// walk-in completed after it into «Долг» on the card, in «Должники» and on
// the call-center and Telegram rails; recording only some payments did the
// same to everyone else. Now only the admin's switch turns it on.
describe("the billing start is the clinic's switch, never a payment", () => {
  const DEMO_PATIENT: PatientRow = { id: "p-demo", tags: ["demo-seed"] };
  const REAL_VISIT = APPT({ id: "a-real", patientId: "p-real", status: "COMPLETED" });
  const DEMO_VISIT = APPT({ id: "a-demo", patientId: "p-demo", status: "COMPLETED" });
  const CARD_VISIT = APPT({ id: "a-card", patientId: "p-card", status: "COMPLETED" });

  const PAYMENTS_WITH_SWITCH_OFF: Array<[string, Pay[]]> = [
    [
      "one real card payment entered in the drawer, before the walk-in",
      [PAID({ patientId: "p-card", appointmentId: "a-card", amount: 25_000_000, createdAt: EARLY })],
    ],
    [
      "the demo seed's payment",
      [
        PAID({
          patientId: "p-demo",
          appointmentId: "a-demo",
          amount: 25_000_000,
          externalRef: "demo-seed",
          idempotencyKey: "demo-seed:a-demo",
        }),
      ],
    ],
    [
      "a deposit taken on a card's «Оплаты» tab",
      [PAID({ patientId: "p-card", amount: 10_000_000 })],
    ],
  ];

  it.each(PAYMENTS_WITH_SWITCH_OFF)("%s: no debt anywhere while the switch is off", async (_, pays) => {
    const db = fakeDb([REAL_VISIT, DEMO_VISIT, CARD_VISIT], pays, [DEMO_PATIENT], 12_600, null);
    const f = await loadPatientFinance("c1", "p-real", asDb(db));
    expect(f).toMatchObject({ tracksPayments: false, billingSince: null, debt: null, balance: 0 });
    expect(await patientBalanceIdWhere("c1", "debt", asDb(db))).toEqual({ in: [] });
    expect(await patientBalanceIdWhere("c1", "credit", asDb(db))).toEqual({ in: [] });
    expect(await patientBalanceIdWhere("c1", "zero", asDb(db))).toBeNull();
    // No payment is even read to decide it.
    expect(db.payment.findFirst).not.toHaveBeenCalled();
  });

  // The admin turned the switch on at 14:00 Tashkent on 5 Oct.
  const FIRST = new Date("2026-10-05T09:00:00Z");
  const H = 3600_000;
  const at = (ms: number) => new Date(FIRST.getTime() + ms);
  const CLINIC_APPTS: Appt[] = [
    // Paid at the till the day before, never entered.
    APPT({ id: "b-1", patientId: "p1", status: "COMPLETED", date: at(-25 * H), completedAt: at(-24 * H) }),
    // Completed after the switch, nothing entered: owes.
    APPT({ id: "b-2", patientId: "p2", status: "COMPLETED", date: at(1 * H), completedAt: at(2 * H) }),
    // Completed before the switch, its payment entered right after.
    APPT({ id: "b-3", patientId: "p3", status: "COMPLETED", date: at(-1 * H), completedAt: at(-H / 3) }),
    // Older row without a completion time, started after: owes.
    APPT({ id: "b-4", patientId: "p4", status: "COMPLETED", date: at(3 * H), completedAt: null }),
    // Demo patient, seeded long before: settled by its payment.
    APPT({ id: "b-5", patientId: "p-demo", status: "COMPLETED", date: at(-240 * H), completedAt: at(-240 * H) }),
  ];
  const CLINIC_PAYS: Pay[] = [
    PAID({
      patientId: "p-demo",
      appointmentId: "b-5",
      amount: 25_000_000,
      externalRef: "demo-seed",
      idempotencyKey: "demo-seed:b-5",
      createdAt: at(-240 * H),
    }),
    PAID({ patientId: "p3", appointmentId: "b-3", amount: 25_000_000, createdAt: FIRST }),
  ];
  const clinic = () => fakeDb(CLINIC_APPTS, CLINIC_PAYS, [DEMO_PATIENT], 12_600, FIRST);

  it("bills only from the moment the switch was turned on", async () => {
    const p1 = await loadPatientFinance("c1", "p1", asDb(clinic()));
    expect(p1).toMatchObject({
      tracksPayments: true,
      billingSince: FIRST.toISOString(),
      visitsTotal: 0,
      completedVisits: 0,
      unbilledVisits: 1,
      debt: 0,
      balance: 0,
    });
    const p2 = await loadPatientFinance("c1", "p2", asDb(clinic()));
    expect(p2).toMatchObject({ debt: 25_000_000, balance: -25_000_000, unbilledVisits: 0 });
    const p4 = await loadPatientFinance("c1", "p4", asDb(clinic()));
    expect(p4.debt).toBe(25_000_000);
  });

  it("a visit with a payment filed under it is settled, not read as credit", async () => {
    const p3 = await loadPatientFinance("c1", "p3", asDb(clinic()));
    expect(p3).toMatchObject({ visitsTotal: 25_000_000, paid: 25_000_000, debt: 0, balance: 0 });
    const demo = await loadPatientFinance("c1", "p-demo", asDb(clinic()));
    expect(demo).toMatchObject({ debt: 0, balance: 0 });
  });

  it("the «должники» filter agrees with the card", async () => {
    const debt = await patientBalanceIdWhere("c1", "debt", asDb(clinic()));
    expect((debt as { in: string[] }).in.sort()).toEqual(["p2", "p4"]);
    expect(await patientBalanceIdWhere("c1", "credit", asDb(clinic()))).toEqual({ in: [] });
  });

  it("billedVisitWhere is isBilledVisit as a Prisma filter", () => {
    const where = billedVisitWhere(FIRST);
    for (const a of CLINIC_APPTS) {
      const hasPaidPayment = CLINIC_PAYS.some((p) => p.appointmentId === a.id && p.status === "PAID");
      const row = { ...a, payments: CLINIC_PAYS.filter((p) => p.appointmentId === a.id) };
      expect(evalWhere(row, where), a.id).toBe(isBilledVisit({ ...a, hasPaidPayment }, FIRST));
    }
  });
});

describe("patientBalanceIdWhere («должники» filter)", () => {
  const APPTS: Appt[] = [
    // p1: next week's booking and a cancelled visit only.
    APPT({ id: "a1", patientId: "p1", status: "BOOKED", priceFinal: 30_000_000 }),
    APPT({ id: "a2", patientId: "p1", status: "CANCELLED", priceFinal: 30_000_000 }),
    // p2: a completed visit, unpaid.
    APPT({ id: "a3", patientId: "p2", status: "COMPLETED", priceFinal: 25_000_000 }),
    // p3: a completed visit, paid by a deposit without a visit.
    APPT({ id: "a4", patientId: "p3", status: "COMPLETED", priceFinal: 25_000_000 }),
    // p4: paid more than the visits cost.
    APPT({ id: "a5", patientId: "p4", status: "COMPLETED", priceFinal: 10_000_000 }),
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

  it("a clinic that does not track payments has no debtors, whatever was entered", async () => {
    const db = fakeDb(APPTS, PAYS, [], 12_600, null);
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
        visits: [{ status: "COMPLETED", priceFinal: 25_000_000, date: LATER }],
        paidTiyin: 0,
        billingSince: null,
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
        visits: [{ status: "COMPLETED", priceFinal: 25_000_000, date: LATER }],
        paidTiyin: 10_000_000,
        billingSince: EARLY,
      }),
    );
    expect(html).toContain("patientCard.finance.paid");
    expect(html).toContain("patientCard.finance.debt");
    expect(html).toMatch(/150\s000/);
    expect(html).not.toContain("patientCard.finance.paymentsNotTracked");
    expect(html).not.toContain("patientCard.finance.billingSinceHint");
  });

  it("says when visits before the switch was turned on are left out", () => {
    const since = new Date("2026-10-05T09:00:00Z");
    const html = cardHtml(
      summarizePatientFinance({
        visits: [{ status: "COMPLETED", priceFinal: 25_000_000, date: LATER, completedAt: LATER }],
        paidTiyin: 0,
        billingSince: since,
      }),
    );
    expect(html).toContain("patientCard.finance.billingSinceHint");
    expect(html).toContain("05.10.2026");
    expect(html).not.toContain("patientCard.finance.paymentsNotTracked");
  });
});
