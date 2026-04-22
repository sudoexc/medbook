/**
 * /api/crm/notifications/sends — list + queue notification sends.
 * See docs/TZ.md §6.4.
 *
 * Phase 1: creates QUEUED NotificationSend rows synchronously. Actual
 * delivery happens in the BullMQ worker (Phase 3a).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, parseQuery } from "@/server/http";
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
    roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"],
    bodySchema: CreateSendSchema,
  },
  async ({ request, body }) => {
    const created = await prisma.notificationSend.create({
      data: {
        templateId: body.templateId ?? null,
        patientId: body.patientId,
        appointmentId: body.appointmentId ?? null,
        channel: body.channel,
        recipient: body.recipient,
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
