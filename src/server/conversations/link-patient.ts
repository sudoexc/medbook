/**
 * Reception tied a Telegram thread to a patient card from the inbox's right
 * rail (audit TG-11).
 *
 * The rail used to write only `Conversation.patientId`. The card itself
 * never learned its Telegram account, so the patient reception had just
 * identified still got no reminders («нет канала» in the Action Center),
 * dropped out of broadcasts, and his next message landed in an unlinked
 * thread again. A private chat's id IS the Telegram user's id, so the
 * thread already carries the account: it is written onto the card here.
 *
 * The P1 identity rules hold (audit MA-04, PH-01): one card per account per
 * clinic (a unique index), and an account already bound to another card is
 * never taken from it silently.
 *   - The card is bound to a different account: kept as it is. The thread is
 *     still linked (reception's call about whose conversation it is) and the
 *     operator is told.
 *   - The account sits on the empty card the Mini App auto-created for it:
 *     that card is retired and its threads follow, as an invite would do.
 *   - The account sits on a card with real history: nothing is relinked,
 *     reception gets a TELEGRAM_LINK_CONFLICT task to merge the two cards,
 *     and the operator is told which card holds it.
 */
import { prisma } from "@/lib/prisma";
import {
  isRetirableAutoCard,
  isUniqueViolation,
  retiredCardData,
} from "@/server/patient/phone-identity";
import { raiseTelegramLinkConflict } from "@/server/patient/telegram-link-conflict";

export type ThreadTelegramLink =
  /** The card already holds this thread's account. */
  | { kind: "already-linked" }
  /** The account is now the card's Telegram. */
  | { kind: "linked"; retiredPatientId: string | null }
  /** The card is bound to another Telegram account; left untouched. */
  | { kind: "card-has-other-telegram" }
  /** The account belongs to another card with history; a task was raised. */
  | {
      kind: "telegram-on-other-card";
      otherPatientId: string;
      otherPatientName: string;
    };

/**
 * The Telegram account a thread talks to, or null. Only a private chat
 * qualifies: its id is the user's id (positive), a group's is negative, and
 * a thread opened from the card with no bot chat yet has no id at all.
 */
export function threadTelegramId(conv: {
  channel: string;
  externalId: string | null;
}): string | null {
  if (conv.channel !== "TG" || !conv.externalId) return null;
  return /^[1-9]\d{0,19}$/.test(conv.externalId) ? conv.externalId : null;
}

export async function bindThreadTelegramToCard(input: {
  clinicId: string;
  patientId: string;
  telegramId: string;
  telegramUsername?: string | null;
  actorId: string | null;
  now?: Date;
}): Promise<ThreadTelegramLink | null> {
  const now = input.now ?? new Date();
  const { clinicId, telegramId } = input;

  const card = await prisma.patient.findFirst({
    where: { id: input.patientId, clinicId, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      telegramId: true,
      telegramLinkedAt: true,
    },
  });
  if (!card) return null;
  if (card.telegramId === telegramId) return { kind: "already-linked" };
  if (card.telegramId) return { kind: "card-has-other-telegram" };

  const other = await prisma.patient.findFirst({
    where: { clinicId, telegramId, id: { not: card.id } },
    select: { id: true, fullName: true },
  });
  if (other && !(await isRetirableAutoCard(prisma, other.id))) {
    await raiseTelegramLinkConflict({
      clinicId,
      telegramId,
      telegramCard: other,
      clinicCard: { id: card.id, fullName: card.fullName },
      via: "inbox",
    });
    return {
      kind: "telegram-on-other-card",
      otherPatientId: other.id,
      otherPatientName: other.fullName,
    };
  }

  try {
    await prisma.$transaction([
      // Retire first: the account must be free before the card takes it.
      ...(other
        ? [
            prisma.patient.update({
              where: { id: other.id },
              data: retiredCardData(card.id, other.id, now),
            }),
          ]
        : []),
      prisma.patient.update({
        where: { id: card.id },
        data: {
          telegramId,
          telegramUsername: input.telegramUsername ?? undefined,
          // First-link timestamp drives the «+N за неделю» trend; never moved.
          ...(card.telegramLinkedAt ? {} : { telegramLinkedAt: now }),
        },
      }),
    ]);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // The account's first Mini App open created a card between the lookup
    // and the write. Nothing changed; the operator sees who holds it.
    const raced = await prisma.patient.findFirst({
      where: { clinicId, telegramId },
      select: { id: true, fullName: true },
    });
    return {
      kind: "telegram-on-other-card",
      otherPatientId: raced?.id ?? "",
      otherPatientName: raced?.fullName ?? "",
    };
  }

  if (other) {
    // The retired card's threads (its bot chat, an in-app chat) are this
    // patient's now.
    await prisma.conversation.updateMany({
      where: { clinicId, patientId: other.id },
      data: { patientId: card.id },
    });
  }

  try {
    await prisma.auditLog.create({
      data: {
        clinicId,
        actorId: input.actorId,
        action: "patient.telegram.inbox_linked",
        entityType: "Patient",
        entityId: card.id,
        meta: { telegramId, retiredPatientId: other?.id ?? null },
      },
    });
  } catch (auditErr) {
    console.warn("[conversation.link-patient] audit failed", auditErr);
  }

  return { kind: "linked", retiredPatientId: other?.id ?? null };
}
