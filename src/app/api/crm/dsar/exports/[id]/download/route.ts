/**
 * Phase 17 Wave 3 — DSAR signed download endpoint.
 *
 * GET /api/crm/dsar/exports/[id]/download
 *
 * Returns a signed URL the admin can use to fetch the encrypted ZIP. The
 * passphrase is NOT returned (it was shown once at creation, in the
 * Telegram delivery, and is only stored as a bcrypt hash).
 *
 * Atomically bumps `downloadCount` and audits PATIENT_DATA_EXPORT_DOWNLOADED
 * so we can answer "who downloaded which bundle, how many times" later.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";

import { ok, err, notFound } from "@/server/http";
import { getSignedUrl } from "@/server/storage/minio";

const EXPORTS_BUCKET = process.env.MINIO_EXPORTS_BUCKET || "exports";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("invalid_context", 403);
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const jobId = parts.at(-2);
    if (!jobId) return err("invalid_path", 400);

    const job = await prisma.dataExportJob.findFirst({
      where: { id: jobId, clinicId: ctx.clinicId },
      select: {
        id: true,
        patientId: true,
        storageKey: true,
        status: true,
        downloadCount: true,
      },
    });
    if (!job) return notFound();
    if (!job.storageKey || !["READY", "DELIVERED"].includes(job.status)) {
      return err("not_ready", 409);
    }

    const signed = await getSignedUrl(EXPORTS_BUCKET, job.storageKey, 900);

    const updated = await prisma.dataExportJob.update({
      where: { id: job.id },
      data: { downloadCount: { increment: 1 } },
      select: { downloadCount: true },
    });

    await audit(request, {
      action: AUDIT_ACTION.PATIENT_DATA_EXPORT_DOWNLOADED,
      entityType: "DataExportJob",
      entityId: job.id,
      meta: {
        patientId: job.patientId,
        actor: "admin",
        adminUserId: ctx.userId,
        downloadCount: updated.downloadCount,
      },
    });

    return ok({ url: signed, expiresInSeconds: 900 });
  },
);
