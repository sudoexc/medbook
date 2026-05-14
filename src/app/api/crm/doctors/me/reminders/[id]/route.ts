/**
 * PATCH  /api/crm/doctors/me/reminders/[id] — transition a reminder.
 * DELETE /api/crm/doctors/me/reminders/[id] — soft-delete (= DISMISSED).
 *
 * Transitions land here:
 *   PENDING/SNOOZED → DONE      (doctor checked it off)
 *   PENDING/SNOOZED → DISMISSED (won't do, or replaced by another reminder)
 *   PENDING         → SNOOZED   (push to a later remindAt; body must include
 *                                the new `remindAt`)
 *   * → PENDING                 (re-open after accidental DONE/DISMISSED)
 *
 * SNOOZED doesn't reset to a new model — we just update `remindAt` so the
 * 24h horizon filter on GET surfaces it at the new time.
 *
 * SSE: `reminder.updated`. Audit: REMINDER_COMPLETED / REMINDER_DISMISSED /
 * REMINDER_SNOOZED depending on the new status. No-op transitions (status
 * unchanged) skip the audit row to avoid noise.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
import { ok, err, notFound } from "@/server/http";

const PatchBody = z.object({
  status: z.enum(["PENDING", "DONE", "DISMISSED", "SNOOZED"]).optional(),
  remindAt: z.string().datetime({ offset: true }).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().max(5000).optional().nullable(),
});

function reminderIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/me/reminders/{id}
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = reminderIdFromUrl(request);
    if (!id) return err("BadRequest", 400, { reason: "missing_id" });

    const existing = await prisma.reminder.findFirst({
      where: { id, doctorId: ctx.userId },
      select: {
        id: true,
        status: true,
        title: true,
        body: true,
        remindAt: true,
        patientId: true,
      },
    });
    if (!existing) return notFound();

    // SNOOZE requires a future remindAt — guard so a doctor can't snooze
    // to the past and silently flip back into the 24h horizon.
    if (body.status === "SNOOZED") {
      if (!body.remindAt) {
        return err("BadRequest", 400, { reason: "snooze_requires_remindAt" });
      }
      if (new Date(body.remindAt).getTime() <= Date.now()) {
        return err("BadRequest", 400, { reason: "snooze_remindAt_must_be_future" });
      }
    }

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.body !== undefined) data.body = body.body;
    if (body.remindAt !== undefined) data.remindAt = new Date(body.remindAt);
    if (body.status !== undefined) {
      data.status = body.status;
      data.completedAt = body.status === "DONE" ? new Date() : null;
    }

    if (Object.keys(data).length === 0) {
      return err("BadRequest", 400, { reason: "no_fields_to_update" });
    }

    const updated = await prisma.reminder.update({
      where: { id },
      data,
      select: {
        id: true,
        title: true,
        body: true,
        remindAt: true,
        status: true,
        completedAt: true,
        patientId: true,
        appointmentId: true,
      },
    });

    // Audit only meaningful status transitions — title-only edits are
    // captured by the row's updatedAt timestamp + AuditLog can be added
    // later if needed.
    if (body.status && body.status !== existing.status) {
      const actionByStatus: Record<string, string | null> = {
        DONE: AUDIT_ACTION.REMINDER_COMPLETED,
        DISMISSED: AUDIT_ACTION.REMINDER_DISMISSED,
        SNOOZED: AUDIT_ACTION.REMINDER_SNOOZED,
        PENDING: null,
      };
      const action = actionByStatus[body.status];
      if (action) {
        await audit(request, {
          action,
          entityType: "Reminder",
          entityId: updated.id,
          meta: {
            doctorId: ctx.userId,
            oldStatus: existing.status,
            newStatus: body.status,
            remindAt: updated.remindAt.toISOString(),
          },
        });
      }
    }

    publishEventSafe(ctx.clinicId, {
      type: "reminder.updated",
      payload: {
        reminderId: updated.id,
        doctorId: ctx.userId,
        patientId: updated.patientId,
      },
    });

    return ok({
      id: updated.id,
      title: updated.title,
      body: updated.body,
      remindAt: updated.remindAt.toISOString(),
      status: updated.status,
      completedAt: updated.completedAt ? updated.completedAt.toISOString() : null,
      patientId: updated.patientId,
      appointmentId: updated.appointmentId,
    });
  },
);

export const DELETE = createApiHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = reminderIdFromUrl(request);
    if (!id) return err("BadRequest", 400, { reason: "missing_id" });

    const existing = await prisma.reminder.findFirst({
      where: { id, doctorId: ctx.userId },
      select: { id: true, status: true, patientId: true },
    });
    if (!existing) return notFound();

    // Soft-delete = DISMISSED. Doctors expect "удалить" to wipe the
    // reminder from their list, but we keep the row for audit history.
    await prisma.reminder.update({
      where: { id },
      data: { status: "DISMISSED" },
    });

    if (existing.status !== "DISMISSED") {
      await audit(request, {
        action: AUDIT_ACTION.REMINDER_DISMISSED,
        entityType: "Reminder",
        entityId: id,
        meta: {
          doctorId: ctx.userId,
          oldStatus: existing.status,
          newStatus: "DISMISSED",
          source: "delete",
        },
      });
    }

    publishEventSafe(ctx.clinicId, {
      type: "reminder.updated",
      payload: {
        reminderId: id,
        doctorId: ctx.userId,
        patientId: existing.patientId,
      },
    });

    return ok({ ok: true });
  },
);
