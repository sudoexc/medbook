/**
 * POST /api/crm/doctors/me/conversations/find-or-create
 *
 * Doctor entrypoint for "open or cold-start a thread to one of my patients".
 * Doctor anti-leak (≥1 appointment with the patient) lives here because it's
 * role-specific authz; the rest delegates to the shared
 * `findOrCreateConversation` kernel so the `conversation.created` envelope +
 * audit row are emitted identically to the reception-side endpoint.
 *
 * Body: { patientId: string }
 * Response: { conversationId: string; channel: ConversationChannel; created: boolean }
 *          | 422 { error: "NoChannel", reason: "patient_has_no_phone_or_telegram" }
 *
 * Used by the patients-table «Написать» action and the messages page when it
 * lands with `?patientId=<id>`.
 *
 * Channel resolution (in the kernel):
 *   TG-only since `docs/TZ-sms-removal.md` Wave 3. The kernel returns 422
 *   `NoChannel` when the patient hasn't bound their Telegram account — the
 *   UI then prompts the operator to invite them via the Mini App or place
 *   a Call Center call instead.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";
import { findOrCreateConversation } from "@/server/conversations/find-or-create";

const BodySchema = z.object({
  patientId: z.string().min(1),
});

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: BodySchema },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, userId: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    // Anti-leak: the doctor must have ≥1 appointment with this patient.
    // Reception endpoint skips this — they see the full inbox anyway.
    const hasRelationship = await prisma.appointment.findFirst({
      where: { patientId: body.patientId, doctorId: doctor.id },
      select: { id: true },
    });
    if (!hasRelationship) return notFound();

    const result = await findOrCreateConversation({
      clinicId: ctx.clinicId,
      patientId: body.patientId,
      initiatorRole: "DOCTOR",
      initiatorUserId: ctx.userId,
      doctorScopeId: doctor.id,
      assigneeUserId: doctor.userId,
      surface: "DOCTOR_CABINET",
    });

    if (!result.ok) {
      if (result.reason === "patient_not_found") return notFound();
      return err("NoChannel", 422, {
        reason: "patient_has_no_telegram",
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
