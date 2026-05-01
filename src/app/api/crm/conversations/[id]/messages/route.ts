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
import { sendMessage, sendPhoto } from "@/server/telegram/send";

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

    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const previewText =
      body.body && body.body.length > 0
        ? body.body
        : attachments.length > 0
          ? `📷 ${attachments.length === 1 ? "Фото" : `${attachments.length} фото`}`
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

    let dispatched = msg;
    if (conv.channel === "TG" && conv.externalId) {
      try {
        const inlineKeyboard = Array.isArray(body.buttons)
          ? (body.buttons as Array<
              Array<{ text: string; callback_data?: string; url?: string }>
            >)
          : null;
        const replyMarkup = inlineKeyboard
          ? { reply_markup: { inline_keyboard: inlineKeyboard } }
          : {};

        // Telegram fetches photos by URL — must be reachable from the public
        // internet. Prefer `TG_WEBHOOK_BASE_URL` (already used for the bot
        // webhook, e.g. an ngrok tunnel in dev) and fall back to the request
        // origin (which is localhost in dev → Telegram returns "wrong file").
        const publicBase =
          process.env.TG_WEBHOOK_BASE_URL?.replace(/\/$/, "") ||
          new URL(request.url).origin;
        const absolute = (u: string) =>
          /^https?:\/\//i.test(u)
            ? u
            : `${publicBase}${u.startsWith("/") ? u : `/${u}`}`;

        const imageAttachments = attachments.filter((a) => a.kind === "image");

        let lastResult: { message_id: number } | null = null;
        if (imageAttachments.length > 0) {
          for (let i = 0; i < imageAttachments.length; i++) {
            const att = imageAttachments[i];
            const isLast = i === imageAttachments.length - 1;
            const caption =
              i === 0 && body.body && body.body.length > 0 ? body.body : undefined;
            const opts = isLast ? replyMarkup : {};
            const r = await sendPhoto(
              conv.clinic,
              conv.externalId,
              absolute(att.url),
              caption,
              opts,
            );
            if (r && typeof r === "object" && "message_id" in r) {
              lastResult = r as { message_id: number };
            }
          }
        } else {
          const sent = await sendMessage(
            conv.clinic,
            conv.externalId,
            body.body,
            replyMarkup,
          );
          if (sent && typeof sent === "object" && "message_id" in sent) {
            lastResult = sent as { message_id: number };
          }
        }

        dispatched = await prisma.message.update({
          where: { id: msg.id },
          data: {
            status: "SENT",
            externalId: lastResult ? String(lastResult.message_id) : null,
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
          preview: previewText.slice(0, 200),
        },
      });
    }
    return ok(dispatched, 201);
  }
);
