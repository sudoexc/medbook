/**
 * Phase 17 Wave 3 — DSAR queue: list export jobs.
 *
 * GET /api/crm/dsar/exports
 *
 * Returns the most recent export jobs in the active clinic, newest first.
 * ADMIN-only.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";

import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") {
      return ok({ items: [] });
    }
    const rows = await prisma.dataExportJob.findMany({
      where: { clinicId: ctx.clinicId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        status: true,
        patientId: true,
        patient: { select: { fullName: true } },
        fileSizeBytes: true,
        downloadCount: true,
        expiresAt: true,
        errorMessage: true,
        createdAt: true,
        requestedByUserId: true,
      },
    });

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        patientId: r.patientId,
        patientName: r.patient?.fullName ?? null,
        fileSizeBytes: r.fileSizeBytes,
        downloadCount: r.downloadCount,
        expiresAt: r.expiresAt.toISOString(),
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
        requestedByUserId: r.requestedByUserId,
      })),
    });
  },
);
