/**
 * Detector: PAYMENT_OVERDUE.
 *
 * Picks COMPLETED appointments older than `paymentOverdueMinDays * 24h` ago
 * whose PAID payments (net of refunds, USD converted like the patient
 * balance) fall short of `priceFinal`. Outputs one action per appointment
 * with the outstanding amount in tiins.
 *
 * Only while the clinic records payments in the CRM (audit AC-06):
 * `Clinic.paymentsTrackedSince` is the one switch every debt reader obeys
 * (`server/patient/finance.ts`). While it is off there is no debt at all, and
 * once it is on only visits completed from that moment on can owe anything.
 * This clinic takes money at the till and records no payments, so every
 * completed visit with a price would have been a «задолженность» the moment
 * visits started closing with prices. The scan is also bounded to the last
 * `paymentOverdueWindowDays`, so history never floods the list.
 *
 * Severity scales with how overdue:
 *   - `medium`   1..7 days
 *   - `high`     7..30 days
 *   - `critical` >30 days
 *
 * `daysOverdue` is computed from `appointment.completedAt` when present,
 * else from `appointment.date`.
 */
import type { ActionSeverity, PaymentOverduePayload } from "@/lib/actions/types";
import { paidNetTiyin, type PaidPaymentRow } from "@/server/services/ltv-compute";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addDays } from "./_shared";

type ApptRow = {
  id: string;
  patientId: string;
  date: Date;
  completedAt: Date | null;
  priceFinal: number | null;
  patient: { fullName: string };
  payments: PaidPaymentRow[];
};

/**
 * What the visit still owes, in tiins: `priceFinal` less its PAID payments
 * (the query already narrowed them to PAID). Never negative.
 */
export function visitDebtTiins(
  priceFinal: number | null,
  paidPayments: PaidPaymentRow[],
  latestUsdRate: unknown,
): number {
  const due = (priceFinal ?? 0) - paidNetTiyin(paidPayments, latestUsdRate);
  return due > 0 ? due : 0;
}

export async function detectPaymentOverdue(
  prisma: PrismaLike,
  clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<PaymentOverduePayload[]> {
  const clinic = (await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { paymentsTrackedSince: true },
  })) as { paymentsTrackedSince: Date | null } | null;
  const since = clinic?.paymentsTrackedSince ?? null;
  if (!since) return [];

  const cutoff = addDays(now, -config.paymentOverdueMinDays);
  const windowStart = addDays(now, -config.paymentOverdueWindowDays);
  const from = since.getTime() > windowStart.getTime() ? since : windowStart;
  if (from.getTime() > cutoff.getTime()) return [];

  const appts = (await prisma.appointment.findMany({
    where: {
      status: "COMPLETED",
      priceFinal: { gt: 0 },
      // Completed inside the window; a legacy row without `completedAt` by
      // its slot time, the same anchor the balance uses.
      OR: [
        { completedAt: { gte: from, lte: cutoff } },
        { completedAt: null, date: { gte: from, lte: cutoff } },
      ],
    },
    select: {
      id: true,
      patientId: true,
      date: true,
      completedAt: true,
      priceFinal: true,
      patient: { select: { fullName: true } },
      payments: {
        where: { status: "PAID" },
        select: {
          amount: true,
          refundedAmount: true,
          currency: true,
          fxRate: true,
        },
      },
    },
  })) as ApptRow[];
  if (appts.length === 0) return [];

  // The clinic's latest rate converts a USD payment without its own snapshot;
  // read only when such a payment is there.
  const needsRate = appts.some((a) =>
    a.payments.some((p) => p.currency !== "UZS" && p.fxRate == null),
  );
  const latest = needsRate
    ? ((await prisma.exchangeRate.findFirst({
        where: { clinicId },
        orderBy: { date: "desc" },
        select: { rateUsd: true },
      })) as { rateUsd: unknown } | null)
    : null;

  const dayMs = 24 * 60 * 60 * 1000;
  const out: PaymentOverduePayload[] = [];
  for (const a of appts) {
    const due = visitDebtTiins(a.priceFinal, a.payments, latest?.rateUsd ?? null);
    if (due <= 0) continue;
    const anchor = a.completedAt ?? a.date;
    const daysOverdue = Math.max(
      0,
      Math.floor((now.getTime() - anchor.getTime()) / dayMs),
    );
    out.push({
      type: "PAYMENT_OVERDUE",
      appointmentId: a.id,
      patientId: a.patientId,
      patientName: a.patient.fullName,
      amountUzs: due,
      daysOverdue,
    });
  }
  return out;
}

export function severityForPaymentOverdue(
  payload: PaymentOverduePayload,
): ActionSeverity {
  if (payload.daysOverdue > 30) return "critical";
  if (payload.daysOverdue >= 7) return "high";
  return "medium";
}
