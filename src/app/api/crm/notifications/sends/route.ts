/**
 * /api/crm/notifications/sends — list + queue notification sends.
 * See docs/TZ.md §6.4.
 *
 * Phase 1: creates QUEUED NotificationSend rows synchronously. Actual
 * delivery happens in the BullMQ worker (Phase 3a).
 *
 * A manual send is ADMIN only and goes to the patient's own Telegram (audit
 * TG-27). It was open to reception and the call operator with the chat id
 * and the HTML text taken from the request as is: anyone at the desk could
 * send a payment link «from the clinic» to any chat. The worker copies a
 * sent row into the patient's dialog (G6-08), so it is seen in the inbox.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, notFound, ok, parseQuery } from "@/server/http";
import {
  CreateSendSchema,
  QuerySendSchema,
} from "@/server/schemas/notification";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QuerySendSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.channel) where.channel = q.channel;
    if (q.templateId) where.templateId = q.templateId;
    if (q.patientId) where.patientId = q.patientId;
    if (q.from || q.to) {
      where.scheduledFor = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      };
    }

    const take = q.limit + 1;
    const rows = await prisma.notificationSend.findMany({
      where,
      orderBy: { scheduledFor: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        template: { select: { id: true, nameRu: true, nameUz: true } },
      },
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
    roles: ["ADMIN"],
    bodySchema: CreateSendSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    // The patient is one of this clinic's live cards, and a Telegram send
    // goes to his own chat, never to a chat id typed into the request.
    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, clinicId: ctx.clinicId, deletedAt: null },
      select: { id: true, telegramId: true },
    });
    if (!patient) return notFound();
    let recipient = body.recipient?.trim() ?? "";
    if (body.channel === "TG") {
      const own = patient.telegramId?.trim() ?? "";
      if (!own) return err("ValidationError", 400, { reason: "no_telegram" });
      if (recipient && recipient !== own) {
        return err("ValidationError", 400, { reason: "recipient_mismatch" });
      }
      recipient = own;
    } else if (!recipient) {
      return err("ValidationError", 400, { reason: "no_recipient" });
    }
    const created = await prisma.notificationSend.create({
      data: {
        templateId: body.templateId ?? null,
        patientId: patient.id,
        appointmentId: body.appointmentId ?? null,
        channel: body.channel,
        recipient,
        body: body.body,
        scheduledFor: body.scheduledFor,
        status: "QUEUED",
      } as never,
    });
    await audit(request, {
      action: "send.create",
      entityType: "NotificationSend",
      entityId: created.id,
      meta: { after: created },
    });
    return ok(created, 201);
  }
);
