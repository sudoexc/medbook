/**
 * Which patient card a bot thread belongs to (audit TG-11, TG-07).
 *
 * In a private chat the chat id IS the Telegram user's id, and
 * `Patient.telegramId` is unique per clinic, so the thread of a sender who
 * already has a card here is that card's thread. The webhook used to upsert
 * the thread by chat id and never look at the card: a patient signed into
 * the Mini App wrote to the bot, reception saw an «unknown contact» and
 * created a second card for her, her inbound message reached the Mini App
 * with no patient attached, and every doctor saw her complaint through the
 * unlinked «front door» scope.
 *
 * Only an EMPTY link is filled here. A thread reception tied to a card by
 * hand (a son writing about his mother) keeps that card: the account's own
 * card is a guess, the operator's choice is a decision.
 *
 * Callers run under SYSTEM (the webhook has no tenant), so every query pins
 * `clinicId` itself.
 */
import { prisma } from "@/lib/prisma";

type Db = Pick<typeof prisma, "patient" | "conversation">;

/**
 * The sender's Telegram id when the chat is his private chat with the bot,
 * null for a group (the chat is not one person) or an update with no sender.
 */
export function privateChatSenderId(
  chatId: string,
  fromId: number | undefined,
): string | null {
  if (typeof fromId !== "number") return null;
  const sender = String(fromId);
  return sender === chatId ? sender : null;
}

/**
 * Tie an unlinked thread to the card that owns the sender's Telegram
 * account. Returns the card id when the thread was linked by this call.
 */
export async function linkThreadToSenderCard(
  db: Db,
  input: { clinicId: string; conversationId: string; telegramId: string },
): Promise<string | null> {
  const card = await db.patient.findFirst({
    where: {
      clinicId: input.clinicId,
      telegramId: input.telegramId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!card?.id) return null;
  const res = await db.conversation.updateMany({
    where: {
      id: input.conversationId,
      clinicId: input.clinicId,
      patientId: null,
    },
    data: { patientId: card.id },
  });
  return res.count > 0 ? card.id : null;
}

/**
 * The sender's account was just bound to `patientId` (an invite deep link,
 * or a shared contact that found his clinic card): the chat he is writing
 * in is that patient's thread. When the binding retired the empty card the
 * Mini App had auto-created for the account, that card's threads (the bot
 * chat the webhook tied to it, an in-app chat opened from the Mini App)
 * follow the account to the kept card; otherwise the inbox would keep them
 * on a deleted card and the patient's history would split in two.
 *
 * Returns true when the current thread now belongs to `patientId`.
 */
export async function attachThreadToLinkedCard(
  db: Db,
  input: {
    clinicId: string;
    conversationId: string;
    patientId: string;
    retiredPatientId?: string | null;
  },
): Promise<boolean> {
  if (input.retiredPatientId && input.retiredPatientId !== input.patientId) {
    await db.conversation.updateMany({
      where: { clinicId: input.clinicId, patientId: input.retiredPatientId },
      data: { patientId: input.patientId },
    });
  }
  await db.conversation.updateMany({
    where: {
      id: input.conversationId,
      clinicId: input.clinicId,
      patientId: null,
    },
    data: { patientId: input.patientId },
  });
  const thread = await db.conversation.findFirst({
    where: { id: input.conversationId, clinicId: input.clinicId },
    select: { patientId: true },
  });
  return thread?.patientId === input.patientId;
}
