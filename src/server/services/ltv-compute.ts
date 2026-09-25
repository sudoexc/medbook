/**
 * LTV arithmetic, without a database client, so the AN-01 data fix
 * (scripts/fix-an01-fx-rate-convention.ts) recomputes it exactly the way
 * `recalcLtv` does.
 *
 * A USD payment (amount in центы) is converted with the rate snapshotted on
 * the payment, else the clinic's latest rate, both сум per 1 USD
 * (`src/lib/fx.ts`, audit AN-01). A USD payment with no usable rate adds
 * nothing rather than a guess.
 */
import { usdCentsToTiyin, uzsPerUsd } from "@/lib/fx";

export type LtvPayment = {
  amount: number;
  currency: string;
  fxRate: unknown;
};

/** LTV in тийин of a patient's PAID payments. */
export function computeLtv(payments: LtvPayment[], latestRate: unknown): number {
  const fallback = uzsPerUsd(latestRate);
  let ltv = 0;
  for (const p of payments) {
    if (p.currency === "UZS") {
      ltv += p.amount;
      continue;
    }
    const rate = uzsPerUsd(p.fxRate) ?? fallback;
    const tiyin = rate === null ? null : usdCentsToTiyin(p.amount, rate);
    if (tiyin !== null) ltv += tiyin;
  }
  return ltv;
}
