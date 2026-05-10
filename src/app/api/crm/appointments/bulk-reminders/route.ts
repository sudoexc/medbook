/**
 * /api/crm/appointments/bulk-reminders — fan out manual reminders.
 *
 * Body: `{ appointmentIds: string[]; trigger?: "appointment.reminder-24h"
 *        | "appointment.reminder-5h" | "appointment.reminder-2h" }`.
 *
 * Materialises one NotificationSend row per appointment via the existing
 * bulk helper (idempotent on (appointmentId, templateId) — re-clicks won't
 * double-send), then directly enqueues each newly-created row on
 * `notifications:send` so delivery is immediate instead of waiting for
 * the next scheduler tick.
 *
 * Idempotency rationale: the receptionist often clicks "Remind everyone"
 * after a flurry of new bookings; the existing 24h-cascade rows for those
 * patients are already QUEUED, and we don't want to spam. The bulk helper's
 * `(appointmentId, templateId)` skip already covers this.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok } from "@/server/http";
import { materializeForAppointmentsBulk } from "@/server/notifications/triggers";
import { enqueue } from "@/server/queue";
import {
  JOB_NAME as SEND_JOB,
  QUEUE_NAME as SEND_QUEUE,
} from "@/server/workers/notifications-send";

const TriggerKeySchema = z.enum([
  "appointment.reminder-24h",
  "appointment.reminder-5h",
  "appointment.reminder-2h",
]);

export const BulkRemindersSchema = z.object({
  appointmentIds: z.array(z.string().min(1)).min(1).max(500),
  trigger: TriggerKeySchema.default("appointment.reminder-2h"),
});

const MAX_DISPATCH = 500;

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: BulkRemindersSchema,
  },
  async ({ request, body, ctx }) => {
    const now = new Date();

    // Tenant scope: refuse IDs outside the caller's clinic. We don't trust
    // the client-supplied list — a stale tab could theoretically forward an
    // appointment ID from another clinic.
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const scoped = await prisma.appointment.findMany({
      where: {
        id: { in: body.appointmentIds },
        ...(clinicId ? { clinicId } : {}),
      },
      select: { id: true },
    });
    const allowedIds = scoped.map((a) => a.id);

    const jobs = allowedIds.map((id) => ({
      appointmentId: id,
      scheduledFor: now,
    }));

    const result = await materializeForAppointmentsBulk(jobs, body.trigger);

    // Pull the rows we just created so we can dispatch immediately. We can't
    // know which ones bulk-helper actually created (it does skipDuplicates),
    // so we read back QUEUED rows for these appointments + scheduledFor=now.
    // The window is ±5s to absorb clock skew.
    const cutoff = new Date(now.getTime() - 5_000);
    const fresh = await prisma.notificationSend.findMany({
      where: {
        appointmentId: { in: allowedIds },
        status: "QUEUED",
        scheduledFor: { gte: cutoff },
      },
      select: { id: true },
      take: MAX_DISPATCH,
    });

    await Promise.all(
      fresh.map((row) => enqueue(SEND_QUEUE, SEND_JOB, { sendId: row.id })),
    );

    await audit(request, {
      action: "appointment.bulk-reminders",
      entityType: "Appointment",
      meta: {
        requested: body.appointmentIds.length,
        scoped: allowedIds.length,
        created: result.created,
        skipped: result.skipped,
        dispatched: fresh.length,
        trigger: body.trigger,
      },
    });

    return ok({
      requested: body.appointmentIds.length,
      scoped: allowedIds.length,
      created: result.created,
      skipped: result.skipped,
      dispatched: fresh.length,
    });
  },
);
