/**
 * «Whose card is this number?» for a new patient typed as name + phone at
 * the kiosk, the front desk, the doctor's walk-in dialog or the CRM «Новый
 * пациент» form (audit Q-03, PH-01).
 *
 * One decision for every surface, so the kiosk, the walk-in and the booking
 * dialog cannot drift apart again. The number alone never decides:
 *   1. its VERIFIED owner is used when the typed name and birth year match
 *      (`samePersonLikely`), or when a person answered "same";
 *   2. a relative already registered under the number (contact sharer)
 *      whose name matches is used;
 *   3. an owner without an answer comes back as a question; "other"
 *      creates a card that keeps the number as a contact phone only;
 *   4. with no verified owner, a card that merely CLAIMS the number (typed
 *      into the Mini App) is shown to the person as well, whatever its name:
 *      the name on a claim was typed by the same Telegram user, so a match
 *      proves nothing (anyone who knows her name and number could have set
 *      it up). "same" verifies the claim in place, keeping her Mini App
 *      bookings and Telegram on one card; "other" takes the number away and
 *      the new card owns it;
 *   5. a number nobody holds gets a new card that owns it.
 */
import type { prisma } from "@/lib/prisma";
import {
  birthYearOf,
  samePersonLikely,
  type IdentityProbe,
} from "@/lib/patients/identity-match";
import {
  findContactSharers,
  findPhoneClaim,
  findVerifiedPhoneOwners,
  type PhoneCard,
} from "@/server/patient/phone-identity";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * The answer to «is this the person the number belongs to?»:
 *   - "same"  → use the card shown (the kiosk's «Это вы?» → «Да», staff's
 *               explicit choice), whatever name was typed;
 *   - "other" → someone else using that number.
 */
export type PhoneOwnerAnswer = "same" | "other";

/** The card a person is asked about. */
export type PhoneOwnerSummary = {
  id: string;
  fullName: string;
  birthYear: number | null;
  /**
   * The number is only CLAIMED by this card (typed into the Mini App), not
   * its proven identity. «Other» then gives the number to the new card
   * instead of keeping it as a contact phone.
   */
  unverified: boolean;
};

export type PhoneOwnerDecision =
  /** Use this card. `verifyClaim`: a claim a person just confirmed. */
  | { kind: "use"; card: PhoneCard; verifyClaim: boolean }
  /** Nothing may be created until a person answers about `owner`. */
  | { kind: "ask"; owner: PhoneOwnerSummary }
  /**
   * Create a new card. `asContact`: the number has a verified owner, so the
   * new card keeps it as a contact phone. Otherwise the new card owns the
   * number and any claim on it must be released first.
   */
  | { kind: "create"; asContact: boolean };

function summary(card: PhoneCard, unverified: boolean): PhoneOwnerSummary {
  return {
    id: card.id,
    fullName: card.fullName,
    birthYear: birthYearOf(card.birthDate),
    unverified,
  };
}

export async function decidePhoneOwner(
  db: PrismaLike,
  clinicId: string,
  phone: string,
  probe: IdentityProbe,
  answer?: PhoneOwnerAnswer,
): Promise<PhoneOwnerDecision> {
  // Usually one owner. With two (the two shapes of one number, see
  // findVerifiedPhoneOwners) the one whose name matches is the person here;
  // only without a match does the oldest stand for the number, and it is
  // the card a person is asked about and «same» then refers to.
  const owners = await findVerifiedPhoneOwners(db, clinicId, phone);
  const matched =
    answer === "other"
      ? undefined
      : owners.find((o) => samePersonLikely(probe, o));
  const owner = matched ?? owners[0] ?? null;
  if (owner && answer === "same") {
    return { kind: "use", card: owner, verifyClaim: false };
  }
  if (matched) {
    return { kind: "use", card: matched, verifyClaim: false };
  }
  const sharers = await findContactSharers(db, clinicId, phone);
  const sharer = sharers.find((s) => samePersonLikely(probe, s));
  if (sharer) return { kind: "use", card: sharer, verifyClaim: false };
  if (owner) {
    return answer === "other"
      ? { kind: "create", asContact: true }
      : { kind: "ask", owner: summary(owner, false) };
  }

  const claim = await findPhoneClaim(db, clinicId, phone);
  if (claim && answer === "same") {
    return { kind: "use", card: claim, verifyClaim: true };
  }
  if (claim && answer !== "other") {
    return { kind: "ask", owner: summary(claim, true) };
  }
  return { kind: "create", asContact: false };
}
