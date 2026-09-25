/**
 * POST /api/crm/actions/[id]/snooze — silence an action until later.
 *
 * Body: `{ until: ISO }` OR `{ preset: '1h' | '4h' | 'tomorrow' | 'next-week' }`.
 *
 * Sets `snoozeUntil` and flips `status='SNOOZED'`. The list endpoint hides
 * rows whose `snoozeUntil > now`; once the timer elapses the row resurfaces
 * automatically. `surfacedAt` moves to that moment, so the returning task
 * sits at the top of its severity rather than at its original insert position
 * (a «1 час» snooze used to come back below five newer rows and miss the
 * reception briefing).
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { SnoozeActionSchema } from "@/server/schemas/action";
import {
  actionIdFromUrl,
  resolveSnoozePreset,
} from "@/server/actions/handler-utils";
import { surfaceMoment } from "@/server/actions/repository";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: SnoozeActionSchema,
  },
  async ({ request, body }) => {
    const id = actionIdFromUrl(request);

    const before = await prisma.action.findUnique({ where: { id } });
    if (!before) return notFound();

    const snoozeUntil = body.until
      ? new Date(body.until)
      : resolveSnoozePreset(body.preset!);

    const after = await prisma.action.update({
      where: { id },
      data: {
        snoozeUntil,
        status: "SNOOZED",
        surfacedAt: surfaceMoment(new Date(), snoozeUntil),
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.ACTION_SNOOZED,
      entityType: "Action",
      entityId: id,
      meta: {
        type: before.type,
        payload: before.payload,
        oldStatus: before.status,
        newStatus: "SNOOZED",
        snoozeUntil: snoozeUntil.toISOString(),
        preset: body.preset ?? null,
      },
    });

    return ok(after);
  },
);
