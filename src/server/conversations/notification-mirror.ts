/**
 * Reminders and broadcasts in the patient's dialog (audit G6-08).
 *
 * The bot sends a reminder («Завтра в 10:00 ждём вас») or a broadcast
 * («Скидка 20% на массаж») through the notification worker, which only
 * called Telegram. The patient answers «Не смогу» or «А сколько стоит?», and
 * the operator saw the answer in the inbox without what it answered.
 *
 * After Telegram accepts a notification, its text is copied into the
 * patient's thread as an OUT message with no sender (the bot) and an
 * `origin` («Рассылка» / «Уведомление» on the bubble), and the thread's last
 * message moves to it, as in the patient's own Telegram. The thread is the
 * one of the chat the message went to (find or create by the chat id); a
 * thread the clinic opened from the card before the patient ever wrote
 * adopts the chat, as a staff message does.
 *
 * It never touches `unreadCount` or «Неотвеченные»: a reminder answers
 * nobody's question. Once per delivery: `Message.notificationSendId` is
 * unique. Best effort for the caller: the message is already with the
 * patient, a failed copy must not fail the delivery.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { publishEventSafe } from "@/server/realtime/publish";

export type MessageOrigin = "broadcast" | "notification";

export type NotificationMirrorInput = {
  clinicId: string;
  sendId: string;
  patientId: string | null;
  /** Telegram chat the notification went to (`NotificationSend.recipient`). */
  chatId: string;
  /** The body as sent, Telegram HTML (`parse_mode: "HTML"`). */
  body: string;
  campaignId: string | null;
  sentAt: Date;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Telegram HTML (what the notification worker sends) to the plain text the
 * chat bubble shows: line breaks kept, tags dropped, entities decoded.
 */
export function telegramHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1] === "x" || code[1] === "X"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .trim();
}

function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "P2002";
}

/** The thread for this chat: the bot chat's own, a card thread, or a new one. */
async function threadFor(input: NotificationMirrorInput): Promise<string> {
  const own = await prisma.conversation.findFirst({
    where: { clinicId: input.clinicId, externalId: input.chatId },
    select: { id: true },
  });
  if (own) return own.id;

  if (input.patientId) {
    const card = await prisma.conversation.findFirst({
      where: {
        clinicId: input.clinicId,
        patientId: input.patientId,
        channel: "TG",
        externalId: null,
      },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    if (card) {
      // The message reached this chat, so the patient's reply will come from
      // it: let the card thread own it (a unique race leaves it as is).
      await prisma.conversation
        .updateMany({
          where: { id: card.id, externalId: null },
          data: { externalId: input.chatId },
        })
        .catch(() => undefined);
      return card.id;
    }
  }

  const created = await prisma.conversation.upsert({
    where: {
      clinicId_externalId: { clinicId: input.clinicId, externalId: input.chatId },
    },
    create: {
      clinicId: input.clinicId,
      channel: "TG",
      mode: "bot",
      status: "OPEN",
      externalId: input.chatId,
      patientId: input.patientId,
    },
    update: {},
    select: { id: true },
  });
  return created.id;
}

/**
 * Copy a delivered notification into the patient's dialog. Returns the new
 * message id, or null when it was already copied or could not be.
 */
export async function mirrorNotificationToConversation(
  input: NotificationMirrorInput,
): Promise<string | null> {
  const text = telegramHtmlToText(input.body);
  if (!text || !input.chatId) return null;
  const origin: MessageOrigin = input.campaignId ? "broadcast" : "notification";

  try {
    return await runWithTenant({ kind: "SYSTEM" }, async () => {
      const conversationId = await threadFor(input);
      let messageId: string;
      try {
        const row = await prisma.message.create({
          data: {
            clinicId: input.clinicId,
            conversationId,
            direction: "OUT",
            body: text,
            status: "SENT",
            senderId: null,
            origin,
            notificationSendId: input.sendId,
            createdAt: input.sentAt,
          },
          select: { id: true },
        });
        messageId = row.id;
      } catch (e) {
        // Already copied (a re-run of the same delivery).
        if (isUniqueViolation(e)) return null;
        throw e;
      }
      // Only move «last message» forward: a patient's reply that raced in
      // stays the thread's last line.
      await prisma.conversation.updateMany({
        where: {
          id: conversationId,
          OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: input.sentAt } }],
        },
        data: {
          lastMessageAt: input.sentAt,
          lastMessageText: previewOf(text),
        },
      });

      // One reminder: the open chat shows it at once. A broadcast reaches
      // hundreds of threads in a row, and an event per copy would refetch
      // every open inbox hundreds of times; its copies surface on the list's
      // regular refresh instead.
      if (origin === "notification") {
        publishEventSafe(input.clinicId, {
          type: "tg.message.new",
          payload: {
            conversationId,
            messageId,
            direction: "OUT",
            preview: previewOf(text).slice(0, 200),
            patientId: input.patientId,
          },
        });
      }
      return messageId;
    });
  } catch (e) {
    console.warn(
      `[notifications] dialog copy failed send=${input.sendId}: ${(e as Error).message}`,
    );
    return null;
  }
}
