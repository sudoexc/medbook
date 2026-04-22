/**
 * GET /api/miniapp/documents?clinicSlug=…
 *
 * List the authenticated patient's documents (metadata only — file download
 * uses `fileUrl` which at present is the metadata placeholder; MinIO direct
 * download wires up in Phase 4).
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const docs = await prisma.document.findMany({
    where: { clinicId: ctx.clinicId, patientId: ctx.patientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      title: true,
      fileUrl: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });
  return ok({ documents: docs });
});
