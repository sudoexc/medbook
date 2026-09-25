/**
 * Patient LTV recalculation.
 *
 * Sums all PAID payments for a patient in the clinic's primary currency
 * (UZS minor units); USD payments are converted in the one convention,
 * сум per 1 USD (`computeLtv`, audit AN-01).
 *
 * See docs/TZ.md §5.4 — LTV is denormalized on Patient for fast list sorts.
 * Called synchronously from the payment endpoints.
 */
import { prisma } from "@/lib/prisma";
import { computeLtv } from "@/server/services/ltv-compute";

export async function recalcLtv(patientId: string): Promise<number> {
  const payments = await prisma.payment.findMany({
    where: { patientId, status: "PAID" },
    select: { amount: true, currency: true, fxRate: true },
  });

  // Fetch the latest FX rate for the clinic once (tenant-scoped).
  const latestRate = await prisma.exchangeRate.findFirst({
    orderBy: { date: "desc" },
    select: { rateUsd: true },
  });

  const ltv = computeLtv(payments, latestRate?.rateUsd);

  // Only `ltv`: `visitsCount` counts COMPLETED visits and belongs to
  // `refreshPatientVisitStats`. Writing the number of payments into it here
  // overwrote the visit count every time money was taken.
  await prisma.patient.update({
    where: { id: patientId },
    data: { ltv },
  });

  return ltv;
}
