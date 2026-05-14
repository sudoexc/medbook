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
 * SSE: `lab.result.reviewed` (when transitioning RESULTED → REVIEWED).
 * Audit: LAB_RESULT_REVIEWED.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { publishEventSafe } from "@/server/realtime/publish";
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

    const updated = await prisma.labResult.update({
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

    if (body.status === "REVIEWED" && existing.status !== "REVIEWED") {
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
      publishEventSafe(ctx.clinicId, {
        type: "lab.result.reviewed",
        payload: {
          labResultId: id,
          doctorId: ctx.userId,
          patientId: existing.patientId,
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
