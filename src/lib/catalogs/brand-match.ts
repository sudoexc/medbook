/**
 * Which name to show a doctor who typed a brand.
 *
 * The catalog is organised around the substance: «Мидокалм» is a brand of
 * `Толперизон`, so searching «мидокалм» correctly finds that row — and then
 * showed «Толперизон», a word the doctor did not type and the patient will
 * not see on the box. The clinic noticed immediately («у нас офиц. название
 * вышло без фирмы, а в аптеке он пишет своё»).
 *
 * The data is already there (the state register brought 4.4k trade names);
 * only the presentation was wrong. These helpers pick the brand the query
 * matched so lists can lead with it — and so a prescription carries the name
 * the patient will actually ask for at the counter, with the substance kept
 * alongside for correctness.
 */

export type BrandLike = { name: string };
export type DrugLike = { nameRu: string; inn?: string; brands: BrandLike[] };

function fold(s: string): string {
  return s.toLowerCase().replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The brand that best answers `term`, or null when the query is about the
 * substance itself. Prefers an exact hit, then a prefix, then a substring —
 * «мидокалм» should pick «Мидокалм», not «Мидокалм® Лонг».
 */
export function matchedBrand(
  drug: DrugLike,
  term: string,
): string | null {
  const q = fold(term);
  if (q.length < 2 || drug.brands.length === 0) return null;
  // The query is the substance — nothing to swap in.
  if (fold(drug.nameRu).includes(q)) return null;

  const names = drug.brands.map((b) => b.name).filter(Boolean);
  const exact = names.find((n) => fold(n) === q);
  if (exact) return exact;
  const prefix = names.filter((n) => fold(n).startsWith(q));
  if (prefix.length > 0) {
    // Shortest wins: «Мидокалм» over «Мидокалм® Лонг».
    return prefix.sort((a, b) => a.length - b.length)[0]!;
  }
  const contains = names.filter((n) => fold(n).includes(q));
  if (contains.length > 0) {
    return contains.sort((a, b) => a.length - b.length)[0]!;
  }
  return null;
}

/**
 * Prescription label: «Мидокалм (толперизон)» when the doctor picked a
 * brand, plain substance otherwise. The brand leads because that is what
 * the patient buys; the substance follows because that is what was
 * prescribed — and interaction checks, allergies and the medication card
 * all reason about it.
 */
export function prescriptionLabel(
  drug: DrugLike,
  term: string,
): string {
  const brand = matchedBrand(drug, term);
  if (!brand) return drug.nameRu;
  if (fold(brand) === fold(drug.nameRu)) return drug.nameRu;
  return `${brand} (${drug.nameRu.toLowerCase()})`;
}
