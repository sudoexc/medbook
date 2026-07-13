/**
 * POST /api/crm/actions/[id]/outcome — record what a risk-today call resolved
 * to (TZ-risk-outcomes §4). Unlike the bare `done` route, each of the six
 * outcomes drives the RIGHT durable domain action so the row behaves
 * predictably and the client never silently vanishes:
 *
 *   CONFIRMED     → confirmAppointment(via INBOUND_CALL) + Action DONE(outcome)
 *   RESCHEDULED   → Action DONE(outcome)  (the reschedule itself happens in the
 *                   dialog; this just records + closes the row)
 *   CALLBACK      → Action SNOOZED until callbackAt (+ note) — resurfaces then
 *   RETURN_LATER  → Action SNOOZED until the return date (+ note)
 *   REFUSED       → cancelAppointment(reason=note) + Action DONE(outcome)
 *   NO_ANSWER     → callAttempts++, SNOOZED a short while; escalate at the cap
 *
 * The outcome + `expiresAt` also LOCK the row against the 15-min engine
 * recompute (see repository.upsertAction) so a handled row stops bouncing back.
 *
 * RBAC: ADMIN, RECEPTIONIST, DOCTOR (mirrors done/dismiss).
 */
import type { Prisma } from "@/generated/prisma/client";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { OutcomeActionSchema } from "@/server/schemas/action";
import { actionIdFromUrl } from "@/server/actions/handler-utils";
import { confirmAppointment } from "@/server/appointments/confirm";
import { cancelAppointment } from "@/server/appointments/cancel";

/** How long a «не дозвонился» row hides before it resurfaces, and the attempt
 *  cap after which it escalates to a louder severity. */
const NO_ANSWER_SNOOZE_MIN = 120;
const NO_ANSWER_MAX_ATTEMPTS = 3;

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: OutcomeActionSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = actionIdFromUrl(request);

    const before = await prisma.action.findUnique({ where: { id } });
    if (!before) return notFound();

    const payload = before.payload as { appointmentId?: string } | null;
    const appointmentId = payload?.appointmentId ?? null;
    const now = new Date();
    const note = body.note?.trim() || null;
    const callbackAt = body.callbackAt ? new Date(body.callbackAt) : null;

    // Common outcome stamp merged into every write below.
    const stamp: Prisma.ActionUncheckedUpdateInput = {
      outcome: body.outcome,
      outcomeNote: note,
      callbackAt,
      resolvedById: ctx.userId,
    };

    // ── Domain side-effect per outcome ──────────────────────────────────────
    let domain: unknown = null;
    switch (body.outcome) {
      case "CONFIRMED": {
        if (appointmentId) {
          domain = await confirmAppointment({
            appointmentId,
            clinicId: ctx.clinicId,
            actorId: ctx.userId,
            via: "INBOUND_CALL",
          });
        }
        stamp.status = "DONE";
        stamp.doneAt = now;
        break;
      }
      case "REFUSED": {
        if (appointmentId) {
          domain = await cancelAppointment({
            appointmentId,
            clinicId: ctx.clinicId,
            actorId: ctx.userId,
            reason: note ?? "patient:refused-on-call",
          });
        }
        stamp.status = "DONE";
        stamp.doneAt = now;
        break;
      }
      case "RESCHEDULED": {
        // The reschedule itself is done via the appointment dialog (which
        // re-schedules reminders); here we just close + record the row.
        stamp.status = "DONE";
        stamp.doneAt = now;
        break;
      }
      case "CALLBACK":
      case "RETURN_LATER": {
        // Snooze survives the engine recompute — the row resurfaces exactly at
        // callbackAt with the note attached ("перезвонить" / "хотел вернуться").
        stamp.status = "SNOOZED";
        stamp.snoozeUntil = callbackAt;
        break;
      }
      case "NO_ANSWER": {
        const attempts = before.callAttempts + 1;
        stamp.callAttempts = attempts;
        stamp.status = "SNOOZED";
        stamp.snoozeUntil = new Date(
          now.getTime() + NO_ANSWER_SNOOZE_MIN * 60_000,
        );
        if (attempts >= NO_ANSWER_MAX_ATTEMPTS && before.severity !== "critical") {
          stamp.severity = "high";
        }
        break;
      }
    }

    const after = await prisma.action.update({ where: { id }, data: stamp });

    await audit(request, {
      action: AUDIT_ACTION.ACTION_OUTCOME,
      entityType: "Action",
      entityId: id,
      meta: {
        type: before.type,
        appointmentId,
        outcome: body.outcome,
        note,
        callbackAt: callbackAt?.toISOString() ?? null,
        oldStatus: before.status,
        newStatus: after.status,
        callAttempts: after.callAttempts,
      },
    });

    return ok({ action: after, domain });
  },
);
