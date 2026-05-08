/**
 * Phase 17 Wave 3 — Mini App "Отменить удаление" endpoint.
 *
 * POST /api/miniapp/account/cancel-deletion
 *
 * Cancels the most recent PENDING_REVIEW / APPROVED deletion job for
 * the active patient and clears the `deletionRequestedAt` stamp on the
 * Patient row. Ineffective (returns 404) if there is no cancellable
 * job — the worker may have already executed.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";

import { ok, err } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";

const BodySchema = z.object({}).passthrough().optional();

export const POST = createMiniAppHandler(
  { bodySchema: BodySchema },
  async ({ request, ctx }) => {
    const job = await prisma.dataDeletionJob.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        status: { in: ["PENDING_REVIEW", "APPROVED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!job) return err("no_active_deletion", 404);

    const now = new Date();
    const fromStatus = job.status;
    await prisma.dataDeletionJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: "patient-cancelled-via-miniapp",
      },
    });
    await prisma.patient.update({
      where: { id: ctx.patientId },
      data: {
        deletionRequestedAt: null,
        deletionReason: null,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.PATIENT_DELETION_CANCELLED,
      entityType: "DataDeletionJob",
      entityId: job.id,
      meta: {
        patientId: ctx.patientId,
        actor: "patient",
        fromStatus,
      },
    });

    return ok({ jobId: job.id, status: "CANCELLED" });
  },
);
