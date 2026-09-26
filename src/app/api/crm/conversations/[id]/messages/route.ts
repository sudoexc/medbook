/**
 * /api/crm/conversations/[id]/messages — list + send.
 * See docs/TZ.md §6.4.
 *
 * POST creates an OUT Message row, dispatches it to the channel (Telegram
 * for tg conversations) and updates the parent Conversation. Inline
 * keyboards are forwarded as Telegram inline_keyboard markup.
 *
 * A message is SENT only when Telegram accepted it, FAILED with a reason
 * code otherwise; it is never DELIVERED without a send (audit TG-04), and
 * never SENT through a clinic whose bot is disconnected.
 * Attachments must belong to this conversation (audit G6-01).
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
import { sendMessage, sendPhoto, sendDocumentUrl } from "@/server/telegram/send";
import { tgFailReason } from "@/server/telegram/send-errors";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import {
  adoptTelegramChat,
  clinicBotConnected,
  isOwnChatAttachmentUrl,
  telegramChatIdFor,
} from "@/server/conversations/staff-send";

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

    let dispatched = msg;
    // Where in Telegram this goes. A thread the clinic opened from the patient
    // card has no bot chat id yet (`externalId` null) and used to be marked
    // DELIVERED with nothing sent, the patient never saw it (audit TG-04). A
    // private chat's id is the user's id, so the card's telegramId reaches it.
    const chatId = telegramChatIdFor(conv);
    if (conv.channel === "TG" && !clinicBotConnected(conv.clinic.tgBotToken)) {
      // No bot: send.ts would answer with a made up message id and the row
      // would read SENT (and adopt the chat) while the patient got nothing.
      dispatched = await prisma.message.update({
        where: { id: msg.id },
        data: { status: "FAILED", failedReason: "bot_not_connected" },
      });
    } else if (conv.channel === "TG" && !chatId) {
      dispatched = await prisma.message.update({
        where: { id: msg.id },
        data: { status: "FAILED", failedReason: "no_telegram" },
      });
    } else if (conv.channel === "TG" && chatId) {
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

        let lastResult: { message_id: number } | null = null;
        if (attachments.length > 0) {
          // Caption rides on the first attachment; the inline keyboard on the
          // last. Images → sendPhoto, everything else → sendDocument (by URL).
          for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            const isLast = i === attachments.length - 1;
            const caption =
              i === 0 && body.body && body.body.length > 0 ? body.body : undefined;
            const opts = isLast ? replyMarkup : {};
            const url = absolute(att.url);
            const r =
              att.kind === "image"
                ? await sendPhoto(conv.clinic, chatId, url, caption, opts)
                : await sendDocumentUrl(conv.clinic, chatId, url, caption, opts);
            if (r && typeof r === "object" && "message_id" in r) {
              lastResult = r as { message_id: number };
            }
          }
        } else {
          const sent = await sendMessage(
            conv.clinic,
            chatId,
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
        if (!conv.externalId) await adoptTelegramChat(conv.id, chatId);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error(
          `[crm:send] tg dispatch failed conv=${conversationId}: ${reason}`,
        );
        const failedReason = tgFailReason(reason);
        // «Never pressed Start» on a thread with no bot chat yet is the
        // Mini App in-app chat: the reply is stored and pushed to the Mini
        // App over SSE, so the patient reads it there. That is delivered,
        // not «не доставлено»; the missed DM is kept as the reason. A
        // blocked bot or any other failure stays FAILED (audit TG-04).
        const inAppOnly =
          !conv.externalId &&
          conv.channel === "TG" &&
          failedReason === "tg_not_started";
        dispatched = await prisma.message.update({
          where: { id: msg.id },
          data: inAppOnly
            ? { status: "DELIVERED", failedReason }
            : { status: "FAILED", failedReason },
        });
        // Same fallback block signal as the notification worker: reachability
        // counters and broadcast audiences drop the patient.
        if (failedReason === "tg_blocked" && conv.patientId) {
          await prisma.patient
            .updateMany({
              where: { id: conv.patientId, tgBlockedAt: null },
              data: { tgBlockedAt: new Date() },
            })
            .catch(() => undefined);
        }
      }
    } else if (conv.channel === "SMS") {
      // Legacy SMS conversation — SMS channel was removed (see
      // docs/TZ-sms-removal.md). New replies cannot be dispatched; mark
      // FAILED so the operator switches to the patient's TG/Call instead
      // of leaving the row stuck QUEUED forever.
      dispatched = await prisma.message.update({
        where: { id: msg.id },
        data: { status: "FAILED", failedReason: "channel_unavailable" },
      });
    }

    if (dispatched.status === "SENT" && conv.patientId) {
      await bumpPatientLastContact(conv.patientId, dispatched.createdAt);
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
        },
      });
    }
    return ok(dispatched, 201);
  }
);
