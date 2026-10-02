/**
 * /api/crm/conversations/[id]/messages — list + send.
 * See docs/TZ.md §6.4.
 *
 * POST creates an OUT Message row QUEUED, updates the parent Conversation
 * and hands the row to the send worker (src/server/conversations/
 * staff-dispatch.ts), answering at once (audit TG-17). The worker sends it
 * and flips it to SENT / FAILED, announced on the realtime bus. Inline
 * keyboards are forwarded as Telegram inline_keyboard markup.
 *
 * A message is SENT only when Telegram accepted it, FAILED with a reason
 * code otherwise; it is never DELIVERED without a send (audit TG-04), and
 * never SENT through a clinic whose bot is disconnected.
 * Attachments must belong to this conversation (audit G6-01). A text with an
 * unfilled template field (`{{patient.firstName}}`) is refused (audit G6-04).
 * A doctor reads and writes only the threads of his caseload, like his inbox
 * list (audit TG-32).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, ok, notFound, parseQuery } from "@/server/http";
import {
  QueryMessagesSchema,
  SendMessageSchema,
} from "@/server/schemas/message";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";
import { conversationAccess } from "@/server/conversations/access";
import { extractPlaceholders } from "@/server/notifications/template";
import { isOwnChatAttachmentUrl } from "@/server/conversations/staff-send";
import {
  enqueueStaffMessage,
  staffSendBlocker,
} from "@/server/conversations/staff-dispatch";

function conversationIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../conversations/[id]/messages
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const conversationId = conversationIdFromUrl(request);
    const parsed = parseQuery(request, QueryMessagesSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const access = await conversationAccess(ctx);
    if (!access) return notFound();
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, ...access.where },
      select: { id: true },
    });
    if (!conv) return notFound();

    const where: Record<string, unknown> = { conversationId };
    if (q.direction) where.direction = q.direction;

    const take = q.limit + 1;
    const rows = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: { sender: { select: { id: true, name: true } } },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({ rows, nextCursor });
  }
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"],
    bodySchema: SendMessageSchema,
  },
  async ({ request, body, ctx }) => {
    const conversationId = conversationIdFromUrl(request);
    const access = await conversationAccess(ctx);
    if (!access) return notFound();
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, ...access.where },
      select: {
        id: true,
        channel: true,
        externalId: true,
        patientId: true,
        patient: { select: { phone: true, telegramId: true } },
        clinic: {
          select: {
            id: true,
            slug: true,
            tgBotToken: true,
            tgBotUsername: true,
          },
        },
      },
    });
    if (!conv) return notFound();

    // A template field never reaches the patient as braces (audit G6-04).
    // The composer fills templates on the server; a text that still carries
    // `{{...}}` (a template pasted by hand, a quick reply naming a field it
    // could not fill) is refused with the fields, before anything is saved.
    const unfilled = extractPlaceholders(body.body ?? "");
    if (unfilled.length > 0) {
      return err("UnfilledPlaceholders", 422, { fields: unfilled });
    }

    const senderId = ctx.kind === "TENANT" ? ctx.userId : null;

    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    // A file goes out only from the conversation it was uploaded into. The
    // composer once kept patient A's MRI in the draft after the operator
    // switched to patient B, and this route sent it on (audit G6-01).
    const foreign = attachments.filter(
      (a) =>
        !isOwnChatAttachmentUrl(a.url, {
          clinicId: conv.clinic.id,
          conversationId: conv.id,
        }),
    );
    if (foreign.length > 0) {
      return err("AttachmentNotInConversation", 400, {
        count: foreign.length,
      });
    }
    const imageCount = attachments.filter((a) => a.kind === "image").length;
    const fileCount = attachments.length - imageCount;
    const attachmentPreview = (): string => {
      if (imageCount > 0 && fileCount === 0)
        return imageCount === 1 ? "📷 Фото" : `📷 Фото: ${imageCount}`;
      if (fileCount > 0 && imageCount === 0)
        return fileCount === 1 ? "📎 Файл" : `📎 Файлы: ${fileCount}`;
      return `📎 Вложения: ${attachments.length}`;
    };
    const previewText =
      body.body && body.body.length > 0
        ? body.body
        : attachments.length > 0
          ? attachmentPreview()
          : "";

    const msg = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          direction: "OUT",
          body: body.body,
          attachments: attachments.length > 0 ? attachments : null,
          buttons: body.buttons ?? null,
          senderId,
          replyToId: body.replyToId ?? null,
          status: "QUEUED",
        } as never,
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          lastMessageText: previewText.slice(0, 500),
        },
      });
      return created;
    });

    // Telegram is called by the send worker, never inside this request
    // (audit TG-17): over the slow egress a send could take two minutes,
    // nginx answered 504 and the operator sent the message again. What is
    // known without Telegram (no bot, no chat, a legacy SMS thread) is
    // answered right here.
    let dispatched = msg;
    const blocker = staffSendBlocker(conv);
    if (blocker) {
      dispatched = await prisma.message.update({
        where: { id: msg.id },
        data: { status: "FAILED", failedReason: blocker },
      });
    } else {
      await enqueueStaffMessage({
        messageId: msg.id,
        publicBase: new URL(request.url).origin,
      });
    }

    await audit(request, {
      action: "message.send",
      entityType: "Message",
      entityId: msg.id,
      meta: { conversationId },
    });

    const tenant = getTenant();
    const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      publishEventSafe(clinicId, {
        type: "tg.message.new",
        payload: {
          conversationId,
          messageId: dispatched.id,
          direction: "OUT",
          preview: previewText.slice(0, 200),
          // Route the operator's reply to the patient's in-app chat via the
          // patient-scoped mini-app SSE filter (legacy v1 event → payload is
          // the only patient hint).
          patientId: conv.patientId,
          status: dispatched.status,
          failedReason: dispatched.failedReason ?? null,
        },
      });
    }
    return ok(dispatched, 201);
  }
);
