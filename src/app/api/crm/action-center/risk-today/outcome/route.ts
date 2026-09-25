/**
 * POST /api/crm/action-center/risk-today/outcome — record what a risk-today
 * call resolved to, addressed by APPOINTMENT (audit AC-04).
 *
 * Body: `{ appointmentId, outcome, note?, callbackAt? }` (see
 * `RiskOutcomeSchema`). The risk-today row is one appointment that may carry
 * several risk Actions or none, so the server resolves them instead of the
 * client looping over Action ids; `recordRiskOutcome` documents the rules.
 *
 * Responses: 200 with the stamped rows; 404 for an appointment outside the
 * clinic; 409 when the appointment refused the side effect (e.g. «Подтвердил»
 * on a visit someone already cancelled), with nothing recorded.
 *
 * RBAC: ADMIN, RECEPTIONIST, DOCTOR (mirrors /api/crm/actions/[id]/outcome).
 */
import { createApiHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { recordRiskOutcome } from "@/server/actions/risk-outcome";
import { RiskOutcomeSchema } from "@/server/schemas/action";
import { conflict, err, notFound, ok } from "@/server/http";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: RiskOutcomeSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);

    const input = {
      outcome: body.outcome,
      note: body.note?.trim() || null,
      callbackAt: body.callbackAt ? new Date(body.callbackAt) : null,
    };
    const now = new Date();
    const result = await recordRiskOutcome({
      clinicId: ctx.clinicId,
      actorId: ctx.userId,
      appointmentId: body.appointmentId,
      input,
      now,
    });
    if (!result.ok) {
      if (result.reason === "not_found") return notFound();
      return conflict(result.detail);
    }

    for (const a of result.actions) {
      await audit(request, {
        action: AUDIT_ACTION.ACTION_OUTCOME,
        entityType: "Action",
        entityId: a.id,
        meta: {
          type: a.type,
          appointmentId: result.appointmentId,
          outcome: input.outcome,
          note: input.note,
          callbackAt: input.callbackAt?.toISOString() ?? null,
          oldStatus: a.oldStatus,
          newStatus: a.newStatus,
          callAttempts: a.callAttempts,
          createdForOutcome: a.id === result.createdActionId,
        },
      });
    }
    if (result.contactBumped) {
      await audit(request, {
        action: AUDIT_ACTION.PATIENT_CONTACT_MARKED,
        entityType: "Patient",
        entityId: result.patientId,
        meta: {
          appointmentId: result.appointmentId,
          surface: "action-center.risk-today",
          outcome: input.outcome,
          at: now.toISOString(),
        },
      });
    }

    return ok({
      appointmentId: result.appointmentId,
      actions: result.actions,
      domain: result.domain,
    });
  },
);
