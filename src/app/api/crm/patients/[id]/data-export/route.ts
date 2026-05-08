/**
 * Phase 17 Wave 3 — CRM admin "Экспорт данных" endpoint.
 *
 * POST /api/crm/patients/[id]/data-export
 *
 * Lets an ADMIN trigger a DSAR export on a patient's behalf (e.g. the
 * patient calls the receptionist asking for their data). Mirrors the
 * Mini App endpoint but delivers to the admin user's TG chat (if known)
 * — the admin then forwards the file to the patient through whatever
 * legitimate channel they're using. Falls back to "no chat → admin
 * downloads via signed URL" when the admin has no TG bound.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";

import { ok, err, notFound } from "@/server/http";
import { exportExpiresAt } from "@/server/dsar/expiry";
import { enqueueExportJob } from "@/server/workers/data-export";

const BodySchema = z
  .object({
    deliverToPatient: z.boolean().optional(),
  })
  .partial();

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: BodySchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("invalid_context", 403);
    const url = new URL(request.url);
    const patientId = url.pathname.split("/").filter(Boolean).at(-2);
    if (!patientId) return err("invalid_path", 400);

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, clinicId: ctx.clinicId },
      select: {
        id: true,
        telegramId: true,
      },
    });
    if (!patient) return notFound();

    // Resolve delivery chat:
    //   • If admin asked for direct delivery to the patient, use the
    //     patient's TG id.
    //   • Otherwise prefer the admin's bound TG id; fall back to no
    //     chat (admin will download via signed URL).
    let telegramChatId: string | null = null;
    if (body.deliverToPatient) {
      telegramChatId = patient.telegramId ?? null;
    } else {
      const adminUser = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { telegramId: true },
      });
      telegramChatId = adminUser?.telegramId ?? null;
    }

    const job = await prisma.dataExportJob.create({
      data: {
        clinicId: ctx.clinicId,
        patientId,
        status: "PENDING",
        telegramChatId,
        expiresAt: exportExpiresAt(new Date()),
        requestedByUserId: ctx.userId,
      },
      select: { id: true, status: true },
    });

    await audit(request, {
      action: AUDIT_ACTION.PATIENT_DATA_EXPORT_REQUESTED,
      entityType: "DataExportJob",
      entityId: job.id,
      meta: {
        patientId,
        requestedBy: "admin",
        adminUserId: ctx.userId,
        deliverToPatient: !!body.deliverToPatient,
      },
    });

    await enqueueExportJob(job.id);

    return ok({ jobId: job.id, status: job.status });
  },
);
