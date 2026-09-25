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
