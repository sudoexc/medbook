/**
 * /api/crm/appointments/bulk-reminders — «Напомнить всем» on the
 * Appointments page.
 *
 * Body: `{ appointmentIds: string[] }`.
 *
 * Sends one staff reminder per upcoming, not-yet-arrived appointment through
 * its own MANUAL template (`materializeManualReminders`) and dispatches
 * exactly the rows that call created.
 *
 * Why not a cascade band (audit AP-02): the button used to ask for the
 * retired -120 band, found no template, created nothing, and then enqueued
 * «every QUEUED row of these appointments scheduled from now on», i.e. the
 * day's FUTURE cascade rows. The worker did not check `scheduledFor`, so
 * «через 3 часа, в 16:00» went out at 09:00, the real reminder was spent, and
 * the toast still reported success. Cascade rows are no longer touched here,
 * and the worker now refuses rows that are not yet due.
 *
 * Idempotent: at most one manual reminder per appointment, so a second click
 * reminds nobody twice.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, ok } from "@/server/http";
import { materializeManualReminders } from "@/server/notifications/triggers";
import { enqueue } from "@/server/queue";
import {
  JOB_NAME as SEND_JOB,
  QUEUE_NAME as SEND_QUEUE,
} from "@/server/workers/notifications-send";

const BulkRemindersSchema = z.object({
  appointmentIds: z.array(z.string().min(1)).min(1).max(500),
});

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: BulkRemindersSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const now = new Date();

    // Tenant scope: refuse IDs outside the caller's clinic. We don't trust
    // the client-supplied list — a stale tab could theoretically forward an
    // appointment ID from another clinic.
    const scoped = await prisma.appointment.findMany({
      where: { id: { in: body.appointmentIds }, clinicId: ctx.clinicId },
      select: { id: true },
    });
    const allowedIds = scoped.map((a) => a.id);

    const result = await materializeManualReminders({
      clinicId: ctx.clinicId,
      appointmentIds: allowedIds,
      now,
    });

    // Only the rows created above: never another row of these appointments.
    await Promise.all(
      result.sendIds.map((id) => enqueue(SEND_QUEUE, SEND_JOB, { sendId: id })),
    );

    await audit(request, {
      action: "appointment.bulk-reminders",
      entityType: "Appointment",
      meta: {
        requested: body.appointmentIds.length,
        scoped: allowedIds.length,
        reminded: result.reminded,
        skipped: result.skipped,
        noChannel: result.noChannel,
        dispatched: result.sendIds.length,
        templateDisabled: result.templateDisabled,
      },
    });

    return ok({
      requested: body.appointmentIds.length,
      scoped: allowedIds.length,
      reminded: result.reminded,
      skipped: result.skipped,
      noChannel: result.noChannel,
      templateDisabled: result.templateDisabled,
    });
  },
);
