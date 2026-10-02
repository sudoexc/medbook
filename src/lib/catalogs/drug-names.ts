/**
 * Which of a drug row's names a person may be shown (audits CT-15, G4-19).
 *
 * `Drug.inn` is the table's unique handle more than an INN: the state
 * register import writes «uzr:glyukozamin», a drug a doctor adds for his
 * clinic gets «clinic:…», and a curated row without a Latin INN keeps its
 * slug id («aspirin_cardio», «smecta»). Those are keys, not names. The card
 * printed «uzr:glyukozamin» under the drug's name, and the one-click allergy
 * buttons wrote «aspirin_cardio» into the patient's record.
 *
 * Pure and client-safe.
 */

type NamedDrug = { id: string; inn: string; nameRu: string };

/**
 * The INN worth showing under the drug's name, or null: a technical handle
 * (register, clinic, slug) or a repeat of the name itself.
 */
export function readableInn(drug: NamedDrug): string | null {
  const inn = drug.inn?.trim();
  if (!inn) return null;
  if (/^(?:uzr|clinic):/i.test(inn)) return null;
  // A slug: the row's own id, or anything shaped like one («iron_sorbifer»).
  if (inn === drug.id || inn.includes("_")) return null;
  if (inn.toLowerCase() === drug.nameRu.trim().toLowerCase()) return null;
  return inn;
}

/** At most this many one-click allergy suggestions. */
const MAX_ALLERGY_SUGGESTIONS = 6;

/**
 * What the one-click «записать аллергию» buttons offer for the recognised
 * drugs: their Russian names, each once. The Russian name is what the
 * patient card, the print and the reception read, and what the allergy
 * check matches the register's Russian rows by (a Latin «Carbamazepine»
 * never met them).
 */
export function allergySuggestionNames(
  drugs: readonly Pick<NamedDrug, "nameRu">[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of drugs) {
    const name = d.nameRu?.trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/ё/g, "е");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, MAX_ALLERGY_SUGGESTIONS);
}
