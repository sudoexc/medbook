/**
 * /api/miniapp/conversations/[id]/messages — list + send (patient side).
 *
 * GET: paginate the thread newest-first; client flips to chronological for
 *      display. Throws 404 if the conversation isn't owned by this patient.
 * POST: append an inbound (`direction: "IN"`) Message authored by the
 *       patient. No outbound dispatch — the patient is already in the bot
 *       Mini App, so there is no TG leg to fire. We still publish
 *       `tg.message.new` so the CRM inbox lights up for staff.
 */
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { runWithTenant } from "@/lib/tenant-context";
import { err, ok } from "@/server/http";
import { publishEventSafe } from "@/server/realtime/publish";
import { resolveMiniAppContext } from "@/server/miniapp/handler";

const PAGE_LIMIT_DEFAULT = 50;
const PAGE_LIMIT_MAX = 100;
const MAX_BODY_LEN = 4000;

const SendBodySchema = z.object({
  body: z.string().min(1).max(MAX_BODY_LEN),
});

function conversationIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../conversations/[id]/messages
  return parts[parts.length - 2] ?? "";
}

async function loadOwnedConversation(
  conversationId: string,
  clinicId: string,
  patientId: string,
) {
  if (!conversationId) return null;
  return prisma.conversation.findFirst({
    where: { id: conversationId, clinicId, patientId },
    select: { id: true, channel: true, mode: true, status: true },
  });
}

export async function GET(request: Request): Promise<Response> {
  const resolved = await resolveMiniAppContext(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const conversationId = conversationIdFromUrl(request);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const conv = await loadOwnedConversation(
      conversationId,
      ctx.clinicId,
      ctx.patientId,
    );
    if (!conv) return err("NotFound", 404, { reason: "conversation_not_found" });

    const url = new URL(request.url);
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, PAGE_LIMIT_MAX)
      : PAGE_LIMIT_DEFAULT;
    const cursor = url.searchParams.get("cursor");

    const take = limit + 1;
    const rows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        direction: true,
        body: true,
        attachments: true,
        status: true,
        createdAt: true,
        senderId: true,
        sender: { select: { id: true, name: true } },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    return ok({ messages: rows, nextCursor });
  });
}

export async function POST(request: Request): Promise<Response> {
  const resolved = await resolveMiniAppContext(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const conversationId = conversationIdFromUrl(request);

  let body: { body: string };
  try {
    const raw = await request.json();
    const parsed = SendBodySchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }
    body = parsed.data;
  } catch {
    return err("InvalidJson", 400);
  }

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const conv = await loadOwnedConversation(
      conversationId,
      ctx.clinicId,
      ctx.patientId,
    );
    if (!conv) return err("NotFound", 404, { reason: "conversation_not_found" });

    const preview = body.body.slice(0, 500);

    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          clinicId: ctx.clinicId,
          conversationId: conv.id,
          direction: "IN",
          body: body.body,
          senderId: null,
          status: "DELIVERED",
        } satisfies Prisma.MessageUncheckedCreateInput,
        select: {
          id: true,
          direction: true,
          body: true,
          status: true,
          createdAt: true,
          senderId: true,
        },
      });
      await tx.conversation.update({
        where: { id: conv.id },
        data: {
          lastMessageAt: new Date(),
          lastMessageText: preview,
          unreadCount: { increment: 1 },
        },
      });
      return msg;
    });

    await audit(request, {
      action: AUDIT_ACTION.MINIAPP_MESSAGE_SENT,
      entityType: "Message",
      entityId: created.id,
      meta: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        conversationId: conv.id,
        bytes: body.body.length,
      },
    });

    publishEventSafe(ctx.clinicId, {
      type: "tg.message.new",
      payload: {
        conversationId: conv.id,
        messageId: created.id,
        direction: "IN",
        preview,
      },
    });

    return ok({ message: created }, 201);
  });
}
