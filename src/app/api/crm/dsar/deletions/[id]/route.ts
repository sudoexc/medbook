/**
 * Phase 17 Wave 3 — DSAR queue: approve / cancel a deletion job.
 *
 * PATCH /api/crm/dsar/deletions/[id]
 *   Body: `{ action: 'approve' | 'cancel', reason?: string }`.
 *
 * approve — flips PENDING_REVIEW → APPROVED. The hourly cron picks it
 *           up once `scheduledFor` is in the past.
 * cancel  — flips PENDING_REVIEW or APPROVED → CANCELLED. Patient row
 *           gets `deletionRequestedAt` cleared.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";

import { ok, err, notFound } from "@/server/http";

const BodySchema = z.object({
  action: z.enum(["approve", "cancel"]),
  reason: z.string().max(200).optional(),
});

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: BodySchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("invalid_context", 403);
    const url = new URL(request.url);
    const jobId = url.pathname.split("/").filter(Boolean).at(-1);
    if (!jobId) return err("invalid_path", 400);

    const job = await prisma.dataDeletionJob.findFirst({
      where: { id: jobId, clinicId: ctx.clinicId },
    });
    if (!job) return notFound();

    const now = new Date();

    if (body.action === "approve") {
      if (job.status !== "PENDING_REVIEW") {
        return err("invalid_status", 409, { current: job.status });
      }
      await prisma.dataDeletionJob.update({
        where: { id: job.id },
        data: {
          status: "APPROVED",
          approvedAt: now,
          approvedByUserId: ctx.userId,
        },
      });
      await audit(request, {
        action: AUDIT_ACTION.PATIENT_DELETION_APPROVED,
        entityType: "DataDeletionJob",
        entityId: job.id,
        meta: {
          patientId: job.patientId,
          scheduledFor: job.scheduledFor.toISOString(),
          mode: job.mode,
          approvedBy: "admin",
          adminUserId: ctx.userId,
        },
      });
      return ok({ status: "APPROVED" });
    }

    // cancel
    if (!["PENDING_REVIEW", "APPROVED"].includes(job.status)) {
      return err("invalid_status", 409, { current: job.status });
    }
    const fromStatus = job.status;
    await prisma.dataDeletionJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledByUserId: ctx.userId,
        cancelReason: body.reason ?? null,
      },
    });
    await prisma.patient.update({
      where: { id: job.patientId },
      data: { deletionRequestedAt: null, deletionReason: null },
    });
    await audit(request, {
      action: AUDIT_ACTION.PATIENT_DELETION_CANCELLED,
      entityType: "DataDeletionJob",
      entityId: job.id,
      meta: {
        patientId: job.patientId,
        actor: "admin",
        adminUserId: ctx.userId,
        fromStatus,
      },
    });
    return ok({ status: "CANCELLED" });
  },
);
