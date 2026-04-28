/**
 * /api/crm/conversations/[id]/messages — list + send.
 * See docs/TZ.md §6.4.
 *
 * POST creates an OUT Message row, dispatches it to the channel (Telegram
 * for tg conversations) and updates the parent Conversation. Inline
 * keyboards are forwarded as Telegram inline_keyboard markup.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, parseQuery } from "@/server/http";
import {
  QueryMessagesSchema,
  SendMessageSchema,
} from "@/server/schemas/message";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";
import { sendMessage } from "@/server/telegram/send";

function conversationIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../conversations/[id]/messages
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const conversationId = conversationIdFromUrl(request);
    const parsed = parseQuery(request, QueryMessagesSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
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
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        channel: true,
        externalId: true,
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

    const senderId = ctx.kind === "TENANT" ? ctx.userId : null;

    const msg = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          direction: "OUT",
          body: body.body,
          attachments: body.attachments ?? null,
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
          lastMessageText: body.body.slice(0, 500),
        },
      });
      return created;
    });

    let dispatched = msg;
    if (conv.channel === "TG" && conv.externalId) {
      try {
        const inlineKeyboard = Array.isArray(body.buttons)
          ? (body.buttons as Array<
              Array<{ text: string; callback_data?: string; url?: string }>
            >)
          : null;
        const sent = await sendMessage(
          conv.clinic,
          conv.externalId,
          body.body,
          inlineKeyboard
            ? { reply_markup: { inline_keyboard: inlineKeyboard } }
            : {},
        );
        dispatched = await prisma.message.update({
          where: { id: msg.id },
          data: {
            status: "SENT",
            externalId: String(sent.message_id),
          },
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error(
          `[crm:send] tg dispatch failed conv=${conversationId}: ${reason}`,
        );
        dispatched = await prisma.message.update({
          where: { id: msg.id },
          data: { status: "FAILED" },
        });
      }
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
          preview: body.body.slice(0, 200),
        },
      });
    }
    return ok(dispatched, 201);
  }
);
