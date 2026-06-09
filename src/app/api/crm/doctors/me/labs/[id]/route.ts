/**
 * PATCH /api/crm/doctors/me/labs/[id] — primarily used to flip status to
 * REVIEWED ("я посмотрел"). Also allows ARCHIVING and editing the doctor's
 * notes on an entry they own.
 *
 * REVIEWED stamps `reviewedAt = now()` and `reviewedBy = ctx.userId`. The
 * row is then dropped from /labs/unread.
 *
 * Anti-leak: only the assigned doctor can mutate the row.
 *
 * SSE: `lab.result.reviewed` emitted through the outbox (replayable, reaches
 * the patient Mini App's `/api/miniapp/events`) on the first transition to
 * REVIEWED — that is the moment the result becomes patient-visible.
 * Audit: LAB_RESULT_REVIEWED.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";
import { ok, err, notFound } from "@/server/http";

const PatchBody = z.object({
  status: z.enum(["RESULTED", "REVIEWED", "ARCHIVED"]).optional(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

function labIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/me/labs/{id}
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = labIdFromUrl(request);
    if (!id) return err("BadRequest", 400, { reason: "missing_id" });

    const existing = await prisma.labResult.findFirst({
      where: { id, doctorId: ctx.userId },
      select: {
        id: true,
        status: true,
        patientId: true,
        flag: true,
        reviewedAt: true,
      },
    });
    if (!existing) return notFound();

    const data: Record<string, unknown> = {};
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.status !== undefined) {
      data.status = body.status;
      if (body.status === "REVIEWED") {
        // Stamp only on the first transition; re-flipping back-and-forth
        // keeps the original reviewedAt for the audit trail.
        if (!existing.reviewedAt) {
          data.reviewedAt = new Date();
          data.reviewedBy = ctx.userId;
        }
      }
    }
    if (Object.keys(data).length === 0) {
      return err("BadRequest", 400, { reason: "no_fields_to_update" });
    }

    const transitioningToReviewed =
      body.status === "REVIEWED" && existing.status !== "REVIEWED";

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.labResult.update({
        where: { id },
        data,
        select: {
          id: true,
          patientId: true,
          testName: true,
          value: true,
          unit: true,
          refRange: true,
          flag: true,
          notes: true,
          status: true,
          reviewedAt: true,
          receivedAt: true,
        },
      });

      // REVIEWED is the moment a result becomes patient-visible, so fan it out
      // through the outbox — replayable + delivered to the Mini App's SSE — not
      // the legacy bare AppEvent, which the miniapp feed (gated on
      // `isEventEnvelope`) silently dropped. Emitted inside the tx so the event
      // can never escape a rolled-back update.
      if (transitioningToReviewed) {
        const envelope: EventEnvelopeInput = {
          correlationId: newCorrelationId(),
          actor: {
            role: "DOCTOR",
            userId: ctx.userId,
            patientId: null,
            onBehalfOfPatientId: null,
            label: `user:${ctx.userId}`,
          },
          surface: "DOCTOR_CABINET",
          tenantScope: {
            clinicId: ctx.clinicId,
            doctorId: ctx.userId,
            patientId: existing.patientId,
          },
          type: "lab.result.reviewed",
          payload: {
            labResultId: id,
            doctorId: ctx.userId,
            patientId: existing.patientId,
            flag: existing.flag,
          },
        };
        await publishViaOutbox(tx, envelope);
      }

      return row;
    });

    // Audit stays on the legacy `audit(request, …)` path: `lab.result.reviewed`
    // is non-auditable in EVENT_META_OVERRIDES, so the pumper materialises no
    // row — this remains the sole LAB_RESULT_REVIEWED audit source, and it
    // carries the request IP/UA an in-tx `auditLog.create` couldn't. Runs after
    // commit so a failed update never leaves a phantom audit row.
    if (transitioningToReviewed) {
      await audit(request, {
        action: AUDIT_ACTION.LAB_RESULT_REVIEWED,
        entityType: "LabResult",
        entityId: id,
        meta: {
          doctorId: ctx.userId,
          patientId: existing.patientId,
          oldStatus: existing.status,
          flag: existing.flag,
        },
      });
    }

    return ok({
      id: updated.id,
      patientId: updated.patientId,
      testName: updated.testName,
      value: updated.value,
      unit: updated.unit,
      refRange: updated.refRange,
      flag: updated.flag,
      notes: updated.notes,
      status: updated.status,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
      receivedAt: updated.receivedAt.toISOString(),
    });
  },
);
