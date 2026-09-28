/**
 * Which card a Telegram chat may be tied to, and when (audit TG-11 review).
 *
 * Pure module: shared by the conversation PATCH, the inbox's right rail and
 * scripts/fix-tg11-thread-patient-links.ts, so the three agree.
 */
import { nameOrders, sameNameLikely } from "./identity-match";

/**
 * A private chat's id: the Telegram user's own id (positive). A group's id
 * is negative, and a thread opened from the card with no bot chat yet has
 * none at all.
 */
export function isPrivateChatId(externalId: string | null | undefined): boolean {
  return typeof externalId === "string" && /^[1-9]\d{0,19}$/.test(externalId);
}

/**
 * Does the Telegram account go by the card's name? Same strict rule as the
 * P1 shared-contact check (`accountNameMatches`): Telegram writes the given
 * name first, the clinic the surname first, both alphabets fold together,
 * and a surname or a lone first name is never enough (relatives share one,
 * and many profiles carry only «Dilnoza»). `names` are the profile's name
 * and, when there is one, the name on the card the Mini App keeps for the
 * account (the patient may have corrected it there).
 */
export function goesByCardName(
  names: ReadonlyArray<string | null | undefined>,
  cardName: string,
): boolean {
  return names
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .flatMap((n) => nameOrders(n))
    .some((n) => sameNameLikely(n, cardName));
}

/** The profile name a thread recorded for its sender, or null. */
export function threadProfileName(conv: {
  contactFirstName?: string | null;
  contactLastName?: string | null;
}): string | null {
  const name = [conv.contactFirstName, conv.contactLastName]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");
  return name || null;
}

/**
 * The card the Mini App created on the account's first open, before anyone
 * confirmed who it is: born in Telegram, no proven number. Its name is the
 * Telegram profile's and its phone a `tg:` stub or a typed claim. When the
 * bot links a chat to such a card, reception still has to find the patient's
 * clinic card (audit TG-11 review): a relative's card on the family's number
 * (`contact:`) or a child added in the Mini App (`family:`) is a real,
 * deliberate card and not a stub.
 */
export function isUnconfirmedMiniAppCard(card: {
  source?: string | null;
  phoneNormalized?: string | null;
  phoneVerifiedAt?: Date | string | null;
}): boolean {
  if (card.source !== "TELEGRAM" || card.phoneVerifiedAt) return false;
  const normalized = card.phoneNormalized ?? "";
  return !normalized.startsWith("contact:") && !normalized.startsWith("family:");
}
