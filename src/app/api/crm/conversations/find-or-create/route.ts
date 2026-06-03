/**
 * POST /api/crm/conversations/find-or-create
 *
 * Reception/admin/nurse/call-operator entrypoint for "open or cold-start a
 * thread to this patient". Doctors keep their dedicated endpoint at
 * `/api/crm/doctors/me/conversations/find-or-create` because they need an
 * anti-leak check against their own caseload — this one accepts any clinic
 * patient because reception sees the full inbox anyway.
 *
 * Both endpoints delegate to the shared kernel `findOrCreateConversation` so
 * the `conversation.created` envelope + audit row land identically regardless
 * of who initiated.
 *
 * Body: { patientId: string }
 * Response: { conversationId, channel, created }
 *         | 404 patient not in clinic
 *         | 422 { error: "NoChannel" } — patient has neither phone nor TG
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { ok, err, notFound } from "@/server/http";
import { findOrCreateConversation } from "@/server/conversations/find-or-create";
import type { ActorRole } from "@/server/realtime/envelope";

const BodySchema = z.object({
  patientId: z.string().min(1),
});

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "NURSE", "CALL_OPERATOR"],
    bodySchema: BodySchema,
  },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const initiatorRole: ActorRole =
      ctx.role === "ADMIN"
        ? "ADMIN"
        : ctx.role === "RECEPTIONIST"
          ? "RECEPTIONIST"
          : // NURSE + CALL_OPERATOR don't have envelope-actor roles of their
            // own; both surface as RECEPTIONIST on the audit row (reception
            // staff in practice).
            "RECEPTIONIST";

    const result = await findOrCreateConversation({
      clinicId: ctx.clinicId,
      patientId: body.patientId,
      initiatorRole,
      initiatorUserId: ctx.userId,
      surface: ctx.role === "CALL_OPERATOR" ? "CALL_CENTER" : "CRM",
    });

    if (!result.ok) {
      if (result.reason === "patient_not_found") return notFound();
      return err("NoChannel", 422, {
        reason: "patient_has_no_phone_or_telegram",
      });
    }

    return ok(
      {
        conversationId: result.conversation.id,
        channel: result.conversation.channel,
        created: result.created,
      },
      result.created ? 201 : 200,
    );
  },
);
