/**
 * POST /api/crm/doctors/me/conversations/find-or-create
 *
 * Body: { patientId: string }
 * Response: { conversationId: string; channel: ConversationChannel; created: boolean }
 *          | 422 { error: "NoChannel", reason: "patient_has_no_phone_or_telegram" }
 *
 * Used by the patients-table «Написать» action and the messages page when it
 * lands with `?patientId=<id>` — both need a conversation to select. The flow:
 *
 *   1. Anti-leak: the doctor must have ≥1 appointment with this patient.
 *   2. Prefer an existing thread (any channel) by `lastMessageAt desc`.
 *   3. Otherwise create one: SMS if patient.phone, else TG if patient.telegramId.
 *      If neither is set, return 422 so the UI can show a clear toast instead
 *      of silently dropping an empty thread into the inbox.
 *
 * Why SMS first instead of TG:
 *   Outbound TG only works when the patient has previously messaged the bot
 *   (Telegram rule — bot can't initiate). SMS we can always send. So phone
 *   is the more reliable cold-start channel.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";
import { publishEventSafe } from "@/server/realtime/publish";

const BodySchema = z.object({
  patientId: z.string().min(1),
});

type ChannelLiteral = "SMS" | "TG" | "CALL" | "EMAIL" | "VISIT";

type Response = {
  conversationId: string;
  channel: ChannelLiteral;
  created: boolean;
};

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

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId },
      select: { id: true, phone: true, telegramId: true },
    });
    if (!patient) return notFound();

    const hasRelationship = await prisma.appointment.findFirst({
      where: { patientId: patient.id, doctorId: doctor.id },
      select: { id: true },
    });
    if (!hasRelationship) return notFound();

    // 1) Prefer an existing thread. Doctor-scoped: appointment with me OR
    //    explicitly assigned to me.
    const existing = await prisma.conversation.findFirst({
      where: {
        patientId: patient.id,
        OR: [
          { appointment: { doctorId: doctor.id } },
          { assignedToId: doctor.userId },
          // Untargeted clinic-wide thread (no doctor assigned, no appointment
          // link) — we still surface it because the patient–doctor
          // relationship was established above.
          { AND: [{ appointmentId: null }, { assignedToId: null }] },
        ],
      },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, channel: true },
    });
    if (existing) {
      const payload: Response = {
        conversationId: existing.id,
        channel: existing.channel as ChannelLiteral,
        created: false,
      };
      return ok(payload);
    }

    // 2) Cold start. Pick a channel based on what contact the patient has.
    let channel: "SMS" | "TG";
    if (patient.phone && patient.phone.trim().length > 0) {
      channel = "SMS";
    } else if (patient.telegramId) {
      channel = "TG";
    } else {
      return err("NoChannel", 422, {
        reason: "patient_has_no_phone_or_telegram",
      });
    }

    const created = await prisma.conversation.create({
      data: {
        clinicId: ctx.clinicId,
        channel,
        // takeover = doctor is actively driving the thread; bot mode is
        // reserved for AI auto-responder loops.
        mode: "takeover",
        patientId: patient.id,
        assignedToId: doctor.userId,
        status: "OPEN",
        // externalId stays null — Postgres treats NULLs as distinct under
        // the @@unique([clinicId, externalId]) constraint, so two cold
        // outbound threads to different patients won't collide.
      },
      select: { id: true, channel: true },
    });

    publishEventSafe(ctx.clinicId, {
      type: "tg.conversation.updated",
      payload: {
        conversationId: created.id,
        mode: "takeover",
        status: "OPEN",
        assigneeId: doctor.userId,
      },
    });

    const payload: Response = {
      conversationId: created.id,
      channel: created.channel as ChannelLiteral,
      created: true,
    };
    return ok(payload, 201);
  },
);
