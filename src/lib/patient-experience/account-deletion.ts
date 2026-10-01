/**
 * How a Mini App patient confirms «delete my account» (audit MA-12).
 *
 * The patient retypes his phone number, like a repository delete: it keeps a
 * relative holding the phone from erasing the owner's card by one tap. A
 * card the Mini App created on first open has no number at all (its phone
 * column holds a `tg:<id>` stub the profile hides), and such a patient could
 * never confirm: the screen compared against an empty string, the server
 * against the stub's digits, his Telegram id. A card without a real number
 * confirms with a word instead.
 *
 * Client-safe (no server imports): the screen and the POST share it.
 */

/** Accepted in either interface language, in any case. */
export const DELETE_CONFIRM_WORDS = ["УДАЛИТЬ", "O‘CHIRISH"] as const;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Upper case, no spaces, no apostrophe variants (O‘ / O' / Oʻ / O’). */
function foldWord(s: string): string {
  return s.toUpperCase().replace(/[\s'‘’ʻʼ`´]/g, "");
}

const FOLDED_WORDS = new Set(DELETE_CONFIRM_WORDS.map(foldWord));

export function deletionConfirmationMatches(input: {
  /** The card has a real number (not a tg:/family:/contact: stub). */
  hasPhone: boolean;
  phone: string;
  confirmation: string;
}): boolean {
  if (input.hasPhone) {
    const typed = digitsOnly(input.confirmation);
    return typed.length > 0 && typed === digitsOnly(input.phone);
  }
  return FOLDED_WORDS.has(foldWord(input.confirmation));
}
