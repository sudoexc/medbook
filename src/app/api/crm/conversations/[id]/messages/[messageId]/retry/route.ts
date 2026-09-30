/**
 * POST /api/crm/conversations/[id]/messages/[messageId]/retry — «Повторить»
 * on a staff message that did not reach the patient (audit TG-17).
 *
 * The failed row itself goes back to the queue, so the chat shows one
 * message, not the failure plus a copy. It moves to the bottom of the thread
 * (createdAt = now): the patient receives it now, and the order in the CRM
 * stays the order in the patient's Telegram. Only a FAILED staff message
 * qualifies; the conditional FAILED→QUEUED update makes a double click queue
 * it once. A thread that still cannot send (no bot, no chat) answers with the
 * reason at once, the row stays FAILED.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, notFound, ok } from "@/server/http";
import { publishEventSafe } from "@/server/realtime/publish";
import {
  enqueueStaffMessage,
  staffSendBlocker,
} from "@/server/conversations/staff-dispatch";

function idsFromUrl(request: Request): {
  conversationId: string;
  messageId: string;
} {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../conversations/[id]/messages/[messageId]/retry
  return {
    conversationId: parts[parts.length - 4] ?? "",
    messageId: parts[parts.length - 2] ?? "",
  };
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const { conversationId, messageId } = idsFromUrl(request);
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    if (!clinicId) return notFound();

    const msg = await prisma.message.findFirst({
      where: { id: messageId, conversationId, clinicId },
      select: {
        id: true,
        direction: true,
        senderId: true,
        origin: true,
        status: true,
        body: true,
      },
    });
    if (!msg) return notFound();
    // Only what a person wrote: the bot's replies and the copies of
    // reminders and broadcasts are not the operator's to resend.
    if (msg.direction !== "OUT" || !msg.senderId || msg.origin) {
      return err("NotRetryable", 409, { reason: "not_staff_message" });
    }
    if (msg.status !== "FAILED") {
      return err("NotRetryable", 409, { reason: "not_failed", status: msg.status });
    }

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, clinicId },
      select: {
        id: true,
        channel: true,
        externalId: true,
        patientId: true,
        patient: { select: { telegramId: true } },
        clinic: { select: { tgBotToken: true } },
      },
    });
    if (!conv) return notFound();

    const blocker = staffSendBlocker(conv);
    if (blocker) {
      const row = await prisma.message.update({
        where: { id: msg.id },
        data: { failedReason: blocker },
      });
      return ok(row);
    }

    const requeued = await prisma.message.updateMany({
      where: { id: msg.id, status: "FAILED" },
      data: { status: "QUEUED", failedReason: null, createdAt: new Date() },
    });
    if (requeued.count !== 1) {
      return err("NotRetryable", 409, { reason: "not_failed" });
    }
    await enqueueStaffMessage({
      messageId: msg.id,
      publicBase: new URL(request.url).origin,
    });

    await audit(request, {
      action: "message.retry",
      entityType: "Message",
      entityId: msg.id,
      meta: { conversationId },
    });

    const row = await prisma.message.findUnique({ where: { id: msg.id } });
    publishEventSafe(clinicId, {
      type: "tg.message.new",
      payload: {
        conversationId,
        messageId: msg.id,
        direction: "OUT",
        preview: (msg.body ?? "").slice(0, 200),
        patientId: conv.patientId,
        status: row?.status ?? "QUEUED",
      },
    });
    return ok(row);
  },
);
