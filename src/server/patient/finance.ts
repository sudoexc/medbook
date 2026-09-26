/**
 * Loads a patient's money on the one formula of `src/lib/patients/finance.ts`
 * (audit PT-08): COMPLETED visits cost, every PAID payment counts (filed
 * under a visit or not, net of refunds, USD converted like LTV), and a
 * clinic that records no payments shows no debt. Once it records them, only
 * visits from its first real payment on are charged.
 *
 * `Patient.balance` is never written by the app, so every reader (the card,
 * «Оплаты», the call-center and Telegram rails, the stats endpoint, the
 * «должники» filter, the DSAR export) goes through here instead.
 *
 * Every query pins `clinicId` explicitly: the DSAR worker runs under the
 * SYSTEM context, where the Prisma extension injects nothing, and «does the
 * clinic record payments» must never look at another clinic's rows.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DEMO_SEED_MARK } from "@/lib/demo-seed";
import {
  BILLABLE_VISIT_STATUS,
  balanceBucketOf,
  summarizePatientFinance,
  type BalanceBucket,
  type PatientFinance,
} from "@/lib/patients/finance";
import { computeLtv } from "@/server/services/ltv-compute";

type Db = typeof prisma;

type PaidRow = {
  amount: number;
  refundedAmount: number;
  currency: string;
  fxRate: unknown;
};

/** PAID payments net of refunds, in тийин, on the LTV conversion. */
function paidTiyinOf(rows: PaidRow[], latestRate: unknown): number {
  return computeLtv(
    rows.map((p) => ({
      amount: Math.max(0, p.amount - (p.refundedAmount ?? 0)),
      currency: p.currency,
      fxRate: p.fxRate,
    })),
    latestRate,
  );
}

/**
 * Payments that show the clinic records money in the CRM. Not the demo
 * seed's rows (scripts/seed-prod-demo.ts is meant to run on the live
 * database, audit G2-01) nor a payment on a demo patient's card (staff
 * trying the «Оплаты» tab): one such row used to switch the whole clinic to
 * «records payments» and every real walk-in paid at the till into debt.
 *
 * Every arm keeps an explicit NULL branch: a negated condition on a NULL
 * column is NULL in SQL, which would drop every ordinary payment.
 */
const REAL_PAYMENT_WHERE = {
  AND: [
    { OR: [{ externalRef: null }, { externalRef: { not: DEMO_SEED_MARK } }] },
    {
      OR: [
        { idempotencyKey: null },
        { NOT: { idempotencyKey: { startsWith: `${DEMO_SEED_MARK}:` } } },
      ],
    },
    {
      OR: [
        { patientId: null },
        { NOT: { patient: { tags: { has: DEMO_SEED_MARK } } } },
      ],
    },
  ],
} satisfies Prisma.PaymentWhereInput;

/**
 * When the clinic entered its first real PAID payment in the CRM, or null
 * when it records none. `createdAt`, not `paidAt`: the payment form accepts
 * a backdated `paidAt`, and the question is when the front desk started
 * entering money here.
 */
export async function paymentsRecordedSince(
  clinicId: string,
  db: Db = prisma,
): Promise<Date | null> {
  const first = await db.payment.findFirst({
    where: { clinicId, status: "PAID", ...REAL_PAYMENT_WHERE },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return first?.createdAt ?? null;
}

/**
 * `isBilledVisit` of `src/lib/patients/finance.ts` as a Prisma filter, for
 * the list's grouped query: COMPLETED, and either a PAID payment is filed
 * under the visit or it was completed (older rows: started) at or after
 * `since`.
 */
export function billedVisitWhere(since: Date) {
  return {
    status: BILLABLE_VISIT_STATUS,
    OR: [
      { payments: { some: { status: "PAID" } } },
      { completedAt: { gte: since } },
      { completedAt: null, date: { gte: since } },
    ],
  } satisfies Prisma.AppointmentWhereInput;
}

async function latestUsdRate(clinicId: string, db: Db): Promise<unknown> {
  const row = await db.exchangeRate.findFirst({
    where: { clinicId },
    orderBy: { date: "desc" },
    select: { rateUsd: true },
  });
  return row?.rateUsd ?? null;
}

export async function loadPatientFinance(
  clinicId: string,
  patientId: string,
  db: Db = prisma,
): Promise<PatientFinance> {
  const [rows, since] = await Promise.all([
    db.appointment.findMany({
      where: { clinicId, patientId, status: BILLABLE_VISIT_STATUS },
      select: {
        status: true,
        priceFinal: true,
        completedAt: true,
        date: true,
        payments: {
          where: { status: "PAID" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    paymentsRecordedSince(clinicId, db),
  ]);
  const visits = rows.map(({ payments, ...v }) => ({
    ...v,
    hasPaidPayment: payments.length > 0,
  }));
  if (!since) {
    return summarizePatientFinance({ visits, paidTiyin: 0, billingSince: null });
  }
  const [payments, rate] = await Promise.all([
    db.payment.findMany({
      where: {
        clinicId,
        status: "PAID",
        // A deposit taken on the «Оплаты» tab has no visit; a payment taken
        // in the visit drawer may carry only the visit. Both are the
        // patient's money. Demo payments count too: each one settles the
        // seeded visit it is filed under, so it moves no balance.
        OR: [{ patientId }, { appointment: { patientId } }],
      },
      select: {
        amount: true,
        refundedAmount: true,
        currency: true,
        fxRate: true,
      },
    }),
    latestUsdRate(clinicId, db),
  ]);
  return summarizePatientFinance({
    visits,
    paidTiyin: paidTiyinOf(payments, rate),
    billingSince: since,
  });
}

/**
 * The `id` condition for the patients list's `?balance=` filter, or null
 * for «no condition». Balances are computed for the whole clinic at once
 * (one grouped query over billed visits, one over PAID payments): the
 * clinic has a few thousand cards and very few payments.
 */
export async function patientBalanceIdWhere(
  clinicId: string,
  bucket: BalanceBucket,
  db: Db = prisma,
): Promise<{ in: string[] } | { notIn: string[] } | null> {
  const since = await paymentsRecordedSince(clinicId, db);
  if (!since) {
    // Nothing recorded: everyone's balance is 0, nobody is a debtor.
    return bucket === "zero" ? null : { in: [] };
  }
  const [billed, payments, rate] = await Promise.all([
    db.appointment.groupBy({
      by: ["patientId"],
      where: { clinicId, ...billedVisitWhere(since) },
      _sum: { priceFinal: true },
    }),
    db.payment.findMany({
      where: { clinicId, status: "PAID" },
      select: {
        patientId: true,
        amount: true,
        refundedAmount: true,
        currency: true,
        fxRate: true,
        appointment: { select: { patientId: true } },
      },
    }),
    latestUsdRate(clinicId, db),
  ]);

  const balance = new Map<string, number>();
  for (const row of billed) {
    balance.set(row.patientId, -(row._sum.priceFinal ?? 0));
  }
  for (const p of payments) {
    const owner = p.patientId ?? p.appointment?.patientId ?? null;
    if (!owner) continue;
    balance.set(owner, (balance.get(owner) ?? 0) + paidTiyinOf([p], rate));
  }

  const debt: string[] = [];
  const credit: string[] = [];
  for (const [id, b] of balance) {
    const kind = balanceBucketOf(b);
    if (kind === "debt") debt.push(id);
    else if (kind === "credit") credit.push(id);
  }
  if (bucket === "debt") return { in: debt };
  if (bucket === "credit") return { in: credit };
  return { notIn: [...debt, ...credit] };
}
