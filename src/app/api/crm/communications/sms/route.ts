/**
 * /api/crm/communications/sms — outbound SMS stub.
 * See docs/TZ.md §6.4.
 *
 * Phase 1: logs an OUT Communication row only. The real SMS dispatcher
 * (EskizSMS / PlaySMS) plugs in here later — we'd enqueue a BullMQ job and
 * record the provider messageId in `meta`.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok } from "@/server/http";
import { SendSmsSchema } from "@/server/schemas/communication";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"],
    bodySchema: SendSmsSchema,
  },
  async ({ request, body }) => {
    const comm = await prisma.communication.create({
      data: {
        patientId: body.patientId ?? null,
        channel: "SMS",
        direction: "OUT",
        subject: null,
        body: body.body,
        meta: { phone: body.phone, stub: true },
      } as never,
    });
    await audit(request, {
      action: "communication.sms.send",
      entityType: "Communication",
      entityId: comm.id,
      meta: { phone: body.phone },
    });
    return ok({ id: comm.id, status: "queued" }, 202);
  }
);
