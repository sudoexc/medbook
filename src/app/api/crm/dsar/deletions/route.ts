/**
 * Phase 17 Wave 3 — DSAR queue: list & create deletion jobs.
 *
 * GET  /api/crm/dsar/deletions   — list, ADMIN-only.
 * POST /api/crm/dsar/deletions   — admin schedules a deletion (e.g. on
 *                                  written request from the patient that
 *                                  did not come through the Mini App).
 *                                  Body: `{ patientId, mode?, reason?,
 *                                  notes? }`.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";

import { ok, err, notFound } from "@/server/http";
import { deletionScheduledFor } from "@/server/dsar/expiry";

const CreateSchema = z.object({
  patientId: z.string().min(1),
  mode: z.enum(["ANONYMIZE", "HARD_DELETE"]).default("ANONYMIZE"),
  reason: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return ok({ items: [] });
    const rows = await prisma.dataDeletionJob.findMany({
      where: { clinicId: ctx.clinicId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        status: true,
        mode: true,
        scheduledFor: true,
        executedAt: true,
        cancelledAt: true,
        cancelReason: true,
        reason: true,
        notes: true,
        createdAt: true,
        patientId: true,
        patient: { select: { fullName: true } },
        approvedByUserId: true,
        cancelledByUserId: true,
        requestedByUserId: true,
      },
    });
    return ok({
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        mode: r.mode,
        patientId: r.patientId,
        patientName: r.patient?.fullName ?? null,
        scheduledFor: r.scheduledFor.toISOString(),
        executedAt: r.executedAt?.toISOString() ?? null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        cancelReason: r.cancelReason,
        reason: r.reason,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        approvedByUserId: r.approvedByUserId,
        cancelledByUserId: r.cancelledByUserId,
        requestedByUserId: r.requestedByUserId,
      })),
    });
  },
);

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: CreateSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("invalid_context", 403);

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, clinicId: ctx.clinicId },
      select: { id: true },
    });
    if (!patient) return notFound();

    // Don't double-up.
    const existing = await prisma.dataDeletionJob.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId: body.patientId,
        status: { in: ["PENDING_REVIEW", "APPROVED"] },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      return err("already_active", 409, { existingJobId: existing.id });
    }

    const now = new Date();
    const job = await prisma.dataDeletionJob.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: body.patientId,
        status: "PENDING_REVIEW",
        mode: body.mode,
        scheduledFor: deletionScheduledFor(now),
        reason: body.reason ?? null,
        notes: body.notes ?? null,
        requestedByUserId: ctx.userId,
      },
      select: {
        id: true,
        status: true,
        mode: true,
        scheduledFor: true,
      },
    });

    await prisma.patient.update({
      where: { id: body.patientId },
      data: {
        deletionRequestedAt: now,
        deletionReason: body.reason ?? "admin-request",
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.PATIENT_DELETION_REQUESTED,
      entityType: "DataDeletionJob",
      entityId: job.id,
      meta: {
        patientId: body.patientId,
        mode: job.mode,
        scheduledFor: job.scheduledFor.toISOString(),
        reason: body.reason ?? null,
        adminUserId: ctx.userId,
      },
    });

    return ok({
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      scheduledFor: job.scheduledFor.toISOString(),
    });
  },
);
