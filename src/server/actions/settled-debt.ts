/**
 * Close a visit's PAYMENT_OVERDUE task the moment it is paid (audit AC-17).
 *
 * The task lived until the 48h sweep: a patient who paid at the till ten
 * minutes after the task appeared was rung two days running about a debt he
 * no longer had. The payment routes call this after a payment turns PAID;
 * it recomputes what the visit still owes on the detector's own formula
 * (`visitDebtTiins`) and closes the task only when nothing is left. A part
 * payment leaves it open; the next engine pass rewrites its amount.
 *
 * Best effort: never throws, the payment is already saved. Caller MUST be
 * inside `runWithTenant(...)` (the route wrappers are).
 */
import { dedupeKeyFor } from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";

import { visitDebtTiins } from "./detectors/payment-overdue";
import { retireActions } from "./repository";

export async function retireSettledDebt(
  prisma: TenantScopedPrisma,
  clinicId: string,
  appointmentId: string,
): Promise<number> {
  try {
    const dedupeKey = dedupeKeyFor({
      type: "PAYMENT_OVERDUE",
      appointmentId,
      // Only `appointmentId` feeds this key.
      patientId: "",
      patientName: "",
      amountUzs: 0,
      daysOverdue: 0,
    });
    const live = await prisma.action.findMany({
      where: { clinicId, dedupeKey, status: { in: ["OPEN", "SNOOZED"] } },
      select: { id: true, type: true, severity: true, status: true, outcome: true },
    });
    if (live.length === 0) return 0;

    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        priceFinal: true,
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
    });
    if (!appt) return 0;
    const needsRate = appt.payments.some(
      (p) => p.currency !== "UZS" && p.fxRate == null,
    );
    const latest = needsRate
      ? await prisma.exchangeRate.findFirst({
          where: { clinicId },
          orderBy: { date: "desc" },
          select: { rateUsd: true },
        })
      : null;
    if (visitDebtTiins(appt.priceFinal, appt.payments, latest?.rateUsd ?? null) > 0) {
      return 0;
    }
    return await retireActions(prisma, clinicId, live, "debt_paid");
  } catch (e) {
    console.warn(
      `[actions.retireSettledDebt] ${appointmentId} skipped: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 0;
  }
}
