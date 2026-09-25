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
 * The stamps and side effects live in `src/server/actions/outcome.ts`, shared
 * with the per-appointment risk-today endpoint.
 *
 * RBAC: ADMIN, RECEPTIONIST, DOCTOR (mirrors done/dismiss).
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { OutcomeActionSchema } from "@/server/schemas/action";
import { actionIdFromUrl } from "@/server/actions/handler-utils";
import {
  applyOutcomeToAppointment,
  outcomeStamp,
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
    const input = {
      outcome: body.outcome,
      note: body.note?.trim() || null,
      callbackAt: body.callbackAt ? new Date(body.callbackAt) : null,
    };

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
      data: outcomeStamp(before, input, ctx.userId, now),
    });

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
      },
    });

    return ok({ action: after, domain });
  },
);
