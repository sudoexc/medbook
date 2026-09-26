/**
 * Canonical phone number format: leading "+" followed by digits only.
 *
 * We normalize at every write boundary (lead form, receptionist terminal,
 * patients API) so that DB lookups by phone match regardless of how the
 * user typed the number. Without this, "+998 90 123-45-67" and
 * "+998901234567" end up as two different patients.
 *
 * Uzbek-specific conveniences:
 *  - 9 local digits → assume +998 prefix (901234567 → +998901234567,
 *    334125567 → +998334125567)
 *  - 12 digits starting with "998" → prepend +
 *
 * The 9-digit rule used to require a leading "9", so a number on any other
 * operator code (Humans 33, Mobiuz 88, Uzmobile 77 and 55, Ucell 50, OQ 20,
 * a Tashkent landline 71) typed without the country code was stored as
 * «+334125567»: a foreign-looking number nobody could call back and that no
 * lookup by the full number matched (audit LD-10).
 */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return "";
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.length === 9) return "+998" + digits;
  if (digits.length === 12 && digits.startsWith("998")) return "+" + digits;

  return "+" + digits;
}

/** What a typed phone may contain besides digits: "+", spaces, ( ) - . */
const PHONE_CHARS = /^[+\d\s().-]+$/;

/**
 * The Uzbek national number (9 digits, operator or area code first) in what
 * a person typed, or null when it is not an Uzbek number.
 *
 * Accepted: the 9 national digits alone («33 412 55 67») or with the country
 * code («+998 88 123-45-67», «998771234567»), grouped any usual way. Any
 * operator or area code counts: the numbering plan has codes from 20 to 99
 * (mobile 20, 33, 50, 55, 77, 88, 90 to 99; landlines 61 to 79), and a list
 * of mobile codes would go stale with the next operator. Nothing starts with
 * 0 or 1, so those are typos.
 */
export function uzNationalNumber(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw || !PHONE_CHARS.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  const national =
    digits.length === 12 && digits.startsWith("998")
      ? digits.slice(3)
      : digits.length === 9
        ? digits
        : null;
  return national && /^[2-9]/.test(national) ? national : null;
}

/**
 * Whether the public booking form (and its API) takes this number. One rule
 * for both sides, so the form never refuses what the server would store and
 * the server never stores what the form would refuse (audit LD-10).
 */
export function isValidUzPhone(input: string | null | undefined): boolean {
  return uzNationalNumber(input) !== null;
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

/**
 * The number to SHOW for a patient card (prints, `tel:` links).
 *
 * `phoneNormalized` is a real number only for the card whose identity it is;
 * other cards carry internal stubs there (`tg:<id>`, `family:…`, and since
 * audit Q-03 `contact:…` for a relative who uses the owner's number, whose
 * `phone` holds that number). Stubs are keys, never something to print on a
 * sick leave or dial.
 */
export function displayPhone(p: {
  phone?: string | null;
  phoneNormalized?: string | null;
}): string {
  const real = (v: string | null | undefined): v is string =>
    typeof v === "string" && v.startsWith("+") && v.replace(/\D/g, "").length >= 9;
  if (real(p.phoneNormalized)) return p.phoneNormalized;
  if (real(p.phone)) return p.phone;
  return "";
}
