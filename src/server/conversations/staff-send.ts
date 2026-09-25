/**
 * Rules for a staff message leaving the CRM chat
 * (POST /api/crm/conversations/[id]/messages).
 *
 * Two audit findings live here:
 *
 *   • TG-04: a thread the clinic opens from the patient card («Написать в
 *     Telegram», the doctor's «Написать пациенту») has no inbound message
 *     yet, so `externalId` (the bot chat id) was null and the route marked
 *     every message DELIVERED without sending anything. In a private chat
 *     the chat id IS the user's id, which the card already holds as
 *     `telegramId`, so the message can simply be sent there.
 *
 *   • G6-01: an attachment is a capability URL minted for ONE conversation.
 *     The composer used to carry a file picked in patient A's chat over to
 *     patient B's, and the route sent whatever URL the body named. Only a
 *     file uploaded into this very conversation may go out from it.
 */
import { prisma } from "@/lib/prisma";

/** The Telegram chat a message in this thread goes to, or null if none. */
export function telegramChatIdFor(conv: {
  channel: string;
  externalId: string | null;
  patient: { telegramId: string | null } | null;
}): string | null {
  if (conv.channel !== "TG") return null;
  return conv.externalId ?? conv.patient?.telegramId ?? null;
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const SAFE_FILE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]{1,8})?$/;

/**
 * True only for a chat attachment stored under THIS conversation:
 *   - the storage proxy `/api/crm/conversations/<id>/attachments/file?key=
 *     clinics/<clinic>/chat/<id>/<file>` (both the path id and the key), or
 *   - the dev stub `/uploads/chat/<clinic>/<id>/<file>`.
 * Anything else (another conversation's file, an outside URL for Telegram
 * to fetch) is refused.
 */
export function isOwnChatAttachmentUrl(
  url: string,
  scope: { clinicId: string; conversationId: string },
): boolean {
  const { clinicId, conversationId } = scope;
  if (!SAFE_SEGMENT.test(clinicId) || !SAFE_SEGMENT.test(conversationId)) {
    return false;
  }
  // Relative only: the upload route never hands out an absolute URL.
  if (!url.startsWith("/") || url.startsWith("//")) return false;
  let parsed: URL;
  try {
    parsed = new URL(url, "http://local.invalid");
  } catch {
    return false;
  }
  if (parsed.host !== "local.invalid") return false;

  const stub = `/uploads/chat/${clinicId}/${conversationId}/`;
  if (parsed.pathname.startsWith(stub)) {
    return SAFE_FILE.test(parsed.pathname.slice(stub.length)) && !parsed.search;
  }

  if (
    parsed.pathname !==
    `/api/crm/conversations/${conversationId}/attachments/file`
  ) {
    return false;
  }
  const key = parsed.searchParams.get("key") ?? "";
  const prefix = `clinics/${clinicId}/chat/${conversationId}/`;
  return key.startsWith(prefix) && SAFE_FILE.test(key.slice(prefix.length));
}

/**
 * Let a thread the clinic opened adopt the patient's chat id once a message
 * reached it, so the patient's reply lands in the same thread instead of a
 * new one. Best effort: another thread may already own that chat (unique
 * `(clinicId, externalId)`), in which case nothing changes.
 */
export async function adoptTelegramChat(
  conversationId: string,
  chatId: string,
): Promise<void> {
  try {
    await prisma.conversation.updateMany({
      where: { id: conversationId, externalId: null },
      data: { externalId: chatId },
    });
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code !== "P2002") {
      console.warn(
        `[crm:send] adopt chat failed conv=${conversationId}: ${(e as Error).message}`,
      );
    }
  }
}
