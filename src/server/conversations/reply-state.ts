/**
 * «Неотвеченные» in the Telegram inbox (audit G6-03).
 *
 * The tab used to filter on `unreadCount > 0`. Opening a chat marks it read,
 * so the thread vanished from the tab (and from the chat pane) a second after
 * the operator clicked it, before anyone had answered; a second receptionist
 * merely entering the section «read» the freshest thread for everyone.
 * Reading a question is not answering it, so the thread carries its own
 * state: `Conversation.awaitingReplySince`, the oldest patient message no
 * staff reply has followed yet.
 *
 *   - set by an inbound that needs a person (not a bot command such as
 *     /start, not a shared contact, not a doctor's dictation to his own
 *     SOAP draft): the webhook and the Mini App chat;
 *   - cleared by a staff reply that reached the patient (the send worker)
 *     or by «Ответ не нужен» in the chat menu, for a «Спасибо!» that needs
 *     no answer.
 *
 * Bot replies and automatic messages (reminders, broadcasts) do not clear
 * it: a welcome menu or «ждём вас завтра» is not an answer to «можно
 * перенести?».
 */

import type { prisma } from "@/lib/prisma";
import { DOCTOR_DICTATION_LABEL } from "@/server/telegram/inbound-media";

type ConversationWriter = Pick<typeof prisma, "conversation">;
type ConversationReader = Pick<typeof prisma, "conversation" | "message">;

/**
 * `Message.origin` of an inbound shared contact. The row's body is the bare
 * phone number, so the stored row needs this to be told apart from a typed
 * message when a later reply asks what is still waiting.
 */
export const CONTACT_ORIGIN = "contact";

export type InboundKind = {
  text?: string | null;
  /** A shared contact (the Mini App's «Подтвердить номер»): identity, not chat. */
  hasContact?: boolean;
  /** The sender is a doctor dictating to his SOAP draft. */
  doctorDictation?: boolean;
};

/** Whether an inbound Telegram message waits for a person to answer it. */
export function inboundNeedsReply(input: InboundKind): boolean {
  if (input.doctorDictation) return false;
  if (input.hasContact) return false;
  // Bot commands (/start, /start <invite>, /help) are answered by the bot.
  if ((input.text ?? "").trim().startsWith("/")) return false;
  return true;
}

/**
 * The thread now waits for a reply. Keeps the OLDEST waiting message: a
 * patient writing three times in a row has been waiting since the first.
 */
export async function markAwaitingReply(
  db: ConversationWriter,
  conversationId: string,
  at: Date,
): Promise<void> {
  await db.conversation.updateMany({
    where: { id: conversationId, awaitingReplySince: null },
    data: { awaitingReplySince: at },
  });
}

/** Whether a stored inbound row waits for a person, as the webhook decided. */
export function storedInboundNeedsReply(row: {
  body: string | null;
  origin?: string | null;
}): boolean {
  return inboundNeedsReply({
    text: row.body,
    hasContact: row.origin === CONTACT_ORIGIN,
    doctorDictation: row.body === DOCTOR_DICTATION_LABEL,
  });
}

/**
 * A staff reply written at `repliedAt` reached the patient. Only questions
 * asked before it are answered by it: a message the patient sent while the
 * reply was still in the queue keeps the thread waiting, from that message.
 */
export async function clearAwaitingReply(
  db: ConversationReader,
  conversationId: string,
  repliedAt: Date,
): Promise<void> {
  const later = await db.message.findMany({
    where: {
      conversationId,
      direction: "IN",
      createdAt: { gt: repliedAt },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, body: true, origin: true },
    take: 20,
  });
  const stillWaiting = later.find(storedInboundNeedsReply);
  await db.conversation.updateMany({
    where: { id: conversationId, awaitingReplySince: { lte: repliedAt } },
    data: { awaitingReplySince: stillWaiting?.createdAt ?? null },
  });
}

/** Prisma filter for the «Неотвеченные» tab. */
export function unansweredWhere(): Record<string, unknown> {
  return { awaitingReplySince: { not: null } };
}
