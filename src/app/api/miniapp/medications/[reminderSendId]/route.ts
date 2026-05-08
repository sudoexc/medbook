/**
 * Phase 16 Wave 3 — Mini App medication reminder response.
 *
 * POST /api/miniapp/medications/:reminderSendId
 *   Body: `{ action: "TAKEN" | "SKIPPED" | "SNOOZED", snoozeMinutes?: 30 }`
 *
 * Marks the open reminder. Idempotency: a row already in a terminal state
 * (TAKEN/SKIPPED/EXPIRED) returns 409 with `reason: "already_responded"`.
 *
 * SNOOZED bumps `snoozeUntil` to `now + snoozeMinutes` (default 30, max
 * 240). The worker re-surfaces the row once the snooze elapses.
 *
 * Ownership: the active context must own the reminder (clinicId + patientId
 * scope check). Family-context responses use `?onBehalfOf=` like every
 * other Mini App route.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { err, forbidden, notFound, ok } from "@/server/http";
import {
  createMiniAppHandler,
  type MiniAppContext,
} from "@/server/miniapp/handler";

const ActionSchema = z.object({
  action: z.enum(["TAKEN", "SKIPPED", "SNOOZED"]),
  snoozeMinutes: z.number().int().min(5).max(240).optional(),
});

const QuerySchema = z.object({
  onBehalfOf: z.string().optional(),
});

function parseOnBehalfOf(request: Request): string | null {
  const url = new URL(request.url);
  const raw = url.searchParams.get("onBehalfOf");
  const parsed = QuerySchema.safeParse({ onBehalfOf: raw ?? undefined });
  if (!parsed.success) return null;
  return parsed.data.onBehalfOf ?? null;
}

async function resolveEffectivePatient(
  ctx: MiniAppContext,
  onBehalfOf: string | null,
): Promise<string | null> {
  if (!onBehalfOf || onBehalfOf === ctx.patientId) return ctx.patientId;
  const link = await prisma.patientFamily.findFirst({
    where: {
      clinicId: ctx.clinicId,
      ownerPatientId: ctx.patientId,
      linkedPatientId: onBehalfOf,
    },
    select: { id: true },
  });
  return link ? onBehalfOf : null;
}

export const POST = createMiniAppHandler(
  { bodySchema: ActionSchema },
  async ({ request, body, ctx }) => {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const reminderSendId = segments[segments.length - 1] ?? "";
    if (!reminderSendId) return err("missing_id", 400);

    const onBehalfOf = parseOnBehalfOf(request);
    const effectivePatientId = await resolveEffectivePatient(ctx, onBehalfOf);
    if (!effectivePatientId) return forbidden();

    const reminder = await prisma.medicationReminderSend.findFirst({
      where: {
        id: reminderSendId,
        clinicId: ctx.clinicId,
        patientId: effectivePatientId,
      },
      select: {
        id: true,
        status: true,
        prescriptionId: true,
      },
    });
    if (!reminder) return notFound();

    if (
      reminder.status === "TAKEN" ||
      reminder.status === "SKIPPED" ||
      reminder.status === "EXPIRED"
    ) {
      return err("already_responded", 409, {
        reason: "already_responded",
        status: reminder.status,
      });
    }

    const typedBody = body as z.infer<typeof ActionSchema>;
    const now = new Date();

    let updateData: Record<string, unknown>;
    if (typedBody.action === "SNOOZED") {
      const minutes = typedBody.snoozeMinutes ?? 30;
      updateData = {
        status: "SNOOZED",
        snoozeUntil: new Date(now.getTime() + minutes * 60 * 1000),
        respondedAt: now,
      };
    } else {
      updateData = {
        status: typedBody.action,
        respondedAt: now,
      };
    }

    const updated = await prisma.medicationReminderSend.update({
      where: { id: reminder.id },
      data: updateData,
      select: {
        id: true,
        status: true,
        snoozeUntil: true,
        respondedAt: true,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.MEDICATION_REMINDER_RESPONDED,
      entityType: "MedicationReminderSend",
      entityId: updated.id,
      meta: {
        prescriptionId: reminder.prescriptionId,
        patientId: effectivePatientId,
        action: typedBody.action,
        snoozeMinutes:
          typedBody.action === "SNOOZED"
            ? (typedBody.snoozeMinutes ?? 30)
            : null,
      },
    });

    return ok({
      ok: true,
      id: updated.id,
      status: updated.status,
      snoozeUntil: updated.snoozeUntil?.toISOString() ?? null,
      respondedAt: updated.respondedAt?.toISOString() ?? null,
    });
  },
);
