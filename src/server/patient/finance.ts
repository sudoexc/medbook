/**
 * Loads a patient's money on the one formula of `src/lib/patients/finance.ts`
 * (audit PT-08): COMPLETED visits cost, every PAID payment counts (filed
 * under a visit or not, net of refunds, USD converted like LTV), and a
 * clinic that records no payments shows no debt.
 *
 * `Patient.balance` is never written by the app, so every reader (the card,
 * «Оплаты», the call-center and Telegram rails, the stats endpoint, the
 * «должники» filter, the DSAR export) goes through here instead.
 *
 * Every query pins `clinicId` explicitly: the DSAR worker runs under the
 * SYSTEM context, where the Prisma extension injects nothing, and «does the
 * clinic record payments» must never look at another clinic's rows.
 */
import { prisma } from "@/lib/prisma";
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

/** Whether the clinic has recorded at least one payment in the CRM. */
export async function clinicTracksPayments(
  clinicId: string,
  db: Db = prisma,
): Promise<boolean> {
  const any = await db.payment.findFirst({
    where: { clinicId, status: "PAID" },
    select: { id: true },
  });
  return any !== null;
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
  const [visits, tracksPayments] = await Promise.all([
    db.appointment.findMany({
      where: { clinicId, patientId, status: BILLABLE_VISIT_STATUS },
      select: { status: true, priceFinal: true },
    }),
    clinicTracksPayments(clinicId, db),
  ]);
  if (!tracksPayments) {
    return summarizePatientFinance({ visits, paidTiyin: 0, tracksPayments });
  }
  const [payments, rate] = await Promise.all([
    db.payment.findMany({
      where: {
        clinicId,
        status: "PAID",
        // A deposit taken on the «Оплаты» tab has no visit; a payment taken
        // in the visit drawer may carry only the visit. Both are the
        // patient's money.
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
    tracksPayments,
  });
}

/**
 * The `id` condition for the patients list's `?balance=` filter, or null
 * for «no condition». Balances are computed for the whole clinic at once
 * (one grouped query over completed visits, one over PAID payments): the
 * clinic has a few thousand cards and very few payments.
 */
export async function patientBalanceIdWhere(
  clinicId: string,
  bucket: BalanceBucket,
  db: Db = prisma,
): Promise<{ in: string[] } | { notIn: string[] } | null> {
  if (!(await clinicTracksPayments(clinicId, db))) {
    // Nothing recorded: everyone's balance is 0, nobody is a debtor.
    return bucket === "zero" ? null : { in: [] };
  }
  const [billed, payments, rate] = await Promise.all([
    db.appointment.groupBy({
      by: ["patientId"],
      where: { clinicId, status: BILLABLE_VISIT_STATUS },
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
