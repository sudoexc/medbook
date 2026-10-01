/**
 * Phase 17 Wave 3 — Mini App account deletion request.
 *
 * GET /api/miniapp/account/delete
 *
 * The patient's active deletion request, `{ pending: { jobId, scheduledFor }
 * | null }`. The screen reads it on open (audit MA-12): the «scheduled, you
 * can cancel» state used to live only in the screen's memory, so after
 * leaving it the patient could no longer cancel.
 *
 * POST /api/miniapp/account/delete
 *
 * Body: `{ reason?: string, notes?: string, confirmation: string }`.
 *
 * The patient explicitly types out their phone number into `confirmation`
 * to gate the action — same UX as GitHub repo delete; a card with no real
 * number types the confirmation word instead (`deletionConfirmationMatches`).
 * If it matches:
 *   1. Create a DataDeletionJob with mode=ANONYMIZE, status=APPROVED
 *      (Mini App requests are auto-approved — patient owns their data),
 *      scheduledFor = now + 90 days.
 *   2. Stamp Patient.deletionRequestedAt + deletionReason for the
 *      consent gate to honour immediately.
 *   3. Audit PATIENT_DELETION_REQUESTED + PATIENT_DELETION_APPROVED.
 *
 * Idempotent: if a PENDING_REVIEW or APPROVED job already exists, the
 * endpoint returns it unchanged.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";

import { ok, err } from "@/server/http";
import { createMiniAppHandler, createMiniAppListHandler } from "@/server/miniapp/handler";
import { withIdempotency } from "@/server/miniapp/idempotency";
import { deletionScheduledFor } from "@/server/dsar/expiry";
import { isRealPhone } from "@/server/patient/phone-identity";
import { deletionConfirmationMatches } from "@/lib/patient-experience/account-deletion";

const BodySchema = z.object({
  reason: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  confirmation: z.string().min(1),
});

/** Requests the worker has not executed or the patient cancelled yet. */
const ACTIVE_DELETION_STATUSES = ["PENDING_REVIEW", "APPROVED"] as const;

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const job = await prisma.dataDeletionJob.findFirst({
    where: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      status: { in: [...ACTIVE_DELETION_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, scheduledFor: true },
  });
  return ok({
    pending: job
      ? { jobId: job.id, scheduledFor: job.scheduledFor.toISOString() }
      : null,
  });
});

export const POST = createMiniAppHandler(
  { bodySchema: BodySchema },
  async ({ request, body, ctx }) =>
    // Phase M4 — Idempotency-Key replay. Account deletion already has its
    // own "reuse existing PENDING/APPROVED job" branch, but a duplicate POST
    // there still writes a fresh audit pair. Caching the response keeps the
    // audit log clean and the second request just returns the original body.
    withIdempotency(
      request,
      { clinicId: ctx.clinicId, patientId: ctx.patientId },
      async () => {
    const me = await prisma.patient.findUnique({
      where: { id: ctx.patientId },
      select: { phone: true, phoneNormalized: true },
    });
    if (!me) return err("patient_missing", 404);

    // The same rule the screen shows (MA-12): the number from the profile,
    // or the confirmation word for a card whose phone is only a stub.
    if (
      !deletionConfirmationMatches({
        hasPhone: isRealPhone(me.phoneNormalized),
        phone: me.phone,
        confirmation: body.confirmation,
      })
    ) {
      return err("confirmation_mismatch", 400);
    }

    const existing = await prisma.dataDeletionJob.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        status: { in: [...ACTIVE_DELETION_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        mode: true,
      },
    });
    if (existing) {
      return ok({
        jobId: existing.id,
        status: existing.status,
        scheduledFor: existing.scheduledFor.toISOString(),
        mode: existing.mode,
        reused: true,
      });
    }

    const now = new Date();
    const scheduledFor = deletionScheduledFor(now);

    const job = await prisma.dataDeletionJob.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        // Patient-initiated requests skip review and go straight to
        // APPROVED. The 90-day cooling-off in `scheduledFor` is the
        // safety net — the patient can still cancel any time before
        // execution.
        status: "APPROVED",
        mode: "ANONYMIZE",
        scheduledFor,
        reason: body.reason ?? null,
        notes: body.notes ?? null,
        approvedAt: now,
      },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        mode: true,
      },
    });

    // Stamp the patient row so the consent gate suppresses marketing
    // immediately (transactional channels remain open until execution).
    await prisma.patient.update({
      where: { id: ctx.patientId },
      data: {
        deletionRequestedAt: now,
        deletionReason: body.reason ?? "patient-request",
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.PATIENT_DELETION_REQUESTED,
      entityType: "DataDeletionJob",
      entityId: job.id,
      meta: {
        patientId: ctx.patientId,
        mode: job.mode,
        scheduledFor: job.scheduledFor.toISOString(),
        reason: body.reason ?? null,
      },
    });
    await audit(request, {
      action: AUDIT_ACTION.PATIENT_DELETION_APPROVED,
      entityType: "DataDeletionJob",
      entityId: job.id,
      meta: {
        patientId: ctx.patientId,
        scheduledFor: job.scheduledFor.toISOString(),
        mode: job.mode,
        approvedBy: "auto",
      },
    });

    return ok({
      jobId: job.id,
      status: job.status,
      scheduledFor: job.scheduledFor.toISOString(),
      mode: job.mode,
      reused: false,
    });
      },
    ),
);
