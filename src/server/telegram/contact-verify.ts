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
 *     identity of a clinic card nobody's Telegram is bound to, the account
 *     moves to THAT card, and the empty card the Mini App auto-created on
 *     first open is retired. If that auto card already holds history
 *     (visits booked in the Mini App, family links...), both stay as they
 *     are and reception gets a task to merge them by hand;
 *   - a card that merely CLAIMED the number (typed into the Mini App by some
 *     other account) loses it.
 * A clinic card already bound to a different Telegram account is never
 * taken over: that is reception's call.
 */
import { prisma } from "@/lib/prisma";
import { phoneSearchVariants } from "@/lib/phone";
import { runWithTenant } from "@/lib/tenant-context";
import {
  canonicalPhone,
  isRealPhone,
  isRetirableAutoCard,
  isUniqueViolation,
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

type ConflictToRaise = {
  telegramCard: { id: string; fullName: string };
  clinicCard: { id: string; fullName: string };
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
        const holder = await tx.patient.findFirst({
          where: {
            clinicId,
            phoneNormalized: { in: variants },
            deletedAt: null,
          },
          select: {
            id: true,
            fullName: true,
            telegramId: true,
            telegramLinkedAt: true,
            phoneVerifiedAt: true,
          },
        });

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
              toRaise = { telegramCard: sender, clinicCard: holder };
            }
            return {
              kind: "conflict",
              patientId: sender?.id ?? null,
              clinicCardId: holder.id,
            };
          }
          let retiredPatientId: string | null = null;
          if (sender) {
            if (!(await isRetirableAutoCard(tx, sender.id))) {
              // The auto card already holds history: two records of one
              // person. Merging them is a human decision.
              toRaise = { telegramCard: sender, clinicCard: holder };
              return {
                kind: "conflict",
                patientId: sender.id,
                clinicCardId: holder.id,
              };
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
              meta: { telegramId: tgId, retiredPatientId },
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
        via: "contact",
      });
    }
    return result;
  });
}

/** Bot reply key (server/telegram/messages.ts) for each outcome. */
export function contactReplyKey(result: ContactVerifyResult): string {
  switch (result.kind) {
    case "verified":
      return "contact.verified";
    case "linked":
      return "contact.linked";
    case "conflict":
      return "contact.conflict";
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
