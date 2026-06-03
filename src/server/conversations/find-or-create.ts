/**
 * Single entry point for "open or create a thread to this patient".
 *
 * Cross-surface sync §7.10 — replaces the doctor-only `find-or-create`
 * endpoint that emitted `tg.conversation.updated` via `publishEventSafe`. The
 * kernel:
 *
 *   1. Looks for an existing thread for `{ patientId, optional doctorId
 *      anti-leak filter }`. Returns it untouched when found.
 *   2. Cold-starts a new thread when none exists. SMS preferred when patient
 *      has a phone (outbound TG only works when the patient has previously
 *      messaged the bot — Telegram bot-init rule); TG fallback when phone is
 *      missing but telegramId is set; 422-equivalent `no_channel` otherwise.
 *   3. Inside the same transaction emits two envelopes via the outbox:
 *      - `conversation.created` (auditable per spec — closes compliance gap)
 *      - `tg.conversation.updated` (drives CRM inbox + doctor messages list
 *        live update; the legacy event name is kept for backwards-compat with
 *        the existing SSE filters).
 *
 * Doctor anti-leak (the doctor must already have ≥1 appointment with the
 * patient before opening a thread) lives in the doctor-scoped route since
 * it's role-specific authz, not domain logic.
 */

import type { Conversation } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type {
  ActorRole,
  EventEnvelopeInput,
  Surface,
} from "@/server/realtime/envelope";

export type ConversationChannelLiteral =
  | "SMS"
  | "TG"
  | "CALL"
  | "EMAIL"
  | "VISIT";

export type FindOrCreateConversationInput = {
  clinicId: string;
  patientId: string;
  /** Who initiated the open — drives actor on the envelope + assignee. */
  initiatorRole: ActorRole;
  initiatorUserId: string;
  /** When the initiator is a doctor, scopes the existing-thread lookup to
   *  threads tied to this doctor (appointment / assignee). Omit for reception. */
  doctorScopeId?: string | null;
  /** Surface that drove the open; defaults to CRM. */
  surface?: Surface;
  /** Override the assignee on the freshly created thread — defaults to the
   *  initiator user (so the row shows up in their inbox). */
  assigneeUserId?: string | null;
  /** Cascade hint: thread upstream correlationId through. */
  correlationId?: string;
  causedByEventId?: string;
  actorLabel?: string;
};

export type FindOrCreateConversationResult =
  | {
      ok: true;
      conversation: Pick<Conversation, "id" | "channel">;
      created: boolean;
    }
  | { ok: false; reason: "patient_not_found" | "no_channel" };

export async function findOrCreateConversation(
  input: FindOrCreateConversationInput,
): Promise<FindOrCreateConversationResult> {
  const patient = await prisma.patient.findFirst({
    where: { id: input.patientId, clinicId: input.clinicId },
    select: { id: true, phone: true, telegramId: true },
  });
  if (!patient) return { ok: false, reason: "patient_not_found" };

  // 1) Prefer existing thread. Doctor-scope narrows to "appointment with me
  //    OR explicitly assigned to me OR un-routed clinic-wide", same as the
  //    legacy doctor endpoint. Reception sees ANY clinic thread for this
  //    patient.
  const where = input.doctorScopeId
    ? {
        patientId: patient.id,
        OR: [
          { appointment: { doctorId: input.doctorScopeId } },
          { assignedToId: input.initiatorUserId },
          { AND: [{ appointmentId: null }, { assignedToId: null }] },
        ],
      }
    : { patientId: patient.id };

  const existing = await prisma.conversation.findFirst({
    where,
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, channel: true },
  });
  if (existing) {
    return {
      ok: true,
      conversation: existing,
      created: false,
    };
  }

  // 2) Cold start. SMS first (always sendable), TG fallback (works only when
  //    patient has DM'd the bot before — outbound bot-init is blocked by
  //    Telegram), 422-equivalent when neither is reachable.
  let channel: "SMS" | "TG";
  if (patient.phone && patient.phone.trim().length > 0) {
    channel = "SMS";
  } else if (patient.telegramId) {
    channel = "TG";
  } else {
    return { ok: false, reason: "no_channel" };
  }

  const surface = input.surface ?? "CRM";
  const correlationId = input.correlationId ?? newCorrelationId();
  const assigneeUserId =
    input.assigneeUserId === undefined
      ? input.initiatorUserId
      : input.assigneeUserId;
  const actorLabel =
    input.actorLabel ?? `user:${input.initiatorUserId}`;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.conversation.create({
      data: {
        clinicId: input.clinicId,
        channel,
        // takeover = staff is driving the thread; reserved bot-mode is the AI
        // auto-responder loop we haven't wired yet.
        mode: "takeover",
        patientId: patient.id,
        assignedToId: assigneeUserId,
        status: "OPEN",
        // externalId stays null — Postgres treats NULLs as distinct under
        // the @@unique([clinicId, externalId]) constraint, so two cold
        // outbound threads to different patients won't collide.
      },
      select: { id: true, channel: true },
    });

    // Legacy audit row — coexists with the pumper-materialised one until the
    // unified path lands in Phase F, mirrors the cancel.ts pattern.
    await tx.auditLog.create({
      data: {
        clinicId: input.clinicId,
        actorId: input.initiatorUserId,
        actorRole: null,
        actorLabel: null,
        action: AUDIT_ACTION.CONVERSATION_CREATED,
        entityType: "Conversation",
        entityId: row.id,
        meta: {
          patientId: patient.id,
          channel: row.channel,
          initiatorRole: input.initiatorRole,
          initiatorUserId: input.initiatorUserId,
          assigneeUserId,
          correlationId,
        } as never,
        ip: null,
        userAgent: null,
        surface,
        correlationId,
      },
    });

    const baseEnvelope = {
      correlationId,
      causedByEventId: input.causedByEventId,
      actor: {
        role: input.initiatorRole,
        userId: input.initiatorUserId,
        patientId: null,
        onBehalfOfPatientId: null,
        label: actorLabel,
      },
      surface,
      tenantScope: {
        clinicId: input.clinicId,
        patientId: patient.id,
      },
    } as const;

    const createdEnvelope: EventEnvelopeInput = {
      ...baseEnvelope,
      type: "conversation.created",
      payload: {
        conversationId: row.id,
        patientId: patient.id,
        channel: row.channel,
        initiatorRole: input.initiatorRole,
        initiatorUserId: input.initiatorUserId,
        assigneeUserId,
      },
    };
    const { eventId } = await publishViaOutbox(tx, createdEnvelope);

    // Follow-up `tg.conversation.updated` keeps existing CRM inbox SSE
    // subscribers reactive — same shape they already render against.
    const updatedEnvelope: EventEnvelopeInput = {
      ...baseEnvelope,
      causedByEventId: eventId,
      type: "tg.conversation.updated",
      payload: {
        conversationId: row.id,
        mode: "takeover",
        status: "OPEN",
        assigneeId: assigneeUserId,
      },
    };
    await publishViaOutbox(tx, updatedEnvelope);

    return row;
  });

  return {
    ok: true,
    conversation: created,
    created: true,
  };
}
