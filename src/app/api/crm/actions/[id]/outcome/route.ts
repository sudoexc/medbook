/**
 * POST /api/crm/actions/[id]/outcome — record what a risk-today call resolved
 * to (TZ-risk-outcomes §4). Unlike the bare `done` route, each of the six
 * outcomes drives the RIGHT durable domain action so the row behaves
 * predictably and the client never silently vanishes:
 *
 *   CONFIRMED     → confirmAppointment(via INBOUND_CALL) + Action DONE(outcome)
 *   RESCHEDULED   → Action DONE(outcome)  (the reschedule itself happens in the
 *                   dialog; this just records + closes the row)
 *   CALLBACK      → Action SNOOZED until callbackAt (+ note), or, when that is
 *                   at or after the visit, a PATIENT_CALLBACK task
 *   RETURN_LATER  → cancelAppointment + a PATIENT_CALLBACK task on the
 *                   return day (409 `return_day_not_later` otherwise)
 *   REFUSED       → cancelAppointment(reason=note) + Action DONE(outcome)
 *   NO_ANSWER     → callAttempts++, SNOOZED a short while; escalate at the cap
 *
 * The outcome + `expiresAt` also LOCK the row against the 15-min engine
 * recompute (see repository.upsertAction) so a handled row stops bouncing back.
 * The stamps and side effects live in `src/server/actions/outcome.ts`, shared
 * with the per-appointment risk-today endpoint.
 *
 * RBAC: ADMIN, RECEPTIONIST, DOCTOR (mirrors done/dismiss).
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { conflict, ok, err, notFound } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { OutcomeActionSchema } from "@/server/schemas/action";
import { actionIdFromUrl } from "@/server/actions/handler-utils";
import {
  applyOutcomeToAppointment,
  callbackOutlivesVisit,
  normalizeOutcomeInput,
  outcomeStamp,
  returnDayIsLater,
  scheduleCallbackTask,
} from "@/server/actions/outcome";

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
    const input = normalizeOutcomeInput({
      outcome: body.outcome,
      note: body.note?.trim() || null,
      callbackAt: body.callbackAt ? new Date(body.callbackAt) : null,
    });

    // The visit the call is about decides whether a promised call outlives
    // it (audit AC-09, see `server/actions/outcome.ts`).
    const appt = appointmentId
      ? await prisma.appointment.findUnique({
          where: { id: appointmentId },
          select: {
            id: true,
            date: true,
            patientId: true,
            patient: { select: { fullName: true } },
            doctor: { select: { nameRu: true } },
          },
        })
      : null;
    if (appt && !returnDayIsLater(input, appt.date)) {
      return conflict("return_day_not_later");
    }
    const handedOff = appt ? callbackOutlivesVisit(input, appt.date) : false;

    // ── Domain side-effect per outcome (confirm / cancel) ───────────────────
    const domain = appointmentId
      ? await applyOutcomeToAppointment({
          outcome: input.outcome,
          appointmentId,
          clinicId: ctx.clinicId,
          actorId: ctx.userId,
          note: input.note,
        })
      : null;

    const after = await prisma.action.update({
      where: { id },
      data: outcomeStamp(before, input, ctx.userId, now, { handedOff }),
    });
    const callback =
      appt && handedOff
        ? await scheduleCallbackTask(prisma, {
            clinicId: ctx.clinicId,
            appointment: {
              id: appt.id,
              date: appt.date,
              patientId: appt.patientId,
              patientName: appt.patient.fullName,
              doctorName: appt.doctor?.nameRu ?? "",
            },
            input,
          })
        : null;

    await audit(request, {
      action: AUDIT_ACTION.ACTION_OUTCOME,
      entityType: "Action",
      entityId: id,
      meta: {
        type: before.type,
        appointmentId,
        outcome: input.outcome,
        note: input.note,
        callbackAt: input.callbackAt?.toISOString() ?? null,
        oldStatus: before.status,
        newStatus: after.status,
        callAttempts: after.callAttempts,
        callbackActionId: callback?.id ?? null,
      },
    });

    return ok({ action: after, domain });
  },
);
