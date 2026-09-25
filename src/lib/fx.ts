/**
 * USD and UZS, one convention (audit AN-01).
 *
 * `ExchangeRate.rateUsd` and `Payment.fxRate` hold сумов за 1 USD: «12600»,
 * the number the settings screen asks for and the bank quotes. Money is
 * stored in minor units (тийин, центы), and since 1 сум = 100 тийин and
 * $1 = 100 центов, the same number is also тийин per цент: the minor-unit
 * math needs no ×100 either way.
 *
 * There used to be two conventions at once. The seed wrote «USD per сум»
 * (1/12700, which `Decimal(12, 4)` rounds to 0.0001, 27% off), the payment
 * route multiplied by the rate as if it were that, and LTV divided by it.
 * The moment an admin typed today's rate as the screen suggested, every
 * payment snapshot overflowed its int4 column and payments failed with 500.
 *
 * A rate outside a plausible range is treated as missing, never used: a
 * reporting snapshot must not be able to block taking a patient's money,
 * and a legacy 0.0001 must not turn into a ×10 000 figure.
 */

/** Lowest believable сум per dollar; the rate has been ~12 000+ for years. */
export const UZS_PER_USD_MIN = 1_000;
/** Highest believable сум per dollar. */
export const UZS_PER_USD_MAX = 100_000;

/** Postgres int4: the width of `Payment.amountUsdSnap` and `Patient.ltv`. */
const INT4_MAX = 2_147_483_647;

/**
 * The rate as a number of сум per 1 USD, or null when it is missing or not
 * plausible (a legacy «USD per сум» value, a typo). Accepts a Prisma
 * Decimal, a string from JSON, or a number.
 */
export function uzsPerUsd(rate: unknown): number | null {
  if (rate === null || rate === undefined || rate === "") return null;
  const n = Number(rate);
  if (!Number.isFinite(n)) return null;
  if (n < UZS_PER_USD_MIN || n > UZS_PER_USD_MAX) return null;
  return n;
}

/** UZS тийин to USD центы, or null without a usable rate. */
export function tiyinToUsdCents(tiyin: number, rate: unknown): number | null {
  const r = uzsPerUsd(rate);
  if (r === null || !Number.isFinite(tiyin)) return null;
  const cents = Math.round(tiyin / r);
  return Math.abs(cents) <= INT4_MAX ? cents : null;
}

/** USD центы to UZS тийин, or null without a usable rate. */
export function usdCentsToTiyin(cents: number, rate: unknown): number | null {
  const r = uzsPerUsd(rate);
  if (r === null || !Number.isFinite(cents)) return null;
  const tiyin = Math.round(cents * r);
  return Math.abs(tiyin) <= INT4_MAX ? tiyin : null;
}
