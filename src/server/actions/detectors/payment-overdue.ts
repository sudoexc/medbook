/**
 * Detector: PAYMENT_OVERDUE.
 *
 * Picks COMPLETED appointments older than `paymentOverdueMinDays * 24h` ago
 * whose total PAID payment amount falls short of `priceFinal`. Outputs one
 * action per appointment with the outstanding amount in tiins.
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
  payments: Array<{ amount: number; status: string }>;
};

export async function detectPaymentOverdue(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<PaymentOverduePayload[]> {
  const cutoff = addDays(now, -config.paymentOverdueMinDays);

  const appts = (await prisma.appointment.findMany({
    where: {
      status: "COMPLETED",
      date: { lte: cutoff },
      priceFinal: { gt: 0 },
    },
    select: {
      id: true,
      patientId: true,
      date: true,
      completedAt: true,
      priceFinal: true,
      patient: { select: { fullName: true } },
      payments: { select: { amount: true, status: true } },
    },
  })) as ApptRow[];
  if (appts.length === 0) return [];

  const dayMs = 24 * 60 * 60 * 1000;
  const out: PaymentOverduePayload[] = [];
  for (const a of appts) {
    const paid = a.payments
      .filter((p) => p.status === "PAID")
      .reduce((s, p) => s + p.amount, 0);
    const due = (a.priceFinal ?? 0) - paid;
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
