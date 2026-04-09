/**
 * Canonical phone number format: leading "+" followed by digits only.
 *
 * We normalize at every write boundary (lead form, receptionist terminal,
 * patients API) so that DB lookups by phone match regardless of how the
 * user typed the number. Without this, "+998 90 123-45-67" and
 * "+998901234567" end up as two different patients.
 *
 * Uzbek-specific conveniences:
 *  - 9 local digits starting with "9" → assume +998 prefix (e.g. 901234567 → +998901234567)
 *  - 12 digits starting with "998"   → prepend +
 */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return "";
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.length === 9 && digits.startsWith("9")) return "+998" + digits;
  if (digits.length === 12 && digits.startsWith("998")) return "+" + digits;

  return "+" + digits;
}

/**
 * Return all phone variants worth trying when searching the DB, so a user
 * who typed "901234567" in the kiosk still matches a patient stored as
 * "+998901234567". Returns a deduplicated array with the canonical form first.
 */
export function phoneSearchVariants(input: string): string[] {
  const canonical = normalizePhone(input);
  const digits = input.replace(/\D/g, "");
  const variants = new Set<string>();
  if (canonical) variants.add(canonical);
  if (digits) {
    variants.add(digits);
    variants.add("+" + digits);
    if (digits.startsWith("998") && digits.length === 12) {
      variants.add(digits.slice(3)); // local part
    }
    if (digits.length === 9) {
      variants.add("998" + digits);
      variants.add("+998" + digits);
    }
  }
  return [...variants];
}
