/**
 * Money inputs speak сумы; the database speaks тийины (Int minor units,
 * `formatMoney` divides by 100). Every form that edits a stored price goes
 * through these two, so a price typed as «200 000» is saved as 20 000 000
 * and shown back as «200 000» — the services settings screen once showed
 * and saved raw tiyin under a «Цена (UZS)» label, and one edit there made a
 * visit 100× cheaper.
 */
export function tiyinToSum(tiyin: number | null | undefined): number {
  if (tiyin == null || !Number.isFinite(tiyin)) return 0;
  return Math.round(tiyin / 100);
}

export function sumToTiyin(sum: number | null | undefined): number {
  if (sum == null || !Number.isFinite(sum) || sum < 0) return 0;
  return Math.round(sum * 100);
}

/**
 * `Payment.amount` is a 32-bit Int of тийин, so the largest storable amount
 * is 21 474 836 сум. Anything above would fail at the database, or worse,
 * be clamped somewhere on the way.
 */
export const MAX_SUM_INPUT = Math.floor(2_147_483_647 / 100);

export type SumInputResult =
  | { ok: true; sum: number; tiyin: number }
  | { ok: false; reason: "empty" | "invalid" | "too_large" };

/**
 * Parse a typed amount in сум (audit AN-23). Reception types «150.000» or
 * «150,000» out of habit, meaning 150 000: сумы have no fractional part in
 * practice, so a dot or comma between groups of three digits is a thousands
 * separator, like a space. The old dialog only dropped spaces and read
 * «150.000» as 150 сум, a payment 1000× too small saved as PAID.
 *
 * Anything that is not digits in thousands groups («150.5», «1,5», «150к»)
 * is `invalid` rather than guessed: the form shows the error instead of
 * saving a wrong amount.
 */
export function parseSumInput(raw: string): SumInputResult {
  const compact = raw.replace(/[\s   ]/g, "");
  if (compact === "") return { ok: false, reason: "empty" };
  let digits: string;
  if (/^\d+$/.test(compact)) {
    digits = compact;
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(compact)) {
    digits = compact.replace(/[.,]/g, "");
  } else {
    return { ok: false, reason: "invalid" };
  }
  const sum = Number(digits);
  if (!Number.isSafeInteger(sum) || sum > MAX_SUM_INPUT) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, sum, tiyin: sumToTiyin(sum) };
}
