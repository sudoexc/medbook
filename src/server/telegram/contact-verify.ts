/**
 * A Telegram account shared its OWN phone number with the clinic bot
 * (audit PH-01, MA-04).
 *
 * This is the only way a number reaches a Telegram-born card: the Mini App
 * calls `Telegram.WebApp.requestContact()`, Telegram posts the contact into
 * the bot chat, and the webhook hands it here. Telegram vouches for the
 * number only when `contact.user_id === message.from.id` (anyone can forward
 * somebody else's contact card), so nothing else is accepted.
 *
 * What the proof does:
 *   - the sender's own card gets the number as VERIFIED identity;
 *   - «I already have a card here» (MA-04): when the number is the verified
 *     identity of a clinic card nobody's Telegram is bound to AND the
 *     account goes by that card's name, the account moves to THAT card.
 *     The card the Mini App auto-created on first open is retired; bookings
 *     made on it that nobody has started yet move along first (a returning
 *     patient usually books before confirming the number). If that auto
 *     card holds real history (visits, documents, family links...), both
 *     stay as they are and reception gets a task to merge them by hand;
 *   - a card that merely CLAIMED the number (typed into the Mini App by some
 *     other account) loses it.
 * The number proves whose PHONE it is, not whose CARD: reception often
 * writes a son's number on his elderly mother's card, and the migration
 * verified every staff-typed number. So a name that does not match the
 * clinic card links nothing: reception gets a task instead (audit Q-03).
 * A clinic card already bound to a different Telegram account is never
 * taken over either: that is reception's call.
 */
import { prisma } from "@/lib/prisma";
import { phoneSearchVariants } from "@/lib/phone";
import { runWithTenant } from "@/lib/tenant-context";
import { nameOrders, sameNameLikely } from "@/lib/patients/identity-match";
import {
  autoCardFootprint,
  canonicalPhone,
  isRealPhone,
  isUniqueViolation,
  moveBookingsToCard,
  releaseUnverifiedPhone,
  retiredCardData,
} from "@/server/patient/phone-identity";
import { raiseTelegramLinkConflict } from "@/server/patient/telegram-link-conflict";

/** The `contact` object of a Telegram message. */
export type SharedContact = {
  phone_number: string;
  first_name?: string;
  last_name?: string;
  user_id?: number;
};

export type ContactVerifyResult =
  /** Somebody else's contact card, or one without a Telegram user behind it. */
  | { kind: "not-own-contact" }
  | { kind: "bad-phone" }
  /** The account has no card in this clinic yet (never opened the Mini App). */
  | { kind: "no-card" }
  /** The number is now the verified identity of the sender's own card. */
  | { kind: "verified"; patientId: string }
  /** The account moved to the clinic's existing card. */
  | { kind: "linked"; patientId: string; retiredPatientId: string | null }
  /** The sender's card already has a different verified number; kept. */
  | { kind: "kept-existing"; patientId: string }
  /** Needs reception: nothing was relinked. */
  | { kind: "conflict"; patientId: string | null; clinicCardId: string }
  /**
   * The number is a clinic card's identity, but the account does not go by
   * that card's name: nothing was linked, reception checks who it is.
   */
  | { kind: "unconfirmed"; patientId: string; clinicCardId: string }
  /** A concurrent write won the unique index; nothing changed. */
  | { kind: "failed" };

/**
 * Telegram's guarantee: a contact whose `user_id` is the sender's own id is
 * the sender's own number. A forwarded or hand-typed contact card is not.
 */
export function isOwnContact(
  fromId: number | undefined,
  contact: SharedContact | undefined,
): boolean {
  return (
    !!contact &&
    typeof fromId === "number" &&
    typeof contact.user_id === "number" &&
    contact.user_id === fromId
  );
}

/**
 * Does the Telegram account go by the clinic card's name? Telegram writes the
 * given name first («Dilnoza Karimova»), the clinic the surname first, and
 * the card the Mini App keeps for the account carries either (it starts as
 * the Telegram name; the booking form lets the patient correct it). Strict
 * like the walk-in check: a surname or an initial alone is not a match.
 */
export function accountNameMatches(
  contact: SharedContact,
  senderCardName: string | null,
  clinicCardName: string,
): boolean {
  const names: string[] = [];
  const fromTelegram = [contact.first_name, contact.last_name]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join(" ");
  if (fromTelegram) names.push(...nameOrders(fromTelegram));
  if (senderCardName) names.push(...nameOrders(senderCardName));
  return names.some((n) => sameNameLikely(n, clinicCardName));
}

type ContactHolder = {
  id: string;
  fullName: string;
  phoneVerifiedAt: Date | null;
};

/**
 * Which card holding the shared number the proof is about. Usually one.
 * Since the lookup reaches both shapes of a number (LD-10), a pre-LD-10
 * «+334125567» card and a newer «+998334125567» card, often a mother and
 * her son, can both hold it, and an unordered pick answered the son's own
 * card with a conflict about his mother's. In order:
 *   1. the sender's own card when it already holds the number verified;
 *   2. a verified card that goes by the account's name: her clinic card
 *      wins over the claim her Mini App card made on the other shape, so
 *      the usual «I already have a card here» checks run instead of a
 *      second verified card of one person;
 *   3. the sender's own claim, which the proof now verifies;
 *   4. the oldest verified card (someone else's: reception decides);
 *   5. somebody else's claim, which the proof takes away.
 */
export function pickContactHolder<T extends ContactHolder>(
  holders: T[],
  sender: { id: string; fullName: string } | null,
  contact: SharedContact,
): T | null {
  const own = sender ? holders.find((h) => h.id === sender.id) : undefined;
  if (own && own.phoneVerifiedAt !== null) return own;
  const verified = holders.filter((h) => h.phoneVerifiedAt !== null);
  const byName = verified.find((h) =>
    accountNameMatches(contact, sender?.fullName ?? null, h.fullName),
  );
  return byName ?? own ?? verified[0] ?? holders[0] ?? null;
}

type ConflictToRaise = {
  telegramCard: { id: string; fullName: string };
  clinicCard: { id: string; fullName: string };
  /** "contactName": the number matched, the name did not. */
  /** "contactConfirm": number and name match, but the card holds history. */
  via: "contact" | "contactName" | "contactConfirm";
};

export async function applyVerifiedContact(input: {
  clinicId: string;
  fromId: number | undefined;
  fromUsername?: string | null;
  contact: SharedContact | undefined;
  now?: Date;
}): Promise<ContactVerifyResult> {
  if (!isOwnContact(input.fromId, input.contact)) {
    return { kind: "not-own-contact" };
  }
  const phone = canonicalPhone(input.contact!.phone_number);
  if (!phone) return { kind: "bad-phone" };
  const variants = phoneSearchVariants(phone);
  const tgId = String(input.fromId);
  const now = input.now ?? new Date();
  const { clinicId } = input;

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    let toRaise: ConflictToRaise | null = null;
    let result: ContactVerifyResult;
    try {
      result = await prisma.$transaction(async (tx) => {
        const sender = await tx.patient.findFirst({
          where: { clinicId, telegramId: tgId },
          select: {
            id: true,
            fullName: true,
            phoneNormalized: true,
            phoneVerifiedAt: true,
          },
        });
        const holders = await tx.patient.findMany({
          where: {
            clinicId,
            phoneNormalized: { in: variants },
            deletedAt: null,
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fullName: true,
            telegramId: true,
            telegramLinkedAt: true,
            phoneVerifiedAt: true,
          },
        });
        const holder = pickContactHolder(holders, sender, input.contact!);

        // The sender's own card already carries the number: now proven.
        if (holder && sender && holder.id === sender.id) {
          if (!holder.phoneVerifiedAt) {
            await tx.patient.update({
              where: { id: holder.id },
              data: { phoneVerifiedAt: now },
            });
          }
          return { kind: "verified", patientId: sender.id };
        }

        // The number is the verified identity of the clinic's own card.
        if (holder && holder.phoneVerifiedAt) {
          if (holder.telegramId) {
            // Bound to another Telegram account: never taken over here.
            if (sender) {
              toRaise = { telegramCard: sender, clinicCard: holder, via: "contact" };
            }
            return {
              kind: "conflict",
              patientId: sender?.id ?? null,
              clinicCardId: holder.id,
            };
          }
          // A card that already holds a person's medicine is never handed to
          // a Telegram account on a number + name match alone: the name is
          // whatever the sender typed into Telegram or the Mini App, and a
          // family member with the SIM can type the right one. Reception
          // confirms (and links through the card's invite) instead.
          if (await cardHoldsHistory(tx, holder.id)) {
            if (!sender) return { kind: "no-card" };
            toRaise = { telegramCard: sender, clinicCard: holder, via: "contactConfirm" };
            return { kind: "unconfirmed", patientId: sender.id, clinicCardId: holder.id };
          }
          if (!accountNameMatches(input.contact!, sender?.fullName ?? null, holder.fullName)) {
            // His own number on someone else's card (his mother's, his
            // child's): moving the account there would show him her
            // conclusions and book his visits into her record. Nothing is
            // linked; reception sees both names and decides.
            if (!sender) return { kind: "no-card" };
            toRaise = { telegramCard: sender, clinicCard: holder, via: "contactName" };
            return { kind: "unconfirmed", patientId: sender.id, clinicCardId: holder.id };
          }
          let retiredPatientId: string | null = null;
          let movedAppointmentIds: string[] = [];
          if (sender) {
            const footprint = await autoCardFootprint(tx, sender.id);
            if (footprint === "history") {
              // The auto card already holds history: two records of one
              // person. Merging them is a human decision.
              toRaise = { telegramCard: sender, clinicCard: holder, via: "contact" };
              return {
                kind: "conflict",
                patientId: sender.id,
                clinicCardId: holder.id,
              };
            }
            if (footprint === "bookings") {
              // Booked in the Mini App before confirming the number: the
              // visits belong on the card with her history, where the
              // doctor will look and reception will call.
              movedAppointmentIds = await moveBookingsToCard(
                tx,
                clinicId,
                sender.id,
                holder.id,
              );
            }
            // Free the telegramId before the clinic card takes it (one card
            // per account is a unique index).
            await tx.patient.update({
              where: { id: sender.id },
              data: retiredCardData(holder.id, sender.id, now),
            });
            retiredPatientId = sender.id;
          }
          await tx.patient.update({
            where: { id: holder.id },
            data: {
              telegramId: tgId,
              telegramUsername: input.fromUsername ?? null,
              tgBlockedAt: null,
              ...(holder.telegramLinkedAt ? {} : { telegramLinkedAt: now }),
            },
          });
          await tx.auditLog.create({
            data: {
              clinicId,
              action: "patient.telegram.contact_linked",
              entityType: "Patient",
              entityId: holder.id,
              meta: { telegramId: tgId, retiredPatientId, movedAppointmentIds },
            },
          });
          return { kind: "linked", patientId: holder.id, retiredPatientId };
        }

        // Only an unverified claim holds the number: the proof beats it.
        if (holder) {
          await releaseUnverifiedPhone(tx, clinicId, phone, "telegram_contact");
        }
        if (!sender) return { kind: "no-card" };
        if (
          isRealPhone(sender.phoneNormalized) &&
          sender.phoneVerifiedAt !== null &&
          !variants.includes(sender.phoneNormalized)
        ) {
          // The clinic recorded another number for this patient. A shared
          // contact does not silently overwrite it; reception can.
          return { kind: "kept-existing", patientId: sender.id };
        }
        await tx.patient.update({
          where: { id: sender.id },
          data: { phone, phoneNormalized: phone, phoneVerifiedAt: now },
        });
        await tx.auditLog.create({
          data: {
            clinicId,
            action: "patient.phone_verified_telegram",
            entityType: "Patient",
            entityId: sender.id,
            meta: { phone, telegramId: tgId },
          },
        });
        return { kind: "verified", patientId: sender.id };
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return { kind: "failed" };
    }

    const conflict = toRaise as ConflictToRaise | null;
    if (conflict) {
      await raiseTelegramLinkConflict({
        clinicId,
        telegramId: tgId,
        telegramCard: conflict.telegramCard,
        clinicCard: conflict.clinicCard,
        via: conflict.via,
      });
    }
    return result;
  });
}

/**
 * Whether a clinic card already carries a person's record: any visit, note
 * or document. Such a card is linked to a Telegram account only by the
 * reception (invite link), never by a shared contact alone.
 */
async function cardHoldsHistory(
  tx: { patient: { findFirst: (args: never) => Promise<unknown> } },
  patientId: string,
): Promise<boolean> {
  const row = (await tx.patient.findFirst({
    where: { id: patientId },
    select: {
      _count: { select: { appointments: true, visitNotes: true, documents: true } },
    },
  } as never)) as { _count?: Record<string, number | undefined> } | null;
  if (!row) return true;
  return Object.values(row._count ?? {}).some((n) => (n ?? 0) > 0);
}

/** Bot reply key (server/telegram/messages.ts) for each outcome. */
export function contactReplyKey(result: ContactVerifyResult): string {
  switch (result.kind) {
    case "verified":
      return "contact.verified";
    case "linked":
      return "contact.linked";
    // One neutral answer whatever the reason: telling the sender that the
    // name differs, or that the card is bound elsewhere, reveals who the
    // number belongs to.
    case "conflict":
    case "unconfirmed":
      return "contact.pending";
    case "kept-existing":
      return "contact.keptExisting";
    case "not-own-contact":
      return "contact.notOwn";
    case "no-card":
      return "contact.noCard";
    case "bad-phone":
    case "failed":
      return "common.error";
  }
}
