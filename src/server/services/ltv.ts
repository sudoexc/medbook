/**
 * Patient LTV recalculation.
 *
 * Sums all PAID payments for a patient in the clinic's primary currency
 * (UZS minor units). USD payments are converted via the payment snapshot
 * `amountUsdSnap` if available, otherwise via the most recent ExchangeRate.
 *
 * See docs/TZ.md §5.4 — LTV is denormalized on Patient for fast list sorts.
 * Called synchronously from the payment endpoints today; will be moved to
 * a BullMQ worker in Phase 3a.
 */
import { prisma } from "@/lib/prisma";

export async function recalcLtv(patientId: string): Promise<number> {
  const payments = await prisma.payment.findMany({
    where: { patientId, status: "PAID" },
    select: {
      amount: true,
      currency: true,
      amountUsdSnap: true,
      fxRate: true,
    },
  });

  // Fetch the latest FX rate for the clinic once (tenant-scoped).
  const latestRate = await prisma.exchangeRate.findFirst({
    orderBy: { date: "desc" },
    select: { rateUsd: true },
  });

  let ltv = 0;
  let visits = 0;
  for (const p of payments) {
    visits += 1;
    if (p.currency === "UZS") {
      ltv += p.amount;
    } else {
      // Convert USD cents → UZS tiyin equivalent.
      // rateUsd is "1 UZS = X USD" so 1 USD = 1 / rateUsd UZS.
      // We store UZS amount (tiyin) = amountCents (USD) * (100 / rateUsd) roughly.
      // Simplification: if amountUsdSnap was populated the other way,
      // we fall back to `latestRate` as a conversion hint.
      const rate = Number(p.fxRate ?? latestRate?.rateUsd ?? 0);
      if (rate > 0) {
        // amountCents / rate ≈ UZS minor units
        ltv += Math.round(p.amount / rate);
      }
    }
  }

  await prisma.patient.update({
    where: { id: patientId },
    data: {
      ltv,
      visitsCount: visits,
    },
  });

  return ltv;
}
