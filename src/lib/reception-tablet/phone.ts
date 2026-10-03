/**
 * The phone field of the reception tablet (`/crm/reception/tablet`).
 *
 * The receptionist types a number on an on-screen keypad (or the iPad's own
 * numeric keyboard, `inputmode="tel"`). «+998» stands in front of the field
 * and is never typed: the field holds only the 9 national digits, the
 * operator or area code first, which is how people dictate their number
 * («девяносто, сто двадцать три…»). A paste of a whole number
 * («+998 90 123-45-67») still lands as those 9 digits.
 *
 * Pure: shared by the page and the unit tests.
 */

/** The country prefix shown in front of the field. */
export const UZ_PREFIX = "+998";

/** National digits in an Uzbek number. */
export const UZ_LOCAL_LENGTH = 9;

/** A key of the on-screen keypad. */
export type KeypadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "back"
  | "clear";

/** Keypad layout, row by row (a phone's, not a calculator's). */
export const KEYPAD_ROWS: ReadonlyArray<ReadonlyArray<KeypadKey>> = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clear", "0", "back"],
];

/**
 * The national digits in whatever was typed or pasted into the field, at
 * most nine. A twelve digit run with the country code loses the «998»; a
 * shorter run is taken as national digits as is, because a local number may
 * itself start with 99 8 (operator 99).
 */
export function localDigitsFrom(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length > UZ_LOCAL_LENGTH && digits.startsWith("998")) {
    digits = digits.slice(3);
  }
  return digits.slice(0, UZ_LOCAL_LENGTH);
}

/** One key press on the keypad. A tenth digit is ignored. */
export function pressKey(local: string, key: KeypadKey): string {
  if (key === "clear") return "";
  if (key === "back") return local.slice(0, -1);
  if (local.length >= UZ_LOCAL_LENGTH) return local;
  return local + key;
}

/** «90 123 45 67», built up as the digits arrive: «90 1», «90 123 4». */
export function formatLocal(local: string): string {
  const d = localDigitsFrom(local);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)]
    .filter(Boolean)
    .join(" ");
}

/** «+998 90 123 45 67»; just «+998» while nothing is typed. */
export function formatFull(local: string): string {
  const rest = formatLocal(local);
  return rest ? `${UZ_PREFIX} ${rest}` : UZ_PREFIX;
}

/**
 * All nine digits, with a real operator or area code in front (2 to 9: the
 * numbering plan has nothing that starts with 0 or 1). Same rule as
 * `uzNationalNumber` in lib/phone, which the server applies.
 */
export function isCompleteLocal(local: string): boolean {
  return /^[2-9]\d{8}$/.test(local);
}

/** «+998901234567» for a complete number, otherwise null. */
export function toE164(local: string): string | null {
  return isCompleteLocal(local) ? `${UZ_PREFIX}${local}` : null;
}

/** Fewer digits than this match half the base: no search yet. */
export const PHONE_SEARCH_MIN_DIGITS = 4;

/**
 * What to send to the patient search for the digits typed so far, or null
 * while there are too few. The search matches digits anywhere in the
 * stored number, so the national digits find «+998901234567» from «9012».
 */
export function phoneSearchTerm(local: string): string | null {
  const d = localDigitsFrom(local);
  return d.length >= PHONE_SEARCH_MIN_DIGITS ? d : null;
}

/**
 * The last four digits of a card's number, «45 67», so the receptionist can
 * tell two cards with one name apart without the whole number on a screen
 * the patient sees. Empty when the card has no real number.
 */
export function phoneTail(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return "";
  const tail = digits.slice(-4);
  return `${tail.slice(0, 2)} ${tail.slice(2)}`;
}
